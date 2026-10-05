import { pool, one, transaction, fail } from "./db.js";
import { uuid } from "./domain.js";
export async function staffProfile(actor, db = pool) {
  const driver = await one(
    db,
    "SELECT id,photo_url,active FROM drivers WHERE user_id=$1",
    [actor.id],
  );
  const fleet = (
    await db.query(
      "SELECT id,city,model,plate FROM local_fleet WHERE driver_id=$1 AND active",
      [driver?.id ?? null],
    )
  ).rows;
  const assigned =
    driver &&
    (await one(db, "SELECT id FROM trips WHERE driver_id=$1 LIMIT 1", [
      driver.id,
    ]));
  return {
    driver,
    fleet,
    capabilities: {
      units:
        actor.role === "admin" ||
        Boolean(driver?.active && (assigned || !fleet.length)),
      local: actor.role === "admin" || Boolean(driver?.active && fleet.length),
      cash: ["admin", "cashier"].includes(actor.role),
      admin: actor.role === "admin",
    },
  };
}
export async function acceptDeparture(actor, tripId, db = pool) {
  uuid.parse(tripId);
  return transaction(async (c) => {
    await c.query("SELECT id FROM trips WHERE id=$1 FOR UPDATE", [tripId]);
    const t = await one(
      c,
      "SELECT t.*,d.user_id,d.active FROM trips t JOIN drivers d ON d.id=t.driver_id WHERE t.id=$1",
      [tripId],
    );
    if (!t) fail("Salida inexistente.", 404);
    if (actor.role !== "admin" && t.user_id !== actor.id)
      fail("Esta salida está asignada a otro conductor.", 403);
    if (!t.active) fail("El conductor está inactivo.", 409);
    const accepted = await one(
      c,
      "SELECT * FROM trip_driver_acceptances WHERE trip_id=$1 AND driver_id=$2",
      [t.id, t.driver_id],
    );
    if (accepted && t.status !== "cancelled") return accepted;
    if (t.status !== "scheduled")
      fail("Solo puedes aceptar una salida programada.", 409);
    await c.query(
      "INSERT INTO trip_driver_acceptances(trip_id,driver_id,accepted_by) VALUES($1,$2,$3) ON DUPLICATE KEY UPDATE driver_id=VALUES(driver_id),accepted_by=VALUES(accepted_by),accepted_at=now(3)",
      [t.id, t.driver_id, actor.id],
    );
    await c.query(
      "INSERT INTO audit_log(actor_id,action,entity_id) VALUES($1,'trip.accepted',$2)",
      [actor.id, t.id],
    );
    return one(c, "SELECT * FROM trip_driver_acceptances WHERE trip_id=$1", [
      t.id,
    ]);
  }, db);
}
