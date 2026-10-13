import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import housekeeping from '../housekeeping-data.js';
import tasks from '../task-foundation.js';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const task = (date, overrides = {}) => ({
  id: date, title: 'Morning milking', recordId: 'cow', yieldType: 'milk', dueDate: date,
  choreWindowId: 'morning', completed: false, status: 'open', deletedAt: null,
  recurrenceRule: { seriesId: 'milk-series', frequency: 'daily', mode: 'fixed_schedule', enabled: true, interval: 1 },
  ...overrides
});
const entry = (taskId, overrides = {}) => ({
  id: `yield-${taskId}`, taskId, recordId: 'cow', type: 'milk', occurredAt: `${taskId}T06:00:00`,
  session: 'morning', quantity: 2, unit: 'gal', deletedAt: null, ...overrides
});
const projection = taskList => housekeeping.dailyPlannerProjection({
  tasks: taskList, choreWindows: [{ id: 'morning', enabled: true, startTime: '06:00', endTime: '10:00' }],
  workDate: '2026-10-12', now: new Date(2026, 9, 12, 12)
});

function workflow(taskList, yieldEntries = []) {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      textContent: '', open: true, dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, handler) { this[type] = handler; },
      close() { this.open = false; }
    });
    return elements.get(selector);
  };
  const context = vm.createContext({
    $, console, Date, Number, Object, structuredClone,
    FormData: class { constructor(target) { return Object.entries(target.values); } },
    window: { RegulaRusticaHousekeeping: housekeeping, RegulaRusticaTasks: tasks, RegulaRusticaSync: { isInitialized: () => true } },
    data: { tasks: structuredClone(taskList), yieldEntries: structuredClone(yieldEntries), records: [{ id: 'cow', type: 'Animal', status: 'Active', identity: { purpose: 'Dairy' } }] },
    modalMode: 'yield', editId: null, yieldCompletionTaskId: taskList[0]?.id,
    INACTIVE_RECORD_STATUSES: new Set(['Archived']), alerts: [], saved: null, saveCount: 0,
    alert(message) { context.alerts.push(message); },
    nowIso: () => '2026-10-12T16:00:00.000Z', today: () => '2026-10-12', formatDate: date => date,
    uid: () => 'new-yield', addEvent() {}, normalizeYieldEntry: value => ({ ...value, deletedAt: null }),
    recordById: id => context.data.records.find(record => record.id === id),
    chooseMatchingYieldTask: () => null,
    saveData() { context.saved = JSON.stringify(context.data); context.data = JSON.parse(context.saved); context.saveCount++; }
  });
  $('#modal');
  for (const name of ['completeTask', 'showTaskActionStatus', 'reopenTaskFromModal']) {
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  for (const marker of ["$('#modalForm').addEventListener('submit'", "$('#modalCompleteWithoutYield').addEventListener('click'"]) {
    const start = source.indexOf(marker);
    vm.runInContext(source.slice(start, source.indexOf('\n});', start) + 5), context);
  }
  return {
    context, elements,
    submit: (values = {}) => $('#modalForm').submit({ preventDefault() {}, target: { values: {
      recordId: 'cow', yieldType: 'milk', occurredAt: `${context.yieldCompletionTaskId}T06:00`,
      session: 'morning', quantity: '2', unit: 'gal', unusableQuantity: '0', details: '', ...values
    } } }),
    reopen: deleteYield => {
      context.modalMode = 'reopen-task'; context.editId = context.data.tasks[0].id;
      return deleteYield ? $('#modalCompleteWithoutYield').click() : $('#modalForm').submit({ preventDefault() {}, target: { values: {} } });
    }
  };
}

test('Needs Attention processes oldest missed dates even when stored in reverse order', () => {
  const list = ['2026-10-10', '2026-10-09', '2026-10-08'].map(date => task(date));
  for (const date of ['2026-10-08', '2026-10-09', '2026-10-10']) {
    const group = projection(list).needsAttention[0];
    assert.equal(group.task.dueDate, date);
    group.task.completed = true; group.task.status = 'completed';
  }
  assert.equal(projection(list).needsAttention.length, 0);
});

