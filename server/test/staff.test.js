import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { pool, one, insert } from "../src/db.js";
import { fixture, testDatabase } from "./helpers.js";
import {
  staffArea,
  staffPaths,
  allowedArea,
  staffSections,
} from "../../web/src/staff-routing.js";
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
const call = (u, method, path, body) =>
  request(app)
    [method](`/api${path}`)
    .set("Origin", "http://localhost:5173")
    .set(
      "Cookie",
      `session=${jwt.sign({ sub: u.id }, config.secret, { issuer: "conexiones", audience: "conexiones-web", expiresIn: "1h" })}`,
    )
    .send(body);
test("Portales separados: rutas de equipo, perfil correcto y navegación de pasajeros intacta", () => {
  assert.equal(staffArea("/"), null);
  assert.equal(staffArea("/ticket/abc"), null);
  assert.equal(staffArea("/conductores/"), "drivers");
  assert.equal(staffArea("/cajeros"), "cash");
  assert.equal(staffArea("/administracion"), "admin");
  assert.equal(staffPaths.customer, undefined);
  assert.equal(staffPaths.driver, "/conductores");
  assert.equal(staffPaths.cashier, "/cajeros");
  assert.equal(allowedArea("customer", "drivers"), false);
  assert.equal(allowedArea("cashier", "drivers"), false);
  assert.equal(allowedArea("driver", "cash"), false);
  assert.equal(allowedArea("admin", "cash"), true);
  assert.deepEqual(
    staffSections("drivers", { units: false, local: true }).map(([id]) => id),
    ["taxi", "unidad", "avisos", "cuenta"],
  );
  assert.deepEqual(
    staffSections("drivers", { units: true, local: false }).map(([id]) => id),
    ["unidades", "unidad", "avisos", "cuenta"],
  );
});
test("Perfiles de unidad, taxi y cajero: APIs y datos restringidos a sus permisos", async () => {
  const f = await fixture(db),
    other = await fixture(db);
  const taxi = await insert(db, "users", {
    name: "Taxista de prueba",
    email: `${randomUUID()}@example.com`,
    phone: "0000000000",
    role: "driver",
    password_hash: "test",
  });
  const driver = await insert(db, "drivers", {
    user_id: taxi.id,
    photo_url: "/brand/avatar-roberto.svg",
    license: "DEMO-LOCAL",
  });
  const car = await insert(db, "local_fleet", {
    driver_id: driver.id,
    plate: randomUUID(),
    model: "Taxi de prueba",
    city: "Apatzingán",
    capacity: 4,
    luggage_capacity: 4,
  });
  const pu = (await call(f.driverUser, "get", "/staff/profile").expect(200))
    .body;
  assert.equal(pu.capabilities.units, true);
  assert.equal(pu.capabilities.local, false);
  assert.equal(pu.capabilities.cash, false);
  const pt = (await call(taxi, "get", "/staff/profile").expect(200)).body;
  assert.equal(pt.capabilities.units, false);
  assert.equal(pt.capabilities.local, true);
  assert.equal(pt.fleet[0].id, car.id);
  const pc = (await call(f.cashier, "get", "/staff/profile").expect(200)).body;
  assert.equal(pc.capabilities.cash, true);
  assert.equal(pc.capabilities.units, false);
  assert.equal(pc.capabilities.local, false);
  await call(f.u, "get", "/staff/profile").expect(403);
  await call(f.u, "get", "/operations/trips").expect(403);
  await call(f.u, "get", "/local/jobs").expect(403);
  await call(f.u, "get", "/cash").expect(403);
  await call(f.cashier, "get", "/operations/trips").expect(403);
  await call(f.cashier, "get", "/local/jobs").expect(403);
  await call(taxi, "get", "/cash").expect(403);
  await call(taxi, "get", `/operations/trips/${f.trip.id}/manifest`).expect(
    403,
  );
  const trips = (
    await call(f.driverUser, "get", "/operations/trips").expect(200)
  ).body;
  assert.ok(
    trips.some((t) => t.id === f.trip.id && t.plate === f.vehicle.plate),
  );
  assert.ok(!trips.some((t) => t.id === other.trip.id));
  assert.equal(
    (await call(taxi, "get", "/operations/trips").expect(200)).body.length,
    0,
  );
});
test("Conductor solo consulta; administración registra los estados sin aceptación", async () => {
  const f = await fixture(db),
    other = await fixture(db);
  const admin = await insert(db, "users", {
    name: "Admin operaciones",
    email: `${randomUUID()}@example.com`,
    phone: "0000000000",
    role: "admin",
    password_hash: "test",
  });
  await call(
    f.driverUser,
    "post",
    `/operations/trips/${f.trip.id}/accept`,
    {},
  ).expect(404);
  for (const actor of [f.driverUser, other.driverUser, f.cashier, f.u])
    await call(actor, "patch", `/trips/${f.trip.id}/status`, {
      status: "boarding",
    }).expect(403);
  await call(admin, "patch", `/trips/${f.trip.id}/status`, {
    status: "en_route",
  }).expect(409);
  await call(admin, "patch", `/trips/${f.trip.id}/status`, {
    status: "boarding",
  }).expect(200);
  await db.query(
    "UPDATE trips SET driver_id=$1,departure_at=DATE_ADD(departure_at,INTERVAL 2 DAY),arrival_at=DATE_ADD(arrival_at,INTERVAL 2 DAY) WHERE id=$2",
    [f.driver.id, other.trip.id],
  );
  const blocked = await call(admin, "patch", `/trips/${other.trip.id}/status`, {
    status: "boarding",
  }).expect(409);
  assert.match(blocked.body.error, /conductor tiene otro viaje activo/);
  await call(admin, "patch", `/trips/${f.trip.id}/status`, {
    status: "en_route",
  }).expect(200);
  await call(admin, "patch", `/trips/${f.trip.id}/status`, {
    status: "arrived",
  }).expect(200);
  const history = (
    await call(f.driverUser, "get", "/operations/trips").expect(200)
  ).body;
  assert.equal(history.find((t) => t.id === f.trip.id).status, "arrived");
  await call(admin, "patch", `/trips/${other.trip.id}/status`, {
    status: "boarding",
  }).expect(200);
});
