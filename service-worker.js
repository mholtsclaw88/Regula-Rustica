const CACHE = 'regula-rustica-notifications-v1';
const ASSETS = [
  './', './index.html', './app-bootstrap.mjs?v=notifications-v1', './device-storage.mjs?v=device-storage-v1', './styles.css?v=notifications-v1', './housekeeping.css?v=notifications-v1', './cloud-auth.css', './onboarding.css?v=standard-onboarding-v1', './housekeeping-data.js?v=today-focus-v1', './task-foundation.js?v=today-focus-v1', './record-documents.js?v=homestead-identity-v1', './journal-foundation.js?v=journal-consolidation-v3', './form-selector.js?v=responsible-party-selectors-v2', './records-relationships.js?v=data-entry-forms-v2', './ui-refinements.js?v=cyril-record-matching-v1', './ui-refinements-core.js?v=ledger-page-v1', './ledger-receipt-modal.js?v=cyril-receipt-reader-v2', './ledger-allocations.js?v=ledger-api-v2', './ledger-allocation-display.js?v=ledger-api-v2', './cellarer-assisted-entry.mjs?v=cyril-dialog-copy-v1', './cellarer-receipt-reader.mjs?v=cyril-dialog-copy-v1', './cellarer-consult.mjs?v=cyril-dialog-copy-v1', './app.js?v=notifications-v1', './onboarding.js?v=account-cloud-dialogs-v1', './cloud-auth.js?v=chore-push-v1',
  './cloud-invitations.mjs', './sync/runtime.mjs?v=notifications-v1', './sync/premium-access.mjs', './sync/local-state.mjs?v=notifications-v1', './sync/legacy-recovery.mjs', './sync/entities.mjs', './sync/cloud-adapter.mjs', './sync/engine.mjs?v=notifications-v1',
  './chore-push-client.mjs?v=notifications-v1', './chore-push-core.mjs',
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
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let message = {};
    try { message = event.data?.json() || {}; } catch { return; }
    if (!message.windowId || !message.workDate || !message.title || !message.body) return;
    await self.registration.showNotification(message.title, {
      body: message.body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: `chore-window:${message.windowId}:${message.workDate}`,
      data: { url: './?view=today' }
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || './?view=today', self.registration.scope);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === target.origin);
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'chore-window-reminder-open' });
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});
