import assert from 'node:assert/strict';
import test from 'node:test';
import { SyncEngine, isRetryableSyncError } from '../sync/engine.mjs';
import { LocalSyncState, SYNC_STORAGE_KEYS } from '../sync/local-state.mjs';
import { DOMAIN_ORDER, conflictPresentation, fromCloud, hasMeaningfulData, operationOrder, toCloud } from '../sync/entities.mjs';
import { LEGACY_SYNC_RPC_ROUTES, SYNC_RPC_ROUTES, SupabaseSyncAdapter, rpcForSyncTable } from '../sync/cloud-adapter.mjs';
import { legacyOperationAlreadySatisfied, markLegacyOperation } from '../sync/legacy-recovery.mjs';
import housekeepingData from '../housekeeping-data.js';

Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

class MemoryStorage {
  constructor(seed = {}) { this.values = new Map(Object.entries(seed)); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const blank = () => ({ schemaVersion: 9, settings: { homesteadName: 'Test' }, records: [], documents: [], attachments: [], people: [], choreWindows: [], routines: [], routineOccurrences: [], tasks: [], relationships: [], assignments: [], events: [], calendarEvents: [], yieldEntries: [], notes: [], ledger: [], ledgerAllocations: [] });
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
  async memberDirectory() { return this.rows.homestead_people.filter(row => row.person_type === 'member'); }
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
  return { state, cloud, engine, storage, local: () => current, setLocal: value => { current = structuredClone(value); } };
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

test('every active sync domain has one explicit server RPC route', async () => {
  assert.deepEqual(Object.keys(SYNC_RPC_ROUTES), DOMAIN_ORDER);
  const calls = [];
  const adapter = new SupabaseSyncAdapter({
    async rpc(name, payload) { calls.push([name, payload.target_table]); return { data: { status: 'applied', row: {} }, error: null }; }
  });
  for (const table of DOMAIN_ORDER) {
    await adapter.apply({ table, idempotencyKey: crypto.randomUUID(), deviceId: crypto.randomUUID(), rowId: crypto.randomUUID(), type: 'create', baseVersion: null, clientUpdatedAt: new Date().toISOString(), payload: {} });
  }
  assert.deepEqual(calls, DOMAIN_ORDER.map(table => [SYNC_RPC_ROUTES[table], table]));
  assert.throws(() => rpcForSyncTable('routines'), error => error.code === 'SYNC_ROUTE_MISSING');
});

test('only marked historical Routine domains use the legacy RPC compatibility gate', async () => {
  assert.deepEqual(LEGACY_SYNC_RPC_ROUTES, {
    routines: 'apply_routine_sync_operation',
    routine_occurrences: 'apply_routine_sync_operation'
  });
  assert.equal(rpcForSyncTable('routines', { legacy: true }), 'apply_routine_sync_operation');
  assert.equal(rpcForSyncTable('routine_occurrences', { legacy: true }), 'apply_routine_sync_operation');
  assert.throws(() => rpcForSyncTable('routines'), error => error.code === 'SYNC_ROUTE_MISSING');
  assert.throws(() => rpcForSyncTable('workflows', { legacy: true }), error => error.code === 'SYNC_ROUTE_MISSING');
});

test('persisted failures are marked once for recovery while new current operations are untouched', () => {
  const current = { id: crypto.randomUUID(), table: 'tasks', localId: 'new-task', rowId: crypto.randomUUID(), type: 'create', payload: {}, attempts: 0 };
  assert.equal(markLegacyOperation(current), current);
  const historical = markLegacyOperation({ ...current, attempts: 600, lastErrorCode: 'SYNC_ROUTE_MISSING' });
  assert.equal(historical.table, 'tasks');
  assert.equal(historical.rowId, current.rowId);
  assert.equal(historical.legacyRecovery.originalErrorCode, 'SYNC_ROUTE_MISSING');
  assert.equal(markLegacyOperation(historical), historical);

  const currentState = new LocalSyncState(new MemoryStorage()).state;
  const storage = new MemoryStorage({
    [SYNC_STORAGE_KEYS.state]: JSON.stringify({ ...currentState, legacyRecoveryVersion: 1, outbox: [{ ...current, attempts: 1, lastErrorCode: '42501' }] })
  });
  assert.equal(new LocalSyncState(storage).state.outbox[0].legacyRecovery, undefined);
});

test('legacy failed operations reload as retryable without losing diagnostics', () => {
  const operation = { id: crypto.randomUUID(), table: 'records', localId: 'daisy', type: 'update', status: 'failed', attempts: 2, lastError: 'network unavailable' };
  const legacyState = new LocalSyncState(new MemoryStorage()).state;
  delete legacyState.legacyRecoveryVersion;
  const storage = new MemoryStorage({
    [SYNC_STORAGE_KEYS.state]: JSON.stringify({ ...legacyState, outbox: [operation] })
  });
  const recovered = new LocalSyncState(storage).state.outbox[0];
  assert.equal(recovered.status, 'retryable');
  assert.equal(recovered.attempts, 2);
  assert.equal(recovered.lastError, 'network unavailable');
  assert.equal(recovered.legacyRecovery.originalTable, 'records');
});

test('legacy Routine create and update recover in dependency order and survive reload', async () => {
  const storage = new MemoryStorage();
  const initial = new LocalSyncState(storage); const homestead = crypto.randomUUID();
  initial.bind(homestead); initial.state.initialSyncCompleted = true;
  const create = initial.enqueue({ table: 'routines', localId: 'milk-daisy', type: 'create', payload: { name: 'Milk Daisy', frequency: 'daily', interval: 1 } });
  initial.enqueue({ table: 'routines', localId: 'milk-daisy', type: 'update', payload: { name: 'Milk Daisy twice', frequency: 'daily', interval: 1 } });
  create.attempts = 100; create.status = 'blocked'; create.lastErrorCode = 'SYNC_ROUTE_MISSING'; delete initial.state.legacyRecoveryVersion; initial.save();

  const recovered = new LocalSyncState(storage);
  const cloud = new MockCloud(); cloud.rows.routines = [];
  const engine = new SyncEngine({ state: recovered, cloud, readLocal: blank, writeLocal: () => {} });
  await engine.push({ retryBlocked: true });

  assert.equal(recovered.state.outbox.length, 0);
  assert.equal(cloud.rows.routines.length, 1);
  assert.equal(cloud.rows.routines[0].name, 'Milk Daisy twice');
  assert.deepEqual(cloud.calls.map(operation => operation.type), ['create', 'update']);
});

test('legacy Routine occurrence blocks Yield until its historical parent is recovered', async () => {
  const h = harness(); h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true;
  const occurrence = h.state.enqueue({ table: 'routine_occurrences', localId: 'morning-1', type: 'create', payload: { routine_id: crypto.randomUUID(), occurrence_date: '2026-08-29', status: 'completed' } });
  const yieldOperation = h.state.enqueue({ table: 'yield_entries', localId: 'milk-1', type: 'create', payload: { routine_occurrence_id: occurrence.rowId, yield_type: 'milk', quantity: 2, unit: 'gal' } });
  occurrence.attempts = 1; occurrence.lastErrorCode = 'SYNC_ROUTE_MISSING';
  yieldOperation.attempts = 1; yieldOperation.lastErrorCode = '23503';
  delete h.state.state.legacyRecoveryVersion; h.state.save();
  const recovered = new LocalSyncState(h.storage); recovered.state.initialSyncCompleted = true;
  const cloud = new MockCloud(); cloud.rows.routine_occurrences = [];
  const calls = [];
  cloud.apply = async operation => {
    calls.push(operation.table);
    if (operation.table === 'routine_occurrences') throw Object.assign(new Error('offline'), { code: 'FETCH' });
    return { status: 'applied', row: { ...operation.payload, id: operation.rowId, version: 1 } };
  };
  const engine = new SyncEngine({ state: recovered, cloud, readLocal: blank, writeLocal: () => {} });
  await engine.push();
  assert.deepEqual(calls, ['routine_occurrences']);
  assert.equal(recovered.state.outbox.find(item => item.table === 'yield_entries').status, 'dependency');
});

test('an exact historical replay already present in cloud resolves without duplication', async () => {
  const h = harness(); h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true;
  const operation = h.state.enqueue({ table: 'records', localId: 'daisy', type: 'create', payload: { type: 'animal', name: 'Daisy', status: 'Active', identity: {}, stewardship: {} } });
  operation.attempts = 2; operation.lastErrorCode = 'SYNC_ROUTE_MISSING'; delete h.state.state.legacyRecoveryVersion; h.state.save();
  const recovered = new LocalSyncState(h.storage); recovered.state.initialSyncCompleted = true;
  h.cloud.rows.records.push({ ...operation.payload, id: operation.rowId, version: 4, updated_at: operation.clientUpdatedAt });
  const engine = new SyncEngine({ state: recovered, cloud: h.cloud, readLocal: blank, writeLocal: () => {} });
  await engine.push();
  assert.equal(recovered.state.outbox.length, 0);
  assert.equal(recovered.state.conflicts.length, 0);
  assert.equal(h.cloud.rows.records.length, 1);
  assert.equal(recovered.entity('records', 'daisy').cloudVersion, 4);
});

test('legacy preflight resolves absent deletes and preserves missing updates', async () => {
  const h = harness(); h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true;
  const removed = h.state.enqueue({ table: 'tasks', localId: 'removed-task', type: 'soft_delete', baseVersion: 2, payload: { title: 'Removed' } });
  const missing = h.state.enqueue({ table: 'tasks', localId: 'missing-task', type: 'update', baseVersion: null, payload: { title: 'Missing' } });
  [removed, missing].forEach(operation => { operation.attempts = 2; operation.lastErrorCode = 'SYNC_ROUTE_MISSING'; });
  delete h.state.state.legacyRecoveryVersion; h.state.save();
  const recovered = new LocalSyncState(h.storage); recovered.state.initialSyncCompleted = true;
  const cloud = {
    async inspectLegacy() { return { supported: true, row: null }; },
    async apply() { throw new Error('preflight should decide both historical operations'); }
  };
  const engine = new SyncEngine({ state: recovered, cloud, readLocal: blank, writeLocal: () => {} });
  await engine.push();
  assert.equal(recovered.state.outbox.length, 1);
  assert.equal(recovered.state.outbox[0].localId, 'missing-task');
  assert.equal(recovered.state.outbox[0].lastErrorCode, 'LEGACY_TARGET_MISSING');
});

test('legacy duplicate relationship binds to the exact existing cloud row', async () => {
  const h = harness(); h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true;
  const payload = { source_record_id: crypto.randomUUID(), target_record_id: crypto.randomUUID(), relationship_type: 'located_on', started_at: null, ended_at: null, details: {} };
  const operation = h.state.enqueue({ table: 'record_relationships', localId: 'old-location', type: 'create', payload });
  operation.attempts = 2; operation.lastErrorCode = '23505'; delete h.state.state.legacyRecoveryVersion; h.state.save();
  const recovered = new LocalSyncState(h.storage); recovered.state.initialSyncCompleted = true;
  const existing = { ...payload, id: crypto.randomUUID(), version: 3 };
  const cloud = {
    async inspectLegacy() { return { supported: true, row: existing }; },
    async apply() { throw new Error('an exact duplicate must not be created'); }
  };
  const engine = new SyncEngine({ state: recovered, cloud, readLocal: blank, writeLocal: () => {} });
  await engine.push();
  assert.equal(recovered.state.outbox.length, 0);
  assert.equal(recovered.entity('record_relationships', 'old-location').cloudId, existing.id);
});

test('unknown and malformed historical operations remain blocked and diagnosable', async () => {
  const h = harness(); h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true;
  const unknown = h.state.enqueue({ table: 'workflows', localId: 'old-workflow', type: 'create', payload: {} });
  unknown.attempts = 3; unknown.lastErrorCode = 'SYNC_ROUTE_MISSING';
  const malformed = h.state.enqueue({ table: 'routines', localId: 'bad-routine', type: 'create', payload: {} });
  malformed.attempts = 3; malformed.lastErrorCode = 'SYNC_ROUTE_MISSING'; delete malformed.payload;
  delete h.state.state.legacyRecoveryVersion; h.state.save();
  const recovered = new LocalSyncState(h.storage); recovered.state.initialSyncCompleted = true;
  const cloud = { async apply(operation) { rpcForSyncTable(operation.table, { legacy: Boolean(operation.legacyRecovery) }); } };
  const engine = new SyncEngine({ state: recovered, cloud, readLocal: blank, writeLocal: () => {} });
  await engine.push();
  assert.equal(recovered.state.outbox.length, 2);
  assert.deepEqual(recovered.state.outbox.map(item => item.status), ['blocked', 'blocked']);
  assert.deepEqual(recovered.state.outbox.map(item => item.lastErrorCode).sort(), ['LEGACY_OPERATION_MALFORMED', 'SYNC_ROUTE_MISSING']);
});

test('already-satisfied detection is exact and does not suppress divergent data', () => {
  const operation = markLegacyOperation({ attempts: 1, table: 'tasks', type: 'update', payload: { title: 'Milk Daisy', status: 'open' } });
  assert.equal(legacyOperationAlreadySatisfied(operation, { title: 'Milk Daisy', status: 'open', version: 7 }), true);
  assert.equal(legacyOperationAlreadySatisfied(operation, { title: 'Milk Daisy', status: 'completed', version: 7 }), false);
});

test('sync errors distinguish retryable transport failures from actionable server rejection', () => {
  assert.equal(isRetryableSyncError(Object.assign(new Error('Failed to fetch'), { code: 'FETCH' })), true);
  assert.equal(isRetryableSyncError(Object.assign(new Error('busy'), { status: 503 })), true);
  assert.equal(isRetryableSyncError(Object.assign(new Error('Unsupported sync table'), { code: '22023' })), false);
  assert.equal(isRetryableSyncError(Object.assign(new Error('forbidden'), { status: 403 })), false);
});

test('recurrence normalization keeps scheduling separate from completion behavior', () => {
  assert.deepEqual(housekeepingData.normalizeRecurrenceRule({ frequency: 'daily', interval: 1, completionAction: 'milk_morning' }), {
    mode: 'fixed_schedule', frequency: 'daily', interval: 1, enabled: true
  });
  assert.equal(housekeepingData.normalizeRecurrenceRule({ frequency: 'daily', routineType: 'egg_collection' }).routineType, undefined);
});

test('Yield matching uses explicit Task behavior, record, and work date', () => {
  const configured = { id: 'morning', recordId: 'daisy', dueDate: '2026-08-10', status: 'open', completed: false, yieldType:'milk' };
  const eggCollection = { ...configured, id: 'eggs', recordId: 'layers', yieldType:'eggs' };
  const titleOnly = { ...configured, id: 'title-only', yieldType:null, title: 'Milk Daisy this morning' };
  const yieldEntry = { recordId: 'daisy', type: 'milk', session: 'morning', occurredAt: '2026-08-10T07:00:00' };
  const eggYield = { recordId: 'layers', type: 'eggs', session: 'other', occurredAt: '2026-08-10T12:00:00' };
  assert.deepEqual(housekeepingData.matchingYieldTasks([configured, titleOnly], yieldEntry).map(task => task.id), ['morning']);
  assert.deepEqual(housekeepingData.matchingYieldTasks([eggCollection], eggYield).map(task => task.id), ['eggs']);
  assert.equal(housekeepingData.matchingYieldTasks([eggCollection], { ...eggYield, type: 'milk' }).length, 0);
});

test('a task-linked Yield keeps the canonical Task reference through migration', () => {
  const setup = harness();
  setup.state.bind(crypto.randomUUID());
  setup.state.state.initialSyncCompleted = true;
  const after = blank();
  after.records.push(record('daisy'));
  after.tasks.push({ id: 'milk-task', recordId: 'daisy', title: 'Barn round', status: 'completed', completed: true, dueDate: '2026-08-10', yieldType:'milk', recurrenceRule: { frequency: 'daily', interval: 1 }, createdAt: '2026-08-10T00:00:00Z', updatedAt: '2026-08-10T11:00:00Z' });
  after.yieldEntries.push({ id: 'yield-one', taskId: 'milk-task', recordId: 'daisy', type: 'milk', session: 'morning', occurredAt: '2026-08-10T11:00:00Z', quantity: 2, unit: 'gal', unusableQuantity: 0, details: '', createdAt: '2026-08-10T11:00:00Z', updatedAt: '2026-08-10T11:00:00Z' });
  setup.engine.queueLocalChanges(blank(), after);
  const taskOperation = setup.state.state.outbox.find(item => item.table === 'tasks');
  const yieldOperation = setup.state.state.outbox.find(item => item.table === 'yield_entries');
  assert.equal(yieldOperation.rowId, taskOperation.rowId);
  assert.equal(yieldOperation.payload.task_id, taskOperation.rowId);
  assert.equal(yieldOperation.payload.details.task_id, taskOperation.rowId);
});

test('offline linked completion queues both changes and reconnect sync succeeds once', async () => {
  const before = blank();
  before.records.push(record('daisy'));
  before.tasks.push({ id: 'milk-task', recordId: 'daisy', title: 'Morning round', status: 'open', completed: false, dueDate: '2026-08-10', recurrenceRule: { frequency: 'daily', interval: 1, routineType: 'milk_morning' }, createdAt: '2026-08-10T00:00:00Z', updatedAt: '2026-08-10T00:00:00Z' });
  const setup = harness(before);
  setup.state.bind(crypto.randomUUID());
  setup.state.state.initialSyncCompleted = true;
  const recordEntity = setup.state.entity('records', 'daisy'); recordEntity.cloudVersion = 1;
  const taskEntity = setup.state.entity('tasks', 'milk-task'); taskEntity.cloudVersion = 1;
  setup.cloud.rows.records.push({ id: recordEntity.cloudId, version: 1, type: 'animal', name: 'Daisy', status: 'Active', identity: {}, stewardship: {} });
  setup.cloud.rows.tasks.push({ id: taskEntity.cloudId, version: 1, record_id: recordEntity.cloudId, title: 'Morning round', status: 'open', due_date: '2026-08-10', recurrence_rule: { frequency: 'daily', interval: 1, routineType: 'milk_morning' } });
  const after = structuredClone(before);
  Object.assign(after.tasks[0], { status: 'completed', completed: true, completedAt: '2026-08-10T11:00:00Z', updatedAt: '2026-08-10T11:00:00Z' });
  after.yieldEntries.push({ id: 'milk-task', taskId: 'milk-task', recordId: 'daisy', type: 'milk', session: 'morning', occurredAt: '2026-08-10T11:00:00Z', quantity: 2, unit: 'gal', unusableQuantity: 0, details: '', createdAt: '2026-08-10T11:00:00Z', updatedAt: '2026-08-10T11:00:00Z' });
  setup.engine.queueLocalChanges(before, after);
  assert.deepEqual(setup.state.state.outbox.map(item => [item.table, item.type]), [['tasks', 'update'], ['yield_entries', 'create']]);
  await setup.engine.sync();
  assert.equal(setup.state.state.outbox.length, 0);
  assert.equal(setup.cloud.rows.yield_entries.length, 1);
  assert.equal(setup.cloud.rows.tasks.filter(row => row.id === taskEntity.cloudId && row.status === 'completed').length, 1);
});

test('matching an existing yield ignores deleted entries and does not require title text', () => {
  const task = { recordId: 'daisy', dueDate: '2026-08-10', yieldType:'milk', recurrenceRule: { frequency: 'daily' } };
  const deleted = { id: 'deleted', recordId: 'daisy', type: 'milk', session: 'evening', occurredAt: '2026-08-10T18:00:00', deletedAt: '2026-08-11T00:00:00Z' };
  const active = { ...deleted, id: 'active', deletedAt: null };
  assert.equal(housekeepingData.matchingYieldForTask([deleted, active], task).id, 'active');
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

test('a skipped recurring occurrence survives cloud pull as a tombstone', () => {
  const state = new LocalSyncState(new MemoryStorage());
  const cloudId = crypto.randomUUID();
  const localId = crypto.randomUUID();
  state.bind(crypto.randomUUID());
  state.entity('tasks', localId).cloudId = cloudId;
  state.save();
  const local = fromCloud('tasks', {
    id: cloudId, record_id: null, parent_task_id: null, chore_window_id: null,
    title: 'Morning milking', description: null, status: 'open', priority: 'normal',
    available_from: null, due_date: '2026-08-19', completed_at: null,
    recurrence_rule: { mode: 'fixed_schedule', frequency: 'daily', interval: 1, enabled: true, seriesId: 'series-1' },
    yield_type: 'milk', suggestion_key: 'dairy-milk-morning',
    created_at: '2026-08-18T10:00:00.000Z', updated_at: '2026-08-19T10:00:00.000Z',
    deleted_at: '2026-08-19T10:00:00.000Z'
  }, state);
  assert.equal(local.id, localId);
  assert.equal(local.deletedAt, '2026-08-19T10:00:00.000Z');
  assert.equal(local.dueDate, '2026-08-19');
  assert.equal(local.recurrenceRule.seriesId, 'series-1');
});

test('a disabled recurring series round-trips through cloud mapping', () => {
  const state = new LocalSyncState(new MemoryStorage());
  const localId = crypto.randomUUID();
  const cloudId = crypto.randomUUID();
  state.bind(crypto.randomUUID());
  state.entity('tasks', localId).cloudId = cloudId;
  state.save();
  const recurrenceRule = { mode: 'fixed_schedule', frequency: 'daily', interval: 1, enabled: false, seriesId: 'series-disabled' };
  const payload = toCloud('tasks', {
    id: localId, title: 'Evening milking', status: 'open', priority: 'normal',
    dueDate: '2026-08-19', completed: false, recurrenceRule,
    createdAt: '2026-08-18T10:00:00.000Z', updatedAt: '2026-08-19T10:00:00.000Z', deletedAt: null
  }, state);
  assert.deepEqual(payload.recurrence_rule, recurrenceRule);
  assert.equal(payload.deleted_at ?? null, null);
  const local = fromCloud('tasks', {
    id: cloudId, record_id: null, parent_task_id: null, chore_window_id: null,
    title: 'Evening milking', description: null, status: 'open', priority: 'normal',
    available_from: null, due_date: '2026-08-19', completed_at: null,
    recurrence_rule: recurrenceRule, yield_type: 'milk', suggestion_key: 'dairy-milk-evening',
    created_at: '2026-08-18T10:00:00.000Z', updated_at: '2026-08-19T10:00:00.000Z', deleted_at: null
  }, state);
  assert.equal(local.id, localId);
  assert.deepEqual(local.recurrenceRule, recurrenceRule);
  assert.equal(local.deletedAt, null);
  assert.equal(local.completed, false);
  assert.equal(local.recurrenceRule.enabled, false);
});

test('recurrence rules normalize supported schedules and reject unsupported ones', () => {
  assert.deepEqual(housekeepingData.normalizeRecurrenceRule({ frequency: 'weekly', mode: 'after_completion', interval: '2' }), {
    frequency: 'weekly', mode: 'after_completion', interval: 2, enabled: true
  });
  assert.deepEqual(housekeepingData.normalizeRecurrenceRule({ frequency: 'daily', interval: 0 }), {
    frequency: 'daily', mode: 'fixed_schedule', interval: 1, enabled: true
  });
  assert.equal(housekeepingData.normalizeRecurrenceRule({ frequency: 'monthly', interval: Infinity }).interval, 1);
  assert.equal(housekeepingData.normalizeRecurrenceRule({ frequency: 'yearly' }), null);
});

test('recurring due dates follow fixed and after-completion schedules', () => {
  assert.equal(housekeepingData.nextRecurringDueDate({ dueDate: '2026-08-10', recurrenceRule: { frequency: 'weekly', interval: 2 } }, '2026-08-20'), '2026-08-24');
  assert.equal(housekeepingData.nextRecurringDueDate({ dueDate: '2026-08-10', recurrenceRule: { frequency: 'daily', mode: 'after_completion', interval: 3 } }, '2026-08-20'), '2026-08-23');
  assert.equal(housekeepingData.nextRecurringDueDate({ dueDate: '2027-01-31', recurrenceRule: { frequency: 'monthly', interval: 1 } }, '2027-02-02'), '2027-02-28');
});

test('recurrence summary describes cadence and scheduling mode', () => {
  assert.equal(housekeepingData.recurrenceSummary({ frequency: 'monthly', interval: 1 }), 'Repeats every month');
  assert.equal(housekeepingData.recurrenceSummary({ frequency: 'weekly', interval: 2, mode: 'after_completion' }), 'Repeats every 2 weeks after completion');
});

test('calendar displays a Task from its start date through its due date', () => {
  const task = { availableFrom: '2026-08-10', dueDate: '2026-08-13' };
  assert.deepEqual(housekeepingData.taskCalendarBounds(task), { start: '2026-08-10', end: '2026-08-13' });
  assert.equal(housekeepingData.taskCalendarSegment(task, '2026-08-09'), null);
  assert.equal(housekeepingData.taskCalendarSegment(task, '2026-08-10'), 'start');
  assert.equal(housekeepingData.taskCalendarSegment(task, '2026-08-11'), 'middle');
  assert.equal(housekeepingData.taskCalendarSegment(task, '2026-08-13'), 'end');
  assert.equal(housekeepingData.taskCalendarSegment(task, '2026-08-14'), null);
});

test('calendar range bars restart cleanly when they cross a week', () => {
  const task = { availableFrom: '2026-08-10', dueDate: '2026-08-18' };
  assert.deepEqual(housekeepingData.taskCalendarBarSegment(task, '2026-08-10', 1), { starts: true, ends: false, showLabel: true });
  assert.deepEqual(housekeepingData.taskCalendarBarSegment(task, '2026-08-15', 6), { starts: false, ends: true, showLabel: false });
  assert.deepEqual(housekeepingData.taskCalendarBarSegment(task, '2026-08-16', 0), { starts: true, ends: false, showLabel: true });
  assert.deepEqual(housekeepingData.taskCalendarBarSegment(task, '2026-08-18', 2), { starts: false, ends: true, showLabel: false });
  assert.equal(housekeepingData.taskCalendarBarSegment({ dueDate: '2026-08-10' }, '2026-08-10', 1), null);
});

test('calendar keeps single-date and malformed legacy Tasks safe', () => {
  assert.equal(housekeepingData.taskCalendarSegment({ dueDate: '2026-08-12' }, '2026-08-12'), 'single');
  assert.deepEqual(housekeepingData.taskCalendarBounds({ availableFrom: '2026-08-13', dueDate: '2026-08-10' }), {
    start: '2026-08-10', end: '2026-08-13'
  });
  assert.equal(housekeepingData.taskCalendarSegment({}, '2026-08-12'), null);
});

test('child profiles and task assignments retain their canonical person link', () => {
  const state = new LocalSyncState(new MemoryStorage());
  const child = { id: 'child-one', personType: 'child', displayName: 'Clare', createdAt: '2026-08-10T12:00:00Z' };
  const taskId = 'task-one';
  const personPayload = toCloud('homestead_people', child, state);
  const assignmentPayload = toCloud('task_assignments', {
    id: 'assignment-one', taskId, personId: child.id, assignmentType: 'assignee', assignedAt: '2026-08-10T12:00:00Z'
  }, state);
  assert.equal(personPayload.person_type, 'child');
  assert.equal(personPayload.member_id, null);
  assert.equal(assignmentPayload.person_id, state.entity('homestead_people', child.id).cloudId);
  assert.equal(assignmentPayload.task_id, state.entity('tasks', taskId).cloudId);
  const local = fromCloud('task_assignments', {
    id: assignmentPayload.id, task_id: assignmentPayload.task_id, person_id: assignmentPayload.person_id,
    member_id: null, assignment_type: 'assignee', assigned_at: '2026-08-10T12:00:00Z',
    updated_at: '2026-08-10T12:00:00Z', removed_at: null
  }, state);
  assert.equal(local.personId, child.id);
});

test('account-backed directory entries do not make an empty Homestead look populated', () => {
  const data = blank();
  data.people.push({ id: 'member-one', personType: 'member', displayName: 'Steward', memberId: crypto.randomUUID() });
  assert.equal(hasMeaningfulData(data), false);
  data.people.push({ id: 'child-one', personType: 'child', displayName: 'Clare' });
  assert.equal(hasMeaningfulData(data), true);
});

test('member directory reconciliation repairs a stale local people cache without resetting its cursor', async () => {
  const membershipId = crypto.randomUUID();
  const cloudPersonId = crypto.randomUUID();
  const cloud = new MockCloud({ homestead_people: [{
    id: cloudPersonId, person_type: 'member', display_name: 'Morgan Steward', member_id: membershipId,
    version: 3, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-20T00:00:00Z', deleted_at: null
  }] });
  const setup = harness(blank(), cloud);
  setup.state.bind(crypto.randomUUID());
  setup.state.state.initialSyncCompleted = true;
  setup.state.state.cursors.homestead_people = { updatedAt: '2026-08-29T00:00:00Z', id: crypto.randomUUID() };
  setup.state.save();

  await setup.engine.pull();

  assert.deepEqual(setup.local().people.map(person => ({
    personType: person.personType, displayName: person.displayName, memberId: person.memberId, deletedAt: person.deletedAt
  })), [{ personType: 'member', displayName: 'Morgan Steward', memberId: membershipId, deletedAt: null }]);
});

test('local attachment metadata waits for binary upload before entering the cloud outbox', () => {
  const before = blank(); const h = harness(before);
  h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true;
  const local = structuredClone(before);
  local.attachments.push({ id: 'photo-1', documentId: 'doc-1', recordId: 'daisy', storagePath: '', filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1000, syncState: 'local', createdAt: '2026-08-20T00:00:00Z', updatedAt: '2026-08-20T00:00:00Z' });
  h.engine.queueLocalChanges(before, local);
  assert.equal(h.state.state.outbox.some(item => item.table === 'record_attachments'), false);
  const uploaded = structuredClone(local);
  Object.assign(uploaded.attachments[0], { storagePath: 'homesteads/h/records/daisy/photo-1/photo.jpg', syncState: 'synced' });
  h.engine.queueLocalChanges(local, uploaded);
  assert.equal(h.state.state.outbox.find(item => item.table === 'record_attachments')?.type, 'create');
});

test('a failed local attachment does not prevent unrelated Task metadata from syncing', async () => {
  const before = blank(); const h = harness(before);
  h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true;
  const after = blank();
  after.attachments.push({ id: 'missing-photo', documentId: 'doc-1', recordId: 'daisy', storagePath: '', filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1000, syncState: 'failed', syncError: 'The local attachment copy is unavailable.', createdAt: '2026-08-29T10:00:00Z', updatedAt: '2026-08-29T10:00:00Z' });
  after.tasks.push({ id: 'independent-task', title: 'Close the gate', status: 'open', completed: false, createdAt: '2026-08-29T10:00:00Z', updatedAt: '2026-08-29T10:00:00Z' });

  h.engine.queueLocalChanges(before, after);
  await h.engine.push();

  assert.equal(h.cloud.rows.tasks.length, 1);
  assert.equal(h.state.state.outbox.some(item => item.table === 'record_attachments'), false);
  assert.equal(after.attachments[0].syncState, 'failed');
});

test('Record responsibility retains its canonical Homestead Person mapping', () => {
  const state = new LocalSyncState(new MemoryStorage());
  const personId = 'member-one';
  const localRecord = record('daisy');
  localRecord.stewardship = { responsiblePersonId: personId };

  const cloudRecord = toCloud('records', localRecord, state);
  assert.equal(cloudRecord.stewardship.responsiblePersonId, state.entity('homestead_people', personId).cloudId);

  const restored = fromCloud('records', {
    ...cloudRecord,
    id: cloudRecord.id,
    type: 'animal',
    created_at: localRecord.createdAt,
    updated_at: localRecord.updatedAt
  }, state);
  assert.equal(restored.stewardship.responsiblePersonId, personId);
});

test('calendar events retain all-day and optional time metadata', () => {
  const state = new LocalSyncState(new MemoryStorage());
  const event = { id: crypto.randomUUID(), title: 'Farmers market', startDate: '2026-08-15', endDate: '2026-08-15', allDay: false, startTime: '08:30', endTime: '11:00', location: 'Town green', notes: '', createdAt: '2026-08-09T12:00:00Z' };
  const cloud = toCloud('calendar_events', event, state);
  assert.equal(cloud.start_time, '08:30');
  assert.equal(cloud.all_day, false);
  const local = fromCloud('calendar_events', { ...cloud, id: cloud.id, created_at: event.createdAt, updated_at: event.createdAt }, state);
  assert.equal(local.location, 'Town green');
});

test('yield entries retain session, loss, and canonical record link', () => {
  const state = new LocalSyncState(new MemoryStorage());
  const recordId = crypto.randomUUID();
  const entry = { id: crypto.randomUUID(), recordId, type: 'milk', occurredAt: '2026-08-09T12:00:00Z', session: 'morning', quantity: 2.5, unit: 'gal', unusableQuantity: .25, details: 'Fresh', createdAt: '2026-08-09T12:00:00Z' };
  const cloud = toCloud('yield_entries', entry, state);
  assert.equal(cloud.record_id, state.entity('records', recordId).cloudId);
  assert.equal(cloud.unusable_quantity, .25);
  assert.equal(cloud.session, 'morning');
});

test('historical yield migration is conservative and preserves exact AM/PM meanings', () => {
  const base = { recordId: 'cow', date: '2026-08-01', value: 2, unit: 'gal' };
  assert.deepEqual(
    ['AM Milk', 'Evening Milk', 'Egg Collection'].map((eventType, index) => housekeepingData.historicalYieldCandidate({ ...base, id: String(index), eventType } )?.session),
    ['morning', 'evening', 'other']
  );
  assert.equal(housekeepingData.historicalYieldCandidate({ ...base, id: 'weight', eventType: 'Weight' }), null);
  assert.equal(housekeepingData.historicalYieldCandidate({ ...base, id: 'ambiguous', eventType: 'Milked' }), null);
});

test('push uses dependency-safe domain order', async () => {
  const h = harness(); h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true;
  for (const table of [...DOMAIN_ORDER].reverse()) h.state.enqueue({ table, localId: crypto.randomUUID(), type: 'create', payload: { id: crypto.randomUUID() } });
  await h.engine.push(); assert.deepEqual(h.cloud.calls.map(item => item.table), DOMAIN_ORDER);
});

test('one unsupported legacy operation is blocked locally while healthy operations continue', async () => {
  const h = harness(); h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true;
  h.state.enqueue({ table: 'routines', localId: 'old-routine', type: 'update', payload: {} });
  h.state.enqueue({ table: 'records', localId: 'daisy', type: 'create', payload: { type: 'animal', name: 'Daisy', identity: {}, stewardship: {} } });
  const apply = h.cloud.apply.bind(h.cloud);
  h.cloud.apply = operation => operation.table === 'routines'
    ? Promise.reject(Object.assign(new Error('No cloud synchronization route is registered for routines.'), { code: 'SYNC_ROUTE_MISSING' }))
    : apply(operation);

  await h.engine.push();

  assert.equal(h.cloud.rows.records.length, 1);
  const blocked = h.state.state.outbox.find(item => item.table === 'routines');
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.lastErrorCode, 'SYNC_ROUTE_MISSING');
  assert.equal(h.state.state.failedOperations[0].localId, 'old-routine');
});

test('a transient failure remains retryable while an unrelated change syncs and later recovers', async () => {
  const h = harness(); h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true;
  h.state.enqueue({ table: 'records', localId: 'daisy', type: 'create', payload: { type: 'animal', name: 'Daisy', identity: {}, stewardship: {} } });
  h.state.enqueue({ table: 'chore_windows', localId: 'morning', type: 'create', payload: { name: 'Morning' } });
  const apply = h.cloud.apply.bind(h.cloud);
  let failRecord = true;
  h.cloud.apply = operation => failRecord && operation.table === 'records'
    ? Promise.reject(Object.assign(new Error('network unavailable'), { code: 'FETCH' }))
    : apply(operation);

  await h.engine.push();
  assert.equal(h.state.state.outbox.find(item => item.table === 'records').status, 'retryable');
  assert.equal(h.cloud.rows.chore_windows.length, 1);

  failRecord = false;
  await h.engine.push();
  assert.equal(h.state.state.outbox.length, 0);
  assert.equal(h.cloud.rows.records.length, 1);
});

test('overlapping foreground triggers share one active sync run', async () => {
  const h = harness(); h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true;
  h.state.enqueue({ table: 'records', localId: 'daisy', type: 'create', payload: { type: 'animal', name: 'Daisy', identity: {}, stewardship: {} } });
  const apply = h.cloud.apply.bind(h.cloud);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  h.cloud.apply = async operation => { await gate; return apply(operation); };

  const foreground = h.engine.sync();
  const focus = h.engine.sync();
  release();
  await Promise.all([foreground, focus]);

  assert.equal(h.cloud.calls.length, 1);
  assert.equal(h.cloud.rows.records.length, 1);
});

test('dependent changes wait behind a failed parent while unrelated domains continue', async () => {
  const h = harness(); h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true;
  const parent = h.state.enqueue({ table: 'records', localId: 'daisy', type: 'create', payload: { type: 'animal', name: 'Daisy', identity: {}, stewardship: {} } });
  h.state.enqueue({ table: 'record_documents', localId: 'vet-note', type: 'create', payload: { record_id: parent.rowId, title: 'Vet note' } });
  h.state.enqueue({ table: 'chore_windows', localId: 'morning', type: 'create', payload: { name: 'Morning' } });
  const apply = h.cloud.apply.bind(h.cloud);
  let failParent = true;
  h.cloud.apply = operation => failParent && operation.id === parent.id
    ? Promise.reject(Object.assign(new Error('network unavailable'), { code: 'FETCH' }))
    : apply(operation);

  await h.engine.push();
  assert.equal(h.state.state.outbox.find(item => item.table === 'record_documents').status, 'dependency');
  assert.equal(h.cloud.rows.chore_windows.length, 1);

  failParent = false;
  await h.engine.push();
  assert.equal(h.state.state.outbox.length, 0);
  assert.equal(h.cloud.rows.record_documents.length, 1);
});

test('an RLS rejection stays actionable and manual retry succeeds after permission is corrected', async () => {
  const h = harness(); h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true;
  h.state.enqueue({ table: 'ledger_entries', localId: 'feed-cost', type: 'create', payload: { entry_type: 'expense', amount: 25 } });
  const apply = h.cloud.apply.bind(h.cloud);
  let denied = true;
  h.cloud.apply = operation => denied
    ? Promise.reject(Object.assign(new Error('Not authorized'), { code: '42501' }))
    : apply(operation);

  await h.engine.push();
  const blocked = h.state.state.outbox[0];
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.lastErrorCode, '42501');

  denied = false;
  await h.engine.push({ retryBlocked: true });
  assert.equal(h.state.state.outbox.length, 0);
  assert.equal(h.cloud.rows.ledger_entries.length, 1);
});

test('a conflict in one entity does not freeze an unrelated domain', async () => {
  const cloudId = crypto.randomUUID();
  const cloud = new MockCloud({ records: [{ id: cloudId, version: 3, name: 'Cloud Daisy' }] });
  const h = harness(blank(), cloud); h.state.bind(crypto.randomUUID()); h.state.state.initialSyncCompleted = true;
  h.state.entity('records', 'daisy').cloudId = cloudId;
  h.state.enqueue({ table: 'records', localId: 'daisy', type: 'update', baseVersion: 2, payload: { id: cloudId, name: 'Local Daisy' } });
  h.state.enqueue({ table: 'chore_windows', localId: 'morning', type: 'create', payload: { name: 'Morning' } });

  await h.engine.push();

  assert.equal(h.state.state.conflicts.length, 1);
  assert.equal(h.cloud.rows.chore_windows.length, 1);
  assert.equal(h.state.state.outbox.length, 0);
});

test('offline outbox survives reload and reconnect applies the operation exactly once', async () => {
  const storage = new MemoryStorage();
  const firstState = new LocalSyncState(storage); const homestead = crypto.randomUUID();
  firstState.bind(homestead); firstState.state.initialSyncCompleted = true;
  firstState.enqueue({ table: 'records', localId: 'daisy', type: 'create', payload: { type: 'animal', name: 'Daisy', identity: {}, stewardship: {} } });

  const recoveredState = new LocalSyncState(storage);
  const cloud = new MockCloud();
  const engine = new SyncEngine({ state: recoveredState, cloud, readLocal: blank, writeLocal: () => {} });
  await engine.push();
  await engine.push();

  assert.equal(recoveredState.state.outbox.length, 0);
  assert.equal(cloud.rows.records.length, 1);
});

test('successful idempotent retry cannot duplicate a row', async () => {
  const h = harness(); h.state.bind(crypto.randomUUID()); const item = record();
  const operation = h.state.enqueue({ table: 'records', localId: item.id, type: 'create', payload: toCloud('records', item, h.state) });
  const first = await h.cloud.apply(operation); const second = await h.cloud.apply(operation);
  assert.deepEqual(second, first); assert.equal(h.cloud.rows.records.length, 1);
});

test('a server-deduplicated recurring occurrence rebinds its local cloud identity', () => {
  const state = new LocalSyncState(new MemoryStorage());
  const localId = 'local-occurrence';
  const operation = state.enqueue({ table: 'tasks', localId, type: 'create', payload: {} });
  const existingCloudId = crypto.randomUUID();
  state.complete(operation, { id: existingCloudId, version: 3 });
  assert.equal(state.entity('tasks', localId).cloudId, existingCloudId);
  assert.equal(state.localIdForCloud('tasks', existingCloudId), localId);
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

test('keep-cloud resolution rebinds a legacy relationship conflict and preserves other reviews', async () => {
  const localId = 'legacy-location';
  const staleCloudId = crypto.randomUUID();
  const existingCloudId = crypto.randomUUID();
  const sourceCloudId = crypto.randomUUID();
  const targetCloudId = crypto.randomUUID();
  const data = blank();
  data.relationships.push({ id: localId, sourceRecordId: 'daisy', targetRecordId: 'north-field', relationshipType: 'grazes_on', details: { local: true } });
  data.notes.push({ id: 'unrelated-note', text: 'Leave this alone' });
  const h = harness(data);
  h.state.bind(crypto.randomUUID());
  h.state.entity('records', 'daisy').cloudId = sourceCloudId;
  h.state.entity('records', 'north-field').cloudId = targetCloudId;
  h.state.entity('record_relationships', localId).cloudId = staleCloudId;
  const conflict = h.state.addConflict({
    id: crypto.randomUUID(), table: 'record_relationships', localId, rowId: staleCloudId, type: 'create', baseVersion: null,
    payload: { id: staleCloudId, source_record_id: sourceCloudId, target_record_id: targetCloudId, relationship_type: 'grazes_on', details: { local: true } }
  }, {
    id: existingCloudId, version: 4, source_record_id: sourceCloudId, target_record_id: targetCloudId,
    relationship_type: 'located_on', started_at: null, ended_at: null, details: { cloud: true },
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-02T00:00:00Z'
  });
  const other = h.state.addConflict({ id: crypto.randomUUID(), table: 'records', localId: 'other', rowId: crypto.randomUUID(), payload: {}, baseVersion: 1 }, { id: crypto.randomUUID(), version: 2 });

  await h.engine.resolveConflict(conflict.id, 'cloud');

  assert.deepEqual(h.local().relationships.map(row => ({ id: row.id, type: row.relationshipType, details: row.details })), [
    { id: localId, type: 'located_on', details: { cloud: true } }
  ]);
  assert.equal(h.state.entity('record_relationships', localId).cloudId, existingCloudId);
  assert.equal(h.state.entity('record_relationships', localId).cloudVersion, 4);
  assert.deepEqual(h.state.state.conflicts.filter(item => item.status === 'unresolved').map(item => item.id), [other.id]);
  assert.deepEqual(new LocalSyncState(h.storage).state.conflicts.filter(item => item.status === 'unresolved').map(item => item.id), [other.id]);
  assert.deepEqual(h.local().notes, [{ id: 'unrelated-note', text: 'Leave this alone' }]);
});

test('relationship conflict presentation identifies the linked Records and relationship type', () => {
  const conflict = { table: 'record_relationships', localId: 'relationship-1', localPayload: {}, cloudRow: {} };
  assert.deepEqual(conflictPresentation(conflict, {
    records: [{ id: 'daisy', name: 'Daisy' }, { id: 'north-field', name: 'North Field' }],
    relationships: [{ id: 'relationship-1', sourceRecordId: 'daisy', targetRecordId: 'north-field', relationshipType: 'grazes_on' }]
  }), {
    title: 'Record relationship changed on this device and in cloud.',
    detail: 'Source: Daisy · Type: grazes on · Related Record: North Field'
  });
});

test('use-local resolution updates the existing relationship row without duplication', async () => {
  const localId = 'legacy-location';
  const staleCloudId = crypto.randomUUID();
  const existingCloudId = crypto.randomUUID();
  const sourceCloudId = crypto.randomUUID();
  const targetCloudId = crypto.randomUUID();
  const cloud = new MockCloud({ record_relationships: [{
    id: existingCloudId, version: 4, source_record_id: sourceCloudId, target_record_id: targetCloudId,
    relationship_type: 'located_on', started_at: null, ended_at: null, details: { cloud: true }
  }] });
  const h = harness(blank(), cloud);
  h.state.bind(crypto.randomUUID());
  h.state.entity('record_relationships', localId).cloudId = staleCloudId;
  const conflict = h.state.addConflict({
    id: crypto.randomUUID(), table: 'record_relationships', localId, rowId: staleCloudId, type: 'create', baseVersion: null,
    payload: { id: staleCloudId, source_record_id: sourceCloudId, target_record_id: targetCloudId, relationship_type: 'grazes_on', started_at: null, ended_at: null, details: { local: true } }
  }, cloud.rows.record_relationships[0]);

  await h.engine.resolveConflict(conflict.id, 'local');

  assert.equal(cloud.rows.record_relationships.length, 1);
  assert.equal(cloud.rows.record_relationships[0].id, existingCloudId);
  assert.equal(cloud.rows.record_relationships[0].relationship_type, 'grazes_on');
  assert.deepEqual(cloud.rows.record_relationships[0].details, { local: true });
  assert.equal(h.state.state.conflicts.some(item => item.status === 'unresolved'), false);
  assert.equal(h.state.state.outbox.length, 0);
  assert.equal(h.state.entity('record_relationships', localId).cloudId, existingCloudId);
  assert.equal(new LocalSyncState(h.storage).state.conflicts.some(item => item.status === 'unresolved'), false);
  assert.ok(h.state.state.lastSuccessfulSyncAt);
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

test('cloud pagination keeps rows with identical timestamps by using the id tie-breaker', async () => {
  const timestamp = '2026-08-29T12:00:00.000Z';
  const rows = Array.from({ length: 205 }, (_, index) => ({
    id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    updated_at: timestamp
  }));
  class Query {
    constructor() { this.cursor = { updatedAt: '1970-01-01T00:00:00.000Z', id: '00000000-0000-0000-0000-000000000000' }; }
    select() { return this; }
    or(filter) {
      const match = filter.match(/^updated_at\.gt\.([^,]+),and\(updated_at\.eq\.([^,]+),id\.gt\.([^)]+)\)$/);
      this.cursor = { updatedAt: match[1], id: match[3] };
      return this;
    }
    order() { return this; }
    limit() { return this; }
    then(resolve) {
      const page = rows.filter(row => row.updated_at > this.cursor.updatedAt || (row.updated_at === this.cursor.updatedAt && row.id > this.cursor.id)).slice(0, 200);
      return Promise.resolve({ data: page, error: null }).then(resolve);
    }
  }
  const adapter = new SupabaseSyncAdapter({ from: () => new Query() });
  const received = [];
  for await (const page of adapter.changes('records')) received.push(...page.rows);
  assert.equal(received.length, 205);
  assert.equal(new Set(received.map(row => row.id)).size, 205);
});

test('pull cursor does not advance when a page cannot be applied locally', async () => {
  const state = new LocalSyncState(new MemoryStorage());
  state.bind(crypto.randomUUID());
  const row = { id: crypto.randomUUID(), version: 1, type: 'animal', name: 'Daisy', status: 'Active', identity: {}, stewardship: {}, created_at: '2026-08-29T12:00:00Z', updated_at: '2026-08-29T12:00:00Z' };
  const cloud = { async *changes(table) { if (table === 'records') yield { rows: [row], cursor: { updatedAt: row.updated_at, id: row.id } }; } };
  const engine = new SyncEngine({ state, cloud, readLocal: blank, writeLocal: () => { throw new Error('local write failed'); } });
  await assert.rejects(engine.pull(), /local write failed/);
  assert.equal(state.state.cursors.records, undefined);
});

test('two devices exchange Record, Task, Yield, Ledger, edits, and soft deletion without manual mutation', async () => {
  class SharedCloud extends MockCloud {
    async *changes(table, cursor) {
      const start = cursor || { updatedAt: '1970-01-01T00:00:00.000Z', id: '00000000-0000-0000-0000-000000000000' };
      const rows = this.rows[table]
        .filter(row => row.updated_at > start.updatedAt || (row.updated_at === start.updatedAt && row.id > start.id))
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id));
      if (rows.length) {
        const last = rows.at(-1);
        yield { rows, cursor: { updatedAt: last.updated_at, id: last.id } };
      }
    }
  }
  const cloud = new SharedCloud();
  const first = harness(blank(), cloud); const homestead = crypto.randomUUID();
  first.state.bind(homestead); first.state.state.initialSyncCompleted = true;
  const firstLocal = blank(); firstLocal.records.push(record('daisy'));
  first.engine.queueLocalChanges(blank(), firstLocal);
  first.setLocal(firstLocal);
  await first.engine.sync();

  const second = harness(blank(), cloud);
  second.state.bind(homestead); second.state.state.initialSyncCompleted = true;
  await second.engine.pull();
  assert.equal(second.local().records[0].name, 'Daisy');
  assert.equal(second.state.state.cursors.records.id, cloud.rows.records[0].id);

  let before = first.local();
  let after = structuredClone(before);
  after.tasks.push({ id: 'milk-task', recordId: 'daisy', title: 'Morning milking', status: 'open', completed: false, dueDate: '2026-08-29', createdAt: '2026-08-29T12:01:00Z', updatedAt: '2026-08-29T12:01:00Z' });
  first.engine.queueLocalChanges(before, after); first.setLocal(after); await first.engine.sync(); await second.engine.pull();
  assert.equal(second.local().tasks[0].title, 'Morning milking');

  before = first.local(); after = structuredClone(before);
  Object.assign(after.tasks[0], { status: 'completed', completed: true, completedAt: '2026-08-30T12:02:00Z', updatedAt: '2026-08-30T12:02:00Z' });
  after.yieldEntries.push({ id: 'milk-yield', taskId: 'milk-task', recordId: 'daisy', type: 'milk', session: 'morning', occurredAt: '2026-08-30T12:02:00Z', quantity: 2, unit: 'gal', unusableQuantity: 0, details: '', createdAt: '2026-08-30T12:02:00Z', updatedAt: '2026-08-30T12:02:00Z' });
  first.engine.queueLocalChanges(before, after); first.setLocal(after); await first.engine.sync(); await second.engine.pull();
  assert.equal(cloud.rows.tasks[0].status, 'completed');
  assert.equal(second.state.state.cursors.tasks.updatedAt, '2026-08-30T12:02:00Z');
  assert.equal(second.local().tasks[0].completed, true);
  assert.equal(second.local().yieldEntries[0].quantity, 2);

  before = first.local(); after = structuredClone(before);
  after.ledger.push({ id: 'feed-entry', recordId: 'daisy', type: 'expense', amount: 40, category: 'Feed', date: '2026-08-30', createdAt: '2026-08-30T12:03:00Z', updatedAt: '2026-08-30T12:03:00Z' });
  after.ledgerAllocations.push({ id: 'feed-share', ledgerEntryId: 'feed-entry', recordId: 'daisy', amount: 40, createdAt: '2026-08-30T12:03:00Z', updatedAt: '2026-08-30T12:03:00Z' });
  first.engine.queueLocalChanges(before, after); first.setLocal(after); await first.engine.sync(); await second.engine.pull();
  assert.equal(second.local().ledger[0].amount, 40);
  assert.equal(second.local().ledgerAllocations[0].amount, 40);

  before = second.local(); after = structuredClone(before);
  Object.assign(after.records[0], { name: 'Daisy II', updatedAt: '2026-08-30T12:04:00Z' });
  second.engine.queueLocalChanges(before, after); second.setLocal(after); await second.engine.sync(); await first.engine.pull();
  assert.equal(first.local().records[0].name, 'Daisy II');

  const staleSecond = structuredClone(second.local());
  before = first.local(); after = structuredClone(before);
  Object.assign(after.tasks[0], { deletedAt: '2026-08-30T12:05:00Z', updatedAt: '2026-08-30T12:05:00Z' });
  first.engine.queueLocalChanges(before, after); first.setLocal(after); await first.engine.sync();

  const staleEdit = structuredClone(staleSecond);
  Object.assign(staleEdit.tasks[0], { title: 'Stale renamed task', updatedAt: '2026-08-30T12:06:00Z' });
  second.engine.queueLocalChanges(staleSecond, staleEdit); second.setLocal(staleEdit); await second.engine.sync();
  assert.equal(second.state.state.conflicts.some(item => item.table === 'tasks'), true);
  assert.equal(second.local().tasks[0].deletedAt, '2026-08-30T12:05:00Z');
});
