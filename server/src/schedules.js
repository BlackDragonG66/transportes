import { createHash } from "node:crypto";
import { z } from "zod";
import { uuid } from "./domain.js";
import { pool, transaction, one, insert, fail } from "./db.js";

export const mexicoDay = (value = Date.now()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
export const addDays = (day, n) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
// Find the zone offset for the requested date instead of using the browser timezone.
export function mexicoInstant(day, time) {
  const wall = Date.parse(`${day}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(wall));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const shown = Date.parse(
    `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
  );
  return new Date(wall + (wall - shown));
}
const day = z.iso.date();
export const scheduleInput = z
  .object({
    routeId: uuid,
    vehicleId: uuid,
    driverId: uuid,
    startDate: day,
    endDate: day,
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    times: z
      .array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/))
      .min(1)
      .max(4),
    durationMinutes: z.number().int().min(15).max(1440),
    capacity: z.number().int().min(1).max(60),
    cargoPackages: z.number().int().min(0).max(200).default(20),
    cargoKg: z.number().int().min(0).max(1000).default(100),
  })
  .strict()
  .refine(
    (v) =>
      v.endDate >= v.startDate &&
      Date.parse(v.endDate) - Date.parse(v.startDate) <= 89 * 86400000,
    "Elige un rango de hasta 90 días.",
  );
export function expandSchedule(raw) {
  const v = scheduleInput.parse(raw),
    result = [];
  for (let d = v.startDate; d <= v.endDate; d = addDays(d, 1)) {
    if (!v.weekdays.includes(new Date(`${d}T12:00:00Z`).getUTCDay())) continue;
    for (const time of [...new Set(v.times)].sort()) {
      const departure = mexicoInstant(d, time);
      if (departure <= new Date()) fail("Todas las salidas deben ser futuras.");
      result.push({
        route_id: v.routeId,
        vehicle_id: v.vehicleId,
        driver_id: v.driverId,
        departure_at: departure,
        arrival_at: new Date(+departure + v.durationMinutes * 60000),
        capacity: v.capacity,
      });
    }
  }
  if (!result.length || result.length > 300)
    fail("Selecciona entre 1 y 300 salidas.");
  return { input: v, trips: result };
}
export async function addTrip(c, t, cargo = { packages: 20, kg: 100 }) {
  const overlap = await one(
    c,
    "SELECT id FROM trips WHERE status<>'cancelled' AND (vehicle_id=$1 OR driver_id=$2) AND departure_at<$4 AND arrival_at>$3 LIMIT 1",
    [t.vehicle_id, t.driver_id, t.departure_at, t.arrival_at],
  );
  if (overlap) fail("Conductor o unidad ocupados en ese horario.", 409);
  const row = await insert(c, "trips", t);
  await c.query("INSERT INTO trip_cargo VALUES($1,$2,$3)", [
    row.id,
    cargo.packages,
    cargo.kg * 1000,
  ]);
  return row;
}
export async function generateSchedule(actor, raw, key, db = pool) {
  uuid.parse(key);
  const { input: v, trips } = expandSchedule(raw),
    hash = createHash("sha256").update(JSON.stringify(v)).digest("hex");
  return transaction(async (c) => {
    // Lock vehicles then drivers consistently with individual departure creation.
    const vehicle = await one(
      c,
      "SELECT * FROM vehicles WHERE id=$1 AND active FOR UPDATE",
      [v.vehicleId],
    );
    const driver = await one(
      c,
      "SELECT * FROM drivers WHERE id=$1 AND active FOR UPDATE",
      [v.driverId],
    );
    if (!vehicle || v.capacity > vehicle.capacity || !driver)
      fail("Verifica unidad, conductor y capacidad.");
    const old = await one(
      c,
      "SELECT * FROM schedule_batches WHERE actor_id=$1 AND idempotency_key=$2",
      [actor.id, key],
    );
    if (old) {
      if (old.request_hash !== hash)
        fail("La clave pertenece a otra programación.", 409);
      return old.metadata;
    }
    if (
      !(await one(c, "SELECT id FROM routes WHERE id=$1 AND active", [
        v.routeId,
      ]))
    )
      fail("Ruta no disponible.");
    const demo = Boolean(
      await one(
        c,
        "SELECT entity_id FROM demo_entities WHERE (kind='vehicle' AND entity_id=$1) OR (kind='driver' AND entity_id=$2) LIMIT 1",
        [v.vehicleId, v.driverId],
      ),
    );
    const ids = [];
    for (const t of trips) {
      const row = await addTrip(c, t, {
        packages: v.cargoPackages,
        kg: v.cargoKg,
      });
      ids.push(row.id);
      if (demo)
        await c.query("INSERT INTO demo_entities VALUES($1,'trip',$2)", [
          `schedule:${row.id}`,
          row.id,
        ]);
    }
    const result = { count: ids.length, ids };
    await c.query("INSERT INTO schedule_batches VALUES($1,$2,$3,$4)", [
      actor.id,
      key,
      hash,
      JSON.stringify(result),
    ]);
    await c.query(
      "INSERT INTO audit_log(actor_id,action,entity_id,metadata) VALUES($1,'schedule.created',$2,$3)",
      [actor.id, key, JSON.stringify(result)],
    );
    return result;
  }, db);
}
