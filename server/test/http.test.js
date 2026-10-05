import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
import {app} from '../src/app.js';
import {pool} from '../src/db.js';
import {config} from '../src/config.js';
import {fixture,testDatabase} from './helpers.js';
let db;
const origin='http://localhost:5173';
before(async()=>{
 config.secret='integration-tests-secret-at-least-32-chars';config.appUrl=origin;
 db=await testDatabase('http');pool.query=(...args)=>db.query(...args);pool.connect=()=>db.connect();
});
after(async()=>{await db?.end();await pool.end();});
test('HTTP rechaza origen ajeno, protege POS y valida JSON',async()=>{
 await request(app).post('/api/auth/register').set('Origin','https://evil.example').send({}).expect(403);
 await request(app).get('/api/cash').expect(401);
 await request(app).post('/api/auth/register').set('Origin',origin).send({email:'x',password:'short'}).expect(400);
 await request(app).post('/api/auth/login').set('Origin',origin).set('Content-Type','application/json').send('{').expect(400);
 await request(app).get('/api/missing').expect(404);
});
test('registro, sesión, cliente sin privilegios y cierre de sesión',async()=>{
 const client=request.agent(app),email=`${randomUUID()}@example.com`;
 const registration=await client.post('/api/auth/register').set('Origin',origin).send({name:'Cliente Prueba',email,phone:'4431234567',password:'password-long-enough'}).expect(201);
 assert.equal(registration.body.role,'customer');assert(!registration.body.password_hash);
 await client.get('/api/auth/me').expect(200);await client.get('/api/admin/resources').expect(403);await client.get('/api/cash').expect(403);
 await client.post('/api/auth/logout').set('Origin',origin).expect(204);await client.get('/api/auth/me').expect(401);
 await client.post('/api/auth/login').set('Origin',origin).send({email,password:'password-long-enough'}).expect(200);
 await client.post('/api/push/subscribe').set('Origin',origin).send({endpoint:'https://127.0.0.1/private',keys:{p256dh:'x'.repeat(60),auth:'x'.repeat(22)}}).expect(400);
});
test('webhook sin firma no modifica datos',async()=>{await request(app).post('/api/payments/webhook?data.id=123').send({}).expect(401);});
test('recuperación genera enlace de un uso y contraseña nueva con correo habilitado',async()=>{
 const before={...process.env};Object.assign(process.env,{EMAIL_ENABLED:'true',SMTP_HOST:'smtp.example.com',SMTP_USER:'test',SMTP_PASS:'test',MAIL_FROM:'test@example.com'});
 try{
  const client=request.agent(app),email=`${randomUUID()}@example.com`;
  const registered=await client.post('/api/auth/register').set('Origin',origin).send({name:'Recuperación',email,phone:'4431234567',password:'old-password-long'}).expect(201);
  await client.post('/api/auth/recover').set('Origin',origin).send({email}).expect(200);
  const outbox=(await db.query("SELECT url FROM notification_outbox WHERE user_id=$1 AND title='Acceso a ConexionES' ORDER BY created_at DESC LIMIT 1",[registered.body.id])).rows[0];
  const token=outbox.url.split('/').at(-1);
  await client.post('/api/auth/activate').set('Origin',origin).send({token,password:'new-password-long'}).expect(200);
  await client.post('/api/auth/activate').set('Origin',origin).send({token,password:'other-password-long'}).expect(400);
  await client.post('/api/auth/logout').set('Origin',origin).expect(204);
  await client.post('/api/auth/login').set('Origin',origin).send({email,password:'old-password-long'}).expect(401);
  await client.post('/api/auth/login').set('Origin',origin).send({email,password:'new-password-long'}).expect(200);
 }finally{for(const key of ['EMAIL_ENABLED','SMTP_HOST','SMTP_USER','SMTP_PASS','MAIL_FROM']){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}}
});
test('catálogo, reserva, boleto privado y tracking público sin datos del cliente',async()=>{
 const client=request.agent(app),email=`${randomUUID()}@example.com`;
 const user=(await client.post('/api/auth/register').set('Origin',origin).send({name:'Pasajero QR',email,phone:'4431234567',password:'password-for-qr-test'}).expect(201)).body;
 const f=await fixture(db,16);
 const catalog=await client.get('/api/catalog').expect(200);assert.equal(catalog.body.trips.find(t=>t.id===f.trip.id).available,16);
 const booking=(await client.post('/api/bookings').set('Origin',origin).set('Idempotency-Key',randomUUID()).send({tripId:f.trip.id,passengers:[{id:f.type.id,quantity:3}]}).expect(201)).body;
 assert.equal(booking.total_cents,78000);assert.equal(booking.user_id,user.id);
 const ticket=await client.get(`/api/ticket/${booking.ticket_token}`).expect(200);assert(ticket.body.qr.startsWith('data:image/png;base64,'));assert.equal(ticket.body.trip.plate,f.vehicle.plate);
 await request(app).get(`/api/ticket/${booking.ticket_token}`).expect(401);
 const outsider=request.agent(app);await outsider.post('/api/auth/register').set('Origin',origin).send({name:'Otro cliente',email:`${randomUUID()}@example.com`,phone:'4431234567',password:'another-long-password'}).expect(201);
 await outsider.get(`/api/ticket/${booking.ticket_token}`).expect(404);
 const tracking=await request(app).get(`/api/tracking/${booking.share_token}`).expect(200);assert(!tracking.body.email&&!tracking.body.user_id&&!tracking.body.ticket_token&&!tracking.body.phone);
 await request(app).get(`/api/vehicle/${f.vehicle.public_token}`).expect(404);
 await f.run("UPDATE trips SET status='boarding' WHERE id=$1",[f.trip.id]);await request(app).get(`/api/vehicle/${f.vehicle.public_token}`).expect(200);
});
test('integraciones pendientes no crean reservas ni intentan cobros y POS sigue funcionando',async()=>{
 const enabled=process.env.MP_ENABLED;process.env.MP_ENABLED='false';
 try{
  const f=await fixture(db),client=request.agent(app),email=`${randomUUID()}@example.com`;
  await client.post('/api/auth/register').set('Origin',origin).send({name:'Cliente pendiente',email,phone:'4431234567',password:'long-pending-password'}).expect(201);
  const status=await client.get('/api/integrations').expect(200);assert.equal(status.body.payments,false);assert.equal(status.body.email,false);
  await client.post('/api/bookings').set('Origin',origin).set('Idempotency-Key',randomUUID()).send({tripId:f.trip.id,passengers:[{id:f.type.id,quantity:1}]}).expect(503);
  assert.equal((await f.run('SELECT count(*) AS n FROM bookings WHERE trip_id=$1',[f.trip.id])).n,0);
  await client.post(`/api/bookings/${f.trip.id}/preference`).set('Origin',origin).expect(503);
  await client.post('/api/auth/recover').set('Origin',origin).send({email}).expect(503);
  const cashierEmail=`${randomUUID()}@example.com`;
  const cashier=(await client.post('/api/auth/register').set('Origin',origin).send({name:'Cajero',email:cashierEmail,phone:'4431234567',password:'long-cashier-password'}).expect(201)).body;
  await db.query("UPDATE users SET role='cashier' WHERE id=$1",[cashier.id]);
  const cash=(await client.post('/api/cash/open').set('Origin',origin).send({registerId:f.register.id,openingCents:0}).expect(201)).body;
  const sale=await client.post('/api/bookings').set('Origin',origin).set('Idempotency-Key',randomUUID()).send({tripId:f.trip.id,channel:'pos',cashSessionId:cash.id,customerId:f.u.id,passengers:[{id:f.type.id,quantity:1}]}).expect(201);
  assert.equal(sale.body.status,'confirmed');assert.equal(sale.body.fee_cents,0);
  await client.get(`/api/cash/${cash.id}/report`).expect(200);
  await client.post(`/api/cash/${cash.id}/close`).set('Origin',origin).send({countedCents:25000}).expect(200);
 }finally{process.env.MP_ENABLED=enabled;}
});
