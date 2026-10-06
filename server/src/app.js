import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { config, integrationStatus } from "./config.js";
import { pool, one, fail, transaction, insert } from "./db.js";
import { auth, role, session, cookieOptions } from "./auth.js";
import { uuid } from "./domain.js";
import { createBooking, notify } from "./bookings.js";
import { openCash, closeCash, cashSales } from "./cash.js";
import {
  demoStatus,
  demoAccounts,
  setupDemo,
  payDemo,
  isDemo,
  markDemo,
} from "./demo.js";
import { expandSchedule, generateSchedule } from "./schedules.js";
import {
  parcelSettings,
  parcelSettingsInput,
  parcelInput,
  quoteParcel,
  reserveParcel,
  parcelAction,
  privateParcel,
  advanceCargo,
} from "./parcels.js";
import {
  createPreference,
  validSignature,
  mpRequest,
  reconcilePayment,
} from "./mercadopago.js";
import {
  acceptLocal,
  requestLastMile,
  advanceLocal,
  arrivalSlot,
} from "./local.js";
import { saveReview } from "./reviews.js";
import { coversArrival, localCities, arrivalCity } from "./local-cities.js";
import { staffProfile } from "./staff.js";
import {
  staffVehicles,
  updateLocalVehicle,
  publicLocalVehicle,
  ensureLocalProfiles,
} from "./staff-vehicles.js";
import { pushSchema } from "./notifications.js";
import {
  getSite,
  saveSettings,
  savePromotion,
  uploadMedia,
  listMedia,
} from "./site.js";
export const app = express();
app.disable("x-powered-by");
if (config.production) app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  }),
);
const json = express.json({ limit: "32kb" });
app.use(
  (req, res, next) =>
    req.path === "/api/admin/media" && req.method === "POST"
      ? next()
      : json(req, res, next),
  cookieParser(),
);
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 150,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use((req, res, next) => {
  if (
    req.path.startsWith("/api") &&
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.path !== "/api/payments/webhook" &&
    req.get("origin") !== new URL(config.appUrl).origin
  )
    fail("Origen no permitido.", 403);
  next();
});
app.get("/api/health", async (req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
});
app.get("/api/integrations", (req, res) => res.json(integrationStatus()));
app.get("/api/demo/status", async (req, res) => res.json(await demoStatus()));
app.get("/api/admin/demo", auth, role("admin"), async (req, res) =>
  res.json({ ...(await demoStatus()), accounts: await demoAccounts() }),
);
app.post("/api/admin/demo/setup", auth, role("admin"), async (req, res) =>
  res.json(await setupDemo(req.user, req.body)),
);
app.post("/api/demo/bookings/:id/pay", auth, async (req, res) =>
  res.json(await payDemo(req.user, req.params.id)),
);
app.post(
  "/api/admin/schedules/preview",
  auth,
  role("admin"),
  async (req, res) => res.json(expandSchedule(req.body)),
);
app.post("/api/admin/schedules", auth, role("admin"), async (req, res) =>
  res
    .status(201)
    .json(
      await generateSchedule(req.user, req.body, req.get("idempotency-key")),
    ),
);
app.get("/api/parcels/settings", async (req, res) =>
  res.json(await parcelSettings()),
);
app.put(
  "/api/admin/parcels/settings",
  auth,
  role("admin"),
  async (req, res) => {
    const v = parcelSettingsInput.parse(req.body);
    await pool.query(
      "UPDATE parcel_settings SET base_cents=$1,included_grams=$2,extra_kg_cents=$3,max_grams=$4,max_side_cm=$5,max_declared_cents=$6 WHERE id=1",
      Object.values(v),
    );
    res.json(await parcelSettings());
  },
);
app.post("/api/parcels/quote", auth, async (req, res) =>
  res.json({
    totalCents: quoteParcel(
      parcelInput.parse(req.body),
      await parcelSettings(),
    ),
  }),
);
app.post("/api/parcels", auth, async (req, res) =>
  res
    .status(201)
    .json(await reserveParcel(req.user, req.body, req.get("idempotency-key"))),
);
app.get("/api/parcels", auth, async (req, res) => {
  const rows = (
    await pool.query(
      `SELECT p.*,r.origin,r.destination,t.departure_at,t.status AS trip_status FROM parcels p JOIN trips t ON t.id=p.trip_id JOIN routes r ON r.id=t.route_id JOIN drivers d ON d.id=t.driver_id WHERE p.user_id=$1 OR $2 OR (d.user_id=$1 AND $3) ORDER BY p.created_at DESC LIMIT 200`,
      [
        req.user.id,
        ["admin", "cashier"].includes(req.user.role),
        req.user.role === "driver",
      ],
    )
  ).rows;
  res.json(rows.map((p) => privateParcel(p, req.user)));
});
app.post("/api/parcels/:id/action", auth, async (req, res) =>
  res.json(await parcelAction(req.user, req.params.id, req.body)),
);
app.get("/api/parcel-tracking/:token", async (req, res) => {
  uuid.parse(req.params.token);
  const p = await one(
    pool,
    "SELECT p.id,p.status,p.is_demo,r.origin,r.destination,t.departure_at,t.arrival_at,t.status AS trip_status FROM parcels p JOIN trips t ON t.id=p.trip_id JOIN routes r ON r.id=t.route_id WHERE p.tracking_token=$1",
    [req.params.token],
  );
  if (!p) fail("Envío inexistente.", 404);
  p.events = (
    await pool.query(
      "SELECT status,created_at FROM parcel_events WHERE parcel_id=$1 ORDER BY id",
      [p.id],
    )
  ).rows;
  res.json(p);
});
app.get("/api/notifications", auth, async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT id,title,body,url,created_at FROM notification_outbox WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30",
        [req.user.id],
      )
    ).rows,
  ),
);
app.get(
  "/api/operations/trips/:id/manifest",
  auth,
  role("driver", "admin"),
  async (req, res) => {
    uuid.parse(req.params.id);
    const t = await one(
      pool,
      "SELECT t.* FROM trips t JOIN drivers d ON d.id=t.driver_id WHERE t.id=$1 AND (d.user_id=$2 OR $3)",
      [req.params.id, req.user.id, req.user.role === "admin"],
    );
    if (!t) fail("Salida no asignada.", 403);
    const bookings = (
      await pool.query(
        "SELECT b.id,b.passengers,b.boarded_at,b.ticket_token,u.name AS customer FROM bookings b JOIN users u ON u.id=b.user_id WHERE b.trip_id=$1 AND b.status='confirmed'",
        [t.id],
      )
    ).rows;
    for (const b of bookings)
      b.travelers = (
        await pool.query(
          "SELECT full_name FROM booking_travelers WHERE booking_id=$1 ORDER BY position",
          [b.id],
        )
      ).rows;
    const parcels = (
      await pool.query(
        "SELECT id,description,grams,recipient_name,status FROM parcels WHERE trip_id=$1 AND paid_at IS NOT NULL AND status<>'cancelled'",
        [t.id],
      )
    ).rows;
    res.json({ trip: t, bookings, parcels });
  },
);
app.get("/api/site", async (req, res) => res.json(await getSite()));
app.get("/api/media/:id", async (req, res) => {
  uuid.parse(req.params.id);
  const media = await one(
    pool,
    "SELECT data,sha256 FROM media_assets WHERE id=$1",
    [req.params.id],
  );
  if (!media) fail("Imagen inexistente.", 404);
  res.set({
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: `"${media.sha256}"`,
    "Content-Type": "image/webp",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.get("if-none-match") === `"${media.sha256}"`)
    return res.sendStatus(304);
  res.send(media.data);
});
function safeUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}
const loginLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((x) => x.toLowerCase()),
  password: z
    .string()
    .min(12)
    .max(72)
    .refine(
      (x) => Buffer.byteLength(x, "utf8") <= 72,
      "Contraseña: máximo 72 bytes.",
    ),
});
app.post("/api/auth/register", loginLimit, async (req, res) => {
  const v = credentials
    .extend({
      name: z.string().trim().min(2).max(120),
      phone: z.string().trim().min(8).max(25),
    })
    .strict()
    .parse(req.body);
  const u = safeUser(
    await insert(pool, "users", {
      name: v.name,
      email: v.email,
      phone: v.phone,
      password_hash: await bcrypt.hash(v.password, 12),
    }),
  );
  session(res, u);
  res.status(201).json(u);
});
app.post("/api/auth/login", loginLimit, async (req, res) => {
  const v = credentials.strict().parse(req.body);
  const u = await one(pool, "SELECT * FROM users WHERE email=$1", [v.email]);
  const valid = await bcrypt.compare(
    v.password,
    u?.password_hash ||
      "$2b$12$QkXSmoRdOgJwBqXU0Lt5iu.uTpPXIXIAWyFdaRvCVfNfLs/Jsa9yW",
  );
  if (!u || !valid) fail("Credenciales inválidas.", 401);
  session(res, u);
  const { password_hash, ...safe } = u;
  res.json({ ...safe, demo: await isDemo(pool, "user", u.id) });
});
app.post("/api/auth/activate", loginLimit, async (req, res) => {
  const v = z
    .object({
      token: z.string().regex(/^[a-f0-9]{64}$/),
      password: credentials.shape.password,
    })
    .strict()
    .parse(req.body);
  const hash = createHash("sha256").update(v.token).digest("hex");
  const password = await bcrypt.hash(v.password, 12);
  const user = await transaction(async (c) => {
    const token = await one(
      c,
      "SELECT * FROM account_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE",
      [hash],
    );
    if (!token) fail("Enlace de acceso vencido o utilizado.", 400);
    await c.query(
      "UPDATE account_tokens SET used_at=now() WHERE token_hash=$1",
      [hash],
    );
    await c.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
      token.user_id,
      password,
    ]);
    return safeUser(
      await one(c, "SELECT * FROM users WHERE id=$1", [token.user_id]),
    );
  });
  session(res, user);
  res.json(user);
});
app.post("/api/auth/recover", loginLimit, async (req, res) => {
  if (!integrationStatus().email)
    fail(
      "La recuperación por correo está pendiente de configuración. Contacta a taquilla.",
      503,
    );
  const { email } = z
    .object({ email: credentials.shape.email })
    .strict()
    .parse(req.body);
  const user = await one(pool, "SELECT id FROM users WHERE email=$1", [email]);
  if (user)
    await transaction(async (c) => {
      const token = randomBytes(32).toString("hex"),
        hash = createHash("sha256").update(token).digest("hex");
      await c.query(
        "INSERT INTO account_tokens(token_hash,user_id,expires_at) VALUES($1,$2,DATE_ADD(now(3),INTERVAL 24 HOUR))",
        [hash, user.id],
      );
      await notify(
        c,
        user.id,
        "Acceso a ConexionES",
        "Este enlace permite establecer tu contraseña y vence en 24 horas.",
        `${config.appUrl}/activate/${token}`,
        `account:${hash}`,
      );
    });
  res.json({
    message: "Si el correo está registrado, recibirás un enlace de acceso.",
  });
});
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("session", { ...cookieOptions, maxAge: undefined });
  res.sendStatus(204);
});
app.get("/api/auth/me", auth, (req, res) => res.json(req.user));
app.get(
  "/api/staff/profile",
  auth,
  role("driver", "cashier", "admin"),
  async (req, res) => res.json(await staffProfile(req.user)),
);
app.get(
  "/api/staff/vehicles",
  auth,
  role("driver", "admin"),
  async (req, res) => {
    res.json(await staffVehicles(req.user));
  },
);
app.patch(
  "/api/staff/local-vehicles/:id",
  auth,
  role("driver", "admin"),
  async (req, res) => {
    res.json(await updateLocalVehicle(req.user, req.params.id, req.body));
  },
);
app.get("/api/taxi/:token", async (req, res) => {
  res.json(await publicLocalVehicle(req.params.token));
});
app.post("/api/bookings/:id/reviews", auth, async (req, res) => {
  res.json(await saveReview(req.user, req.params.id, req.body));
});
app.post("/api/auth/password", auth, loginLimit, async (req, res) => {
  const v = z
    .object({
      currentPassword: credentials.shape.password,
      password: credentials.shape.password,
    })
    .strict()
    .parse(req.body);
  const user = await one(pool, "SELECT password_hash FROM users WHERE id=$1", [
    req.user.id,
  ]);
  if (!(await bcrypt.compare(v.currentPassword, user.password_hash)))
    fail("Contraseña actual incorrecta.", 400);
  await pool.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
    req.user.id,
    await bcrypt.hash(v.password, 12),
  ]);
  res.json({ message: "Contraseña actualizada." });
});
app.get("/api/catalog", async (req, res) => {
  const [routes, types, fares, addons, trips] = await Promise.all([
    pool.query("SELECT * FROM routes WHERE active"),
    pool.query("SELECT * FROM passenger_types"),
    pool.query("SELECT * FROM fares"),
    pool.query("SELECT * FROM addons WHERE active"),
    pool.query(
      `SELECT t.*,r.origin,r.destination,v.brand,v.model,v.plate,EXISTS(SELECT 1 FROM demo_entities de WHERE de.kind='trip' AND de.entity_id=t.id) AS demo,COALESCE(tc.max_packages,0) AS cargo_packages,COALESCE(tc.max_grams,0) AS cargo_grams,t.capacity-COALESCE((SELECT sum(b.passengers) FROM bookings b WHERE b.trip_id=t.id AND (b.status='confirmed' OR (b.status='pending' AND b.expires_at>now()))),0) AS available FROM trips t JOIN routes r ON r.id=t.route_id JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN trip_cargo tc ON tc.trip_id=t.id WHERE t.departure_at>now() AND t.status='scheduled' ORDER BY departure_at`,
    ),
  ]);
  res.json({
    routes: routes.rows,
    types: types.rows,
    fares: fares.rows,
    addons: addons.rows,
    trips: trips.rows,
    integrations: integrationStatus(),
  });
});
app.post("/api/bookings", auth, async (req, res) =>
  res
    .status(201)
    .json(await createBooking(req.user, req.body, req.get("idempotency-key"))),
);
app.get("/api/bookings", auth, async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT b.*,r.origin,r.destination,t.departure_at FROM bookings b JOIN trips t ON t.id=b.trip_id JOIN routes r ON r.id=t.route_id WHERE b.user_id=$1 ORDER BY b.created_at DESC",
        [req.user.id],
      )
    ).rows,
  ),
);
app.post("/api/bookings/:id/last-mile", auth, async (req, res) =>
  res
    .status(201)
    .json(await requestLastMile(req.user, req.params.id, req.body)),
);
app.post("/api/bookings/:id/preference", auth, async (req, res) => {
  uuid.parse(req.params.id);
  res.json(await createPreference(req.user, req.params.id));
});
app.post("/api/payments/webhook", async (req, res) => {
  if (!integrationStatus().payments)
    fail("Los pagos online están pendientes de configuración.", 503);
  const id = req.query["data.id"];
  if (
    typeof id !== "string" ||
    !/^\d+$/.test(id) ||
    !validSignature(id, req.get("x-request-id"), req.get("x-signature"))
  )
    fail("Firma inválida.", 401);
  const payment = await mpRequest(`/v1/payments/${encodeURIComponent(id)}`);
  await reconcilePayment(payment);
  res.sendStatus(200);
});
app.get("/api/cash", auth, role("cashier", "admin"), async (req, res) => {
  const [registers, sessions, customers] = await Promise.all([
    pool.query(
      "SELECT cr.* FROM cash_registers cr WHERE $2 OR EXISTS(SELECT 1 FROM demo_entities WHERE kind='register' AND entity_id=cr.id) = EXISTS(SELECT 1 FROM demo_entities WHERE kind='user' AND entity_id=$1)",
      [req.user.id, req.user.role === "admin"],
    ),
    pool.query(
      "SELECT s.*,u.name AS cashier_name,r.name AS register_name FROM cash_sessions s JOIN users u ON u.id=s.cashier_id JOIN cash_registers r ON r.id=s.register_id WHERE s.cashier_id=$1 OR $2 ORDER BY s.opened_at DESC LIMIT 30",
      [req.user.id, req.user.role === "admin"],
    ),
    pool.query(
      "SELECT id,name,email FROM users WHERE role='customer' ORDER BY name LIMIT 500",
    ),
  ]);
  res.json({
    registers: registers.rows,
    sessions: sessions.rows,
    customers: customers.rows,
  });
});
app.post("/api/cash/open", auth, role("cashier", "admin"), async (req, res) =>
  res.status(201).json(await openCash(req.user, req.body)),
);
app.post(
  "/api/cash/customers",
  auth,
  role("cashier", "admin"),
  async (req, res) => {
    const v = z
      .object({
        name: z.string().trim().min(2).max(120),
        email: z
          .email()
          .max(254)
          .transform((x) => x.toLowerCase()),
        phone: z.string().trim().min(8).max(25),
      })
      .strict()
      .parse(req.body);
    const existing = await one(
      pool,
      "SELECT id,name,email FROM users WHERE email=$1 AND role='customer'",
      [v.email],
    );
    if (existing) return res.json(existing);
    const password = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
    const customer = await transaction(async (c) => {
      const user = safeUser(
        await insert(c, "users", {
          name: v.name,
          email: v.email,
          phone: v.phone,
          password_hash: password,
        }),
      );
      const demo = await isDemo(c, "user", req.user.id);
      if (demo) await markDemo(c, `customer:${user.id}`, "user", user.id);
      const token = randomBytes(32).toString("hex"),
        hash = createHash("sha256").update(token).digest("hex");
      await c.query(
        "INSERT INTO account_tokens(token_hash,user_id,expires_at) VALUES($1,$2,DATE_ADD(now(3),INTERVAL 24 HOUR))",
        [hash, user.id],
      );
      await notify(
        c,
        user.id,
        "Bienvenido a ConexionES",
        "Establece tu contraseña para consultar tus boletos. El enlace vence en 24 horas.",
        `${config.appUrl}/activate/${token}`,
        `account:${hash}`,
      );
      return {
        ...user,
        ...(demo
          ? { activationUrl: `${config.appUrl}/activate/${token}` }
          : {}),
      };
    });
    res.status(201).json(customer);
  },
);
app.post(
  "/api/cash/:id/close",
  auth,
  role("cashier", "admin"),
  async (req, res) =>
    res.json(await closeCash(req.user, req.params.id, req.body)),
);
app.get(
  "/api/cash/:id/report",
  auth,
  role("cashier", "admin"),
  async (req, res) => {
    uuid.parse(req.params.id);
    const s = await one(
      pool,
      "SELECT * FROM cash_sessions WHERE id=$1 AND (cashier_id=$2 OR $3)",
      [req.params.id, req.user.id, req.user.role === "admin"],
    );
    if (!s) fail("Caja inexistente.", 404);
    const sales = await cashSales(pool, s.id);
    res.json({
      ...s,
      sales,
      sales_cents: sales.reduce((n, x) => n + x.amount_cents, 0),
    });
  },
);
app.get("/api/local/jobs", auth, role("driver", "admin"), async (req, res) => {
  const fleet = (
    await pool.query(
      "SELECT f.*,d.user_id AS owner_id,u.name AS driver_name FROM local_fleet f JOIN drivers d ON d.id=f.driver_id JOIN users u ON u.id=d.user_id WHERE (d.user_id=$1 OR $2=1) AND f.active AND d.active",
      [req.user.id, req.user.role === "admin" ? 1 : 0],
    )
  ).rows;
  const jobs = (
    await pool.query(
      `SELECT j.*,p.started_at,p.completed_at,b.trip_id,r.zone,t.arrival_at,rt.destination,f.model,f.plate,f.city,du.name AS driver_name,d.user_id AS owner_id,CASE WHEN d.user_id=$1 OR $2=1 THEN u.name END AS customer_name,CASE WHEN d.user_id=$1 OR $2=1 THEN u.phone END AS customer_phone FROM local_jobs j JOIN last_mile_requests r ON r.id=j.request_id JOIN bookings b ON b.id=r.booking_id JOIN users u ON u.id=b.user_id JOIN trips t ON t.id=b.trip_id JOIN routes rt ON rt.id=t.route_id LEFT JOIN local_job_progress p ON p.job_id=j.id LEFT JOIN local_fleet f ON f.id=j.fleet_id LEFT JOIN drivers d ON d.id=f.driver_id LEFT JOIN users du ON du.id=d.user_id WHERE b.status='confirmed' AND (j.status='waiting' OR d.user_id=$1 OR $2=1) ORDER BY t.arrival_at`,
      [req.user.id, req.user.role === "admin" ? 1 : 0],
    )
  ).rows;
  const used = new Set(
    (
      await pool.query(
        "SELECT a.trip_id FROM local_arrival_assignments a JOIN drivers d ON d.id=a.driver_id WHERE d.user_id=$1",
        [req.user.id],
      )
    ).rows.map((a) => a.trip_id),
  );
  const usedHours = new Set(
    (
      await pool.query(
        "SELECT a.arrival_at FROM local_arrival_slots a JOIN drivers d ON d.id=a.driver_id WHERE d.user_id=$1",
        [req.user.id],
      )
    ).rows.map((a) => arrivalSlot(a.arrival_at)),
  );
  const eligible = jobs.filter(
    (j) =>
      req.user.role === "admin" ||
      j.owner_id === req.user.id ||
      (j.status === "waiting" &&
        !used.has(j.trip_id) &&
        !usedHours.has(arrivalSlot(j.arrival_at)) &&
        fleet.some(
          (f) =>
            coversArrival(f.city, j.destination) &&
            f.capacity >= j.passengers &&
            f.luggage_capacity >= j.luggage,
        )),
  );
  res.json({
    fleet: fleet.map((f) => ({ ...f, owned: f.owner_id === req.user.id })),
    jobs: eligible.map((j) => ({
      ...j,
      owned: j.owner_id === req.user.id,
      service_city: arrivalCity(j.destination),
    })),
  });
});
app.post(
  "/api/local/jobs/:id/accept",
  auth,
  role("driver", "admin"),
  async (req, res) => {
    const v = z.object({ fleetId: uuid }).strict().parse(req.body);
    res.json(await acceptLocal(req.user, req.params.id, v.fleetId));
  },
);
for (const action of ["start", "complete"])
  app.post(
    `/api/local/jobs/:id/${action}`,
    auth,
    role("driver", "admin"),
    async (req, res) => {
      z.object({}).strict().parse(req.body);
      res.json(await advanceLocal(req.user, req.params.id, action));
    },
  );
