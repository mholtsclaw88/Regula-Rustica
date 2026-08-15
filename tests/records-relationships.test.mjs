import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const relationships = require('../records-relationships.js');

const stamp = '2026-08-14T12:00:00.000Z';

function relation(overrides = {}) {
  return relationships.normalizeRelationship({
    id: crypto.randomUUID(), sourceRecordId: 'animal-1', targetRecordId: 'land-1',
    relationshipType: 'located_on', startedAt: stamp, createdAt: stamp, updatedAt: stamp, ...overrides
  });
}

test('current location is replaced rather than duplicated', () => {
  const rows = [relation()];
  relationships.replaceRelationship(rows, {
    sourceRecordId: 'animal-1', relationshipType: 'located_on', targetRecordId: 'structure-1',
    details: { purpose: 'current_location' }, timestamp: '2026-08-15T12:00:00.000Z'
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].endedAt, '2026-08-15T12:00:00.000Z');
  assert.equal(relationships.currentLocation(rows, 'animal-1').targetRecordId, 'structure-1');
});

test('clearing current location ends the active relationship', () => {
  const rows = [relation()];
  relationships.replaceRelationship(rows, {
    sourceRecordId: 'animal-1', relationshipType: 'located_on', targetRecordId: null,
    timestamp: '2026-08-15T12:00:00.000Z'
  });
  assert.equal(relationships.currentLocation(rows, 'animal-1'), null);
  assert.equal(rows[0].endedAt, '2026-08-15T12:00:00.000Z');
});

test('dam and sire are independently replaceable', () => {
  const rows = [];
  relationships.setParent(rows, 'calf-1', 'dam', 'cow-1', stamp);
  relationships.setParent(rows, 'calf-1', 'sire', 'bull-1', stamp);
  assert.deepEqual(relationships.parentsFor(rows, 'calf-1'), { dam: 'cow-1', sire: 'bull-1' });
  relationships.setParent(rows, 'calf-1', 'dam', 'cow-2', '2026-08-16T12:00:00.000Z');
  assert.deepEqual(relationships.parentsFor(rows, 'calf-1'), { dam: 'cow-2', sire: 'bull-1' });
});

test('reverse location contents derive animals and equipment only', () => {
  const records = [
    { id: 'animal-1', type: 'Animal', name: 'Cow' },
    { id: 'equipment-1', type: 'Equipment', name: 'Tractor' },
    { id: 'work-1', type: 'Work', name: 'Repair' }
  ];
  const rows = [
    relation(),
    relation({ id: crypto.randomUUID(), sourceRecordId: 'equipment-1' }),
    relation({ id: crypto.randomUUID(), sourceRecordId: 'work-1' })
  ];
  assert.deepEqual(
    relationships.reverseLocationContents(records, rows, 'land-1').map(record => record.id).sort(),
    ['animal-1', 'equipment-1']
  );
});

test('ended relationships are excluded from reverse views', () => {
  const records = [{ id: 'animal-1', type: 'Animal', name: 'Cow' }];
  const rows = [relation({ endedAt: '2026-08-15T12:00:00.000Z' })];
  assert.equal(relationships.reverseLocationContents(records, rows, 'land-1').length, 0);
});
