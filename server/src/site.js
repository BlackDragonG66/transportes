import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { pool, one, fail, transaction } from "./db.js";
import { uuid } from "./domain.js";
import { defaultSettings } from "./site-defaults.js";
const image = z
  .string()
  .max(600)
  .refine(
    (v) =>
      /^\/brand\/[a-z0-9.-]+$/i.test(v) ||
      /^\/api\/media\/[a-f0-9-]{36}$/i.test(v),
    "Selecciona una imagen de la biblioteca.",
  );
const link = z
  .string()
  .max(600)
  .refine(
    (v) =>
      /^#[a-z][a-z0-9-]*$/i.test(v) ||
      /^\/(?!\/)[a-z0-9/_?#=&%-]*$/i.test(v) ||
      /^tel:\+?\d{8,15}$/.test(v) ||
      (() => {
        try {
          const u = new URL(v);
          return u.protocol === "https:" && !u.username && !u.password;
        } catch {
          return false;
        }
      })(),
    "Usa un enlace HTTPS o una ruta del sitio.",
  );
export const settingsSchema = z
  .object({
    logoUrl: image,
    heroImageUrl: image,
    announcement: z.string().max(180),
    heroEyebrow: z.string().max(80),
    heroTitle: z.string().min(3).max(150),
    heroSubtitle: z.string().max(350),
    promotionsTitle: z.string().max(120),
    promotionsSubtitle: z.string().max(300),
    phones: z
      .array(z.string().regex(/^\+?\d{8,15}$/))
      .min(1)
      .max(5),
    facebookUrl: link,
    offices: z
      .array(
        z
          .object({
            city: z.string().min(2).max(80),
            address: z.string().min(3).max(250),
          })
          .strict(),
      )
      .max(8),
    faqs: z
      .array(
        z
          .object({
            question: z.string().min(3).max(150),
            answer: z.string().min(3).max(600),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export const promotionSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    subtitle: z.string().max(300),
    image_url: image,
    button_label: z.string().min(1).max(60),
    href: link,
    placement: z.enum(["banner", "promotion"]),
    sort_order: z.number().int().min(-1000).max(1000),
    active: z.boolean(),
    starts_at: z.iso.datetime({ offset: true }).nullable(),
    ends_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .refine(
    (v) =>
      !v.starts_at || !v.ends_at || new Date(v.ends_at) > new Date(v.starts_at),
    "El fin debe ser posterior al inicio.",
  );
export async function getSite(admin = false, db = pool) {
  const [settings, promotions] = await Promise.all([
    one(db, "SELECT settings FROM site_settings WHERE id='main'"),
    db.query(
      `SELECT * FROM site_promotions ${admin ? "" : "WHERE active AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now())"} ORDER BY sort_order,id`,
    ),
  ]);
  return {
    settings: settings?.settings || defaultSettings,
    promotions: promotions.rows,
  };
}
export async function saveSettings(actor, raw, db = pool) {
  const v = settingsSchema.parse(raw);
  return transaction(async (c) => {
    await c.query(
      "UPDATE site_settings SET settings=$1,updated_by=$2,updated_at=now(3) WHERE id='main'",
      [JSON.stringify(v), actor.id],
    );
    await c.query(
      "INSERT INTO audit_log(actor_id,action,entity_id) VALUES($1,'site.settings.updated','00000001-0000-4000-8000-000000000000')",
      [actor.id],
    );
    return v;
  }, db);
}
export async function savePromotion(actor, id, raw, db = pool) {
  const v = promotionSchema.parse(raw);
  if (id) uuid.parse(id);
  const promotionId = id || randomUUID();
  return transaction(async (c) => {
    if (
      id &&
      !(await one(c, "SELECT id FROM site_promotions WHERE id=$1 FOR UPDATE", [
        id,
      ]))
    )
      fail("Anuncio inexistente.", 404);
    const values = [
      v.title,
      v.subtitle,
      v.image_url,
      v.button_label,
      v.href,
      v.placement,
      v.sort_order,
      v.active,
      v.starts_at ? new Date(v.starts_at) : null,
      v.ends_at ? new Date(v.ends_at) : null,
      actor.id,
      promotionId,
    ];
    if (id)
      await c.query(
        "UPDATE site_promotions SET title=$1,subtitle=$2,image_url=$3,button_label=$4,href=$5,placement=$6,sort_order=$7,active=$8,starts_at=$9,ends_at=$10,updated_by=$11 WHERE id=$12",
        values,
      );
    else
      await c.query(
        "INSERT INTO site_promotions(title,subtitle,image_url,button_label,href,placement,sort_order,active,starts_at,ends_at,updated_by,id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        values,
      );
    await c.query(
      "INSERT INTO audit_log(actor_id,action,entity_id) VALUES($1,'site.promotion.saved',$2)",
      [actor.id, promotionId],
    );
    return one(c, "SELECT * FROM site_promotions WHERE id=$1", [promotionId]);
  }, db);
}
export async function uploadMedia(actor, raw, db = pool) {
  const v = z
    .object({
      filename: z.string().min(1).max(120),
      base64: z
        .string()
        .max(5600000)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .strict()
    .parse(raw);
  const bytes = Buffer.from(v.base64, "base64");
  if (bytes.length > 4 * 1024 * 1024)
    fail("La imagen debe pesar menos de 4 MB.", 413);
  let result;
  try {
    const pipeline = sharp(bytes, {
      limitInputPixels: 24000000,
      failOn: "warning",
      animated: false,
    });
    const meta = await pipeline.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format) || meta.pages > 1)
      fail("Usa JPG, PNG o WebP sin animación.");
    result = await pipeline
      .rotate()
      .resize({
        width: 1920,
        height: 1920,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 86 })
      .toBuffer({ resolveWithObject: true });
  } catch (e) {
    if (e.status) throw e;
    fail("La imagen no es válida o excede las dimensiones permitidas.");
  }
  const hash = createHash("sha256").update(result.data).digest("hex"),
    id = randomUUID();
  await db.query(
    "INSERT INTO media_assets(id,filename,sha256,width,height,byte_size,data,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON DUPLICATE KEY UPDATE sha256=sha256",
    [
      id,
      v.filename,
      hash,
      result.info.width,
      result.info.height,
      result.data.length,
      result.data,
      actor.id,
    ],
  );
  const asset = await one(
    db,
    "SELECT id,filename,width,height,byte_size FROM media_assets WHERE sha256=$1",
    [hash],
  );
  return { ...asset, url: `/api/media/${asset.id}` };
}
export async function listMedia(db = pool) {
  return (
    await db.query(
      "SELECT id,filename,width,height,byte_size,created_at FROM media_assets ORDER BY created_at DESC LIMIT 200",
    )
  ).rows.map((a) => ({ ...a, url: `/api/media/${a.id}` }));
}
