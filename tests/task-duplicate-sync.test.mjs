import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const engine = await readFile(new URL('../sync/engine.mjs', import.meta.url), 'utf8');

test('duplicate-key task updates retrieve cloud row for user-reviewed conflict', () => {
  assert.match(engine, /operation\.table === 'tasks' && operation\.type === 'update'/);
  assert.match(engine, /String\(error\?\.code \|\| ''\) === '23505'/);
  assert.match(engine, /await this\.cloud\.getRow\('tasks', operation\.rowId\)/);
  assert.match(engine, /this\.state\.addConflict\(operation, cloudRow\)/);
  assert.match(engine, /this\.state\.fail\(operation, error, \{ retryable: isRetryableSyncError\(error\) \}\)/);
});
