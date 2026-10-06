import { pool, one } from "./db.js";
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
