# ConexionES en Hostinger

Motor: MySQL 8.0.16+ o MariaDB 10.6+, con tablas InnoDB. La instalación crea las tablas dentro de la base indicada; no necesita permisos para crear bases, usuarios ni servicios.

Configuración del despliegue:

| Campo | Valor |
|---|---|
| Marco | Other (para habilitar compilación y archivo de entrada) |
| Rama | master |
| Node | 24.x |
| Raíz | ./ |
| Salida | . |
| Archivo de entrada | server/src/index.js |
| Compilación | npm run build |
| Inicio | npm start |

Variables obligatorias: `DB_HOST`, `DB_PORT` (3306), `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SESSION_SECRET`, `APP_URL` y `PUBLIC_API_URL`. Usa el servidor, usuario y nombre de base exactos de hPanel. `DATABASE_URL` es una alternativa opcional con protocolo `mysql://`; si existe, tiene prioridad sobre `DB_*`.

En Hostinger añade `DB_MIGRATE_ON_BUILD=true` y `NPM_CONFIG_PRODUCTION=false`: el comando de compilación genera React y aplica el esquema y catálogo de forma idempotente. El preset Express de hPanel omite la compilación, por eso este proyecto usa Other. Las compilaciones locales y Docker no requieren base de datos mientras `DB_MIGRATE_ON_BUILD` no esté activado.

`MP_ENABLED=false` mantiene Mercado Pago pendiente: no se crean reservas web ni preferencias de pago, ni se consultan pagos externos. Para activarlo, completa `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_COLLECTOR_ID` y cambia `MP_ENABLED=true`.

`EMAIL_ENABLED=false` mantiene el correo pendiente: no se realizan conexiones SMTP ni se marcan mensajes como enviados. Las notificaciones quedan en la cola para entrega cuando actives el correo. Completa `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` y cambia `EMAIL_ENABLED=true`. Los enlaces de acceso vencen en 24 horas; tras configurar el correo, un enlace nuevo puede solicitarse con Recuperar acceso.

Taquilla, caja, boletos QR, tracking y Viaje Rápido siguen disponibles con ambas integraciones pendientes. Web Push funciona independientemente si tiene sus claves VAPID.

La migración instala un catálogo inicial y conserva las tarifas existentes en ejecuciones posteriores. No importa automáticamente datos de una instalación previa en PostgreSQL.

Pruebas: `npm test` crea un MySQL temporal. Con `TEST_DATABASE_URL=mysql://.../conexiones_test`, utiliza una base de pruebas existente cuyo nombre debe terminar en `_test`. CI comprueba tanto MySQL como MariaDB.

Credenciales privadas: el `.env` local está excluido de Git y no se publica en GitHub. Importa su contenido en las variables de entorno de Hostinger y sustituye los datos de conexión pendientes.

El cargador LiteSpeed de Hostinger ejecuta el archivo de entrada con `require()`. `server/src/index.js` inicia la conexión y el servidor dentro de una función asíncrona, sin `await` en el nivel superior, para evitar `ERR_REQUIRE_ASYNC_MODULE`. Las pruebas verifican este modo de arranque con una petición real a `/api/health`.

Referencia de conexión: [Hostinger y MySQL para Node.js](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/).

El flujo de compra es viaje → pasajeros con nombre y tarifa → extras → pago. Los lugares se apartan únicamente al iniciar el pago. Viaje Rápido se solicita desde un boleto confirmado, después de verificar el pago en el servidor. Las reservas anteriores sin nombres siguen siendo consultables.

En Administración → Página y publicidad puedes cambiar portada, logo, teléfonos, oficinas, preguntas frecuentes y anuncios. Los anuncios admiten ubicación, orden, visibilidad y fechas de publicación. La biblioteca convierte JPG/PNG/WebP a WebP y guarda los archivos en `media_assets` (MySQL), por lo que sobreviven a los despliegues.

Administración → Equipo y accesos crea cuentas de taquilla, conductor o administrador. Mi cuenta permite cambiar la contraseña con la contraseña actual. Para un alta inicial sin terminal, la migración acepta `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD_HASH` (bcrypt, costo 12); crea la cuenta si no existe y conserva su contraseña en futuras ejecuciones. Retira ambas variables después de crearla. La contraseña y el hash no deben incluirse en Git.
