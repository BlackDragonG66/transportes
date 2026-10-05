/* No cache of tickets, sessions or customer information. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let payload={title:'ConexionES',body:'Hay una actualización de tu viaje.',url:'/',tag:'conexiones'};
 try{if(event.data)payload={...payload,...event.data.json()};}catch{if(event.data)payload.body=event.data.text();}
 let url=new URL('/',self.location.origin);
 try{const candidate=new URL(payload.url,self.location.origin);if(candidate.origin===self.location.origin)url=candidate;}catch{}
 event.waitUntil(self.registration.showNotification(payload.title,{body:payload.body,icon:'/icon.svg',badge:'/icon.svg',tag:payload.tag,data:{url:url.href}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=event.notification.data?.url||self.location.origin;
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
  for(const client of clients)if(new URL(client.url).origin===self.location.origin){await client.navigate(url);return client.focus();}
  return self.clients.openWindow(url);
 }));
});
