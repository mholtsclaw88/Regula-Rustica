const CACHE = 'regula-rustica-cloud-sync-stability-v1';
const ASSETS = [
  './', './index.html', './styles.css?v=today-daily-planner-v2', './housekeeping.css?v=today-daily-planner-v2', './cloud-auth.css', './housekeeping-data.js?v=recurring-resync-v2', './task-foundation.js?v=recurring-resync-v2', './record-documents.js?v=local-attachments-v1', './journal-foundation.js?v=journal-consolidation-v3', './form-selector.js?v=responsible-party-selectors-v2', './records-relationships.js?v=data-entry-forms-v2', './ui-refinements.js?v=data-entry-forms-v2', './ui-refinements-core.js?v=journal-documents-v1', './ledger-receipt-modal.js?v=data-entry-forms-v2', './ledger-allocations.js?v=data-entry-forms-v2', './ledger-allocation-display.js?v=multi-record-ledger-v1', './app.js?v=cloud-sync-stability-v1', './cloud-auth.js',
  './cloud-invitations.mjs', './sync/runtime.mjs?v=cloud-sync-stability-v1', './sync/local-state.mjs', './sync/legacy-recovery.mjs', './sync/entities.mjs', './sync/cloud-adapter.mjs', './sync/engine.mjs',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'
];
const OPTIONAL_ASSETS = ['./cloud-runtime-config.js','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.1/+esm'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(async cache=>{await cache.addAll(ASSETS);await Promise.all(OPTIONAL_ASSETS.map(asset=>cache.add(asset).catch(()=>null)));}).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(caches.match(event.request).then(response=>response||fetch(event.request)));});
