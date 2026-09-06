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
  assert.equal(projection.nextId, 'event:Soccer');
  assert.equal(projection.currentId, 'event:Mass');
  assert.deepEqual(projection.pastIds, ['window:morning']);
});

test('Today progress and current/next state use completed work and deterministic time', () => {
  const taskList = [
    task('morning-done', { choreWindowId: 'morning', dueDate: workDate, completed: true, status: 'completed' }),
    task('evening-open', { choreWindowId: 'evening', dueDate: workDate })
  ];
  const beforeEvening = housekeeping.dailyPlannerProjection({ workDate, now: new Date(2026, 7, 30, 17, 30), choreWindows: windows, tasks: taskList, includeCompleted: true });
  assert.equal(beforeEvening.windowItems.find(item => item.window.id === 'morning').completed, 1);
  assert.equal(beforeEvening.nextId, 'window:evening');
  assert.ok(beforeEvening.pastIds.includes('window:morning'));
  const duringEvening = housekeeping.dailyPlannerProjection({ workDate, now: new Date(2026, 7, 30, 18, 30), choreWindows: windows, tasks: taskList, includeCompleted: true });
  assert.equal(duringEvening.currentId, 'window:evening');
  assert.equal(duringEvening.nextId, null);
});

test('Today next state ignores empty Chore Windows', () => {
  const projection = housekeeping.dailyPlannerProjection({ workDate, now, choreWindows: windows, tasks: [] });
  assert.equal(projection.currentId, null);
  assert.equal(projection.nextId, null);
});

