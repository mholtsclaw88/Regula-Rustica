import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { DeviceStorage, DEVICE_STORAGE_KEYS, IndexedDbBackend } from '../device-storage.mjs';
import tasks from '../task-foundation.js';
import housekeeping from '../housekeeping-data.js';
import documents from '../record-documents.js';
import journal from '../journal-foundation.js';

const MAIN = 'regulaRusticaV5';
const BACKUPS = 'regulaRusticaSyncBackupsV1';

class LegacyStorage {
  constructor(limit = Infinity) { this.values = new Map(); this.limit = limit; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    const next = new Map(this.values).set(key, String(value));
    const bytes = [...next].reduce((total, [key, value]) => total + 2 * (key.length + value.length), 0);
    if (bytes > this.limit) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
    this.values = next;
  }
  removeItem(key) { this.values.delete(key); }
}

class Backend {
  constructor() { this.values = new Map(); this.beforeCommit = async () => {}; this.commits = 0; }
  async readAll() { return new Map(this.values); }
  async commit(batch) {
    await this.beforeCommit(batch);
    this.values = new Map([...this.values, ...batch]);
    this.commits++;
  }
}

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const open = (backend, legacyStorage = new LegacyStorage(), onError) => new DeviceStorage({ backend, legacyStorage, onError }).initialize();

test('a full localStorage can migrate its working copy, backups, and pending sync without deleting account sessions', async () => {
  const legacy = new LegacyStorage(5 * 1024 * 1024);
  const raw = JSON.stringify({ schemaVersion: 14, records: [{ id: 'maple', name: 'Maple' }], legacy: { receiptPhotos: { one: { dataUrl: 'x'.repeat(750_000) } } } });
  const backups = JSON.stringify([{ id: 'backup-1', reason: 'before-cloud-replacement', data: JSON.parse(raw) }, { id: 'backup-2', data: JSON.parse(raw) }]);
  const sync = JSON.stringify({ deviceId: 'same-device', outbox: [{ id: 'pending-1', idempotencyKey: 'same-operation' }], conflicts: [{ id: 'review-1' }], cursors: { records: 'same-cursor' } });
  legacy.setItem(MAIN, raw);
  legacy.setItem(BACKUPS, backups);
  legacy.setItem('regulaRusticaSyncV1', sync);
  legacy.setItem('sb-account-auth-token', 'account-session');
  const larger = raw.replace('x'.repeat(750_000), 'x'.repeat(1_250_000));
  assert.throws(() => legacy.setItem(MAIN, larger), { name: 'QuotaExceededError' });

  const backend = new Backend();
  const storage = await open(backend, legacy);
  assert.equal(storage.getItem(MAIN), raw);
  assert.equal(storage.getItem(BACKUPS), backups);
  assert.equal(storage.getItem('regulaRusticaSyncV1'), sync);
  assert.equal(legacy.getItem(MAIN), null);
  assert.equal(legacy.getItem('sb-account-auth-token'), 'account-session');
  await storage.setItem(MAIN, larger);
  const reloaded = await open(backend, legacy);
  assert.equal(reloaded.getItem(MAIN), larger);
  assert.equal(reloaded.getItem(BACKUPS), backups);
  assert.equal(reloaded.getItem('regulaRusticaSyncV1'), sync);
});

test('every historical Farm Book and safety backup key migrates byte for byte', async () => {
  const legacy = new LegacyStorage();
  for (const key of DEVICE_STORAGE_KEYS) legacy.setItem(key, JSON.stringify({ key, text: 'Ora · labora · custodia — 🐄' }));
  const original = new Map(legacy.values);
  const storage = await open(new Backend(), legacy);
  for (const [key, raw] of original) {
    assert.equal(storage.getItem(key), raw);
    assert.equal(legacy.getItem(key), null);
  }
});

test('an aborted migration keeps all original browser keys intact', async () => {
  const legacy = new LegacyStorage();
  legacy.setItem(MAIN, 'original'); legacy.setItem(BACKUPS, 'backup');
  const original = new Map(legacy.values);
  const backend = new Backend();
  backend.beforeCommit = async () => { throw new Error('disk full'); };
  await assert.rejects(open(backend, legacy), /disk full/);
  assert.deepEqual(legacy.values, original);
  assert.equal(backend.values.size, 0);
});

test('failed read-back verification cannot free the original copy', async () => {
  const legacy = new LegacyStorage(); legacy.setItem(MAIN, 'original');
  const backend = new Backend();
  backend.readAll = async () => new Map();
  await assert.rejects(open(backend, legacy), /could not be verified/);
  assert.equal(legacy.getItem(MAIN), 'original');
});

