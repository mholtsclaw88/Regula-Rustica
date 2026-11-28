import assert from 'node:assert/strict';
import test from 'node:test';
import { SyncEngine } from '../sync/engine.mjs';
import { LocalSyncState, SYNC_STORAGE_KEYS } from '../sync/local-state.mjs';
import { toCloud } from '../sync/entities.mjs';

class Storage {
  values = new Map(); flushes = 0;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  async flush() { this.flushes++; }
}
const time = '2026-10-01T12:00:00Z';
function fixture({ taskId = crypto.randomUUID(), canonical = crypto.randomUUID() } = {}) {
  const storage = new Storage(), state = new LocalSyncState(storage);
  state.bind(crypto.randomUUID()); state.state.initialSyncCompleted = true;
  const task = { id: taskId, recordId: crypto.randomUUID(), title: 'Synthetic milking', yieldType: 'milk', dueDate: '2026-10-01', completed: true, createdAt: time, updatedAt: time };
  const entry = { id: crypto.randomUUID(), taskId, recordId: task.recordId, type: 'milk', occurredAt: time, quantity: 2, unit: 'gal', details: 'Synthetic content', createdAt: time, updatedAt: time };
  const local = { tasks: [task], yieldEntries: [entry] };
  const calls = [];
  const row = { ...toCloud('tasks', task, state), id: canonical, homestead_id: state.state.homesteadId, version: 3, deleted_at: null };
  const cloud = { async apply(operation) {
    calls.push(structuredClone(operation));
    if (operation.table === 'tasks') return { status: 'applied', row };
    if (operation.payload.details.task_id !== canonical) throw Object.assign(new Error('Task belongs to another Homestead'), { code: '23503' });
    return { status: 'applied', row: { ...operation.payload, id: operation.rowId, version: 1 } };
  } };
  const engineFor = value => new SyncEngine({ state: value, cloud, readLocal: () => structuredClone(local), writeLocal: () => {} });
  const enqueue = () => state.enqueue({ table: 'yield_entries', localId: entry.id, type: 'create', payload: toCloud('yield_entries', entry, state) });
  const adopt = () => { const parent = state.enqueue({ table: 'tasks', localId: task.id, type: 'create', payload: toCloud('tasks', task, state) }); state.complete(parent, row); };
  return { storage, state, task, entry, local, calls, row, cloud, engineFor, enqueue, adopt, engine: engineFor(state) };
}

test('canonical recurrence adoption repairs only a definitely rejected Yield FK and retries once', async () => {
  const h = fixture({ taskId: 'synthetic-generated-task' });
  h.state.enqueue({ table: 'tasks', localId: h.task.id, type: 'create', payload: toCloud('tasks', h.task, h.state) });
  const op = h.enqueue(), original = structuredClone(op), originalApply = h.cloud.apply;
  h.cloud.apply = async operation => {
    if (operation.table === 'yield_entries' && operation.idempotencyKey !== original.idempotencyKey) {
      const durable = JSON.parse(h.storage.getItem(SYNC_STORAGE_KEYS.state)).outbox.find(x => x.id === op.id);
      assert.deepEqual(durable.payload, operation.payload); assert.equal(durable.idempotencyKey, operation.idempotencyKey);
      assert.ok(h.storage.flushes >= 3);
    }
    return originalApply(operation);
  };
  await h.engine.push();
  assert.equal(h.state.state.outbox.length, 0);
  assert.deepEqual(h.calls.map(x => x.table), ['tasks', 'yield_entries', 'yield_entries']);
  assert.equal(h.calls[1].payload.task_id, original.payload.task_id);
  const repaired = h.calls[2]; assert.notEqual(repaired.idempotencyKey, original.idempotencyKey);
  assert.equal(repaired.rowId, original.rowId);
  const expected = structuredClone(original.payload); expected.task_id = h.row.id; expected.details.task_id = h.row.id;
  assert.deepEqual(repaired.payload, expected);
  assert.equal(h.local.yieldEntries[0].taskId, h.task.id);
});

test('persisted manual retry repairs a proven UUID Task alias without rewriting Yield snapshot', async () => {
  const h = fixture(), op = h.enqueue(), original = structuredClone(op);
  h.state.fail(op, Object.assign(new Error('Task belongs to another Homestead'), { code: '23503' }));
  const entity = h.state.entity('tasks', h.task.id); entity.cloudId = h.row.id; entity.cloudRow = h.row; entity.cloudVersion = 3; h.state.save();
  h.local.yieldEntries[0].quantity = 99; // A later edit must not replace this queued snapshot.
  const reloaded = new LocalSyncState(h.storage); assert.equal(reloaded.state.outbox[0].legacyRecovery, undefined);
  await h.engineFor(reloaded).push(); assert.equal(h.calls.length, 0);
  await h.engineFor(reloaded).push({ retryBlocked: true });
  assert.equal(reloaded.state.outbox.length, 0); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].payload.quantity, original.payload.quantity); assert.equal(h.calls[0].rowId, original.rowId);
  assert.equal(h.calls[0].payload.task_id, h.row.id);
});

