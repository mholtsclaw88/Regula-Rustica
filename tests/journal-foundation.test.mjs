import test from 'node:test';
import assert from 'node:assert/strict';
import journal from '../journal-foundation.js';

const stamp = day => `2026-08-${day}T12:00:00.000Z`;

test('Journal combines a completed Task with its linked Yield without duplicate noise', () => {
  const data = {
    tasks: [{ id: 'task-1', recordId: 'daisy', title: 'Morning milking', completed: true, completedAt: stamp('22') }],
    yieldEntries: [{ id: 'yield-1', recordId: 'daisy', taskId: 'task-1', type: 'milk', quantity: 2, unit: 'gal', occurredAt: stamp('22') }],
    events: [{ id: 'event-1', recordId: 'daisy', eventType: 'Task completed', details: 'Morning milking', date: '2026-08-22', createdAt: stamp('22') }]
  };
  const items = journal.buildJournalItems(data, 'daisy');
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'yield');
  assert.equal(items[0].task.title, 'Morning milking');
});

test('a Note with an attached photo remains one coherent multi-filter Journal item', () => {
  const data = {
    documents: [{ id: 'doc-1', recordId: 'daisy', title: 'Hoof condition', body: 'Improving.', createdAt: stamp('21') }],
    attachments: [{ id: 'photo-1', documentId: 'doc-1', recordId: 'daisy', mimeType: 'image/jpeg', createdAt: stamp('21') }]
  };
  const items = journal.buildJournalItems(data, 'daisy');
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].categories, ['notes', 'photos']);
  assert.equal(journal.filterJournalItems(items, 'notes').length, 1);
  assert.equal(journal.filterJournalItems(items, 'photos').length, 1);
});

test('Journal sorts newest first and filters all supported entry types', () => {
  const data = {
    tasks: [{ id: 'task-1', recordId: 'daisy', title: 'Trim hooves', completed: true, completedAt: stamp('18') }],
    events: [{ id: 'event-1', recordId: 'daisy', eventType: 'Moved', date: '2026-08-19', createdAt: stamp('19') }],
    notes: [{ id: 'note-1', recordId: 'daisy', text: 'Calm at stanchion.', createdAt: stamp('20') }],
    documents: [{ id: 'doc-1', recordId: 'daisy', title: 'Vet report', body: '', createdAt: stamp('21') }],
    attachments: [{ id: 'pdf-1', documentId: 'doc-1', recordId: 'daisy', mimeType: 'application/pdf', createdAt: stamp('21') }]
  };
  const items = journal.buildJournalItems(data, 'daisy');
  assert.deepEqual(items.map(item => item.kind), ['document', 'legacy-note', 'event', 'task']);
  assert.equal(journal.filterJournalItems(items, 'documents').length, 1);
  assert.equal(journal.filterJournalItems(items, 'events').length, 1);
  assert.equal(journal.filterJournalItems(items, 'tasks').length, 1);
});

test('profile crop defaults, clamps, and applies non-destructive presentation styles', () => {
  assert.deepEqual(journal.normalizeProfileCrop(), { x: 50, y: 50, zoom: 1 });
  assert.deepEqual(journal.normalizeProfileCrop(null), { x: 50, y: 50, zoom: 1 });
  assert.deepEqual(journal.normalizeProfileCrop({ x: -20, y: 140, zoom: 8 }), { x: 0, y: 100, zoom: 3 });
  const image = { style: {} };
  journal.applyProfileCrop(image, { x: 32, y: 67, zoom: 1.5 });
  assert.equal(image.style.objectPosition, '32% 67%');
  assert.equal(image.style.transformOrigin, '32% 67%');
  assert.equal(image.style.transform, 'scale(1.5)');
});
