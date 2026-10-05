import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../src/config.js";
import { testDatabase, fixture, travelers } from "./helpers.js";
import { pool, one, transaction, insert } from "../src/db.js";
import { app } from "../src/app.js";
import { setupDemo, demoAccounts, payDemo, markDemo } from "../src/demo.js";
import { createBooking } from "../src/bookings.js";
import { openCash, closeCash, cashSales } from "../src/cash.js";
import {
  reserveParcel,
  parcelAction,
  advanceCargo,
  quoteParcel,
  parcelSettings,
} from "../src/parcels.js";
import {
  generateSchedule,
  addDays,
  mexicoDay,
  mexicoInstant,
} from "../src/schedules.js";
let db;
before(async () => {
  db = await testDatabase();
  pool.query = (...a) => db.query(...a);
  pool.connect = () => db.connect();
});
after(async () => {
  await db.end();
  await pool.end();
});
const parcel = (tripId) => ({
  tripId,
  senderName: "Remitente Prueba",
  senderPhone: "0000000000",
  recipientName: "Destinatario Prueba",
  recipientPhone: "0000000000",
  description: "Ropa de demostración",
  grams: 2000,
  lengthCm: 20,
  widthCm: 20,
  heightCm: 20,
  declaredCents: 10000,
});
test("21 días DEMO: usuarios solicitados, salidas sin solapamientos e instalación repetible sin cambiar contraseñas", async () => {
  const f = await fixture(db),
    actor = { ...f.cashier, role: "admin" },
    startDate = addDays(mexicoDay(), 1);
  const seeded = await setupDemo(actor, { startDate }, db);
  assert.equal(seeded.credentials.length, 10);
  assert.equal(seeded.tripsCreated, 150);
  const accounts = await demoAccounts(db);
  assert.ok(
    accounts.some((a) => a.name === "Jonathan Garcia" && a.role === "admin"),
  );
  assert.ok(
    accounts.some((a) => a.name === "Esmeralda" && a.role === "cashier"),
  );
  const gabriel = await one(
    db,
    "SELECT f.* FROM local_fleet f JOIN drivers d ON d.id=f.driver_id JOIN users u ON u.id=d.user_id WHERE u.email='gabriel@demo.conexiones.test'",
  );
  assert.match(gabriel.model, /Hyundai Accent 2019.*rojo.*Uber/);
  const u = await one(
    db,
    "SELECT * FROM users WHERE email='jonathan@demo.conexiones.test'",
  );
  assert.ok(
    await bcrypt.compare(
      seeded.credentials.find((a) => a.email === u.email).password,
      u.password_hash,
    ),
  );
  const again = await setupDemo(actor, { startDate }, db);
  assert.equal(again.tripsCreated, 0);
  assert.equal(again.credentials.length, 0);
  assert.equal(
    (await one(db, "SELECT password_hash FROM users WHERE id=$1", [u.id]))
      .password_hash,
    u.password_hash,
  );
  const overlap = await one(
    db,
    "SELECT count(*) AS n FROM trips a JOIN trips b ON a.id<b.id AND (a.driver_id=b.driver_id OR a.vehicle_id=b.vehicle_id) AND a.departure_at<b.arrival_at AND a.arrival_at>b.departure_at JOIN demo_entities de ON de.entity_id=a.id AND de.kind='trip'",
  );
  assert.equal(overlap.n, 0);
  const ana = await one(
      db,
      "SELECT * FROM users WHERE email='ana@demo.conexiones.test'",
    ),
    t = await one(
      db,
      "SELECT t.* FROM trips t JOIN demo_entities de ON de.entity_id=t.id AND de.kind='trip' JOIN routes r ON r.id=t.route_id WHERE r.destination='Morelia' ORDER BY t.departure_at LIMIT 1",
    ),
    type = await one(db, "SELECT * FROM passenger_types WHERE name='Adulto'");
  const old = process.env.MP_ENABLED;
  process.env.MP_ENABLED = "false";
  try {
    const b = await createBooking(
      ana,
      {
        tripId: t.id,
        passengers: [{ id: type.id, quantity: 2 }],
        travelers: travelers(type.id, 2),
      },
      randomUUID(),
      db,
    );
    assert.equal(b.fee_cents, 2000);
    assert.equal((await payDemo(ana, b.id, db)).status, "confirmed");
    assert.equal((await payDemo(ana, b.id, db)).status, "confirmed");
    assert.equal(
      (
        await one(
          db,
          "SELECT count(*) AS n FROM payments WHERE booking_id=$1",
          [b.id],
        )
      ).n,
      0,
    );
    await assert.rejects(payDemo(f.u, b.id, db), /no permitido/);
    await assert.rejects(
      createBooking(
        f.u,
        {
          tripId: t.id,
          passengers: [{ id: type.id, quantity: 1 }],
          travelers: travelers(type.id, 1),
        },
        randomUUID(),
        db,
      ),
      /demostración/,
    );
    await assert.rejects(
      createBooking(
        f.u,
        {
          tripId: f.trip.id,
          passengers: [{ id: f.type.id, quantity: 1 }],
          travelers: travelers(f.type.id, 1),
        },
        randomUUID(),
        db,
      ),
      /pendientes de configuración/,
    );
  } finally {
    process.env.MP_ENABLED = old;
  }
});
test("Programación: horario de México, lote atómico ante conflictos y reintento sin duplicados", async () => {
  const f = await fixture(db),
    start = addDays(mexicoDay(), 30),
    v = {
      routeId: f.route.id,
      vehicleId: f.vehicle.id,
      driverId: f.driver.id,
      startDate: start,
      endDate: addDays(start, 1),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      times: ["07:00", "08:00"],
      durationMinutes: 180,
      capacity: 4,
      cargoPackages: 2,
      cargoKg: 10,
    };
  assert.equal(
    mexicoInstant("2026-10-06", "07:00").toISOString(),
    "2026-10-06T13:00:00.000Z",
  );
  await assert.rejects(
    generateSchedule(f.cashier, v, randomUUID(), db),
    /ocupados/,
  );
  assert.equal(
    (
      await one(db, "SELECT count(*) AS n FROM trips WHERE vehicle_id=$1", [
        f.vehicle.id,
      ])
    ).n,
    1,
  );
  v.times = ["07:00", "17:00"];
  const key = randomUUID(),
    r = await generateSchedule(f.cashier, v, key, db);
  assert.equal(r.count, 4);
  assert.deepEqual(await generateSchedule(f.cashier, v, key, db), r);
  await assert.rejects(
    generateSchedule(f.cashier, { ...v, capacity: 3 }, key, db),
    /otra programación/,
  );
});
test("Paquetería: capacidad ACID, idempotencia, roles, recepción/corte, carga y entrega con código", async () => {
  const f = await fixture(db);
  await db.query("INSERT INTO trip_cargo VALUES($1,1,5000)", [f.trip.id]);
  const v = parcel(f.trip.id),
    key = randomUUID();
  const attempts = await Promise.allSettled([
    reserveParcel(f.u, v, key, db),
    reserveParcel(f.u, { ...v, description: "Otro paquete" }, randomUUID(), db),
  ]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  const p = attempts.find((r) => r.status === "fulfilled").value;
  const actualKey = await one(
    db,
    "SELECT idempotency_key,description FROM parcels WHERE id=$1",
    [p.id],
  );
  assert.equal(
    (
      await reserveParcel(
        f.u,
        { ...v, description: actualKey.description },
        actualKey.idempotency_key,
        db,
      )
    ).id,
    p.id,
  );
  const s = await openCash(
    f.cashier,
    { registerId: f.register.id, openingCents: 10000 },
    db,
  );
  await assert.rejects(
    parcelAction(f.u, p.id, { action: "receive", cashSessionId: s.id }, db),
    /Abre tu caja/,
  );
  await parcelAction(
    f.cashier,
    p.id,
    { action: "receive", cashSessionId: s.id },
    db,
  );
  assert.equal((await cashSales(db, s.id))[0].amount_cents, 12000);
  const report = await closeCash(f.cashier, s.id, { countedCents: 22000 }, db);
  assert.equal(report.difference_cents, 0);
  assert.equal(report.transactions, 1);
  await assert.rejects(
    parcelAction(f.driverUser, p.id, { action: "load" }, db),
    /abordaje/,
  );
  await db.query("UPDATE trips SET status='boarding' WHERE id=$1", [f.trip.id]);
  await assert.rejects(
    transaction((c) => advanceCargo(c, f.trip, "en_route", f.driverUser), db),
    /Carga todos/,
  );
  const other = await fixture(db);
  await assert.rejects(
    parcelAction(other.driverUser, p.id, { action: "load" }, db),
    /No eres/,
  );
  const loaded = await parcelAction(f.driverUser, p.id, { action: "load" }, db);
  assert.equal(loaded.status, "loaded");
  assert.equal(loaded.pickup_code, undefined);
  await transaction(
    (c) => advanceCargo(c, f.trip, "en_route", f.driverUser),
    db,
  );
  await transaction(
    (c) => advanceCargo(c, f.trip, "arrived", f.driverUser),
    db,
  );
  await db.query("UPDATE trips SET status='arrived' WHERE id=$1", [f.trip.id]);
  await assert.rejects(
    parcelAction(
      f.cashier,
      p.id,
      { action: "deliver", pickupCode: "000000" },
      db,
    ),
    /incorrecto/,
  );
  assert.equal(
    (
      await parcelAction(
        f.cashier,
        p.id,
        { action: "deliver", pickupCode: p.pickup_code },
        db,
      )
    ).status,
    "delivered",
  );
  const publicResult = await request(app)
    .get(`/api/parcel-tracking/${p.tracking_token}`)
    .expect(200);
  assert.equal(publicResult.body.status, "delivered");
  assert.equal(publicResult.body.pickup_code, undefined);
  assert.equal(publicResult.body.sender_phone, undefined);
  assert.equal(publicResult.body.recipient_name, undefined);
  await request(app)
    .get(`/api/operations/trips/${f.trip.id}/manifest`)
    .expect(401);
  assert.equal(
    quoteParcel({ ...v, grams: 7000 }, await parcelSettings(db)),
    15000,
  );
});
test("Caja DEMO: venta simulada separada y bloqueo de caja real mezclada", async () => {
  const f = await fixture(db);
  for (const [kind, id] of [
    ["user", f.u.id],
    ["user", f.cashier.id],
    ["trip", f.trip.id],
    ["register", f.register.id],
  ])
    await markDemo(db, `${kind}:${randomUUID()}`, kind, id);
  const s = await openCash(
    f.cashier,
    { registerId: f.register.id, openingCents: 0 },
    db,
  );
  const b = await createBooking(
    f.cashier,
    {
      tripId: f.trip.id,
      channel: "pos",
      customerId: f.u.id,
      cashSessionId: s.id,
      passengers: [{ id: f.type.id, quantity: 1 }],
      travelers: travelers(f.type.id, 1),
    },
    randomUUID(),
    db,
  );
  assert.equal(b.fee_cents, 0);
  assert.equal(
    (
      await one(db, "SELECT count(*) AS n FROM payments WHERE booking_id=$1", [
        b.id,
      ])
    ).n,
    0,
  );
  assert.equal(
    (await closeCash(f.cashier, s.id, { countedCents: 25000 }, db))
      .difference_cents,
    0,
  );
  const real = await fixture(db);
  await assert.rejects(
    openCash(f.cashier, { registerId: real.register.id, openingCents: 0 }, db),
    /correspondiente/,
  );
});

test("Recorrido HTTP completo: cliente, cajera, conductor, Uber y entrega; datos privados según asignación", async () => {
  const f = await fixture(db, 6),
    other = await fixture(db);
  await db.query("INSERT INTO trip_cargo VALUES($1,5,20000)", [f.trip.id]);
  const fleet = await insert(db, "local_fleet", {
    driver_id: other.driver.id,
    model: "Taxi de prueba",
    plate: randomUUID(),
    city: "Morelia",
    capacity: 4,
    luggage_capacity: 4,
  });
  const cookie = (user) =>
    `session=${jwt.sign({ sub: user.id }, config.secret, { issuer: "conexiones", audience: "conexiones-web", expiresIn: "1h" })}`;
  const call = (method, path, user, body) =>
    request(app)
      [method](`/api${path}`)
      .set("Origin", "http://localhost:5173")
      .set("Cookie", cookie(user))
      .send(body);
  const s = (
    await call("post", "/cash/open", f.cashier, {
      registerId: f.register.id,
      openingCents: 0,
    }).expect(201)
  ).body;
  const b = (
    await call("post", "/bookings", f.cashier, {
      tripId: f.trip.id,
      channel: "pos",
      cashSessionId: s.id,
      customerId: f.u.id,
      passengers: [{ id: f.type.id, quantity: 5 }],
      travelers: travelers(f.type.id, 5),
    })
      .set("Idempotency-Key", randomUUID())
      .expect(201)
  ).body;
  await call("post", "/bookings/" + b.id + "/last-mile", f.u, {
    zone: "Centro",
    passengers: 5,
    luggage: 2,
    vehicles: 1,
  }).expect(400);
  await call("post", "/bookings/" + b.id + "/last-mile", f.u, {
    zone: "Centro",
    passengers: 5,
    luggage: 2,
    vehicles: 2,
  }).expect(201);
  const jobs = (
    await call("get", "/local/jobs", other.driverUser).expect(200)
  ).body.jobs.filter((j) => j.zone === "Centro");
  assert.equal(jobs.length, 2);
  assert.ok(jobs.every((j) => !j.customer_name && !j.customer_phone));
  await call("post", `/local/jobs/${jobs[0].id}/accept`, other.driverUser, {
    fleetId: fleet.id,
  }).expect(200);
  const assigned = (
    await call("get", "/local/jobs", other.driverUser).expect(200)
  ).body.jobs.find((j) => j.id === jobs[0].id);
  assert.equal(assigned.customer_name, f.u.name);
  assert.equal(assigned.customer_phone, f.u.phone);
  const p = (
    await call("post", "/parcels", f.u, parcel(f.trip.id))
      .set("Idempotency-Key", randomUUID())
      .expect(201)
  ).body;
  await call("post", `/parcels/${p.id}/action`, f.cashier, {
    action: "receive",
    cashSessionId: s.id,
  }).expect(200);
  await call(
    "get",
    `/operations/trips/${f.trip.id}/manifest`,
    other.driverUser,
  ).expect(403);
  await call("get", `/operations/trips/${f.trip.id}/manifest`, f.u).expect(403);
  const manifest = (
    await call(
      "get",
      `/operations/trips/${f.trip.id}/manifest`,
      f.driverUser,
    ).expect(200)
  ).body;
  assert.equal(manifest.bookings[0].travelers.length, 5);
  assert.equal(manifest.parcels.length, 1);
  assert.equal(
    (await call("get", "/parcels", f.driverUser).expect(200)).body.find(
      (x) => x.id === p.id,
    ).pickup_code,
    undefined,
  );
  await call("patch", `/trips/${f.trip.id}/status`, f.driverUser, {
    status: "boarding",
  }).expect(200);
  await call(
    "post",
    `/ticket/${b.ticket_token}/board`,
    other.driverUser,
    {},
  ).expect(403);
  await call(
    "post",
    `/ticket/${b.ticket_token}/board`,
    f.driverUser,
    {},
  ).expect(200);
  await call(
    "post",
    `/ticket/${b.ticket_token}/board`,
    f.driverUser,
    {},
  ).expect(409);
  await call("patch", `/trips/${f.trip.id}/status`, f.driverUser, {
    status: "en_route",
  }).expect(409);
  await call("post", `/parcels/${p.id}/action`, f.driverUser, {
    action: "load",
  }).expect(200);
  await call("patch", `/trips/${f.trip.id}/status`, f.driverUser, {
    status: "en_route",
  }).expect(200);
  await call("patch", `/trips/${f.trip.id}/status`, f.driverUser, {
    status: "arrived",
  }).expect(200);
  await call("post", `/parcels/${p.id}/action`, f.u, {
    action: "deliver",
    pickupCode: p.pickup_code,
  }).expect(403);
  await call("post", `/parcels/${p.id}/action`, f.cashier, {
    action: "deliver",
    pickupCode: p.pickup_code,
  }).expect(200);
  const closed = (
    await call("post", `/cash/${s.id}/close`, f.cashier, {
      countedCents: 137000,
    }).expect(200)
  ).body;
  assert.equal(closed.salesCents, 137000);
  assert.equal(closed.difference_cents, 0);
  assert.equal(closed.transactions, 2);
  await call(
    "post",
    `/local/jobs/${jobs[0].id}/complete`,
    other.driverUser,
    {},
  ).expect(200);
  const publicTrip = (
    await request(app).get(`/api/tracking/${b.share_token}`).expect(200)
  ).body;
  assert.equal(publicTrip.status, "arrived");
  assert.equal(publicTrip.travelers, undefined);
  await call("post", "/admin/demo/setup", f.u, {}).expect(403);
});
