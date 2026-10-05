import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {once} from 'node:events';

test('el cargador CommonJS de Hostinger inicia el servidor y responde health',async()=>{
 const child=spawn(process.execPath,['--input-type=commonjs','-e',"require('./server/src/index.js')"],{
  cwd:resolve(import.meta.dirname,'../..'),windowsHide:true,
  env:{...process.env,PORT:'0',MP_ENABLED:'false',EMAIL_ENABLED:'false',VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:''},
  stdio:['ignore','pipe','pipe']
 });
 const exited=once(child,'exit');let output='';
 child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
 try {
  const port=await new Promise((done,reject)=>{
   const timeout=setTimeout(()=>reject(new Error(`El servidor no inició: ${output}`)),15000);
   function started(){const match=output.match(/ConexionES escucha en (\d+)/);if(match){clearTimeout(timeout);done(Number(match[1]));}}
   child.stdout.on('data',started);
   child.once('error',error=>{clearTimeout(timeout);reject(error);});
   child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`El servidor terminó (${code}): ${output}`));});
  });
  const response=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
  const status=await fetch(`http://127.0.0.1:${port}/api/integrations`);
  const integrations=await status.json();assert.equal(integrations.payments,false);assert.equal(integrations.email,false);
 } finally {child.kill('SIGTERM');await exited;}
});
