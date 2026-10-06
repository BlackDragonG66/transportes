import { randomUUID, randomInt, createHash } from "node:crypto";
import { z } from "zod";
import { uuid } from "./domain.js";
import { pool, transaction, one, fail } from "./db.js";
import { demoScope, isDemo } from "./demo.js";
import { notify } from "./bookings.js";
import { config } from "./config.js";

const cents = z.number().int().min(0).max(100000000);
export const parcelSettingsInput = z
  .object({
    base_cents: cents.min(1),
    included_grams: z.number().int().min(1).max(30000),
    extra_kg_cents: cents,
    max_grams: z.number().int().min(1).max(30000),
    max_side_cm: z.number().int().min(1).max(100),
    max_declared_cents: cents,
  })
  .strict();
export const parcelInput = z
  .object({
    tripId: uuid,
    customerId: uuid.optional(),
    senderName: z.string().trim().min(3).max(120),
    senderPhone: z.string().trim().min(8).max(25),
    recipientName: z.string().trim().min(3).max(120),
    recipientPhone: z.string().trim().min(8).max(25),
    description: z.string().trim().min(3).max(250),
    grams: z.number().int().min(1).max(30000),
    lengthCm: z.number().int().min(1).max(100),
    widthCm: z.number().int().min(1).max(100),
    heightCm: z.number().int().min(1).max(100),
    declaredCents: cents,
  })
  .strict();
