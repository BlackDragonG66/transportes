import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { pool, one, insert } from "../src/db.js";
import { fixture, testDatabase, travelers } from "./helpers.js";
import { createBooking } from "../src/bookings.js";
import { openCash } from "../src/cash.js";
import { acceptLocal, advanceLocal, requestLastMile } from "../src/local.js";
import {
  staffVehicles,
  updateLocalVehicle,
  publicLocalVehicle,
} from "../src/staff-vehicles.js";
import { saveReview } from "../src/reviews.js";
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
const call = (actor, method, path, body) =>
  request(app)
    [method]("/api" + path)
    .set("Origin", "http://localhost:5173")
    .set(
      "Cookie",
      `session=${jwt.sign({ sub: actor.id }, config.secret, { issuer: "conexiones", audience: "conexiones-web", expiresIn: "1h" })}`,
    )
    .send(body);
const car = (f) =>
  insert(db, "local_fleet", {
    driver_id: f.driver.id,
    plate: randomUUID(),
    model: "Hyundai Accent 2019 · rojo · Uber",
    city: "Morelia",
    capacity: 4,
    luggage_capacity: 4,
  });
async function job(f, arrival) {
  if (arrival)
    await db.query(
      "UPDATE trips SET arrival_at=$2,departure_at=DATE_SUB($2,INTERVAL 3 HOUR) WHERE id=$1",
      [f.trip.id, arrival],
    );
  const cash = await openCash(
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
      cashSessionId: cash.id,
      passengers: [{ id: f.type.id, quantity: 1 }],
      travelers: travelers(f.type.id, 1),
    },
    randomUUID(),
    db,
  );
  const r = await requestLastMile(
    f.u,
    b.id,
    { zone: "Centro", passengers: 1, luggage: 1, vehicles: 1 },
    db,
  );
  return {
    b,
    j: await one(db, "SELECT * FROM local_jobs WHERE request_id=$1", [r.id]),
  };
}
test("Ficha y QR del auto: datos heredados, edición del propietario, token estable y privacidad pública", async () => {
  const f = await fixture(db),
    other = await fixture(db),
    auto = await car(f);
  const list = await staffVehicles(f.driverUser, db),
    v = list.local.find((c) => c.id === auto.id);
  assert.equal(v.brand, "Hyundai");
  assert.equal(v.model, "Accent");
  assert.equal(v.vehicle_year, 2019);
  assert.equal(v.color, "rojo");
  assert.equal(v.service_type, "uber");
  assert.match(v.qr, /^data:image\/png;base64,/);
  const input = {
    brand: "Hyundai",
    model: "Accent",
    vehicle_year: 2019,
    color: "Rojo",
    service_type: "uber",
    plate: "prueba-123",
    capacity: 4,
    luggage_capacity: 3,
  };
  await assert.rejects(
    updateLocalVehicle(other.driverUser, auto.id, input, db),
    /otro conductor/,
  );
  await call(f.u, "get", "/staff/vehicles").expect(403);
  await call(f.cashier, "get", "/staff/vehicles").expect(403);
  await call(f.driverUser, "patch", `/staff/local-vehicles/${auto.id}`, {
    ...input,
    city: "Apatzingán",
  }).expect(400);
  await call(f.driverUser, "patch", `/staff/local-vehicles/${auto.id}`, {
    ...input,
    capacity: 5,
  }).expect(400);
  const saved = await updateLocalVehicle(f.driverUser, auto.id, input, db);
  assert.equal(saved.public_token, v.public_token);
  assert.equal(saved.city, "Morelia");
  assert.equal(saved.plate, "PRUEBA-123");
  const second = await car(other);
  await assert.rejects(
    updateLocalVehicle(
      f.driverUser,
      auto.id,
      { ...input, plate: second.plate },
      db,
    ),
  );
  const publicCar = (
    await request(app).get(`/api/taxi/${v.public_token}`).expect(200)
  ).body;
  assert.equal(publicCar.plate, "PRUEBA-123");
  assert.equal(publicCar.driver_name, f.driverUser.name);
  for (const key of [
    "user_id",
    "driver_id",
    "phone",
    "email",
    "license",
    "jobs",
    "public_token",
    "busy",
  ])
    assert.equal(publicCar[key], undefined);
  await db.query("UPDATE local_fleet SET active=false WHERE id=$1", [auto.id]);
  await assert.rejects(
    publicLocalVehicle(v.public_token, db),
    /no está disponible/,
  );
});
test("Agenda: acepta 10 y 11, bloquea dos unidades a las 11, y conduce un solo traslado a la vez", async () => {
  const taxi = await fixture(db),
    auto = await car(taxi),
    f1 = await fixture(db),
    f2 = await fixture(db),
    f3 = await fixture(db),
    f4 = await fixture(db);
  const date = new Date(Date.now() + 3 * 86400000);
  date.setUTCHours(16, 0, 0, 0);
  const later = new Date(+date + 3600000);
  const a = await job(f1, date),
    b = await job(f2, later),
    same = await job(f3, later),
    race = await job(f4, later);
  await acceptLocal(taxi.driverUser, a.j.id, auto.id, db);
  const candidates = await Promise.allSettled([
    acceptLocal(taxi.driverUser, b.j.id, auto.id, db),
    acceptLocal(taxi.driverUser, same.j.id, auto.id, db),
  ]);
  assert.equal(candidates.filter((c) => c.status === "fulfilled").length, 1);
  assert.match(
    candidates.find((c) => c.status === "rejected").reason.message,
    /misma hora/,
  );
  const next = candidates.find((c) => c.status === "fulfilled").value;
  assert.equal(
    (
      await db.query(
        "SELECT id FROM local_jobs WHERE fleet_id=$1 AND status='accepted'",
        [auto.id],
      )
    ).rows.length,
    2,
  );
  const offered = (
    await call(taxi.driverUser, "get", "/local/jobs").expect(200)
  ).body.jobs;
  assert.ok(!offered.some((j) => j.id === race.j.id));
  await assert.rejects(
    advanceLocal(taxi.driverUser, a.j.id, "complete", db),
    /Inicia/,
  );
  const starts = await Promise.allSettled([
    advanceLocal(taxi.driverUser, a.j.id, "start", db),
    advanceLocal(taxi.driverUser, next.id, "start", db),
  ]);
  assert.equal(starts.filter((c) => c.status === "fulfilled").length, 1);
  const running = starts.find((c) => c.status === "fulfilled").value,
    queued = running.id === a.j.id ? next : a.j;
  await assert.rejects(
    updateLocalVehicle(
      taxi.driverUser,
      auto.id,
      {
        brand: "Hyundai",
        model: "Accent",
        vehicle_year: 2019,
        color: "rojo",
        service_type: "uber",
        plate: auto.plate,
        capacity: 4,
        luggage_capacity: 4,
      },
      db,
    ),
    /Finaliza/,
  );
  await advanceLocal(taxi.driverUser, running.id, "complete", db);
  await advanceLocal(taxi.driverUser, queued.id, "start", db);
  await advanceLocal(taxi.driverUser, queued.id, "complete", db);
  await assert.rejects(
    acceptLocal(taxi.driverUser, race.j.id, auto.id, db),
    /misma hora/,
  );
});
test("Progreso compartido y calificaciones: solo dueño, viaje completado, estrellas válidas y reseña única", async () => {
  const f = await fixture(db),
    taxi = await fixture(db),
    other = await fixture(db),
    auto = await car(taxi),
    { b, j } = await job(f);
  await acceptLocal(taxi.driverUser, j.id, auto.id, db);
  let tracking = (
    await request(app).get(`/api/tracking/${b.share_token}`).expect(200)
  ).body;
  assert.equal(tracking.status, "scheduled");
  assert.equal(tracking.local[0].started_at, null);
  await call(other.u, "post", `/bookings/${b.id}/reviews`, {
    segment: "interurban",
    rating: 5,
  }).expect(403);
  await call(f.u, "post", `/bookings/${b.id}/reviews`, {
    segment: "interurban",
    rating: 5,
  }).expect(409);
  await call(f.u, "post", `/bookings/${b.id}/reviews`, {
    segment: "interurban",
    rating: 6,
  }).expect(400);
  await db.query("UPDATE trips SET status='en_route' WHERE id=$1", [f.trip.id]);
  tracking = (
    await request(app).get(`/api/tracking/${b.share_token}`).expect(200)
  ).body;
  assert.equal(tracking.status, "en_route");
  await advanceLocal(taxi.driverUser, j.id, "start", db);
  tracking = (
    await request(app).get(`/api/tracking/${b.share_token}`).expect(200)
  ).body;
  assert.ok(tracking.local[0].started_at);
  await assert.rejects(
    saveReview(f.u, b.id, { segment: "local", jobId: j.id, rating: 5 }, db),
    /termine/,
  );
  await advanceLocal(taxi.driverUser, j.id, "complete", db);
  await db.query("UPDATE trips SET status='arrived' WHERE id=$1", [f.trip.id]);
  await saveReview(
    f.u,
    b.id,
    { segment: "interurban", rating: 4, comment: "Buen viaje" },
    db,
  );
  await saveReview(
    f.u,
    b.id,
    { segment: "interurban", rating: 5, comment: "Excelente" },
    db,
  );
  await saveReview(
    f.u,
    b.id,
    { segment: "local", jobId: j.id, rating: 5, comment: "Buen traslado" },
    db,
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*) AS n FROM trip_reviews WHERE booking_id=$1",
        [b.id],
      )
    ).n,
    2,
  );
  const ticket = (
    await call(f.u, "get", `/ticket/${b.ticket_token}`).expect(200)
  ).body;
  assert.equal(ticket.canReview, true);
  assert.equal(ticket.reviews.length, 2);
  const driverTicket = (
    await call(f.driverUser, "get", `/ticket/${b.ticket_token}`).expect(200)
  ).body;
  assert.equal(driverTicket.canReview, false);
  assert.equal(driverTicket.reviews.length, 0);
  tracking = (
    await request(app).get(`/api/tracking/${b.share_token}`).expect(200)
  ).body;
  assert.equal(tracking.status, "arrived");
  assert.equal(tracking.local[0].status, "completed");
  assert.ok(!JSON.stringify(tracking).includes("Excelente"));
  for (const key of ["user_id", "email", "phone", "reviews", "travelers"])
    assert.equal(tracking[key], undefined);
  const v = (await staffVehicles(taxi.driverUser, db)).local[0];
  const publicCar = await publicLocalVehicle(v.public_token, db);
  assert.equal(publicCar.rating_average, 5);
  assert.equal(publicCar.rating_count, 1);
});
