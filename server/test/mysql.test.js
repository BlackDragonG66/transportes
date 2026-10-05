import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileQuery,mysqlOptions} from '../src/db.js';
import {integrationStatus} from '../src/config.js';
test('parámetros repetidos y desordenados se enlazan correctamente',()=>{
 assert.deepEqual(compileQuery('UPDATE users SET name=$2 WHERE id=$1 OR id=$1',['id','name']),{statement:'UPDATE users SET name=? WHERE id=? OR id=?',values:['name','id','id']});
 assert.throws(()=>compileQuery('SELECT $2',['missing']));
});
test('conexión Hostinger admite contraseña especial sin exigir URL',()=>{
 const options=mysqlOptions({DB_HOST:'localhost',DB_USER:'u123_user',DB_PASSWORD:'p@ss:#/%',DB_NAME:'u123_conexiones'});
 assert.equal(options.password,'p@ss:#/%');assert.equal(options.port,3306);assert.equal(options.database,'u123_conexiones');assert.equal(options.timezone,'Z');
 assert.equal(mysqlOptions({DATABASE_URL:'mysql://test:p%40ss@localhost:3306/test_db'}).password,'p@ss');
 assert.throws(()=>mysqlOptions({DATABASE_URL:'postgres://localhost/test'}));
});
test('pagos y correo necesitan activación explícita y todas sus credenciales',()=>{
 assert.deepEqual(integrationStatus({}),{payments:false,email:false,push:false});
 assert.equal(integrationStatus({MP_ENABLED:'true',MP_ACCESS_TOKEN:'token'}).payments,false);
 assert.equal(integrationStatus({MP_ENABLED:'false',MP_ACCESS_TOKEN:'token',MP_WEBHOOK_SECRET:'secret',MP_COLLECTOR_ID:'123'}).payments,false);
 assert.equal(integrationStatus({MP_ENABLED:'true',MP_ACCESS_TOKEN:'token',MP_WEBHOOK_SECRET:'secret',MP_COLLECTOR_ID:'123'}).payments,true);
 assert.equal(integrationStatus({EMAIL_ENABLED:'true',SMTP_HOST:'smtp.example.com'}).email,false);
 assert.equal(integrationStatus({EMAIL_ENABLED:'true',SMTP_HOST:'smtp.example.com',SMTP_USER:'user',SMTP_PASS:'pass',MAIL_FROM:'mail@example.com'}).email,true);
});
