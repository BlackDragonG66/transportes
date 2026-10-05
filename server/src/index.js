import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { app } from './app.js';
import { config,integrationStatus } from './config.js';
import { pool } from './db.js';
import { expireBookings } from './bookings.js';
import { dispatchNotifications } from './notifications.js';
import { mpRequest,reconcilePayment } from './mercadopago.js';
// Hostinger's LiteSpeed loader uses require(): keep this module free of top-level await.
async function start() {
if(!config.database||!config.secret||config.secret.length<32)throw new Error('Configura DB_HOST, DB_USER, DB_PASSWORD, DB_NAME y SESSION_SECRET (32 caracteres o más).');
if(config.production&&(!config.appUrl.startsWith('https://')||!config.apiUrl.startsWith('https://')))throw new Error('Producción requiere HTTPS.');
const dist=fileURLToPath(new URL('../../web/dist',import.meta.url));
if(existsSync(dist)) {app.use(express.static(dist));app.get('/{*path}',(req,res)=>res.sendFile(`${dist}/index.html`));}
await pool.query('SELECT 1');
const server=app.listen(config.port,()=>console.log(`ConexionES escucha en ${server.address()?.port??config.port}`));
let busy=false,ticks=0,reconcileCursor=null;
const timer=setInterval(async()=>{
 if(busy)return;busy=true;
 try {
  await expireBookings();await dispatchNotifications();
  // Recovery when a webhook is lost. Reversals are also caught for recent payments.
  if(integrationStatus().payments&&++ticks%10===0) {
   const bookings=(await pool.query(`SELECT id,created_at FROM bookings WHERE channel='web' AND status IN ('pending','expired','confirmed','refund_required') AND created_at>DATE_SUB(now(),INTERVAL 30 DAY) AND ($1 IS NULL OR (created_at,id)>($1,$2)) ORDER BY created_at,id LIMIT 5`,[reconcileCursor?.created_at||null,reconcileCursor?.id||null])).rows;
   for(const b of bookings){const search=await mpRequest(`/v1/payments/search?external_reference=${b.id}&sort=date_created&criteria=desc&limit=20`);for(const payment of search.results||[])await reconcilePayment(payment);}
   reconcileCursor=bookings.at(-1)||null;
  }
 }catch(e){console.error('Worker:',e.message);}finally{busy=false;}
},10000);
async function shutdown(){clearInterval(timer);server.close(async()=>{await pool.end();process.exit(0);});}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
start().catch(async error=>{
 console.error('No se pudo iniciar ConexionES:',error.code||'',error.message);
 await pool.end();process.exit(1);
});
