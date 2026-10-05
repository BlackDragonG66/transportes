import { createHash } from "node:crypto";
import { bookingInput, calculateTotal, uuid } from "./domain.js";
import { transaction, one, fail, pool, insert } from "./db.js";
import { config, integrationStatus } from "./config.js";
export async function notify(c, userId, title, body, url, key) {
  await c.query(
    "INSERT INTO notification_outbox(user_id,title,body,url,event_key) VALUES($1,$2,$3,$4,$5) ON DUPLICATE KEY UPDATE event_key=event_key",
    [userId, title, body, url, key],
  );
}
export async function ticketNotification(c, b) {
  await notify(
    c,
    b.user_id,
    "Tu boleto ConexionES",
    `Reserva ${b.id} confirmada. ${b.passengers} pasajero(s). Total $${(b.total_cents / 100).toFixed(2)} MXN.`,
    `${config.appUrl}/ticket/${b.ticket_token}`,
    `ticket:${b.id}`,
  );
}
export async function createBooking(actor, raw, key, db = pool) {
  const input = bookingInput.parse(raw);
  uuid.parse(key);
  if (input.channel === "pos" && !["cashier", "admin"].includes(actor.role))
    fail("Acceso a taquilla requerido.", 403);
  if (input.channel === "web" && !integrationStatus().payments)
    fail(
      "Los pagos online están pendientes de configuración. Puedes reservar en taquilla.",
      503,
    );
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return transaction(async (c) => {
    // Same key serializes before capacity, including requests on different trips.
    await c.query(
      "INSERT INTO booking_keys(actor_id,idempotency_key) VALUES($1,$2) ON DUPLICATE KEY UPDATE actor_id=actor_id",
      [actor.id, key],
    );
    const old = await one(
      c,
      "SELECT * FROM bookings WHERE created_by=$1 AND idempotency_key=$2",
      [actor.id, key],
    );
    if (old) {
      if (old.request_hash !== hash)
        fail("La clave de idempotencia corresponde a otra solicitud.", 409);
      return old;
    }
    let cash;
    if (input.channel === "pos") {
      cash = await one(
        c,
        "SELECT * FROM cash_sessions WHERE id=$1 FOR UPDATE",
        [input.cashSessionId],
      );
      if (!cash || cash.closed_at || cash.cashier_id !== actor.id)
        fail("La caja no está abierta para este cajero.", 409);
    }
    const trip = await one(c, "SELECT * FROM trips WHERE id=$1 FOR UPDATE", [
      input.tripId,
    ]);
    if (
      !trip ||
      trip.status !== "scheduled" ||
      new Date(trip.departure_at) <= new Date()
    )
      fail("Viaje no disponible.", 409);
    await c.query(
      "UPDATE bookings SET status='expired' WHERE trip_id=$1 AND status='pending' AND expires_at<=now()",
      [trip.id],
    );
    const userId = input.channel === "pos" ? input.customerId : actor.id;
    if (!(await one(c, "SELECT id FROM users WHERE id=$1", [userId])))
      fail("Cliente inexistente.", 404);
    const passengers = [];
    for (const p of input.passengers) {
      const fare = await one(
        c,
        "SELECT price_cents FROM fares WHERE route_id=$1 AND passenger_type_id=$2",
        [trip.route_id, p.id],
      );
      if (!fare) fail("Tarifa no disponible.");
      passengers.push({ ...p, unit_cents: fare.price_cents });
    }
    const addons = [];
    for (const a of input.addons) {
      const addon = await one(
        c,
        "SELECT price_cents FROM addons WHERE id=$1 AND active",
        [a.id],
      );
      if (!addon) fail("Complemento no disponible.");
      addons.push({ ...a, unit_cents: addon.price_cents });
    }
    const total = calculateTotal(passengers, addons, input.channel);
    const occupied = await one(
      c,
      "SELECT COALESCE(sum(passengers),0) AS n FROM bookings WHERE trip_id=$1 AND (status='confirmed' OR (status='pending' AND expires_at>now()))",
      [trip.id],
    );
    if (total.count + occupied.n > trip.capacity)
      fail("No hay suficientes lugares disponibles.", 409);
    const expiration = await one(
      c,
      "SELECT LEAST(DATE_ADD(now(3),INTERVAL 15 MINUTE),$1) AS expires_at",
      [trip.departure_at],
    );
    const b = await insert(c, "bookings", {
      trip_id: trip.id,
      user_id: userId,
      channel: input.channel,
      cash_session_id: cash?.id || null,
      status: input.channel === "pos" ? "confirmed" : "pending",
      passengers: total.count,
      fare_cents: total.fareCents,
      addon_cents: total.addonCents,
      fee_cents: total.feeCents,
      total_cents: total.totalCents,
      expires_at: expiration.expires_at,
      idempotency_key: key,
      request_hash: hash,
      created_by: actor.id,
    });
    for (const p of passengers)
      await c.query("INSERT INTO booking_passengers VALUES($1,$2,$3,$4)", [
        b.id,
        p.id,
        p.quantity,
        p.unit_cents,
      ]);
    for (const a of addons)
      await c.query("INSERT INTO booking_addons VALUES($1,$2,$3,$4)", [
        b.id,
        a.id,
        a.quantity,
        a.unit_cents,
      ]);
    for (const [position, t] of input.travelers.entries())
      await c.query(
        "INSERT INTO booking_travelers(booking_id,position,full_name,passenger_type_id) VALUES($1,$2,$3,$4)",
        [b.id, position + 1, t.name, t.passengerTypeId],
      );
    if (input.channel === "pos") {
      await c.query(
        "INSERT INTO payments(booking_id,provider,status,amount_cents) VALUES($1,'cash','approved',$2)",
        [b.id, b.total_cents],
      );
      await ticketNotification(c, b);
    }
    await c.query(
      "INSERT INTO audit_log(actor_id,action,entity_id) VALUES($1,'booking.created',$2)",
      [actor.id, b.id],
    );
    return b;
  }, db);
}
export async function expireBookings(db = pool) {
  const trips = (
    await db.query(
      "SELECT DISTINCT trip_id FROM bookings WHERE status='pending' AND expires_at<=now()",
    )
  ).rows;
  for (const t of trips)
    await transaction(async (c) => {
      await c.query("SELECT id FROM trips WHERE id=$1 FOR UPDATE", [t.trip_id]);
      await c.query(
        "UPDATE bookings SET status='expired' WHERE trip_id=$1 AND status='pending' AND expires_at<=now()",
        [t.trip_id],
      );
    }, db);
}
