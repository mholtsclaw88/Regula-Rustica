import test from 'node:test';
import assert from 'node:assert/strict';
import tasks from '../task-foundation.js';
import housekeeping from '../housekeeping-data.js';
import { toCloud, fromCloud } from '../sync/entities.mjs';

const rule = (seriesId, enabled = true) => ({ frequency: 'daily', interval: 1, mode: 'fixed_schedule', seriesId, enabled });
const occurrence = (overrides = {}) => ({
  id: overrides.id || 'task-1',
  recordId: 'record-1',
  title: 'Morning milking',
  dueDate: '2026-08-18',
  availableFrom: '',
  recurrenceRule: rule('series-1'),
  suggestionKey: 'dairy-milk-morning',
  choreWindowId: 'morning',
  completed: false,
  status: 'open',
  createdAt: '2026-08-18T10:00:00Z',
  updatedAt: '2026-08-18T10:00:00Z',
  deletedAt: null,
  ...overrides
});

test('Morning, Evening, and Egg suggestions remain enabled after completion', () => {
  for (const [key, seriesId] of [['dairy-milk-morning', 'morning'], ['dairy-milk-evening', 'evening'], ['laying-collect-eggs', 'eggs']]) {
    const completed = occurrence({ id: seriesId, suggestionKey: key, recurrenceRule: rule(seriesId), completed: true, status: 'completed' });
    assert.equal(tasks.suggestionEnabled([completed], 'record-1', key), true);
  }
});

test('fixed recurrence materializes today without moving an overdue occurrence', () => {
  const list = [occurrence()];
  const result = tasks.stabilizeRecurringTasks(list, {
    targetDate: '2026-08-19',
    nextDueDate: housekeeping.nextRecurringDueDate,
    makeId: () => 'task-2',
    now: '2026-08-19T10:00:00Z'
  });
  assert.equal(result.created, 1);
  assert.deepEqual(list.map(task => task.dueDate), ['2026-08-18', '2026-08-19']);
  assert.equal(list[0].completed, false);
  assert.equal(list[1].parentTaskId, 'task-1');
});

test('fixed recurrence skips an accumulated backlog and creates only the current scheduled occurrence', () => {
  const list = [occurrence({ dueDate: '2026-08-01' })];
  const result = tasks.stabilizeRecurringTasks(list, {
    targetDate: '2026-08-19',
    nextDueDate: housekeeping.nextRecurringDueDate,
    makeId: () => 'task-current',
    now: '2026-08-19T10:00:00Z'
  });
  assert.equal(result.created, 1);
  assert.deepEqual(list.map(task => task.dueDate), ['2026-08-01', '2026-08-19']);
});

test('materialization is idempotent for the same series and date', () => {
  const list = [occurrence(), occurrence({ id: 'duplicate', dueDate: '2026-08-18', createdAt: '2026-08-18T11:00:00Z' })];
  const options = { targetDate: '2026-08-19', nextDueDate: housekeeping.nextRecurringDueDate, makeId: () => 'task-2', now: '2026-08-19T10:00:00Z' };
  tasks.stabilizeRecurringTasks(list, options);
  tasks.stabilizeRecurringTasks(list, { ...options, makeId: () => 'should-not-exist' });
  assert.equal(list.filter(task => !task.deletedAt && task.dueDate === '2026-08-18').length, 1);
  assert.equal(list.filter(task => !task.deletedAt && task.dueDate === '2026-08-19').length, 1);
});

test('Disable and re-enable preserve one Suggested Task series', () => {
  const list = [occurrence(), occurrence({ id: 'task-2', dueDate: '2026-08-19', parentTaskId: 'task-1' })];
  const anchor = tasks.disableSuggestedSeries(list, list[0], '2026-08-19T12:00:00Z');
  assert.equal(tasks.suggestionEnabled(list, 'record-1', 'dairy-milk-morning'), false);
  assert.equal(list.filter(task => !task.deletedAt && !task.completed && task.recurrenceRule.enabled !== false).length, 0);
  const restored = tasks.reactivateSuggestedTask(list, 'record-1', 'dairy-milk-morning', { dueDate: '2026-08-20', recurrenceRule: rule('series-1'), updatedAt: '2026-08-20T10:00:00Z' });
  assert.equal(restored.id, anchor.id);
  assert.equal(tasks.suggestionEnabled(list, 'record-1', 'dairy-milk-morning'), true);
  assert.equal(new Set(list.map(task => task.recurrenceRule.seriesId)).size, 1);
});

