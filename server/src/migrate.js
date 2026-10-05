import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool, one } from "./db.js";
import { seedSite } from "./site-defaults.js";
export async function migrate(db = pool) {
  const c = await db.connect();
  let locked = false;
  try {
    const lock = await one(
      c,
      "SELECT GET_LOCK(SHA2(CONCAT(DATABASE(),':conexiones-migrate'),256),30) AS acquired",
    );
    if (!lock?.acquired) throw new Error("Otra migración está en curso.");
    locked = true;
    // MySQL DDL auto-commits. Idempotent tables let an interrupted install be resumed.
    for (const file of ["schema.sql", "seed.sql"]) {
      const sql = await readFile(
        new URL(`../../database/${file}`, import.meta.url),
        "utf8",
      );
      const clean = sql.replace(/^\s*--.*$/gm, "");
      for (const statement of clean
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean))
        await c.query(statement);
    }
    await seedSite(c);
    // Bootstrap is opt-in, takes only a bcrypt hash, and never replaces an existing admin.
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL,
      hash = process.env.BOOTSTRAP_ADMIN_PASSWORD_HASH;
    if (email && hash) {
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(hash)
      )
        throw new Error("Datos de administrador inicial inválidos.");
      const admin = await one(c, "SELECT id,role FROM users WHERE email=$1", [
        email.toLowerCase(),
      ]);
      if (admin && admin.role !== "admin")
        throw new Error(
          "El correo inicial pertenece a una cuenta sin permisos de administrador.",
        );
      if (!admin)
        await c.query(
          "INSERT INTO users(name,email,phone,password_hash,role) VALUES('Administrador ConexionES',$1,'4531523552',$2,'admin')",
          [email.toLowerCase(), hash],
        );
    }
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    if (locked)
      await c.query(
        "SELECT RELEASE_LOCK(SHA2(CONCAT(DATABASE(),':conexiones-migrate'),256))",
      );
    c.release();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await migrate();
    console.log("Esquema MySQL/MariaDB y catálogo aplicados.");
  } finally {
    await pool.end();
  }
}
