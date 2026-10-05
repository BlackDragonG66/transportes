import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './helpers.js';
import {insert,pool,one} from '../src/db.js';
import {notify} from '../src/bookings.js';
import {dispatchNotifications} from '../src/notifications.js';
let db;
before(async()=>{db=await testDatabase();await db.query('DELETE FROM notification_outbox');});
after(async()=>{await db?.end();await pool.end();});
test('correo desactivado conserva mensajes sin conexión SMTP; se entrega después de activarlo',async()=>{
 const original={...process.env};let calls=0;
 const channels={email:async()=>{calls++;},push:async()=>{throw new Error('No debe enviar push.');}};
 try{
  process.env.EMAIL_ENABLED='false';process.env.VAPID_PUBLIC_KEY='';process.env.VAPID_PRIVATE_KEY='';
  const u=await insert(db,'users',{name:'Correo pendiente',email:`${randomUUID()}@example.com`,phone:'4431234567',password_hash:'test'});
  await notify(db,u.id,'Tu boleto ConexionES','Boleto confirmado','https://conexiones.example/ticket/test',`pending:${u.id}`);
  await dispatchNotifications(db,channels);
  let n=await one(db,'SELECT * FROM notification_outbox WHERE user_id=$1',[u.id]);
  assert.equal(calls,0);assert.equal(n.email_sent_at,null);assert.equal(n.push_sent_at,null);assert.equal(n.attempts,0);
  Object.assign(process.env,{EMAIL_ENABLED:'true',SMTP_HOST:'smtp.example.com',SMTP_USER:'test',SMTP_PASS:'test',MAIL_FROM:'test@example.com'});
  await dispatchNotifications(db,channels);
  n=await one(db,'SELECT * FROM notification_outbox WHERE user_id=$1',[u.id]);assert.equal(calls,1);assert(n.email_sent_at);assert.equal(n.push_sent_at,null);
  await dispatchNotifications(db,channels);assert.equal(calls,1);
 }finally{for(const key of ['EMAIL_ENABLED','SMTP_HOST','SMTP_USER','SMTP_PASS','MAIL_FROM','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY']){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}}
});
