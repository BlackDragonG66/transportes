import { z } from "zod";
import { uuid } from "./domain.js";
import { transaction, one, fail, pool, insert } from "./db.js";
import { isDemo } from "./demo.js";
export async function cashSales(db, id) {
  return (
    await db.query(
      `SELECT b.id,b.passengers,b.created_at,p.amount_cents,'Boleto' AS concept,0 AS is_demo FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE b.cash_session_id=$1 AND p.provider='cash' AND p.status='approved'
 UNION ALL SELECT b.id,b.passengers,b.created_at,p.amount_cents,'Boleto DEMO',1 FROM bookings b JOIN demo_payments p ON p.booking_id=b.id WHERE b.cash_session_id=$1 AND p.method='pos'
 UNION ALL SELECT id,0,created_at,total_cents,'Paquetería',is_demo FROM parcels WHERE cash_session_id=$1 AND paid_at IS NOT NULL ORDER BY created_at`,
      [id],
    )
  ).rows;
}
const cents = z.number().int().min(0).max(2147483647);
export async function openCash(actor, raw, db = pool) {
  const input = z
    .object({ registerId: uuid, openingCents: cents })
    .strict()
    .parse(raw);
  return transaction(async (c) => {
    if (
      !(await one(c, "SELECT id FROM cash_registers WHERE id=$1 FOR UPDATE", [
        input.registerId,
      ]))
    )
      fail("Caja inexistente.", 404);
    const demo = await isDemo(c, "register", input.registerId);
    if (actor.role !== "admin" && demo !== (await isDemo(c, "user", actor.id)))
      fail("Elige una caja correspondiente a tu cuenta de demostración.", 403);
    const s = await insert(c, "cash_sessions", {
      register_id: input.registerId,
      cashier_id: actor.id,
      opening_cents: input.openingCents,
    });
    await c.query(
      "INSERT INTO audit_log(actor_id,action,entity_id) VALUES($1,'cash.opened',$2)",
      [actor.id, s.id],
    );
    return s;
  }, db);
}
export async function closeCash(actor, id, raw, db = pool) {
  uuid.parse(id);
  const { countedCents } = z
    .object({ countedCents: cents })
    .strict()
    .parse(raw);
  return transaction(async (c) => {
    const s = await one(
      c,
      "SELECT * FROM cash_sessions WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!s || s.cashier_id !== actor.id) fail("Caja no disponible.", 403);
    if (s.closed_at) fail("Caja ya cerrada.", 409);
    const rows = await cashSales(c, id),
      sales = {
        cents: rows.reduce((n, p) => n + p.amount_cents, 0),
        count: rows.length,
      };
    await c.query(
      "UPDATE cash_sessions SET closed_at=now(3),counted_cents=$2,expected_cents=opening_cents+$3,difference_cents=$2-opening_cents-$3 WHERE id=$1",
      [id, countedCents, sales.cents],
    );
    const result = await one(c, "SELECT * FROM cash_sessions WHERE id=$1", [
      id,
    ]);
    await c.query(
      "INSERT INTO audit_log(actor_id,action,entity_id,metadata) VALUES($1,'cash.closed',$2,$3)",
      [actor.id, id, JSON.stringify(sales)],
    );
    return {
      ...result,
      sales: rows,
      salesCents: sales.cents,
      transactions: sales.count,
    };
  }, db);
}
