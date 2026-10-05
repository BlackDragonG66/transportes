import {spawn} from 'node:child_process';
import {createDB} from 'mysql-memory-server';
import {resolve} from 'node:path';
async function run(args,env){return new Promise((done,reject)=>{const child=spawn(process.execPath,args,{cwd:resolve(import.meta.dirname,'..'),stdio:'inherit',windowsHide:true,env});child.on('error',reject);child.on('exit',done);});}
let server;
try {
 let url=process.env.TEST_DATABASE_URL;
 if(!url){console.log('Iniciando MySQL efímero para las pruebas…');server=await createDB({version:'8.4.5',dbName:'conexiones_test',xEnabled:'OFF'});url=`mysql://${server.username}@127.0.0.1:${server.port}/${server.dbName}`;}
 const env={...process.env,TEST_DATABASE_URL:url,DATABASE_URL:url,NODE_ENV:'test',APP_URL:'http://localhost:5173',PUBLIC_API_URL:'http://localhost:3000',SESSION_SECRET:'tests-only-secret-longer-than-32-characters',MP_ENABLED:'true',MP_ACCESS_TOKEN:'test-token',MP_WEBHOOK_SECRET:'test-secret',MP_COLLECTOR_ID:'123',EMAIL_ENABLED:'false',VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:''};
 if(!new URL(url).pathname.endsWith('_test'))throw new Error('La base de pruebas debe terminar en _test.');
 const migrated=await run(['server/src/migrate.js'],env);
 if(migrated!==0)throw new Error('Falló la migración de la base de pruebas.');
 process.exitCode=(await run(['--test','--test-concurrency=1','server/test/*.test.js'],env))??1;
}finally{if(server)await server.stop();}