for (const reason of ['no drift', 'unknown generated alias', 'foreign canonical', 'deleted canonical', 'deleted local task', 'missing local task', 'disagreeing aliases', 'update']) {
  test(`Yield FK recovery preserves blocking for ${reason}`, async () => {
    const h = fixture({ taskId: reason === 'unknown generated alias' ? 'synthetic-generated-task' : crypto.randomUUID() }), op = h.enqueue();
    const original = structuredClone(op);
    const entity = h.state.entity('tasks', h.task.id); entity.cloudId = h.row.id; entity.cloudRow = h.row;
    if (reason === 'no drift') { entity.cloudId = op.payload.task_id; entity.cloudRow = { ...h.row, id: entity.cloudId }; }
    if (reason === 'foreign canonical') entity.cloudRow = { ...h.row, homestead_id: crypto.randomUUID() };
    if (reason === 'deleted canonical') entity.cloudRow = { ...h.row, deleted_at: time };
    if (reason === 'deleted local task') h.task.deletedAt = time;
    if (reason === 'missing local task') h.local.tasks = [];
    if (reason === 'disagreeing aliases') op.payload.details.task_id = crypto.randomUUID();
    if (reason === 'update') op.type = 'update';
    h.state.fail(op, Object.assign(new Error('Task belongs to another Homestead'), { code: '23503' }));
    assert.equal(h.engine.repairRejectedYieldTaskReference(op), false);
    assert.equal(op.idempotencyKey, original.idempotencyKey); assert.equal(op.payload.task_id, original.payload.task_id); assert.equal(op.status, 'blocked');
  });
}

for (const code of ['FETCH', 'NETWORK_ERROR', '500', null]) {
  test(`uncertain ${code || 'zero-attempt crash'} outcome retains original Yield request and key`, async () => {
    const h = fixture(), op = h.enqueue(), original = structuredClone(op); h.adopt();
    if (code) h.state.fail(op, Object.assign(new Error('network unavailable'), { code }), { retryable: true });
    h.cloud.apply = async operation => { h.calls.push(structuredClone(operation)); throw Object.assign(new Error('network unavailable'), { code: 'FETCH' }); };
    await h.engine.push(); assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].idempotencyKey, original.idempotencyKey); assert.deepEqual(h.calls[0].payload, original.payload);
  });
}

test('details-only Yield waits for a blocked parent and preserves its pending request', async () => {
  const h = fixture(); const parent = h.state.enqueue({ table: 'tasks', localId: h.task.id, type: 'create', payload: toCloud('tasks', h.task, h.state) });
  parent.status = 'blocked'; const op = h.enqueue(); delete op.payload.task_id;
  await h.engine.push(); assert.equal(h.calls.length, 0); assert.equal(op.status, 'dependency'); assert.deepEqual(op.blockedBy, [parent.id]);
});

test('a repaired Yield rejection is retried at most once and remains safely queued', async () => {
  const h = fixture(), op = h.enqueue(); h.adopt();
  h.cloud.apply = async operation => { h.calls.push(structuredClone(operation)); throw Object.assign(new Error('Task belongs to another Homestead'), { code: '23503' }); };
  await h.engine.push(); assert.equal(h.calls.length, 2); assert.equal(op.status, 'blocked'); assert.equal(op.attempts, 2);
});

test('failed durable repair flush prevents changed request from reaching cloud', async () => {
  const h = fixture(), op = h.enqueue(); h.adopt();
  h.state.fail(op, Object.assign(new Error('Task belongs to another Homestead'), { code: '23503' }));
  h.storage.flush = async () => { throw new Error('Synthetic disk failure'); };
  await assert.rejects(h.engine.push({ retryBlocked: true }), /Synthetic disk failure/); assert.equal(h.calls.length, 0);
});

test('Task identity history is bounded and excludes foreign or deleted adoption evidence', () => {
  const h = fixture(), entity = h.state.entity('tasks', h.task.id);
  for (let i = 0; i < 12; i++) { const op = h.state.enqueue({ table: 'tasks', localId: h.task.id, type: 'create', payload: {} }); h.state.complete(op, { ...h.row, id: crypto.randomUUID() }); }
  assert.equal(entity.previousCloudIds.length, 8);
  const prior = [...entity.previousCloudIds];
  for (const row of [{ ...h.row, id: crypto.randomUUID(), homestead_id: crypto.randomUUID() }, { ...h.row, id: crypto.randomUUID(), deleted_at: time }]) {
    const op = h.state.enqueue({ table: 'tasks', localId: h.task.id, type: 'create', payload: {} }); h.state.complete(op, row);
  }
  assert.deepEqual(entity.previousCloudIds, prior);
});
