import pg from 'pg';
import { config } from './config.js';
export const pool = new pg.Pool({connectionString: config.database, max: 15});
export async function transaction(fn, db = pool) {
 const client = await db.connect();
 try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
 catch(error) { await client.query('ROLLBACK'); throw error; }
 finally { client.release(); }
}
export async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
export function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