app.get("/api/push/key", auth, (req, res) =>
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null }),
);
app.post("/api/push/subscribe", auth, async (req, res) => {
  const s = pushSchema.parse(req.body);
  await pool.query(
    "INSERT INTO push_subscriptions(user_id,endpoint,endpoint_hash,subscription) VALUES($1,$2,$3,$4) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),subscription=VALUES(subscription)",
    [
      req.user.id,
      s.endpoint,
      createHash("sha256").update(s.endpoint).digest("hex"),
      JSON.stringify(s),
    ],
  );
  res.sendStatus(201);
});
app.delete("/api/push/subscribe", auth, async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body);
  await pool.query(
    "DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2",
    [endpoint, req.user.id],
  );
  res.sendStatus(204);
});
async function publicTrip(where, value) {
  return one(
    pool,
    `SELECT t.id,t.status,t.departure_at,t.arrival_at,r.origin,r.destination,v.brand,v.model,v.plate,u.name AS driver_name,d.photo_url FROM trips t JOIN routes r ON r.id=t.route_id JOIN vehicles v ON v.id=t.vehicle_id JOIN drivers d ON d.id=t.driver_id JOIN users u ON u.id=d.user_id WHERE ${where} ORDER BY t.departure_at DESC LIMIT 1`,
    [value],
  );
}
app.get("/api/vehicle/:token", async (req, res) => {
  uuid.parse(req.params.token);
  const t = await publicTrip(
    "v.public_token=$1 AND t.status IN ('boarding','en_route')",
    req.params.token,
  );
  if (!t) fail("La unidad no tiene un viaje activo.", 404);
  res.json(t);
});
app.get("/api/tracking/:token", async (req, res) => {
  uuid.parse(req.params.token);
  const t = await publicTrip(
    "t.id IN (SELECT trip_id FROM bookings WHERE share_token=$1)",
    req.params.token,
  );
  if (!t) fail("Enlace inexistente.", 404);
  const local = (
    await pool.query(
      `SELECT j.status,p.started_at,p.completed_at,f.model,f.plate,u.name AS driver_name FROM bookings b JOIN last_mile_requests r ON r.booking_id=b.id JOIN local_jobs j ON j.request_id=r.id LEFT JOIN local_job_progress p ON p.job_id=j.id LEFT JOIN local_fleet f ON f.id=j.fleet_id LEFT JOIN drivers d ON d.id=f.driver_id LEFT JOIN users u ON u.id=d.user_id WHERE b.share_token=$1 ORDER BY j.id`,
      [req.params.token],
    )
  ).rows;
  res.json({ ...t, local });
});
app.get("/api/ticket/:token", auth, async (req, res) => {
  uuid.parse(req.params.token);
  const b = await one(
    pool,
    `SELECT b.* FROM bookings b WHERE ticket_token=$1 AND (user_id=$2 OR created_by=$2 OR $3 OR EXISTS(SELECT 1 FROM trips t JOIN drivers d ON d.id=t.driver_id WHERE t.id=b.trip_id AND d.user_id=$2))`,
    [req.params.token, req.user.id, req.user.role === "admin"],
  );
  if (!b) fail("Boleto inexistente.", 404);
  const trip = await publicTrip("t.id=$1", b.trip_id);
  const local = (
    await pool.query(
      `SELECT j.id,j.status,p.started_at,p.completed_at,j.passengers,j.luggage,r.zone,f.model,f.plate,u.name AS driver_name,u.phone,d.photo_url FROM last_mile_requests r JOIN local_jobs j ON j.request_id=r.id LEFT JOIN local_job_progress p ON p.job_id=j.id LEFT JOIN local_fleet f ON f.id=j.fleet_id LEFT JOIN drivers d ON d.id=f.driver_id LEFT JOIN users u ON u.id=d.user_id WHERE r.booking_id=$1`,
      [b.id],
    )
  ).rows;
  const travelers = (
    await pool.query(
      "SELECT bt.position,bt.full_name,p.name AS passenger_type FROM booking_travelers bt JOIN passenger_types p ON p.id=bt.passenger_type_id WHERE bt.booking_id=$1 ORDER BY bt.position",
      [b.id],
    )
  ).rows;
  const lastMile = await one(
    pool,
    "SELECT * FROM last_mile_requests WHERE booking_id=$1",
    [b.id],
  );
  res.json({
    booking: b,
    canReview: b.user_id === req.user.id && b.status === "confirmed",
    reviews:
      b.user_id === req.user.id
        ? (
            await pool.query(
              "SELECT segment,job_id,rating,comment FROM trip_reviews WHERE booking_id=$1",
              [b.id],
            )
          ).rows
        : [],
    isDemo: await isDemo(pool, "trip", b.trip_id),
    trip,
    local,
    lastMile,
    travelers,
    canRequestLocal:
      b.status === "confirmed" &&
      (b.user_id === req.user.id ||
        b.created_by === req.user.id ||
        req.user.role === "admin"),
    integrations: integrationStatus(),
    qr: await QRCode.toDataURL(`${config.appUrl}/ticket/${b.ticket_token}`),
  });
});
app.post("/api/ticket/:token/board", auth, role("admin"), async (req, res) => {
  uuid.parse(req.params.token);
  const b = await transaction(async (c) => {
    const lookup = await one(
      c,
      "SELECT trip_id FROM bookings WHERE ticket_token=$1",
      [req.params.token],
    );
    if (!lookup) fail("Boleto no válido.", 409);
    await c.query("SELECT id FROM trips WHERE id=$1 FOR UPDATE", [
      lookup.trip_id,
    ]);
    const b = await one(
      c,
      "SELECT * FROM bookings WHERE ticket_token=$1 FOR UPDATE",
      [req.params.token],
    );
    if (!b || b.status !== "confirmed") fail("Boleto no válido.", 409);
    const trip = await one(
      c,
      "SELECT t.*,d.user_id FROM trips t JOIN drivers d ON d.id=t.driver_id WHERE t.id=$1",
      [b.trip_id],
    );
    if (req.user.role !== "admin" && trip.user_id !== req.user.id)
      fail("No eres el conductor de este viaje.", 403);
    if (trip.status !== "boarding") fail("El viaje no está en abordaje.", 409);
    if (b.boarded_at) fail("Boleto ya utilizado.", 409);
    await c.query("UPDATE bookings SET boarded_at=now(3) WHERE id=$1", [b.id]);
    return one(c, "SELECT * FROM bookings WHERE id=$1", [b.id]);
  });
  res.json(b);
});
app.get("/api/admin/site", auth, role("admin"), async (req, res) =>
  res.json(await getSite(true)),
);
app.put("/api/admin/site", auth, role("admin"), async (req, res) =>
  res.json(await saveSettings(req.user, req.body)),
);
app.post("/api/admin/promotions", auth, role("admin"), async (req, res) =>
  res.status(201).json(await savePromotion(req.user, null, req.body)),
);
app.put("/api/admin/promotions/:id", auth, role("admin"), async (req, res) =>
  res.json(await savePromotion(req.user, req.params.id, req.body)),
);
app.get("/api/admin/media", auth, role("admin"), async (req, res) =>
  res.json(await listMedia()),
);
app.post(
  "/api/admin/media",
  auth,
  role("admin"),
  express.json({ limit: "6mb" }),
  async (req, res) =>
    res.status(201).json(await uploadMedia(req.user, req.body)),
);
app.post("/api/admin/users", auth, role("admin"), async (req, res) => {
  const v = credentials
    .extend({
      name: z.string().trim().min(2).max(120),
      phone: z.string().trim().min(8).max(25),
      role: z.enum(["admin", "cashier", "driver"]),
    })
    .strict()
    .parse(req.body);
  const { password, ...fields } = v;
  const u = await insert(pool, "users", {
    ...fields,
    password_hash: await bcrypt.hash(password, 12),
  });
  res.status(201).json(safeUser(u));
});
app.get("/api/admin/users", auth, role("admin"), async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT id,name,email,phone,role FROM users WHERE role<>'customer' ORDER BY name",
      )
    ).rows,
  ),
);
app.get("/api/admin/resources", auth, role("admin"), async (req, res) => {
  const names = [
    "routes",
    "passenger_types",
    "fares",
    "addons",
    "vehicles",
    "drivers",
    "local_fleet",
    "trips",
  ];
  const result = {};
  for (const name of names)
    result[name] = (await pool.query(`SELECT * FROM ${name}`)).rows;
  result.driverUsers = (
    await pool.query(
      "SELECT id,name FROM users WHERE role IN ('driver','admin')",
    )
  ).rows;
  res.json(result);
});
const positive = z.number().int().min(1),
  money = z.number().int().min(0).max(100000000);
