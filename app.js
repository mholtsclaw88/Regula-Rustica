'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const STORAGE_KEY = 'regulaRusticaV5';
const LEGACY_KEYS = ['regulaRusticaV4', 'regulaRusticaV3'];
const MIGRATION_BACKUP_KEY = 'regulaRusticaPreV5Backup';
const IMPORT_BACKUP_KEY = 'regulaRusticaBeforeImport';
const RECORD_TYPES = ['Animal', 'Land', 'Equipment', 'Structure', 'Work'];
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
    createdAt,
    updatedAt: person.updatedAt || createdAt,
    deletedAt: person.deletedAt || null
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

function createNextLocalOccurrence(task) {
  if (!task.recurrenceRule || data.tasks.some(item => !item.deletedAt && item.parentTaskId === task.id)) return;
  const dueDate = window.RegulaRusticaHousekeeping.nextRecurringDueDate(task, today());
  if (!dueDate) return;
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
    createdAt,
    updatedAt: entry.updatedAt || createdAt,
    deletedAt: entry.deletedAt || null
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
    type: entry.type === 'eggs' ? 'eggs' : 'milk',
    occurredAt,
    session: ['morning', 'evening', 'other'].includes(entry.session) ? entry.session : 'other',
    quantity: Number(entry.quantity ?? entry.value ?? 0),
    unit: entry.unit || (entry.type === 'eggs' ? 'eggs' : 'gal'),
    unusableQuantity: Number(entry.unusableQuantity ?? entry.loss ?? 0),
    details: entry.details || entry.notes || '',
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

function normalizeData(source = {}) {
  const events = asArray(source.events).map(normalizeEvent);
  const yieldEntries = asArray(source.yieldEntries).map(normalizeYieldEntry);
  const people = asArray(source.people).map(normalizePerson);
  if (Number(source.schemaVersion || source.version || 0) < 6) {
    const migratedIds = new Set(yieldEntries.map(entry => entry.legacyEventId).filter(Boolean));
    events.forEach(event => {
      if (migratedIds.has(event.id)) return;
      const migrated = historicalYield(event);
      if (migrated) yieldEntries.push(migrated);
    });
  }
  return {
    schemaVersion: 8,
    settings: { homesteadName: source.settings?.homesteadName || 'My Homestead' },
    records: asArray(source.records).map(normalizeRecord),
    tasks: asArray(source.tasks).map(normalizeTask),
    people,
    relationships: asArray(source.relationships),
    assignments: asArray(source.assignments).map(assignment => normalizeAssignment(assignment, people)),
    events,
    notes: asArray(source.notes).map(normalizeNote),
    ledger: asArray(source.ledger).map(normalizeLedgerEntry),
    calendarEvents: asArray(source.calendarEvents).map(normalizeCalendarEvent),
    yieldEntries,
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
    legacy: { sourceKey, migratedAt, snapshot: source }
  });
}

function isSupportedData(value) {
  return [5, 6, 7, 8].includes(value?.schemaVersion) || [5, 6, 7, 8].includes(value?.version);
}

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
      const beforeMigration = normalizeData({ ...current, schemaVersion: 8 });
      const normalized = isSupportedData(current) ? normalizeData(current) : migrateData(current, STORAGE_KEY);
      if (current.schemaVersion !== 8) {
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
  data = normalizeData(nextData);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  persistedData = structuredClone(data);
  renderAll();
  window.dispatchEvent(new CustomEvent('regula-rustica:data-saved', { detail: { before, after: structuredClone(data), source } }));
}

