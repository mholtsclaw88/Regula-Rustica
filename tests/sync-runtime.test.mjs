import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { SyncEngine } from '../sync/engine.mjs';
import { LocalSyncState, SYNC_STORAGE_KEYS, syncDiagnosticSummary } from '../sync/local-state.mjs';
import { DOMAIN_ORDER, conflictPresentation } from '../sync/entities.mjs';
import { premiumSyncAvailable } from '../sync/premium-access.mjs';

Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const source = (await readFile(new URL('../sync/runtime.mjs', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');

test('an existing service worker cannot serve old code for any changed recovery module', async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const [html, bootstrap, runtime, worker] = await Promise.all(['index.html', 'app-bootstrap.mjs', 'sync/runtime.mjs', 'service-worker.js'].map(read));
  const version = html.match(/app-bootstrap\.mjs\?v=([^"']+)/)[1];
  assert.notEqual(version, 'device-storage-v1');
  for (const [code, path] of [[bootstrap, 'app.js'], [bootstrap, 'sync/runtime.mjs'], [runtime, 'engine.mjs'], [runtime, 'local-state.mjs']]) {
    assert.ok(code.includes(`${path}?v=${version}`), `${path} must bypass the previous worker cache`);
  }
  for (const path of ['app-bootstrap.mjs', 'app.js', 'sync/runtime.mjs', 'sync/engine.mjs', 'sync/local-state.mjs']) {
    assert.ok(worker.includes(`${path}?v=${version}`), `${path} must be available offline`);
  }
});

class Element extends EventTarget {
  constructor() {
    super(); this.textContent = ''; this.dataset = {}; this.children = [];
    const classes = new Set();
    this.classList = { toggle: (key, on) => on ? classes.add(key) : classes.delete(key), add: key => classes.add(key), contains: key => classes.has(key) };
  }
  setAttribute() {}
  querySelector() { return this.svg ||= new Element(); }
  querySelectorAll() { return this.buttons || []; }
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.append(item); }
  replaceChildren(...items) { this.children = items; }
}

async function runtime({ edits = false, online = true, premium = true, failDownload = false } = {}) {
  const storage = { values: new Map(), getItem(key) { return this.values.get(key) ?? null; }, setItem(key, value) { this.values.set(key, value); } };
  const state = new LocalSyncState(storage);
  const homestead = crypto.randomUUID();
  state.bind(homestead);
  const original = { records: [{ id: crypto.randomUUID(), name: 'Original local work' }] };
  const backup = await state.createVerifiedBackup(original, 'before-device-cloud-recovery');
  state.state.initialSyncState = { case: 'device-cloud-recovery', status: 'failed', backupId: backup.id, error: 'Storage quota exceeded' };
  let local = { records: [], settings: { homesteadName: 'Test' } };
  if (edits) {
    local.records.push({ id: crypto.randomUUID(), name: 'Newer local work', type: 'Animal', status: 'Active', identity: {}, stewardship: {} });
    state.enqueue({ table: 'records', type: 'create', localId: local.records[0].id, payload: { name: 'Newer local work' } });
  }
  state.save();
  const cloudRow = { id: crypto.randomUUID(), version: 2, type: 'animal', name: 'Cloud Daisy', status: 'Active', identity: {}, stewardship: {}, created_at: '2026-10-14T12:00:00.000Z', updated_at: '2026-10-14T12:00:00.000Z', deleted_at: null };
  const cloud = {
    writes: [], fail: failDownload,
    async counts() { return Object.fromEntries(DOMAIN_ORDER.map(table => [table, table === 'records' ? 1 : 0])); },
    async memberDirectory() { return []; },
    async *changes(table) {
      if (this.fail) throw new Error('Download connection failed');
      if (table === 'records') yield { rows: [cloudRow], cursor: { updatedAt: cloudRow.updated_at, id: cloudRow.id } };
    },
    async apply(operation) { this.writes.push(operation); throw new Error('Unexpected cloud write'); }
  };
  const elements = new Map();
  const document = new EventTarget();
  document.querySelector = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  document.createElement = () => new Element();
  document.visibilityState = 'visible';
  document.querySelector('#syncFirstActions').buttons = ['A', 'B', 'C', 'D', 'ABC'].map(cases => {
    const element = new Element(); element.dataset.cases = cases; return element;
  });
  const window = new EventTarget();
  let exports = 0;
  let confirmed = false;
  window.confirm = () => confirmed;
  window.RegulaRusticaLocal = { read: () => structuredClone(local), write: async value => { local = structuredClone(value); }, exportBackup: () => { exports++; } };
  const timers = new Map();
  const navigator = { onLine: online };
  const sandbox = vm.createContext({
    window, document, navigator, CustomEvent, structuredClone,
    SyncEngine, conflictPresentation, premiumSyncAvailable,
    LocalSyncState: class extends LocalSyncState { constructor() { super(storage); } },
    SupabaseSyncAdapter: class { constructor(client) { return client; } },
    syncDiagnosticSummary,
    setInterval: () => {}, clearTimeout: id => timers.delete(id),
    setTimeout: callback => { const id = {}; timers.set(id, callback); return id; }
  });
  vm.runInContext(source, sandbox);
  const context = { homesteadId: homestead, session: { access_token: 'fixture-session' }, client: cloud, premium: premium ? { plan_key: 'premium', status: 'active' } : null };
  window.dispatchEvent(new CustomEvent('regula-rustica:cloud-context', { detail: context }));
  await vm.runInContext('connectPromise', sandbox);
  return {
    window, navigator, cloud, elements, local: () => local, storage, backup, homestead,
    state: () => JSON.parse(storage.getItem(SYNC_STORAGE_KEYS.state)),
    exports: () => exports, confirm: value => { confirmed = value; },
    async idle() { for (let i = 0; i < 100 && vm.runInContext('actionInProgress', sandbox); i++) await new Promise(resolve => setImmediate(resolve)); },
    async reconnect() {
      navigator.onLine = true; cloud.fail = false;
      window.dispatchEvent(new Event('online'));
      const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback());
      await this.idle();
    }
  };
}

test('Premium on an already configured device resumes cloud recovery instead of showing setup', async () => {
  const h = await runtime();
  assert.equal(h.window.RegulaRusticaSync.isInitialized(), true);
  assert.equal(h.window.RegulaRusticaSync.getStatus().label, 'Synced');
  assert.equal(h.local().records[0].name, 'Cloud Daisy');
  assert.ok(h.elements.get('#syncFirstActions').classList.contains('hidden'));
  assert.ok(h.elements.get('#syncRecoveryActions').classList.contains('hidden'));
  assert.equal(h.state().initialSyncState.backupId, h.backup.id);
  assert.equal(h.cloud.writes.length, 0);
});

test('new local work pauses recovery with a usable retry action and requires confirmation', async () => {
  const h = await runtime({ edits: true });
  const status = h.window.RegulaRusticaSync.getStatus();
  assert.equal(status.recovery, true);
  assert.equal(status.label, 'Sync recovery');
  assert.equal(h.window.RegulaRusticaSync.isInitialized(), false);
  assert.ok(h.elements.get('#syncFirstActions').classList.contains('hidden'));
  const retry = h.elements.get('#syncRetryCloudRecovery');
  assert.equal(retry.textContent, 'Back up and retry cloud download');
  assert.equal(retry.disabled, false);
  retry.dispatchEvent(new Event('click')); await h.idle();
  assert.equal(h.exports(), 0);
  assert.equal(h.state().outbox.length, 1);
  assert.equal(h.local().records[0].name, 'Newer local work');
  h.confirm(true);
  retry.dispatchEvent(new Event('click')); retry.dispatchEvent(new Event('click'));
  await h.idle();
  assert.equal(h.exports(), 1);
  assert.equal(h.window.RegulaRusticaSync.isInitialized(), true);
  const backups = JSON.parse(h.storage.getItem(SYNC_STORAGE_KEYS.backups));
  assert.ok(backups.some(item => item.id === h.backup.id));
  assert.ok(backups.some(item => item.data.records.some(row => row.name === 'Newer local work')));
  assert.equal(h.cloud.writes.length, 0);
});

test('an interrupted recovery preserves its failure and retries after reconnecting', async () => {
  const h = await runtime({ failDownload: true });
  assert.equal(h.window.RegulaRusticaSync.getStatus().label, 'Sync recovery');
  assert.match(h.elements.get('#syncStatus').textContent, /Download connection failed/);
  assert.equal(h.elements.get('#syncRetryCloudRecovery').textContent, 'Retry cloud download');
  await h.reconnect();
  assert.equal(h.window.RegulaRusticaSync.getStatus().label, 'Synced');
  assert.equal(h.cloud.writes.length, 0);
});

test('recovery remains offline until connected and never bypasses the Premium gate', async () => {
  const offline = await runtime({ online: false });
  assert.equal(offline.window.RegulaRusticaSync.getStatus().state, 'offline');
  assert.equal(offline.elements.get('#syncRetryCloudRecovery').disabled, true);
  await offline.reconnect();
  assert.equal(offline.window.RegulaRusticaSync.getStatus().label, 'Synced');
  const paused = await runtime({ premium: false });
  assert.equal(paused.window.RegulaRusticaSync.getStatus().label, 'Sync paused');
  assert.equal(paused.window.RegulaRusticaSync.isInitialized(), false);
  assert.ok(paused.elements.get('#syncRecoveryActions').classList.contains('hidden'));
  assert.equal(paused.cloud.writes.length, 0);
});