test('catching up old work does not chase newly generated occurrences', () => {
  const list = ['2026-10-08', '2026-10-09', '2026-10-10'].map(date => task(date));
  list.push(task('2026-10-11'));
  assert.equal(projection(list).needsAttention[0].task.dueDate, '2026-10-08');
  assert.equal(projection(list).needsAttention[0].count, 4);
});

test('the real save handler accepts matching missing Yield after sync completes the Task', async () => {
  const api = workflow([task('2026-10-08')]);
  api.context.data.tasks[0].completed = true;
  api.context.data.tasks[0].status = 'completed';
  await api.submit();
  assert.deepEqual(api.context.alerts, []);
  const saved = JSON.parse(api.context.saved);
  assert.equal(saved.yieldEntries[0].taskId, '2026-10-08');
  assert.equal(housekeeping.yieldMatchesTaskContext(saved.tasks[0], saved.yieldEntries[0]), true);
  assert.equal(housekeeping.matchingYieldTasks(saved.tasks, saved.yieldEntries[0]).length, 0);
  assert.equal(api.elements.get('#modal').open, false);
});

test('a concurrent recorded Yield is protected from duplicate Task-form submission', async () => {
  const api = workflow([task('2026-10-08', { completed: true, status: 'completed' })], [entry('2026-10-08')]);
  await api.submit();
  assert.match(api.context.alerts[0], /already been recorded/);
  assert.equal(api.context.saveCount, 0);
  assert.equal(api.context.data.yieldEntries.length, 1);
});

for (const [label, values] of [['wrong date', { occurredAt: '2026-10-09T06:00' }], ['wrong Record', { recordId: 'other-cow' }]]) {
  test(`save rejects ${label} without changing any data`, async () => {
    const api = workflow([task('2026-10-08')]);
    api.context.data.records.push({ ...api.context.data.records[0], id: 'other-cow' });
    const before = JSON.stringify(api.context.data);
    await api.submit(values);
    assert.ok(api.context.alerts.length);
    assert.equal(api.context.saveCount, 0);
    assert.equal(JSON.stringify(api.context.data), before);
  });
}

test('deleted Task form does not create an orphaned Yield', async () => {
  const api = workflow([task('2026-10-08', { deletedAt: '2026-10-12T15:00:00Z' })]);
  await api.submit();
  assert.match(api.context.alerts[0], /removed or replaced/);
  assert.equal(api.context.saveCount, 0);
});

for (const deleteYield of [true, false]) {
  test(`both reopen buttons save the Task, ${deleteYield ? 'delete' : 'preserve'} exact linked Yield, and confirm the result`, async () => {
    const api = workflow([task('2026-10-08', { completed: true, status: 'completed' })], [entry('2026-10-08'), entry('2026-10-09')]);
    await api.reopen(deleteYield);
    const saved = JSON.parse(api.context.saved);
    assert.equal(saved.tasks[0].completed, false);
    assert.equal(saved.tasks[0].status, 'open');
    assert.equal(saved.tasks[0].completedAt, null);
    assert.equal(Boolean(saved.yieldEntries[0].deletedAt), deleteYield);
    assert.equal(saved.yieldEntries[1].deletedAt, null);
    assert.equal(api.elements.get('#modal').open, false);
    assert.match(api.elements.get('#taskActionStatusText').textContent, /2026-10-08.*reopened/);
    assert.match(api.elements.get('#taskActionStatusText').textContent, /Saved on this device/);
  });
}

test('reopen of a removed Task reports the reason instead of silently closing', async () => {
  const api = workflow([task('2026-10-08', { completed: true, deletedAt: '2026-10-12T15:00:00Z' })]);
  await api.reopen(true);
  assert.match(api.context.alerts[0], /removed or replaced/);
  assert.equal(api.context.saveCount, 0);
  assert.equal(api.elements.get('#modal').open, true);
});
