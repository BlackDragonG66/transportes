import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { testDatabase, fixture, travelers } from "./helpers.js";
import {
  getSite,
  saveSettings,
  savePromotion,
  uploadMedia,
  listMedia,
} from "../src/site.js";
import { migrate } from "../src/migrate.js";
import { pool } from "../src/db.js";
import { requestLastMile } from "../src/local.js";
import { createBooking } from "../src/bookings.js";
import { reconcilePayment } from "../src/mercadopago.js";
import { randomUUID } from "node:crypto";
let db;
before(async () => {
  db = await testDatabase();
  await migrate(db);
});
after(async () => {
  await db?.end();
  await pool.end();
});
test("contenido editable, programación de anuncios y migración preservan cambios", async () => {
  const f = await fixture(db),
    site = await getSite(true, db),
    settings = {
      ...site.settings,
      heroTitle: "Portada configurada desde el panel",
    };
  await saveSettings(f.u, settings, db);
  await migrate(db);
  assert.equal(
    (await getSite(false, db)).settings.heroTitle,
    settings.heroTitle,
  );
  const p = {
    title: "Anuncio programado",
    subtitle: "Prueba",
    image_url: "/brand/publi-1.jpg",
    button_label: "Reservar",
    href: "#reservar",
    placement: "promotion",
    sort_order: 15,
    active: true,
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    ends_at: null,
  };
  const ad = await savePromotion(f.u, null, p, db);
  assert(!(await getSite(false, db)).promotions.some((x) => x.id === ad.id));
  await savePromotion(f.u, ad.id, { ...p, starts_at: null }, db);
  assert((await getSite(false, db)).promotions.some((x) => x.id === ad.id));
  await savePromotion(f.u, ad.id, { ...p, starts_at: null, active: false }, db);
  assert(!(await getSite(false, db)).promotions.some((x) => x.id === ad.id));
  await assert.rejects(
    savePromotion(f.u, null, { ...p, href: "javascript:alert(1)" }, db),
  );
  await assert.rejects(
    saveSettings(
      f.u,
      { ...settings, logoUrl: "https://evil.example/logo.svg" },
      db,
    ),
  );
});
test("imágenes normalizadas, deduplicadas y persistentes en MySQL", async () => {
  const f = await fixture(db),
    bytes = await sharp({
      create: { width: 80, height: 40, channels: 3, background: "#653397" },
    })
      .png()
      .toBuffer();
  const input = { filename: "test.png", base64: bytes.toString("base64") };
  const first = await uploadMedia(f.u, input, db),
    second = await uploadMedia(f.u, input, db);
  assert.equal(first.id, second.id);
  assert.equal(first.width, 80);
  assert.equal(first.height, 40);
  assert((await listMedia(db)).some((x) => x.id === first.id));
  await migrate(db);
  const stored = (
    await db.query("SELECT data FROM media_assets WHERE id=$1", [first.id])
  ).rows[0];
  assert.equal((await sharp(stored.data).metadata()).format, "webp");
  await assert.rejects(
    uploadMedia(
      f.u,
      {
        filename: "bad.svg",
        base64: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
        ).toString("base64"),
      },
      db,
    ),
    /JPG/,
  );
  await assert.rejects(
    uploadMedia(
      f.u,
      {
        filename: "bad.jpg",
        base64: Buffer.from("not an image").toString("base64"),
      },
      db,
    ),
    /válida/,
  );
});
test("taxi solo después de pago verificado, solicitud concurrente única y nombres persistidos", async () => {
  const f = await fixture(db, 8),
    b = await createBooking(
      f.u,
      {
        tripId: f.trip.id,
        passengers: [{ id: f.type.id, quantity: 5 }],
        travelers: travelers(f.type.id, 5),
      },
      randomUUID(),
      db,
    ),
    input = { zone: "Centro", passengers: 5, luggage: 3, vehicles: 2 };
  assert.equal(
    (
      await db.query("SELECT * FROM booking_travelers WHERE booking_id=$1", [
        b.id,
      ])
    ).rows.length,
    5,
  );
  assert.equal(
    (
      await db.query("SELECT * FROM last_mile_requests WHERE booking_id=$1", [
        b.id,
      ])
    ).rows.length,
    0,
  );
  await assert.rejects(requestLastMile(f.u, b.id, input, db), /pago/);
  await reconcilePayment(
    {
      id: randomUUID(),
      collector_id: 123,
      external_reference: b.id,
      status: "approved",
      currency_id: "MXN",
      transaction_amount: 1300,
    },
    db,
  );
  await assert.rejects(
    requestLastMile(f.u, b.id, { ...input, vehicles: 1 }, db),
  );
  await assert.rejects(
    requestLastMile(f.cashier, b.id, input, db),
    /inexistente/,
  );
  const requests = await Promise.all(
    Array.from({ length: 5 }, () => requestLastMile(f.u, b.id, input, db)),
  );
  assert.equal(new Set(requests.map((r) => r.id)).size, 1);
  const jobs = (
    await db.query(
      "SELECT j.* FROM local_jobs j JOIN last_mile_requests r ON r.id=j.request_id WHERE r.booking_id=$1",
      [b.id],
    )
  ).rows;
  assert.equal(jobs.length, 2);
  assert(jobs.every((j) => j.passengers <= 4));
  await assert.rejects(
    requestLastMile(f.u, b.id, { ...input, zone: "Otra zona" }, db),
    /ya tiene/,
  );
});
test("alta inicial crea admin y conserva su contraseña en siguientes despliegues", async () => {
  const oldEmail = process.env.BOOTSTRAP_ADMIN_EMAIL,
    oldHash = process.env.BOOTSTRAP_ADMIN_PASSWORD_HASH;
  const email = `${randomUUID()}@example.com`,
    hash = "$2b$12$QkXSmoRdOgJwBqXU0Lt5iu.uTpPXIXIAWyFdaRvCVfNfLs/Jsa9yW";
  try {
    process.env.BOOTSTRAP_ADMIN_EMAIL = email;
    process.env.BOOTSTRAP_ADMIN_PASSWORD_HASH = hash;
    await migrate(db);
    const user = (
      await db.query("SELECT role,password_hash FROM users WHERE email=$1", [
        email,
      ])
    ).rows[0];
    assert.equal(user.role, "admin");
    assert.equal(user.password_hash, hash);
    await db.query("UPDATE users SET password_hash=$2 WHERE email=$1", [
      email,
      "changed-password-hash",
    ]);
    await migrate(db);
    assert.equal(
      (
        await db.query("SELECT password_hash FROM users WHERE email=$1", [
          email,
        ])
      ).rows[0].password_hash,
      "changed-password-hash",
    );
    const f = await fixture(db);
    process.env.BOOTSTRAP_ADMIN_EMAIL = f.u.email;
    await assert.rejects(migrate(db), /sin permisos/);
    assert.equal(
      (await db.query("SELECT role FROM users WHERE id=$1", [f.u.id])).rows[0]
        .role,
      "customer",
    );
  } finally {
    for (const [key, value] of [
      ["BOOTSTRAP_ADMIN_EMAIL", oldEmail],
      ["BOOTSTRAP_ADMIN_PASSWORD_HASH", oldHash],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
