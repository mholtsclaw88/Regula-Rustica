import { openDeviceStorage } from './device-storage.mjs?v=device-storage-v1';

const startup = document.createElement('dialog');
startup.className = 'device-storage-startup';
startup.textContent = 'Opening your Farm Book…';
document.body.append(startup);
startup.showModal();
let previousCopy;

function downloadPreviousCopy() {
  const raw = previousCopy || localStorage.getItem('regulaRusticaV5') || localStorage.getItem('regulaRusticaV4') || localStorage.getItem('regulaRusticaV3');
  if (!raw) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  link.download = 'regula-rustica-previous-browser-copy.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

function action(label, callback) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn secondary';
  button.textContent = label;
  button.addEventListener('click', callback);
  return button;
}

let notice;
function showSaveError(error) {
  notice ||= document.createElement('div');
  notice.className = 'device-storage-error';
  notice.setAttribute('role', 'alert');
  notice.replaceChildren('Latest changes could not be saved on this device. Keep the app open and download a backup or retry saving. ',
    action('Download backup', () => window.RegulaRusticaLocal.exportBackup()),
    action('Retry saving', async () => {
      try {
        await window.RegulaRusticaLocal.write(window.RegulaRusticaLocal.read(), 'storage-retry');
        notice.remove();
      } catch { /* The notice stays visible and the working copy remains exportable. */ }
    }));
  document.body.prepend(notice);
  window.dispatchEvent(new CustomEvent('regula-rustica:storage-error', { detail: error }));
}

window.addEventListener('regula-rustica:data-saved', () => {
  // Wait until synchronous sync listeners have also staged their outbox edits.
  queueMicrotask(() => window.RegulaRusticaStorage.flush().then(() => notice?.remove()).catch(() => {}));
});

function loadScript(src, marker) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    if (marker) script.setAttribute(marker, 'true');
    script.onload = resolve;
    script.onerror = () => reject(new Error('The Farm Book could not finish opening. Reopen the app when connected.'));
    document.head.append(script);
  });
}

try {
  // Hydrate the original JSON keys before any app, onboarding, or sync code can
  // mistake an asynchronously loaded device for a new, empty Homestead.
  window.RegulaRusticaStorage = await openDeviceStorage({ onError: showSaveError });
  previousCopy = window.RegulaRusticaStorage.getItem('regulaRusticaV5') || window.RegulaRusticaStorage.getItem('regulaRusticaV4') || window.RegulaRusticaStorage.getItem('regulaRusticaV3');
  await loadScript('app.js?v=sync-recovery-v1');
  if (!window.RegulaRustica) throw new Error('Your saved Farm Book could not be opened. Existing saved data has been kept.');
  await window.RegulaRusticaStorage.flush();
  await loadScript('ledger-allocations.js?v=ledger-api-v2', 'data-ledger-allocations');
  await loadScript('onboarding.js?v=account-cloud-dialogs-v1');
  await loadScript('ui-refinements.js?v=cyril-record-matching-v1');
  // Register sync listeners before authentication can publish a cloud context.
  await import('./sync/runtime.mjs?v=sync-recovery-v1');
  await import('./cloud-auth.js?v=account-cloud-dialogs-v1');
  await Promise.all([
    import('./cellarer-assisted-entry.mjs?v=cyril-dialog-copy-v1'),
    import('./cellarer-receipt-reader.mjs?v=cyril-dialog-copy-v1'),
    import('./cellarer-consult.mjs?v=cyril-dialog-copy-v1')
  ]);
  window.dispatchEvent(new Event('regula-rustica:app-ready'));
  startup.close();
  startup.remove();
} catch (error) {
  startup.setAttribute('role', 'alert');
  startup.replaceChildren(`${error.message} Your saved records have not been replaced. `,
    action('Download previous copy', downloadPreviousCopy), action('Reopen', () => location.reload()));
  if (error.code === 'DEVICE_COPY_CONFLICT') {
    const choose = async choice => {
      try { await error.storage.resolveLegacyConflict(choice); location.reload(); }
      catch (failure) {
        const detail = document.createElement('p');
        detail.textContent = failure.message;
        startup.append(detail);
      }
    };
    startup.append(action('Open current saved copy', () => choose('device')),
      action('Use previous browser copy', () => choose('browser')));
  }
}
