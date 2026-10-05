import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// hPanel only offers npm run build. Opt in on the host; local and Docker builds need no database.
if(process.env.DB_MIGRATE_ON_BUILD==='true') {
 execFileSync(process.execPath,[fileURLToPath(new URL('../server/src/migrate.js',import.meta.url))],{
  stdio:'inherit',windowsHide:true
 });
}
