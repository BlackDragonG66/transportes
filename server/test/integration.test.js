import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, testDatabase, travelers } from "./helpers.js";
import { createBooking } from "../src/bookings.js";
import { openCash, closeCash } from "../src/cash.js";
import { acceptLocal, requestLastMile } from "../src/local.js";
import { reconcilePayment } from "../src/mercadopago.js";
import { insert, pool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
let db;
before(async () => {
  db = await testDatabase("integration");
});
after(async () => {
  await db?.end();
  await pool.end();
});
test("DDL, idempotencia, capacidad y expiración real de reservas", async () => {
  const f = await fixture(db, 4),
    key = randomUUID(),
    input = {
      tripId: f.trip.id,
      passengers: [{ id: f.type.id, quantity: 3 }],
      travelers: travelers(f.type.id, 3),
    };
  const first = await createBooking(f.u, input, key, db);
  assert.equal(first.total_cents, 78000);
  const retry = await createBooking(f.u, input, key, db);
  assert.equal(retry.id, first.id);
  await assert.rejects(
    createBooking(
      f.u,
      {
        ...input,
        passengers: [{ id: f.type.id, quantity: 2 }],
        travelers: travelers(f.type.id, 2),
      },
      key,
      db,
    ),
    /idempotencia/,
  );
  await assert.rejects(createBooking(f.u, input, randomUUID(), db), /lugares/);
  await f.run(
    "UPDATE bookings SET expires_at=DATE_SUB(now(),INTERVAL 1 MINUTE) WHERE id=$1",
    [first.id],
  );
  const next = await createBooking(f.u, input, randomUUID(), db);
  assert.notEqual(next.id, first.id);
  assert.equal(
    (await f.run("SELECT status FROM bookings WHERE id=$1", [first.id])).status,
    "expired",
  );
});
test("rollback completo ante solicitud sin tarifa", async () => {
  const f = await fixture(db),
    missing = randomUUID();
  await assert.rejects(
    createBooking(
      f.u,
      {
        tripId: f.trip.id,
        passengers: [{ id: missing, quantity: 1 }],
        travelers: travelers(missing, 1),
      },
      randomUUID(),
      db,
    ),
    /Tarifa/,
  );
  assert.equal(
    (
      await f.run("SELECT count(*) AS n FROM bookings WHERE trip_id=$1", [
        f.trip.id,
      ])
    ).n,
    0,
  );
});
test("compras concurrentes con conexiones distintas nunca exceden capacidad", async () => {
  const f = await fixture(db, 4),
    input = {
      tripId: f.trip.id,
      passengers: [{ id: f.type.id, quantity: 3 }],
      travelers: travelers(f.type.id, 3),
    };
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      createBooking(f.u, input, randomUUID(), db),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const rejected of results.filter((r) => r.status === "rejected"))
    assert.match(rejected.reason.message, /lugares/);
  assert.equal(
    (
      await f.run(
        "SELECT sum(passengers) AS n FROM bookings WHERE trip_id=$1 AND status='pending'",
        [f.trip.id],
      )
    ).n,
    3,
  );
});
test("la misma clave concurrente devuelve una sola reserva", async () => {
  const f = await fixture(db, 8),
    input = {
      tripId: f.trip.id,
      passengers: [{ id: f.type.id, quantity: 2 }],
      travelers: travelers(f.type.id, 2),
    },
    key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 5 }, () => createBooking(f.u, input, key, db)),
  );
  assert.equal(new Set(results.map((b) => b.id)).size, 1);
});
test("POS vende sin comisión, cierre contiene fondo, ventas y diferencia", async () => {
  const f = await fixture(db),
    s = await openCash(
      f.cashier,
      { registerId: f.register.id, openingCents: 10000 },
      db,
    );
  await assert.rejects(
    openCash(f.cashier, { registerId: f.register.id, openingCents: 10000 }, db),
  );
  const input = {
    tripId: f.trip.id,
    channel: "pos",
    customerId: f.u.id,
    cashSessionId: s.id,
    passengers: [{ id: f.type.id, quantity: 2 }],
    travelers: travelers(f.type.id, 2),
  };
  const b = await createBooking(f.cashier, input, randomUUID(), db);
  assert.equal(b.status, "confirmed");
  assert.equal(b.fee_cents, 0);
  const closed = await closeCash(f.cashier, s.id, { countedCents: 59000 }, db);
  assert.equal(closed.expected_cents, 60000);
  assert.equal(closed.difference_cents, -1000);
  assert.equal(closed.transactions, 1);
  await assert.rejects(
    createBooking(f.cashier, input, randomUUID(), db),
    /caja/,
  );
  await assert.rejects(
    closeCash(f.cashier, s.id, { countedCents: 60000 }, db),
    /cerrada/,
  );
});
test("cierre concurrente con venta conserva el reporte o rechaza la venta", async () => {
  const f = await fixture(db),
    s = await openCash(
      f.cashier,
      { registerId: f.register.id, openingCents: 0 },
      db,
    );
  const input = {
    tripId: f.trip.id,
    channel: "pos",
    customerId: f.u.id,
    cashSessionId: s.id,
    passengers: [{ id: f.type.id, quantity: 1 }],
    travelers: travelers(f.type.id, 1),
  };
  const results = await Promise.allSettled([
    createBooking(f.cashier, input, randomUUID(), db),
    closeCash(f.cashier, s.id, { countedCents: 25000 }, db),
  ]);
  assert.equal(results[1].status, "fulfilled");
  const final = await f.run("SELECT * FROM cash_sessions WHERE id=$1", [s.id]);
  const sales = await f.run(
    "SELECT COALESCE(sum(total_cents),0) AS n FROM bookings WHERE cash_session_id=$1",
    [s.id],
  );
  assert.equal(final.expected_cents, sales.n);
  assert(final.closed_at);
});
test("cinco pasajeros generan dos autos, aceptación única y contactos vía outbox", async () => {
  const f = await fixture(db, 8),
    s = await openCash(
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
      passengers: [{ id: f.type.id, quantity: 5 }],
      travelers: travelers(f.type.id, 5),
    },
    randomUUID(),
    db,
  );
  await requestLastMile(
    f.u,
    b.id,
    { zone: "Centro", passengers: 5, luggage: 3, vehicles: 2 },
    db,
  );
  const jobs = (
    await db.query(
      "SELECT j.* FROM local_jobs j JOIN last_mile_requests r ON r.id=j.request_id WHERE r.booking_id=$1",
      [b.id],
    )
  ).rows;
  assert.equal(jobs.length, 2);
  assert.equal(
    jobs.reduce((n, j) => n + j.passengers, 0),
    5,
  );
  const fleet = await insert(db, "local_fleet", {
    driver_id: f.driver.id,
    plate: randomUUID(),
    model: "Sedán",
    city: "Morelia",
    capacity: 4,
    luggage_capacity: 4,
  });
  const results = await Promise.allSettled([
    acceptLocal(f.driverUser, jobs[0].id, fleet.id, db),
    acceptLocal(f.driverUser, jobs[0].id, fleet.id, db),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (
      await f.run(
        "SELECT count(*) AS n FROM notification_outbox WHERE event_key LIKE $1",
        [`local-%:${jobs[0].id}`],
      )
    ).n,
    2,
  );
  await assert.rejects(acceptLocal(f.driverUser, jobs[1].id, fleet.id, db));
});
test("pago aprobado, webhook duplicado, importe alterado y reversión", async () => {
  const f = await fixture(db),
    b = await createBooking(
      f.u,
      {
        tripId: f.trip.id,
        passengers: [{ id: f.type.id, quantity: 2 }],
        travelers: travelers(f.type.id, 2),
      },
      randomUUID(),
      db,
    );
  const p = {
    id: randomUUID(),
    collector_id: 123,
    external_reference: b.id,
    status: "approved",
    currency_id: "MXN",
    transaction_amount: 520,
  };
  await assert.rejects(
    reconcilePayment({ ...p, transaction_amount: 1 }, db),
    /Importe/,
  );
  await reconcilePayment(p, db);
  await reconcilePayment(p, db);
  assert.equal(
    (await f.run("SELECT status FROM bookings WHERE id=$1", [b.id])).status,
    "confirmed",
  );
  assert.equal(
    (
      await f.run("SELECT count(*) AS n FROM payments WHERE booking_id=$1", [
        b.id,
      ])
    ).n,
    1,
  );
  await reconcilePayment({ ...p, status: "refunded" }, db);
  await reconcilePayment(p, db);
  assert.equal(
    (await f.run("SELECT status FROM bookings WHERE id=$1", [b.id])).status,
    "refunded",
  );
});
test("pago tardío con unidad llena requiere reembolso sin sobreventa", async () => {
  const f = await fixture(db, 2),
    input = {
      tripId: f.trip.id,
      passengers: [{ id: f.type.id, quantity: 2 }],
      travelers: travelers(f.type.id, 2),
    };
  const b = await createBooking(f.u, input, randomUUID(), db);
  await f.run(
    "UPDATE bookings SET expires_at=DATE_SUB(now(),INTERVAL 1 MINUTE) WHERE id=$1",
    [b.id],
  );
  await createBooking(f.u, input, randomUUID(), db);
  await reconcilePayment(
    {
      id: `late-${randomUUID()}`,
      collector_id: 123,
      external_reference: b.id,
      status: "approved",
      currency_id: "MXN",
      transaction_amount: 520,
    },
    db,
  );
  assert.equal(
    (await f.run("SELECT status FROM bookings WHERE id=$1", [b.id])).status,
    "refund_required",
  );
  assert.equal(
    (
      await f.run(
        "SELECT COALESCE(sum(passengers),0) AS n FROM bookings WHERE trip_id=$1 AND status='confirmed'",
        [f.trip.id],
      )
    ).n,
    0,
  );
});
test("migración repetida conserva precios configurados y no duplica catálogo", async () => {
  await migrate(db);
  const row = (await db.query("SELECT * FROM fares LIMIT 1")).rows[0];
  await db.query(
    "UPDATE fares SET price_cents=12345 WHERE route_id=$1 AND passenger_type_id=$2",
    [row.route_id, row.passenger_type_id],
  );
  const count = (await db.query("SELECT count(*) AS n FROM routes")).rows[0].n;
  await migrate(db);
  assert.equal(
    (await db.query("SELECT count(*) AS n FROM routes")).rows[0].n,
    count,
  );
  assert.equal(
    (
      await db.query(
        "SELECT price_cents FROM fares WHERE route_id=$1 AND passenger_type_id=$2",
        [row.route_id, row.passenger_type_id],
      )
    ).rows[0].price_cents,
    12345,
  );
});