test('Chore Window overdue classification separates prior and current occurrences', () => {
  const window = { id: 'morning', startTime: '06:00', endTime: '10:00' };
  const beforeEnd = new Date('2026-08-19T09:30:00');
  const afterEnd = new Date('2026-08-19T10:30:00');
  const prior = occurrence();
  const current = occurrence({ id: 'task-2', dueDate: '2026-08-19' });
  assert.equal(housekeeping.taskInCurrentChoreWindow(current, window, beforeEnd), true);
  assert.equal(housekeeping.taskIsOverdue(current, window, beforeEnd), false);
  assert.equal(housekeeping.taskInCurrentChoreWindow(current, window, afterEnd), false);
  assert.equal(housekeeping.taskIsOverdue(current, window, afterEnd), true);
  assert.equal(housekeeping.taskInCurrentChoreWindow(prior, window, beforeEnd), false);
  assert.equal(housekeeping.taskIsOverdue(prior, window, beforeEnd), true);
});

test('Chore Window without endTime uses end of day', () => {
  const current = occurrence({ dueDate: '2026-08-19' });
  assert.equal(housekeeping.taskIsOverdue(current, { id: 'morning' }, new Date('2026-08-19T23:59:00')), false);
  assert.equal(housekeeping.taskIsOverdue(current, { id: 'morning' }, new Date('2026-08-20T00:00:00')), true);
});

test('Yield defaults use the original occurrence date and Chore Window session/time', () => {
  const windows = [
    { id: 'morning', daypart: 'morning', startTime: '06:00', endTime: '10:00' },
    { id: 'evening', daypart: 'evening', startTime: '18:00', endTime: '22:00' }
  ];
  assert.deepEqual(housekeeping.yieldDefaultsForTask(occurrence(), windows), { date: '2026-08-18', session: 'morning', time: '06:00' });
  assert.deepEqual(housekeeping.yieldDefaultsForTask(occurrence({ choreWindowId: 'evening' }), windows), { date: '2026-08-18', session: 'evening', time: '18:00' });
  assert.deepEqual(housekeeping.yieldDefaultsForTask(occurrence({ choreWindowId: null }), windows), { date: '2026-08-18', session: null, time: null });
});

test('built-in Chore Windows receive safe daily defaults', () => {
  const [morning, evening] = tasks.DEFAULT_WINDOWS.map(tasks.normalizeWindow);
  assert.deepEqual([morning.startTime, morning.endTime], ['06:00', '10:00']);
  assert.deepEqual([evening.startTime, evening.endTime], ['18:00', '22:00']);
  assert.match(tasks.formatClockTime(morning.startTime, 'en-US'), /6:00 AM/);
  assert.match(tasks.formatClockTime(evening.startTime, 'en-US'), /6:00 PM/);
});

test('built-in default migration corrects blank and noon times but preserves intentional values', () => {
  const blankMorning = tasks.normalizeWindow({ id: 'morning', systemKey: 'morning', startTime: '', endTime: '' });
  const noonEvening = tasks.normalizeWindow({ id: 'evening', systemKey: 'evening', startTime: '12:00', endTime: '12:00' });
  const customMorning = tasks.normalizeWindow({ id: 'custom-morning', systemKey: 'morning', startTime: '05:30', endTime: '09:15' });
  const customWindow = tasks.normalizeWindow({ id: 'lunch', systemKey: null, startTime: '12:00', endTime: '13:00' });
  assert.deepEqual([blankMorning.startTime, blankMorning.endTime], ['06:00', '10:00']);
  assert.deepEqual([noonEvening.startTime, noonEvening.endTime], ['18:00', '22:00']);
  assert.deepEqual([customMorning.startTime, customMorning.endTime], ['05:30', '09:15']);
  assert.deepEqual([customWindow.startTime, customWindow.endTime], ['12:00', '13:00']);
});

test('Chore Window times round-trip through sync mapping', () => {
  const state = {
    entity: (_table, id) => ({ cloudId: id }),
    localIdForCloud: (_table, id) => id
  };
  const cloud = toCloud('chore_windows', { id: 'morning', name: 'Morning', displayOrder: 10, enabled: true, daypart: 'morning', startTime: '06:00', endTime: '09:00' }, state);
  assert.equal(cloud.start_time, '06:00');
  assert.equal(cloud.end_time, '09:00');
  const local = fromCloud('chore_windows', { id: 'morning', name: 'Morning', display_order: 10, enabled: true, daypart: 'morning', start_time: '06:00', end_time: '09:00', created_at: '2026-08-19T10:00:00Z', updated_at: '2026-08-19T10:00:00Z' }, state);
  assert.equal(local.startTime, '06:00');
  assert.equal(local.endTime, '09:00');
});
