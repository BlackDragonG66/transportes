import mysql from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {config} from './config.js';
// Numbered placeholders keep repeated parameters explicit. Values use mysql2 prepared statements.
export function compileQuery(sql,params=[]) {
 const values=[];
 const statement=sql.replace(/\$(\d+)/g,(_,n)=>{const index=Number(n)-1;if(index>=params.length)throw new Error('Parámetro SQL ausente.');values.push(params[index]);return '?';});
 return {statement,values:values.length?values:params};
}
function adapter(connection) {
 return {async query(sql,params=[]) {
  const {statement,values}=compileQuery(sql,params);
  // MySQL does not support transaction-control commands in the prepared protocol.
  const [result]=values.length?await connection.execute(statement,values):await connection.query(statement);
  const rows=Array.isArray(result)?result:[];
  for(const row of rows)for(const key of ['metadata','subscription'])if(typeof row[key]==='string')row[key]=JSON.parse(row[key]);
  return {rows,affectedRows:result.affectedRows??0};
 },release:()=>connection.release()};
}
export function mysqlOptions(env=process.env) {
 const url=env.DATABASE_URL?new URL(env.DATABASE_URL):null;
 if(url && url.protocol!=='mysql:')throw new Error('DATABASE_URL debe usar mysql://. También puedes usar DB_HOST, DB_USER, DB_PASSWORD y DB_NAME.');
 return {
  host:url?.hostname||env.DB_HOST||'localhost',port:Number(url?.port||env.DB_PORT||3306),
  user:url?decodeURIComponent(url.username):env.DB_USER,password:url?decodeURIComponent(url.password):env.DB_PASSWORD,
  database:url?decodeURIComponent(url.pathname.slice(1)):env.DB_NAME,
  timezone:'Z',charset:'utf8mb4',decimalNumbers:true,connectionLimit:10,connectTimeout:10000,
  ...(env.DB_SSL==='true'?{ssl:{rejectUnauthorized:true}}:{})
 };
}
export function createPool(options) {
 const native=mysql.createPool(options);
 async function connect(){const connection=await native.getConnection();try{await connection.query("SET time_zone='+00:00'");return adapter(connection);}catch(e){connection.release();throw e;}}
 return {connect,async query(...args){const c=await connect();try{return await c.query(...args);}finally{c.release();}},end:()=>native.end()};
}
export const pool=createPool(mysqlOptions());
export async function transaction(fn,db=pool) {
 const client=await db.connect();
 try {
  // Fresh committed snapshot after waiting for trip locks prevents stale capacity reads.
  await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  await client.query('START TRANSACTION');const result=await fn(client);await client.query('COMMIT');return result;
 } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function one(db,sql,params=[]) {return (await db.query(sql,params)).rows[0];}
const uuidTables=new Set(['users','drivers','vehicles','routes','passenger_types','trips','addons','cash_registers','cash_sessions','bookings','payments','local_fleet','last_mile_requests','local_jobs','push_subscriptions','notification_outbox']);
export async function insert(db,table,data) {
 if(!uuidTables.has(table))throw new Error('Tabla no permitida.');
 const row={id:randomUUID(),...data};const fields=Object.keys(row);
 if(fields.some(f=>!/^[a-z_]+$/.test(f)))throw new Error('Columna no permitida.');
 await db.query(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(row));
 return one(db,`SELECT * FROM ${table} WHERE id=$1`,[row.id]);
}
export function fail(message,status=400){const error=new Error(message);error.status=status;throw error;}
