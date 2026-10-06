import { z } from "zod";
import QRCode from "qrcode";
import { pool, one, transaction, fail } from "./db.js";
import { config } from "./config.js";
import { uuid } from "./domain.js";

export const localVehicleInput = z
  .object({
    brand: z.string().trim().min(2).max(80),
    model: z.string().trim().min(2).max(120),
    vehicle_year: z
      .number()
      .int()
      .min(1990)
      .max(new Date().getUTCFullYear() + 1),
    color: z.string().trim().min(2).max(40),
    service_type: z.enum(["taxi", "uber"]),
    plate: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .transform((s) => s.toUpperCase()),
    capacity: z.number().int().min(1).max(4),
    luggage_capacity: z.number().int().min(0).max(30),
  })
  .strict();

// Earlier records stored brand, year, color and service in one description.
export function localDetails(row) {
  const legacy = row.model.match(
    /^(\S+)\s+(.+?)\s+(\d{4})\s*·\s*([^·]+)\s*·\s*(Taxi|Uber)$/i,
  );
  return {
    brand: row.detail_brand ?? legacy?.[1] ?? "",
    model: row.detail_model ?? legacy?.[2] ?? row.model,
    vehicle_year: row.vehicle_year ?? (legacy ? Number(legacy[3]) : null),
    color: row.color ?? legacy?.[4]?.trim() ?? "",
    service_type: row.service_type ?? legacy?.[5]?.toLowerCase() ?? "taxi",
  };
}

export async function ensureLocalProfiles(db, actor = null) {
  await db.query(
    `INSERT IGNORE INTO local_vehicle_profiles(fleet_id) SELECT f.id FROM local_fleet f JOIN drivers d ON d.id=f.driver_id WHERE ($1=1 OR d.user_id=$2)`,
    [actor === null || actor.role === "admin" ? 1 : 0, actor?.id ?? null],
  );
}

const localSelect = `SELECT f.*,p.public_token,p.brand AS detail_brand,p.model AS detail_model,p.vehicle_year,p.color,p.service_type,p.updated_at,u.name AS driver_name,d.photo_url,d.user_id,d.active AS driver_active,EXISTS(SELECT 1 FROM local_jobs j WHERE j.fleet_id=f.id AND j.status='accepted') AS busy,EXISTS(SELECT 1 FROM demo_entities de WHERE de.kind='fleet' AND de.entity_id=f.id) AS demo,(SELECT AVG(r.rating) FROM trip_reviews r WHERE r.driver_id=d.id AND r.segment='local') AS rating_average,(SELECT COUNT(*) FROM trip_reviews r WHERE r.driver_id=d.id AND r.segment='local') AS rating_count FROM local_fleet f JOIN drivers d ON d.id=f.driver_id JOIN users u ON u.id=d.user_id JOIN local_vehicle_profiles p ON p.fleet_id=f.id`;

async function withQr(car, path) {
  const publicUrl = `${config.appUrl}${path}/${car.public_token}`;
  return {
    ...car,
    publicUrl,
    qr: await QRCode.toDataURL(publicUrl, {
      width: 720,
      margin: 2,
      errorCorrectionLevel: "M",
    }),
  };
}

export async function staffVehicles(actor, db = pool) {
  await ensureLocalProfiles(db, actor);
  const locals = (
    await db.query(
      `${localSelect} WHERE ($1=1 OR d.user_id=$2) ORDER BY f.city,f.plate`,
      [actor.role === "admin" ? 1 : 0, actor.id],
    )
  ).rows;
  const units = (
    await db.query(
      `SELECT v.* FROM vehicles v WHERE ($1=1 OR EXISTS(SELECT 1 FROM trips t JOIN drivers d ON d.id=t.driver_id WHERE t.vehicle_id=v.id AND d.user_id=$2)) ORDER BY v.plate`,
      [actor.role === "admin" ? 1 : 0, actor.id],
    )
  ).rows;
  return {
    local: await Promise.all(
      locals.map((f) =>
        withQr(
          {
            ...f,
            ...localDetails(f),
            owned: f.user_id === actor.id,
            editable: Boolean(f.active && f.driver_active && !f.busy),
          },
          "/taxi",
        ),
      ),
    ),
    units: await Promise.all(units.map((v) => withQr(v, "/vehicle"))),
  };
}

export async function updateLocalVehicle(actor, fleetId, input, db = pool) {
  uuid.parse(fleetId);
  const v = localVehicleInput.parse(input);
  await transaction(async (c) => {
    const fleet = await one(
      c,
      "SELECT driver_id FROM local_fleet WHERE id=$1",
      [fleetId],
    );
    if (!fleet) fail("Unidad inexistente.", 404);
    // Same driver -> fleet lock order as acceptance; identity cannot change mid-assignment.
    const driver = await one(
      c,
      "SELECT * FROM drivers WHERE id=$1 FOR UPDATE",
      [fleet.driver_id],
    );
    const f = await one(c, "SELECT * FROM local_fleet WHERE id=$1 FOR UPDATE", [
      fleetId,
    ]);
    if (f.driver_id !== driver.id)
      fail("La asignación de la unidad cambió. Actualiza el panel.", 409);
    if (actor.role !== "admin" && driver.user_id !== actor.id)
      fail("Esta unidad corresponde a otro conductor.", 403);
    if (!f.active || !driver.active)
      fail("La unidad o conductor están inactivos.", 409);
    if (
      await one(
        c,
        "SELECT id FROM local_jobs WHERE fleet_id=$1 AND status='accepted'",
        [fleetId],
      )
    )
      fail("Finaliza tu traslado aceptado antes de modificar la unidad.", 409);
    const description = `${v.brand} ${v.model} ${v.vehicle_year} · ${v.color} · ${v.service_type === "uber" ? "Uber" : "Taxi"}`;
    if (description.length > 120)
      fail(
        "La descripción completa de la unidad no puede superar 120 caracteres.",
      );
    await c.query(
      "UPDATE local_fleet SET plate=$2,model=$3,capacity=$4,luggage_capacity=$5 WHERE id=$1",
      [fleetId, v.plate, description, v.capacity, v.luggage_capacity],
    );
    await c.query(
      `INSERT INTO local_vehicle_profiles(fleet_id,brand,model,vehicle_year,color,service_type) VALUES($1,$2,$3,$4,$5,$6) ON DUPLICATE KEY UPDATE brand=VALUES(brand),model=VALUES(model),vehicle_year=VALUES(vehicle_year),color=VALUES(color),service_type=VALUES(service_type),updated_at=now(3)`,
      [fleetId, v.brand, v.model, v.vehicle_year, v.color, v.service_type],
    );
    await c.query(
      "INSERT INTO audit_log(actor_id,action,entity_id) VALUES($1,'local.vehicle.updated',$2)",
      [actor.id, fleetId],
    );
  }, db);
  return (await staffVehicles(actor, db)).local.find((f) => f.id === fleetId);
}

export async function publicLocalVehicle(token, db = pool) {
  uuid.parse(token);
  const f = await one(
    db,
    `${localSelect} WHERE p.public_token=$1 AND f.active AND d.active`,
    [token],
  );
  if (!f) fail("Esta unidad no está disponible o el QR es inválido.", 404);
  // Only identity is public: no passengers, phone, email, license, trips or zones.
  return {
    ...localDetails(f),
    plate: f.plate,
    city: f.city,
    capacity: f.capacity,
    luggage_capacity: f.luggage_capacity,
    driver_name: f.driver_name,
    photo_url: f.photo_url,
    demo: Boolean(f.demo),
    rating_average: f.rating_average,
    rating_count: f.rating_count,
  };
}
