import assert from 'node:assert/strict';
import test from 'node:test';
import { SyncEngine } from '../sync/engine.mjs';
import { LocalSyncState } from '../sync/local-state.mjs';
import { DOMAIN_ORDER, operationOrder, toCloud } from '../sync/entities.mjs';

Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

class MemoryStorage {
  constructor(seed = {}) { this.values = new Map(Object.entries(seed)); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const blank = () => ({ schemaVersion: 5, settings: { homesteadName: 'Test' }, records: [], tasks: [], relationships: [], assignments: [], events: [], notes: [], ledger: [] });
const record = (id = crypto.randomUUID()) => ({ id, type: 'Animal', name: 'Daisy', status: 'Active', identity: {}, stewardship: {}, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', deletedAt: null });

class MockCloud {
  constructor(rows = {}) {
    this.rows = Object.fromEntries(DOMAIN_ORDER.map(table => [table, [...(rows[table] || [])]]));
    this.calls = [];
    this.operations = new Map();
    this.fail = false;
    this.underreport = false;
  }
  async counts() { return Object.fromEntries(DOMAIN_ORDER.map(table => [table, this.underreport ? 0 : this.rows[table].length])); }
  async apply(operation) {
    this.calls.push(operation);
    if (this.fail) throw Object.assign(new Error('network unavailable'), { code: 'FETCH' });
    if (this.operations.has(operation.idempotencyKey)) return this.operations.get(operation.idempotencyKey);
    const rows = this.rows[operation.table];
    const index = rows.findIndex(row => row.id === operation.rowId);
    let result;
    if (operation.type === 'create') {
      if (index >= 0) result = { status: 'conflict', row: rows[index] };
      else {
        const row = { ...operation.payload, id: operation.rowId, version: 1, updated_at: operation.clientUpdatedAt };
        rows.push(row); result = { status: 'applied', row };
      }
    } else if (index < 0 || rows[index].version !== operation.baseVersion) {
      result = { status: 'conflict', row: rows[index] || null };
    } else {
      const row = { ...rows[index], ...operation.payload, id: operation.rowId, version: rows[index].version + 1, updated_at: operation.clientUpdatedAt };
      if (operation.type === 'soft_delete') row.deleted_at = operation.clientUpdatedAt;
      if (operation.type === 'restore') row.deleted_at = null;
      rows[index] = row; result = { status: 'applied', row };
    }
    this.operations.set(operation.idempotencyKey, result);
    return result;
  }
  async verifyMigration(expected) {
    for (const table of DOMAIN_ORDER) {
      for (const row of expected[table] || []) assert.ok(this.rows[table].some(item => item.id === row.id));
    }
    return true;
  }
  async *changes() { return; }
}

function harness(local = blank(), cloud = new MockCloud()) {
  const storage = new MemoryStorage();
  const state = new LocalSyncState(storage);
  let current = structuredClone(local);
  const engine = new SyncEngine({ state, cloud, readLocal: () => structuredClone(current), writeLocal: value => { current = structuredClone(value); } });
  return { state, cloud, engine, storage, local: () => current };
}

test('device UUID persists across reloads', () => {
  const storage = new MemoryStorage();
  const first = new LocalSyncState(storage); first.save();
  assert.equal(new LocalSyncState(storage).state.deviceId, first.state.deviceId);
});

test('legacy local IDs remain local and receive stable cloud UUID mappings', () => {
  const storage = new MemoryStorage();
  const first = new LocalSyncState(storage); const mapping = first.entity('records', 'daisy');
  assert.equal(mapping.localId, 'daisy');
  assert.match(mapping.cloudId, /^[0-9a-f-]{36}$/);
  assert.equal(new LocalSyncState(storage).entity('records', 'daisy').cloudId, mapping.cloudId);
});

test('durable outbox survives reload', () => {
  const storage = new MemoryStorage(); const state = new LocalSyncState(storage);
  state.enqueue({ table: 'records', localId: 'daisy', type: 'create', payload: {} });
  assert.equal(new LocalSyncState(storage).state.outbox.length, 1);
});

test('a verified pre-migration backup is readable', () => {
  const state = new LocalSyncState(new MemoryStorage()); const data = { records: [{ id: 'one' }] };
  assert.equal(state.createVerifiedBackup(data, 'test').data.records[0].id, 'one');
});

test('first sync identifies populated local and empty cloud as A', async () => {
  const data = blank(); data.records.push(record('legacy'));
  assert.equal((await harness(data).engine.inspectFirstSync(crypto.randomUUID())).case, 'A');
});

test('first sync identifies empty local and populated cloud as B', async () => {
  const cloud = new MockCloud({ records: [{ id: crypto.randomUUID() }] });
  assert.equal((await harness(blank(), cloud).engine.inspectFirstSync(crypto.randomUUID())).case, 'B');
});

test('first sync protects two populated datasets as C', async () => {
  const data = blank(); data.records.push(record());
  const cloud = new MockCloud({ records: [{ id: crypto.randomUUID() }] });
  const h = harness(data, cloud); const homestead = crypto.randomUUID();
  assert.equal((await h.engine.inspectFirstSync(homestead)).case, 'C');
  await assert.rejects(h.engine.initialize('upload', homestead), /cannot be merged/i);
});

test('first sync identifies two empty datasets as D', async () => {
  assert.equal((await harness().engine.inspectFirstSync(crypto.randomUUID())).case, 'D');
});

test('initial upload preserves local data and establishes mapping', async () => {
  const data = blank(); data.records.push(record('daisy'));
  const h = harness(data); await h.engine.initialize('upload', crypto.randomUUID());
  assert.equal(h.local().records[0].id, 'daisy');
  assert.equal(h.cloud.rows.records.length, 1);
  assert.equal(h.state.state.initialSyncCompleted, true);
});

test('interrupted migration remains incomplete with queued work', async () => {
  const data = blank(); data.records.push(record()); const cloud = new MockCloud(); cloud.fail = true;
  const h = harness(data, cloud);
  await assert.rejects(h.engine.initialize('upload', crypto.randomUUID()), /incomplete/i);
  assert.equal(h.state.state.initialSyncCompleted, false);
  assert.equal(h.state.state.outbox.length, 1);
});

test('interrupted initial upload resumes its original safe case', async () => {
  const data = blank(); data.records.push(record()); data.records.push(record());
  const cloud = new MockCloud();
  const originalApply = cloud.apply.bind(cloud); let calls = 0;
  cloud.apply = async operation => { calls += 1; if (calls === 2) throw Object.assign(new Error('interrupted'), { code: 'FETCH' }); return originalApply(operation); };
  const h = harness(data, cloud); const homestead = crypto.randomUUID();
  await assert.rejects(h.engine.initialize('upload', homestead), /incomplete/i);
  assert.equal((await h.engine.inspectFirstSync(homestead)).case, 'A');
  cloud.apply = originalApply;
  await h.engine.initialize('upload', homestead);
  assert.equal(cloud.rows.records.length, 2);
});

test('migration verification failure is recoverable', async () => {
  const data = blank(); data.records.push(record()); const cloud = new MockCloud(); cloud.underreport = true;
  const h = harness(data, cloud);
  await assert.rejects(h.engine.initialize('upload', crypto.randomUUID()), /verification failed/i);
  assert.equal(h.state.state.initialSyncState.status, 'failed');
});

test('local create is queued before any network write', () => {
  const h = harness(); h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true; h.state.save();
  const after = blank(); after.records.push(record()); h.engine.queueLocalChanges(blank(), after);
  assert.equal(h.cloud.calls.length, 0); assert.equal(h.state.state.outbox[0].type, 'create');
});

test('local update carries the known cloud base version', () => {
  const old = blank(); const item = record(); old.records.push(item); const h = harness(old);
  h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true; h.state.entity('records', item.id).cloudVersion = 4; h.state.save();
  const next = structuredClone(old); next.records[0].name = 'Daisy II'; next.records[0].updatedAt = '2026-08-02T00:00:00.000Z';
  h.engine.queueLocalChanges(old, next); assert.equal(h.state.state.outbox[0].baseVersion, 4);
});

test('task date windows and recurrence survive cloud conversion', () => {
  const state = new LocalSyncState(new MemoryStorage());
  const task = {
    id: crypto.randomUUID(), title: 'Move hens', description: 'Use the north coop',
    availableFrom: '2026-08-10', dueDate: '2026-08-12', priority: 'high',
    completed: false, recurrenceRule: { mode: 'after_completion', frequency: 'weekly', interval: 1 },
    createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-09T12:00:00.000Z'
  };
  const payload = toCloud('tasks', task, state);
  assert.equal(payload.available_from, '2026-08-10');
  assert.equal(payload.due_date, '2026-08-12');
  assert.deepEqual(payload.recurrence_rule, task.recurrenceRule);
});

test('push uses dependency-safe domain order', async () => {
  const h = harness(); h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true;
  for (const table of [...DOMAIN_ORDER].reverse()) h.state.enqueue({ table, localId: crypto.randomUUID(), type: 'create', payload: { id: crypto.randomUUID() } });
  await h.engine.push(); assert.deepEqual(h.cloud.calls.map(item => item.table), DOMAIN_ORDER);
});

test('successful idempotent retry cannot duplicate a row', async () => {
  const h = harness(); h.state.bind(crypto.randomUUID()); const item = record();
  const operation = h.state.enqueue({ table: 'records', localId: item.id, type: 'create', payload: toCloud('records', item, h.state) });
  const first = await h.cloud.apply(operation); const second = await h.cloud.apply(operation);
  assert.deepEqual(second, first); assert.equal(h.cloud.rows.records.length, 1);
});

test('same-version update succeeds', async () => {
  const id = crypto.randomUUID(); const cloud = new MockCloud({ records: [{ id, version: 2, name: 'Old' }] }); const h = harness(blank(), cloud);
  h.state.bind(crypto.randomUUID()); h.state.entity('records', id).cloudVersion = 2;
  h.state.enqueue({ table: 'records', localId: id, type: 'update', baseVersion: 2, payload: { id, name: 'New' } });
  await h.engine.push(); assert.equal(cloud.rows.records[0].name, 'New'); assert.equal(h.state.state.conflicts.length, 0);
});

test('stale update preserves cloud and local conflict payload', async () => {
  const id = crypto.randomUUID(); const cloud = new MockCloud({ records: [{ id, version: 3, name: 'Cloud' }] }); const h = harness(blank(), cloud);
  h.state.bind(crypto.randomUUID()); h.state.enqueue({ table: 'records', localId: id, type: 'update', baseVersion: 2, payload: { id, name: 'Local' } });
  await h.engine.push(); assert.equal(cloud.rows.records[0].name, 'Cloud'); assert.equal(h.state.state.conflicts[0].localPayload.name, 'Local');
});

test('keep-cloud conflict resolution replaces the local copy', async () => {
  const id = crypto.randomUUID(); const data = blank(); data.records.push(record(id)); const h = harness(data);
  h.state.bind(crypto.randomUUID()); const conflict = h.state.addConflict({ id: crypto.randomUUID(), table: 'records', localId: id, rowId: id, payload: { name: 'Local' }, baseVersion: 1 }, { id, version: 2, type: 'animal', name: 'Cloud', status: 'Active', identity: {}, stewardship: {}, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-02T00:00:00Z' });
  await h.engine.resolveConflict(conflict.id, 'cloud'); assert.equal(h.local().records[0].name, 'Cloud');
});

test('use-local conflict resolution queues a new update on current version', async () => {
  const id = crypto.randomUUID(); const cloud = new MockCloud({ records: [{ id, version: 2, name: 'Cloud' }] }); const h = harness(blank(), cloud);
  h.state.bind(crypto.randomUUID()); const conflict = h.state.addConflict({ id: crypto.randomUUID(), table: 'records', localId: id, rowId: id, payload: { id, name: 'Local' }, baseVersion: 1 }, cloud.rows.records[0]);
  await h.engine.resolveConflict(conflict.id, 'local'); assert.equal(cloud.rows.records[0].name, 'Local');
});

test('soft deletion and restoration are explicit operations', () => {
  const item = record(); const before = blank(); before.records.push(item); const h = harness(before);
  h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true; h.state.entity('records', item.id).cloudVersion = 1;
  const deleted = structuredClone(before); deleted.records[0].deletedAt = '2026-08-03T00:00:00Z'; h.engine.queueLocalChanges(before, deleted);
  const restored = structuredClone(deleted); restored.records[0].deletedAt = null; h.engine.queueLocalChanges(deleted, restored);
  assert.deepEqual(h.state.state.outbox.map(item => item.type), ['soft_delete', 'restore']);
});

test('operation ordering deletes dependents before parents', () => {
  assert.ok(operationOrder({ table: 'notes', type: 'soft_delete' }) < operationOrder({ table: 'records', type: 'soft_delete' }));
});

test('Homestead boundary mismatch stops synchronization', async () => {
  const h = harness(); h.state.bind(crypto.randomUUID());
  assert.equal((await h.engine.inspectFirstSync(crypto.randomUUID())).case, 'boundary');
});
