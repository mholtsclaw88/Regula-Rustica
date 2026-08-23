import { SupabaseSyncAdapter } from './cloud-adapter.mjs';
import { SyncEngine } from './engine.mjs';
import { LocalSyncState } from './local-state.mjs';

const state = new LocalSyncState();
const status = document.querySelector('#syncStatus');
const actions = document.querySelector('#syncFirstActions');
const conflictList = document.querySelector('#syncConflicts');
const syncNow = document.querySelector('#syncNow');
const offlineEngine = new SyncEngine({
  state,
  cloud: null,
  readLocal: () => window.RegulaRusticaLocal.read(),
  writeLocal: (data, source) => window.RegulaRusticaLocal.write(data, source),
  onStatus: render
});
let engine = offlineEngine;
let context = null;
let firstCase = null;

window.RegulaRusticaSync = Object.freeze({
  isInitialized: () => state.state.initialSyncCompleted
});

function message(kind, error) {
  const waiting = state.state.outbox.length;
  const conflicts = state.state.conflicts.filter(item => item.status === 'unresolved').length;
  if (conflicts) return `${conflicts} change${conflicts === 1 ? '' : 's'} need review`;
  if (kind === 'syncing') return 'Syncing…';
  if (kind === 'offline' || !navigator.onLine) return `Offline — changes saved locally${waiting ? ` · ${waiting} waiting` : ''}`;
  if (kind === 'problem') return `Sync problem${error?.message ? ` — ${error.message}` : ''}`;
  if (waiting) return `${waiting} change${waiting === 1 ? '' : 's'} waiting`;
  if (!context?.homesteadId) return 'Cloud synchronization is disconnected.';
  if (!state.state.enabled) return 'Cloud synchronization is not connected.';
  return 'Synced';
}

function render(kind = 'ready', error = null) {
  status.textContent = message(kind, error);
  status.classList.toggle('error', kind === 'problem');
  syncNow.classList.toggle('hidden', !context?.homesteadId || !state.state.initialSyncCompleted);
  actions.classList.toggle('hidden', !firstCase || state.state.initialSyncCompleted);
  actions.querySelectorAll('[data-cases]').forEach(button => {
    button.classList.toggle('hidden', !button.dataset.cases.includes(firstCase));
  });
  const unresolved = state.state.conflicts.filter(item => item.status === 'unresolved');
  conflictList.innerHTML = '';
  unresolved.forEach(conflict => {
    const item = document.createElement('div');
    item.className = 'sync-conflict';
    item.innerHTML = `<p><strong>${conflict.table.replaceAll('_', ' ')}</strong> changed here and in the cloud.</p><div class="quick"><button class="btn secondary" data-choice="cloud">Keep cloud version</button><button class="btn primary" data-choice="local">Use my version</button></div>`;
    item.querySelectorAll('button').forEach(button => button.addEventListener('click', () => run(() => engine.resolveConflict(conflict.id, button.dataset.choice))));
    conflictList.appendChild(item);
  });
}

async function run(action) {
  render('syncing');
  try { await action(); render('synced'); }
  catch (error) { render(navigator.onLine ? 'problem' : 'offline', error); }
}

async function syncAttachmentsThen(action) {
  if (window.RegulaRustica?.syncLocalAttachments) await window.RegulaRustica.syncLocalAttachments({ requireAll: true });
  return action();
}

async function connect(nextContext) {
  context = nextContext;
  engine = offlineEngine;
  firstCase = null;
  if (!context?.session || !context.homesteadId) {
    render('ready');
    return;
  }
  if (state.state.homesteadId && state.state.homesteadId !== context.homesteadId) {
    status.textContent = 'This device contains a different Homestead. Sync is stopped to protect both datasets.';
    status.classList.add('error');
    return;
  }
  engine = new SyncEngine({
    state,
    cloud: new SupabaseSyncAdapter(context.client),
    readLocal: () => window.RegulaRusticaLocal.read(),
    writeLocal: (data, source) => window.RegulaRusticaLocal.write(data, source),
    onStatus: render
  });
  if (state.state.initialSyncCompleted) run(() => syncAttachmentsThen(() => engine.sync()));
  else run(async () => {
    const inspection = await engine.inspectFirstSync(context.homesteadId);
    firstCase = inspection.case;
    render('ready');
  });
}

window.addEventListener('regula-rustica:cloud-context', event => connect(event.detail));
window.addEventListener('regula-rustica:data-saved', event => {
  if (event.detail.source === 'sync') return;
  engine.queueLocalChanges(event.detail.before, event.detail.after);
  render(navigator.onLine ? 'ready' : 'offline');
  if (event.detail.source === 'attachment-sync') return;
  if (navigator.onLine && context?.homesteadId && state.state.initialSyncCompleted) run(() => syncAttachmentsThen(() => engine.sync()));
});
window.addEventListener('online', () => engine && state.state.initialSyncCompleted && run(() => syncAttachmentsThen(() => engine.sync())));
window.addEventListener('offline', () => render('offline'));

syncNow.addEventListener('click', () => context?.homesteadId && run(() => syncAttachmentsThen(() => engine.sync())));
document.querySelector('#syncUpload').addEventListener('click', () => run(() => syncAttachmentsThen(() => engine.initialize('upload', context.homesteadId))));
document.querySelector('#syncDownload').addEventListener('click', () => run(() => syncAttachmentsThen(() => engine.initialize('download', context.homesteadId))));
document.querySelector('#syncUseCloud').addEventListener('click', () => {
  window.RegulaRusticaLocal.exportBackup();
  run(() => engine.initialize('cloud', context.homesteadId));
});
document.querySelector('#syncInitializeEmpty').addEventListener('click', () => run(() => syncAttachmentsThen(() => engine.initialize('empty', context.homesteadId))));
document.querySelector('#syncCancel').addEventListener('click', () => { firstCase = null; render('ready'); });

render();
if (window.REGULA_RUSTICA_CLOUD_CONTEXT) connect(window.REGULA_RUSTICA_CLOUD_CONTEXT);
