const CACHE_NAME="cattle-records-shell-v50";
const SHELL=[
  "./index.html",
  "./styles.css?v=50",
  "./app.js?v=50",
  "./manifest.webmanifest?v=50",
  "./ranch-scene.jpg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys
        .filter(key=>key!==CACHE_NAME&&key.startsWith("cattle-records-shell-"))
        .map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  // Only page navigations may fall back to index.html.
  // Never return HTML for a JavaScript/CSS request.
  if(request.mode==="navigate"){
    event.respondWith(
      fetch(request)
        .then(response=>{
          if(response.ok){
            const copy=response.clone();
            caches.open(CACHE_NAME).then(cache=>cache.put("./index.html",copy));
          }
          return response;
        })
        .catch(()=>caches.match("./index.html"))
    );
    return;
  }

  // Versioned app assets are network-first and fall back only to the
  // matching cached asset, never to the HTML shell.
  event.respondWith(
    fetch(request)
      .then(response=>{
        if(response.ok){
          const copy=response.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put(request,copy));
        }
        return response;
      })
      .catch(()=>caches.match(request))
  );
});


self.addEventListener("push",event=>{
  let data={};
  try{data=event.data?event.data.json():{}}catch{data={body:event.data?event.data.text():"New Farm Chat message"}}
  const title=data.title||"Farm Chat";
  const options={
    body:data.body||"New message in Farm Chat",
    tag:data.tag||"farm-chat",
    icon:"./icon-192.png",
    badge:"./icon-192.png",
    data:data.data||{url:"/cattle-records/?open=chat"},
    renotify:true
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=event.notification?.data?.url||"/cattle-records/?open=chat";
  event.waitUntil((async()=>{
    const windows=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of windows){
      try{
        const u=new URL(client.url);
        if(u.origin===self.location.origin){
          await client.focus();
          client.postMessage({type:"OPEN_CHAT"});
          return;
        }
      }catch{}
    }
    if(clients.openWindow)await clients.openWindow(target);
  })());
});
