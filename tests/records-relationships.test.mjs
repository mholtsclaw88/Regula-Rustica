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

test('parent choices include only active individual Animals of the same species', () => {
  const records = [
    { id: 'calf', type: 'Animal', name: 'Calf', status: 'Active', identity: { managedAs: 'Individual', species: ' Cattle ' } },
    { id: 'cow', type: 'Animal', name: 'Cow', status: 'Active', identity: { managedAs: 'Individual', species: 'cattle' } },
    { id: 'herd', type: 'Animal', name: 'Herd', status: 'Active', identity: { managedAs: 'Group', species: 'Cattle' } },
    { id: 'ewe', type: 'Animal', name: 'Ewe', status: 'Active', identity: { managedAs: 'Individual', species: 'Sheep' } },
    { id: 'archived', type: 'Animal', name: 'Old Cow', status: 'Archived', identity: { managedAs: 'Individual', species: 'Cattle' } },
    { id: 'deleted', type: 'Animal', name: 'Deleted Cow', status: 'Active', deletedAt: stamp, identity: { managedAs: 'Individual', species: 'Cattle' } },
    { id: 'tractor', type: 'Equipment', name: 'Tractor', status: 'Active', identity: {} }
  ];

  assert.deepEqual(relationships.parentAnimalOptions(records, 'calf', ' cattle ').map(option => option.value), ['cow']);
});

test('Responsible Person choices include active members and children', () => {
  const options = relationships.activePersonOptions({ people: [
    { id: 'member', personType: 'member', displayName: 'Alex' },
    { id: 'child', personType: 'child', displayName: 'Clare' },
    { id: 'removed', personType: 'member', displayName: 'Former', deletedAt: stamp }
  ] });

  assert.deepEqual(options, [
    { label: 'Alex', value: 'member' },
    { label: 'Clare (child)', value: 'child' }
  ]);
});

test('structured Responsible Person assignment replaces legacy free text', () => {
  assert.deepEqual(
    relationships.withResponsiblePerson({ location: 'North barn', responsible: 'Legacy name' }, 'member'),
    { location: 'North barn', responsiblePersonId: 'member' }
  );
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
