import { z } from "zod";
export const uuid = z.string().uuid();
const line = z
  .object({ id: uuid, quantity: z.number().int().min(1).max(60) })
  .strict();
export const bookingInput = z
  .object({
    tripId: uuid,
    passengers: z.array(line).min(1).max(20),
    addons: z.array(line).max(20).default([]),
    travelers: z
      .array(
        z
          .object({
            name: z.string().trim().min(3).max(120),
            passengerTypeId: uuid,
          })
          .strict(),
      )
      .min(1)
      .max(60),
    channel: z.enum(["web", "pos"]).default("web"),
    customerId: uuid.optional(),
    cashSessionId: uuid.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const list of [v.passengers, v.addons])
      if (new Set(list.map((x) => x.id)).size !== list.length)
        ctx.addIssue({
          code: "custom",
          message: "No se permiten conceptos duplicados.",
        });
    if (v.channel === "pos" && (!v.customerId || !v.cashSessionId))
      ctx.addIssue({
        code: "custom",
        message: "Taquilla requiere cliente y caja.",
      });
    if (v.channel === "web" && (v.customerId || v.cashSessionId))
      ctx.addIssue({
        code: "custom",
        message: "La reserva web utiliza tu usuario.",
      });
    const n = v.passengers.reduce((s, x) => s + x.quantity, 0);
    if (n > 60)
      ctx.addIssue({ code: "custom", message: "Máximo 60 pasajeros." });
    const named = new Map();
    for (const t of v.travelers)
      named.set(t.passengerTypeId, (named.get(t.passengerTypeId) || 0) + 1);
    if (
      v.travelers.length !== n ||
      named.size !== v.passengers.length ||
      v.passengers.some((p) => named.get(p.id) !== p.quantity)
    )
      ctx.addIssue({
        code: "custom",
        message: "Captura el nombre y la tarifa de cada pasajero.",
      });
  });
export const rapidInput = z
  .object({
    zone: z.string().trim().min(2).max(160),
    passengers: z.number().int().min(1).max(60),
    luggage: z.number().int().min(0).max(120),
    vehicles: z.number().int().min(1).max(60),
  })
  .strict()
  .refine(
    (v) =>
      v.vehicles >= Math.ceil(v.passengers / 4) && v.vehicles <= v.passengers,
    "Se necesita un auto por cada cuatro pasajeros como mínimo.",
  );
export function calculateTotal(passengers, addons, channel) {
  const count = passengers.reduce((s, p) => s + p.quantity, 0);
  const fareCents = passengers.reduce(
    (s, p) => s + p.quantity * p.unit_cents,
    0,
  );
  const addonCents = addons.reduce((s, p) => s + p.quantity * p.unit_cents, 0);
  const feeCents = channel === "web" ? count * 1000 : 0;
  const totalCents = fareCents + addonCents + feeCents;
  if (
    !Number.isSafeInteger(totalCents) ||
    totalCents <= 0 ||
    totalCents > 2147483647
  )
    throw new Error("Total fuera de rango.");
  return { count, fareCents, addonCents, feeCents, totalCents };
}
export function splitLocal(passengers, luggage, vehicles) {
  if (vehicles < Math.ceil(passengers / 4) || vehicles > passengers)
    throw new Error("Capacidad local inválida.");
  return Array.from({ length: vehicles }, (_, i) => ({
    passengers:
      Math.floor(passengers / vehicles) + (i < passengers % vehicles ? 1 : 0),
    luggage: Math.floor(luggage / vehicles) + (i < luggage % vehicles ? 1 : 0),
  }));
}
