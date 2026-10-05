import EmbeddedPostgres from 'embedded-postgres';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {resolve,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const port=await new Promise(resolvePort=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolvePort(port));});});
const dir=resolve(root,'.test-postgres',randomUUID());
const childPath=relative(resolve(root,'.test-postgres'),dir);
if(childPath.startsWith('..')||isAbsolute(childPath))throw new Error('Directorio de pruebas fuera del workspace.');
const postgres=new EmbeddedPostgres({databaseDir:dir,user:'test',password:'local-test-only',port,persistent:false,onLog:()=>{},onError:message=>{if(String(message).includes('FATAL'))console.error(message);}});
try {
 await postgres.initialise();await postgres.start();await postgres.createDatabase('conexiones_test');
 const code=await new Promise((resolveExit,reject)=>{
  const child=spawn(process.execPath,['--test','server/test/integration.test.js'],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,TEST_DATABASE_URL:`postgres://test:local-test-only@127.0.0.1:${port}/conexiones_test`}});
  child.on('error',reject);child.on('exit',resolveExit);
 });
 process.exitCode=code??1;
}finally{await postgres.stop();}