test('a previously committed migration resumes after cleanup was interrupted', async () => {
  const legacy = new LegacyStorage(); legacy.setItem(MAIN, 'original');
  const backend = new Backend(); backend.values.set(MAIN, 'original');
  const storage = await open(backend, legacy);
  assert.equal(storage.getItem(MAIN), 'original');
  assert.equal(legacy.getItem(MAIN), null);
});

test('a competing older tab is preserved rather than silently overwriting either copy', async () => {
  const legacy = new LegacyStorage(); legacy.setItem(MAIN, 'older-tab-edit');
  const backend = new Backend(); backend.values.set(MAIN, 'new-device-copy');
  await assert.rejects(open(backend, legacy), /Two saved browser copies differ/);
  assert.equal(legacy.getItem(MAIN), 'older-tab-edit');
  assert.equal(backend.values.get(MAIN), 'new-device-copy');
});

test('explicitly keeping the current device copy verifies an archive of the older tab before freeing its keys', async () => {
  const legacy = new LegacyStorage(); legacy.setItem(MAIN, 'older-tab-edit');
  const backend = new Backend(); backend.values.set(MAIN, 'new-device-copy');
  const storage = new DeviceStorage({ backend, legacyStorage: legacy });
  await assert.rejects(storage.initialize(), { code: 'DEVICE_COPY_CONFLICT' });
  await storage.resolveLegacyConflict('device');
  assert.equal(storage.getItem(MAIN), 'new-device-copy');
  assert.equal(legacy.getItem(MAIN), null);
  const archive = JSON.parse([...backend.values].find(([key]) => key.startsWith('preserved-device-copies:'))[1]);
  assert.equal(archive.device[MAIN], 'new-device-copy');
  assert.equal(archive.browser[MAIN], 'older-tab-edit');
});

test('explicitly choosing the previous browser copy replaces the complete replica while preserving both originals', async () => {
  const legacy = new LegacyStorage(); legacy.setItem(MAIN, 'older-tab-edit');
  legacy.setItem('regression-session', 'kept');
  const backend = new Backend(); backend.values.set(MAIN, 'new-device-copy');
  backend.values.set('regulaRusticaSyncV1', 'different-homestead-outbox');
  const storage = new DeviceStorage({ backend, legacyStorage: legacy });
  await assert.rejects(storage.initialize(), { code: 'DEVICE_COPY_CONFLICT' });
  await storage.resolveLegacyConflict('browser');
  assert.equal(storage.getItem(MAIN), 'older-tab-edit');
  assert.equal(storage.getItem('regulaRusticaSyncV1'), null);
  assert.equal(legacy.getItem('regression-session'), 'kept');
  const archive = JSON.parse([...backend.values].find(([key]) => key.startsWith('preserved-device-copies:'))[1]);
  assert.equal(archive.device['regulaRusticaSyncV1'], 'different-homestead-outbox');
  assert.equal(archive.browser[MAIN], 'older-tab-edit');
});

test('failed archive persistence cannot replace either differing device copy', async () => {
  const legacy = new LegacyStorage(); legacy.setItem(MAIN, 'older-tab-edit');
  const backend = new Backend(); backend.values.set(MAIN, 'new-device-copy');
  const storage = new DeviceStorage({ backend, legacyStorage: legacy });
  await assert.rejects(storage.initialize(), { code: 'DEVICE_COPY_CONFLICT' });
  backend.beforeCommit = async () => { throw new Error('disk full'); };
  await assert.rejects(storage.resolveLegacyConflict('browser'), /disk full/);
  assert.equal(legacy.getItem(MAIN), 'older-tab-edit');
  assert.equal(backend.values.get(MAIN), 'new-device-copy');
});

test('a legacy edit made during migration is not removed', async () => {
  const legacy = new LegacyStorage(); legacy.setItem(MAIN, 'original');
  const backend = new Backend();
  backend.beforeCommit = async () => legacy.setItem(MAIN, 'edited-in-another-tab');
  await assert.rejects(open(backend, legacy), /changed in another tab/);
  assert.equal(legacy.getItem(MAIN), 'edited-in-another-tab');
  assert.equal(backend.values.get(MAIN), 'original');
});

test('an edit arriving during a commit is persisted before flush completes', async () => {
  const backend = new Backend(); const storage = await open(backend);
  const reached = deferred(); const release = deferred();
  backend.beforeCommit = async () => { if (backend.commits === 0) { reached.resolve(); await release.promise; } };
  const first = storage.setItem(MAIN, 'first');
  await reached.promise;
  const last = storage.setItem(MAIN, 'last');
  storage.setItem('regulaRusticaSyncV1', 'outbox');
  release.resolve();
  await Promise.all([first, last, storage.flush()]);
  assert.equal(backend.values.get(MAIN), 'last');
  assert.equal(backend.values.get('regulaRusticaSyncV1'), 'outbox');
});