function exportData() {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  link.download = `regula-rustica-v8-${today()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

window.RegulaRusticaLocal = {
  read: () => structuredClone(data),
  write: (nextData, source = 'sync') => saveData(nextData, source),
  exportBackup: exportData,
  storageKey: STORAGE_KEY
};

async function importData(file) {
  if (!file) return;
  const parsed = JSON.parse(await file.text());
  safelyStoreBackup(IMPORT_BACKUP_KEY, JSON.stringify(data));
  saveData(prepareImportedData(parsed, file.name || 'backup'));
}

const seedTimestamp = nowIso();
const SEED_DATA = {
  schemaVersion: 8,
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
  ledger: [],
  calendarEvents: [],
  yieldEntries: []
};

let data = loadData();
let persistedData = structuredClone(data);
let currentRecordId = null;
let priorView = 'records';
let modalMode = '';
let editId = null;
let contextRecordId = null;
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calendarDefaultDate = null;
let routineTaskId = null;

function recordById(id) {
  return data.records.find(record => record.id === id);
}

function recordName(id) {
  return recordById(id)?.name || '';
}

function activePeople() {
  return data.people.filter(person => !person.deletedAt).sort((a, b) => a.displayName.localeCompare(b.displayName));
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openRecord(id) {
  currentRecordId = id;
  $$('.view,.record-shell').forEach(element => element.classList.remove('active'));
  $$('.nav button').forEach(button => button.classList.remove('active'));
  $('#recordView').classList.add('active');
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

function routineOptions(record) {
  if (!record || record.type !== 'Animal' || record.status === 'Archived') return [];
  const purpose = String(record.identity?.purpose || '').toLowerCase();
  if (purpose === 'dairy') return ['milk_morning', 'milk_evening'];
  if (purpose === 'eggs') return ['egg_collection'];
  return [];
}

function routineButtonText(task) {
  return window.RegulaRusticaHousekeeping.routineYieldType(task) === 'eggs' ? 'Record Eggs' : 'Record Milk';
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

function openRoutineYield(task) {
  const session = window.RegulaRusticaHousekeeping.routineSession(task);
  const yieldType = window.RegulaRusticaHousekeeping.routineYieldType(task);
  const workDate = window.RegulaRusticaHousekeeping.taskWorkDate(task) || today();
  openModal('yield', null, task.recordId, yieldType, workDate);
  routineTaskId = task.id;
  $('#modalTitle').textContent = yieldType === 'eggs' ? 'Record eggs for this collection' : 'Record milk for this milking';
  $('#modalSubmit').textContent = 'Record Yield';
  $('#modalCompleteWithoutYield').classList.remove('hidden');
  $('#modalFields [name=session]').value = session;
  $('#modalFields [name=occurredAt]').value = `${workDate}T${session === 'morning' ? '07:00' : session === 'evening' ? '18:00' : '12:00'}`;
}

function chooseMatchingRoutineTask(yieldEntry) {
  const matches = window.RegulaRusticaHousekeeping.matchingRoutineTasks(data.tasks, yieldEntry);
  if (matches.length < 2) return matches[0] || null;
  const choices = matches.map((task, index) => `${index + 1}. ${task.title}`).join('\n');
  const answer = prompt(`More than one routine matches this yield:\n\n${choices}\n\nEnter a number to complete that routine, or leave blank to leave routines unchanged.`);
  if (!answer) return null;
  const index = Number(answer) - 1;
  return Number.isInteger(index) && matches[index] ? matches[index] : null;
}

function taskRow(task) {
  const row = document.createElement('div');
  row.className = `task${task.completed ? ' done' : ''}`;
  const assignedTo = assigneeName(task.id);
  const recurrence = window.RegulaRusticaHousekeeping.recurrenceSummary(task.recurrenceRule);
  const routineType = window.RegulaRusticaHousekeeping.routineType(task);
  const dueClass = !task.completed && task.dueDate && task.dueDate < today() ? ' overdue' : '';
  const meta = [
    `<span class="meta-pill${dueClass}">${escapeHtml(taskDateText(task))}</span>`,
    recurrence ? `<span class="meta-pill recurrence">${escapeHtml(recurrence)}</span>` : '',
    assignedTo ? `<span class="meta-pill assignee">${escapeHtml(assignedTo)}</span>` : '',
    task.recordId ? `<span class="meta-pill linked-record">${escapeHtml(recordName(task.recordId))}</span>` : '',
    task.priority !== 'normal' ? `<span class="meta-pill priority">${escapeHtml(task.priority)}</span>` : ''
  ].filter(Boolean).join('');
  row.innerHTML = `<input type="checkbox" ${task.completed ? 'checked' : ''} aria-label="Complete task"><div class="task-body"><div class="task-title">${escapeHtml(task.title)}</div><div class="meta-pills">${meta}</div>${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}</div><div class="actions"><button class="btn ghost edit">Edit</button><button class="btn ghost del">Delete</button></div>`;
  if (routineType) {
    const button = document.createElement('button');
    button.className = 'btn primary routine-record';
    button.textContent = task.completed ? 'Recorded' : routineButtonText(task);
    button.disabled = task.completed;
    row.querySelector('input').replaceWith(button);
    button.addEventListener('click', () => {
      const existingYield = window.RegulaRusticaHousekeeping.matchingYieldForTask(data.yieldEntries, task);
      if (existingYield && (!existingYield.taskId || existingYield.taskId === task.id)) {
        existingYield.taskId = task.id;
        existingYield.updatedAt = nowIso();
        completeTask(task);
        saveData();
      } else openRoutineYield(task);
    });
  }
  row.querySelector('input')?.addEventListener('change', event => {
    const wasCompleted = task.completed;
    task.completed = event.target.checked;
    task.status = task.completed ? 'completed' : 'open';
    task.completedAt = task.completed ? nowIso() : null;
    task.updatedAt = nowIso();
    if (!wasCompleted && task.completed && task.recordId) addEvent(task.recordId, 'Task completed', task.title);
    if (!wasCompleted && task.completed && task.recurrenceRule && !window.RegulaRusticaSync?.isInitialized?.()) createNextLocalOccurrence(task);
    saveData();
  });
  row.querySelector('.edit').addEventListener('click', () => openModal(routineType ? 'routine' : 'task', task.id, task.recordId));
  row.querySelector('.del').addEventListener('click', () => {
    if (confirm('Delete this task?')) {
      task.deletedAt = nowIso();
      task.updatedAt = task.deletedAt;
      saveData();
    }
  });
  return row;
}

function renderToday() {
  const root = $('#todayTasks');
  root.innerHTML = '';
  const tasks = data.tasks
    .filter(task => !task.deletedAt && !task.completed && (
      (!task.availableFrom && !task.dueDate)
      || (task.availableFrom && task.availableFrom <= today())
      || (!task.availableFrom && task.dueDate <= today())
    ))
    .sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31'));
  tasks.forEach(task => root.appendChild(taskRow(task)));
  $('#todayEmpty').classList.toggle('hidden', tasks.length > 0);
  $('#openCount').textContent = data.tasks.filter(task => !task.deletedAt && !task.completed).length;
  $('#recordCount').textContent = data.records.filter(record => !record.deletedAt && record.status !== 'Archived').length;
  $('#netCash').textContent = formatMoney(data.ledger.filter(entry => !entry.deletedAt).reduce((sum, entry) => sum + (entry.type === 'income' ? 1 : -1) * entry.amount, 0));
}

function renderRecords() {
  const root = $('#recordGroups');
  root.innerHTML = '';
  const selectedType = document.querySelector('[name="recordTypeFilter"]:checked')?.value || 'all';
  const grid = document.createElement('div');
  grid.className = 'records-grid';
  data.records
    .filter(record => !record.deletedAt && record.status !== 'Archived' && (selectedType === 'all' || record.type === selectedType))
    .sort((a, b) => RECORD_TYPES.indexOf(a.type) - RECORD_TYPES.indexOf(b.type) || a.name.localeCompare(b.name))
    .forEach(record => {
      const nextTask = data.tasks
        .filter(task => !task.deletedAt && task.recordId === record.id && !task.completed)
        .sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31'))[0];
      const card = document.createElement('article');
      card.className = 'record-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.innerHTML = `<div class="row"><div><span class="label">${escapeHtml(record.type)}</span><h3>${escapeHtml(record.name)}</h3></div><span class="pill">${escapeHtml(record.status)}</span></div><div class="meta">${escapeHtml(identityText(record))}</div><p class="record-next">${nextTask ? `Next: ${escapeHtml(nextTask.title)}` : 'No open task'}</p>`;
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

function renderRecord() {
  const record = recordById(currentRecordId);
  if (!record) return showView(priorView);

  $('#recordTypeLabel').textContent = record.type;
  $('#recordTitle').textContent = record.name;
  $('#recordStatus').textContent = record.status;
  $('#recordIdentity').textContent = identityText(record);
  $('#recordStewardship').innerHTML = `<span class="label">Stewardship</span><div>${escapeHtml(stewardshipText(record))}</div>`;
  const purpose = (record.identity?.purpose || '').toLowerCase();
  $('#recordMilk').classList.toggle('hidden', record.type !== 'Animal' || !purpose.includes('dairy'));
  $('#recordEggs').classList.toggle('hidden', record.type !== 'Animal' || !purpose.includes('egg'));
  $('#recordAddRoutine').classList.toggle('hidden', routineOptions(record).length === 0);

  const taskPanel = $('#panelTasks');
  taskPanel.innerHTML = '';
  data.tasks
    .filter(task => !task.deletedAt && task.recordId === record.id)
    .sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31'))
    .forEach(task => taskPanel.appendChild(taskRow(task)));
  if (!taskPanel.children.length) taskPanel.innerHTML = '<div class="empty-panel">No linked tasks or routines.</div>';

  const chroniclePanel = $('#panelChronicle');
  chroniclePanel.innerHTML = '';
  data.events
    .filter(event => !event.deletedAt && event.recordId === record.id && !data.yieldEntries.some(entry => !entry.deletedAt && entry.legacyEventId === event.id))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .forEach(event => {
      const item = document.createElement('div');
      item.className = 'chronicle-item';
      item.innerHTML = `<div class="row"><strong>${escapeHtml(event.eventType)}</strong><div class="actions"><span class="meta">${formatDate(event.date)}</span><button class="btn ghost del">Delete</button></div></div>${event.value ? `<div><strong>${escapeHtml(event.value)} ${escapeHtml(event.unit)}</strong></div>` : ''}${event.details ? `<p>${escapeHtml(event.details)}</p>` : ''}`;
      item.querySelector('.del').addEventListener('click', () => {
        if (confirm('Delete this Chronicle entry?')) {
          event.deletedAt = nowIso();
          event.updatedAt = event.deletedAt;
          saveData();
        }
      });
      chroniclePanel.appendChild(item);
    });
  data.yieldEntries
    .filter(entry => !entry.deletedAt && entry.recordId === record.id)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .forEach(entry => {
      const item = document.createElement('div');
      item.className = 'chronicle-item yield-chronicle';
      item.innerHTML = `<div class="row"><strong>${entry.type === 'milk' ? 'Milk' : 'Egg collection'}</strong><span class="meta">${new Date(entry.occurredAt).toLocaleString()}</span></div><div><strong>${escapeHtml(entry.quantity)} ${escapeHtml(entry.unit)}</strong> · ${escapeHtml(entry.session)}</div>${entry.unusableQuantity ? `<div class="meta">${escapeHtml(entry.unusableQuantity)} unusable</div>` : ''}${entry.details ? `<p>${escapeHtml(entry.details)}</p>` : ''}`;
      chroniclePanel.appendChild(item);
    });
  if (!chroniclePanel.children.length) chroniclePanel.innerHTML = '<div class="empty-panel">The Chronicle will grow as events are recorded.</div>';

  const notesPanel = $('#panelNotes');
  notesPanel.innerHTML = '';
  data.notes
    .filter(note => !note.deletedAt && note.recordId === record.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .forEach(note => {
      const item = document.createElement('div');
      item.className = 'chronicle-item';
      item.innerHTML = `<div class="row"><div>${escapeHtml(note.text)}</div><button class="btn ghost del">Delete</button></div><div class="meta">${new Date(note.createdAt).toLocaleDateString()}</div>`;
      item.querySelector('.del').addEventListener('click', () => {
        if (confirm('Delete this note?')) {
          note.deletedAt = nowIso();
          note.updatedAt = note.deletedAt;
          saveData();
        }
      });
      notesPanel.appendChild(item);
    });
  if (!notesPanel.children.length) notesPanel.innerHTML = '<div class="empty-panel">No enduring notes.</div>';

  const ledgerPanel = $('#panelLedger');
  ledgerPanel.innerHTML = '';
  data.ledger
    .filter(entry => !entry.deletedAt && entry.recordId === record.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .forEach(entry => ledgerPanel.appendChild(ledgerRow(entry)));
  if (!ledgerPanel.children.length) ledgerPanel.innerHTML = '<div class="empty-panel">No linked ledger entries.</div>';
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
  activePeople().forEach(person => assigneeFilter.add(new Option(`${person.displayName}${person.personType === 'child' ? ' (child)' : ''}`, person.id)));
  if ([...assigneeFilter.options].some(option => option.value === selectedAssignee)) assigneeFilter.value = selectedAssignee;

  let tasks = data.tasks.filter(task => !task.deletedAt);
  const status = document.querySelector('[name="taskStatusFilter"]:checked')?.value || 'open';
  const linkedRecord = recordFilter.value;
  const timing = document.querySelector('[name="taskTimingFilter"]:checked')?.value || 'all';
  const assignedPerson = assigneeFilter.value;
  const sort = $('#taskSort').value;
  tasks = tasks.filter(task => status === 'all' || (status === 'open' ? !task.completed : task.completed));
  if (linkedRecord === 'standalone') tasks = tasks.filter(task => !task.recordId);
  else if (linkedRecord !== 'all') tasks = tasks.filter(task => task.recordId === linkedRecord);
  if (assignedPerson === 'unassigned') tasks = tasks.filter(task => !assignmentForTask(task.id));
  else if (assignedPerson !== 'all') tasks = tasks.filter(task => assignmentForTask(task.id)?.personId === assignedPerson);
  if (timing === 'available') tasks = tasks.filter(task => !task.availableFrom || task.availableFrom <= today());
  if (timing === 'upcoming') tasks = tasks.filter(task => task.availableFrom && task.availableFrom > today());
  if (timing === 'dated') tasks = tasks.filter(task => task.availableFrom || task.dueDate);
  if (timing === 'unscheduled') tasks = tasks.filter(task => !task.availableFrom && !task.dueDate);
  if (sort === 'due') tasks.sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31'));
  if (sort === 'available') tasks.sort((a, b) => (a.availableFrom || '9999-12-31').localeCompare(b.availableFrom || '9999-12-31'));
  if (sort === 'record') tasks.sort((a, b) => (recordName(a.recordId) || 'Standalone').localeCompare(recordName(b.recordId) || 'Standalone'));
  if (sort === 'created') tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  root.innerHTML = '';
  tasks.forEach(task => root.appendChild(taskRow(task)));
  if (!tasks.length) root.innerHTML = '<div class="empty-panel">No tasks match these filters.</div>';
}

function renderPeople() {
  const root = $('#childList');
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
  openModal(window.RegulaRusticaHousekeeping.routineType(task) ? 'routine' : 'task', task.id, task.recordId);
}

function renderCalendar() {
  const root = $('#calendarGrid');
  if (!root) return;
  root.innerHTML = '';
  $('#calendarMonthLabel').textContent = calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
    const heading = document.createElement('div');
    heading.className = 'calendar-weekday';
    heading.textContent = day;
    root.appendChild(heading);
  });
  const showTasks = $('#calendarShowTasks').checked;
  const showRoutines = $('#calendarShowRoutines').checked;
  const showEvents = $('#calendarShowEvents').checked;
  const showCompleted = $('#calendarShowCompleted').checked;
  const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1 - calendarMonth.getDay());
  const visibleTasks = data.tasks
    .filter(task => {
      if (task.deletedAt || (task.completed && !showCompleted)) return false;
      const isRoutine = Boolean(window.RegulaRusticaHousekeeping.routineType(task));
      return isRoutine ? showRoutines : showTasks;
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
  for (let offset = 0; offset < 42; offset += 1) {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + offset);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `calendar-day${date.getMonth() !== calendarMonth.getMonth() ? ' outside' : ''}${dateKey === today() ? ' current' : ''}`;
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
        const routineType = window.RegulaRusticaHousekeeping.routineType(task);
        const item = document.createElement('span');
        item.className = `calendar-item calendar-range-bar ${routineType ? 'routine-item' : 'task-item'}${barSegment.starts ? ' bar-start' : ''}${barSegment.ends ? ' bar-end' : ''}${task.completed ? ' completed-item' : ''}`;
        item.textContent = barSegment.showLabel ? calendarTaskLabel(task) : '\u00a0';
        item.title = calendarTaskTitle(task);
        item.addEventListener('click', event => openCalendarTask(task, event));
        items.appendChild(item);
      });
    singleDateTasks
      .filter(task => window.RegulaRusticaHousekeeping.taskCalendarSegment(task, dateKey))
      .forEach(task => {
        const routineType = window.RegulaRusticaHousekeeping.routineType(task);
        const item = document.createElement('span');
        item.className = `calendar-item calendar-single-item ${routineType ? 'routine-item' : 'task-item'}${task.completed ? ' completed-item' : ''}`;
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

function yieldRow(entry) {
  const row = document.createElement('div');
  row.className = 'task yield-row';
  row.innerHTML = `<div class="yield-mark" aria-hidden="true">${entry.type === 'milk' ? 'M' : 'E'}</div><div class="task-body"><strong>${escapeHtml(recordName(entry.recordId) || 'Unlinked animal')}</strong><div class="meta">${new Date(entry.occurredAt).toLocaleString()} · ${escapeHtml(entry.session)}</div>${entry.details ? `<div class="task-description">${escapeHtml(entry.details)}</div>` : ''}</div><strong>${escapeHtml(entry.quantity)} ${escapeHtml(entry.unit)}</strong>${entry.unusableQuantity ? `<span class="meta">${escapeHtml(entry.unusableQuantity)} unusable</span>` : ''}<div class="actions"><button class="btn ghost edit">Edit</button><button class="btn ghost del">Delete</button></div>`;
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
  const todayEntries = active.filter(entry => localDateTime(entry.occurredAt).slice(0, 10) === localDateTime().slice(0, 10));
  $('#todayMilkYield').textContent = summarizeYield(todayEntries.filter(entry => entry.type === 'milk'));
  $('#todayEggYield').textContent = summarizeYield(todayEntries.filter(entry => entry.type === 'eggs'));
  const root = $('#yieldList');
  root.innerHTML = '';
  const filter = document.querySelector('[name="yieldTypeFilter"]:checked')?.value || 'all';
  active.filter(entry => filter === 'all' || entry.type === filter).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 30).forEach(entry => root.appendChild(yieldRow(entry)));
  if (!root.children.length) root.innerHTML = '<div class="empty-panel">No yield matches this filter.</div>';
}

function ledgerRow(entry) {
  const row = document.createElement('div');
  row.className = 'task';
  row.innerHTML = `<div class="task-body"><strong>${escapeHtml(entry.description)}</strong><div class="meta">${formatDate(entry.date)}${entry.recordId ? ` · ${escapeHtml(recordName(entry.recordId))}` : ''}</div></div><strong class="${entry.type === 'income' ? 'money-in' : 'money-out'}">${entry.type === 'income' ? '+' : '−'}${formatMoney(entry.amount)}</strong><button class="btn ghost edit">Edit</button><button class="btn ghost del">Delete</button>`;
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
  data.ledger.filter(entry => !entry.deletedAt && (filter === 'all' || entry.type === filter)).sort((a, b) => b.date.localeCompare(a.date)).forEach(entry => root.appendChild(ledgerRow(entry)));
  if (!root.children.length) root.innerHTML = '<div class="empty-panel">No ledger entries match this filter.</div>';
  const expenses = data.ledger.filter(entry => !entry.deletedAt && entry.type === 'expense').reduce((sum, entry) => sum + entry.amount, 0);
  const income = data.ledger.filter(entry => !entry.deletedAt && entry.type === 'income').reduce((sum, entry) => sum + entry.amount, 0);
  $('#expenseTotal').textContent = formatMoney(expenses);
  $('#incomeTotal').textContent = formatMoney(income);
  $('#ledgerNet').textContent = formatMoney(income - expenses);
}

function renderAll() {
  $('#todayDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  $('#homesteadHeader').textContent = (data.settings.homesteadName || 'My Homestead').toUpperCase();
  $('#homesteadName').value = data.settings.homesteadName || '';
  renderToday();
  renderRecords();
  renderTasks();
  renderPeople();
  renderCalendar();
  renderYield();
  renderLedger();
  if (currentRecordId && $('#recordView').classList.contains('active')) renderRecord();
}

function field(labelText, name, type = 'text', value = '', options = []) {
  const label = document.createElement('label');
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
  const heading = document.createElement('div');
  heading.className = 'form-section';
  heading.textContent = title;
  return heading;
}

function addRecordSelect(root, labelText, name, selected = '', excludeId = '') {
  const label = document.createElement('label');
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
  label.textContent = 'Assigned to (optional)';
  const select = document.createElement('select');
  select.name = 'personId';
  select.add(new Option('Unassigned', ''));
  activePeople().forEach(person => select.add(new Option(
    `${person.displayName}${person.personType === 'child' ? ' (child)' : ''}`,
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
  details.className = 'form-grid';
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

function addRoutineFields(root, task = {}, record) {
  const currentType = window.RegulaRusticaHousekeeping.routineType(task);
  const options = [...new Set([...routineOptions(record), currentType].filter(Boolean))];
  const routine = field('Routine', 'routineType', 'select', currentType || options[0], options);
  const labels = { milk_morning: 'Morning Milking', milk_evening: 'Evening Milking', egg_collection: 'Egg Collection' };
  routine.querySelectorAll('option').forEach(option => { option.textContent = labels[option.value] || option.value; });
  root.append(routine);
  root.append(field('First date', 'dueDate', 'date', task.dueDate || today()));
  const rule = window.RegulaRusticaHousekeeping.normalizeRecurrenceRule(task.recurrenceRule);
  root.append(field('Repeat', 'recurrenceFrequency', 'select', rule?.frequency || 'daily', ['daily', 'weekly', 'monthly']));
  const interval = field('Repeat every', 'recurrenceInterval', 'number', rule?.interval || 1);
  interval.querySelector('input').min = '1';
  interval.querySelector('input').step = '1';
  root.append(interval);
  addPersonSelect(root, assignmentForTask(task.id)?.personId || '');
  const help = document.createElement('p');
  help.className = 'muted';
  help.textContent = 'Recording the yield completes this occurrence and creates the next one.';
  root.append(help);
}

function addYieldAnimalSelect(root, type, selected = '') {
  const label = document.createElement('label');
  label.textContent = 'Animal';
  const select = document.createElement('select');
  select.name = 'recordId';
  let animals = data.records.filter(record => !record.deletedAt && record.type === 'Animal' && record.status !== 'Archived');
  const matched = animals.filter(record => (record.identity?.purpose || '').toLowerCase().includes(type === 'milk' ? 'dairy' : 'egg'));
  if (matched.length) animals = matched;
  animals.sort((a, b) => a.name.localeCompare(b.name)).forEach(record => select.add(new Option(record.name, record.id)));
  select.value = selected || animals[0]?.id || '';
  select.required = true;
  label.appendChild(select);
  root.appendChild(label);
}

function appendRecordFields(root, record, type) {
  const identity = record.identity || {};
  const stewardship = record.stewardship || {};
  root.append(formSection('Identity'));
  const status = RECORD_CONFIG[type].statuses.includes(record.status) ? record.status : RECORD_CONFIG[type].statuses[0];
  root.append(field('Status', 'status', 'select', status, RECORD_CONFIG[type].statuses));

  if (type === 'Animal') {
    root.append(field('Managed as', 'managedAs', 'select', identity.managedAs || 'Individual', ['Individual', 'Group']));
    root.append(field('Species', 'species', 'text', identity.species));
    root.append(field('Breed', 'breed', 'text', identity.breed));
    root.append(field('Purpose', 'purpose', 'select', identity.purpose || 'Mixed', ['Dairy', 'Meat', 'Breeding', 'Eggs', 'Honey', 'Fiber', 'Draft', 'Companion', 'Mixed']));
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
    root.append(field('Make (optional)', 'make', 'text', identity.make));
    root.append(field('Model (optional)', 'model', 'text', identity.model));
    root.append(field('Serial number (optional)', 'serialNumber', 'text', identity.serialNumber));
    root.append(field('Purchase date (optional)', 'purchaseDate', 'date', identity.purchaseDate));
  }
  if (type === 'Structure') {
    root.append(field('Structure type', 'structureType', 'text', identity.structureType));
    root.append(field('Location (optional)', 'structureLocation', 'text', identity.location));
  }
  if (type === 'Work') {
    root.append(field('Work type', 'workType', 'text', identity.workType));
    root.append(field('Start date (optional)', 'startDate', 'date', identity.startDate));
    root.append(field('Target completion date (optional)', 'targetDate', 'date', identity.targetDate));
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
  routineTaskId = null;
  modalMode = nextMode;
  editId = id;
  contextRecordId = recordId || null;
  calendarDefaultDate = defaultDate;
  const root = $('#modalFields');
  root.innerHTML = '';
  const titles = { task: id ? 'Edit task' : 'Add task', routine: id ? 'Edit routine' : 'Add routine', record: id ? 'Edit record' : 'Add record', event: 'Record', note: 'Add note', ledger: id ? 'Edit ledger entry' : 'Record expense or income', calendar: id ? 'Edit calendar event' : 'Add calendar event', yield: id ? 'Edit yield entry' : (defaultType === 'eggs' ? 'Record eggs' : 'Record milk') };
  $('#modalTitle').textContent = titles[nextMode];
  $('#modalDelete').classList.toggle('hidden', !(id && ['calendar', 'yield'].includes(nextMode)));
  $('#modalCompleteWithoutYield').classList.add('hidden');
  $('#modalSubmit').textContent = 'Save';

  if (nextMode === 'task') {
    const task = data.tasks.find(item => item.id === id) || {};
    const assignment = assignmentForTask(task.id);
    root.append(field('Task', 'title', 'text', task.title));
    root.append(field('Details (optional)', 'description', 'textarea', task.description));
    root.append(field('Start date (optional)', 'availableFrom', 'date', task.availableFrom));
    root.append(field('Due date (optional)', 'dueDate', 'date', task.dueDate));
    addRecurrenceFields(root, task.recurrenceRule);
    root.append(field('Priority', 'priority', 'select', task.priority || 'normal', ['low', 'normal', 'high', 'urgent']));
    addPersonSelect(root, assignment?.personId || personForAssignment(assignment)?.id);
    addRecordSelect(root, 'Linked record (optional)', 'recordId', recordId || task.recordId);
  }
  if (nextMode === 'routine') {
    const task = data.tasks.find(item => item.id === id) || {};
    const record = recordById(recordId || task.recordId);
    contextRecordId = record?.id || null;
    addRoutineFields(root, task, record);
  }
  if (nextMode === 'note') root.append(field('What should I remember?', 'text', 'textarea'));
  if (nextMode === 'ledger') {
    const entry = data.ledger.find(item => item.id === id) || {};
    root.append(field('Type', 'type', 'select', entry.type || 'expense', ['expense', 'income']));
    root.append(field('Date', 'date', 'date', entry.date || today()));
    root.append(field('Amount', 'amount', 'number', entry.amount));
    root.append(field('Description', 'description', 'text', entry.description));
    addRecordSelect(root, 'Linked record (optional)', 'recordId', recordId || entry.recordId);
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
    const type = entry.type || (defaultType === 'eggs' ? 'eggs' : 'milk');
    const typeField = field('Yield type', 'yieldTypeDisplay', 'select', type, [type]);
    typeField.querySelector('select').disabled = true;
    root.append(typeField);
    const typeInput = document.createElement('input');
    typeInput.type = 'hidden';
    typeInput.name = 'yieldType';
    typeInput.value = type;
    root.append(typeInput);
    addYieldAnimalSelect(root, type, recordId || entry.recordId);
    root.append(field('Date and time', 'occurredAt', 'datetime-local', localDateTime(entry.occurredAt || new Date())));
    const defaultSession = type === 'milk' ? (new Date().getHours() < 15 ? 'morning' : 'evening') : 'other';
    root.append(field('Session', 'session', 'select', entry.session || defaultSession, ['morning', 'evening', 'other']));
    root.append(field('Quantity', 'quantity', 'number', entry.quantity));
    root.append(field('Unit', 'unit', 'select', entry.unit || (type === 'eggs' ? 'eggs' : 'gal'), type === 'eggs' ? ['eggs'] : ['gal', 'qt', 'lb', 'L']));
    root.append(field('Loss or unusable amount', 'unusableQuantity', 'number', entry.unusableQuantity || 0));
    root.append(field('Notes (optional)', 'details', 'textarea', entry.details));
  }
  if (nextMode === 'record') {
    const record = data.records.find(item => item.id === id) || { type: defaultType || 'Animal', name: '', status: 'Active', identity: {}, stewardship: {} };
    root.append(field('Record type', 'type', 'select', record.type, RECORD_TYPES));
    root.append(field('Name', 'name', 'text', record.name));
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
  if (type === 'Animal') return { location: form.location, responsible: form.responsible, stage: form.stage };
  if (type === 'Land') return { currentUse: form.currentUse, currentOccupants: form.currentOccupants, rotationStage: form.rotationStage };
  if (type === 'Equipment') return { location: form.location, responsible: form.responsible, serviceInterval: form.serviceInterval };
  if (type === 'Structure') return { currentUse: form.currentUse, responsible: form.responsible, condition: form.condition };
  return { responsible: form.responsible, stage: form.stage, blockedBy: form.blockedBy };
}

$('#modalForm').addEventListener('submit', event => {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.target));

  if (modalMode === 'task') {
    if (!form.title.trim()) return;
    if (form.availableFrom && form.dueDate && form.dueDate < form.availableFrom) {
      alert('The due date cannot be before the available date.');
      return;
    }
    const existing = data.tasks.find(task => task.id === editId);
    const recurrenceRule = window.RegulaRusticaHousekeeping.normalizeRecurrenceRule({
      frequency: form.recurrenceFrequency,
      mode: form.recurrenceMode,
      interval: form.recurrenceInterval
    });
    const values = { title: form.title.trim(), description: form.description.trim(), availableFrom: form.availableFrom || '', dueDate: form.dueDate || '', priority: form.priority || 'normal', recordId: form.recordId || null, recurrenceRule };
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
  if (modalMode === 'routine') {
    const record = recordById(contextRecordId);
    const existing = data.tasks.find(task => task.id === editId);
    const allowed = [...new Set([...routineOptions(record), window.RegulaRusticaHousekeeping.routineType(existing || {})].filter(Boolean))];
    if (!record || !allowed.includes(form.routineType) || !form.dueDate) {
      alert('Choose an available routine and its first date.');
      return;
    }
    const duplicate = data.tasks.find(task => task.id !== existing?.id && !task.deletedAt && !task.completed
      && task.status !== 'completed' && task.recordId === record.id
      && window.RegulaRusticaHousekeeping.routineType(task) === form.routineType);
    if (duplicate) {
      alert(`This Animal already has an active ${window.RegulaRusticaHousekeeping.routineLabel(duplicate)} Routine.`);
      return;
    }
    const recurrenceRule = window.RegulaRusticaHousekeeping.normalizeRecurrenceRule({
      frequency: form.recurrenceFrequency,
      mode: 'fixed_schedule',
      interval: form.recurrenceInterval,
      routineType: form.routineType
    });
    const labels = { milk_morning: 'Morning Milking', milk_evening: 'Evening Milking', egg_collection: 'Egg Collection' };
    const values = {
      title: labels[form.routineType], description: '', availableFrom: '', dueDate: form.dueDate,
      priority: 'normal', recordId: record.id, recurrenceRule
    };
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
      alert('Choose an animal and enter a positive quantity. Unusable yield cannot exceed the total.');
      return;
    }
    const existing = data.yieldEntries.find(item => item.id === editId);
    const values = {
      recordId: form.recordId, type: form.yieldType, occurredAt: new Date(form.occurredAt).toISOString(),
      session: form.session, quantity, unit: form.unit, unusableQuantity, details: form.details.trim(),
      taskId: existing?.taskId || routineTaskId || null
    };
    const launchedTask = routineTaskId ? data.tasks.find(task => task.id === routineTaskId) : null;
    if (launchedTask && !window.RegulaRusticaHousekeeping.matchingRoutineTasks([launchedTask], values).length) {
      alert('The Animal, yield type, date, and session must match this Routine.');
      return;
    }
    const matchedTask = !existing && !values.taskId ? chooseMatchingRoutineTask(values) : data.tasks.find(task => task.id === values.taskId);
    if (matchedTask) values.taskId = matchedTask.id;
    if (existing) Object.assign(existing, values, { updatedAt: nowIso() });
    else data.yieldEntries.unshift(normalizeYieldEntry({ id: matchedTask?.id || uid(), ...values, createdAt: nowIso() }));
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
$('#todayAddTask').addEventListener('click', () => openModal('task'));
$('#tasksAddTask').addEventListener('click', () => openModal('task'));
$('#todayAddRecord').addEventListener('click', () => openModal('record'));
$('#addRecord').addEventListener('click', () => openModal('record'));
$('#addLedger').addEventListener('click', () => openModal('ledger'));
$('#addCalendarEvent').addEventListener('click', () => openModal('calendar'));
$('#addMilkYield').addEventListener('click', () => openModal('yield', null, null, 'milk'));
$('#addEggYield').addEventListener('click', () => openModal('yield', null, null, 'eggs'));
$('#recordEvent').addEventListener('click', () => openModal('event', null, currentRecordId));
$('#recordMilk').addEventListener('click', () => openModal('yield', null, currentRecordId, 'milk'));
$('#recordEggs').addEventListener('click', () => openModal('yield', null, currentRecordId, 'eggs'));
$('#recordAddRoutine').addEventListener('click', () => openModal('routine', null, currentRecordId));
$('#recordAddTask').addEventListener('click', () => openModal('task', null, currentRecordId));
$('#recordAddNote').addEventListener('click', () => openModal('note', null, currentRecordId));
$('#recordAddLedger').addEventListener('click', () => openModal('ledger', null, currentRecordId));
$('#recordEdit').addEventListener('click', () => openModal('record', currentRecordId));
$('#backToList').addEventListener('click', () => showView(priorView));
$('#modalClose').addEventListener('click', () => $('#modal').close());
$('#modalCancel').addEventListener('click', () => $('#modal').close());
$('#modalCompleteWithoutYield').addEventListener('click', () => {
  const task = data.tasks.find(item => item.id === routineTaskId);
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
$$('[name="yieldTypeFilter"]').forEach(input => input.addEventListener('change', renderYield));
$$('[name="ledgerTypeFilter"]').forEach(input => input.addEventListener('change', renderLedger));
$$('[data-settings-target]').forEach(button => button.addEventListener('click', () => {
  $$('[data-settings-target]').forEach(item => item.classList.toggle('active', item === button));
  $(`#${button.dataset.settingsTarget}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
if (window.matchMedia('(max-width: 520px)').matches) $('#taskAdvancedFilters').removeAttribute('open');
['#calendarShowTasks', '#calendarShowRoutines', '#calendarShowEvents', '#calendarShowCompleted']
  .forEach(selector => $(selector).addEventListener('change', renderCalendar));
$('#calendarPrevious').addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1); renderCalendar(); });
$('#calendarNext').addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1); renderCalendar(); });
$('#calendarToday').addEventListener('click', () => { calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); renderCalendar(); });
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

window.RegulaRustica = { normalizeData, migrateData, prepareImportedData };
renderAll();
if (startupMigrationBefore) setTimeout(() => window.dispatchEvent(new CustomEvent('regula-rustica:data-saved', {
  detail: { before: startupMigrationBefore, after: structuredClone(data), source: 'migration' }
})), 0);
