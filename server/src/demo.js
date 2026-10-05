import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { pool, transaction, one, insert, fail } from "./db.js";
import { uuid } from "./domain.js";
import { addDays, mexicoDay, mexicoInstant, addTrip } from "./schedules.js";
import { ticketNotification } from "./bookings.js";

export async function isDemo(db, kind, id) {
  return Boolean(
    await one(
      db,
      "SELECT entity_id FROM demo_entities WHERE kind=$1 AND entity_id=$2",
      [kind, id],
    ),
  );
}
export async function markDemo(db, key, kind, id) {
  await db.query("INSERT INTO demo_entities VALUES($1,$2,$3)", [key, kind, id]);
}
export async function demoScope(c, actor, trip, customer, cash) {
  const demo = await isDemo(c, "trip", trip.id);
  if (demo && !(await isDemo(c, "user", customer)))
    fail("Selecciona un cliente de demostración para esta salida.", 403);
  if (!demo && (await isDemo(c, "user", customer)))
    fail("Esta cuenta es de demostración; elige una salida DEMO.", 403);
  if (cash) {
    const registerDemo = await isDemo(c, "register", cash.register_id);
    if (registerDemo !== demo)
      fail("Las ventas DEMO requieren una caja de demostración.", 409);
  }
  return demo;
}
export async function payDemo(actor, id, db = pool) {
  uuid.parse(id);
  return transaction(async (c) => {
    const lookup = await one(c, "SELECT trip_id FROM bookings WHERE id=$1", [
      id,
    ]);
    if (!lookup) fail("Reserva inexistente.", 404);
    await c.query("SELECT id FROM trips WHERE id=$1 FOR UPDATE", [
      lookup.trip_id,
    ]);
    const b = await one(c, "SELECT * FROM bookings WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    if (
      b.user_id !== actor.id ||
      !(await isDemo(c, "user", actor.id)) ||
      !(await isDemo(c, "trip", b.trip_id))
    )
      fail("Pago de demostración no permitido.", 403);
    if (
      await one(c, "SELECT booking_id FROM demo_payments WHERE booking_id=$1", [
        id,
      ])
    )
      return { ...b, isDemo: true };
    if (b.status !== "pending" || new Date(b.expires_at) <= new Date())
      fail("La reserva de demostración venció.", 409);
    const t = await one(
      c,
      "SELECT status,departure_at FROM trips WHERE id=$1",
      [b.trip_id],
    );
    if (t.status !== "scheduled" || new Date(t.departure_at) <= new Date())
      fail("Salida no disponible.", 409);
    await c.query(
      "INSERT INTO demo_payments(booking_id,amount_cents,method) VALUES($1,$2,'web')",
      [id, b.total_cents],
    );
    await c.query("UPDATE bookings SET status='confirmed' WHERE id=$1", [id]);
    await ticketNotification(c, { ...b, status: "confirmed" });
    await c.query(
      "INSERT INTO audit_log(actor_id,action,entity_id) VALUES($1,'demo.payment',$2)",
      [actor.id, id],
    );
    return { ...b, status: "confirmed", isDemo: true };
  }, db);
}
const profiles = [
  ["jonathan", "Jonathan Garcia", "admin"],
  ["esmeralda", "Esmeralda", "cashier"],
  ["carlos", "Carlos Mendoza", "driver"],
  ["maria", "María Hernández", "driver"],
  ["raul", "Raúl Torres", "driver"],
  ["patricia", "Patricia López", "driver"],
  ["gabriel", "Gabriel Guzman Rodriguez", "driver"],
  ["lucia", "Lucía Ramírez", "driver"],
  ["roberto", "Roberto Vega", "driver"],
  ["diana", "Diana Flores", "driver"],
  ["ana", "Ana Martínez", "customer"],
  ["luis", "Luis Sánchez", "customer"],
];
export async function demoStatus(db = pool) {
  const state = await one(db, "SELECT * FROM demo_state WHERE id=1");
  const count = await one(
    db,
    "SELECT count(*) AS n FROM demo_entities de JOIN trips t ON t.id=de.entity_id WHERE de.kind='trip' AND t.departure_at>now() AND t.status='scheduled'",
  );
  return {
    enabled: count.n > 0,
    startDate: state?.start_date,
    endDate: state?.end_date,
    upcoming: count.n,
  };
}
export async function demoAccounts(db = pool) {
  return (
    await db.query(
      "SELECT u.id,u.name,u.email,u.role FROM users u JOIN demo_entities de ON de.entity_id=u.id AND de.kind='user' ORDER BY u.role,u.name",
    )
  ).rows;
}
export async function setupDemo(actor, raw, db = pool) {
  const input = z
    .object({ startDate: z.iso.date().default(addDays(mexicoDay(), 1)) })
    .strict()
    .parse(raw);
  if (
    input.startDate <= mexicoDay() ||
    input.startDate > addDays(mexicoDay(), 90)
  )
    fail("La demostración debe comenzar entre mañana y los próximos 90 días.");
  const end = addDays(input.startDate, 20);
  // Passwords are returned once; an existing installation never resets accounts.
  const credentials = await Promise.all(
    profiles.map(async ([key, name, role]) => {
      const password = `CnES-${randomBytes(9).toString("base64url")}!`;
      return {
        key,
        name,
        role,
        email: `${key}@demo.conexiones.test`,
        password,
        hash: await bcrypt.hash(password, 12),
      };
    }),
  );
  return transaction(async (c) => {
    await c.query("SELECT id FROM demo_state WHERE id=1 FOR UPDATE");
    async function entity(key, kind, table, fields) {
      const old = await one(
        c,
        "SELECT entity_id FROM demo_entities WHERE demo_key=$1",
        [key],
      );
      if (old)
        return one(c, `SELECT * FROM ${table} WHERE id=$1`, [old.entity_id]);
      const row = await insert(c, table, fields);
      await markDemo(c, key, kind, row.id);
      return row;
    }
    const users = {},
      newCredentials = [];
    for (const p of credentials) {
      const old = await one(
        c,
        "SELECT entity_id FROM demo_entities WHERE demo_key=$1",
        [`user:${p.key}`],
      );
      if (
        !old &&
        (await one(c, "SELECT id FROM users WHERE email=$1", [p.email]))
      )
        fail(
          "Un correo de demostración ya pertenece a una cuenta existente.",
          409,
        );
      users[p.key] = await entity(`user:${p.key}`, "user", "users", {
        name: p.name,
        email: p.email,
        role: p.role,
        phone: "0000000000",
        password_hash: p.hash,
      });
      if (!old)
        newCredentials.push({
          name: p.name,
          email: p.email,
          role: p.role,
          password: p.password,
        });
    }
    const drivers = {};
    for (const key of [
      "carlos",
      "maria",
      "raul",
      "patricia",
      "gabriel",
      "lucia",
      "roberto",
      "diana",
    ])
      drivers[key] = await entity(`driver:${key}`, "driver", "drivers", {
        user_id: users[key].id,
        photo_url: `/brand/avatar-${key}.svg`,
        license: `DEMO-${key.toUpperCase()}`,
      });
    const specs = [
      ["carlos", "Mercedes Benz", "Sprinter", 18],
      ["maria", "Toyota", "Hiace", 14],
      ["raul", "Toyota", "Hiace Aeropuerto", 14],
      ["patricia", "Mercedes Benz", "Sprinter Rutas Médicas", 18],
    ];
    const vehicles = {};
    for (const [key, brand, model, capacity] of specs)
      vehicles[key] = await entity(`vehicle:${key}`, "vehicle", "vehicles", {
        brand,
        model,
        capacity,
        plate: `DEMO-${key.toUpperCase()}`,
      });
    for (const [key, model, city] of [
      ["gabriel", "Hyundai Accent 2019 · rojo · Uber", "Morelia"],
      ["lucia", "Toyota Avanza 2021 · blanco · Taxi", "Morelia"],
      ["roberto", "Nissan Versa 2020 · blanco · Taxi", "Apatzingán"],
      ["diana", "Chevrolet Aveo 2018 · plata · Uber", "Apatzingán"],
    ])
      await entity(`fleet:${key}`, "fleet", "local_fleet", {
        driver_id: drivers[key].id,
        plate: `DEMO-${key.toUpperCase()}`,
        model,
        city,
        capacity: 4,
        luggage_capacity: 4,
      });
    await entity("register:apatzingan", "register", "cash_registers", {
      name: "DEMO · Taquilla Apatzingán",
    });
    await entity("register:morelia", "register", "cash_registers", {
      name: "DEMO · Taquilla Morelia",
    });
    const routes = (await c.query("SELECT * FROM routes WHERE active")).rows;
    const plan = [
      ["carlos", "Apatzingán", "Morelia", "07:00", 180],
      ["carlos", "Morelia", "Apatzingán", "17:00", 180],
      ["maria", "Morelia", "Apatzingán", "08:00", 180],
      ["maria", "Apatzingán", "Morelia", "16:00", 180],
      ["raul", "Apatzingán", "Aeropuerto de Morelia", "06:00", 210],
      ["raul", "Aeropuerto de Morelia", "Apatzingán", "15:00", 210],
      ["patricia", "Apatzingán", "CREE Morelia", "07:30", 180, [1, 3]],
      ["patricia", "CREE Morelia", "Apatzingán", "15:30", 180, [1, 3]],
      ["patricia", "Apatzingán", "Teletón Morelia", "07:30", 180, [2, 4]],
      ["patricia", "Teletón Morelia", "Apatzingán", "15:30", 180, [2, 4]],
    ];
    let created = 0;
    // Lock every involved resource before checking overlaps; a normal schedule cannot race the seed.
    for (const key of Object.keys(vehicles).sort()) {
      await c.query("SELECT id FROM vehicles WHERE id=$1 FOR UPDATE", [
        vehicles[key].id,
      ]);
      await c.query("SELECT id FROM drivers WHERE id=$1 FOR UPDATE", [
        drivers[key].id,
      ]);
    }
    for (let d = input.startDate; d <= end; d = addDays(d, 1))
      for (const [key, origin, destination, time, minutes, days] of plan) {
        if (days && !days.includes(new Date(`${d}T12:00:00Z`).getUTCDay()))
          continue;
        const r = routes.find(
          (r) => r.origin === origin && r.destination === destination,
        );
        if (!r) fail("Falta una ruta del catálogo inicial.", 409);
        const demoKey = `trip:${d}:${key}:${time}`;
        if (
          await one(
            c,
            "SELECT entity_id FROM demo_entities WHERE demo_key=$1",
            [demoKey],
          )
        )
          continue;
        const departure = mexicoInstant(d, time),
          t = await addTrip(c, {
            route_id: r.id,
            vehicle_id: vehicles[key].id,
            driver_id: drivers[key].id,
            departure_at: departure,
            arrival_at: new Date(+departure + minutes * 60000),
            capacity: vehicles[key].capacity,
          });
        await markDemo(c, demoKey, "trip", t.id);
        created++;
      }
    await c.query(
      "UPDATE demo_state SET start_date=$1,end_date=$2,updated_at=now(3) WHERE id=1",
      [input.startDate, end],
    );
    await c.query(
      "INSERT INTO audit_log(actor_id,action,entity_id,metadata) VALUES($1,'demo.setup',$1,$2)",
      [
        actor.id,
        JSON.stringify({ startDate: input.startDate, endDate: end, created }),
      ],
    );
    return {
      startDate: input.startDate,
      endDate: end,
      tripsCreated: created,
      credentials: newCredentials,
    };
  }, db);
}
