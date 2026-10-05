import {useEffect,useRef,useState} from 'react';
import {api,money,date} from './api.js';
export default function ReservationForm({user,pos=false,cashSession,customers=[]}) {
 const [catalog,setCatalog]=useState(null),[tripId,setTrip]=useState(''),[quantities,setQuantities]=useState({}),[extras,setExtras]=useState({});
 const [routeId,setRoute]=useState(''),[rapid,setRapid]=useState(false),[zone,setZone]=useState(''),[localPassengers,setLocalPassengers]=useState(1),[luggage,setLuggage]=useState(0),[vehicles,setVehicles]=useState(1);
 const [customerId,setCustomer]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null);
 const attempt=useRef(null);
 async function load(){try{setCatalog(await api('/catalog'));}catch(e){setError(e.message);}}
 useEffect(()=>{load();},[]);
 const trip=catalog?.trips.find(x=>x.id===tripId),count=Object.values(quantities).reduce((a,b)=>a+b,0);
 const fare=catalog?.fares.filter(x=>x.route_id===trip?.route_id)||[];
 const base=fare.reduce((sum,x)=>sum+x.price_cents*(quantities[x.passenger_type_id]||0),0);
 const addonTotal=catalog?.addons.reduce((sum,x)=>sum+x.price_cents*(extras[x.id]||0),0)||0;
 const fee=pos?0:count*1000;
 const minVehicles=Math.ceil(localPassengers/4);
 useEffect(()=>{setVehicles(v=>Math.min(localPassengers,Math.max(v,minVehicles)));},[localPassengers,minVehicles]);
 async function submit(e){
  e.preventDefault();if(busy)return;setError('');setBusy(true);
  const payload={tripId,channel:pos?'pos':'web',passengers:Object.entries(quantities).filter(([,n])=>n>0).map(([id,quantity])=>({id,quantity})),addons:Object.entries(extras).filter(([,n])=>n>0).map(([id,quantity])=>({id,quantity})),...(pos?{customerId,cashSessionId:cashSession?.id}:{}),...(rapid?{rapid:{zone,passengers:localPassengers,luggage,vehicles}}:{})};
  const fingerprint=JSON.stringify(payload);
  if(attempt.current?.fingerprint!==fingerprint)attempt.current={key:crypto.randomUUID(),fingerprint};
  try{
   if(!user)throw new Error('Inicia sesión para reservar.');
   const b=await api('/bookings',{method:'POST',body:payload,key:attempt.current.key});
   setResult(b);
   if(!pos){const preference=await api(`/bookings/${b.id}/preference`,{method:'POST'});window.location.assign(preference.checkout_url);}
   else {attempt.current=null;await load();}
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 if(!catalog)return <p className="notification">Cargando salidas… {error}</p>;
 return <div className="columns is-variable is-6"><div className="column is-8"><form onSubmit={submit} className="box booking-box">
  <p className="eyebrow">{pos?'TAQUILLA · VENTA EN EFECTIVO':'TU VIAJE EMPIEZA AQUÍ'}</p><h2 className="title is-4">Elige cómo viajar</h2>
  {error&&<div role="alert" className="notification is-danger is-light">{error}</div>}
  {pos&&<label className="field is-block">Cliente<div className="select is-fullwidth"><select required value={customerId} onChange={e=>setCustomer(e.target.value)}><option value="">Selecciona cliente</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.email}</option>)}</select></div></label>}
  <div className="columns"><div className="column"><label className="label">Ruta</label><div className="select is-fullwidth"><select required value={routeId} onChange={e=>{setRoute(e.target.value);setTrip('');setQuantities({});}}><option value="">¿A dónde vamos?</option>{catalog.routes.map(r=><option key={r.id} value={r.id}>{r.origin} → {r.destination}</option>)}</select></div></div>
  <div className="column"><label className="label">Salida</label><div className="select is-fullwidth"><select required value={tripId} onChange={e=>setTrip(e.target.value)}><option value="">Selecciona horario</option>{catalog.trips.filter(t=>t.route_id===routeId).map(t=><option key={t.id} value={t.id}>{date(t.departure_at)} · {t.available} lugares</option>)}</select></div></div></div>
  {routeId&&!catalog.trips.some(t=>t.route_id===routeId)&&<p className="notification is-warning is-light">No hay salidas programadas para esta ruta.</p>}
  <fieldset><legend className="label">Pasajeros</legend>{catalog.types.filter(type=>fare.some(f=>f.passenger_type_id===type.id)).map(type=>{const price=fare.find(f=>f.passenger_type_id===type.id).price_cents;return <div key={type.id} className="fare-row"><span>{type.name}<small>{money(price)} por persona</small></span><input aria-label={`Cantidad ${type.name}`} className="input count-input" type="number" min="0" max="60" value={quantities[type.id]||0} onChange={e=>setQuantities({...quantities,[type.id]:Number(e.target.value)})}/></div>;})}</fieldset>
  <fieldset className="mt-5"><legend className="label">Algo rico para el camino</legend>{catalog.addons.map(a=><div className="fare-row" key={a.id}><span>{a.name}<small>{money(a.price_cents)} cada uno</small></span><input aria-label={`Cantidad ${a.name}`} className="input count-input" type="number" min="0" max="60" value={extras[a.id]||0} onChange={e=>setExtras({...extras,[a.id]:Number(e.target.value)})}/></div>)}</fieldset>
  <div className="rapid-panel mt-5"><label className="checkbox"><input type="checkbox" checked={rapid} onChange={e=>setRapid(e.target.checked)}/> <strong>Viaje Rápido</strong> · Un auto al llegar</label><p className="help">Solicita conexión desde la terminal hasta tu colonia. La tarifa local se acuerda con operaciones y se paga por separado.</p>
  {rapid&&<div className="mt-4"><label className="label">Colonia o zona aproximada</label><input required minLength="2" maxLength="160" className="input" placeholder="Ej. Centro, Morelia" value={zone} onChange={e=>setZone(e.target.value)}/><div className="columns mt-2">{[['Pasajeros',localPassengers,setLocalPassengers,1,Math.max(1,count)],['Maletas',luggage,setLuggage,0,120],['Vehículos',vehicles,setVehicles,minVehicles,localPassengers]].map(([label,value,set,min,max])=><div className="column" key={label}><label className="label">{label}</label><input required className="input" type="number" min={min} max={max} value={value} onChange={e=>set(Number(e.target.value))}/></div>)}</div><p className="help">Hasta 4 pasajeros por auto. Tu solicitud necesita al menos {minVehicles} vehículo(s).</p></div>}</div>
  <button className={`button is-primary is-fullwidth is-medium mt-5 ${busy?'is-loading':''}`} disabled={busy||!trip||count===0||count>(trip?.available||0)||count>60||(pos&&!cashSession)||(rapid&&localPassengers>count)}>{pos?'Cobrar y emitir boleto':'Reservar y pagar'} · {money(base+addonTotal+fee)}</button>
  {result&&<div className="notification is-success is-light mt-4">Reserva {result.id}: {result.status==='confirmed'?'confirmada':'pendiente de pago'}. <a href={`/ticket/${result.ticket_token}`}>Ver boleto</a></div>}
 </form></div><aside className="column"><div className="box summary"><p className="eyebrow">TU RESERVA</p><h3 className="title is-4">Todo listo para salir</h3><p>{trip?`${trip.origin} → ${trip.destination}`:'Selecciona tu destino'}</p>{trip&&<p className="mt-2">{date(trip.departure_at)}</p>}<hr/>{[['Pasajeros',money(base)],['Complementos',money(addonTotal)],['Servicio web',money(fee)]].map(([l,v])=><div className="total-row" key={l}><span>{l}</span><strong>{v}</strong></div>)}<div className="total-row grand-total"><span>Total MXN</span><strong>{money(base+addonTotal+fee)}</strong></div><p className="help">{pos?'Venta de taquilla sin comisión web.':'Servicio web: $10 MXN por pasajero.'}</p><hr/><p className="is-size-7">Viajas en unidades turísticas Mercedes-Benz o Toyota. Reservamos lugares disponibles; el abordaje no asigna asientos específicos.</p></div></aside></div>;
}
