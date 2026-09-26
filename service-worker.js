const CACHE = 'regula-rustica-account-cloud-dialogs-v1';
const ASSETS = [
  './', './index.html', './styles.css?v=cyril-assisted-entry-v1', './housekeeping.css?v=account-cloud-dialogs-v1', './cloud-auth.css', './onboarding.css?v=standard-onboarding-v1', './housekeeping-data.js?v=calendar-projections-v1', './task-foundation.js?v=record-lifecycle-v1', './record-documents.js?v=homestead-identity-v1', './journal-foundation.js?v=journal-consolidation-v3', './form-selector.js?v=responsible-party-selectors-v2', './records-relationships.js?v=data-entry-forms-v2', './ui-refinements.js?v=cyril-record-matching-v1', './ui-refinements-core.js?v=ledger-page-v1', './ledger-receipt-modal.js?v=cyril-receipt-reader-v2', './ledger-allocations.js?v=ledger-api-v2', './ledger-allocation-display.js?v=ledger-api-v2', './cellarer-assisted-entry.mjs?v=cyril-consult-v1', './cellarer-receipt-reader.mjs?v=cyril-draft-review-v1', './cellarer-consult.mjs?v=cyril-copy-v1', './app.js?v=account-cloud-dialogs-v1', './onboarding.js?v=account-cloud-dialogs-v1', './cloud-auth.js?v=account-cloud-dialogs-v1',
  './cloud-invitations.mjs', './sync/runtime.mjs?v=account-cloud-dialogs-v1', './sync/premium-access.mjs', './sync/local-state.mjs?v=clean-cloud-baseline-v1', './sync/legacy-recovery.mjs', './sync/entities.mjs', './sync/cloud-adapter.mjs', './sync/engine.mjs',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'
];
const OPTIONAL_ASSETS = ['./cloud-runtime-config.js','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.1/+esm'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(async cache=>{await cache.addAll(ASSETS);await Promise.all(OPTIONAL_ASSETS.map(asset=>cache.add(asset).catch(()=>null)));}).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).catch(async()=>await caches.match(event.request)||await caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then(response=>response||fetch(event.request)));
});
