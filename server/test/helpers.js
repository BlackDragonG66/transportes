import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createPool,mysqlOptions,insert,one} from '../src/db.js';
export const travelers=(passengerTypeId,count)=>Array.from({length:count},(_,i)=>({name:`Viajero Prueba ${i+1}`,passengerTypeId}));
export async function testDatabase() {
 if(!process.env.TEST_DATABASE_URL)throw new Error('Ejecuta npm test desde la raíz o configura TEST_DATABASE_URL.');
 const options=mysqlOptions({DATABASE_URL:process.env.TEST_DATABASE_URL});
 // Tests must never touch production. Fixtures use independent UUIDs in a dedicated test database.
 if(!options.database.endsWith('_test'))throw new Error('La base de pruebas debe terminar en _test.');
 const database=options.database;
 const db=createPool({...options,database});
 const lock=await db.connect();
 try{
  await lock.query("SELECT GET_LOCK('conexiones-test-setup',60)");
  const schema=await readFile(new URL('../../database/schema.sql',import.meta.url),'utf8');
  for(const statement of schema.replace(/^\s*--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await lock.query(statement);
 }finally{await lock.query("SELECT RELEASE_LOCK('conexiones-test-setup')");lock.release();}
 return db;
}
export async function fixture(db,capacity=4){
 const run=(sql,params=[])=>one(db,sql,params);
 const user=(name,role='customer')=>insert(db,'users',{name,email:`${randomUUID()}@example.com`,phone:'4431234567',password_hash:'test',role});
 const u=await user('Cliente'),cashier=await user('Cajero','cashier'),driverUser=await user('Chofer','driver');
 const driver=await insert(db,'drivers',{user_id:driverUser.id,photo_url:'https://example.com/photo.jpg',license:'ABC123'});
 const vehicle=await insert(db,'vehicles',{brand:'Toyota',model:'Hiace',plate:randomUUID(),capacity});
 const route=await insert(db,'routes',{origin:randomUUID(),destination:'Morelia',kind:'interurban'});
 const type=await insert(db,'passenger_types',{name:randomUUID()});
 await run('INSERT INTO fares VALUES($1,$2,25000)',[route.id,type.id]);
 const trip=await insert(db,'trips',{route_id:route.id,vehicle_id:vehicle.id,driver_id:driver.id,departure_at:new Date(Date.now()+86400000),arrival_at:new Date(Date.now()+97200000),capacity});
 const register=await insert(db,'cash_registers',{name:randomUUID()});
 return {u,cashier,driverUser,driver,vehicle,route,trip,type,register,run};
}