const adminSchemas = {
  routes: z.object({
    origin: z.string().min(2).max(120),
    destination: z.string().min(2).max(120),
    kind: z.enum(["interurban", "airport", "medical"]),
    active: z.boolean().default(true),
  }),
  passenger_types: z.object({ name: z.string().min(2).max(120) }),
  addons: z.object({
    name: z.string().min(2).max(120),
    price_cents: money,
    active: z.boolean().default(true),
  }),
  vehicles: z.object({
    brand: z.string().min(2),
    model: z.string().min(2),
    plate: z.string().min(3),
    capacity: positive.max(60),
    active: z.boolean().default(true),
  }),
  drivers: z.object({
    user_id: uuid,
    photo_url: z
      .string()
      .url()
      .refine((x) => new URL(x).protocol === "https:"),
    license: z.string().min(3),
    active: z.boolean().default(true),
  }),
  local_fleet: z.object({
    driver_id: uuid,
    plate: z.string().min(3),
    model: z.string().min(2),
    city: z.enum(localCities),
    capacity: positive.max(4),
    luggage_capacity: z.number().int().min(0).max(30),
    active: z.boolean().default(true),
  }),
  trips: z.object({
    route_id: uuid,
    vehicle_id: uuid,
    driver_id: uuid,
    departure_at: z.iso.datetime({ offset: true }),
    arrival_at: z.iso.datetime({ offset: true }),
    capacity: positive.max(60),
  }),
};
app.post("/api/admin/fares", auth, role("admin"), async (req, res) => {
  const v = z
    .object({ route_id: uuid, passenger_type_id: uuid, price_cents: money })
    .strict()
    .parse(req.body);
  await pool.query(
    "INSERT INTO fares VALUES($1,$2,$3) ON DUPLICATE KEY UPDATE price_cents=VALUES(price_cents)",
    Object.values(v),
  );
  res.json(
    await one(
      pool,
      "SELECT * FROM fares WHERE route_id=$1 AND passenger_type_id=$2",
      [v.route_id, v.passenger_type_id],
    ),
  );
});
app.post("/api/admin/:table", auth, role("admin"), async (req, res) => {
  const table = req.params.table,
    schema = adminSchemas[table];
  if (!schema) fail("Recurso inválido.", 404);
  const v = schema.strict().parse(req.body);
  const result = await transaction(async (c) => {
    if (table === "trips") {
      const vehicle = await one(
        c,
        "SELECT * FROM vehicles WHERE id=$1 AND active FOR UPDATE",
        [v.vehicle_id],
      );
      if (!vehicle || v.capacity > vehicle.capacity)
        fail("Capacidad de unidad insuficiente.");
      const driver = await one(
        c,
        "SELECT * FROM drivers WHERE id=$1 AND active FOR UPDATE",
        [v.driver_id],
      );
      if (!driver) fail("Conductor no disponible.");
      if (
        new Date(v.arrival_at) <= new Date(v.departure_at) ||
        new Date(v.departure_at) <= new Date()
      )
        fail("Fechas de viaje inválidas.");
      const overlap = await one(
        c,
        `SELECT id FROM trips WHERE status<>'cancelled' AND (vehicle_id=$1 OR driver_id=$2) AND departure_at<$4 AND arrival_at>$3 LIMIT 1`,
        [v.vehicle_id, v.driver_id, v.departure_at, v.arrival_at],
      );
      if (overlap) fail("Conductor o unidad ocupados en ese horario.", 409);
    }
    if (table === "drivers") {
      const u = await one(
        c,
        "SELECT id FROM users WHERE id=$1 AND role IN ('driver','admin')",
        [v.user_id],
      );
      if (!u) fail("El usuario debe ser conductor.");
    }
    if (table === "trips") {
      v.departure_at = new Date(v.departure_at);
      v.arrival_at = new Date(v.arrival_at);
    }
    const row = await insert(c, table, v);
    if (table === "local_fleet") await ensureLocalProfiles(c);
    if (table === "trips") {
      await c.query("INSERT INTO trip_cargo VALUES($1,20,100000)", [row.id]);
      if (
        (await isDemo(c, "vehicle", v.vehicle_id)) ||
        (await isDemo(c, "driver", v.driver_id))
      )
        await c.query("INSERT INTO demo_entities VALUES($1,'trip',$2)", [
          `trip:${row.id}`,
          row.id,
        ]);
    }
    return row;
  });
  res.status(201).json(result);
});
app.patch("/api/admin/addons/:id", auth, role("admin"), async (req, res) => {
  uuid.parse(req.params.id);
  const v = adminSchemas.addons.strict().parse(req.body);
  await pool.query(
    "UPDATE addons SET name=$2,price_cents=$3,active=$4 WHERE id=$1",
    [req.params.id, v.name, v.price_cents, v.active],
  );
  const addon = await one(pool, "SELECT * FROM addons WHERE id=$1", [
    req.params.id,
  ]);
  if (!addon) fail("Complemento inexistente.", 404);
  res.json(addon);
});
app.patch("/api/trips/:id/status", auth, role("admin"), async (req, res) => {
  uuid.parse(req.params.id);
  const { status } = z
    .object({ status: z.enum(["boarding", "en_route", "arrived"]) })
    .strict()
    .parse(req.body);
  res.json(
    await transaction(async (c) => {
      const lookup = await one(
        c,
        "SELECT vehicle_id,driver_id FROM trips WHERE id=$1",
        [req.params.id],
      );
      if (!lookup) fail("Viaje inexistente.", 404);
      await c.query("SELECT id FROM vehicles WHERE id=$1 FOR UPDATE", [
        lookup.vehicle_id,
      ]);
      await c.query("SELECT id FROM drivers WHERE id=$1 FOR UPDATE", [
        lookup.driver_id,
      ]);
      await c.query("SELECT id FROM trips WHERE id=$1 FOR UPDATE", [
        req.params.id,
      ]);
      const t = await one(
        c,
        "SELECT t.*,d.user_id FROM trips t JOIN drivers d ON d.id=t.driver_id WHERE t.id=$1",
        [req.params.id],
      );
      if (req.user.role !== "admin" && t.user_id !== req.user.id)
        fail("No eres el conductor.", 403);
      if (
        { scheduled: "boarding", boarding: "en_route", en_route: "arrived" }[
          t.status
        ] !== status
      )
        fail("Transición inválida.", 409);
      // A physical unit can expose only one active trip through its QR.
      if (
        status === "boarding" &&
        (await one(
          c,
          "SELECT id FROM trips WHERE driver_id=$1 AND id<>$2 AND status IN ('boarding','en_route')",
          [t.driver_id, t.id],
        ))
      )
        fail("El conductor tiene otro viaje activo.", 409);
      if (
        status === "boarding" &&
        (await one(
          c,
          "SELECT id FROM trips WHERE vehicle_id=$1 AND id<>$2 AND status IN ('boarding','en_route')",
          [t.vehicle_id, t.id],
        ))
      )
        fail("La unidad tiene otro viaje activo.", 409);
      await c.query("UPDATE trips SET status=$2 WHERE id=$1", [t.id, status]);
      await advanceCargo(c, t, status, req.user);
      return one(c, "SELECT * FROM trips WHERE id=$1", [t.id]);
    }),
  );
});
app.get(
  "/api/operations/trips",
  auth,
  role("driver", "admin"),
  async (req, res) =>
    res.json(
      (
        await pool.query(
          `SELECT t.*,r.origin,r.destination,v.brand,v.model,v.plate,u.name AS driver_name FROM trips t JOIN routes r ON r.id=t.route_id JOIN vehicles v ON v.id=t.vehicle_id JOIN drivers d ON d.id=t.driver_id JOIN users u ON u.id=d.user_id WHERE ($2 OR d.user_id=$1) AND t.status<>'cancelled' AND (t.departure_at>=DATE_SUB(now(),INTERVAL 30 DAY) OR t.status IN ('boarding','en_route')) ORDER BY departure_at LIMIT 600`,
          [req.user.id, req.user.role === "admin"],
        )
      ).rows,
    ),
);
app.get("/api/admin/vehicle/:id/qr", auth, role("admin"), async (req, res) => {
  uuid.parse(req.params.id);
  const v = await one(pool, "SELECT public_token FROM vehicles WHERE id=$1", [
    req.params.id,
  ]);
  if (!v) fail("Unidad inexistente.", 404);
  res.json({
    url: `${config.appUrl}/vehicle/${v.public_token}`,
    qr: await QRCode.toDataURL(`${config.appUrl}/vehicle/${v.public_token}`),
  });
});
app.get("/api/admin/refunds", auth, role("admin"), async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT b.id,b.total_cents,p.provider_id FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE b.status='refund_required' AND p.status='approved'",
      )
    ).rows,
  ),
);
app.post("/api/admin/refunds/:id", auth, role("admin"), async (req, res) => {
  uuid.parse(req.params.id);
  const b = await one(
    pool,
    "SELECT b.*,p.provider_id FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE b.id=$1 AND b.status='refund_required' AND p.status='approved'",
    [req.params.id],
  );
  if (!b) fail("Reembolso no disponible.", 409);
  await mpRequest(`/v1/payments/${b.provider_id}/refunds`, {
    method: "POST",
    headers: { "X-Idempotency-Key": `refund-${b.id}` },
    body: "{}",
  });
  await reconcilePayment(await mpRequest(`/v1/payments/${b.provider_id}`));
  res.json({ ok: true });
});
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Endpoint inexistente." }),
);
app.use((error, req, res, next) => {
  if (error instanceof z.ZodError)
    return res
      .status(400)
      .json({ error: error.issues.map((x) => x.message).join(" ") });
  if (error.code === "ER_DUP_ENTRY")
    return res
      .status(409)
      .json({ error: "El registro ya existe o el recurso está ocupado." });
  if (
    [
      "ER_NO_REFERENCED_ROW_2",
      "ER_ROW_IS_REFERENCED_2",
      "ER_CHECK_CONSTRAINT_VIOLATED",
      "ER_INCORRECT_TYPE",
      "ER_DATA_TOO_LONG",
      "WARN_DATA_TRUNCATED",
      "ER_TRUNCATED_WRONG_VALUE",
    ].includes(error.code) ||
    error.errno === 4025
  )
    return res.status(400).json({ error: "Datos o relaciones inválidos." });
  if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code))
    return res.status(409).json({
      error:
        "El recurso está ocupado. Intenta de nuevo con la misma solicitud.",
    });
  if (error.type === "entity.parse.failed")
    return res.status(400).json({ error: "JSON inválido." });
  if (!error.status) console.error(error);
  res.status(error.status || 500).json({
    error: error.status ? error.message : "Error interno. Intenta de nuevo.",
  });
});
