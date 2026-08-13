import assert from 'node:assert/strict';
import test from 'node:test';
import routines from '../routines-data.js';

test('completion advances one occurrence and is idempotent', () => {
  const routine = routines.normalizeRoutine({ id: 'r1', recordId: 'daisy', name: 'Morning Milking', routineType: 'milk_morning', frequency: 'daily', interval: 1, firstDate: '2026-08-12', nextDate: '2026-08-12' });
  const occurrence = routines.normalizeOccurrence({ id: 'o1', routineId: 'r1', occurrenceDate: '2026-08-12' });
  const occurrences = [occurrence];
  routines.completeOccurrence(routine, occurrence, 'ordinary', '2026-08-12T12:00:00Z', () => 'o2', occurrences);
  routines.completeOccurrence(routine, occurrence, 'ordinary', '2026-08-12T12:00:00Z', () => 'o3', occurrences);
  assert.equal(occurrence.status, 'completed');
  assert.equal(routine.nextDate, '2026-08-13');
  assert.deepEqual(occurrences.map(item => item.id), ['o1', 'o2']);
});

test('yield matching requires record, type, date, and session', () => {
  const routine = { recordId: 'daisy', routineType: 'milk_morning' };
  const occurrence = { occurrenceDate: '2026-08-12' };
  const correct = { id: 'y1', recordId: 'daisy', type: 'milk', session: 'morning', occurredAt: '2026-08-12T11:00:00Z' };
  assert.equal(routines.matchingYield(routine, occurrence, [correct]), correct);
  assert.equal(routines.matchingYield(routine, occurrence, [{ ...correct, session: 'evening' }]), null);
});

test('migration converts only explicitly structured Routine Tasks', () => {
  const source = {
    schemaVersion: 8,
    people: [{ id: 'person-1' }], assignments: [{ taskId: 'milk-1', personId: 'person-1' }],
    tasks: [
      { id: 'milk-1', recordId: 'daisy', title: 'Morning Milking', dueDate: '2026-08-12', status: 'open', completed: false, recurrenceRule: { frequency: 'daily', interval: 1, routineType: 'milk_morning' }, createdAt: '2026-08-01T00:00:00Z' },
      { id: 'ordinary', title: 'Sharpen tools', dueDate: '2026-08-12', recurrenceRule: { frequency: 'weekly', interval: 1 }, createdAt: '2026-08-01T00:00:00Z' }
    ],
    yieldEntries: [{ id: 'yield-1', taskId: 'milk-1' }]
  };
  const migrated = routines.migrateTaskBacked(source, { now: '2026-08-12T00:00:00Z' });
  assert.equal(migrated.routines.length, 1);
  assert.equal(migrated.routines[0].id, 'milk-1');
  assert.equal(migrated.routines[0].personId, 'person-1');
  assert.equal(migrated.occurrences[0].legacyTaskId, 'milk-1');
  assert.equal(source.tasks[0].routineMigrationId, 'milk-1');
  assert.equal(source.tasks[1].routineMigrationId, undefined);
  assert.equal(source.yieldEntries[0].routineOccurrenceId, 'milk-1');
});

test('suggestions stay conservative and record-specific', () => {
  assert.deepEqual(routines.suggestedTypes({ type: 'Animal', status: 'Active', identity: { purpose: 'Dairy' } }), ['milk_morning', 'milk_evening']);
  assert.deepEqual(routines.suggestedTypes({ type: 'Animal', status: 'Active', identity: { purpose: 'Eggs' } }), ['egg_collection']);
  assert.deepEqual(routines.suggestedTypes({ type: 'Equipment', status: 'Active', identity: {} }), []);
});
