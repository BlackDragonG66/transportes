import { pool,transaction,one,fail } from './db.js';
import { notify } from './bookings.js';
import { config } from './config.js';
import { uuid } from './domain.js';
export async function acceptLocal(actor,jobId,fleetId,db=pool) {
 uuid.parse(jobId);uuid.parse(fleetId);
 return transaction(async c=>{
  const lookup=await one(c,'SELECT r.booking_id FROM local_jobs j JOIN last_mile_requests r ON r.id=j.request_id WHERE j.id=$1',[jobId]);
  if(!lookup)fail('Solicitud inexistente.',404);
  // Same booking lock used by reversals; prevents assignment after refund.
  const b=await one(c,'SELECT * FROM bookings WHERE id=$1 FOR UPDATE',[lookup.booking_id]);
  if(b.status!=='confirmed')fail('Reserva no confirmada.',409);
  const fleet=await one(c,`SELECT f.*,u.name,u.phone,u.email,d.photo_url FROM local_fleet f JOIN drivers d ON d.id=f.driver_id JOIN users u ON u.id=d.user_id WHERE f.id=$1 AND d.user_id=$2 AND f.active AND d.active FOR UPDATE OF f`,[fleetId,actor.id]);
  if(!fleet)fail('Vehículo no disponible.',403);
  const job=await one(c,`SELECT j.*,r.zone,t.arrival_at,rt.destination FROM local_jobs j JOIN last_mile_requests r ON r.id=j.request_id JOIN bookings b ON b.id=r.booking_id JOIN trips t ON t.id=b.trip_id JOIN routes rt ON rt.id=t.route_id WHERE j.id=$1 FOR UPDATE OF j`,[jobId]);
  if(job.status!=='waiting')fail('Otro conductor ya aceptó el viaje.',409);
  if(job.passengers>fleet.capacity||job.luggage>fleet.luggage_capacity||!job.destination.includes(fleet.city))fail('El vehículo no cubre la ciudad, pasajeros o maletas.',409);
  const updated=await one(c,"UPDATE local_jobs SET fleet_id=$2,status='accepted',accepted_at=now() WHERE id=$1 RETURNING *",[jobId,fleetId]);
  const customer=await one(c,'SELECT name,phone FROM users WHERE id=$1',[b.user_id]);
  await notify(c,b.user_id,'Chofer de Viaje Rápido asignado',`${fleet.name}, teléfono ${fleet.phone}. ${fleet.model}, placas ${fleet.plate}. Zona ${job.zone}.`,`${config.appUrl}/ticket/${b.ticket_token}`,`local-customer:${job.id}`);
  await notify(c,actor.id,'Viaje Rápido aceptado',`Cliente: ${customer.name}, teléfono ${customer.phone}. Zona: ${job.zone}. ${job.passengers} pasajeros, ${job.luggage} maletas. Llegada: ${new Date(job.arrival_at).toISOString()}.`,`${config.appUrl}/`, `local-driver:${job.id}`);
  return updated;
 },db);
}
