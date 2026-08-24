'use strict';
(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RegulaRusticaJournal = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const FILTERS = ['all', 'tasks', 'yield', 'notes', 'photos', 'documents', 'events'];
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value)));

  function normalizeProfileCrop(value = {}) {
    value = value && typeof value === 'object' ? value : {};
    return {
      x: Number.isFinite(Number(value.x)) ? clamp(value.x, 0, 100) : 50,
      y: Number.isFinite(Number(value.y)) ? clamp(value.y, 0, 100) : 50,
      zoom: Number.isFinite(Number(value.zoom)) ? clamp(value.zoom, 1, 3) : 1
    };
  }

  function applyProfileCrop(image, value) {
    const crop = normalizeProfileCrop(value);
    image.style.objectPosition = `${crop.x}% ${crop.y}%`;
    image.style.transformOrigin = `${crop.x}% ${crop.y}%`;
    image.style.transform = `scale(${crop.zoom})`;
    return crop;
  }

  function buildJournalItems(data, recordId) {
    const active = value => value && !value.deletedAt && value.recordId === recordId;
    const attachmentsByDocument = new Map();
    (data.attachments || []).filter(active).forEach(attachment => {
      const list = attachmentsByDocument.get(attachment.documentId) || [];
      list.push(attachment);
      attachmentsByDocument.set(attachment.documentId, list);
    });
    const yieldEntries = (data.yieldEntries || []).filter(active);
    const linkedYieldTaskIds = new Set(yieldEntries.map(entry => entry.taskId).filter(Boolean));
    const legacyYieldEventIds = new Set(yieldEntries.map(entry => entry.legacyEventId).filter(Boolean));
    const completedTasks = (data.tasks || []).filter(task => active(task) && task.completed);
    const generatedTaskEventKeys = new Set(completedTasks.map(task => `${task.title}\u0000${String(task.completedAt || task.updatedAt || '').slice(0, 10)}`));
    const items = [];

    completedTasks.filter(task => !linkedYieldTaskIds.has(task.id)).forEach(task => items.push({
      id: `task:${task.id}`, kind: 'task', categories: ['tasks'], timestamp: task.completedAt || task.updatedAt || task.createdAt,
      task
    }));
    yieldEntries.forEach(entry => items.push({
      id: `yield:${entry.id}`, kind: 'yield', categories: ['yield'], timestamp: entry.occurredAt || entry.updatedAt || entry.createdAt,
      entry, task: (data.tasks || []).find(task => task.id === entry.taskId) || null
    }));
    (data.events || []).filter(event => active(event) && !legacyYieldEventIds.has(event.id)
      && !(event.eventType === 'Task completed' && generatedTaskEventKeys.has(`${event.details}\u0000${String(event.date || event.createdAt || '').slice(0, 10)}`)))
      .forEach(event => items.push({
      id: `event:${event.id}`, kind: 'event', categories: ['events'], timestamp: event.occurredAt || `${event.date || '1970-01-01'}T12:00:00`,
      event
    }));
    (data.notes || []).filter(active).forEach(note => items.push({
      id: `note:${note.id}`, kind: 'legacy-note', categories: ['notes'], timestamp: note.updatedAt || note.createdAt, note
    }));
    (data.documents || []).filter(active).forEach(documentEntry => {
      const attachments = attachmentsByDocument.get(documentEntry.id) || [];
      const categories = [];
      if ((documentEntry.body || '').trim() || attachments.length === 0) categories.push('notes');
      if (attachments.some(attachment => attachment.mimeType?.startsWith('image/'))) categories.push('photos');
      if (attachments.some(attachment => attachment.mimeType === 'application/pdf')) categories.push('documents');
      items.push({
        id: `document:${documentEntry.id}`, kind: 'document', categories: categories.length ? categories : ['notes'],
        timestamp: documentEntry.createdAt || documentEntry.updatedAt, documentEntry, attachments
      });
    });
    return items.sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')));
  }

  function filterJournalItems(items, filter) {
    const selected = FILTERS.includes(filter) ? filter : 'all';
    return selected === 'all' ? items : items.filter(item => item.categories.includes(selected));
  }

  return Object.freeze({ FILTERS, normalizeProfileCrop, applyProfileCrop, buildJournalItems, filterJournalItems });
}));