export async function parcelSettings(db = pool) {
  return one(db, "SELECT * FROM parcel_settings WHERE id=1");
}
export function quoteParcel(v, settings) {
  if (
    v.grams > settings.max_grams ||
    Math.max(v.lengthCm, v.widthCm, v.heightCm) > settings.max_side_cm ||
    v.declaredCents > settings.max_declared_cents
  )
    fail("El paquete excede los límites del servicio. Contacta a taquilla.");
  const price =
    settings.base_cents +
    Math.ceil(Math.max(0, v.grams - settings.included_grams) / 1000) *
      settings.extra_kg_cents;
  if (price > 2147483647) fail("Importe fuera de rango.");
  return price;
}
export function privateParcel(p, actor, receipt = false) {
  const { pickup_code, ...safe } = p;
  return {
    ...safe,
    ...(actor.role === "admin" || p.user_id === actor.id || receipt
      ? { pickup_code }
      : {}),
  };
}
async function event(c, p, status, actor) {
  await c.query(
    "INSERT INTO parcel_events(parcel_id,status,actor_id) VALUES($1,$2,$3)",
    [p.id, status, actor.id],
  );
  await notify(
    c,
    p.user_id,
    `${p.is_demo ? "DEMO · " : ""}Paquetería ConexionES`,
    `Tu envío ${p.id.slice(0, 8)}: ${{ reserved: "por recibir en taquilla", received: "recibido y pagado", loaded: "cargado en unidad", in_transit: "en camino", arrived: "listo para recoger", delivered: "entregado", cancelled: "cancelado" }[status]}.`,
    `${config.appUrl}/#parcels`,
    `parcel:${p.id}:${status}`,
  );
}
export async function reserveParcel(actor, raw, key, db = pool) {
  const v = parcelInput.parse(raw);
  uuid.parse(key);
  if (v.customerId && !["cashier", "admin"].includes(actor.role))
    fail("No puedes registrar envíos para otra persona.", 403);
  const user = v.customerId || actor.id,
    hash = createHash("sha256").update(JSON.stringify(v)).digest("hex");
  return transaction(async (c) => {
    await c.query(
      "INSERT INTO parcel_keys VALUES($1,$2) ON DUPLICATE KEY UPDATE actor_id=actor_id",
      [actor.id, key],
    );
    const old = await one(
      c,
      "SELECT * FROM parcels WHERE created_by=$1 AND idempotency_key=$2",
      [actor.id, key],
    );
    if (old) {
      if (old.request_hash !== hash)
        fail("La clave pertenece a otro envío.", 409);
      return privateParcel(old, actor, true);
    }
    const t = await one(c, "SELECT * FROM trips WHERE id=$1 FOR UPDATE", [
      v.tripId,
    ]);
    if (
      !t ||
      t.status !== "scheduled" ||
      new Date(t.departure_at) <= new Date()
    )
      fail("Salida no disponible.", 409);
    if (
      !(await one(c, "SELECT id FROM users WHERE id=$1 AND role='customer'", [
        user,
      ]))
    )
      fail("Selecciona un cliente.", 400);
    const demo = await demoScope(c, actor, t, user);
    const cargo = await one(c, "SELECT * FROM trip_cargo WHERE trip_id=$1", [
      t.id,
    ]);
    // Cargo is opt-in for existing real trips. Seat capacity is never used for packages.
    if (!cargo || !cargo.max_packages || !cargo.max_grams)
      fail("Esta salida no acepta paquetería.", 409);
    const used = await one(
      c,
      "SELECT count(*) AS n,COALESCE(sum(grams),0) AS grams FROM parcels WHERE trip_id=$1 AND status<>'cancelled' AND (status<>'reserved' OR expires_at>now())",
      [t.id],
    );
    if (
      used.n + 1 > cargo.max_packages ||
      used.grams + v.grams > cargo.max_grams
    )
      fail("La capacidad de carga está agotada.", 409);
    const total = quoteParcel(v, await parcelSettings(c));
    const id = randomUUID(),
      token = randomUUID(),
      pickup = String(randomInt(100000, 1000000));
    await c.query(
      `INSERT INTO parcels(id,trip_id,user_id,created_by,sender_name,sender_phone,recipient_name,recipient_phone,description,grams,length_cm,width_cm,height_cm,declared_cents,total_cents,is_demo,expires_at,tracking_token,pickup_code,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,LEAST(DATE_ADD(now(3),INTERVAL 60 MINUTE),$17),$18,$19,$20,$21)`,
      [
        id,
        t.id,
        user,
        actor.id,
        v.senderName,
        v.senderPhone,
        v.recipientName,
        v.recipientPhone,
        v.description,
        v.grams,
        v.lengthCm,
        v.widthCm,
        v.heightCm,
        v.declaredCents,
        total,
        demo,
        t.departure_at,
        token,
        pickup,
        key,
        hash,
      ],
    );
    const p = await one(c, "SELECT * FROM parcels WHERE id=$1", [id]);
    await event(c, p, "reserved", actor);
    return privateParcel(p, actor, true);
  }, db);
}
export async function parcelAction(actor, id, raw, db = pool) {
  uuid.parse(id);
  const v = z
    .object({
      action: z.enum(["receive", "load", "deliver", "cancel", "demo-receive"]),
      cashSessionId: uuid.optional(),
      pickupCode: z
        .string()
        .regex(/^\d{6}$/)
        .optional(),
    })
    .strict()
    .parse(raw);
  return transaction(async (c) => {
    let cash;
    if (v.action === "receive") {
      if (!["cashier", "admin"].includes(actor.role) || !v.cashSessionId)
        fail("Abre tu caja para recibir y cobrar.", 403);
      cash = await one(
        c,
        "SELECT * FROM cash_sessions WHERE id=$1 FOR UPDATE",
        [v.cashSessionId],
      );
      if (!cash || cash.closed_at || cash.cashier_id !== actor.id)
        fail("Caja no disponible.", 409);
    }
    const lookup = await one(c, "SELECT trip_id FROM parcels WHERE id=$1", [
      id,
    ]);
    if (!lookup) fail("Envío inexistente.", 404);
    const t = await one(
      c,
      "SELECT t.*,d.user_id AS driver_user FROM trips t JOIN drivers d ON d.id=t.driver_id WHERE t.id=$1 FOR UPDATE",
      [lookup.trip_id],
    );
    const p = await one(c, "SELECT * FROM parcels WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    let status;
    if (v.action === "receive" || v.action === "demo-receive") {
      if (
        p.status !== "reserved" ||
        new Date(p.expires_at) <= new Date() ||
        t.status !== "scheduled" ||
        new Date(t.departure_at) <= new Date()
      )
        fail("La recepción ya no está disponible.", 409);
      if (v.action === "demo-receive") {
        if (
          !p.is_demo ||
          p.user_id !== actor.id ||
          !(await isDemo(c, "user", actor.id))
        )
          fail("Recepción simulada no permitida.", 403);
      } else await demoScope(c, actor, t, p.user_id, cash);
      status = "received";
      await c.query(
        "UPDATE parcels SET paid_at=now(3),cash_session_id=$2 WHERE id=$1",
        [id, cash?.id || null],
      );
    } else if (v.action === "load") {
      if (actor.role !== "admin")
        fail("La administración registra la carga de la unidad.", 403);
      if (p.status !== "received" || t.status !== "boarding")
        fail("Inicia el abordaje para cargar este paquete.", 409);
      status = "loaded";
    } else if (v.action === "deliver") {
      if (!["cashier", "admin"].includes(actor.role))
        fail("La entrega corresponde a taquilla.", 403);
      if (p.status !== "arrived" || t.status !== "arrived")
        fail("El envío aún no llegó.", 409);
      if (v.pickupCode !== p.pickup_code)
        fail("Código de entrega incorrecto.", 400);
      status = "delivered";
    } else {
      if (p.user_id !== actor.id && actor.role !== "admin")
        fail("Envío no disponible.", 403);
      if (p.status !== "reserved")
        fail("Solo puedes cancelar una solicitud sin recibir ni cobrar.", 409);
      status = "cancelled";
    }
    await c.query(
      "UPDATE parcels SET status=$2,updated_at=now(3) WHERE id=$1",
      [id, status],
    );
    await event(c, p, status, actor);
    return privateParcel(
      await one(c, "SELECT * FROM parcels WHERE id=$1", [id]),
      actor,
    );
  }, db);
}
export async function advanceCargo(c, t, status, actor) {
  if (
    status === "en_route" &&
    (await one(
      c,
      "SELECT id FROM parcels WHERE trip_id=$1 AND status='received' LIMIT 1",
      [t.id],
    ))
  )
    fail("Carga todos los paquetes recibidos antes de salir.", 409);
  const from =
    status === "en_route"
      ? "loaded"
      : status === "arrived"
        ? "in_transit"
        : null;
  const to = status === "en_route" ? "in_transit" : "arrived";
  if (!from) return;
  const rows = (
    await c.query(
      "SELECT * FROM parcels WHERE trip_id=$1 AND status=$2 FOR UPDATE",
      [t.id, from],
    )
  ).rows;
  for (const p of rows) {
    await c.query(
      "UPDATE parcels SET status=$2,updated_at=now(3) WHERE id=$1",
      [p.id, to],
    );
    await event(c, p, to, actor);
  }
}
