const CACHE = 'regula-rustica-ui-navigation-v2';
const ASSETS = [
  './', './index.html', './styles.css', './housekeeping.css?v=routines-v4', './cloud-auth.css', './housekeeping-data.js?v=routines-v4', './routines-data.js?v=routines-v4', './routine-stabilization.js?v=stabilization-v2', './ui-navigation-refinement.js?v=ui-nav-v2', './records-relationships.js', './ui-refinements.js?v=ledger-receipts-v1', './ui-refinements-core.js?v=ledger-receipts-v2', './ledger-receipt-modal.js?v=ledger-receipts-v3', './ledger-allocations.js?v=allocations-v5', './ledger-allocation-display.js?v=allocations-v1', './app.js?v=routines-v4', './cloud-auth.js',
  './cloud-invitations.mjs', './sync/runtime.mjs?v=routines-v4', './sync/local-state.mjs', './sync/entities.mjs', './sync/cloud-adapter.mjs', './sync/engine.mjs',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'
];
const OPTIONAL_ASSETS = ['./cloud-runtime-config.js','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.1/+esm'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(async cache=>{await cache.addAll(ASSETS);await Promise.all(OPTIONAL_ASSETS.map(asset=>cache.add(asset).catch(()=>null)));}).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(caches.match(event.request).then(response=>response||fetch(event.request)));});
