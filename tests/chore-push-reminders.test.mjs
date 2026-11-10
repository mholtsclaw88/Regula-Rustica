import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openWindowChoreCount, reminderText } from '../chore-push-core.mjs';

const windowId = 'morning';
const rule = { frequency: 'daily', interval: 1, mode: 'fixed_schedule', seriesId: 'milking', enabled: true };
const task = (overrides = {}) => ({
  id: 'first', title: 'Milk Daisy', recordId: 'daisy', choreWindowId: windowId,
  dueDate: '2026-11-08', availableFrom: null, status: 'open', completed: false,
  deletedAt: null, recurrenceRule: rule,
  createdAt: '2026-11-08T12:00:00Z', updatedAt: '2026-11-08T12:00:00Z',
  ...overrides
});

test('projects repeating unfinished work at window end', () => {
  assert.equal(openWindowChoreCount([task()], windowId, '2026-11-09'), 1);
});
test('does not remind about a completed materialized occurrence', () => {
  assert.equal(openWindowChoreCount([
    task(), task({ id: 'second', dueDate: '2026-11-09', completed: true,
      status: 'completed', updatedAt: '2026-11-09T12:00:00Z' })
  ], windowId, '2026-11-09'), 0);
});
test('ignores cancelled, disabled, deleted, and other-window work', () => {
  assert.equal(openWindowChoreCount([task({ dueDate: '2026-11-09', status: 'cancelled' })], windowId, '2026-11-09'), 0);
  assert.equal(openWindowChoreCount([task({ recurrenceRule: { ...rule, enabled: false } })], windowId, '2026-11-09'), 0);
  assert.equal(openWindowChoreCount([task({ deletedAt: '2026-11-09T01:00:00Z' })], windowId, '2026-11-09'), 0);
  assert.equal(openWindowChoreCount([task({ choreWindowId: 'evening' })], windowId, '2026-11-09'), 0);
});
test('copy is concise and does not disclose task titles', () => {
  assert.deepEqual(reminderText('Morning', 1), {
    title: 'Morning chores to review',
    body: '1 task remains. Open your Farm Book when you are ready.'
  });
});
test('worker and settings expose a per-device opt-in and notification action', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../chore-push-client.mjs', import.meta.url), 'utf8');
  assert.match(html, /id="choreReminderToggle"/);
  assert.match(client, /Notification\.requestPermission\(\)/);
  assert.match(client, /register_chore_push_subscription/);
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /addEventListener\('notificationclick'/);
});
