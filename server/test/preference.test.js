import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPreference} from '../src/mercadopago.js';
import {config} from '../src/config.js';
test('preferencia MP usa total persistido, MXN, vencimiento e idempotencia',async()=>{
 const original=globalThis.fetch;config.mpToken='test-token';config.appUrl='https://conexiones.example';config.apiUrl='https://conexiones.example';
 const b={id:'11111111-1111-4111-8111-111111111111',user_id:'customer',channel:'web',status:'pending',passengers:3,total_cents:68000,expires_at:new Date(Date.now()+900000),ticket_token:'token'};
 let captured,stored;
 globalThis.fetch=async(url,options)=>{captured={url,options,body:JSON.parse(options.body)};return {ok:true,json:async()=>({id:'pref-1',init_point:'https://www.mercadopago.com.mx/checkout/pref-1'})};};
 const client={release(){},query:async(sql,params)=>{
  if(sql.startsWith('SELECT * FROM bookings'))return {rows:[b]};
  if(sql.startsWith('SELECT * FROM payment_preferences'))return {rows:stored?[stored]:[]};
  if(sql.startsWith('SELECT email'))return {rows:[{email:'customer@example.com'}]};
  if(sql.startsWith('INSERT INTO payment_preferences')){stored={booking_id:params[0],provider_id:params[1],checkout_url:params[2]};return {rows:[stored]};}
  return {rows:[]};
 }};
 const db={connect:async()=>client};
 try{
  const preference=await createPreference({id:'customer'},b.id,db);
  assert.equal(preference.provider_id,'pref-1');assert.equal(captured.body.items[0].unit_price,680);assert.equal(captured.body.items[0].currency_id,'MXN');
  assert.equal(captured.options.headers['X-Idempotency-Key'],b.id);assert.equal(captured.body.external_reference,b.id);assert.equal(captured.body.expiration_date_to,b.expires_at.toISOString());
  assert.equal(captured.body.notification_url,'https://conexiones.example/api/payments/webhook');
  assert.deepEqual(await createPreference({id:'customer'},b.id,db),preference);
  await assert.rejects(createPreference({id:'other'},b.id,db),/inexistente/);
 }finally{globalThis.fetch=original;}
});
