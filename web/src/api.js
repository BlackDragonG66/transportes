export async function api(path,{method='GET',body,key}={}) {
 const response=await fetch(`/api${path}`,{method,credentials:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(response.status===204)return null;
 const data=await response.json();if(!response.ok)throw new Error(data.error||'No se pudo completar la operación.');return data;
}
export const money=cents=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(cents/100);
export const date=value=>new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Mexico_City'}).format(new Date(value));
export async function enablePush() {
 if(!('serviceWorker'in navigator)||!('PushManager'in window))throw new Error('Este navegador no admite notificaciones push.');
 const {key}=await api('/push/key');if(!key)throw new Error('Las notificaciones push todavía no están configuradas.');
 if(await Notification.requestPermission()!=='granted')throw new Error('Permiso de notificaciones no concedido.');
 const registration=await navigator.serviceWorker.ready;
 const padded=key+'='.repeat((4-key.length%4)%4),raw=atob(padded.replace(/-/g,'+').replace(/_/g,'/'));
 const applicationServerKey=Uint8Array.from(raw,x=>x.charCodeAt(0));
 const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey});
 await api('/push/subscribe',{method:'POST',body:subscription.toJSON()});
}
export async function disablePush() {
 if(!('serviceWorker'in navigator))return;
 const registration=await navigator.serviceWorker.ready;const s=await registration.pushManager.getSubscription();
 if(s){await api('/push/subscribe',{method:'DELETE',body:{endpoint:s.endpoint}});await s.unsubscribe();}
}
