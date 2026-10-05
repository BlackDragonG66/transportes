import { readFile } from 'node:fs/promises';
import { pool } from './db.js';
const c = await pool.connect();
try {
 await c.query('SELECT pg_advisory_lock(6182026)');
 const exists = (await c.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name;
 if (!exists) await c.query(await readFile(new URL('../../database/schema.sql',import.meta.url),'utf8'));
 await c.query(await readFile(new URL('../../database/seed.sql',import.meta.url),'utf8'));
 console.log('Esquema y catálogo aplicados.');
} finally { await c.query('SELECT pg_advisory_unlock(6182026)'); c.release(); await pool.end(); }
