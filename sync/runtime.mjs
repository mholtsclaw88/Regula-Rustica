import { SupabaseSyncAdapter } from './cloud-adapter.mjs';
import { SyncEngine } from './engine.mjs';
import { conflictPresentation } from './entities.mjs';
import { LocalSyncState } from './local-state.mjs';

const state = new LocalSyncState();
const status = document.querySelector('#syncStatus');
const actions = document.querySelector('#syncFirstActions');
const conflictList = document.querySelector('#syncConflicts');
const syncNow = document.querySelector('#syncNow');
const syncRecovery = document.querySelector('#syncRecovery');
const syncResetFromCloud = document.querySelector('#syncResetFromCloud');
const headerStatus = document.querySelector('#headerSyncStatus');
const headerStatusLabel = document.querySelector('#headerSyncLabel');
const headerStatusDetail = document.querySelector('#headerSyncDetail');
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
let attachmentRun = null;
let syncTimer = null;

const DOMAIN_LABELS = Object.freeze({
  homestead_people: 'People', records: 'Records', record_documents: 'Documents', record_attachments: 'Attachments',
  chore_windows: 'Chore Windows', tasks: 'Tasks', record_relationships: 'Records', task_assignments: 'Tasks',
  chronicle_entries: 'Journal', calendar_events: 'Calendar', yield_entries: 'Yield', notes: 'Journal',
  ledger_entries: 'Ledger', ledger_allocations: 'Ledger', routines: 'Routines', routine_occurrences: 'Routines'
});

const HEADER_STATUS_ICONS = Object.freeze({
  synced: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 8.8 4.5 4.5 0 0 0 7 18Z"/><path d="m9 13 2 2 4-5"/><circle cx="19" cy="18" r="2"/>',
  syncing: '<path d="M19 8a7 7 0 0 0-12-2L5 8M5 5v3h3M5 16a7 7 0 0 0 12 2l2-2m0 3v-3h-3"/><circle cx="19" cy="19" r="2"/>',
  issue: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 8.8 4.5 4.5 0 0 0 7 18Z"/><path d="M12 10v3m0 2h.01"/><circle cx="19" cy="18" r="2"/>',
  offline: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 8.8 4.5 4.5 0 0 0 7 18Z"/><path d="m9 11 6 6m0-6-6 6"/><circle cx="19" cy="18" r="2"/>',
  local: '<path d="M7 4h10v16H7zM10 17h4"/><circle cx="18" cy="18" r="3"/>'
});

window.RegulaRusticaSync = Object.freeze({
  isInitialized: () => state.state.initialSyncCompleted
});

function message(kind, error) {
  const waiting = state.state.outbox.length;
  const conflicts = state.state.conflicts.filter(item => item.status === 'unresolved').length;
  const blocked = state.state.outbox.filter(item => ['blocked', 'dependency'].includes(item.status));
  if (conflicts) return `${conflicts} change${conflicts === 1 ? '' : 's'} need review`;
  if (kind === 'syncing') return 'Syncing…';
  if (kind === 'offline' || !navigator.onLine) return `Offline — changes saved locally${waiting ? ` · ${waiting} waiting` : ''}`;
  if (blocked.length) {
    const labels = [...new Set(blocked.map(item => DOMAIN_LABELS[item.table] || item.table.replaceAll('_', ' ')))];
    return `${blocked.length} change${blocked.length === 1 ? '' : 's'} could not sync · ${labels.join(', ')}`;
  }
  if (kind === 'problem') return `Sync problem${error?.message ? ` — ${error.message}` : ''}`;
  if (waiting) return `${waiting} change${waiting === 1 ? '' : 's'} waiting`;
  if (!context?.homesteadId) return 'Cloud synchronization is disconnected.';
  if (!state.state.enabled) return 'Cloud synchronization is not connected.';
  return 'Synced';
}

function headerStatusSnapshot(kind) {
  const conflicts = state.state.conflicts.some(item => item.status === 'unresolved');
  const blocked = state.state.outbox.some(item => ['blocked', 'dependency'].includes(item.status));
  if (!context?.homesteadId || !state.state.enabled) return { state: 'local', label: 'Local only', detail: 'Saved on this device' };
  if (kind === 'offline' || !navigator.onLine) return { state: 'offline', label: 'Offline', detail: 'Cloud sync unavailable' };
  if (conflicts || blocked || kind === 'problem' || kind === 'attention') return { state: 'issue', label: 'Sync issue', detail: 'Some changes could not sync' };
  if (kind === 'syncing' || state.state.outbox.length) return { state: 'syncing', label: 'Syncing', detail: 'Changes are being synchronized' };
  return { state: 'synced', label: 'Synced', detail: state.state.lastSuccessfulSyncAt ? 'Just now' : 'Everything is up to date' };
}

function renderHeaderStatus(kind) {
  if (!headerStatus) return;
  const snapshot = headerStatusSnapshot(kind);
  headerStatus.className = `header-sync-status is-${snapshot.state}`;
  headerStatus.dataset.state = snapshot.state;
  headerStatus.setAttribute('aria-label', `${snapshot.label}. ${snapshot.detail}`);
  headerStatus.title = `${snapshot.label} — ${snapshot.detail}`;
  headerStatus.querySelector('svg').innerHTML = HEADER_STATUS_ICONS[snapshot.state];
  headerStatusLabel.textContent = snapshot.label;
  headerStatusDetail.textContent = snapshot.detail;
  window.dispatchEvent(new CustomEvent('regula-rustica:sync-status', { detail: snapshot }));
}

