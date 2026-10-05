import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
export const config = {
 port: Number(process.env.PORT || 3000), database: process.env.DATABASE_URL || (process.env.DB_HOST&&process.env.DB_USER&&process.env.DB_NAME),
 appUrl: process.env.APP_URL || 'http://localhost:5173', apiUrl: process.env.PUBLIC_API_URL || 'http://localhost:3000',
 secret: process.env.SESSION_SECRET, production: process.env.NODE_ENV === 'production',
 mpToken: process.env.MP_ACCESS_TOKEN, mpSecret: process.env.MP_WEBHOOK_SECRET, mpCollector: process.env.MP_COLLECTOR_ID
};
export function integrationStatus(env=process.env) {
 return {
  payments:env.MP_ENABLED==='true'&&Boolean(env.MP_ACCESS_TOKEN?.trim()&&env.MP_WEBHOOK_SECRET?.trim()&&env.MP_COLLECTOR_ID?.trim()),
  email:env.EMAIL_ENABLED==='true'&&Boolean(env.SMTP_HOST?.trim()&&env.SMTP_USER?.trim()&&env.SMTP_PASS?.trim()&&env.MAIL_FROM?.trim()),
  push:Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT)
 };
}
