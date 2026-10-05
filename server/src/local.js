import { pool, transaction, one, fail, insert } from "./db.js";
import { notify } from "./bookings.js";
import { config } from "./config.js";
import { isDemo } from "./demo.js";
import { uuid, rapidInput, splitLocal } from "./domain.js";
import { coversArrival } from "./local-cities.js";
export async function requestLastMile(actor, bookingId, raw, db = pool) {
  uuid.parse(bookingId);
  const v = rapidInput.parse(raw);
  return transaction(async (c) => {
    const lookup = await one(c, "SELECT trip_id FROM bookings WHERE id=$1", [
      bookingId,
    ]);
    if (!lookup) fail("Boleto inexistente.", 404);
    const t = await one(c, "SELECT * FROM trips WHERE id=$1 FOR UPDATE", [
      lookup.trip_id,
    ]);
    const b = await one(c, "SELECT * FROM bookings WHERE id=$1 FOR UPDATE", [
      bookingId,
    ]);
    if (
      b.user_id !== actor.id &&
      b.created_by !== actor.id &&
      actor.role !== "admin"
    )
      fail("Boleto inexistente.", 404);
    if (b.status !== "confirmed")
      fail("Confirma el pago de tu boleto antes de solicitar un auto.", 409);
    const existing = await one(
      c,
      "SELECT * FROM last_mile_requests WHERE booking_id=$1",
      [b.id],
    );
    if (existing) {
      if (
        existing.zone !== v.zone ||
        existing.passengers !== v.passengers ||
        existing.luggage !== v.luggage ||
        existing.vehicle_count !== v.vehicles
      )
        fail("Este boleto ya tiene una solicitud de auto.", 409);
      return existing;
    }
    if (
      ["cancelled", "arrived"].includes(t.status) ||
      new Date(t.arrival_at) <= new Date()
    )
      fail("El viaje ya finalizó o no está disponible.", 409);
    if (v.passengers > b.passengers)
      fail("El auto no puede llevar más pasajeros que tu boleto.");
    const request = await insert(c, "last_mile_requests", {
      booking_id: b.id,
      zone: v.zone,
      passengers: v.passengers,
      luggage: v.luggage,
      vehicle_count: v.vehicles,
    });
    for (const job of splitLocal(v.passengers, v.luggage, v.vehicles))
      await c.query(
        "INSERT INTO local_jobs(request_id,passengers,luggage) VALUES($1,$2,$3)",
        [request.id, job.passengers, job.luggage],
      );
    await c.query(
      "INSERT INTO audit_log(actor_id,action,entity_id) VALUES($1,'local.requested',$2)",
      [actor.id, request.id],
    );
    return request;
  }, db);
}
export async function acceptLocal(actor, jobId, fleetId, db = pool) {
  uuid.parse(jobId);
  uuid.parse(fleetId);
  return transaction(async (c) => {
    const lookup = await one(
      c,
      "SELECT r.booking_id FROM local_jobs j JOIN last_mile_requests r ON r.id=j.request_id WHERE j.id=$1",
      [jobId],
    );
    if (!lookup) fail("Solicitud inexistente.", 404);
    // Same booking lock used by reversals; prevents assignment after refund.
    const b = await one(c, "SELECT * FROM bookings WHERE id=$1 FOR UPDATE", [
      lookup.booking_id,
    ]);
    if (b.status !== "confirmed") fail("Reserva no confirmada.", 409);
    // Serialize the driver's acceptances even across different bookings or cars.
    await c.query("SELECT id FROM drivers WHERE user_id=$1 FOR UPDATE", [
      actor.id,
    ]);
    await c.query("SELECT id FROM local_fleet WHERE id=$1 FOR UPDATE", [
      fleetId,
    ]);
    const fleet = await one(
      c,
      `SELECT f.*,u.name,u.phone,u.email,d.photo_url FROM local_fleet f JOIN drivers d ON d.id=f.driver_id JOIN users u ON u.id=d.user_id WHERE f.id=$1 AND d.user_id=$2 AND f.active AND d.active`,
      [fleetId, actor.id],
    );
    if (!fleet) fail("Vehículo no disponible.", 403);
    if (
      (await isDemo(c, "fleet", fleet.id)) !==
      (await isDemo(c, "trip", b.trip_id))
    )
      fail("Los autos DEMO solo atienden salidas de demostración.", 409);
    await c.query("SELECT id FROM local_jobs WHERE id=$1 FOR UPDATE", [jobId]);
    const job = await one(
      c,
      `SELECT j.*,r.zone,t.arrival_at,rt.destination FROM local_jobs j JOIN last_mile_requests r ON r.id=j.request_id JOIN bookings b ON b.id=r.booking_id JOIN trips t ON t.id=b.trip_id JOIN routes rt ON rt.id=t.route_id WHERE j.id=$1`,
      [jobId],
    );
    if (job.status !== "waiting")
      fail("Otro conductor ya aceptó el viaje.", 409);
    if (
      job.passengers > fleet.capacity ||
      job.luggage > fleet.luggage_capacity ||
      !coversArrival(fleet.city, job.destination)
    )
      fail("El vehículo no cubre la ciudad, pasajeros o maletas.", 409);
    if (
      await one(
        c,
        "SELECT job_id FROM local_arrival_assignments WHERE trip_id=$1 AND driver_id=$2",
        [b.trip_id, fleet.driver_id],
      )
    )
      fail(
        "Ya aceptaste un viaje de esta llegada. Podrás aceptar otro de una llegada diferente.",
        409,
      );
    await c.query(
      "INSERT INTO local_arrival_assignments(trip_id,driver_id,job_id) VALUES($1,$2,$3)",
      [b.trip_id, fleet.driver_id, job.id],
    );
    await c.query(
      "UPDATE local_jobs SET fleet_id=$2,status='accepted',accepted_at=now(3) WHERE id=$1",
      [jobId, fleetId],
    );
    const updated = await one(c, "SELECT * FROM local_jobs WHERE id=$1", [
      jobId,
    ]);
    const customer = await one(c, "SELECT name,phone FROM users WHERE id=$1", [
      b.user_id,
    ]);
    await notify(
      c,
      b.user_id,
      "Chofer de Viaje Rápido asignado",
      `${fleet.name}, teléfono ${fleet.phone}. ${fleet.model}, placas ${fleet.plate}. Zona ${job.zone}.`,
      `${config.appUrl}/ticket/${b.ticket_token}`,
      `local-customer:${job.id}`,
    );
    await notify(
      c,
      actor.id,
      "Viaje Rápido aceptado",
      `Cliente: ${customer.name}, teléfono ${customer.phone}. Zona: ${job.zone}. ${job.passengers} pasajeros, ${job.luggage} maletas. Llegada: ${new Date(job.arrival_at).toISOString()}.`,
      `${config.appUrl}/`,
      `local-driver:${job.id}`,
    );
    return updated;
  }, db);
}
