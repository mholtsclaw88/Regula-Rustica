import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import housekeeping from '../housekeeping-data.js';
import tasksApi from '../task-foundation.js';

const workDate = '2026-08-30';
const now = new Date(2026, 7, 30, 11, 0, 0);
const windows = [
  { id: 'morning', name: 'Morning Chores', startTime: '06:00', endTime: '09:00', displayOrder: 10, enabled: true },
  { id: 'midday', name: 'Midday Check', startTime: '12:00', endTime: '13:00', displayOrder: 15, enabled: true },
  { id: 'evening', name: 'Evening Chores', startTime: '18:00', endTime: '20:00', displayOrder: 20, enabled: true }
];
const task = (id, values = {}) => ({
  id, title: id, priority: 'normal', completed: false, status: 'open', createdAt: `2026-08-30T00:00:0${id.length}Z`, deletedAt: null, ...values
});
const event = (id, values = {}) => ({
  id, title: id, startDate: workDate, endDate: workDate, allDay: false, startTime: '10:30', endTime: '11:30', deletedAt: null, ...values
});

test('new and edited Chore Windows require a valid start and end time', () => {
  assert.deepEqual(tasksApi.validateWindowTimes('', ''), { valid: false, message: 'Enter both a start time and an end time.' });
  assert.equal(tasksApi.validateWindowTimes('06:00', '').valid, false);
  assert.equal(tasksApi.validateWindowTimes('18:00', '06:00').valid, false);
  assert.equal(tasksApi.validateWindowTimes('06:00', '09:00').valid, true);
});

test('legacy Chore Windows without complete times normalize conservatively', () => {
  const morning = tasksApi.normalizeWindow({ id: 'old-morning', name: 'Morning Round', startTime: '', endTime: '' });
  const evening = tasksApi.normalizeWindow({ id: 'old-evening', daypart: 'evening', startTime: '', endTime: '' });
  const partial = tasksApi.normalizeWindow({ id: 'old-custom', name: 'Afternoon Check', startTime: '14:00', endTime: '' });
  const unknown = tasksApi.normalizeWindow({ id: 'old-unknown', name: 'Custom', startTime: '', endTime: '' });
  assert.deepEqual([morning.startTime, morning.endTime], ['06:00', '10:00']);
  assert.deepEqual([evening.startTime, evening.endTime], ['18:00', '22:00']);
  assert.deepEqual([partial.startTime, partial.endTime], ['14:00', '18:00']);
  assert.deepEqual([unknown.startTime, unknown.endTime], ['12:00', '13:00']);
});

test('Chore Windows and timed Events form one chronological schedule', () => {
  const projection = housekeeping.dailyPlannerProjection({
    workDate, now, choreWindows: windows, tasks: [],
    calendarEvents: [event('Mass'), event('Soccer', { startTime: '15:30', endTime: '17:00' })]
  });
  assert.deepEqual(projection.schedule.map(item => item.type === 'window' ? item.window.name : item.event.title), [
    'Morning Chores', 'Mass', 'Midday Check', 'Soccer', 'Evening Chores'
  ]);
  assert.equal(projection.nextId, 'window:midday');
});

test('Chore Window Tasks never duplicate under Other Work and general work is priority sorted', () => {
  const taskList = [
    task('window-task', { choreWindowId: 'midday', dueDate: workDate }),
    task('low', { priority: 'low', dueDate: workDate }),
    task('urgent', { priority: 'urgent', dueDate: workDate }),
    task('future', { priority: 'urgent', availableFrom: '2026-09-01' })
  ];
  const projection = housekeeping.dailyPlannerProjection({ workDate, now, choreWindows: windows, tasks: taskList });
  assert.deepEqual(projection.otherWork.map(item => item.id), ['urgent', 'low']);
  assert.equal(projection.windowItems.find(item => item.window.id === 'midday').tasks[0].id, 'window-task');
});

test('Needs Attention deduplicates presentation without modifying recurrence history', () => {
  const taskList = [
    task('old-1', { title: 'Morning Milking', recordId: 'daisy', choreWindowId: 'morning', dueDate: '2026-08-12', recurrenceRule: { frequency: 'daily', seriesId: 'milk-series' } }),
    task('old-2', { title: 'Morning Milking', recordId: 'daisy', choreWindowId: 'morning', dueDate: '2026-08-24', recurrenceRule: { frequency: 'daily', seriesId: 'milk-series' } }),
    task('fence', { title: 'Repair fence', dueDate: '2026-08-29' })
  ];
  const before = structuredClone(taskList);
  const projection = housekeeping.dailyPlannerProjection({ workDate, now, choreWindows: windows, tasks: taskList });
  assert.equal(projection.overdueOccurrenceCount, 3);
  assert.equal(projection.needsAttention.length, 2);
  assert.equal(projection.needsAttention.find(group => group.task.title === 'Morning Milking').count, 2);
  assert.deepEqual(taskList, before);
});

test('all-day Events stay above the timeline and are not duplicated', () => {
  const allDay = event('County Fair', { allDay: true, startTime: '' });
  const projection = housekeeping.dailyPlannerProjection({ workDate, now, choreWindows: [], calendarEvents: [allDay] });
  assert.deepEqual(projection.allDayEvents.map(item => item.id), ['County Fair']);
  assert.equal(projection.schedule.length, 0);
  assert.equal(projection.eventCount, 1);
});

test('empty days and multiple custom Chore Windows remain valid projections', () => {
  const empty = housekeeping.dailyPlannerProjection({ workDate, now, choreWindows: [], tasks: [], calendarEvents: [] });
  assert.deepEqual(empty.schedule, []);
  assert.deepEqual(empty.otherWork, []);
  assert.deepEqual(empty.needsAttention, []);
  const custom = housekeeping.dailyPlannerProjection({ workDate, now: new Date(2026, 7, 30, 12, 30), choreWindows: windows, tasks: [] });
  assert.equal(custom.currentId, 'window:midday');
  assert.deepEqual(custom.windowItems.map(item => item.window.id), ['morning', 'midday', 'evening']);
});

test('Today reuses Task completion and Yield-linked Task presentation paths', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /item\.tasks[\s\S]*taskRow\(task\)/);
  assert.match(app, /shared-task-check[\s\S]*openTaskYield\(task\)/);
  assert.match(app, /matchingYieldForTask\(data\.yieldEntries, task\)/);
});

test('header sync status derives all five states and links to existing Cloud settings', async () => {
  const [html, runtime] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../sync/runtime.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(html, /id="headerSyncStatus"/);
  ['synced', 'syncing', 'issue', 'offline', 'local'].forEach(state => assert.match(runtime, new RegExp(`state: '${state}'`)));
  assert.match(runtime, /renderHeaderStatus\(kind\)/);
  assert.match(runtime, /!state\.state\.initialSyncCompleted[\s\S]*label: 'Sync setup'/);
  assert.match(runtime, /data-settings-category="cloud"/);
  assert.match(runtime, /regula-rustica:sync-status/);
});
