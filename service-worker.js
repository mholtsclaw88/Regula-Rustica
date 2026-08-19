const CACHE = 'regula-rustica-today-dashboard-v2';
const ASSETS = [
  './', './index.html', './styles.css?v=today-dashboard-v2', './housekeeping.css?v=yield-indicator-v1', './cloud-auth.css', './housekeeping-data.js?v=unified-tasks-v1', './task-foundation.js?v=record-task-ux-v4', './records-relationships.js', './ui-refinements.js?v=today-dashboard-v2', './ui-refinements-core.js?v=record-ui-v1', './today-refinements.js?v=today-v2', './ledger-receipt-modal.js?v=ledger-form-v1', './ledger-allocations.js?v=ledger-form-v1', './ledger-allocation-display.js?v=reporting-v1', './app.js?v=yield-indicator-v1', './cloud-auth.js',
  './cloud-invitations.mjs', './sync/runtime.mjs?v=unified-tasks-v1', './sync/local-state.mjs', './sync/entities.mjs', './sync/cloud-adapter.mjs', './sync/engine.mjs',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'
];
const OPTIONAL_ASSETS = ['./cloud-runtime-config.js','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.1/+esm'];
const rewriteAsset = request => {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return request;
  if (url.pathname.endsWith('/styles.css')) return new Request(`${url.origin}${url.pathname}?v=today-dashboard-v2`, request);
  if (url.pathname.endsWith('/ui-refinements.js')) return new Request(`${url.origin}${url.pathname}?v=today-dashboard-v2`, request);
  if (url.pathname.endsWith('/today-refinements.js')) return new Request(`${url.origin}${url.pathname}?v=today-v2`, request);
  return request;
};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(async cache=>{await cache.addAll(ASSETS);await Promise.all(OPTIONAL_ASSETS.map(asset=>cache.add(asset).catch(()=>null)));}).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const request=rewriteAsset(event.request);
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;}).catch(()=>caches.match(event.request).then(response=>response||caches.match('./index.html'))));
    return;
  }
  event.respondWith(fetch(request,{cache:'no-store'}).then(response=>{if(response&&response.ok&&new URL(request.url).origin===self.location.origin){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}return response;}).catch(()=>caches.match(request).then(response=>response||caches.match(event.request))));
});