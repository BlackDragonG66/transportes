import { z } from 'zod';
export const uuid = z.string().uuid();
const line = z.object({id:uuid,quantity:z.number().int().min(1).max(60)}).strict();
export const bookingInput = z.object({
 tripId:uuid, passengers:z.array(line).min(1).max(20), addons:z.array(line).max(20).default([]),
 channel:z.enum(['web','pos']).default('web'), customerId:uuid.optional(), cashSessionId:uuid.optional(),
 rapid:z.object({zone:z.string().trim().min(2).max(160),passengers:z.number().int().min(1).max(60),luggage:z.number().int().min(0).max(120),vehicles:z.number().int().min(1).max(60)}).strict().optional()
}).strict().superRefine((v,ctx)=>{
 for(const list of [v.passengers,v.addons]) if(new Set(list.map(x=>x.id)).size!==list.length) ctx.addIssue({code:'custom',message:'No se permiten conceptos duplicados.'});
 if(v.channel==='pos' && (!v.customerId || !v.cashSessionId)) ctx.addIssue({code:'custom',message:'Taquilla requiere cliente y caja.'});
 if(v.channel==='web' && (v.customerId || v.cashSessionId)) ctx.addIssue({code:'custom',message:'La reserva web utiliza tu usuario.'});
 const n=v.passengers.reduce((s,x)=>s+x.quantity,0);
 if(n>60) ctx.addIssue({code:'custom',message:'Máximo 60 pasajeros.'});
 if(v.rapid && (v.rapid.passengers>n || v.rapid.vehicles<Math.ceil(v.rapid.passengers/4) || v.rapid.vehicles>v.rapid.passengers)) ctx.addIssue({code:'custom',message:'Viaje Rápido: pasajeros válidos y mínimo un vehículo por cada cuatro personas.'});
});
export function calculateTotal(passengers, addons, channel) {
 const count=passengers.reduce((s,p)=>s+p.quantity,0);
 const fareCents=passengers.reduce((s,p)=>s+p.quantity*p.unit_cents,0);
 const addonCents=addons.reduce((s,p)=>s+p.quantity*p.unit_cents,0);
 const feeCents=channel==='web'?count*1000:0;
 const totalCents=fareCents+addonCents+feeCents;
 if(!Number.isSafeInteger(totalCents) || totalCents<=0 || totalCents>2147483647) throw new Error('Total fuera de rango.');
 return {count,fareCents,addonCents,feeCents,totalCents};
}
export function splitLocal(passengers,luggage,vehicles) {
 if(vehicles<Math.ceil(passengers/4)||vehicles>passengers) throw new Error('Capacidad local inválida.');
 return Array.from({length:vehicles},(_,i)=>({passengers:Math.floor(passengers/vehicles)+(i<passengers%vehicles?1:0),luggage:Math.floor(luggage/vehicles)+(i<luggage%vehicles?1:0)}));
}
