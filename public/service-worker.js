const CACHE='lsh-premium-v1';
const ASSETS=[
  './',
  './styles.css',
  './app.js',
  './assets/logo.svg',
  './assets/proprietaria-lsh.webp',
  './assets/antes-01.webp',
  './assets/depois-01.webp',
  './assets/resultado-02.webp',
  './assets/resultado-03.webp'
];
self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
});
self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
  );
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  event.respondWith(
    fetch(event.request).then(response=>{
      const clone=response.clone();
      caches.open(CACHE).then(cache=>cache.put(event.request, clone));
      return response;
    }).catch(()=>caches.match(event.request))
  );
});
