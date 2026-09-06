const CACHE = 'regula-rustica-monastic-palette-v1';
const ASSETS = [
  './', './index.html', './styles.css?v=monastic-palette-v1', './housekeeping.css?v=monastic-palette-v1', './cloud-auth.css', './housekeeping-data.js?v=today-operational-v4', './task-foundation.js?v=record-lifecycle-v1', './record-documents.js?v=local-attachments-v1', './journal-foundation.js?v=journal-consolidation-v3', './form-selector.js?v=responsible-party-selectors-v2', './records-relationships.js?v=data-entry-forms-v2', './ui-refinements.js?v=monastic-icons-v1', './ui-refinements-core.js?v=yield-ledger-ui-v1', './ledger-receipt-modal.js?v=data-entry-forms-v2', './ledger-allocations.js?v=data-entry-forms-v2', './ledger-allocation-display.js?v=multi-record-ledger-v1', './app.js?v=monastic-icons-v1', './cloud-auth.js',
  './cloud-invitations.mjs', './sync/runtime.mjs?v=monastic-icons-v1', './sync/local-state.mjs?v=clean-cloud-baseline-v1', './sync/legacy-recovery.mjs', './sync/entities.mjs', './sync/cloud-adapter.mjs', './sync/engine.mjs',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'
];
const OPTIONAL_ASSETS = ['./cloud-runtime-config.js','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.1/+esm'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(async cache=>{await cache.addAll(ASSETS);await Promise.all(OPTIONAL_ASSETS.map(asset=>cache.add(asset).catch(()=>null)));}).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(caches.match(event.request).then(response=>response||fetch(event.request)));});
