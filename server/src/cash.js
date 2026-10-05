import { z } from 'zod';
import { uuid } from './domain.js';
import { transaction,one,fail,pool,insert } from './db.js';
const cents=z.number().int().min(0).max(2147483647);
export async function openCash(actor,raw,db=pool) {
 const input=z.object({registerId:uuid,openingCents:cents}).strict().parse(raw);
 return transaction(async c=>{
  if(!await one(c,'SELECT id FROM cash_registers WHERE id=$1 FOR UPDATE',[input.registerId])) fail('Caja inexistente.',404);
  const s=await insert(c,'cash_sessions',{register_id:input.registerId,cashier_id:actor.id,opening_cents:input.openingCents});
  await c.query("INSERT INTO audit_log(actor_id,action,entity_id) VALUES($1,'cash.opened',$2)",[actor.id,s.id]);return s;
 },db);
}
export async function closeCash(actor,id,raw,db=pool) {
 uuid.parse(id);const {countedCents}=z.object({countedCents:cents}).strict().parse(raw);
 return transaction(async c=>{
  const s=await one(c,'SELECT * FROM cash_sessions WHERE id=$1 FOR UPDATE',[id]);
  if(!s || s.cashier_id!==actor.id) fail('Caja no disponible.',403);
  if(s.closed_at) fail('Caja ya cerrada.',409);
  const sales=await one(c,`SELECT COALESCE(sum(p.amount_cents),0) AS cents,count(*) AS count FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE b.cash_session_id=$1 AND p.provider='cash' AND p.status='approved'`,[id]);
  await c.query('UPDATE cash_sessions SET closed_at=now(3),counted_cents=$2,expected_cents=opening_cents+$3,difference_cents=$2-opening_cents-$3 WHERE id=$1',[id,countedCents,sales.cents]);
  const result=await one(c,'SELECT * FROM cash_sessions WHERE id=$1',[id]);
  await c.query("INSERT INTO audit_log(actor_id,action,entity_id,metadata) VALUES($1,'cash.closed',$2,$3)",[actor.id,id,JSON.stringify(sales)]);
  return {...result,salesCents:sales.cents,transactions:sales.count};
 },db);
}
