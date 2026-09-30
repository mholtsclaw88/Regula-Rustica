import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import tasks from '../task-foundation.js';

const animal = (species, purpose) => ({ type: 'Animal', identity: { species, purpose } });

test('known animal species only offer plausible purposes', () => {
  assert.deepEqual(tasks.animalPurposeOptions('Dairy cows'), ['Dairy', 'Meat', 'Breeding', 'Draft', 'Companion', 'Mixed']);
  assert.ok(tasks.animalPurposeOptions('laying hens').includes('Eggs'));
  assert.ok(!tasks.animalPurposeOptions('pigs').includes('Eggs'));
  assert.ok(!tasks.animalPurposeOptions('cats').includes('Dairy'));
  assert.deepEqual(tasks.animalPurposeOptions('honeybees'), ['Breeding', 'Honey', 'Mixed']);
  assert.ok(tasks.animalPurposeOptions('alpaca').includes('Fiber'), 'unrecognized species stay flexible');
});

test('species takes precedence over contradictory purpose in Yield and suggestions', () => {
  for (const record of [animal('cow', 'Eggs'), animal('pig', 'Dairy'), animal('cat', 'Eggs'), animal('bee', 'Dairy')]) {
    assert.deepEqual(tasks.eligibleYieldTypes(record), []);
    assert.ok(!tasks.suggestedTasks(record).some(suggestion => suggestion.yieldType));
  }
  assert.deepEqual(tasks.eligibleYieldTypes(animal('cow', 'Dairy')), ['milk', 'meat']);
  assert.deepEqual(tasks.eligibleYieldTypes(animal('chickens', 'Eggs')), ['eggs', 'meat']);
  assert.deepEqual(tasks.eligibleYieldTypes(animal('pigs', 'Meat')), ['meat']);
  assert.deepEqual(tasks.eligibleYieldTypes(animal('goat', 'Dairy')), ['milk', 'meat']);
  assert.deepEqual(tasks.eligibleYieldTypes(animal('cat', 'Companion')), []);
});

test('land Yield remains tied to land use, not animal choices', () => {
  assert.deepEqual(tasks.eligibleYieldTypes({ type: 'Land', identity: { landType: 'Garden Plot' } }), ['harvest']);
  assert.deepEqual(tasks.eligibleYieldTypes({ type: 'Land', identity: { landType: 'Hay Field' } }), ['forage']);
  assert.deepEqual(tasks.eligibleYieldTypes({ type: 'Equipment' }), []);
  assert.deepEqual(tasks.eligibleYieldTypes({ type: 'Land', name: 'Garden Pasture', identity: { landType: 'Pasture' } }), ['forage']);
});

test('Record Event choices include every applicable event without cross-species suggestions', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const config = app.slice(app.indexOf('const RECORD_CONFIG ='), app.indexOf('const nowIso ='));
  const choicesSource = app.slice(app.indexOf('function eventChoices(record) {'), app.indexOf('\nfunction activeDocumentAttachments'));
  const eventChoices = new Function('window', `${config}\n${choicesSource}\nreturn eventChoices;`)({ RegulaRusticaTasks: tasks });
  const cow = eventChoices(animal('cow', 'Dairy'));
  assert.ok(cow.includes('Freshened'));
  assert.ok(cow.includes('Slaughtered / Processed'), 'specialization must not truncate standard events');
  assert.ok(!cow.includes('Honey Harvest'));
  assert.ok(!eventChoices(animal('cow', 'Honey')).includes('Honey Harvest'));
  assert.ok(eventChoices(animal('bees', 'Honey')).includes('Honey Harvest'));
  assert.ok(!eventChoices({ type: 'Equipment' }).includes('Freshened'));
});

test('all context-sensitive form dropdowns use the shared rules and validate on save', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /animalPurposeOptions\(speciesInput\.value\)/);
  assert.match(app, /recordSelect\.addEventListener\('change', refreshYieldChoices\)/);
  assert.match(app, /eligibleYieldTypes\(record\)/);
  assert.match(app, /eligibleYieldTypes\(yieldRecord\)\.includes\(form\.yieldType\)/);
  assert.match(app, /yieldConfig\.units\.includes\(form\.unit\)/);
  assert.match(app, /eligibleYieldTypes\.length > 0 && !INACTIVE_RECORD_STATUSES\.has\(record\.status\)/);
  assert.doesNotMatch(app, /\.slice\(0, 9\)\.concat\('Other'\)/);
  assert.match(app, /!eventChoices\(record\)\.includes\(form\.eventType\)/);
  assert.match(app, /animalKind\(record\) === 'dairy'/);
  const allocations = readFileSync(new URL('../ledger-allocations.js', import.meta.url), 'utf8');
  assert.match(allocations, /\.filter\(record => !record\.deletedAt\)/, 'archived allocation Records stay selectable for history');
});
