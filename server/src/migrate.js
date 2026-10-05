import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {pool,one} from './db.js';
export async function migrate(db=pool) {
 const c=await db.connect();let locked=false;
 try {
  const lock=await one(c,"SELECT GET_LOCK(SHA2(CONCAT(DATABASE(),':conexiones-migrate'),256),30) AS acquired");
  if(!lock?.acquired)throw new Error('Otra migración está en curso.');locked=true;
  // MySQL DDL auto-commits. Idempotent tables let an interrupted install be resumed.
  for(const file of ['schema.sql','seed.sql']) {
   const sql=await readFile(new URL(`../../database/${file}`,import.meta.url),'utf8');
   const clean=sql.replace(/^\s*--.*$/gm,'');
   for(const statement of clean.split(';').map(s=>s.trim()).filter(Boolean))await c.query(statement);
  }
 }catch(error){await c.query('ROLLBACK');throw error;}
 finally{if(locked)await c.query("SELECT RELEASE_LOCK(SHA2(CONCAT(DATABASE(),':conexiones-migrate'),256))");c.release();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
 try{await migrate();console.log('Esquema MySQL/MariaDB y catálogo aplicados.');}finally{await pool.end();}
}
