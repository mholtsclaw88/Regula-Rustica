import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const selector = require('../form-selector.js');

test('Record labels are separated into a readable name and type', () => {
  assert.deepEqual(selector.optionParts({ label: 'Freedom Rangers Flock (Animal)' }), {
    label: 'Freedom Rangers Flock', meta: 'Animal'
  });
  assert.deepEqual(selector.optionParts({ label: 'Main Garden — Land' }), {
    label: 'Main Garden', meta: 'Land'
  });
});

test('long selector search matches both primary and secondary text', () => {
  const options = [
    { label: 'Build Woodshed', meta: 'Work', value: 'work' },
    { label: 'Compost pile', meta: 'Land', value: 'land' },
    { label: 'Freedom Rangers', meta: 'Animal', value: 'flock' }
  ];
  assert.deepEqual(selector.filterOptions(options, 'compost').map(option => option.value), ['land']);
  assert.deepEqual(selector.filterOptions(options, 'animal').map(option => option.value), ['flock']);
});

test('keyboard navigation wraps and supports Home and End', () => {
  assert.equal(selector.nextOptionIndex(4, 0, 'previous'), 3);
  assert.equal(selector.nextOptionIndex(4, 3, 'next'), 0);
  assert.equal(selector.nextOptionIndex(4, 2, 'home'), 0);
  assert.equal(selector.nextOptionIndex(4, 1, 'end'), 3);
});