function render(kind = 'ready', error = null) {
  status.textContent = message(kind, error);
  renderHeaderStatus(kind);
  status.classList.toggle('error', kind === 'problem' || kind === 'attention' || state.state.outbox.some(item => item.status === 'blocked'));
  syncNow.classList.toggle('hidden', !context?.homesteadId || !state.state.initialSyncCompleted);
  const recoveryInProgress = state.state.initialSyncState?.case === 'device-cloud-recovery'
    && state.state.initialSyncState.status !== 'complete';
  syncRecovery.classList.toggle('hidden', !context?.homesteadId || (!state.state.initialSyncCompleted && !recoveryInProgress));
  actions.classList.toggle('hidden', !firstCase || state.state.initialSyncCompleted);
  actions.querySelectorAll('[data-cases]').forEach(button => {
    button.classList.toggle('hidden', !button.dataset.cases.includes(firstCase));
  });
  const unresolved = state.state.conflicts.filter(item => item.status === 'unresolved');
  conflictList.innerHTML = '';
  unresolved.forEach(conflict => {
    const item = document.createElement('div');
    item.className = 'sync-conflict';
    const presentation = conflictPresentation(conflict, window.RegulaRusticaLocal.read());
    const title = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = presentation.title;
    title.appendChild(strong);
    item.appendChild(title);
    if (presentation.detail) {
      const detail = document.createElement('p');
      detail.className = 'muted';
      detail.textContent = presentation.detail;
      item.appendChild(detail);
    }
    const choices = document.createElement('div');
    choices.className = 'quick';
    [['cloud', 'secondary', 'Keep cloud version'], ['local', 'primary', 'Use my version']].forEach(([choice, style, label]) => {
      const button = document.createElement('button');
      button.className = `btn ${style}`;
      button.dataset.choice = choice;
      button.textContent = label;
      button.addEventListener('click', () => run(() => engine.resolveConflict(conflict.id, choice)));
      choices.appendChild(button);
    });
    item.appendChild(choices);
    conflictList.appendChild(item);
  });
  state.state.outbox.filter(item => ['blocked', 'dependency'].includes(item.status)).forEach(operation => {
    const item = document.createElement('div');
    item.className = 'sync-conflict';
    const title = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = DOMAIN_LABELS[operation.table] || operation.table.replaceAll('_', ' ');
    title.append(strong, ` ${operation.type || 'change'} could not sync.`);
    const detail = document.createElement('p');
    detail.className = 'muted';
    detail.textContent = `Item ${operation.localId || 'unknown'} · ${operation.attempts || 0} attempt${operation.attempts === 1 ? '' : 's'} · ${operation.lastErrorCode || 'SYNC_BLOCKED'} · ${operation.lastErrorAt || 'not attempted'}`;
    item.append(title, detail);
    conflictList.appendChild(item);
  });
}

async function run(action) {
  render('syncing');
  try { await action(); render('ready'); }
  catch (error) { render(navigator.onLine ? 'problem' : 'offline', error); }
}

function canSync() {
  return navigator.onLine && context?.homesteadId && state.state.initialSyncCompleted;
}

function startAttachmentSync() {
  if (attachmentRun || !canSync() || !window.RegulaRustica?.syncLocalAttachments) return attachmentRun;
  attachmentRun = window.RegulaRustica.syncLocalAttachments({ requireAll: false })
    .catch(() => null)
    .finally(() => {
      attachmentRun = null;
      if (canSync()) run(() => engine.sync());
    });
  return attachmentRun;
}

function scheduleSync({ retryBlocked = false } = {}) {
  if (!canSync()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    run(() => engine.sync({ retryBlocked }));
    startAttachmentSync();
  }, 500);
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
  if (state.state.initialSyncCompleted) scheduleSync();
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
  scheduleSync();
  if (event.detail.source !== 'attachment-sync') startAttachmentSync();
});
window.addEventListener('online', () => scheduleSync());
window.addEventListener('offline', () => render('offline'));
window.addEventListener('focus', () => scheduleSync());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleSync();
});
setInterval(() => {
  if (document.visibilityState === 'visible') scheduleSync();
}, 60000);

syncNow.addEventListener('click', () => {
  if (!context?.homesteadId) return;
  run(() => engine.sync({ retryBlocked: true }));
  startAttachmentSync();
});
syncResetFromCloud.addEventListener('click', () => {
  if (!context?.homesteadId) return;
  const confirmed = window.confirm('Are you sure? This will discard queued local changes on this device and replace its working copy with the current cloud Homestead. Cloud data will not be deleted. A safety backup will be saved first.');
  if (!confirmed) return;
  window.RegulaRusticaLocal.exportBackup();
  run(() => engine.resetDeviceFromCloud(context.homesteadId));
});
headerStatus?.addEventListener('click', () => {
  document.querySelector('.nav button[data-view="settings"]')?.click();
  requestAnimationFrame(() => document.querySelector('[data-settings-category="cloud"]')?.click());
});
document.querySelector('#syncUpload').addEventListener('click', () => run(async () => {
  await engine.initialize('upload', context.homesteadId);
  startAttachmentSync();
}));
document.querySelector('#syncDownload').addEventListener('click', () => run(() => engine.initialize('download', context.homesteadId)));
document.querySelector('#syncUseCloud').addEventListener('click', () => {
  window.RegulaRusticaLocal.exportBackup();
  run(() => engine.initialize('cloud', context.homesteadId));
});
document.querySelector('#syncInitializeEmpty').addEventListener('click', () => run(async () => {
  await engine.initialize('empty', context.homesteadId);
  startAttachmentSync();
}));
document.querySelector('#syncCancel').addEventListener('click', () => { firstCase = null; render('ready'); });

render();
if (window.REGULA_RUSTICA_CLOUD_CONTEXT) connect(window.REGULA_RUSTICA_CLOUD_CONTEXT);
