'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const STORAGE_KEY = 'regulaRusticaV5';
const LEGACY_KEYS = ['regulaRusticaV4', 'regulaRusticaV3'];
const MIGRATION_BACKUP_KEY = 'regulaRusticaPreV5Backup';
const IMPORT_BACKUP_KEY = 'regulaRusticaBeforeImport';
const RECORD_TYPES = ['Animal', 'Land', 'Equipment', 'Structure', 'Work'];
const CURRENT_SCHEMA_VERSION = 13;
const SUPPORTED_SCHEMA_VERSIONS = [5, 6, 7, 8, 9, 10, 11, 12, CURRENT_SCHEMA_VERSION];
let startupMigrationBefore = null;

const RECORD_CONFIG = {
  Animal: {
    plural: 'Animals',
    statuses: ['Active', 'Sold', 'Deceased', 'Processed', 'Archived'],
    events: ['Weight', 'Treatment', 'Moved', 'Breeding', 'Birth / Hatch', 'Purchase', 'Sale', 'Death', 'Slaughtered / Processed']
  },
  Land: {
    plural: 'Land',
    statuses: ['Active', 'Resting', 'Inactive', 'Archived'],
    events: ['Seeded', 'Fertilized', 'Grazed', 'Rest Started', 'Mowed', 'Irrigated', 'Soil Test', 'Tilled', 'Limed / Amended']
  },
  Equipment: {
    plural: 'Equipment',
    statuses: ['Active', 'Out of Service', 'Sold', 'Archived'],
    events: ['Maintenance', 'Repair', 'Inspection', 'Cleaned', 'Fueled', 'Hour Meter', 'Used']
  },
  Structure: {
    plural: 'Structures',
    statuses: ['Active', 'Out of Service', 'Archived'],
    events: ['Inspected', 'Repaired', 'Cleaned', 'Painted / Finished', 'Modified', 'Damage Observed']
  },
  Work: {
    plural: 'Works',
    statuses: ['Planned', 'Active', 'Waiting', 'Completed', 'Cancelled', 'Archived'],
    events: ['Started', 'Progress Update', 'Inspection', 'Delay', 'Material Delivered', 'Milestone Reached', 'Completed']
  }
};

const nowIso = () => new Date().toISOString();
const localDateTime = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};
const today = () => localDateTime().slice(0, 10);
const uid = () => crypto.randomUUID();
const formatDate = date => date
  ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  : 'No date';
const formatMoney = value => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(value || 0));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const asArray = value => Array.isArray(value) ? value : [];
const normalizeProfileCrop = value => window.RegulaRusticaJournal?.normalizeProfileCrop(value) || {
  x: Number.isFinite(Number(value?.x)) ? Math.min(100, Math.max(0, Number(value.x))) : 50,
  y: Number.isFinite(Number(value?.y)) ? Math.min(100, Math.max(0, Number(value.y))) : 50,
  zoom: Number.isFinite(Number(value?.zoom)) ? Math.min(3, Math.max(1, Number(value.zoom))) : 1
};

function canonicalRecordType(type) {
  if (RECORD_TYPES.includes(type)) return type;
  if (type === 'Livestock') return 'Animal';
  if (type === 'Garden' || type === 'Pasture') return 'Land';
  if (type === 'Equipment') return 'Equipment';
  if (type === 'Project' || type === 'Dairy Batch' || type === 'Harvest' || type === 'Preservation') return 'Work';
  return 'Structure';
}

function normalizeRecord(record = {}) {
  const timestamp = record.createdAt || record.created || nowIso();
  return {
    id: record.id || uid(),
    type: canonicalRecordType(record.type),
    name: record.name || 'Unnamed record',
    status: record.status || 'Active',
    identity: record.identity && typeof record.identity === 'object' ? record.identity : {},
    stewardship: record.stewardship && typeof record.stewardship === 'object' ? record.stewardship : {},
    profilePhotoAttachmentId: record.profilePhotoAttachmentId || record.primaryPhotoId || null,
    profilePhotoCrop: normalizeProfileCrop(record.profilePhotoCrop),
    createdAt: timestamp.length === 10 ? `${timestamp}T12:00:00.000Z` : timestamp,
    updatedAt: record.updatedAt || timestamp,
    deletedAt: record.deletedAt || null
  };
}

function normalizeTask(task = {}) {
  const createdAt = task.createdAt || task.created || nowIso();
  const recurrenceRule = window.RegulaRusticaHousekeeping.normalizeRecurrenceRule(task.recurrenceRule);
  return {
    id: task.id || uid(),
    title: task.title || 'Untitled task',
    availableFrom: task.availableFrom ?? task.startDate ?? '',
    dueDate: task.dueDate ?? task.due ?? '',
    recordId: task.recordId || null,
    completed: Boolean(task.completed ?? task.done),
    description: task.description || '',
    status: task.status || (task.completed || task.done ? 'completed' : 'open'),
    priority: task.priority || 'normal',
    recurrenceRule,
    parentTaskId: task.parentTaskId || null,
    choreWindowId: task.choreWindowId || null,
    yieldType: window.RegulaRusticaTasks.YIELD_TYPES[task.yieldType] ? task.yieldType : null,
    suggestionKey: task.suggestionKey || null,
    createdAt,
    updatedAt: task.updatedAt || createdAt,
    completedAt: task.completedAt || (task.completed || task.done ? nowIso() : null),
    deletedAt: task.deletedAt || null
  };
}

function normalizePerson(person = {}) {
  const createdAt = person.createdAt || nowIso();
  return {
    id: person.id || uid(),
    personType: person.personType === 'member' ? 'member' : 'child',
    displayName: person.displayName || person.name || 'Unnamed person',
    memberId: person.memberId || null,
    status: person.status || 'active',
    active: person.active !== false,
    createdAt,
    updatedAt: person.updatedAt || createdAt,
    deletedAt: person.deletedAt || null,
    removedAt: person.removedAt || null
  };
}

function normalizeAssignment(assignment = {}, people = []) {
  const assignedAt = assignment.assignedAt || assignment.createdAt || nowIso();
  const matchedPerson = assignment.personId
    ? people.find(person => person.id === assignment.personId)
    : people.find(person => person.memberId && person.memberId === assignment.memberId);
  return {
    id: assignment.id || uid(),
    taskId: assignment.taskId || null,
    personId: matchedPerson?.id || assignment.personId || null,
    memberId: matchedPerson?.memberId || assignment.memberId || null,
    assignmentType: assignment.assignmentType || 'assignee',
    assignedAt,
    createdAt: assignment.createdAt || assignedAt,
    updatedAt: assignment.updatedAt || assignedAt,
    removedAt: assignment.removedAt || assignment.deletedAt || null
  };
}

function taskDateText(task) {
  if (task.availableFrom && task.dueDate) return `${formatDate(task.availableFrom)} – ${formatDate(task.dueDate)}`;
  if (task.availableFrom) return `Available ${formatDate(task.availableFrom)}`;
  if (task.dueDate) return `Due ${formatDate(task.dueDate)}`;
  return 'No date';
}

