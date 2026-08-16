import assert from 'node:assert/strict';
import test from 'node:test';
import stabilization from '../routine-stabilization.js';

const now = '2026-08-16T12:00:00Z';
const makeIds = (...ids) => () => ids.shift();

function baseData() {
  return {
    choreWindows: [
      { id: 'morning', systemKey: 'morning', name: 'Morning', enabled: true, createdAt: '2026-08-01T00:00:00Z' },
      { id: 'evening', systemKey: 'evening', name: 'Evening', enabled: true, createdAt: '2026-08-01T00:00:00Z' }
    ],
    routines: [],
    routineOccurrences: []
  };
}

test('duplicate structured routines collapse to one active canonical routine', () => {
  const data = baseData();
  data.routines = [
    { id: 'r-old', recordId: 'cow', routineType: 'milk_morning', name: 'Morning Milking', enabled: true, frequency: 'daily', interval: 1, firstDate: '2026-08-10', nextDate: '2026-08-16', choreWindowId: 'morning', createdAt: '2026-08-10T00:00:00Z' },
    { id: 'r-new', recordId: 'cow', routineType: 'milk_morning', name: 'Morning Milking', enabled: true, frequency: 'daily', interval: 1, firstDate: '2026-08-10', nextDate: '2026-08-16', choreWindowId: 'morning', createdAt: '2026-08-12T00:00:00Z' }
  ];
  data.routineOccurrences = [
    { id: 'old-occurrence', routineId: 'r-old', occurrenceDate: '2026-08-15', status: 'pending' }
  ];

  const result = stabilization.stabilizeData(data, { now, date: '2026-08-16', makeId: makeIds('today') });
  assert.equal(result.duplicateRoutines, 1);
  assert.equal(data.routines.filter(item => !item.deletedAt).length, 1);
  assert.equal(data.routines.find(item => !item.deletedAt).id, 'r-old');
  assert.equal(data.routines.find(item => item.id === 'r-new').enabled, false);
});

test('duplicate system Chore Windows collapse and linked routines are remapped', () => {
  const data = baseData();
  data.choreWindows.push({ id: 'morning-duplicate', systemKey: 'morning', name: 'Morning', enabled: true, createdAt: '2026-08-12T00:00:00Z' });
  data.routines = [
    { id: 'r1', recordId: 'hens', routineType: 'egg_collection', name: 'Egg Collection', enabled: true, frequency: 'daily', interval: 1, firstDate: '2026-08-16', nextDate: '2026-08-16', choreWindowId: 'morning-duplicate', createdAt: '2026-08-12T00:00:00Z' }
  ];

  const result = stabilization.stabilizeData(data, { now, date: '2026-08-16', makeId: makeIds('today') });
  assert.equal(result.duplicateWindows, 1);
  assert.equal(data.choreWindows.filter(item => !item.deletedAt && item.systemKey === 'morning').length, 1);
  assert.equal(data.routines[0].choreWindowId, 'morning-duplicate');
});

test('stale pending occurrence rolls over as missed and only today remains pending', () => {
  const data = baseData();
  data.routines = [
    { id: 'r1', recordId: 'cow', routineType: 'milk_morning', name: 'Morning Milking', enabled: true, frequency: 'daily', interval: 1, firstDate: '2026-08-10', nextDate: '2026-08-15', choreWindowId: 'morning', createdAt: '2026-08-10T00:00:00Z' }
  ];
  data.routineOccurrences = [
    { id: 'yesterday', routineId: 'r1', occurrenceDate: '2026-08-15', status: 'pending', createdAt: '2026-08-15T00:00:00Z' }
  ];

  const result = stabilization.stabilizeData(data, { now, date: '2026-08-16', makeId: makeIds('today') });
  assert.equal(result.rolloverCount, 1);
  assert.equal(data.routineOccurrences.find(item => item.id === 'yesterday').status, 'skipped');
  assert.equal(data.routineOccurrences.find(item => item.id === 'yesterday').completionMethod, 'rollover');
  assert.equal(data.routineOccurrences.filter(item => item.status === 'pending').length, 1);
  assert.equal(data.routineOccurrences.find(item => item.status === 'pending').occurrenceDate, '2026-08-16');
});

test('an every-other-day Routine does not create work on an off day', () => {
  const data = baseData();
  data.routines = [
    { id: 'r1', recordId: 'pasture', name: 'Fence check', enabled: true, frequency: 'daily', interval: 2, firstDate: '2026-08-15', nextDate: '2026-08-15', choreWindowId: 'morning', createdAt: '2026-08-15T00:00:00Z' }
  ];
  data.routineOccurrences = [
    { id: 'old', routineId: 'r1', occurrenceDate: '2026-08-15', status: 'pending', createdAt: '2026-08-15T00:00:00Z' }
  ];

  stabilization.stabilizeData(data, { now, date: '2026-08-16', makeId: makeIds('should-not-be-used') });
  assert.equal(data.routineOccurrences.filter(item => item.status === 'pending').length, 0);
  assert.equal(data.routines[0].nextDate, '2026-08-17');
});

test('stabilization is idempotent for the current day', () => {
  const data = baseData();
  data.routines = [
    { id: 'r1', recordId: 'hens', routineType: 'egg_collection', name: 'Egg Collection', enabled: true, frequency: 'daily', interval: 1, firstDate: '2026-08-16', nextDate: '2026-08-16', choreWindowId: 'morning', createdAt: '2026-08-16T00:00:00Z' }
  ];

  const first = stabilization.stabilizeData(data, { now, date: '2026-08-16', makeId: makeIds('today') });
  const second = stabilization.stabilizeData(data, { now, date: '2026-08-16', makeId: makeIds('duplicate') });
  assert.equal(first.createdOccurrences, 1);
  assert.equal(second.createdOccurrences, 0);
  assert.equal(data.routineOccurrences.filter(item => !item.deletedAt && item.occurrenceDate === '2026-08-16').length, 1);
});