test('Today next state ignores a fully completed upcoming Chore Window', () => {
  const completed = task('evening-done', { choreWindowId: 'evening', dueDate: workDate, completed: true, status: 'completed' });
  const projection = housekeeping.dailyPlannerProjection({ workDate, now: new Date(2026, 7, 30, 17, 30), choreWindows: windows, tasks: [completed], includeCompleted: true });
  assert.equal(projection.nextId, null);
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

test('Today retains completed work from today without showing completed historical work', () => {
  const taskList = [
    task('today-done', { dueDate: workDate, completed: true, status: 'completed' }),
    task('old-done', { dueDate: '2026-08-20', completed: true, status: 'completed' })
  ];
  const projection = housekeeping.dailyPlannerProjection({ workDate, now, choreWindows: windows, tasks: taskList, includeCompleted: true });
  assert.deepEqual(projection.otherWork.map(item => item.id), ['today-done']);
});

test('undated Chore Window work appears today without repeating across other dates', () => {
  const undated = task('custom-task-2', { choreWindowId: 'evening' });
  const todayProjection = housekeeping.dailyPlannerProjection({ workDate, now, choreWindows: windows, tasks: [undated] });
  const futureProjection = housekeeping.calendarDaySummary({ workDate: '2026-08-31', now, choreWindows: windows, tasks: [undated] });
  assert.deepEqual(todayProjection.windowItems.find(item => item.window.id === 'evening').tasks.map(item => item.id), ['custom-task-2']);
  assert.equal(todayProjection.otherWork.length, 0);
  assert.equal(futureProjection.choreCount, 0);
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

test('Needs Attention excludes skipped, deleted, and disabled recurring history', () => {
  const taskList = [
    task('actionable', { dueDate: '2026-08-29' }),
    task('skipped', { dueDate: '2026-08-28', status: 'skipped', deletedAt: '2026-08-28T12:00:00Z' }),
    task('deleted-series', { dueDate: '2026-08-27', recurrenceRule: { frequency: 'daily', seriesDeleted: true } }),
    task('disabled-series', { dueDate: '2026-08-26', recurrenceRule: { frequency: 'daily', enabled: false } })
  ];
  const projection = housekeeping.dailyPlannerProjection({ workDate, now, choreWindows: windows, tasks: taskList });
  assert.deepEqual(projection.needsAttention.map(group => group.task.id), ['actionable']);
});

test('all-day Events stay above the timeline and are not duplicated', () => {
  const allDay = event('County Fair', { allDay: true, startTime: '' });
  const projection = housekeeping.dailyPlannerProjection({ workDate, now, choreWindows: [], calendarEvents: [allDay] });
  assert.deepEqual(projection.allDayEvents.map(item => item.id), ['County Fair']);
  assert.equal(projection.schedule.length, 0);
  assert.equal(projection.eventCount, 1);
});

test('recurring Events project onto daily, weekly, and clamped monthly dates', () => {
  const daily = event('Feed store', { startDate: '2026-08-30', endDate: '2026-08-30', recurrenceRule: { frequency: 'daily', interval: 2, until: '2026-09-05' } });
  const weekly = event('Farmers market', { startDate: '2026-08-30', endDate: '2026-08-31', recurrenceRule: { frequency: 'weekly', interval: 1 } });
  const monthly = event('Month end', { startDate: '2026-01-31', endDate: '2026-01-31', recurrenceRule: { frequency: 'monthly', interval: 1 } });
  assert.ok(housekeeping.calendarEventOccurrence(daily, '2026-09-05'));
  assert.equal(housekeeping.calendarEventOccurrence(daily, '2026-09-07'), null);
  assert.deepEqual(housekeeping.calendarEventOccurrence(weekly, '2026-09-07'), { starts: false, ends: true });
  assert.ok(housekeeping.calendarEventOccurrence(monthly, '2026-02-28'));
  assert.equal(housekeeping.calendarEventOccurrence(monthly, '2026-03-30'), null);
  assert.equal(housekeeping.dailyPlannerProjection({ workDate: '2026-09-06', now, calendarEvents: [weekly] }).eventCount, 1);
});

test('empty days and multiple custom Chore Windows remain valid projections', () => {
  const empty = housekeeping.dailyPlannerProjection({ workDate, now, choreWindows: [], tasks: [], calendarEvents: [] });
  assert.deepEqual(empty.schedule, []);
  assert.deepEqual(empty.otherWork, []);
  assert.deepEqual(empty.needsAttention, []);
  const custom = housekeeping.dailyPlannerProjection({ workDate, now: new Date(2026, 7, 30, 12, 30), choreWindows: windows, tasks: [] });
  assert.equal(custom.currentId, null);
  assert.deepEqual(custom.windowItems.map(item => item.window.id), ['morning', 'midday', 'evening']);
});

test('Calendar summaries count Chore Windows, Other Work, and Events without duplication', () => {
  const taskList = [
    task('morning-milk', { choreWindowId: 'morning', dueDate: workDate }),
    task('evening-eggs', { choreWindowId: 'evening', dueDate: workDate }),
    task('fence', { dueDate: workDate }),
    task('range-work', { availableFrom: '2026-08-29', dueDate: '2026-08-31' })
  ];
  const projection = housekeeping.calendarDaySummary({
    workDate, now, choreWindows: windows, tasks: taskList,
    calendarEvents: [event('Mass'), event('Fair', { allDay: true, startTime: '' })]
  });
  assert.equal(projection.choreCount, 2);
  assert.equal(projection.otherWorkCount, 2);
  assert.equal(projection.eventCount, 2);
  assert.equal(projection.totalLoad, 6);
  assert.equal(projection.workloadLevel, 3);
  assert.deepEqual(projection.otherWork.map(item => item.id), ['fence', 'range-work']);
  assert.equal(projection.otherWork.some(item => item.id === 'morning-milk'), false);
  assert.deepEqual(projection.schedule.map(item => item.type === 'window' ? item.window.name : item.event.title), [
    'Morning Chores', 'Mass', 'Midday Check', 'Evening Chores'
  ]);
});

test('Calendar workload intensity includes every visible category', () => {
  assert.equal(housekeeping.calendarWorkloadLevel(0), 0);
  assert.equal(housekeeping.calendarWorkloadLevel(2), 1);
  assert.equal(housekeeping.calendarWorkloadLevel(4), 2);
  assert.equal(housekeeping.calendarWorkloadLevel(6), 3);
  assert.equal(housekeeping.calendarWorkloadLevel(9), 4);
  assert.equal(housekeeping.calendarWorkloadLevel(10), 5);
  const choresOnly = housekeeping.calendarDaySummary({ workDate, now, choreWindows: windows, tasks: [task('milk', { choreWindowId: 'morning', dueDate: workDate })] });
  const otherOnly = housekeeping.calendarDaySummary({ workDate, now, choreWindows: windows, tasks: [task('fence', { dueDate: workDate })] });
  const eventsOnly = housekeeping.calendarDaySummary({ workDate, now, choreWindows: windows, calendarEvents: [event('Mass')] });
  assert.equal(choresOnly.totalLoad, 1);
  assert.equal(otherOnly.totalLoad, 1);
  assert.equal(eventsOnly.totalLoad, 1);
});

test('Week and Month cells share selected-date Day navigation without event dots', async () => {
  const [app, css] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../housekeeping.css', import.meta.url), 'utf8')
  ]);
  assert.match(app, /function openCalendarDay\(date\)[\s\S]*calendarMonth = new Date\(date\)/);
  assert.match(app, /renderCalendarWeek[\s\S]*cell\.addEventListener\('click', \(\) => openCalendarDay\(date\)\)/);
  assert.match(app, /renderCalendarMonth[\s\S]*cell\.addEventListener\('click', \(\) => openCalendarDay\(date\)\)/);
  assert.match(app, /calendarView = input\.value; renderCalendar\(\)/);
  assert.match(app, /let calendarMonth = new Date\(\);/);
  assert.match(app, /No other work for this day\./);
  assert.match(app, /<em>other work<\/em>/);
  assert.match(app, /calendar-other-summary[\s\S]*projection\.otherWorkCount/);
  assert.doesNotMatch(app, /eventdot|event-dot/);
  assert.match(css, /\.calendar-month-day\.workload-5/);
});

test('Today reuses Task completion and Yield-linked Task presentation paths', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /item\.tasks[\s\S]*calendarCompactTaskRow\(task\)/);
  assert.match(app, /calendar-task-meta/);
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