const isTaskVisible = task => !task.deletedAt && task.recurrenceRule?.enabled !== false && task.recurrenceRule?.seriesDeleted !== true;
const choreWindowForTask = task => data.choreWindows.find(choreWindow => !choreWindow.deletedAt && choreWindow.id === task.choreWindowId) || null;
const taskIsOverdue = (task, now = new Date()) => window.RegulaRusticaHousekeeping.taskIsOverdue(task, choreWindowForTask(task), now);
const clockTimeText = value => window.RegulaRusticaTasks.formatClockTime(value);
const choreWindowTimeText = choreWindow => {
  const start = clockTimeText(choreWindow.startTime);
  const end = clockTimeText(choreWindow.endTime);
  if (start && end) return `${start}–${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;
  return '';
};

function createNextLocalOccurrence(task) {
  if (!window.RegulaRusticaTasks.recurrenceEnabled(task)) return;
  const dueDate = window.RegulaRusticaHousekeeping.nextRecurringDueDate(task, today());
  if (!dueDate) return;
  const seriesId = window.RegulaRusticaTasks.recurrenceSeriesId(task);
  if (data.tasks.some(item => window.RegulaRusticaTasks.recurrenceSeriesId(item) === seriesId && window.RegulaRusticaHousekeeping.taskWorkDate(item) === dueDate)) return;
  const timestamp = nowIso();
  data.tasks.push(normalizeTask({
    id: uid(),
    title: task.title,
    description: task.description,
    dueDate,
    recordId: task.recordId,
    priority: task.priority,
    recurrenceRule: { ...task.recurrenceRule },
    parentTaskId: task.id,
    choreWindowId: task.choreWindowId,
    yieldType: task.yieldType,
    suggestionKey: task.suggestionKey,
    createdAt: timestamp,
    updatedAt: timestamp
  }));
}

function normalizeEvent(event = {}) {
  const createdAt = event.createdAt || (event.date?.includes('T') ? event.date : nowIso());
  return {
    id: event.id || uid(),
    recordId: event.recordId || null,
    eventType: event.eventType || 'Other',
    date: (event.date || event.createdAt || today()).slice(0, 10),
    occurredAt: event.occurredAt || (event.date?.includes('T') ? event.date : null),
    value: event.value ?? '',
    unit: event.unit || '',
    details: event.details || event.text || '',
    createdAt,
    updatedAt: event.updatedAt || createdAt,
    deletedAt: event.deletedAt || null
  };
}

function normalizeNote(note = {}) {
  return {
    id: note.id || uid(),
    recordId: note.recordId || null,
    text: note.text || '',
    createdAt: note.createdAt || note.created || note.date || nowIso(),
    updatedAt: note.updatedAt || note.createdAt || note.created || note.date || nowIso(),
    deletedAt: note.deletedAt || null
  };
}

function normalizeLedgerEntry(entry = {}) {
  const createdAt = entry.createdAt || nowIso();
  return {
    id: entry.id || uid(),
    type: entry.type === 'revenue' ? 'income' : entry.type === 'income' ? 'income' : 'expense',
    date: (entry.date || today()).slice(0, 10),
    amount: Number(entry.amount || 0),
    description: entry.description || '',
    recordId: entry.recordId || null,
    currencyCode: entry.currencyCode || 'USD',
    category: entry.category || null,
    vendorOrSource: entry.vendorOrSource || null,
    createdAt,
    updatedAt: entry.updatedAt || createdAt,
    deletedAt: entry.deletedAt || null
  };
}

function normalizeLedgerAllocation(allocation = {}) {
  const createdAt = allocation.createdAt || nowIso();
  return {
    id: allocation.id || uid(),
    ledgerEntryId: allocation.ledgerEntryId || null,
    recordId: allocation.recordId || null,
    amount: Number(allocation.amount || 0),
    createdAt,
    updatedAt: allocation.updatedAt || createdAt,
    deletedAt: allocation.deletedAt || null
  };
}

function normalizeCalendarEvent(event = {}) {
  const createdAt = event.createdAt || nowIso();
  return {
    id: event.id || uid(),
    title: event.title || 'Untitled event',
    startDate: (event.startDate || event.date || today()).slice(0, 10),
    endDate: (event.endDate || event.startDate || event.date || today()).slice(0, 10),
    allDay: event.allDay !== false,
    startTime: event.startTime || '',
    endTime: event.endTime || '',
    location: event.location || '',
    notes: event.notes || '',
    recordId: event.recordId || null,
    createdAt,
    updatedAt: event.updatedAt || createdAt,
    deletedAt: event.deletedAt || null
  };
}

function normalizeYieldEntry(entry = {}) {
  const createdAt = entry.createdAt || nowIso();
  const occurredAt = entry.occurredAt || `${entry.date || today()}T${entry.time || '12:00'}:00`;
  return {
    id: entry.id || uid(),
    recordId: entry.recordId || null,
    taskId: entry.taskId || null,
    type: window.RegulaRusticaTasks.YIELD_TYPES[entry.type] ? entry.type : 'milk',
    occurredAt,
    session: ['morning', 'evening', 'other'].includes(entry.session) ? entry.session : 'other',
    quantity: Number(entry.quantity ?? entry.value ?? 0),
    unit: entry.unit || (entry.type === 'eggs' ? 'eggs' : 'gal'),
    unusableQuantity: Number(entry.unusableQuantity ?? entry.loss ?? 0),
    details: entry.details || entry.notes || '',
    product: entry.product || '',
    legacyEventId: entry.legacyEventId || null,
    createdAt,
    updatedAt: entry.updatedAt || createdAt,
    deletedAt: entry.deletedAt || null
  };
}

function historicalYield(event) {
  const candidate = window.RegulaRusticaHousekeeping.historicalYieldCandidate(event);
  return candidate ? normalizeYieldEntry(candidate) : null;
}

function normalizeData(source = {}, options = {}) {
  const sourceVersion = Number(source.schemaVersion || source.version || 0);
  const events = asArray(source.events).map(normalizeEvent);
  const yieldEntries = asArray(source.yieldEntries).map(normalizeYieldEntry);
  const people = asArray(source.people).map(normalizePerson);
  if (sourceVersion < 6) {
    const migratedIds = new Set(yieldEntries.map(entry => entry.legacyEventId).filter(Boolean));
    events.forEach(event => {
      if (migratedIds.has(event.id)) return;
      const migrated = historicalYield(event);
      if (migrated) yieldEntries.push(migrated);
    });
  }
  const tasks = asArray(source.tasks).map(normalizeTask);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: { homesteadName: source.settings?.homesteadName || 'My Homestead' },
    records: asArray(source.records).map(normalizeRecord),
    tasks,
    people,
    relationships: asArray(source.relationships),
    assignments: asArray(source.assignments).map(assignment => normalizeAssignment(assignment, people)),
    events,
    notes: asArray(source.notes).map(normalizeNote),
    documents: asArray(source.documents).map(normalizeDocument),
    attachments: asArray(source.attachments).map(normalizeAttachment),
    ledger: asArray(source.ledger).map(normalizeLedgerEntry),
    ledgerAllocations: asArray(source.ledgerAllocations).map(normalizeLedgerAllocation),
    calendarEvents: asArray(source.calendarEvents).map(normalizeCalendarEvent),
    yieldEntries,
    choreWindows: (asArray(source.choreWindows).length
      ? asArray(source.choreWindows)
      : options.ensureDefaultChoreWindows === false ? [] : window.RegulaRusticaTasks.DEFAULT_WINDOWS)
      .map(value => window.RegulaRusticaTasks.normalizeWindow(value, { applyBuiltInDefaults: options.applyBuiltInDefaults !== false })),
    ...(source.legacy ? { legacy: source.legacy } : {})
  };
}

function legacyIdentity(record, type) {
  const details = record.details || {};
  if (type === 'Animal') {
    return {
      managedAs: 'Individual',
      species: /cow|cattle|jersey/i.test(details.kind || '') ? 'Cattle' : '',
      breed: /jersey/i.test(details.kind || '') ? 'Jersey' : '',
      purpose: details.purpose || 'Mixed',
      legacySummary: details.summary || details.kind || ''
    };
  }
  if (type === 'Land') {
    return {
      landType: record.type === 'Garden' ? 'Garden Plot' : record.type === 'Pasture' ? 'Pasture' : 'Other',
      legacySummary: details.summary || ''
    };
  }
  if (type === 'Equipment') return { equipmentType: details.kind || '', legacySummary: details.summary || '' };
  if (type === 'Work') return { workType: record.type || 'Work', startDate: details.made || details.plantDate || '', legacySummary: details.summary || '' };
  return { structureType: record.type || 'Structure', legacySummary: details.summary || details.kind || '' };
}

function legacyStewardship(record, type) {
  const details = record.details || {};
  return {
    location: details.location || '',
    currentUse: type === 'Land' ? details.purpose || '' : '',
    stage: details.nextAction || '',
    responsible: ''
  };
}

function migrateData(source = {}, sourceKey = 'imported legacy data') {
  const migratedAt = nowIso();
  const records = asArray(source.records).map(record => {
    const type = canonicalRecordType(record.type);
    const createdAt = record.createdAt || record.created || migratedAt;
    return {
      id: record.id || uid(),
      type,
      name: record.name || 'Unnamed record',
      status: record.status === 'Archived' ? 'Archived' : record.status || (type === 'Work' ? 'Active' : 'Active'),
      identity: legacyIdentity(record, type),
      stewardship: legacyStewardship(record, type),
      createdAt: createdAt.length === 10 ? `${createdAt}T12:00:00.000Z` : createdAt,
      updatedAt: migratedAt
    };
  });

  const events = [
    ...asArray(source.history).map(item => normalizeEvent({ ...item, eventType: 'Imported history', details: item.text })),
    ...asArray(source.chronicle).map(item => normalizeEvent({ ...item, eventType: 'Imported milestone', details: item.text })),
    ...asArray(source.milk).flatMap(item => [
      item.am ? normalizeEvent({ recordId: item.recordId, eventType: 'Morning Milk', date: item.date, value: item.am, unit: 'gal' }) : null,
      item.pm ? normalizeEvent({ recordId: item.recordId, eventType: 'Evening Milk', date: item.date, value: item.pm, unit: 'gal' }) : null
    ].filter(Boolean))
  ];

  for (const record of asArray(source.records)) {
    const details = record.details || {};
    if (details.lastGrazed) events.push(normalizeEvent({ recordId: record.id, eventType: 'Grazed', date: details.lastGrazed, details: 'Imported from prior record details' }));
  }

  return normalizeData({
    settings: source.settings,
    records,
    tasks: source.tasks,
    events,
    notes: source.notes,
    ledger: source.ledger,
    ledgerAllocations: source.ledgerAllocations,
    legacy: { sourceKey, migratedAt, snapshot: source }
  });
}

function isSupportedData(value) {
  return SUPPORTED_SCHEMA_VERSIONS.includes(value?.schemaVersion) || SUPPORTED_SCHEMA_VERSIONS.includes(value?.version);
}

const normalizeDocument = value => window.RegulaRusticaDocuments.normalizeDocument(value);
const normalizeAttachment = value => window.RegulaRusticaDocuments.normalizeAttachment(value);

function prepareImportedData(value, sourceName = 'backup') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Backup must contain a data object.');
  return isSupportedData(value) ? normalizeData(value) : migrateData(value, sourceName);
}

function safelyStoreBackup(key, rawValue) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: nowIso(), rawValue }));
  } catch (error) {
    console.warn(`Could not save ${key}. The source data remains untouched.`, error);
  }
}

function loadData() {
  const currentRaw = localStorage.getItem(STORAGE_KEY);
  if (currentRaw) {
    try {
      const current = JSON.parse(currentRaw);
      const beforeMigration = normalizeData({ ...current, schemaVersion: CURRENT_SCHEMA_VERSION }, { applyBuiltInDefaults: false });
      const normalized = isSupportedData(current) ? normalizeData(current) : migrateData(current, STORAGE_KEY);
      if (current.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        safelyStoreBackup(MIGRATION_BACKUP_KEY, currentRaw);
        startupMigrationBefore = beforeMigration;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      }
      return normalized;
    } catch (error) {
      console.warn('The v5 data could not be read; it has not been overwritten.', error);
    }
  }

  for (const key of LEGACY_KEYS) {
    const legacyRaw = localStorage.getItem(key);
    if (!legacyRaw) continue;
    try {
      const legacyData = JSON.parse(legacyRaw);
      safelyStoreBackup(MIGRATION_BACKUP_KEY, legacyRaw);
      const migrated = migrateData(legacyData, key);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    } catch (error) {
      console.warn(`Legacy data in ${key} could not be migrated and remains untouched.`, error);
    }
  }

  return structuredClone(SEED_DATA);
}

function saveData(nextData = data, source = 'user') {
  const before = persistedData ? structuredClone(persistedData) : null;
  // A cloud replacement deliberately writes empty collections before pulling.
  // Do not turn that empty Chore Window collection back into local defaults.
  data = normalizeData(nextData, { ensureDefaultChoreWindows: source !== 'sync' });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  persistedData = structuredClone(data);
  renderAll();
  window.dispatchEvent(new CustomEvent('regula-rustica:data-saved', { detail: { before, after: structuredClone(data), source } }));
}

function materializeRecurringTasks(source = 'recurrence') {
  const before = JSON.stringify(data.tasks);
  window.RegulaRusticaTasks.stabilizeRecurringTasks(data.tasks, {
    targetDate: today(),
    nextDueDate: window.RegulaRusticaHousekeeping.nextRecurringDueDate,
    makeId: uid,
    now: nowIso()
  });
  if (before === JSON.stringify(data.tasks)) return false;
  saveData(data, source);
  return true;
}

async function syncLocalAttachments({ requireAll = false } = {}) {
  if (attachmentSyncPromise) return attachmentSyncPromise;
  if (!window.RegulaRusticaDocuments.canSync()) return { synced: 0, failed: 0 };
  attachmentSyncPromise = (async () => {
    let synced = 0;
    let failed = 0;
    let changed = false;
    for (const attachment of data.attachments) {
      if (attachment.deletedAt) {
        if (!attachment.storagePath || attachment.syncState === 'synced') continue;
        try {
          await window.RegulaRusticaDocuments.removeRemote([attachment.storagePath]);
          attachment.syncState = 'synced';
          attachment.syncError = '';
          synced += 1;
        } catch (error) {
          attachment.syncState = 'failed';
          attachment.syncError = error.message || 'Cloud deletion failed.';
          failed += 1;
        }
        changed = true;
        continue;
      }
      if (attachment.storagePath && attachment.syncState === 'synced') continue;
      let local;
      try { local = await window.RegulaRusticaDocuments.readLocal(attachment.id); }
      catch (_) { local = null; }
      if (!local?.blob) {
        attachment.syncState = 'failed';
        attachment.syncError = 'The local attachment copy is unavailable.';
        failed += 1;
        changed = true;
        continue;
      }
      attachment.syncState = 'pending';
      attachment.syncError = '';
      try {
        Object.assign(attachment, await window.RegulaRusticaDocuments.uploadStored(attachment));
        synced += 1;
      } catch (error) {
        attachment.syncState = 'failed';
        attachment.syncError = error.message || 'Cloud upload failed.';
        failed += 1;
      }
      changed = true;
    }
    if (changed) saveData(data, 'attachment-sync');
    if (requireAll && failed) throw new Error(`${failed} attachment${failed === 1 ? '' : 's'} could not be synchronized. Local copies are still available.`);
    return { synced, failed };
  })().finally(() => { attachmentSyncPromise = null; });
  return attachmentSyncPromise;
}

function exportData() {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  link.download = `regula-rustica-v${CURRENT_SCHEMA_VERSION}-${today()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

window.RegulaRusticaLocal = {
  read: () => structuredClone(data),
  // Cloud Task completion already materializes the next recurring occurrence.
  // Do not run recurrence normalization during every paginated sync write.
  write: (nextData, source = 'sync') => saveData(nextData, source),
  exportBackup: exportData,
  storageKey: STORAGE_KEY,
  materializeRecurringTasks
};

async function importData(file) {
  if (!file) return;
  const parsed = JSON.parse(await file.text());
  safelyStoreBackup(IMPORT_BACKUP_KEY, JSON.stringify(data));
  saveData(prepareImportedData(parsed, file.name || 'backup'));
}

const seedTimestamp = nowIso();
const SEED_DATA = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  settings: { homesteadName: 'Wood Thief Homestead' },
  records: [
    { id: 'daisy', type: 'Animal', name: 'Daisy', status: 'Active', identity: { managedAs: 'Individual', species: 'Cattle', breed: 'Jersey', purpose: 'Dairy' }, stewardship: { location: 'Barn and east pasture', responsible: '', currentUse: 'Milk cow', stage: '' }, createdAt: seedTimestamp, updatedAt: seedTimestamp },
    { id: 'north', type: 'Land', name: 'North Paddock', status: 'Resting', identity: { landType: 'Pasture', size: '2 acres' }, stewardship: { currentUse: 'Rotational grazing', currentOccupants: '', rotationStage: 'Resting' }, createdAt: seedTimestamp, updatedAt: seedTimestamp },
    { id: 'tractor', type: 'Equipment', name: 'Ford 8N', status: 'Active', identity: { equipmentType: 'Tractor', make: 'Ford', model: '8N' }, stewardship: { location: 'Machine shed', responsible: '', serviceInterval: '' }, createdAt: seedTimestamp, updatedAt: seedTimestamp },
    { id: 'woodshed', type: 'Work', name: 'Build Woodshed', status: 'Planned', identity: { workType: 'Construction', startDate: '', targetDate: '', linkedRecordId: '' }, stewardship: { responsible: '', stage: 'Planning', blockedBy: '' }, createdAt: seedTimestamp, updatedAt: seedTimestamp }
  ],
  tasks: [{ id: uid(), title: 'Check Daisy and record morning milk', dueDate: today(), recordId: 'daisy', completed: false, createdAt: seedTimestamp, completedAt: null }],
  people: [],
  assignments: [],
  events: [],
  notes: [],
  documents: [],
  attachments: [],
  ledger: [],
  calendarEvents: [],
  yieldEntries: [],
  choreWindows: window.RegulaRusticaTasks.DEFAULT_WINDOWS.map(window.RegulaRusticaTasks.normalizeWindow)
};

let data = loadData();
let persistedData = structuredClone(data);
let currentRecordId = null;
let priorView = 'records';
let modalMode = '';
let editId = null;
let contextRecordId = null;
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calendarView = 'month';
let calendarDefaultDate = null;
let yieldCompletionTaskId = null;
let pendingDocumentFiles = [];
let attachmentSyncPromise = null;
let journalFilter = 'all';
let profileCropAttachmentId = null;
let profileCropDraft = normalizeProfileCrop();
let settingsSection = 'home';

function recordById(id) {
  return data.records.find(record => record.id === id);
}

function recordName(id) {
  return recordById(id)?.name || '';
}

function activePeople() {
  const seen = new Set();
  return data.people.filter(person => {
    const status = String(person.status || '').toLowerCase();
    if (!person.id || person.deletedAt || person.removedAt || person.active === false
      || ['inactive', 'archived', 'removed', 'suspended'].includes(status)) return false;
    const key = person.memberId ? `member:${person.memberId}` : `person:${person.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => personDisplayName(a).localeCompare(personDisplayName(b)));
}

function personDisplayName(person = {}) {
  return person.displayName || person.name || 'Unnamed person';
}

function assignmentForTask(taskId) {
  return data.assignments.find(assignment => assignment.taskId === taskId && !assignment.removedAt && assignment.assignmentType === 'assignee');
}

function personForAssignment(assignment) {
  if (!assignment) return null;
  return data.people.find(person => person.id === assignment.personId)
    || data.people.find(person => person.memberId && person.memberId === assignment.memberId)
    || null;
}

function assigneeName(taskId) {
  const assignment = assignmentForTask(taskId);
  if (!assignment) return '';
  return personForAssignment(assignment)?.displayName || 'Former household person';
}

function setTaskAssignee(taskId, personId) {
  const timestamp = nowIso();
  const current = data.assignments.filter(assignment => assignment.taskId === taskId && !assignment.removedAt && assignment.assignmentType === 'assignee');
  if (current.length === 1 && current[0].personId === personId) return;
  current.forEach(assignment => {
    assignment.removedAt = timestamp;
    assignment.updatedAt = timestamp;
  });
  if (!personId) return;
  const person = data.people.find(item => item.id === personId && !item.deletedAt);
  if (!person) return;
  data.assignments.push(normalizeAssignment({
    id: uid(), taskId, personId: person.id, memberId: person.memberId,
    assignmentType: 'assignee', assignedAt: timestamp, createdAt: timestamp, updatedAt: timestamp
  }, data.people));
}

function addEvent(recordId, eventType, details = '', options = {}) {
  data.events.unshift(normalizeEvent({
    id: uid(),
    recordId,
    eventType,
    date: options.date || today(),
    value: options.value || '',
    unit: options.unit || '',
    details,
    createdAt: nowIso()
  }));
}

function showView(id) {
  $$('.view,.record-shell').forEach(element => element.classList.remove('active'));
  $$('.nav button').forEach(button => button.classList.toggle('active', button.dataset.view === id));
  $(`#${id}`).classList.add('active');
  priorView = id;
  if (id === 'records') renderRecords();
  if (id === 'settings') showSettingsSection('home', false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function settingsOperatingMode() {
  const context = window.REGULA_RUSTICA_CLOUD_CONTEXT;
  if (context?.homesteadId) return 'Cloud connected';
  if (context?.session) return 'Signed in · local until joined';
  return 'Local only';
}

function renderSettingsSummary() {
  if (!$('#settingsSummaryName')) return;
  const people = activePeople().length;
  const windows = data.choreWindows.filter(item => !item.deletedAt && item.enabled).length;
  $('#settingsSummaryName').textContent = data.settings.homesteadName || 'My Homestead';
  $('#settingsSummaryPeople').textContent = `${people} ${people === 1 ? 'person' : 'people'}`;
  $('#settingsSummaryWindows').textContent = `${windows} active`;
  $('#settingsSummaryMode').textContent = settingsOperatingMode();
}

function showSettingsSection(section = 'home', focus = true) {
  settingsSection = section;
  const home = $('#settingHome');
  if (!home) return;
  home.classList.toggle('hidden', section !== 'home');
  $$('[data-settings-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.settingsPanel !== section));
  renderSettingsSummary();
  if (focus) (section === 'home' ? $('.settings-page-head h2') : $(`[data-settings-panel="${section}"] h2`))?.focus?.({ preventScroll: true });
  if (focus) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openRecord(id) {
  currentRecordId = id;
  journalFilter = 'all';
  $$('[data-journal-filter]').forEach(button => {
    const active = button.dataset.journalFilter === 'all';
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $$('.view,.record-shell').forEach(element => element.classList.remove('active'));
  $$('.nav button').forEach(button => button.classList.remove('active'));
  $('#recordView').classList.add('active');
  $$('.record-section-nav button').forEach(button => {
    const active = button.dataset.recordSection === 'overview';
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('.record-section-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.recordSectionPanel === 'overview'));
  renderRecord();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value);
}

function identityParts(record) {
  const identity = record.identity || {};
  if (record.type === 'Animal') return [identity.managedAs, identity.species, identity.breed, identity.purpose, identity.quantity ? `Quantity: ${identity.quantity}` : ''];
  if (record.type === 'Land') return [identity.landType, identity.size];
  if (record.type === 'Equipment') return [identity.equipmentType, identity.make, identity.model];
  if (record.type === 'Structure') return [identity.structureType, identity.location];
  if (record.type === 'Work') return [identity.workType, identity.targetDate ? `Target: ${formatDate(identity.targetDate)}` : '', identity.linkedRecordId ? `Linked to: ${recordName(identity.linkedRecordId)}` : ''];
  return [];
}

function identityText(record) {
  return identityParts(record).map(displayValue).filter(Boolean).join(' · ') || 'No identifying details yet.';
}

function stewardshipText(record) {
  const stewardship = record.stewardship || {};
  const labels = {
    location: 'Location', currentUse: 'Use', currentOccupants: 'Occupants', rotationStage: 'Rotation', responsible: 'Responsible',
    serviceInterval: 'Service', condition: 'Condition', stage: 'Stage', blockedBy: 'Blocked by'
  };
  return Object.entries(stewardship)
    .filter(([key, value]) => displayValue(value) && !(record.type === 'Animal' && key === 'stage'))
    .map(([key, value]) => `${labels[key] || key}: ${value}`)
    .join(' · ') || 'No current stewardship details.';
}

function createSuggestedTask(record, suggestion) {
  if (window.RegulaRusticaTasks.suggestionEnabled(data.tasks, record.id, suggestion.key)) return;
  const timestamp = nowIso();
  const choreWindow = data.choreWindows.find(item => item.systemKey === suggestion.windowKey && !item.deletedAt);
  const recurrenceRule = { frequency: suggestion.frequency, interval: 1, mode: 'fixed_schedule', enabled: true };
  const reactivated = window.RegulaRusticaTasks.reactivateSuggestedTask(data.tasks, record.id, suggestion.key, { dueDate: today(), choreWindowId: choreWindow?.id || null, yieldType: suggestion.yieldType, recurrenceRule, updatedAt: timestamp });
  if (reactivated) {
    saveData();
    return;
  }
  data.tasks.push(normalizeTask({id:uid(),recordId:record.id,title:suggestion.title,dueDate:today(),recurrenceRule,choreWindowId:choreWindow?.id||null,yieldType:suggestion.yieldType,suggestionKey:suggestion.key,createdAt:timestamp,updatedAt:timestamp}));
  saveData();
}

function renderSuggestedTasks(record) {
  const root=$('#suggestedTasks'); root.innerHTML='';
  const suggestions=window.RegulaRusticaTasks.suggestedTasks(record);
  if (!suggestions.length) return;
  const heading=document.createElement('div'); heading.className='section-head'; heading.innerHTML='<div><h3>Suggested Tasks</h3><p class="muted">Built-in recommendations stay available and can be enabled whenever useful.</p></div>'; root.append(heading);
  suggestions.forEach(suggestion=>{const enabled=window.RegulaRusticaTasks.suggestionEnabled(data.tasks,record.id,suggestion.key);const row=document.createElement('div');row.className='routine-management-row suggested';row.innerHTML=`<div><strong>${escapeHtml(suggestion.title)}</strong><div class="meta">${enabled?'Enabled':'Disabled'} · ${escapeHtml(suggestion.frequency)}${suggestion.yieldType?' · records Yield on completion':''}</div></div>${enabled?'':'<button class="btn secondary">Enable</button>'}`;row.querySelector('button')?.addEventListener('click',()=>createSuggestedTask(record,suggestion));root.append(row);});
}

function completeTask(task) {
  if (task.completed) return;
  task.completed = true;
  task.status = 'completed';
  task.completedAt = nowIso();
  task.updatedAt = task.completedAt;
  if (task.recordId) addEvent(task.recordId, 'Task completed', task.title);
  if (task.recurrenceRule && !window.RegulaRusticaSync?.isInitialized?.()) createNextLocalOccurrence(task);
}

function openTaskYield(task) {
  const yieldType = task.yieldType;
  const defaults = window.RegulaRusticaHousekeeping.yieldDefaultsForTask(task, data.choreWindows);
  const workDate = defaults.date || today();
  openModal('yield', null, task.recordId, yieldType, workDate);
  yieldCompletionTaskId = task.id;
  $('#modalTitle').textContent = `Record ${window.RegulaRusticaTasks.YIELD_TYPES[yieldType]?.label || 'Yield'} & complete Task`;
  $('#modalSubmit').textContent = 'Record Yield & Complete';
  $('#modalCompleteWithoutYield').classList.remove('hidden');
  $('#modalFields [name=occurredAt]').value = `${workDate}T${defaults.time || '12:00'}`;
  if (defaults.session) $('#modalFields [name=session]').value = defaults.session;
}

function openTaskReopen(task, linkedYields) {
  yieldCompletionTaskId = null;
  modalMode = 'reopen-task';
  editId = task.id;
  contextRecordId = task.recordId || null;
  const count = linkedYields.length;
  $('#modalTitle').textContent = 'Reopen completed Task?';
  $('#modalFields').innerHTML = `<p>This Task has ${count} linked Yield record${count === 1 ? '' : 's'}. Choose whether to keep or delete ${count === 1 ? 'it' : 'them'}.</p>`;
  $('#modalDelete').classList.add('hidden');
  $('#modalCompleteWithoutYield').textContent = `Reopen and delete ${count === 1 ? 'Yield' : `${count} Yield records`}`;
  $('#modalCompleteWithoutYield').classList.remove('hidden');
  $('#modalSubmit').textContent = 'Reopen task only';
  $('#modal').showModal();
}

function chooseMatchingYieldTask(yieldEntry) {
  const matches = window.RegulaRusticaHousekeeping.matchingYieldTasks(data.tasks, yieldEntry);
  if (matches.length < 2) return matches[0] || null;
  const choices = matches.map((task, index) => `${index + 1}. ${task.title}`).join('\n');
  const answer = prompt(`More than one Task matches this Yield:\n\n${choices}\n\nEnter a number to complete that Task, or leave blank to leave Tasks unchanged.`);
  if (!answer) return null;
  const index = Number(answer) - 1;
  return Number.isInteger(index) && matches[index] ? matches[index] : null;
}

function taskYieldIndicator(task) {
  const indicators = {
    milk: { label: 'Milk', path: '<path d="M5 3h6v2l1 1v7H4V6l1-1V3Z"/><path d="M6 3V2h4v1M6 8h4"/>' },
    eggs: { label: 'Eggs', path: '<path d="M8 2c2 0 4 4.1 4 7a4 4 0 0 1-8 0c0-2.9 2-7 4-7Z"/>' },
    harvest: { label: 'Harvest', path: '<path d="M13 3C8 3 4 5.2 4 9c0 2 1.4 3 3 3 3.7 0 5.8-4 6-9Z"/><path d="M3 13c2-3 4.4-4.8 7-6"/>' },
    forage: { label: 'Hay / Forage', path: '<path d="M8 14V4M8 6 5 4M8 8 4 6M8 10 5 9M8 6l3-2M8 8l4-2M8 10l3-1"/>' },
    meat: { label: 'Meat Harvest', path: '<path d="M3 7h10l-1 6H4L3 7Z"/><path d="M5 7c.4-2 1.5-3 3-3s2.6 1 3 3"/>' }
  };
  const indicator = indicators[task.yieldType];
  if (!indicator) return '';
  return `<span class="task-yield-meta"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${indicator.path}</svg><span>${indicator.label}</span></span>`;
}

function sharedTaskRow(task, { suggestionActions = false } = {}) {
  const row = document.createElement('div');
  const disabledSeries = window.RegulaRusticaTasks.isDisabledRecurringTask(task);
  row.className = `task record-task-row shared-task-row${task.completed ? ' done' : ''}${disabledSeries ? ' disabled-series' : ''}`;
  const assignedTo = assigneeName(task.id);
  const recurrence = window.RegulaRusticaHousekeeping.recurrenceSummary(task.recurrenceRule);
  const choreWindow = choreWindowForTask(task)?.name || '';
  const metadata = [taskDateText(task), recurrence, choreWindow, assignedTo, task.recordId ? recordName(task.recordId) : '', task.priority !== 'normal' ? task.priority : '']
    .filter(Boolean).map(value => `<span>${escapeHtml(value)}</span>`);
  if (disabledSeries) metadata.unshift('<span>Disabled</span>');
  else if (taskIsOverdue(task)) metadata.unshift('<span class="task-overdue-meta">Overdue</span>');
  const yieldIndicator = taskYieldIndicator(task);
  if (yieldIndicator) metadata.push(yieldIndicator);
  const metadataHtml = metadata.join('<span class="record-task-separator" aria-hidden="true">·</span>');
  const recurringActions = disabledSeries
    ? '<button class="reenable" type="button">Re-enable</button>'
    : window.RegulaRusticaTasks.recurringOccurrenceActions(task).length
      ? '<button class="recurrence-actions" type="button">Skip / disable…</button>'
      : window.RegulaRusticaTasks.isBuiltInSuggestedTask(task)
        ? ''
        : '<button class="del" type="button">Delete</button>';
  row.innerHTML = `<input class="shared-task-check" type="checkbox" ${task.completed ? 'checked' : ''} ${disabledSeries ? 'disabled' : ''} aria-label="${disabledSeries ? 'Disabled' : 'Complete'} ${escapeHtml(task.title)}"><div class="task-body"><div class="task-title">${escapeHtml(task.title)}</div>${metadataHtml ? `<div class="record-task-meta">${metadataHtml}</div>` : ''}${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}</div><details class="task-more"><summary aria-label="Actions for ${escapeHtml(task.title)}">…</summary><div class="task-more-menu"><button class="edit" type="button">Edit</button>${recurringActions}</div></details>`;
  row.querySelector('.shared-task-check').addEventListener('change', event => {
    if (event.target.checked && task.yieldType && !task.completed) {
      const existingYield = window.RegulaRusticaHousekeeping.matchingYieldForTask(data.yieldEntries, task);
      if (existingYield && (!existingYield.taskId || existingYield.taskId === task.id)) {
        existingYield.taskId = task.id;
        existingYield.updatedAt = nowIso();
        completeTask(task);
        saveData();
      } else {
        event.target.checked = false;
        openTaskYield(task);
      }
      return;
    }
    if (!event.target.checked && task.completed) {
      const linkedYields = window.RegulaRusticaHousekeeping.linkedYieldsForTask(data.yieldEntries, task.id);
      if (linkedYields.length) {
        event.target.checked = true;
        openTaskReopen(task, linkedYields);
      } else {
        window.RegulaRusticaHousekeeping.reopenTask(task, data.yieldEntries, { timestamp: nowIso() });
        saveData();
      }
      return;
    }
    const wasCompleted = task.completed;
    task.completed = event.target.checked;
    task.status = task.completed ? 'completed' : 'open';
    task.completedAt = task.completed ? nowIso() : null;
    task.updatedAt = nowIso();
    if (!wasCompleted && task.completed && task.recordId) addEvent(task.recordId, 'Task completed', task.title);
    if (!wasCompleted && task.completed && task.recurrenceRule && !window.RegulaRusticaSync?.isInitialized?.()) createNextLocalOccurrence(task);
    saveData();
  });
  row.querySelector('.edit').addEventListener('click', () => openModal('task', task.id, task.recordId));
  row.querySelector('.reenable')?.addEventListener('click', () => {
    const timestamp = nowIso();
    const dueDate = task.dueDate && task.dueDate >= today() ? task.dueDate : today();
    window.RegulaRusticaTasks.reactivateRecurringSeries(data.tasks, task, { dueDate, updatedAt: timestamp });
    saveData();
  });
  row.querySelector('.recurrence-actions')?.addEventListener('click', () => openModal('task-lifecycle', task.id, task.recordId));
  row.querySelector('.del')?.addEventListener('click', () => {
    if (confirm('Delete this task?')) {
      window.RegulaRusticaTasks.deleteTask(task, nowIso());
      saveData();
    }
  });
  return row;
}

function taskRow(task) { return sharedTaskRow(task); }
function recordTaskRow(task) { return sharedTaskRow(task, { suggestionActions: true }); }

function renderToday() {
  const workDate = today();
  const projection = window.RegulaRusticaHousekeeping.dailyPlannerProjection({
    tasks: data.tasks,
    choreWindows: data.choreWindows,
    calendarEvents: data.calendarEvents,
    workDate,
    now: new Date()
  });
  const timeline = $('#todayTimeline');
  timeline.innerHTML = '';
  projection.schedule.forEach(item => {
    const timelineItem = document.createElement('article');
    timelineItem.className = `today-timeline-item ${item.type}${item.id === projection.currentId ? ' current' : ''}${item.id === projection.nextId ? ' next' : ''}`;
    const time = document.createElement('time');
    time.dateTime = item.time;
    time.textContent = clockTimeText(item.time);
    const marker = document.createElement('span');
    marker.className = 'today-timeline-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = item.type === 'window' ? '⌂' : '✦';
    const content = document.createElement('div');
    content.className = 'today-timeline-content';
    if (item.type === 'event') {
      content.classList.add('today-event-card');
      content.innerHTML = `<div><span class="label">Event</span><strong>${escapeHtml(item.event.title)}</strong>${item.event.location ? `<small>${escapeHtml(item.event.location)}</small>` : ''}${item.event.notes ? `<small>${escapeHtml(item.event.notes)}</small>` : ''}</div>`;
    } else {
      const due = item.tasks;
      const completed = item.completed;
      const yields = due.map(task => window.RegulaRusticaHousekeeping.matchingYieldForTask(data.yieldEntries, task)).filter(Boolean);
      const yieldSummary = [summarizeYield(yields.filter(entry => entry.type === 'milk')), summarizeYield(yields.filter(entry => entry.type === 'eggs'))].filter(value => value !== '0').join(' · ');
      const section = document.createElement('details');
      section.className = `today-window-card${completed === due.length && due.length ? ' complete' : ''}`;
      section.open = item.id === projection.currentId || item.id === projection.nextId;
      section.innerHTML = `<summary><span><span class="label">Chore Window</span><strong>${escapeHtml(item.window.name)}</strong><small>${completed} of ${due.length} complete${yieldSummary ? ` · ${escapeHtml(yieldSummary)}` : ''}</small></span><span class="caret" aria-hidden="true">⌄</span></summary><div class="stack chore-occurrences"></div><button class="btn secondary complete-window" type="button">Complete ${escapeHtml(item.window.name)}</button>`;
      due.forEach(task => section.querySelector('.chore-occurrences').append(taskRow(task)));
      section.querySelector('.complete-window').disabled = !due.length || completed === due.length;
      section.querySelector('.complete-window').addEventListener('click', () => {
      let cancelled = false;
      due.filter(task => !task.completed).forEach(task => {
        if (cancelled) return;
        if (!task.yieldType) completeTask(task);
        else if (window.RegulaRusticaHousekeeping.matchingYieldForTask(data.yieldEntries, task)) completeTask(task);
        else {
          const choice = prompt(`${task.title} has no matching Yield. Type R to record Yield, W to complete without Yield, or C to cancel.`, 'R')?.trim().toUpperCase();
          if (choice === 'W') completeTask(task);
          else if (choice === 'R') { cancelled = true; openTaskYield(task); }
          else cancelled = true;
        }
      });
      if (!yieldCompletionTaskId) saveData();
      });
      content.append(section);
    }
    timelineItem.append(time, marker, content);
    timeline.append(timelineItem);
  });
  $('#todayScheduleEmpty').classList.toggle('hidden', projection.schedule.length > 0);

  const allDayRoot = $('#todayAllDayEvents');
  allDayRoot.innerHTML = '';
  projection.allDayEvents.forEach(event => {
    const row = document.createElement('div');
    row.className = 'today-all-day-event';
    row.innerHTML = `<strong>${escapeHtml(event.title)}</strong>${event.location ? `<span>${escapeHtml(event.location)}</span>` : ''}`;
    allDayRoot.append(row);
  });
  $('#todayAllDaySection').classList.toggle('hidden', !projection.allDayEvents.length);

  const root = $('#todayTasks');
  root.innerHTML = '';
  projection.otherWork.forEach(task => root.appendChild(taskRow(task)));
  $('#todayEmpty').classList.toggle('hidden', projection.otherWork.length > 0);
  $('#todayTaskCount').textContent = projection.otherWork.length;

  const attentionRoot = $('#todayAttention');
  attentionRoot.innerHTML = '';
  projection.needsAttention.forEach(group => {
    const row = taskRow(group.task);
    if (group.count > 1) {
      const meta = row.querySelector('.record-task-meta') || row.querySelector('.task-body');
      const history = document.createElement('span');
      history.className = 'attention-history-count';
      history.textContent = `${group.count} overdue occurrences`;
      meta.append(history);
    }
    attentionRoot.append(row);
  });
  $('#todayAttentionCount').textContent = projection.needsAttention.length;
  $('#todayAttentionEmpty').classList.toggle('hidden', projection.needsAttention.length > 0);
  $('#todayAttentionHistoryNote').classList.toggle('hidden', projection.overdueOccurrenceCount <= projection.needsAttention.length);

  const firstWindow = projection.windowItems[0] || null;
  const lastWindow = projection.windowItems.length > 1 ? projection.windowItems.at(-1) : null;
  $('#todayFirstWindow').classList.toggle('hidden', !firstWindow);
  $('#todayFirstWindowName').textContent = firstWindow?.window.name || 'Chores';
  $('#todayFirstWindowProgress').textContent = firstWindow ? `${firstWindow.completed} of ${firstWindow.tasks.length} complete` : '';
  $('#todayLastWindow').classList.toggle('hidden', !lastWindow);
  $('#todayLastWindowName').textContent = lastWindow?.window.name || 'Chores';
  $('#todayLastWindowProgress').textContent = lastWindow ? `${lastWindow.completed} of ${lastWindow.tasks.length} complete` : '';
  const nextItem = projection.schedule.find(item => item.id === projection.currentId) || projection.schedule.find(item => item.id === projection.nextId) || null;
  $('#todayNextLabel').textContent = projection.currentId ? 'Now' : 'Next up';
  $('#todayNextUp').textContent = nextItem ? `${nextItem.type === 'window' ? nextItem.window.name : nextItem.event.title} at ${clockTimeText(nextItem.time)}` : 'Nothing scheduled';
  $('#todayNextUpDetail').textContent = nextItem?.type === 'event' ? nextItem.event.location : nextItem?.type === 'window' ? `${nextItem.completed} of ${nextItem.tasks.length} complete` : '';
  const choreCount = projection.windowItems.reduce((sum, item) => sum + item.tasks.length, 0);
  $('#todayTotals').textContent = choreCount || projection.otherWork.length ? `${choreCount} chores · ${projection.otherWork.length} other task${projection.otherWork.length === 1 ? '' : 's'}` : 'A quiet day';
  $('#todayEventTotal').textContent = `${projection.eventCount} event${projection.eventCount === 1 ? '' : 's'}`;

  ['todayWorkSection', 'todayAttentionSection'].forEach(id => {
    const section = $(`#${id}`);
    const storageKey = `regula-rustica:${id}:open`;
    if (section.dataset.collapseReady) return;
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored !== null) section.open = stored === 'true';
    } catch (_) { /* Session preference is optional. */ }
    section.addEventListener('toggle', () => {
      try { sessionStorage.setItem(storageKey, String(section.open)); } catch (_) { /* Session preference is optional. */ }
    });
    section.dataset.collapseReady = 'true';
  });
}

const INACTIVE_RECORD_STATUSES = new Set(['Sold', 'Deceased', 'Processed', 'Archived', 'Inactive', 'Out of Service', 'Completed', 'Cancelled']);

function profileAttachment(record) {
  if (!record?.profilePhotoAttachmentId) return null;
  return data.attachments.find(attachment => attachment.id === record.profilePhotoAttachmentId
    && attachment.recordId === record.id && !attachment.deletedAt && attachment.mimeType.startsWith('image/')) || null;
}

function populateProfileImage(img, fallback, record) {
  const attachment = profileAttachment(record);
  img.hidden = true;
  fallback.hidden = false;
  window.RegulaRusticaJournal.applyProfileCrop(img, record?.profilePhotoCrop);
  if (!attachment) return;
  const applyUrl = async retry => {
    try {
      const url = await window.RegulaRusticaDocuments.urlFor(attachment);
      if (!url && retry) return setTimeout(() => applyUrl(false), 400);
      if (!url || !img.isConnected || profileAttachment(record)?.id !== attachment.id) return;
      img.src = url;
      img.hidden = false;
      fallback.hidden = true;
    } catch (error) { console.warn('Profile photo could not be displayed.', error); }
  };
  applyUrl(true);
}

function nextTaskTiming(task) {
  if (!task) return '';
  if (!task.dueDate) return 'No due date';
  if (task.dueDate === today()) return 'Due today';
  if (task.dueDate < today()) return `Overdue · ${formatDate(task.dueDate)}`;
  return `Due ${formatDate(task.dueDate)}`;
}

function renderRecords() {
  const root = $('#recordGroups');
  root.innerHTML = '';
  const selectedType = document.querySelector('[name="recordTypeFilter"]:checked')?.value || 'all';
  const selectedStatus = $('#recordStatusFilter').value;
  const selectedSort = $('#recordSort').value;
  const grid = document.createElement('div');
  grid.className = 'records-grid';
  const records = data.records
    .filter(record => !record.deletedAt && (selectedType === 'all' || record.type === selectedType))
    .filter(record => selectedStatus === 'all' || (selectedStatus === 'inactive') === INACTIVE_RECORD_STATUSES.has(record.status));
  records.sort((a, b) => selectedSort === 'updated'
    ? (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)
    : selectedSort === 'added'
      ? b.createdAt.localeCompare(a.createdAt)
      : a.name.localeCompare(b.name));
  records
    .forEach(record => {
      const nextTask = data.tasks
        .filter(task => isTaskVisible(task) && task.recordId === record.id && !task.completed)
        .sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31'))[0];
      const card = document.createElement('article');
      card.className = 'record-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      const responsible = record.stewardship?.responsiblePersonId
        ? data.people.find(person => person.id === record.stewardship.responsiblePersonId && !person.deletedAt)?.displayName
        : '';
      card.innerHTML = `<div class="record-card-main"><div class="record-card-portrait" data-record-type="${escapeHtml(record.type)}" aria-hidden="true"><img alt="" hidden><span>${escapeHtml(record.name.slice(0, 1).toUpperCase() || record.type.slice(0, 1))}</span></div><div class="record-card-copy"><div class="record-card-title"><h3>${escapeHtml(record.name)}</h3><span class="pill">${escapeHtml(record.status)}</span></div><div class="meta">${escapeHtml(record.type)} · ${escapeHtml(identityText(record))}</div>${responsible ? `<div class="meta">Responsible: ${escapeHtml(responsible)}</div>` : ''}</div><span class="record-card-chevron" aria-hidden="true">›</span></div><div class="record-next">${nextTask ? `<strong>Next:</strong> ${escapeHtml(nextTask.title)} <span>${escapeHtml(nextTaskTiming(nextTask))}</span>` : '<span>No open task</span>'}</div>`;
      populateProfileImage(card.querySelector('img'), card.querySelector('.record-card-portrait span'), record);
      card.addEventListener('click', () => openRecord(record.id));
      card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openRecord(record.id);
        }
      });
      grid.appendChild(card);
    });
  if (grid.children.length) root.appendChild(grid);
  else root.innerHTML = '<div class="empty-panel">No records match this filter.</div>';
}

function eventChoices(record) {
  const standard = RECORD_CONFIG[record.type]?.events || [];
  const specialized = [];
  if (record.type === 'Animal') {
    const purpose = (record.identity?.purpose || '').toLowerCase();
    const species = (record.identity?.species || '').toLowerCase();
    if (purpose.includes('dairy')) specialized.push('Freshened', 'Dry Off');
    if (species.includes('bee') || purpose.includes('honey')) specialized.push('Inspection', 'Honey Harvest', 'Split', 'Requeened');
  }
  return [...new Set([...specialized, ...standard])].slice(0, 9).concat('Other');
}

function activeDocumentAttachments(documentId) {
  return data.attachments.filter(attachment => !attachment.deletedAt && attachment.documentId === documentId);
}

async function openStoredAttachment(attachment) {
  const opened = window.open('', '_blank');
  if (opened) opened.opener = null;
  try {
    const url = await window.RegulaRusticaDocuments.urlFor(attachment);
    if (!url) throw new Error('The attachment copy is unavailable.');
    if (opened) opened.location.href = url;
    else window.location.href = url;
  } catch (error) {
    opened?.close();
    alert(error.message || 'The attachment could not be opened.');
  }
}

async function deleteStoredAttachment(record, documentEntry, attachment) {
  if (!confirm(`Delete ${attachment.filename}? This permanently removes the stored file.`)) return;
  try {
    await window.RegulaRusticaDocuments.removeLocal([attachment.id]);
    const deletedAt = nowIso();
    attachment.deletedAt = deletedAt;
    attachment.updatedAt = deletedAt;
    attachment.syncState = attachment.storagePath ? 'pending' : 'local';
    attachment.syncError = '';
    const previousProfileId = record.profilePhotoAttachmentId;
    record.profilePhotoAttachmentId = window.RegulaRusticaDocuments.profileReferenceAfterAttachmentDelete(record.profilePhotoAttachmentId, attachment.id);
    if (previousProfileId && !record.profilePhotoAttachmentId) record.profilePhotoCrop = normalizeProfileCrop();
    record.updatedAt = deletedAt;
    if (!documentEntry.title && !documentEntry.body && activeDocumentAttachments(documentEntry.id).length === 0) {
      documentEntry.deletedAt = deletedAt;
      documentEntry.updatedAt = deletedAt;
    }
    saveData();
  } catch (error) { alert(error.message || 'The attachment could not be deleted.'); }
}

async function deleteDocumentEntry(record, documentEntry) {
  const attachments = activeDocumentAttachments(documentEntry.id);
  if (!confirm(attachments.length
    ? 'Delete this entry and all of its stored attachments? This cannot be undone.'
    : 'Delete this document entry?')) return;
  try {
    await window.RegulaRusticaDocuments.removeLocal(attachments.map(attachment => attachment.id));
    const deletedAt = nowIso();
    attachments.forEach(attachment => {
      attachment.deletedAt = deletedAt;
      attachment.updatedAt = deletedAt;
      attachment.syncState = attachment.storagePath ? 'pending' : 'local';
      attachment.syncError = '';
      const previousProfileId = record.profilePhotoAttachmentId;
      record.profilePhotoAttachmentId = window.RegulaRusticaDocuments.profileReferenceAfterAttachmentDelete(record.profilePhotoAttachmentId, attachment.id);
      if (previousProfileId && !record.profilePhotoAttachmentId) record.profilePhotoCrop = normalizeProfileCrop();
    });
    documentEntry.deletedAt = deletedAt;
    documentEntry.updatedAt = deletedAt;
    record.updatedAt = deletedAt;
    saveData();
  } catch (error) { alert(error.message || 'The document entry could not be deleted.'); }
}

async function openProfileCrop(record, attachment) {
  try {
    const url = await window.RegulaRusticaDocuments.urlFor(attachment);
    if (!url) throw new Error('The image copy is unavailable.');
    profileCropAttachmentId = attachment.id;
    profileCropDraft = normalizeProfileCrop(
      record.profilePhotoAttachmentId === attachment.id ? record.profilePhotoCrop : null
    );
    $('#profileCropImage').src = url;
    $('#profileCropZoom').value = String(profileCropDraft.zoom);
    window.RegulaRusticaJournal.applyProfileCrop($('#profileCropImage'), profileCropDraft);
    $('#profileCropDialog').showModal();
  } catch (error) {
    console.warn('Profile photo framing could not open.', error);
    alert(error.message || 'The profile photo could not be prepared.');
  }
}

function renderJournalAttachment(record, documentEntry, attachment) {
  const image = attachment.mimeType.startsWith('image/');
  const activeProfile = record.profilePhotoAttachmentId === attachment.id;
  const row = document.createElement('div');
  row.className = 'document-attachment';
  const syncLabel = window.RegulaRusticaDocuments.syncLabel(attachment);
  row.innerHTML = `${image ? '<div class="document-thumbnail"><img alt="" hidden><span aria-hidden="true">Image</span></div>' : '<div class="document-file-icon" aria-hidden="true">PDF</div>'}<div class="document-file-copy"><strong>${escapeHtml(attachment.filename)}</strong><span class="meta">${Math.max(1, Math.round(attachment.size / 1024))} KB${activeProfile ? ' · Profile photo' : ''} · ${escapeHtml(syncLabel)}</span></div><div class="document-file-actions"><button class="btn ghost open" type="button">Open</button>${image ? `<button class="btn ghost profile-crop" type="button">${activeProfile ? 'Adjust framing' : 'Set as profile'}</button>${activeProfile ? '<button class="btn ghost profile-remove" type="button">Remove profile</button>' : ''}` : ''}<button class="btn ghost delete" type="button">Delete</button></div>`;
  if (image) window.RegulaRusticaDocuments.urlFor(attachment).then(url => {
    if (!url) return;
    const img = row.querySelector('img');
    img.src = url; img.hidden = false; row.querySelector('.document-thumbnail span').hidden = true;
  }).catch(error => console.warn('Journal image preview could not be displayed.', error));
  row.querySelector('.open').addEventListener('click', () => openStoredAttachment(attachment));
  row.querySelector('.delete').addEventListener('click', () => deleteStoredAttachment(record, documentEntry, attachment));
  row.querySelector('.profile-crop')?.addEventListener('click', () => openProfileCrop(record, attachment));
  row.querySelector('.profile-remove')?.addEventListener('click', () => {
    record.profilePhotoAttachmentId = null;
    record.profilePhotoCrop = normalizeProfileCrop();
    record.updatedAt = nowIso();
    saveData();
  });
  return row;
}

function journalItemLabel(item) {
  if (item.kind === 'task') return 'Task';
  if (item.kind === 'yield') return 'Yield';
  if (item.kind === 'event') return 'Event';
  if (item.kind === 'legacy-note') return 'Note';
  if (item.categories.includes('notes')) return 'Note';
  if (item.categories.includes('photos') && !item.categories.includes('documents')) return 'Photo';
  return 'Document';
}

function renderJournal(record) {
  const root = $('#panelJournal');
  root.innerHTML = '';
  const items = window.RegulaRusticaJournal.filterJournalItems(
    window.RegulaRusticaJournal.buildJournalItems(data, record.id), journalFilter
  );
  items.forEach(journalItem => {
    const item = document.createElement('article');
    item.className = `journal-item journal-${journalItem.kind}`;
    const date = new Date(journalItem.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const label = journalItemLabel(journalItem);
    item.innerHTML = `<div class="journal-item-head"><span class="journal-type">${escapeHtml(label)}</span><span class="meta">${escapeHtml(date)}</span></div><div class="journal-item-content"></div>`;
    const content = item.querySelector('.journal-item-content');
    if (journalItem.kind === 'task') {
      content.innerHTML = `<h4>${escapeHtml(journalItem.task.title)}</h4>${journalItem.task.description ? `<p>${escapeHtml(journalItem.task.description)}</p>` : ''}<div class="meta">Completed task</div>`;
    } else if (journalItem.kind === 'yield') {
      const entry = journalItem.entry;
      const yieldLabel = window.RegulaRusticaTasks.YIELD_TYPES[entry.type]?.label || 'Yield';
      content.innerHTML = `<h4>${escapeHtml(journalItem.task?.title || yieldLabel)}</h4><p><strong>${escapeHtml(entry.quantity)} ${escapeHtml(entry.unit)}</strong>${entry.product ? ` · ${escapeHtml(entry.product)}` : ''}</p>${journalItem.task ? `<div class="meta">Task completed · ${escapeHtml(yieldLabel)} recorded</div>` : ''}${entry.details ? `<p>${escapeHtml(entry.details)}</p>` : ''}`;
    } else if (journalItem.kind === 'event') {
      const event = journalItem.event;
      content.innerHTML = `<div class="journal-title-actions"><h4>${escapeHtml(event.eventType)}</h4><button class="btn ghost delete-journal-event" type="button">Delete</button></div>${event.value ? `<p><strong>${escapeHtml(event.value)} ${escapeHtml(event.unit)}</strong></p>` : ''}${event.details ? `<p>${escapeHtml(event.details)}</p>` : ''}`;
      content.querySelector('.delete-journal-event').addEventListener('click', () => {
        if (!confirm('Delete this Journal entry?')) return;
        event.deletedAt = nowIso(); event.updatedAt = event.deletedAt; saveData();
      });
    } else if (journalItem.kind === 'legacy-note') {
      content.innerHTML = `<h4>${escapeHtml(journalItem.note.title || 'Note')}</h4><p>${escapeHtml(journalItem.note.text)}</p>`;
    } else {
      const documentEntry = journalItem.documentEntry;
      content.innerHTML = `<div class="journal-title-actions"><h4>${escapeHtml(documentEntry.title || label)}</h4><button class="btn ghost delete-document" type="button">Delete</button></div>${documentEntry.body ? `<p>${escapeHtml(documentEntry.body)}</p>` : ''}<div class="document-attachments"></div>`;
      journalItem.attachments.forEach(attachment => content.querySelector('.document-attachments').append(renderJournalAttachment(record, documentEntry, attachment)));
      content.querySelector('.delete-document').addEventListener('click', () => deleteDocumentEntry(record, documentEntry));
    }
    root.append(item);
  });
  if (!items.length) root.innerHTML = `<p class="muted record-empty">${journalFilter === 'all' ? 'Nothing has been recorded here yet.' : `No ${journalFilter} entries.`}</p>`;
}

function renderRecord() {
  const record = recordById(currentRecordId);
  if (!record) return showView(priorView);

  const portraitLetters = { Animal: 'A', Land: 'L', Equipment: 'E', Structure: 'S', Work: 'W' };
  $('#recordPortrait').dataset.recordType = record.type;
  $('#recordPortraitPlaceholder').textContent = portraitLetters[record.type] || 'R';
  populateProfileImage($('#recordPortraitImage'), $('#recordPortraitPlaceholder'), record);
  $('#recordTypeLabel').textContent = record.type;
  $('#recordTitle').textContent = record.name;
  $('#recordStatus').textContent = record.status;
  $('#recordIdentity').textContent = identityText(record);
  $('#recordStewardship').textContent = stewardshipText(record);
  const eligibleYieldTypes = window.RegulaRusticaTasks.eligibleYieldTypes(record);
  const yieldEligible = eligibleYieldTypes.length > 0;
  $('#recordSectionAddYield').classList.toggle('hidden', !yieldEligible);
  const recordAddYield = $('#recordAddYield');
  const recordAddYieldMenu = $('#recordAddYieldMenu');
  recordAddYield.classList.toggle('hidden', !yieldEligible);
  recordAddYield.setAttribute('aria-expanded', 'false');
  recordAddYieldMenu.classList.add('hidden');
  recordAddYieldMenu.innerHTML = '';
  eligibleYieldTypes.forEach(type => {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<strong>${escapeHtml(window.RegulaRusticaTasks.YIELD_TYPES[type].label)}</strong>`;
    button.addEventListener('click', () => {
      closeRecordAdd();
      openModal('yield', null, record.id, type);
    });
    recordAddYieldMenu.append(button);
  });

  const taskPanel = $('#panelTasks');
  taskPanel.innerHTML = '';
  const activeTasks = data.tasks
    .filter(task => isTaskVisible(task) && task.recordId === record.id && !task.completed)
    .sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31'));
  activeTasks.forEach(task => taskPanel.appendChild(recordTaskRow(task)));
  if (!taskPanel.children.length) taskPanel.innerHTML = '<p class="muted record-empty">No active tasks.</p>';
  renderSuggestedTasks(record);

  const nextTask = activeTasks[0];
  $('#recordOverviewTask').innerHTML = nextTask
    ? `<strong>${escapeHtml(nextTask.title)}</strong><div class="meta">${escapeHtml(taskDateText(nextTask))}</div>`
    : '<span class="muted">No upcoming tasks.</span>';

  const recentStart = new Date();
  recentStart.setHours(0, 0, 0, 0);
  recentStart.setDate(recentStart.getDate() - 29);
  const recordYields = data.yieldEntries
    .filter(entry => !entry.deletedAt && entry.recordId === record.id)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const recentYields = recordYields.filter(entry => new Date(entry.occurredAt) >= recentStart);
  const yieldSummary = [...new Set(recentYields.map(entry => entry.type))].map(type => {
    const label = window.RegulaRusticaTasks.YIELD_TYPES[type]?.label || 'Yield';
    return `${label}: ${summarizeYield(recentYields.filter(entry => entry.type === type))}`;
  }).join(' · ');
  $('#recordOverviewYieldWrap').classList.toggle('hidden', !yieldEligible && !recordYields.length);
  $('#recordOverviewYield').innerHTML = yieldSummary || '<span class="muted">No Yield recorded in the last 30 days.</span>';
  $('#recordYieldSummary').textContent = yieldSummary;
  const yieldList = $('#recordYieldList');
  yieldList.innerHTML = '';
  recentYields.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'record-yield-entry';
    const label = window.RegulaRusticaTasks.YIELD_TYPES[entry.type]?.label || 'Yield';
    row.innerHTML = `<div><strong>${escapeHtml(label)}${entry.product ? ` · ${escapeHtml(entry.product)}` : ''}</strong><div class="meta">${new Date(entry.occurredAt).toLocaleString()}</div></div><strong>${escapeHtml(entry.quantity)} ${escapeHtml(entry.unit)}</strong><div class="actions"><button class="btn ghost edit" type="button">Edit</button></div>`;
    row.querySelector('.edit').addEventListener('click', () => openModal('yield', entry.id, entry.recordId, entry.type));
    yieldList.appendChild(row);
  });
  if (!recentYields.length) yieldList.innerHTML = `<p class="muted record-empty">${yieldEligible ? 'No Yield recorded in the last 30 days.' : 'This Record does not produce tracked Yield.'}</p>`;

  const recentEvent = data.events
    .filter(event => !event.deletedAt && event.recordId === record.id && !data.yieldEntries.some(entry => !entry.deletedAt && entry.legacyEventId === event.id))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
  $('#recordOverviewEvent').innerHTML = recentEvent
    ? `<strong>${escapeHtml(recentEvent.eventType)}</strong><div class="meta">${formatDate(recentEvent.date)}</div>`
    : '<span class="muted">No events recorded yet.</span>';

  renderJournal(record);

  const ledgerPanel = $('#panelLedger');
  ledgerPanel.innerHTML = '';
  const recordLedgerItems = window.RegulaRusticaLedgerAllocations.entriesForRecord(data, record.id)
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date));
  if (recordLedgerItems.length) {
    const totals = window.RegulaRusticaLedgerAllocations.totalsForRecord(recordLedgerItems);
    const summary = document.createElement('div');
    summary.className = 'stats stats-spaced record-ledger-totals';
    summary.innerHTML = `<div class="stat"><strong class="money-out">${formatMoney(totals.expenses)}</strong><span>Expenses</span></div><div class="stat"><strong class="money-in">${formatMoney(totals.income)}</strong><span>Income</span></div><div class="stat"><strong>${formatMoney(totals.net)}</strong><span>Net</span></div>`;
    ledgerPanel.append(summary);
    recordLedgerItems.forEach(item => ledgerPanel.appendChild(ledgerRow(item.entry, { amount: item.amount, allocated: item.allocated, recordId: record.id })));
  } else {
    ledgerPanel.innerHTML = '<p class="muted record-empty">No ledger entries.</p>';
  }
}

function renderTasks() {
  const root = $('#allTasksList');
  const recordFilter = $('#taskRecordFilter');
  const assigneeFilter = $('#taskAssigneeFilter');
  const selectedRecord = recordFilter.value || 'all';
  const selectedAssignee = assigneeFilter.value || 'all';
  recordFilter.innerHTML = '<option value="all">All records</option><option value="standalone">Standalone</option>';
  data.records
    .filter(record => !record.deletedAt && record.status !== 'Archived')
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(record => recordFilter.add(new Option(`${record.name} (${record.type})`, record.id)));
  if ([...recordFilter.options].some(option => option.value === selectedRecord)) recordFilter.value = selectedRecord;
  assigneeFilter.innerHTML = '<option value="all">All people</option><option value="unassigned">Unassigned</option>';
  activePeople().forEach(person => assigneeFilter.add(new Option(`${personDisplayName(person)}${person.personType === 'child' ? ' (child)' : ''}`, person.id)));
  if ([...assigneeFilter.options].some(option => option.value === selectedAssignee)) assigneeFilter.value = selectedAssignee;

  const status = document.querySelector('[name="taskStatusFilter"]:checked')?.value || 'open';
  let tasks = window.RegulaRusticaTasks.filterTasksByStatus(data.tasks, status);
  const linkedRecord = recordFilter.value;
  const timing = document.querySelector('[name="taskTimingFilter"]:checked')?.value || 'all';
  const assignedPerson = assigneeFilter.value;
  const sort = $('#taskSort').value;
  if (linkedRecord === 'standalone') tasks = tasks.filter(task => !task.recordId);
  else if (linkedRecord !== 'all') tasks = tasks.filter(task => task.recordId === linkedRecord);
  if (assignedPerson === 'unassigned') tasks = tasks.filter(task => !assignmentForTask(task.id));
  else if (assignedPerson !== 'all') tasks = tasks.filter(task => assignmentForTask(task.id)?.personId === assignedPerson);
  if (timing === 'available') tasks = tasks.filter(task => !task.availableFrom || task.availableFrom <= today());
  if (timing === 'upcoming') tasks = tasks.filter(task => task.availableFrom && task.availableFrom > today());
  if (timing === 'dated') tasks = tasks.filter(task => task.availableFrom || task.dueDate);
  if (timing === 'unscheduled') tasks = tasks.filter(task => !task.availableFrom && !task.dueDate);
  const overdueFirst = (a, b) => Number(taskIsOverdue(b)) - Number(taskIsOverdue(a));
  if (sort === 'due') tasks.sort((a, b) => overdueFirst(a, b) || (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31'));
  if (sort === 'available') tasks.sort((a, b) => overdueFirst(a, b) || (a.availableFrom || '9999-12-31').localeCompare(b.availableFrom || '9999-12-31'));
  if (sort === 'record') tasks.sort((a, b) => overdueFirst(a, b) || (recordName(a.recordId) || 'Standalone').localeCompare(recordName(b.recordId) || 'Standalone'));
  if (sort === 'created') tasks.sort((a, b) => overdueFirst(a, b) || b.createdAt.localeCompare(a.createdAt));
  root.innerHTML = '';
  tasks.forEach(task => root.appendChild(taskRow(task)));
  if (!tasks.length) root.innerHTML = '<div class="empty-panel">No tasks match these filters.</div>';
}

function renderPeople() {
  const root = $('#childList');
  const memberRoot = $('#memberList');
  if (memberRoot) {
    memberRoot.innerHTML = '';
    data.people
      .filter(person => !person.deletedAt && person.personType === 'member')
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .forEach(person => {
        const row = document.createElement('div');
        row.className = 'settings-person-row';
        row.innerHTML = `<span class="settings-person-mark" aria-hidden="true">${escapeHtml(person.displayName.slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(person.displayName)}</strong><small>Account-backed household member · Task eligible</small></span>`;
        memberRoot.appendChild(row);
      });
    $('#memberEmpty')?.classList.toggle('hidden', memberRoot.children.length > 0);
  }
  root.innerHTML = '';
  data.people
    .filter(person => !person.deletedAt && person.personType === 'child')
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .forEach(person => {
      const row = document.createElement('div');
      row.className = 'task';
      row.innerHTML = `<div class="task-body"><strong>${escapeHtml(person.displayName)}</strong><div class="meta">Child · No account access</div></div><div class="actions"><button class="btn ghost edit" type="button">Rename</button><button class="btn ghost del" type="button">Remove</button></div>`;
      row.querySelector('.edit').addEventListener('click', () => {
        const nextName = prompt('Child name', person.displayName)?.trim();
        if (!nextName || nextName === person.displayName) return;
        person.displayName = nextName;
        person.updatedAt = nowIso();
        saveData();
      });
      row.querySelector('.del').addEventListener('click', () => {
        if (!confirm(`Remove ${person.displayName} from the Homestead? Open task assignments will become unassigned.`)) return;
        const timestamp = nowIso();
        person.deletedAt = timestamp;
        person.updatedAt = timestamp;
        data.assignments.filter(assignment => assignment.personId === person.id && !assignment.removedAt).forEach(assignment => {
          assignment.removedAt = timestamp;
          assignment.updatedAt = timestamp;
        });
        saveData();
      });
      root.appendChild(row);
    });
  $('#childEmpty').classList.toggle('hidden', root.children.length > 0);
}

function calendarEventTime(event) {
  if (event.allDay) return 'All day';
  if (!event.startTime) return 'Time not set';
  const [hours, minutes] = event.startTime.split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function calendarTaskLabel(task) {
  const assignedTo = assigneeName(task.id);
  return `${task.recurrenceRule ? '↻ ' : ''}${task.title}${assignedTo ? ` · ${assignedTo}` : ''}`;
}

function calendarTaskTitle(task) {
  const assignedTo = assigneeName(task.id);
  return `${taskDateText(task)}${assignedTo ? ` · Assigned to ${assignedTo}` : ''}${task.recurrenceRule ? ' · Recurring' : ''}`;
}

function openCalendarTask(task, event) {
  event.stopPropagation();
  openModal('task', task.id, task.recordId);
}

function renderCalendar() {
  const root = $('#calendarGrid');
  if (!root) return;
  root.innerHTML = '';
  const anchor = calendarView === 'month' ? new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1) : new Date(calendarMonth);
  const start = calendarView === 'month'
    ? new Date(anchor.getFullYear(), anchor.getMonth(), 1 - anchor.getDay())
    : calendarView === 'week'
      ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay())
      : anchor;
  const dayCount = calendarView === 'month' ? 42 : calendarView === 'week' ? 7 : 1;
  $('#calendarMonthLabel').textContent = calendarView === 'today'
    ? anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : calendarView === 'week'
      ? `Week of ${start.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`
      : anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  root.className = `calendar-grid calendar-${calendarView}`;
  (calendarView === 'today' ? [anchor.toLocaleDateString(undefined, { weekday: 'long' })] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).forEach(day => {
    const heading = document.createElement('div');
    heading.className = 'calendar-weekday';
    heading.textContent = day;
    root.appendChild(heading);
  });
  const showTasks = $('#calendarShowTasks').checked;
  const showEvents = $('#calendarShowEvents').checked;
  const showCompleted = $('#calendarShowCompleted').checked;
  const visibleTasks = data.tasks
    .filter(task => {
      if (!isTaskVisible(task) || (task.completed && !showCompleted)) return false;
      return showTasks;
    })
    .sort((a, b) => {
      const aBounds = window.RegulaRusticaHousekeeping.taskCalendarBounds(a);
      const bBounds = window.RegulaRusticaHousekeeping.taskCalendarBounds(b);
      return (aBounds?.start || '').localeCompare(bBounds?.start || '') || a.title.localeCompare(b.title);
    });
  const rangeTasks = visibleTasks.filter(task => {
    const bounds = window.RegulaRusticaHousekeeping.taskCalendarBounds(task);
    return bounds && bounds.start !== bounds.end;
  });
  const singleDateTasks = visibleTasks.filter(task => {
    const bounds = window.RegulaRusticaHousekeeping.taskCalendarBounds(task);
    return bounds && bounds.start === bounds.end;
  });
  for (let offset = 0; offset < dayCount; offset += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `calendar-day${calendarView === 'month' && date.getMonth() !== anchor.getMonth() ? ' outside' : ''}${dateKey === today() ? ' current' : ''}`;
    cell.innerHTML = `<span class="calendar-date">${date.getDate()}</span><span class="calendar-items"></span>`;
    cell.addEventListener('click', () => openModal('calendar', null, null, '', dateKey));
    const items = cell.querySelector('.calendar-items');
    const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
    const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
    const weekStartKey = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
    const weekEndKey = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;
    rangeTasks
      .filter(task => {
        const bounds = window.RegulaRusticaHousekeeping.taskCalendarBounds(task);
        return bounds.start <= weekEndKey && bounds.end >= weekStartKey;
      })
      .forEach(task => {
        const occursToday = Boolean(window.RegulaRusticaHousekeeping.taskCalendarSegment(task, dateKey));
        if (!occursToday) {
          const placeholder = document.createElement('span');
          placeholder.className = 'calendar-item calendar-placeholder';
          placeholder.textContent = '\u00a0';
          placeholder.setAttribute('aria-hidden', 'true');
          items.appendChild(placeholder);
          return;
        }
        const barSegment = window.RegulaRusticaHousekeeping.taskCalendarBarSegment(task, dateKey, date.getDay());
        const item = document.createElement('span');
        item.className = `calendar-item calendar-range-bar task-item${barSegment.starts ? ' bar-start' : ''}${barSegment.ends ? ' bar-end' : ''}${task.completed ? ' completed-item' : ''}`;
        item.textContent = barSegment.showLabel ? calendarTaskLabel(task) : '\u00a0';
        item.title = calendarTaskTitle(task);
        item.addEventListener('click', event => openCalendarTask(task, event));
        items.appendChild(item);
      });
    singleDateTasks
      .filter(task => window.RegulaRusticaHousekeeping.taskCalendarSegment(task, dateKey))
      .forEach(task => {
        const item = document.createElement('span');
        item.className = `calendar-item calendar-single-item task-item${task.completed ? ' completed-item' : ''}`;
        item.textContent = calendarTaskLabel(task);
        item.title = calendarTaskTitle(task);
        item.addEventListener('click', event => openCalendarTask(task, event));
        items.appendChild(item);
      });
    if (showEvents) {
      data.calendarEvents.filter(event => !event.deletedAt && event.startDate <= dateKey && event.endDate >= dateKey).forEach(event => {
        const item = document.createElement('span');
        item.className = 'calendar-item event-item';
        item.textContent = `${event.startDate === dateKey ? `${calendarEventTime(event)} · ` : ''}${event.title}`;
        item.addEventListener('click', click => { click.stopPropagation(); openModal('calendar', event.id, event.recordId); });
        items.appendChild(item);
      });
    }
    root.appendChild(cell);
  }
}

function summarizeYield(entries) {
  const totals = new Map();
  entries.forEach(entry => totals.set(entry.unit, (totals.get(entry.unit) || 0) + entry.quantity));
  return [...totals].map(([unit, quantity]) => `${Number(quantity.toFixed(2))} ${unit}`).join(' · ') || '0';
}

function selectedReportingRange(name) {
  const period = document.querySelector(`[name="${name}"]:checked`)?.value || '30';
  return window.RegulaRusticaHousekeeping.reportingDateRange(period, today());
}

function reportingRangeText(range) {
  if (!range.start) return 'All Time · all recorded dates';
  if (range.start === range.end) return `Today · ${formatDate(range.start)}`;
  const labels = { '7': 'Last 7 Days', '30': 'Last 30 Days', '90': 'Last 90 Days', ytd: 'Year to Date' };
  return `${labels[range.period] || 'Selected period'} · ${formatDate(range.start)} – ${formatDate(range.end)}`;
}

function yieldRow(entry) {
  const row = document.createElement('div');
  row.className = 'task yield-row';
  const yieldLabel = window.RegulaRusticaTasks.YIELD_TYPES[entry.type]?.label || 'Yield';
  row.innerHTML = `<div class="yield-mark" aria-hidden="true">${escapeHtml(yieldLabel.charAt(0))}</div><div class="task-body"><strong>${escapeHtml(recordName(entry.recordId) || 'Unlinked record')}</strong><div class="meta">${new Date(entry.occurredAt).toLocaleString()} · ${escapeHtml(entry.session)}</div>${entry.details ? `<div class="task-description">${escapeHtml(entry.details)}</div>` : ''}</div><strong>${escapeHtml(entry.quantity)} ${escapeHtml(entry.unit)}</strong>${entry.unusableQuantity ? `<span class="meta">${escapeHtml(entry.unusableQuantity)} unusable</span>` : ''}<div class="actions"><button class="btn ghost edit">Edit</button><button class="btn ghost del">Delete</button></div>`;
  row.querySelector('.edit').addEventListener('click', () => openModal('yield', entry.id, entry.recordId, entry.type));
  row.querySelector('.del').addEventListener('click', () => {
    if (confirm('Delete this yield entry?')) {
      entry.deletedAt = nowIso();
      entry.updatedAt = entry.deletedAt;
      saveData();
    }
  });
  return row;
}

function renderYield() {
  const active = data.yieldEntries.filter(entry => !entry.deletedAt);
  const range = selectedReportingRange('yieldDateFilter');
  const ranged = active.filter(entry => window.RegulaRusticaHousekeeping.matchesReportingDate(localDateTime(entry.occurredAt).slice(0, 10), range));
  const rangeText = reportingRangeText(range);
  $('#yieldSummaryPeriod').textContent = rangeText.split(' · ')[0];
  $('#yieldDateRange').textContent = rangeText;
  $('#todayMilkYield').textContent = summarizeYield(ranged.filter(entry => entry.type === 'milk'));
  $('#todayEggYield').textContent = summarizeYield(ranged.filter(entry => entry.type === 'eggs'));
  const root = $('#yieldList');
  root.innerHTML = '';
  const filter = document.querySelector('[name="yieldTypeFilter"]:checked')?.value || 'all';
  ranged.filter(entry => filter === 'all' || entry.type === filter).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).forEach(entry => root.appendChild(yieldRow(entry)));
  if (!root.children.length) root.innerHTML = '<div class="empty-panel">No yield matches this filter.</div>';
}

function ledgerRow(entry, options = {}) {
  const row = document.createElement('div');
  row.className = 'task';
  const amount = options.amount ?? entry.amount;
  const recordContext = Boolean(options.recordId);
  const allocationSummary = window.RegulaRusticaLedgerAllocations.entryAllocationSummary(data, entry);
  const allocationText = !recordContext && allocationSummary.items.length
    ? `Allocated ${formatMoney(allocationSummary.allocated)} · ${allocationSummary.items.map(item => item.record?.name).filter(Boolean).join(', ')}${allocationSummary.unallocated > .004 ? ` · ${formatMoney(allocationSummary.unallocated)} unallocated` : ''}`
    : '';
  const meta = [formatDate(entry.date), recordContext && options.allocated ? 'Allocated share' : '', !recordContext && entry.recordId ? recordName(entry.recordId) : ''].filter(Boolean).join(' · ');
  row.innerHTML = `<div class="task-body"><strong>${escapeHtml(entry.description)}</strong><div class="meta">${escapeHtml(meta)}</div>${allocationText ? `<div class="meta allocation-ledger-summary">${escapeHtml(allocationText)}</div>` : ''}</div><strong class="${entry.type === 'income' ? 'money-in' : 'money-out'}">${entry.type === 'income' ? '+' : '−'}${formatMoney(amount)}</strong><button class="btn ghost edit">Edit</button><button class="btn ghost del">Delete</button>`;
  row.querySelector('.edit').addEventListener('click', () => openModal('ledger', entry.id, entry.recordId));
  row.querySelector('.del').addEventListener('click', () => {
    if (confirm('Delete this ledger entry?')) {
      entry.deletedAt = nowIso();
      entry.updatedAt = entry.deletedAt;
      saveData();
    }
  });
  return row;
}

function renderLedger() {
  const root = $('#ledgerList');
  root.innerHTML = '';
  const filter = document.querySelector('[name="ledgerTypeFilter"]:checked')?.value || 'all';
  const range = selectedReportingRange('ledgerDateFilter');
  const ranged = data.ledger.filter(entry => !entry.deletedAt && window.RegulaRusticaHousekeeping.matchesReportingDate(entry.date, range));
  $('#ledgerDateRange').textContent = reportingRangeText(range);
  ranged.filter(entry => filter === 'all' || entry.type === filter).sort((a, b) => b.date.localeCompare(a.date)).forEach(entry => root.appendChild(ledgerRow(entry)));
  if (!root.children.length) root.innerHTML = '<div class="empty-panel">No ledger entries match this filter.</div>';
  const expenses = ranged.filter(entry => entry.type === 'expense').reduce((sum, entry) => sum + entry.amount, 0);
  const income = ranged.filter(entry => entry.type === 'income').reduce((sum, entry) => sum + entry.amount, 0);
  $('#expenseTotal').textContent = formatMoney(expenses);
  $('#incomeTotal').textContent = formatMoney(income);
  $('#ledgerNet').textContent = formatMoney(income - expenses);
}

function renderChoreWindows() {
  const root = $('#choreWindowList');
  if (!root) return;
  root.innerHTML = '';
  data.choreWindows.filter(window => !window.deletedAt).sort((a, b) => a.displayOrder - b.displayOrder).forEach(choreWindow => {
    const row = document.createElement('div');
    row.className = 'routine-management-row';
    const timeRange = choreWindowTimeText(choreWindow);
    const indicators = [choreWindow.systemKey ? 'Default' : '', choreWindow.enabled ? '' : 'Disabled'].filter(Boolean);
    row.innerHTML = `<div><strong>${escapeHtml(choreWindow.name)}</strong><div class="meta">${[timeRange, ...indicators].filter(Boolean).map(escapeHtml).join(' · ')}</div></div><div class="actions"><button class="btn ghost edit">Edit</button><button class="btn ghost toggle">${choreWindow.enabled ? 'Disable' : 'Enable'}</button></div>`;
    row.querySelector('.edit').addEventListener('click', () => openModal('chore-window', choreWindow.id));
    row.querySelector('.toggle').addEventListener('click', () => { choreWindow.enabled = !choreWindow.enabled; choreWindow.updatedAt = nowIso(); saveData(); });
    root.append(row);
  });
}

function renderAll() {
  $('#todayDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('#homesteadHeader').textContent = (data.settings.homesteadName || 'My Homestead').toUpperCase();
  $('#homesteadName').value = data.settings.homesteadName || '';
  renderToday();
  renderRecords();
  renderTasks();
  renderPeople();
  renderChoreWindows();
  renderSettingsSummary();
  renderCalendar();
  renderYield();
  renderLedger();
  if (currentRecordId && $('#recordView').classList.contains('active')) renderRecord();
}

function field(labelText, name, type = 'text', value = '', options = []) {
  const label = document.createElement('label');
  label.className = 'form-field';
  if (/\(optional\)/i.test(labelText)) label.classList.add('form-field-optional');
  label.textContent = labelText;
  let input;
  if (type === 'textarea') input = document.createElement('textarea');
  else if (type === 'select') {
    input = document.createElement('select');
    options.forEach(option => input.add(new Option(option, option)));
  } else {
    input = document.createElement('input');
    input.type = type;
    if (type === 'number') input.step = '0.01';
  }
  input.name = name;
  if (type === 'checkbox') {
    input.checked = Boolean(value);
    input.value = 'true';
  } else input.value = value ?? '';
  label.appendChild(input);
  return label;
}

function formSection(title) {
  const heading = document.createElement('h3');
  heading.className = 'form-section';
  heading.textContent = title;
  return heading;
}

function formRow(...items) {
  const row = document.createElement('div');
  row.className = 'form-field-row';
  items.filter(Boolean).forEach(item => row.append(item));
  return row;
}

function addRecordSelect(root, labelText, name, selected = '', excludeId = '') {
  const label = document.createElement('label');
  label.className = `form-field${/\(optional\)/i.test(labelText) ? ' form-field-optional' : ''}`;
  label.textContent = labelText;
  const select = document.createElement('select');
  select.name = name;
  select.add(new Option('None', ''));
  data.records
    .filter(record => !record.deletedAt && record.status !== 'Archived' && record.id !== excludeId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(record => select.add(new Option(`${record.name} (${record.type})`, record.id)));
  select.value = selected || '';
  label.appendChild(select);
  root.appendChild(label);
}

function addPersonSelect(root, selected = '') {
  const label = document.createElement('label');
  label.className = 'form-field form-field-optional';
  label.textContent = 'Assigned to (optional)';
  const select = document.createElement('select');
  select.name = 'personId';
  select.add(new Option('Unassigned', ''));
  activePeople().forEach(person => select.add(new Option(
    `${personDisplayName(person)}${person.personType === 'child' ? ' (child)' : ''}`,
    person.id
  )));
  select.value = selected || '';
  label.appendChild(select);
  root.appendChild(label);
}

function addRecurrenceFields(root, recurrenceRule) {
  const rule = window.RegulaRusticaHousekeeping.normalizeRecurrenceRule(recurrenceRule);
  const repeat = field('Repeat', 'recurrenceFrequency', 'select', rule?.frequency || '', ['', 'daily', 'weekly', 'monthly']);
  repeat.querySelector('option[value=""]').textContent = 'Does not repeat';
  root.append(repeat);
  const details = document.createElement('div');
  details.className = 'form-field-row recurrence-details';
  details.append(field('Repeat every', 'recurrenceInterval', 'number', rule?.interval || 1));
  details.querySelector('[name=recurrenceInterval]').min = '1';
  details.querySelector('[name=recurrenceInterval]').step = '1';
  const mode = field('Schedule from', 'recurrenceMode', 'select', rule?.mode || 'fixed_schedule', ['fixed_schedule', 'after_completion']);
  mode.querySelector('option[value=fixed_schedule]').textContent = 'Due date';
  mode.querySelector('option[value=after_completion]').textContent = 'Completion date';
  details.append(mode);
  const help = document.createElement('p');
  help.className = 'muted';
  help.textContent = 'Only the next occurrence is created when this task is completed.';
  details.append(help);
  root.append(details);
  const toggle = () => details.classList.toggle('hidden', !repeat.querySelector('select').value);
  repeat.querySelector('select').addEventListener('change', toggle);
  toggle();
}

function addYieldRecordSelect(root, type, selected = '') {
  const label = document.createElement('label');
  label.className = 'form-field';
  label.textContent = 'Record';
  const select = document.createElement('select');
  select.name = 'recordId';
  const records = data.records.filter(record => !record.deletedAt && record.status !== 'Archived' && window.RegulaRusticaTasks.eligibleYieldTypes(record).includes(type));
  records.sort((a,b)=>a.name.localeCompare(b.name)).forEach(record=>select.add(new Option(`${record.name} (${record.type})`,record.id)));
  select.value = selected || records[0]?.id || '';
  select.required = true;
  label.appendChild(select);
  root.appendChild(label);
}

function appendRecordFields(root, record, type) {
  const identity = record.identity || {};
  const stewardship = record.stewardship || {};
  const status = RECORD_CONFIG[type].statuses.includes(record.status) ? record.status : RECORD_CONFIG[type].statuses[0];
  root.append(field('Status', 'status', 'select', status, RECORD_CONFIG[type].statuses));

  if (type === 'Animal') {
    root.append(field('Managed as', 'managedAs', 'select', identity.managedAs || 'Individual', ['Individual', 'Group']));
    root.append(field('Species', 'species', 'text', identity.species));
    root.append(field('Breed', 'breed', 'text', identity.breed));
    root.append(field('Purpose', 'purpose', 'select', identity.purpose || 'Mixed', ['Dairy', 'Meat', 'Breeding', 'Eggs', 'Honey', 'Fiber', 'Draft', 'Companion', 'Mixed']));
    root.append(formSection('Details'));
    root.append(field('Sex (individual, optional)', 'sex', 'text', identity.sex));
    root.append(field('Birth date (optional)', 'birthDate', 'date', identity.birthDate));
    root.append(field('Tag, band, or ID (optional)', 'identifier', 'text', identity.identifier));
    root.append(field('Quantity (groups)', 'quantity', 'number', identity.quantity));
    root.append(field('Acquisition or hatch date (optional)', 'acquisitionDate', 'date', identity.acquisitionDate));
    root.append(field('Planned end or processing date (optional)', 'plannedEndDate', 'date', identity.plannedEndDate));
    root.append(field('Average weight (groups, optional)', 'averageWeight', 'text', identity.averageWeight));
  }
  if (type === 'Land') {
    root.append(field('Land type', 'landType', 'select', identity.landType || 'Pasture', ['Pasture', 'Garden Plot', 'Orchard', 'Hay Field', 'Woodlot', 'Pond', 'Wetland', 'Other']));
    root.append(field('Size (optional)', 'size', 'text', identity.size));
  }
  if (type === 'Equipment') {
    root.append(field('Equipment type', 'equipmentType', 'text', identity.equipmentType));
    root.append(formSection('Details'));
    root.append(field('Make (optional)', 'make', 'text', identity.make));
    root.append(field('Model (optional)', 'model', 'text', identity.model));
    root.append(field('Serial number (optional)', 'serialNumber', 'text', identity.serialNumber));
    root.append(field('Purchase date (optional)', 'purchaseDate', 'date', identity.purchaseDate));
  }
  if (type === 'Structure') {
    root.append(field('Structure type', 'structureType', 'text', identity.structureType));
    root.append(formSection('Details'));
    root.append(field('Location (optional)', 'structureLocation', 'text', identity.location));
  }
  if (type === 'Work') {
    root.append(field('Work type', 'workType', 'text', identity.workType));
    root.append(formSection('Details'));
    root.append(field('Start date (optional)', 'startDate', 'date', identity.startDate));
    root.append(field('Target completion date (optional)', 'targetDate', 'date', identity.targetDate));
    root.append(formSection('Relationships'));
    addRecordSelect(root, 'Linked record (optional)', 'linkedRecordId', identity.linkedRecordId, record.id);
    // TODO(v5+): add full Work-to-record conversion once Chronicle and ledger relinking can be guaranteed without duplication.
  }

  root.append(formSection('Stewardship'));
  if (type === 'Animal') {
    root.append(field('Current location', 'location', 'text', stewardship.location));
    root.append(field('Responsible person (optional)', 'responsible', 'text', stewardship.responsible));
  }
  if (type === 'Land') {
    root.append(field('Current use', 'currentUse', 'text', stewardship.currentUse));
    root.append(field('Current occupants (optional)', 'currentOccupants', 'text', stewardship.currentOccupants));
    root.append(field('Rotation or rest stage (optional)', 'rotationStage', 'text', stewardship.rotationStage));
  }
  if (type === 'Equipment') {
    root.append(field('Current location', 'location', 'text', stewardship.location));
    root.append(field('Assigned household member (optional)', 'responsible', 'text', stewardship.responsible));
    root.append(field('Service interval (optional)', 'serviceInterval', 'text', stewardship.serviceInterval));
  }
  if (type === 'Structure') {
    root.append(field('Current use', 'currentUse', 'text', stewardship.currentUse));
    root.append(field('Responsible household member (optional)', 'responsible', 'text', stewardship.responsible));
    root.append(field('Current condition (optional)', 'condition', 'text', stewardship.condition));
  }
  if (type === 'Work') {
    root.append(field('Responsible person (optional)', 'responsible', 'text', stewardship.responsible));
    root.append(field('Current stage (optional)', 'stage', 'text', stewardship.stage));
    root.append(field('Blocked by (optional)', 'blockedBy', 'text', stewardship.blockedBy));
  }
}

function openModal(nextMode, id = null, recordId = null, defaultType = '', defaultDate = null) {
  yieldCompletionTaskId = null;
  modalMode = nextMode;
  editId = id;
  contextRecordId = recordId || null;
  calendarDefaultDate = defaultDate;
  const root = $('#modalFields');
  root.innerHTML = '';
  const titles = { task: id ? 'Edit task' : 'Add task', 'task-lifecycle': 'Recurring task', record: id ? 'Edit record' : 'Add record', event: 'What happened?', note: 'Add note', document: 'Add Journal Entry', ledger: id ? 'Edit ledger entry' : 'Record expense or income', calendar: id ? 'Edit calendar event' : 'Add calendar event', yield: id ? 'Edit Yield' : `Record ${window.RegulaRusticaTasks.YIELD_TYPES[defaultType]?.label || 'Yield'}`, 'chore-window': id ? 'Edit Chore Window' : 'Add Chore Window' };
  const subtitles = { task: 'Create work for the homestead', record: 'Describe what is entrusted to your care', yield: 'Record what the homestead produced', ledger: 'Record one clear financial transaction', document: 'Write in this Record’s Journal' };
  $('#modalTitle').textContent = titles[nextMode];
  $('#modalSubtitle').textContent = subtitles[nextMode] || '';
  $('#modalSubtitle').classList.toggle('hidden', !subtitles[nextMode]);
  $('#modalForm').dataset.formMode = nextMode;
  $('#modalForm').classList.toggle('form-modal-long', ['task', 'record', 'yield', 'ledger'].includes(nextMode));
  $('#modalDelete').classList.toggle('hidden', !(id && ['calendar', 'yield'].includes(nextMode)));
  $('#modalCompleteWithoutYield').classList.add('hidden');
  $('#modalCompleteWithoutYield').textContent = 'Complete without recording Yield';
  $('#modalSubmit').textContent = 'Save';
  $('#modalSubmit').classList.toggle('hidden', nextMode === 'task-lifecycle');

  if (nextMode === 'task-lifecycle') {
    const task = data.tasks.find(item => item.id === id);
    const builtInSuggestion = window.RegulaRusticaTasks.isBuiltInSuggestedTask(task);
    const explanation = document.createElement('p');
    explanation.className = 'muted';
    explanation.textContent = builtInSuggestion
      ? 'Skip this occurrence or disable the Suggested Task for later reuse.'
      : 'Skip this occurrence, disable the series for later reuse, or delete the recurring task while keeping completed history.';
    const actions = document.createElement('div');
    actions.className = 'stack';
    const skip = document.createElement('button');
    skip.type = 'button'; skip.className = 'btn secondary'; skip.textContent = 'Skip this occurrence';
    const disable = document.createElement('button');
    disable.type = 'button'; disable.className = 'btn danger'; disable.textContent = 'Disable recurring task';
    const deleteSeries = document.createElement('button');
    deleteSeries.type = 'button'; deleteSeries.className = 'btn danger'; deleteSeries.textContent = 'Delete recurring task';
    skip.addEventListener('click', () => {
      if (window.RegulaRusticaTasks.skipRecurringOccurrence(task, nowIso())) saveData();
      $('#modal').close();
    });
    disable.addEventListener('click', () => {
      window.RegulaRusticaTasks.disableRecurringSeries(data.tasks, task, nowIso());
      saveData();
      $('#modal').close();
    });
    deleteSeries.addEventListener('click', () => {
      if (!confirm('Are you sure you want to delete this recurring task? Future occurrences will stop, and completed history will be kept.')) return;
      window.RegulaRusticaTasks.deleteRecurringSeries(data.tasks, task, nowIso());
      saveData();
      $('#modal').close();
    });
    actions.append(skip, disable);
    if (!builtInSuggestion) actions.append(deleteSeries);
    root.append(explanation, actions);
  }

  if (nextMode === 'chore-window') {
    const choreWindow = data.choreWindows.find(item => item.id === id) || {};
    const nameField = field('Name', 'name', 'text', choreWindow.name);
    const nameInput = nameField.querySelector('input');
    nameInput.required = true;
    nameInput.maxLength = 80;
    root.append(nameField);
    const times = document.createElement('div');
    times.className = 'grid2';
    const startField = field('Start time', 'startTime', 'time', choreWindow.startTime);
    const endField = field('End time', 'endTime', 'time', choreWindow.endTime);
    startField.querySelector('input').required = true;
    endField.querySelector('input').required = true;
    times.append(startField);
    times.append(endField);
    root.append(times);
    const error = document.createElement('p');
    error.className = 'form-error hidden';
    error.id = 'choreWindowError';
    error.setAttribute('role', 'alert');
    root.append(error);
  }

  if (nextMode === 'task') {
    const task = data.tasks.find(item => item.id === id) || {};
    const assignment = assignmentForTask(task.id);
    root.append(formSection('Task'));
    root.append(field('Task', 'title', 'text', task.title));
    const taskPeople = formRow();
    addRecordSelect(taskPeople, 'Linked record (optional)', 'recordId', recordId || task.recordId);
    addPersonSelect(taskPeople, assignment?.personId || personForAssignment(assignment)?.id);
    root.append(taskPeople, formSection('Schedule'));
    root.append(formRow(
      field('Start date (optional)', 'availableFrom', 'date', task.availableFrom),
      field('Due date (optional)', 'dueDate', 'date', task.dueDate)
    ));
    const scheduleFields = formRow();
    const windowLabel=document.createElement('label');windowLabel.className='form-field form-field-optional';windowLabel.textContent='Chore Window (optional)';const windowSelect=document.createElement('select');windowSelect.name='choreWindowId';windowSelect.add(new Option('None',''));data.choreWindows.filter(item=>!item.deletedAt&&item.enabled).sort((a,b)=>a.displayOrder-b.displayOrder).forEach(item=>windowSelect.add(new Option(item.name,item.id)));windowSelect.value=task.choreWindowId||'';windowLabel.append(windowSelect);scheduleFields.append(windowLabel);
    addRecurrenceFields(scheduleFields, task.recurrenceRule);
    root.append(scheduleFields, formSection('Details'));
    root.append(field('Notes (optional)', 'description', 'textarea', task.description));
    root.append(formRow(
      field('Priority', 'priority', 'select', task.priority || 'normal', ['low', 'normal', 'high', 'urgent']),
      field('On completion', 'yieldType', 'select', task.yieldType || '', ['', ...Object.keys(window.RegulaRusticaTasks.YIELD_TYPES)])
    ));
  }
  if (nextMode === 'note') root.append(field('What should I remember?', 'text', 'textarea'));
  if (nextMode === 'document') {
    root.append(formSection('Entry'));
    root.append(field('Title (optional)', 'title', 'text'));
    root.append(field('Journal entry (optional)', 'body', 'textarea'));
    root.append(formSection('Attachments'));
    const fileLabel = document.createElement('label');
    fileLabel.className = 'form-field form-field-optional';
    fileLabel.textContent = 'Attachments (optional)';
    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.multiple = true; fileInput.accept = 'application/pdf,image/jpeg,image/png,image/webp,image/gif';
    fileInput.addEventListener('change', () => { pendingDocumentFiles = [...fileInput.files]; });
    fileLabel.append(fileInput);
    root.append(fileLabel);
    if (pendingDocumentFiles.length) {
      const selected = document.createElement('p');
      selected.className = 'muted selected-document-files';
      selected.textContent = pendingDocumentFiles.map(file => file.name).join(' · ');
      root.append(selected);
    }
  }
  if (nextMode === 'ledger') {
    const entry = data.ledger.find(item => item.id === id) || {};
    root.append(formSection('Transaction'));
    root.append(field('Description', 'description', 'text', entry.description));
    root.append(field('Amount', 'amount', 'number', entry.amount));
    root.append(formSection('Details'));
    root.append(formRow(
      field('Date', 'date', 'date', entry.date || today()),
      field('Type', 'type', 'select', entry.type || 'expense', ['expense', 'income'])
    ));
    root.append(formSection('Allocation'));
    addRecordSelect(root, 'Linked record (optional)', 'recordId', recordId || entry.recordId);
    const allocationSlot = document.createElement('div');
    allocationSlot.className = 'form-extension-slot ledger-allocation-slot';
    root.append(allocationSlot, formSection('Receipt'));
    const receiptSlot = document.createElement('div');
    receiptSlot.className = 'form-extension-slot ledger-receipt-slot';
    root.append(receiptSlot);
  }
  if (nextMode === 'event') {
    const record = recordById(recordId);
    const choices = eventChoices(record);
    root.append(field('What happened?', 'eventType', 'select', choices[0], choices));
    root.append(field('Date', 'date', 'date', today()));
    root.append(field('Measurement or amount (optional)', 'value', 'text'));
    root.append(field('Unit (optional)', 'unit', 'text'));
    root.append(field('Details (describe Other here)', 'details', 'textarea'));
  }
  if (nextMode === 'calendar') {
    const calendarEvent = data.calendarEvents.find(item => item.id === id) || {};
    const startDate = calendarEvent.startDate || calendarDefaultDate || today();
    root.append(field('Event', 'title', 'text', calendarEvent.title));
    root.append(field('Start date', 'startDate', 'date', startDate));
    root.append(field('End date', 'endDate', 'date', calendarEvent.endDate || startDate));
    root.append(field('All day', 'allDay', 'checkbox', calendarEvent.allDay !== false));
    root.append(field('Start time (optional)', 'startTime', 'time', calendarEvent.startTime));
    root.append(field('End time (optional)', 'endTime', 'time', calendarEvent.endTime));
    root.append(field('Location (optional)', 'location', 'text', calendarEvent.location));
    root.append(field('Notes (optional)', 'notes', 'textarea', calendarEvent.notes));
    addRecordSelect(root, 'Linked record (optional)', 'recordId', recordId || calendarEvent.recordId);
  }
  if (nextMode === 'yield') {
    const entry = data.yieldEntries.find(item => item.id === id) || {};
    const type = entry.type || defaultType || 'milk';
    root.append(formSection('Yield'));
    const typeField = field('Yield type', 'yieldTypeDisplay', 'select', type, [type]);
    typeField.querySelector('select').disabled = true;
    root.append(typeField);
    const typeInput = document.createElement('input');
    typeInput.type = 'hidden';
    typeInput.name = 'yieldType';
    typeInput.value = type;
    root.append(typeInput);
    const yieldConfig=window.RegulaRusticaTasks.YIELD_TYPES[type];
    if (yieldConfig.productRequired) root.append(field('Crop or product', 'product', 'text', entry.product));
    root.append(formRow(
      field('Quantity', 'quantity', 'number', entry.quantity),
      field('Unit', 'unit', 'select', entry.unit || yieldConfig.defaultUnit, yieldConfig.units)
    ));
    root.append(field('Loss or unusable amount', 'unusableQuantity', 'number', entry.unusableQuantity || 0));
    root.append(formSection('When'));
    const defaultSession = type === 'milk' ? (new Date().getHours() < 15 ? 'morning' : 'evening') : 'other';
    root.append(formRow(
      field('Date and time', 'occurredAt', 'datetime-local', localDateTime(entry.occurredAt || new Date())),
      field('Session', 'session', 'select', entry.session || defaultSession, ['morning', 'evening', 'other'])
    ));
    root.append(formSection('Related To'));
    addYieldRecordSelect(root, type, recordId || entry.recordId);
    root.append(formSection('Notes'));
    root.append(field('Notes (optional)', 'details', 'textarea', entry.details));
  }
  if (nextMode === 'record') {
    const record = data.records.find(item => item.id === id) || { type: defaultType || 'Animal', name: '', status: 'Active', identity: {}, stewardship: {} };
    root.append(formSection('Identity'));
    root.append(formRow(
      field('Record type', 'type', 'select', record.type, RECORD_TYPES),
      field('Name', 'name', 'text', record.name)
    ));
    const typeFields = document.createElement('div');
    typeFields.className = 'form-grid';
    root.appendChild(typeFields);
    const redraw = () => {
      typeFields.innerHTML = '';
      appendRecordFields(typeFields, record, root.querySelector('[name=type]').value);
    };
    root.querySelector('[name=type]').addEventListener('change', redraw);
    redraw();
  }

  $('#modal').showModal();
  setTimeout(() => root.querySelector('input,textarea,select')?.focus(), 30);
}

function recordIdentityFromForm(type, form) {
  if (type === 'Animal') return { managedAs: form.managedAs, species: form.species, breed: form.breed, purpose: form.purpose, sex: form.sex, birthDate: form.birthDate, identifier: form.identifier, quantity: form.quantity ? Number(form.quantity) : '', acquisitionDate: form.acquisitionDate, plannedEndDate: form.plannedEndDate, averageWeight: form.averageWeight };
  if (type === 'Land') return { landType: form.landType, size: form.size };
  if (type === 'Equipment') return { equipmentType: form.equipmentType, make: form.make, model: form.model, serialNumber: form.serialNumber, purchaseDate: form.purchaseDate };
  if (type === 'Structure') return { structureType: form.structureType, location: form.structureLocation };
  return { workType: form.workType, startDate: form.startDate, targetDate: form.targetDate, linkedRecordId: form.linkedRecordId || '' };
}

function recordStewardshipFromForm(type, form) {
  const withResponsible = stewardship => ({ ...stewardship, responsiblePersonId: form.rrResponsiblePerson || '' });
  if (type === 'Animal') return withResponsible({ location: form.location, stage: form.stage });
  if (type === 'Land') return { currentUse: form.currentUse, currentOccupants: form.currentOccupants, rotationStage: form.rotationStage };
  if (type === 'Equipment') return withResponsible({ location: form.location, serviceInterval: form.serviceInterval });
  if (type === 'Structure') return withResponsible({ currentUse: form.currentUse, condition: form.condition });
  return withResponsible({ stage: form.stage, blockedBy: form.blockedBy });
}

$('#modalForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.target));

  if (modalMode === 'reopen-task') {
    const task = data.tasks.find(item => item.id === editId);
    if (task) {
      window.RegulaRusticaHousekeeping.reopenTask(task, data.yieldEntries, { timestamp: nowIso() });
      saveData();
    }
    $('#modal').close();
    return;
  }

  if (modalMode === 'chore-window') {
    const error = $('#choreWindowError');
    const name = form.name?.trim() || '';
    const startTime = form.startTime || '';
    const endTime = form.endTime || '';
    error.classList.add('hidden');
    if (!name) {
      error.textContent = 'Enter a name for this Chore Window.';
      error.classList.remove('hidden');
      return;
    }
    const timeValidation = window.RegulaRusticaTasks.validateWindowTimes(startTime, endTime);
    if (!timeValidation.valid) {
      error.textContent = timeValidation.message;
      error.classList.remove('hidden');
      return;
    }
    const existing = data.choreWindows.find(item => item.id === editId);
    if (existing) Object.assign(existing, { name, startTime, endTime, updatedAt: nowIso() });
    else {
      const nextOrder = Math.max(0, ...data.choreWindows.map(item => Number(item.displayOrder || 0))) + 10;
      data.choreWindows.push(window.RegulaRusticaTasks.normalizeWindow({ id: uid(), name, startTime, endTime, displayOrder: nextOrder, enabled: true, createdAt: nowIso() }));
    }
    saveData();
    $('#modal').close();
    return;
  }

  if (modalMode === 'task') {
    if (!form.title.trim()) return;
    if (form.availableFrom && form.dueDate && form.dueDate < form.availableFrom) {
      alert('The due date cannot be before the available date.');
      return;
    }
    const existing = data.tasks.find(task => task.id === editId);
    const recurrenceRule = window.RegulaRusticaHousekeeping.normalizeRecurrenceRule({
      ...(existing?.recurrenceRule || {}),
      frequency: form.recurrenceFrequency,
      mode: form.recurrenceMode,
      interval: form.recurrenceInterval
    });
    const linkedRecord=recordById(form.recordId);
    const yieldType=form.yieldType||null;
    if (yieldType && !window.RegulaRusticaTasks.eligibleYieldTypes(linkedRecord).includes(yieldType)) {
      alert('That Yield type is not available for the linked Record.'); return;
    }
    const values = { title: form.title.trim(), description: form.description.trim(), availableFrom: form.availableFrom || '', dueDate: form.dueDate || '', priority: form.priority || 'normal', recordId: form.recordId || null, recurrenceRule, choreWindowId:form.choreWindowId||null, yieldType };
    let taskId;
    if (existing) {
      Object.assign(existing, values, { updatedAt: nowIso() });
      taskId = existing.id;
    } else {
      const created = { id: uid(), ...values, completed: false, status: 'open', createdAt: nowIso(), updatedAt: nowIso(), completedAt: null, deletedAt: null };
      data.tasks.push(created);
      taskId = created.id;
    }
    setTaskAssignee(taskId, form.personId || '');
  }
  if (modalMode === 'note') {
    if (!form.text.trim()) return;
    data.notes.unshift({ id: uid(), recordId: contextRecordId, text: form.text.trim(), createdAt: nowIso(), updatedAt: nowIso() });
  }
  if (modalMode === 'document') {
    const files = [...pendingDocumentFiles];
    if (!form.title?.trim() && !form.body?.trim() && !files.length) {
      alert('Add a note or choose at least one attachment.');
      return;
    }
    const documentEntry = normalizeDocument({ id: uid(), recordId: contextRecordId, title: form.title?.trim(), body: form.body?.trim(), createdAt: nowIso() });
    const stored = [];
    try {
      $('#modalSubmit').disabled = true;
      for (const file of files) {
        const attachmentId = uid();
        const attachment = await window.RegulaRusticaDocuments.saveLocal(file, { attachmentId, recordId: contextRecordId });
        stored.push(normalizeAttachment({ ...attachment, documentId: documentEntry.id }));
      }
    } catch (error) {
      try { await window.RegulaRusticaDocuments.removeLocal(stored.map(attachment => attachment.id)); } catch (cleanupError) { console.warn('Local attachment cleanup failed.', cleanupError); }
      alert(error.message || 'The attachment could not be saved on this device. No document entry was created.');
      $('#modalSubmit').disabled = false;
      return;
    }
    $('#modalSubmit').disabled = false;
    data.documents.unshift(documentEntry);
    data.attachments.push(...stored);
    pendingDocumentFiles = [];
  }
  if (modalMode === 'event') {
    if (form.eventType === 'Other' && !form.details.trim()) {
      alert('Please describe what happened.');
      return;
    }
    addEvent(contextRecordId, form.eventType, form.details.trim(), { date: form.date, value: form.value, unit: form.unit });
    const record = recordById(contextRecordId);
    if (record?.type === 'Work' && form.eventType === 'Completed') {
      record.status = 'Completed';
      record.updatedAt = nowIso();
    }
  }
  if (modalMode === 'calendar') {
    if (!form.title.trim()) return;
    if (form.endDate < form.startDate || (form.endDate === form.startDate && form.startTime && form.endTime && form.endTime < form.startTime)) {
      alert('The event end cannot be before its start.');
      return;
    }
    const existing = data.calendarEvents.find(item => item.id === editId);
    const values = {
      title: form.title.trim(), startDate: form.startDate, endDate: form.endDate,
      allDay: form.allDay === 'true', startTime: form.startTime || '', endTime: form.endTime || '',
      location: form.location.trim(), notes: form.notes.trim(), recordId: form.recordId || null
    };
    if (existing) Object.assign(existing, values, { updatedAt: nowIso() });
    else data.calendarEvents.push(normalizeCalendarEvent({ id: uid(), ...values, createdAt: nowIso() }));
  }
  if (modalMode === 'yield') {
    const quantity = Number(form.quantity);
    const unusableQuantity = Number(form.unusableQuantity || 0);
    if (!form.recordId || !Number.isFinite(quantity) || quantity <= 0 || unusableQuantity < 0 || unusableQuantity > quantity) {
      alert('Choose a Record and enter a positive quantity. Unusable Yield cannot exceed the total.');
      return;
    }
    if (window.RegulaRusticaTasks.YIELD_TYPES[form.yieldType]?.productRequired && !form.product?.trim()) { alert('Enter the crop or product harvested.'); return; }
    const existing = data.yieldEntries.find(item => item.id === editId);
    const values = {
      recordId: form.recordId, type: form.yieldType, occurredAt: new Date(form.occurredAt).toISOString(),
      session: form.session, quantity, unit: form.unit, unusableQuantity, details: form.details.trim(), product:form.product?.trim()||'',
      taskId: existing?.taskId || yieldCompletionTaskId || null
    };
    const launchedTask = yieldCompletionTaskId ? data.tasks.find(task => task.id === yieldCompletionTaskId) : null;
    if (launchedTask && !window.RegulaRusticaHousekeeping.matchesYieldTask(launchedTask, values)) {
      alert('The Record, Yield type, and date must match the Task.');
      return;
    }
    const matchedTask = !existing && !values.taskId ? chooseMatchingYieldTask(values) : data.tasks.find(task => task.id === values.taskId);
    if (matchedTask) values.taskId = matchedTask.id;
    if (existing) Object.assign(existing, values, { updatedAt: nowIso() });
    else data.yieldEntries.unshift(normalizeYieldEntry({ id: uid(), ...values, createdAt: nowIso() }));
    if (matchedTask) completeTask(matchedTask);
  }
  if (modalMode === 'ledger') {
    if (!form.description.trim()) return;
    const existing = data.ledger.find(entry => entry.id === editId);
    const values = { type: form.type, date: form.date, amount: Number(form.amount || 0), description: form.description.trim(), recordId: form.recordId || null };
    if (existing) Object.assign(existing, values, { updatedAt: nowIso() });
    else data.ledger.unshift({ id: uid(), ...values, createdAt: nowIso(), updatedAt: nowIso(), deletedAt: null });
  }
  if (modalMode === 'record') {
    if (!form.name.trim()) return;
    const existing = data.records.find(record => record.id === editId);
    const timestamp = nowIso();
    const values = {
      type: form.type,
      name: form.name.trim(),
      status: form.status,
      identity: recordIdentityFromForm(form.type, form),
      stewardship: recordStewardshipFromForm(form.type, form),
      updatedAt: timestamp
    };
    if (existing) {
      const previousStatus = existing.status;
      Object.assign(existing, values, { updatedAt: nowIso() });
      if (previousStatus !== existing.status) addEvent(existing.id, 'Status changed', `${previousStatus} → ${existing.status}`);
    } else {
      const created = { id: uid(), ...values, createdAt: timestamp };
      data.records.push(created);
      addEvent(created.id, 'Record created', `${created.type} record created`);
    }
  }

  saveData();
  $('#modal').close();
});

$$('.nav button').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$('#globalAddTask').addEventListener('click', () => openModal('task'));
$('#tasksAddTask').addEventListener('click', () => openModal('task'));
$('#addRecord').addEventListener('click', () => openModal('record'));
$('#addLedger').addEventListener('click', () => openModal('ledger'));
$('#addCalendarEvent').addEventListener('click', () => openModal('calendar'));
$('#addMilkYield').addEventListener('click', () => openModal('yield', null, null, 'milk'));
$('#addEggYield').addEventListener('click', () => openModal('yield', null, null, 'eggs'));
$('#addMeatYield')?.addEventListener('click', () => openModal('yield',null,null,'meat'));
$('#addHarvestYield')?.addEventListener('click', () => openModal('yield',null,null,'harvest'));
$('#addForageYield')?.addEventListener('click', () => openModal('yield',null,null,'forage'));
$('#addChoreWindow').addEventListener('click', () => openModal('chore-window'));
const closeRecordAdd = () => {
  $('#recordAdd').open = false;
  $('#recordAddYield').setAttribute('aria-expanded', 'false');
  $('#recordAddYieldMenu').classList.add('hidden');
};
$('#recordEvent').addEventListener('click', () => { closeRecordAdd(); openModal('event', null, currentRecordId); });
const openCurrentRecordYield = () => { const type=window.RegulaRusticaTasks.eligibleYieldTypes(recordById(currentRecordId))[0]; if(type)openModal('yield',null,currentRecordId,type); };
$('#recordSectionAddYield').addEventListener('click', openCurrentRecordYield);
$('#recordAddTask').addEventListener('click', () => { closeRecordAdd(); openModal('task', null, currentRecordId); });
$('#recordAddYield').addEventListener('click', () => {
  const menu = $('#recordAddYieldMenu');
  const expanded = !menu.classList.toggle('hidden');
  $('#recordAddYield').setAttribute('aria-expanded', String(expanded));
});
$('#recordAddLedger').addEventListener('click', () => { closeRecordAdd(); openModal('ledger', null, currentRecordId); });
$('#recordEdit').addEventListener('click', () => openModal('record', currentRecordId));
const closeJournalAdd = () => { $('#journalAdd').open = false; };
$('#recordAddJournal').addEventListener('click', () => {
  closeRecordAdd();
  $('.record-section-nav button[data-record-section="journal"]').click();
  $('#journalAdd').open = true;
  $('#journalAdd').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
const openDocumentFromFiles = files => {
  const selected = [...files];
  if (!selected.length) return;
  pendingDocumentFiles = selected;
  closeJournalAdd();
  openModal('document', null, currentRecordId);
};
$('#journalAddNote').addEventListener('click', () => { pendingDocumentFiles = []; closeJournalAdd(); openModal('document', null, currentRecordId); });
$('#journalTakePhoto').addEventListener('click', () => { $('#journalCameraInput').value = ''; $('#journalCameraInput').click(); });
$('#journalChoosePhoto').addEventListener('click', () => { $('#journalPhotoInput').value = ''; $('#journalPhotoInput').click(); });
$('#journalAddFile').addEventListener('click', () => { $('#journalFileInput').value = ''; $('#journalFileInput').click(); });
$('#journalCameraInput').addEventListener('change', event => openDocumentFromFiles(event.target.files));
$('#journalPhotoInput').addEventListener('change', event => openDocumentFromFiles(event.target.files));
$('#journalFileInput').addEventListener('change', event => openDocumentFromFiles(event.target.files));
$$('[data-journal-filter]').forEach(button => button.addEventListener('click', () => {
  journalFilter = button.dataset.journalFilter;
  $$('[data-journal-filter]').forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  const record = recordById(currentRecordId);
  if (record) renderJournal(record);
}));
const updateProfileCropPreview = () => window.RegulaRusticaJournal.applyProfileCrop($('#profileCropImage'), profileCropDraft);
$('#profileCropZoom').addEventListener('input', event => {
  profileCropDraft = normalizeProfileCrop({ ...profileCropDraft, zoom: event.target.value });
  updateProfileCropPreview();
});
let profileCropDrag = null;
$('#profileCropPreview').addEventListener('pointerdown', event => {
  profileCropDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, crop: { ...profileCropDraft } };
  event.currentTarget.setPointerCapture(event.pointerId);
});
$('#profileCropPreview').addEventListener('pointermove', event => {
  if (!profileCropDrag || profileCropDrag.pointerId !== event.pointerId) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  profileCropDraft = normalizeProfileCrop({
    ...profileCropDraft,
    x: profileCropDrag.crop.x - ((event.clientX - profileCropDrag.x) / bounds.width) * 100,
    y: profileCropDrag.crop.y - ((event.clientY - profileCropDrag.y) / bounds.height) * 100
  });
  updateProfileCropPreview();
});
const endProfileCropDrag = event => {
  if (profileCropDrag?.pointerId === event.pointerId) profileCropDrag = null;
};
$('#profileCropPreview').addEventListener('pointerup', endProfileCropDrag);
$('#profileCropPreview').addEventListener('pointercancel', endProfileCropDrag);
const closeProfileCrop = () => { profileCropAttachmentId = null; profileCropDrag = null; $('#profileCropDialog').close(); };
$('#profileCropClose').addEventListener('click', closeProfileCrop);
$('#profileCropCancel').addEventListener('click', closeProfileCrop);
$('#profileCropForm').addEventListener('submit', event => {
  event.preventDefault();
  const record = recordById(currentRecordId);
  const attachment = data.attachments.find(item => item.id === profileCropAttachmentId && !item.deletedAt && item.recordId === record?.id && item.mimeType.startsWith('image/'));
  if (!record || !attachment) return closeProfileCrop();
  record.profilePhotoAttachmentId = attachment.id;
  record.profilePhotoCrop = normalizeProfileCrop(profileCropDraft);
  record.updatedAt = nowIso();
  closeProfileCrop();
  saveData();
});
$('.record-section-nav').addEventListener('click', event => {
  const button = event.target.closest('button[data-record-section]');
  if (!button) return;
  $$('.record-section-nav button').forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  });
  $$('.record-section-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.recordSectionPanel === button.dataset.recordSection));
});
$('#backToList').addEventListener('click', () => showView(priorView));
const cancelModal = () => { pendingDocumentFiles = []; $('#modal').close(); };
$('#modalClose').addEventListener('click', cancelModal);
$('#modalCancel').addEventListener('click', cancelModal);
$('#modalCompleteWithoutYield').addEventListener('click', () => {
  if (modalMode === 'reopen-task') {
    const task = data.tasks.find(item => item.id === editId);
    if (task) {
      window.RegulaRusticaHousekeeping.reopenTask(task, data.yieldEntries, { deleteLinkedYield: true, timestamp: nowIso() });
      saveData();
    }
    $('#modal').close();
    return;
  }
  const task = data.tasks.find(item => item.id === yieldCompletionTaskId);
  if (task) {
    completeTask(task);
    saveData();
  }
  $('#modal').close();
});
$('#modalDelete').addEventListener('click', () => {
  if (modalMode === 'calendar' && editId && confirm('Delete this calendar event?')) {
    const calendarEvent = data.calendarEvents.find(item => item.id === editId);
    if (calendarEvent) {
      calendarEvent.deletedAt = nowIso();
      calendarEvent.updatedAt = calendarEvent.deletedAt;
      saveData();
    }
    $('#modal').close();
  }
  if (modalMode === 'yield' && editId && confirm('Delete this yield entry?')) {
    const entry = data.yieldEntries.find(item => item.id === editId);
    if (entry) {
      entry.deletedAt = nowIso();
      entry.updatedAt = entry.deletedAt;
      saveData();
    }
    $('#modal').close();
  }
});
$$('.tabs-mini button').forEach(button => button.addEventListener('click', () => {
  $$('.tabs-mini button').forEach(item => item.classList.remove('active'));
  $$('.record-panel').forEach(panel => panel.classList.remove('active'));
  button.classList.add('active');
  $(`#panel${button.dataset.panel.charAt(0).toUpperCase()}${button.dataset.panel.slice(1)}`).classList.add('active');
}));
['taskRecordFilter', 'taskAssigneeFilter', 'taskSort'].forEach(id => $(`#${id}`).addEventListener('change', renderTasks));
$$('[name="taskStatusFilter"], [name="taskTimingFilter"]').forEach(input => input.addEventListener('change', renderTasks));
$$('[name="recordTypeFilter"]').forEach(input => input.addEventListener('change', renderRecords));
['recordStatusFilter', 'recordSort'].forEach(id => $(`#${id}`).addEventListener('change', renderRecords));
$$('[name="yieldTypeFilter"], [name="yieldDateFilter"]').forEach(input => input.addEventListener('change', renderYield));
$$('[name="ledgerTypeFilter"], [name="ledgerDateFilter"]').forEach(input => input.addEventListener('change', renderLedger));
$$('[data-settings-category]').forEach(button => button.addEventListener('click', () => showSettingsSection(button.dataset.settingsCategory)));
$$('.settings-back').forEach(button => button.addEventListener('click', () => showSettingsSection('home')));
if (window.matchMedia('(max-width: 520px)').matches) $('#taskAdvancedFilters').removeAttribute('open');
['#calendarShowTasks', '#calendarShowEvents', '#calendarShowCompleted']
  .forEach(selector => $(selector).addEventListener('change', renderCalendar));
$$('[name="calendarView"]').forEach(input => input.addEventListener('change', () => { calendarView = input.value; calendarMonth = new Date(); renderCalendar(); }));
$('#calendarPrevious').addEventListener('click', () => { const amount = calendarView === 'month' ? -1 : calendarView === 'week' ? -7 : -1; calendarMonth = calendarView === 'month' ? new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + amount, 1) : new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), calendarMonth.getDate() + amount); renderCalendar(); });
$('#calendarNext').addEventListener('click', () => { const amount = calendarView === 'month' ? 1 : calendarView === 'week' ? 7 : 1; calendarMonth = calendarView === 'month' ? new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + amount, 1) : new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), calendarMonth.getDate() + amount); renderCalendar(); });
$('#calendarToday').addEventListener('click', () => { calendarMonth = new Date(); renderCalendar(); });
$('#homesteadForm').addEventListener('submit', event => {
  event.preventDefault();
  data.settings.homesteadName = $('#homesteadName').value.trim() || 'My Homestead';
  saveData();
});
$('#childForm').addEventListener('submit', event => {
  event.preventDefault();
  const displayName = $('#childName').value.trim();
  if (!displayName) return;
  data.people.push(normalizePerson({ id: uid(), personType: 'child', displayName, createdAt: nowIso() }));
  $('#childName').value = '';
  saveData();
});
$('#exportData').addEventListener('click', exportData);
$('#importData').addEventListener('change', async event => {
  try {
    await importData(event.target.files[0]);
    alert('Backup restored.');
  } catch (error) {
    console.warn(error);
    alert('Invalid backup file. No data was changed.');
  }
  event.target.value = '';
});
$('#resetData').addEventListener('click', () => {
  if (confirm('Reset all records to sample data? Download a backup first if needed.')) saveData(structuredClone(SEED_DATA));
});

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(error => console.warn('Offline support could not start.', error)));
window.addEventListener('regula-rustica:cloud-context', () => {
  renderRecords();
  renderSettingsSummary();
  if (currentRecordId && $('#recordView').classList.contains('active')) renderRecord();
});

window.RegulaRustica = { normalizeData, migrateData, prepareImportedData, syncLocalAttachments, materializeRecurringTasks };
renderAll();
window.addEventListener('load', () => materializeRecurringTasks());
if (startupMigrationBefore) setTimeout(() => window.dispatchEvent(new CustomEvent('regula-rustica:data-saved', {
  detail: { before: startupMigrationBefore, after: structuredClone(data), source: 'migration' }
})), 0);
