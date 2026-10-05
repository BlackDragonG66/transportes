import { createHmac,timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { pool,transaction,one,fail } from './db.js';
import { ticketNotification,notify } from './bookings.js';
export async function mpRequest(path,options={}) {
 if(!config.mpToken) fail('Mercado Pago no está configurado.',503);
 const response=await fetch(`https://api.mercadopago.com${path}`,{...options,signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${config.mpToken}`,'Content-Type':'application/json',...options.headers}});
 if(!response.ok) fail('Mercado Pago no pudo procesar la operación.',502);
 return response.json();
}
export async function createPreference(actor,bookingId,db=pool) {
 // Persist and serialize retries; totals come exclusively from the priced booking.
 return transaction(async c=>{
  const b=await one(c,'SELECT * FROM bookings WHERE id=$1 FOR UPDATE',[bookingId]);
  if(!b || b.user_id!==actor.id) fail('Reserva inexistente.',404);
  if(b.channel!=='web'||b.status!=='pending'||new Date(b.expires_at)<=new Date()) fail('Reserva no pagable.',409);
  const existing=await one(c,'SELECT * FROM payment_preferences WHERE booking_id=$1',[b.id]);if(existing)return existing;
  const u=await one(c,'SELECT email FROM users WHERE id=$1',[b.user_id]);
  const start=new Date().toISOString();
  const preference=await mpRequest('/checkout/preferences',{method:'POST',headers:{'X-Idempotency-Key':b.id},body:JSON.stringify({
   items:[{id:b.id,title:`ConexionES · ${b.passengers} pasajero(s)`,quantity:1,currency_id:'MXN',unit_price:b.total_cents/100}],
   payer:{email:u.email},external_reference:b.id,notification_url:`${config.apiUrl}/api/payments/webhook`,
   back_urls:{success:`${config.appUrl}/ticket/${b.ticket_token}`,failure:`${config.appUrl}/ticket/${b.ticket_token}`,pending:`${config.appUrl}/ticket/${b.ticket_token}`},
   ...(config.appUrl.startsWith('https://')?{auto_return:'approved'}:{}),
   expires:true,expiration_date_from:start,expiration_date_to:new Date(b.expires_at).toISOString(),
   payment_methods:{excluded_payment_types:[{id:'ticket'},{id:'atm'},{id:'bank_transfer'}]},binary_mode:true
  })});
  return one(c,'INSERT INTO payment_preferences(booking_id,provider_id,checkout_url) VALUES($1,$2,$3) RETURNING *',[b.id,preference.id,preference.init_point]);
 },db);
}
export function validSignature(id,requestId,header,secret=config.mpSecret) {
 // https://www.mercadopago.com.mx/developers/en/docs/checkout-pro-preferences/payment-notifications
 if(!secret||!id||!requestId||!header)return false;
 const parts=Object.fromEntries(header.split(',').map(x=>x.trim().split('=')));
 if(!/^\d+$/.test(parts.ts||'')||! /^[a-f0-9]{64}$/i.test(parts.v1||''))return false;
 const manifest=`id:${String(id).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
 const expected=createHmac('sha256',secret).update(manifest).digest();
 return timingSafeEqual(expected,Buffer.from(parts.v1,'hex'));
}
export async function reconcilePayment(payment,db=pool) {
 if(!config.mpCollector || String(payment.collector_id)!==config.mpCollector) fail('Receptor de pago inválido.',400);
 if(!['approved','refunded','charged_back'].includes(payment.status))return;
 return transaction(async c=>{
  const info=await one(c,'SELECT trip_id FROM bookings WHERE id=$1',[payment.external_reference]);if(!info)fail('Referencia desconocida.',400);
  const trip=await one(c,'SELECT * FROM trips WHERE id=$1 FOR UPDATE',[info.trip_id]);
  const b=await one(c,'SELECT * FROM bookings WHERE id=$1 FOR UPDATE',[payment.external_reference]);
  if(b.channel!=='web'||payment.currency_id!=='MXN'||Math.round(Number(payment.transaction_amount)*100)!==b.total_cents)fail('Importe o moneda inválidos.',400);
  const existing=await one(c,'SELECT * FROM payments WHERE provider_id=$1',[String(payment.id)]);
  if(existing && existing.booking_id!==b.id)fail('Pago asociado a otra reserva.',409);
  if(payment.status==='approved') {
   if(existing)return; // approved is monotonic: retries cannot resurrect a refund.
   const approved=await one(c,"SELECT id FROM payments WHERE booking_id=$1 AND status='approved'",[b.id]);
   if(approved) { await notify(c,b.user_id,'Pago adicional recibido','Contacta a operaciones para reembolsar el pago duplicado.',`${config.appUrl}/ticket/${b.ticket_token}`,`duplicate:${payment.id}`);return; }
   await c.query("INSERT INTO payments(booking_id,provider,provider_id,status,amount_cents) VALUES($1,'mercadopago',$2,'approved',$3)",[b.id,String(payment.id),b.total_cents]);
   const occupied=await one(c,"SELECT COALESCE(sum(passengers),0)::int AS n FROM bookings WHERE trip_id=$1 AND id<>$2 AND (status='confirmed' OR (status='pending' AND expires_at>now()))",[b.trip_id,b.id]);
   const canConfirm=['pending','expired'].includes(b.status)&&trip.status==='scheduled'&&new Date(trip.departure_at)>new Date()&&occupied.n+b.passengers<=trip.capacity;
   const updated=await one(c,'UPDATE bookings SET status=$2 WHERE id=$1 RETURNING *',[b.id,canConfirm?'confirmed':'refund_required']);
   if(canConfirm)await ticketNotification(c,updated);
   else await notify(c,b.user_id,'Pago recibido: requiere reembolso','La reserva no pudo confirmarse. Contacta a operaciones para recibir tu reembolso.',`${config.appUrl}/ticket/${b.ticket_token}`,`refund-required:${b.id}`);
  } else if(existing && existing.status==='approved') {
   await c.query('UPDATE payments SET status=$2 WHERE id=$1',[existing.id,payment.status]);
   await c.query("UPDATE bookings SET status='refunded' WHERE id=$1",[b.id]);
   await c.query("UPDATE local_jobs SET status='cancelled' WHERE request_id IN (SELECT id FROM last_mile_requests WHERE booking_id=$1)",[b.id]);
   await notify(c,b.user_id,'Reserva anulada','El pago fue reembolsado o revertido. El boleto ya no es válido.',`${config.appUrl}/ticket/${b.ticket_token}`,`reversed:${payment.id}`);
  }
 },db);
}
