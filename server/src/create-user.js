import bcrypt from 'bcryptjs';
import { pool } from './db.js';
const [name,email,phone,role='admin'] = process.argv.slice(2);
const password=process.env.NEW_USER_PASSWORD;
if (!name || !email || !phone || !password || password.length < 12 || Buffer.byteLength(password)>72) throw new Error('Argumentos: nombre email teléfono rol; NEW_USER_PASSWORD: mínimo 12 caracteres, máximo 72 bytes.');
try { await pool.query('INSERT INTO users(name,email,phone,role,password_hash) VALUES($1,$2,$3,$4,$5)',[name,email.toLowerCase(),phone,role,await bcrypt.hash(password,12)]); console.log('Usuario creado.'); }
finally { await pool.end(); }
