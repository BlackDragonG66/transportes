import { createHash } from 'node:crypto';
import { bookingInput, calculateTotal, splitLocal, uuid } from './domain.js';
import { transaction,one,fail,pool } from './db.js';
import { config } from './config.js';
export async function notify(c,userId,title,body,url,key) {
 await c.query('INSERT INTO notification_outbox(user_id,title,body,url,event_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_key) DO NOTHING',[userId,title,body,url,key]);
}
export async function ticketNotification(c,b) {
 await notify(c,b.user_id,'Tu boleto ConexionES',`Reserva ${b.id} confirmada. ${b.passengers} pasajero(s). Total $${(b.total_cents/100).toFixed(2)} MXN.`,`${config.appUrl}/ticket/${b.ticket_token}`,`ticket:${b.id}`);
}
export async function createBooking(actor,raw,key,db=pool) {
 const input=bookingInput.parse(raw); uuid.parse(key);
 if(input.channel==='pos'&&!['cashier','admin'].includes(actor.role)) fail('Acceso a taquilla requerido.',403);
 const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 return transaction(async c=>{
  // Same key serializes before capacity, including requests on different trips.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${actor.id}:${key}`]);
  const old=await one(c,'SELECT * FROM bookings WHERE created_by=$1 AND idempotency_key=$2',[actor.id,key]);
  if(old) { if(old.request_hash!==hash) fail('La clave de idempotencia corresponde a otra solicitud.',409); return old; }
  let cash;
  if(input.channel==='pos') {
   cash=await one(c,'SELECT * FROM cash_sessions WHERE id=$1 FOR UPDATE',[input.cashSessionId]);
   if(!cash || cash.closed_at || cash.cashier_id!==actor.id) fail('La caja no está abierta para este cajero.',409);
  }
  const trip=await one(c,'SELECT * FROM trips WHERE id=$1 FOR UPDATE',[input.tripId]);
  if(!trip || trip.status!=='scheduled' || new Date(trip.departure_at)<=new Date()) fail('Viaje no disponible.',409);
  await c.query("UPDATE bookings SET status='expired' WHERE trip_id=$1 AND status='pending' AND expires_at<=now()",[trip.id]);
  const userId=input.channel==='pos'?input.customerId:actor.id;
  if(!await one(c,'SELECT id FROM users WHERE id=$1',[userId])) fail('Cliente inexistente.',404);
  const passengers=[];
  for(const p of input.passengers) {
   const fare=await one(c,'SELECT price_cents FROM fares WHERE route_id=$1 AND passenger_type_id=$2',[trip.route_id,p.id]);
   if(!fare) fail('Tarifa no disponible.'); passengers.push({...p,unit_cents:fare.price_cents});
  }
  const addons=[];
  for(const a of input.addons) {
   const addon=await one(c,'SELECT price_cents FROM addons WHERE id=$1 AND active',[a.id]);
   if(!addon) fail('Complemento no disponible.'); addons.push({...a,unit_cents:addon.price_cents});
  }
  const total=calculateTotal(passengers,addons,input.channel);
  const occupied=await one(c,"SELECT COALESCE(sum(passengers),0)::int AS n FROM bookings WHERE trip_id=$1 AND (status='confirmed' OR (status='pending' AND expires_at>now()))",[trip.id]);
  if(total.count+occupied.n>trip.capacity) fail('No hay suficientes lugares disponibles.',409);
  const b=await one(c,`INSERT INTO bookings(trip_id,user_id,channel,cash_session_id,status,passengers,fare_cents,addon_cents,fee_cents,total_cents,expires_at,idempotency_key,request_hash,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,LEAST(now()+interval '15 minutes',$14::timestamptz),$11,$12,$13) RETURNING *`,
   [trip.id,userId,input.channel,cash?.id||null,input.channel==='pos'?'confirmed':'pending',total.count,total.fareCents,total.addonCents,total.feeCents,total.totalCents,key,hash,actor.id,trip.departure_at]);
  for(const p of passengers) await c.query('INSERT INTO booking_passengers VALUES($1,$2,$3,$4)',[b.id,p.id,p.quantity,p.unit_cents]);
  for(const a of addons) await c.query('INSERT INTO booking_addons VALUES($1,$2,$3,$4)',[b.id,a.id,a.quantity,a.unit_cents]);
  if(input.rapid) {
   const r=input.rapid;
   const request=await one(c,'INSERT INTO last_mile_requests(booking_id,zone,passengers,luggage,vehicle_count) VALUES($1,$2,$3,$4,$5) RETURNING id',[b.id,r.zone,r.passengers,r.luggage,r.vehicles]);
   for(const job of splitLocal(r.passengers,r.luggage,r.vehicles)) await c.query('INSERT INTO local_jobs(request_id,passengers,luggage) VALUES($1,$2,$3)',[request.id,job.passengers,job.luggage]);
  }
  if(input.channel==='pos') { await c.query("INSERT INTO payments(booking_id,provider,status,amount_cents) VALUES($1,'cash','approved',$2)",[b.id,b.total_cents]); await ticketNotification(c,b); }
  await c.query("INSERT INTO audit_log(actor_id,action,entity_id) VALUES($1,'booking.created',$2)",[actor.id,b.id]);
  return b;
 },db);
}
export async function expireBookings(db=pool) {
 const trips=(await db.query("SELECT DISTINCT trip_id FROM bookings WHERE status='pending' AND expires_at<=now()")).rows;
 for(const t of trips) await transaction(async c=>{
  await c.query('SELECT id FROM trips WHERE id=$1 FOR UPDATE',[t.trip_id]);
  await c.query("UPDATE bookings SET status='expired' WHERE trip_id=$1 AND status='pending' AND expires_at<=now()",[t.trip_id]);
 },db);
}
