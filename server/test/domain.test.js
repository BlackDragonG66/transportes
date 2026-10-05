import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {calculateTotal,splitLocal,bookingInput} from '../src/domain.js';
import {validSignature} from '../src/mercadopago.js';
test('web cobra 10 MXN por pasajero y POS cobra cero comisión',()=>{
 const p=[{quantity:2,unit_cents:25000},{quantity:1,unit_cents:15000}],a=[{quantity:2,unit_cents:6500}];
 assert.deepEqual(calculateTotal(p,a,'web'),{count:3,fareCents:65000,addonCents:13000,feeCents:3000,totalCents:81000});
 assert.equal(calculateTotal(p,a,'pos').totalCents,78000);
});
test('distribuye pasajeros y maletas sin superar cuatro personas por auto',()=>{
 for(let n=1;n<=60;n++)for(let cars=Math.ceil(n/4);cars<=n;cars++){
  const jobs=splitLocal(n,17,cars);assert.equal(jobs.reduce((s,x)=>s+x.passengers,0),n);assert.equal(jobs.reduce((s,x)=>s+x.luggage,0),17);assert(jobs.every(x=>x.passengers>=1&&x.passengers<=4));
 }
 assert.throws(()=>splitLocal(5,0,1));
});
test('no acepta precios enviados por cliente ni conceptos duplicados',()=>{
 const id='11111111-1111-4111-8111-111111111111',p={tripId:id,passengers:[{id,quantity:1}]};
 assert(!bookingInput.safeParse({...p,total:1}).success);assert(!bookingInput.safeParse({...p,passengers:[...p.passengers,...p.passengers]}).success);
 assert(!bookingInput.safeParse({...p,rapid:{zone:'Centro',passengers:5,luggage:0,vehicles:1}}).success);
});
test('firma Mercado Pago valida manifest oficial, rechaza firma alterada o ausente',()=>{
 const ts=String(Date.now()),id='123456',request='request-test',secret='test-secret';
 const hash=createHmac('sha256',secret).update(`id:${id};request-id:${request};ts:${ts};`).digest('hex');
 assert(validSignature(id,request,`ts=${ts},v1=${hash}`,secret));
 assert(!validSignature('99',request,`ts=${ts},v1=${hash}`,secret));assert(!validSignature(id,request,'v1=xx',secret));assert(!validSignature(id,request,'',secret));
});
