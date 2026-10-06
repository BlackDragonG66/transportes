import { z } from "zod";
import { pool, one, transaction, fail } from "./db.js";
import { uuid } from "./domain.js";
export const reviewInput = z
  .object({
    segment: z.enum(["interurban", "local"]),
    jobId: uuid.optional(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(500).default(""),
  })
  .strict()
  .superRefine((v, c) => {
    if ((v.segment === "local") !== Boolean(v.jobId))
      c.addIssue({
        code: "custom",
        message: "Selecciona el tramo correcto del viaje.",
      });
  });
export async function saveReview(actor, bookingId, raw, db = pool) {
  uuid.parse(bookingId);
  const v = reviewInput.parse(raw);
  return transaction(async (c) => {
    const b = await one(c, "SELECT * FROM bookings WHERE id=$1 FOR UPDATE", [
      bookingId,
    ]);
    if (!b || b.user_id !== actor.id)
      fail("Solo el cliente del boleto puede calificarlo.", 403);
    if (b.status !== "confirmed") fail("El boleto no está confirmado.", 409);
    let driver;
    if (v.segment === "interurban") {
      const t = await one(c, "SELECT status,driver_id FROM trips WHERE id=$1", [
        b.trip_id,
      ]);
      if (t.status !== "arrived")
        fail("Podrás calificar cuando termine el viaje.", 409);
      driver = t.driver_id;
    } else {
      const j = await one(
        c,
        "SELECT j.status,f.driver_id FROM local_jobs j JOIN last_mile_requests r ON r.id=j.request_id JOIN local_fleet f ON f.id=j.fleet_id WHERE j.id=$1 AND r.booking_id=$2",
        [v.jobId, b.id],
      );
      if (!j) fail("Este traslado no corresponde a tu boleto.", 403);
      if (j.status !== "completed")
        fail("Podrás calificar cuando termine el traslado.", 409);
      driver = j.driver_id;
    }
    const key = v.jobId || "interurban";
    await c.query(
      "INSERT INTO trip_reviews(booking_id,subject_key,segment,job_id,driver_id,rating,comment) VALUES($1,$2,$3,$4,$5,$6,$7) ON DUPLICATE KEY UPDATE rating=VALUES(rating),comment=VALUES(comment),updated_at=now(3)",
      [b.id, key, v.segment, v.jobId ?? null, driver, v.rating, v.comment],
    );
    return one(
      c,
      "SELECT segment,job_id,rating,comment,updated_at FROM trip_reviews WHERE booking_id=$1 AND subject_key=$2",
      [b.id, key],
    );
  }, db);
}
