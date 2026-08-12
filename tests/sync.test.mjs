import assert from 'node:assert/strict';
import test from 'node:test';
import { SyncEngine } from '../sync/engine.mjs';
import { LocalSyncState } from '../sync/local-state.mjs';
import { DOMAIN_ORDER, fromCloud, hasMeaningfulData, operationOrder, toCloud } from '../sync/entities.mjs';
import housekeepingData from '../housekeeping-data.js';

Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

class MemoryStorage {
  constructor(seed = {}) { this.values = new Map(Object.entries(seed)); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const blank = () => ({ schemaVersion: 8, settings: { homesteadName: 'Test' }, records: [], people: [], tasks: [], relationships: [], assignments: [], events: [], calendarEvents: [], yieldEntries: [], notes: [], ledger: [] });
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

test('recurrence normalization preserves explicit record Routine metadata', () => {
  assert.deepEqual(housekeepingData.normalizeRecurrenceRule({ frequency: 'daily', interval: 1, completionAction: 'milk_morning' }), {
    mode: 'fixed_schedule', frequency: 'daily', interval: 1, routineType: 'milk_morning'
  });
  assert.equal(housekeepingData.normalizeRecurrenceRule({ frequency: 'daily', routineType: 'guess_from_title' }).routineType, undefined);
  assert.equal(housekeepingData.normalizeRecurrenceRule({ frequency: 'daily', routineType: 'egg_collection' }).routineType, 'egg_collection');
});

test('Routine matching uses yield type, record, work date, session, and explicit metadata', () => {
  const configured = { id: 'morning', recordId: 'daisy', dueDate: '2026-08-10', status: 'open', completed: false, recurrenceRule: { frequency: 'daily', interval: 1, routineType: 'milk_morning' } };
  const eggCollection = { ...configured, id: 'eggs', recordId: 'layers', recurrenceRule: { frequency: 'daily', interval: 1, routineType: 'egg_collection' } };
  const titleOnly = { ...configured, id: 'title-only', recurrenceRule: { frequency: 'daily', interval: 1 }, title: 'Milk Daisy this morning' };
  const yieldEntry = { recordId: 'daisy', type: 'milk', session: 'morning', occurredAt: '2026-08-10T07:00:00' };
  const eggYield = { recordId: 'layers', type: 'eggs', session: 'other', occurredAt: '2026-08-10T12:00:00' };
  assert.deepEqual(housekeepingData.matchingRoutineTasks([configured, titleOnly], yieldEntry).map(task => task.id), ['morning']);
  assert.equal(housekeepingData.matchingRoutineTasks([configured], { ...yieldEntry, session: 'evening' }).length, 0);
  assert.deepEqual(housekeepingData.matchingRoutineTasks([eggCollection], eggYield).map(task => task.id), ['eggs']);
  assert.equal(housekeepingData.matchingRoutineTasks([eggCollection], { ...eggYield, type: 'milk' }).length, 0);
});

test('a task-linked yield reuses the task cloud identity and existing outbox', () => {
  const setup = harness();
  setup.state.bind(crypto.randomUUID());
  setup.state.state.initialSyncCompleted = true;
  const after = blank();
  after.records.push(record('daisy'));
  after.tasks.push({ id: 'milk-task', recordId: 'daisy', title: 'Barn round', status: 'completed', completed: true, dueDate: '2026-08-10', recurrenceRule: { frequency: 'daily', interval: 1, routineType: 'milk_morning' }, createdAt: '2026-08-10T00:00:00Z', updatedAt: '2026-08-10T11:00:00Z' });
  after.yieldEntries.push({ id: 'milk-task', taskId: 'milk-task', recordId: 'daisy', type: 'milk', session: 'morning', occurredAt: '2026-08-10T11:00:00Z', quantity: 2, unit: 'gal', unusableQuantity: 0, details: '', createdAt: '2026-08-10T11:00:00Z', updatedAt: '2026-08-10T11:00:00Z' });
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
  const task = { recordId: 'daisy', dueDate: '2026-08-10', recurrenceRule: { frequency: 'daily', routineType: 'milk_evening' } };
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

test('recurrence rules normalize supported schedules and reject unsupported ones', () => {
  assert.deepEqual(housekeepingData.normalizeRecurrenceRule({ frequency: 'weekly', mode: 'after_completion', interval: '2' }), {
    frequency: 'weekly', mode: 'after_completion', interval: 2
  });
  assert.deepEqual(housekeepingData.normalizeRecurrenceRule({ frequency: 'daily', interval: 0 }), {
    frequency: 'daily', mode: 'fixed_schedule', interval: 1
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

test('calendar view dates cover today, week, and the six-row month grid', () => {
  assert.deepEqual(housekeepingData.calendarViewDates('2026-08-11', 'today'), ['2026-08-11']);
  assert.deepEqual(housekeepingData.calendarViewDates('2026-08-11', 'week'), [
    '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15'
  ]);
  const month = housekeepingData.calendarViewDates('2026-08-11', 'month');
  assert.equal(month.length, 42);
  assert.equal(month[0], '2026-07-26');
  assert.equal(month[41], '2026-09-05');
});

test('calendar navigation advances by the active view without skipping dates', () => {
  assert.equal(housekeepingData.shiftCalendarFocus('2026-08-11', 'today', 1), '2026-08-12');
  assert.equal(housekeepingData.shiftCalendarFocus('2026-08-11', 'week', -1), '2026-08-04');
  assert.equal(housekeepingData.shiftCalendarFocus('2027-01-31', 'month', 1), '2027-02-28');
  assert.equal(housekeepingData.shiftCalendarFocus('2026-01-10', 'month', -1), '2025-12-10');
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