test('failed saves preserve the committed copy and keep all staged keys available for export and retry', async () => {
  const backend = new Backend(); backend.values.set(MAIN, 'committed');
  const errors = []; const storage = await open(backend, undefined, error => errors.push(error.message));
  backend.beforeCommit = async () => { throw new Error('disk full'); };
  storage.setItem('regulaRusticaSyncV1', 'pending-changes');
  await assert.rejects(storage.setItem(MAIN, 'unsaved-edit'), /disk full/);
  assert.equal(backend.values.get(MAIN), 'committed');
  assert.equal(storage.getItem(MAIN), 'unsaved-edit');
  assert.deepEqual(errors, ['disk full']);
  backend.beforeCommit = async () => {};
  await storage.flush();
  assert.equal(backend.values.get(MAIN), 'unsaved-edit');
  assert.equal(backend.values.get('regulaRusticaSyncV1'), 'pending-changes');
});

test('IndexedDB writes wait for transaction completion and reject transaction aborts', async () => {
  let transaction;
  const backend = new IndexedDbBackend({ transaction() { return transaction = { objectStore: () => ({ put() {} }) }; } });
  let complete = false;
  const saving = backend.commit(new Map([[MAIN, 'snapshot']])).then(() => { complete = true; });
  await Promise.resolve();
  assert.equal(complete, false);
  transaction.oncomplete(); await saving;
  assert.equal(complete, true);
  const aborted = backend.commit(new Map([[MAIN, 'replacement']]));
  transaction.error = new Error('transaction aborted');
  transaction.onabort();
  await assert.rejects(aborted, /transaction aborted/);
});

async function appHarness(storage) {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const events = [];
  const context = {
    console: { warn() {} }, crypto: webcrypto, structuredClone, Blob, URL, localStorage: storage,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window: { RegulaRusticaStorage: storage, RegulaRusticaTasks: tasks, RegulaRusticaHousekeeping: housekeeping,
      RegulaRusticaDocuments: documents, RegulaRusticaJournal: journal, dispatchEvent: event => events.push(event) }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(0, source.indexOf('let data = loadData();')) + `
    let data = normalizeData({ schemaVersion: CURRENT_SCHEMA_VERSION });
    let persistedData = structuredClone(data);
    function renderAll() {}
    globalThis.api = { loadData, saveData, read: () => structuredClone(data) };
  `, context);
  return { ...context.api, events };
}

test('startup write failures and malformed saved JSON cannot fall back to an empty Homestead', async () => {
  const legacy = new LegacyStorage();
  legacy.setItem(MAIN, JSON.stringify({ schemaVersion: 13, records: [{ id: 'maple', name: 'Maple', type: 'Animal' }] }));
  const api = await appHarness(legacy);
  const original = legacy.getItem(MAIN);
  legacy.limit = 0;
  assert.throws(() => api.loadData(), { name: 'QuotaExceededError' });
  assert.equal(legacy.getItem(MAIN), original);
  legacy.limit = Infinity; legacy.setItem(MAIN, '{unreadable');
  assert.throws(() => api.loadData(), /JSON/);
  assert.equal(legacy.getItem(MAIN), '{unreadable');
});

test('the app emits saved events only after persistence, in order for coalesced edits', async () => {
  const backend = new Backend(); const storage = await open(backend); const api = await appHarness(storage);
  const reached = deferred(); const release = deferred();
  backend.beforeCommit = async () => { reached.resolve(); await release.promise; };
  const firstData = api.read(); firstData.settings.homesteadName = 'First';
  const first = api.saveData(firstData);
  await reached.promise;
  const lastData = api.read(); lastData.settings.homesteadName = 'Last';
  const last = api.saveData(lastData);
  assert.equal(api.events.length, 0);
  release.resolve(); await Promise.all([first, last]);
  assert.equal(api.events.length, 2);
  assert.equal(api.events[0].detail.after.settings.homesteadName, 'First');
  assert.equal(api.events[1].detail.before.settings.homesteadName, 'First');
  assert.equal(api.events[1].detail.after.settings.homesteadName, 'Last');
  assert.equal(JSON.parse(backend.values.get(MAIN)).settings.homesteadName, 'Last');
});

test('a failed app save reports no success and a later successful save includes the uncommitted edit', async () => {
  const backend = new Backend(); const storage = await open(backend); const api = await appHarness(storage);
  backend.beforeCommit = async () => { throw new Error('disk full'); };
  const changed = api.read(); changed.settings.homesteadName = 'Unsaved';
  await assert.rejects(api.saveData(changed), /disk full/);
  assert.equal(api.events.length, 0);
  backend.beforeCommit = async () => {};
  await api.saveData(api.read(), 'storage-retry');
  assert.equal(api.events.length, 1);
  assert.notEqual(api.events[0].detail.before.settings.homesteadName, 'Unsaved');
  assert.equal(api.events[0].detail.after.settings.homesteadName, 'Unsaved');
});
