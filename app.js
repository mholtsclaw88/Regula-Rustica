'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const STORAGE_KEY = 'regulaRusticaV5';
const LEGACY_KEYS = ['regulaRusticaV4', 'regulaRusticaV3'];
const MIGRATION_BACKUP_KEY = 'regulaRusticaPreV5Backup';
const IMPORT_BACKUP_KEY = 'regulaRusticaBeforeImport';
const RECORD_TYPES = ['Animal', 'Land', 'Equipment', 'Structure', 'Work'];

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
const today = () => nowIso().slice(0, 10);
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
    recurrenceRule: task.recurrenceRule || null,
    parentTaskId: task.parentTaskId || null,
    createdAt,
    updatedAt: task.updatedAt || createdAt,
    completedAt: task.completedAt || (task.completed || task.done ? nowIso() : null),
    deletedAt: task.deletedAt || null
  };
}

function taskDateText(task) {
  if (task.availableFrom && task.dueDate) return `${formatDate(task.availableFrom)} – ${formatDate(task.dueDate)}`;
  if (task.availableFrom) return `Available ${formatDate(task.availableFrom)}`;
  if (task.dueDate) return `Due ${formatDate(task.dueDate)}`;
  return 'No date';
}

function normalizeEvent(event = {}) {
  const createdAt = event.createdAt || (event.date?.includes('T') ? event.date : nowIso());
  return {
    id: event.id || uid(),
    recordId: event.recordId || null,
    eventType: event.eventType || 'Other',
    date: (event.date || event.createdAt || today()).slice(0, 10),
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

function normalizeData(source = {}) {
  return {
    schemaVersion: 5,
    settings: { homesteadName: source.settings?.homesteadName || 'My Homestead' },
    records: asArray(source.records).map(normalizeRecord),
    tasks: asArray(source.tasks).map(normalizeTask),
    relationships: asArray(source.relationships),
    assignments: asArray(source.assignments),
    events: asArray(source.events).map(normalizeEvent),
    notes: asArray(source.notes).map(normalizeNote),
    ledger: asArray(source.ledger).map(normalizeLedgerEntry),
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

function isV5Data(value) {
  return value?.schemaVersion === 5 || value?.version === 5;
}

function prepareImportedData(value, sourceName = 'backup') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Backup must contain a data object.');
  return isV5Data(value) ? normalizeData(value) : migrateData(value, sourceName);
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
      const normalized = isV5Data(current) ? normalizeData(current) : migrateData(current, STORAGE_KEY);
      if (current.schemaVersion !== 5) localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
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
  link.download = `regula-rustica-v5-${today()}.json`;
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
  schemaVersion: 5,
  settings: { homesteadName: 'Wood Thief Homestead' },
  records: [
    { id: 'daisy', type: 'Animal', name: 'Daisy', status: 'Active', identity: { managedAs: 'Individual', species: 'Cattle', breed: 'Jersey', purpose: 'Dairy' }, stewardship: { location: 'Barn and east pasture', responsible: '', currentUse: 'Milk cow', stage: '' }, createdAt: seedTimestamp, updatedAt: seedTimestamp },
    { id: 'north', type: 'Land', name: 'North Paddock', status: 'Resting', identity: { landType: 'Pasture', size: '2 acres' }, stewardship: { currentUse: 'Rotational grazing', currentOccupants: '', rotationStage: 'Resting' }, createdAt: seedTimestamp, updatedAt: seedTimestamp },
    { id: 'tractor', type: 'Equipment', name: 'Ford 8N', status: 'Active', identity: { equipmentType: 'Tractor', make: 'Ford', model: '8N' }, stewardship: { location: 'Machine shed', responsible: '', serviceInterval: '' }, createdAt: seedTimestamp, updatedAt: seedTimestamp },
    { id: 'woodshed', type: 'Work', name: 'Build Woodshed', status: 'Planned', identity: { workType: 'Construction', startDate: '', targetDate: '', linkedRecordId: '' }, stewardship: { responsible: '', stage: 'Planning', blockedBy: '' }, createdAt: seedTimestamp, updatedAt: seedTimestamp }
  ],
  tasks: [{ id: uid(), title: 'Check Daisy and record morning milk', dueDate: today(), recordId: 'daisy', completed: false, createdAt: seedTimestamp, completedAt: null }],
  events: [],
  notes: [],
  ledger: []
};

let data = loadData();
let persistedData = structuredClone(data);
let currentRecordId = null;
let priorView = 'records';
let modalMode = '';
let editId = null;
let contextRecordId = null;

function recordById(id) {
  return data.records.find(record => record.id === id);
}

function recordName(id) {
  return recordById(id)?.name || '';
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
    .filter(([, value]) => displayValue(value))
    .map(([key, value]) => `${labels[key] || key}: ${value}`)
    .join(' · ') || 'No current stewardship details.';
}

function taskRow(task) {
  const row = document.createElement('div');
  row.className = `task${task.completed ? ' done' : ''}`;
  row.innerHTML = `<input type="checkbox" ${task.completed ? 'checked' : ''} aria-label="Complete task"><div class="task-body"><div class="task-title">${escapeHtml(task.title)}</div><div class="meta">${escapeHtml(taskDateText(task))}${task.recordId ? ` · ${escapeHtml(recordName(task.recordId))}` : ''}${task.priority !== 'normal' ? ` · ${escapeHtml(task.priority)}` : ''}</div>${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}</div><div class="actions"><button class="btn ghost edit">Edit</button><button class="btn ghost del">Delete</button></div>`;
  row.querySelector('input').addEventListener('change', event => {
    const wasCompleted = task.completed;
    task.completed = event.target.checked;
    task.status = task.completed ? 'completed' : 'open';
    task.completedAt = task.completed ? nowIso() : null;
    task.updatedAt = nowIso();
    if (!wasCompleted && task.completed && task.recordId) addEvent(task.recordId, 'Task completed', task.title);
    saveData();
  });
  row.querySelector('.edit').addEventListener('click', () => openModal('task', task.id, task.recordId));
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
  RECORD_TYPES.forEach(type => {
    const records = data.records.filter(record => !record.deletedAt && record.type === type && record.status !== 'Archived');
    if (!records.length) return;
    const block = document.createElement('div');
    block.className = 'type-block';
    block.innerHTML = `<div class="row"><h3>${RECORD_CONFIG[type].plural}</h3><button class="btn ghost add-type">+ Add</button></div><div class="type-grid"></div>`;
    block.querySelector('.add-type').addEventListener('click', () => openModal('record', null, null, type));
    records.forEach(record => {
      const nextTask = data.tasks.find(task => !task.deletedAt && task.recordId === record.id && !task.completed);
      const card = document.createElement('article');
      card.className = 'record-card';
      card.innerHTML = `<div class="row"><div><span class="label">${escapeHtml(record.type)}</span><h3>${escapeHtml(record.name)}</h3></div><span class="pill">${escapeHtml(record.status)}</span></div><div class="meta">${escapeHtml(identityText(record))}</div><p>${nextTask ? `Next: ${escapeHtml(nextTask.title)}` : 'No open task'}</p>`;
      card.addEventListener('click', () => openRecord(record.id));
      block.querySelector('.type-grid').appendChild(card);
    });
    root.appendChild(block);
  });
  if (!root.children.length) root.innerHTML = '<p class="empty">No records yet.</p>';
}

function eventChoices(record) {
  const standard = RECORD_CONFIG[record.type]?.events || [];
  const specialized = [];
  if (record.type === 'Animal') {
    const purpose = (record.identity?.purpose || '').toLowerCase();
    const species = (record.identity?.species || '').toLowerCase();
    if (purpose.includes('dairy')) specialized.push('Morning Milk', 'Evening Milk', 'Freshened', 'Dry Off');
    if (purpose.includes('egg')) specialized.push('Egg Collection');
    if (species.includes('bee') || purpose.includes('honey')) specialized.push('Inspection', 'Honey Harvest', 'Split', 'Requeened');
  }
  return [...new Set([...specialized, ...standard])].slice(0, 9).concat('Other');
}

function renderRecord() {
  const record = recordById(currentRecordId);
  if (!record) return showView(priorView);

  $('#recordTypeLabel').textContent = record.type;
  $('#recordTitle').textContent = record.name;
  $('#recordIdentity').textContent = identityText(record);
  $('#recordStewardship').innerHTML = `<span class="label">Stewardship</span><div>${escapeHtml(stewardshipText(record))}</div>`;

  const taskPanel = $('#panelTasks');
  taskPanel.innerHTML = '';
  data.tasks
    .filter(task => !task.deletedAt && task.recordId === record.id)
    .sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31'))
    .forEach(task => taskPanel.appendChild(taskRow(task)));
  if (!taskPanel.children.length) taskPanel.innerHTML = '<p class="empty">No linked tasks.</p>';

  const chroniclePanel = $('#panelChronicle');
  chroniclePanel.innerHTML = '';
  data.events
    .filter(event => !event.deletedAt && event.recordId === record.id)
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
  if (!chroniclePanel.children.length) chroniclePanel.innerHTML = '<p class="empty">The Chronicle will grow as events are recorded.</p>';

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
  if (!notesPanel.children.length) notesPanel.innerHTML = '<p class="empty">No enduring notes.</p>';

  const ledgerPanel = $('#panelLedger');
  ledgerPanel.innerHTML = '';
  data.ledger
    .filter(entry => !entry.deletedAt && entry.recordId === record.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .forEach(entry => ledgerPanel.appendChild(ledgerRow(entry)));
  if (!ledgerPanel.children.length) ledgerPanel.innerHTML = '<p class="empty">No linked ledger entries.</p>';
}

function renderTasks() {
  const root = $('#allTasksList');
  const recordFilter = $('#taskRecordFilter');
  const selectedRecord = recordFilter.value || 'all';
  recordFilter.innerHTML = '<option value="all">All records</option><option value="standalone">Standalone</option>';
  data.records
    .filter(record => !record.deletedAt && record.status !== 'Archived')
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(record => recordFilter.add(new Option(`${record.name} (${record.type})`, record.id)));
  if ([...recordFilter.options].some(option => option.value === selectedRecord)) recordFilter.value = selectedRecord;

  let tasks = data.tasks.filter(task => !task.deletedAt);
  const status = $('#taskStatusFilter').value;
  const linkedRecord = recordFilter.value;
  const timing = $('#taskTimingFilter').value;
  const sort = $('#taskSort').value;
  tasks = tasks.filter(task => status === 'all' || (status === 'open' ? !task.completed : task.completed));
  if (linkedRecord === 'standalone') tasks = tasks.filter(task => !task.recordId);
  else if (linkedRecord !== 'all') tasks = tasks.filter(task => task.recordId === linkedRecord);
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
  if (!tasks.length) root.innerHTML = '<p class="empty">No tasks match these filters.</p>';
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
  data.ledger.filter(entry => !entry.deletedAt).sort((a, b) => b.date.localeCompare(a.date)).forEach(entry => root.appendChild(ledgerRow(entry)));
  if (!root.children.length) root.innerHTML = '<p class="empty">No ledger entries yet.</p>';
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
  input.value = value ?? '';
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
    root.append(field('Current workflow (optional)', 'stage', 'text', stewardship.stage));
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

function openModal(nextMode, id = null, recordId = null, defaultType = '') {
  modalMode = nextMode;
  editId = id;
  contextRecordId = recordId || null;
  const root = $('#modalFields');
  root.innerHTML = '';
  const titles = { task: id ? 'Edit task' : 'Add task', record: id ? 'Edit record' : 'Add record', event: 'Record', note: 'Add note', ledger: id ? 'Edit ledger entry' : 'Record expense or income' };
  $('#modalTitle').textContent = titles[nextMode];

  if (nextMode === 'task') {
    const task = data.tasks.find(item => item.id === id) || {};
    root.append(field('Task', 'title', 'text', task.title));
    root.append(field('Details (optional)', 'description', 'textarea', task.description));
    root.append(field('When can this work begin? (optional)', 'availableFrom', 'date', task.availableFrom));
    root.append(field('When should it be completed? (optional)', 'dueDate', 'date', task.dueDate));
    root.append(field('Priority', 'priority', 'select', task.priority || 'normal', ['low', 'normal', 'high', 'urgent']));
    addRecordSelect(root, 'Linked record (optional)', 'recordId', recordId || task.recordId);
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
    const values = { title: form.title.trim(), description: form.description.trim(), availableFrom: form.availableFrom || '', dueDate: form.dueDate || '', priority: form.priority || 'normal', recordId: form.recordId || null };
    if (existing) Object.assign(existing, values, { updatedAt: nowIso() });
    else data.tasks.push({ id: uid(), ...values, completed: false, status: 'open', createdAt: nowIso(), updatedAt: nowIso(), completedAt: null, deletedAt: null });
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
$('#recordEvent').addEventListener('click', () => openModal('event', null, currentRecordId));
$('#recordAddTask').addEventListener('click', () => openModal('task', null, currentRecordId));
$('#recordAddNote').addEventListener('click', () => openModal('note', null, currentRecordId));
$('#recordAddLedger').addEventListener('click', () => openModal('ledger', null, currentRecordId));
$('#recordEdit').addEventListener('click', () => openModal('record', currentRecordId));
$('#backToList').addEventListener('click', () => showView(priorView));
$('#modalClose').addEventListener('click', () => $('#modal').close());
$('#modalCancel').addEventListener('click', () => $('#modal').close());
$$('.tabs-mini button').forEach(button => button.addEventListener('click', () => {
  $$('.tabs-mini button').forEach(item => item.classList.remove('active'));
  $$('.record-panel').forEach(panel => panel.classList.remove('active'));
  button.classList.add('active');
  $(`#panel${button.dataset.panel.charAt(0).toUpperCase()}${button.dataset.panel.slice(1)}`).classList.add('active');
}));
['taskStatusFilter', 'taskRecordFilter', 'taskTimingFilter', 'taskSort'].forEach(id => $(`#${id}`).addEventListener('change', renderTasks));
$('#homesteadForm').addEventListener('submit', event => {
  event.preventDefault();
  data.settings.homesteadName = $('#homesteadName').value.trim() || 'My Homestead';
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
