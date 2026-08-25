const CACHE = 'regula-rustica-mobile-nav-chore-v1';
const ASSETS = [
  './', './index.html', './styles.css?v=mobile-primary-nav-v6', './housekeeping.css?v=chore-window-editor-v1', './cloud-auth.css', './housekeeping-data.js?v=record-task-lifecycle-v2', './task-foundation.js?v=record-task-lifecycle-v2', './record-documents.js?v=local-attachments-v1', './journal-foundation.js?v=journal-consolidation-v3', './records-relationships.js', './ui-refinements.js?v=mobile-primary-nav-v4', './ui-refinements-core.js?v=journal-documents-v1', './ledger-receipt-modal.js?v=ledger-form-v1', './ledger-allocations.js?v=ledger-form-v1', './ledger-allocation-display.js?v=reporting-v1', './app.js?v=chore-window-editor-v1', './cloud-auth.js',
  './cloud-invitations.mjs', './sync/runtime.mjs?v=unified-tasks-v1', './sync/local-state.mjs', './sync/entities.mjs', './sync/cloud-adapter.mjs', './sync/engine.mjs',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'
];
const OPTIONAL_ASSETS = ['./cloud-runtime-config.js','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.1/+esm'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(async cache=>{await cache.addAll(ASSETS);await Promise.all(OPTIONAL_ASSETS.map(asset=>cache.add(asset).catch(()=>null)));}).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(caches.match(event.request).then(response=>response||fetch(event.request)));});
