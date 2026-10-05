import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
export const config = {
 port: Number(process.env.PORT || 3000), database: process.env.DATABASE_URL,
 appUrl: process.env.APP_URL || 'http://localhost:5173', apiUrl: process.env.PUBLIC_API_URL || 'http://localhost:3000',
 secret: process.env.SESSION_SECRET, production: process.env.NODE_ENV === 'production',
 mpToken: process.env.MP_ACCESS_TOKEN, mpSecret: process.env.MP_WEBHOOK_SECRET, mpCollector: process.env.MP_COLLECTOR_ID
};
