import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import pg from 'pg';
import {createBooking} from '../src/bookings.js';
import {openCash,closeCash} from '../src/cash.js';
import {acceptLocal} from '../src/local.js';
import {reconcilePayment} from '../src/mercadopago.js';
import {config} from '../src/config.js';
let db,engine,releaseQueue=Promise.resolve();
// TEST_DATABASE_URL enables the same suite against an actual PostgreSQL server.
// PGlite has one connection: serialize transactions, never interleave BEGINs.
before(async()=>{
 if(process.env.TEST_DATABASE_URL){db=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});}
 else{
  engine=new PGlite();
  db={query:(...args)=>engine.query(...args),connect:async()=>{
   const prev=releaseQueue;let release;releaseQueue=new Promise(resolve=>{release=resolve;});await prev;
   return {query:(...args)=>engine.query(...args),release};
  }};
 }
 const sql=await readFile(new URL('../../database/schema.sql',import.meta.url),'utf8');
 if(engine)await engine.exec(sql);else await db.query(sql);
});
after(async()=>{if(engine)await engine.close();else await db.end();});
async function fixture(capacity=4){
 const run=async(sql,params=[])=>(await db.query(sql,params)).rows[0];
 const u=await run("INSERT INTO users(name,email,phone,password_hash) VALUES('Cliente',$1,'4431234567','test') RETURNING *",[`${randomUUID()}@example.com`]);
 const cashier=await run("INSERT INTO users(name,email,phone,password_hash,role) VALUES('Cajero',$1,'4431234567','test','cashier') RETURNING *",[`${randomUUID()}@example.com`]);
 const driverUser=await run("INSERT INTO users(name,email,phone,password_hash,role) VALUES('Chofer',$1,'4437654321','test','driver') RETURNING *",[`${randomUUID()}@example.com`]);
 const driver=await run("INSERT INTO drivers(user_id,photo_url,license) VALUES($1,'https://example.com/photo.jpg','ABC123') RETURNING *",[driverUser.id]);
 const vehicle=await run("INSERT INTO vehicles(brand,model,plate,capacity) VALUES('Toyota','Hiace',$1,$2) RETURNING *",[randomUUID(),capacity]);
 const route=await run("INSERT INTO routes(origin,destination,kind) VALUES($1,'Morelia','interurban') RETURNING *",[randomUUID()]);
 const type=await run('INSERT INTO passenger_types(name) VALUES($1) RETURNING *',[randomUUID()]);
 await run('INSERT INTO fares VALUES($1,$2,25000)',[route.id,type.id]);
 const trip=await run("INSERT INTO trips(route_id,vehicle_id,driver_id,departure_at,arrival_at,capacity) VALUES($1,$2,$3,now()+interval '1 day',now()+interval '1 day 3 hours',$4) RETURNING *",[route.id,vehicle.id,driver.id,capacity]);
 const register=await run('INSERT INTO cash_registers(name) VALUES($1) RETURNING *',[randomUUID()]);
 return {u,cashier,driverUser,driver,trip,type,register,run};
}
test('DDL, idempotencia, capacidad y expiración real de reservas',async()=>{
 const f=await fixture(4),key=randomUUID(),input={tripId:f.trip.id,passengers:[{id:f.type.id,quantity:3}]};
 const first=await createBooking(f.u,input,key,db);assert.equal(first.total_cents,78000);
 const retry=await createBooking(f.u,input,key,db);assert.equal(retry.id,first.id);
 await assert.rejects(createBooking(f.u,{...input,passengers:[{id:f.type.id,quantity:2}]},key,db),/idempotencia/);
 await assert.rejects(createBooking(f.u,input,randomUUID(),db),/lugares/);
 await f.run("UPDATE bookings SET expires_at=now()-interval '1 minute' WHERE id=$1",[first.id]);
 const next=await createBooking(f.u,input,randomUUID(),db);assert.notEqual(next.id,first.id);
 assert.equal((await f.run('SELECT status FROM bookings WHERE id=$1',[first.id])).status,'expired');
});
test('rollback completo ante solicitud sin tarifa',async()=>{
 const f=await fixture();
 await assert.rejects(createBooking(f.u,{tripId:f.trip.id,passengers:[{id:randomUUID(),quantity:1}]},randomUUID(),db),/Tarifa/);
 assert.equal((await f.run('SELECT count(*)::int AS n FROM bookings WHERE trip_id=$1',[f.trip.id])).n,0);
});
test('dos compras concurrentes compiten por la misma capacidad',async()=>{
 const f=await fixture(4),input={tripId:f.trip.id,passengers:[{id:f.type.id,quantity:3}]};
 const results=await Promise.allSettled([createBooking(f.u,input,randomUUID(),db),createBooking(f.u,input,randomUUID(),db)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await f.run("SELECT sum(passengers)::int AS n FROM bookings WHERE trip_id=$1 AND status='pending'",[f.trip.id])).n,3);
});
test('POS vende sin comisión, cierre contiene fondo, ventas y diferencia',async()=>{
 const f=await fixture(),s=await openCash(f.cashier,{registerId:f.register.id,openingCents:10000},db);
 await assert.rejects(openCash(f.cashier,{registerId:f.register.id,openingCents:10000},db));
 const input={tripId:f.trip.id,channel:'pos',customerId:f.u.id,cashSessionId:s.id,passengers:[{id:f.type.id,quantity:2}]};
 const b=await createBooking(f.cashier,input,randomUUID(),db);assert.equal(b.status,'confirmed');assert.equal(b.fee_cents,0);
 const closed=await closeCash(f.cashier,s.id,{countedCents:59000},db);
 assert.equal(closed.expected_cents,60000);assert.equal(closed.difference_cents,-1000);assert.equal(closed.transactions,1);
 await assert.rejects(createBooking(f.cashier,{...input,passengers:[{id:f.type.id,quantity:1}]},randomUUID(),db),/caja/);
 await assert.rejects(closeCash(f.cashier,s.id,{countedCents:60000},db),/cerrada/);
});
test('cierre concurrente con venta conserva el reporte o rechaza la venta',async()=>{
 const f=await fixture(),s=await openCash(f.cashier,{registerId:f.register.id,openingCents:0},db);
 const input={tripId:f.trip.id,channel:'pos',customerId:f.u.id,cashSessionId:s.id,passengers:[{id:f.type.id,quantity:1}]};
 await Promise.allSettled([createBooking(f.cashier,input,randomUUID(),db),closeCash(f.cashier,s.id,{countedCents:25000},db)]);
 const final=await f.run('SELECT * FROM cash_sessions WHERE id=$1',[s.id]);
 const sales=await f.run('SELECT COALESCE(sum(total_cents),0)::int AS n FROM bookings WHERE cash_session_id=$1',[s.id]);
 assert.equal(final.expected_cents,sales.n);assert(final.closed_at);
});
test('cinco pasajeros generan dos autos, aceptación única y contacto vía outbox',async()=>{
 const f=await fixture(8),s=await openCash(f.cashier,{registerId:f.register.id,openingCents:0},db);
 const b=await createBooking(f.cashier,{tripId:f.trip.id,channel:'pos',customerId:f.u.id,cashSessionId:s.id,passengers:[{id:f.type.id,quantity:5}],rapid:{zone:'Centro',passengers:5,luggage:3,vehicles:2}},randomUUID(),db);
 const jobs=(await db.query('SELECT j.* FROM local_jobs j JOIN last_mile_requests r ON r.id=j.request_id WHERE r.booking_id=$1',[b.id])).rows;
 assert.equal(jobs.length,2);assert.equal(jobs.reduce((n,j)=>n+j.passengers,0),5);
 const fleet=await f.run("INSERT INTO local_fleet(driver_id,plate,model,city,capacity,luggage_capacity) VALUES($1,$2,'Sedán','Morelia',4,4) RETURNING *",[f.driver.id,randomUUID()]);
 const results=await Promise.allSettled([acceptLocal(f.driverUser,jobs[0].id,fleet.id,db),acceptLocal(f.driverUser,jobs[0].id,fleet.id,db)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await f.run("SELECT count(*)::int AS n FROM notification_outbox WHERE event_key LIKE $1",[`local-%:${jobs[0].id}`])).n,2);
 await assert.rejects(acceptLocal(f.driverUser,jobs[1].id,fleet.id,db));
});
test('pago aprobado, webhook duplicado, importe alterado y reversión',async()=>{
 config.mpCollector='123';const f=await fixture(),b=await createBooking(f.u,{tripId:f.trip.id,passengers:[{id:f.type.id,quantity:2}]},randomUUID(),db);
 const p={id:String(Date.now()),collector_id:123,external_reference:b.id,status:'approved',currency_id:'MXN',transaction_amount:520};
 await assert.rejects(reconcilePayment({...p,transaction_amount:1},db),/Importe/);
 await reconcilePayment(p,db);await reconcilePayment(p,db);
 assert.equal((await f.run('SELECT status FROM bookings WHERE id=$1',[b.id])).status,'confirmed');
 assert.equal((await f.run('SELECT count(*)::int AS n FROM payments WHERE booking_id=$1',[b.id])).n,1);
 await reconcilePayment({...p,status:'refunded'},db);await reconcilePayment(p,db);
 assert.equal((await f.run('SELECT status FROM bookings WHERE id=$1',[b.id])).status,'refunded');
});
test('pago tardío con unidad llena requiere reembolso sin sobreventa',async()=>{
 config.mpCollector='123';const f=await fixture(2),input={tripId:f.trip.id,passengers:[{id:f.type.id,quantity:2}]};
 const b=await createBooking(f.u,input,randomUUID(),db);await f.run("UPDATE bookings SET expires_at=now()-interval '1 minute' WHERE id=$1",[b.id]);
 await createBooking(f.u,input,randomUUID(),db);
 await reconcilePayment({id:`late-${randomUUID()}`,collector_id:123,external_reference:b.id,status:'approved',currency_id:'MXN',transaction_amount:520},db);
 assert.equal((await f.run('SELECT status FROM bookings WHERE id=$1',[b.id])).status,'refund_required');
 assert.equal((await f.run("SELECT COALESCE(sum(passengers),0)::int AS n FROM bookings WHERE trip_id=$1 AND status='confirmed'",[f.trip.id])).n,0);
});
