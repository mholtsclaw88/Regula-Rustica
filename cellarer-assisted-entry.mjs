export const CELLARER_FEATURE_KEY = 'cellarer_assisted_entry';

export const CELLARER_DRAFT_KINDS = Object.freeze([
  'task', 'yield', 'ledger', 'journal_note', 'record_event', 'calendar_event'
]);

const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };
const nullableBoolean = { type: ['boolean', 'null'] };

export const CELLARER_DRAFT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'kind', 'title', 'description', 'recordId', 'personId', 'startDate', 'dueDate',
    'priority', 'recurrenceFrequency', 'recurrenceInterval', 'recurrenceMode',
    'choreWindowId', 'yieldType', 'quantity', 'unit', 'unusableQuantity', 'session',
    'occurredAt', 'ledgerType', 'amount', 'vendorOrSource', 'category', 'date',
    'body', 'recordEventType', 'allDay', 'endDate', 'startTime', 'endTime', 'location'
  ],
  properties: {
    kind: { type: 'string', enum: CELLARER_DRAFT_KINDS },
    title: nullableString,
    description: nullableString,
    recordId: nullableString,
    personId: nullableString,
    startDate: nullableString,
    dueDate: nullableString,
    priority: { type: ['string', 'null'], enum: ['low', 'normal', 'high', 'urgent', null] },
    recurrenceFrequency: { type: ['string', 'null'], enum: ['daily', 'weekly', 'monthly', null] },
    recurrenceInterval: nullableNumber,
    recurrenceMode: { type: ['string', 'null'], enum: ['fixed_schedule', 'after_completion', null] },
    choreWindowId: nullableString,
    yieldType: { type: ['string', 'null'], enum: ['milk', 'eggs', 'meat', 'harvest', 'forage', null] },
    quantity: nullableNumber,
    unit: nullableString,
    unusableQuantity: nullableNumber,
    session: { type: ['string', 'null'], enum: ['morning', 'evening', 'other', null] },
    occurredAt: nullableString,
    ledgerType: { type: ['string', 'null'], enum: ['expense', 'income', null] },
    amount: nullableNumber,
    vendorOrSource: nullableString,
    category: nullableString,
    date: nullableString,
    body: nullableString,
    recordEventType: nullableString,
    allDay: nullableBoolean,
    endDate: nullableString,
    startTime: nullableString,
    endTime: nullableString,
    location: nullableString
  }
});

const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) || null : null;
const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
const idSet = list => new Set((Array.isArray(list) ? list : []).map(item => item?.id).filter(Boolean));

export function sanitizeCellarerContext(input = {}) {
  const records = (Array.isArray(input.records) ? input.records : []).slice(0, 150).map(record => ({
    id: text(record.id, 80),
    name: text(record.name, 120),
    type: text(record.type, 40),
    eligibleYieldTypes: (Array.isArray(record.eligibleYieldTypes) ? record.eligibleYieldTypes : [])
      .filter(type => ['milk', 'eggs', 'meat', 'harvest', 'forage'].includes(type))
  })).filter(record => record.id && record.name);
  const people = (Array.isArray(input.people) ? input.people : []).slice(0, 100).map(person => ({
    id: text(person.id, 80), name: text(person.name, 120)
  })).filter(person => person.id && person.name);
  const choreWindows = (Array.isArray(input.choreWindows) ? input.choreWindows : []).slice(0, 30).map(window => ({
    id: text(window.id, 80), name: text(window.name, 80), startTime: text(window.startTime, 10), endTime: text(window.endTime, 10)
  })).filter(window => window.id && window.name);
  return {
    today: text(input.today, 10),
    timezone: text(input.timezone, 80),
    preferredKind: CELLARER_DRAFT_KINDS.includes(input.preferredKind) ? input.preferredKind : null,
    records,
    people,
    choreWindows
  };
}

export function validateCellarerDraft(input, context = {}) {
  if (!input || !CELLARER_DRAFT_KINDS.includes(input.kind)) throw new Error('Cyril did not return a supported entry type.');
  const cleanContext = sanitizeCellarerContext(context);
  const recordIds = idSet(cleanContext.records);
  const personIds = idSet(cleanContext.people);
  const windowIds = idSet(cleanContext.choreWindows);
  const recordId = text(input.recordId, 80);
  const personId = text(input.personId, 80);
  const choreWindowId = text(input.choreWindowId, 80);
  if (recordId && !recordIds.has(recordId)) throw new Error('Cyril linked a Record that is not available.');
  if (personId && !personIds.has(personId)) throw new Error('Cyril assigned a person who is not available.');
  if (choreWindowId && !windowIds.has(choreWindowId)) throw new Error('Cyril selected a Chore Window that is not available.');
  const yieldType = ['milk', 'eggs', 'meat', 'harvest', 'forage'].includes(input.yieldType) ? input.yieldType : null;
  if (input.kind === 'yield') {
    if (!recordId || !yieldType) throw new Error('A Yield draft needs an eligible Record and Yield type.');
    const record = cleanContext.records.find(item => item.id === recordId);
    if (!record?.eligibleYieldTypes.includes(yieldType)) throw new Error('That Yield type is not available for the selected Record.');
  }
  if (['journal_note', 'record_event'].includes(input.kind) && !recordId) throw new Error('This draft needs a linked Record.');
  const draft = {
    kind: input.kind,
    title: text(input.title, 160),
    description: text(input.description, 1200),
    recordId,
    personId,
    startDate: text(input.startDate, 10),
    dueDate: text(input.dueDate, 10),
    priority: ['low', 'normal', 'high', 'urgent'].includes(input.priority) ? input.priority : 'normal',
    recurrenceFrequency: ['daily', 'weekly', 'monthly'].includes(input.recurrenceFrequency) ? input.recurrenceFrequency : null,
    recurrenceInterval: Math.max(1, Math.round(number(input.recurrenceInterval) || 1)),
    recurrenceMode: ['fixed_schedule', 'after_completion'].includes(input.recurrenceMode) ? input.recurrenceMode : 'fixed_schedule',
    choreWindowId,
    yieldType,
    quantity: number(input.quantity),
    unit: text(input.unit, 40),
    unusableQuantity: Math.max(0, number(input.unusableQuantity) || 0),
    session: ['morning', 'evening', 'other'].includes(input.session) ? input.session : 'other',
    occurredAt: text(input.occurredAt, 30),
    ledgerType: ['expense', 'income'].includes(input.ledgerType) ? input.ledgerType : 'expense',
    amount: number(input.amount),
    vendorOrSource: text(input.vendorOrSource, 160),
    category: text(input.category, 100),
    date: text(input.date, 10),
    body: text(input.body, 2000),
    recordEventType: text(input.recordEventType, 100),
    allDay: typeof input.allDay === 'boolean' ? input.allDay : true,
    endDate: text(input.endDate, 10),
    startTime: text(input.startTime, 8),
    endTime: text(input.endTime, 8),
    location: text(input.location, 200)
  };
  if (draft.kind === 'task' && !draft.title) throw new Error('A Task draft needs a title.');
  if (draft.kind === 'yield' && (!Number.isFinite(draft.quantity) || draft.quantity <= 0)) throw new Error('A Yield draft needs a positive quantity.');
  if (draft.kind === 'ledger' && (!draft.title || !Number.isFinite(draft.amount) || draft.amount < 0)) throw new Error('A Ledger draft needs a description and amount.');
  if (draft.kind === 'journal_note' && !draft.title && !draft.body) throw new Error('A Journal draft needs a title or note.');
  if (draft.kind === 'record_event' && !draft.recordEventType && !draft.description) throw new Error('A Record Event draft needs an event type or details.');
  if (draft.kind === 'calendar_event' && (!draft.title || !draft.startDate)) throw new Error('A Calendar Event draft needs a title and start date.');
  return draft;
}

function premiumAvailable() {
  const context = window.REGULA_RUSTICA_CLOUD_CONTEXT;
  return Boolean(context?.session?.access_token && context?.homesteadId && context?.premium?.status === 'active'
    && context.premium.feature_keys?.includes(CELLARER_FEATURE_KEY));
}

function initializeCellarerDialog() {
  const dialog = document.querySelector('#cellarerDialog');
  const form = document.querySelector('#cellarerForm');
  if (!dialog || !form || !window.RegulaRustica?.cellarerContext || !window.RegulaRustica?.openCellarerDraft) return;
  const kind = document.querySelector('#cellarerKind');
  const prompt = document.querySelector('#cellarerPrompt');
  const status = document.querySelector('#cellarerStatus');
  const submit = document.querySelector('#cellarerSubmit');
  const close = () => { if (dialog.open) dialog.close(); };
  const showStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };
  document.querySelectorAll('[data-cellarer-kind]').forEach(button => button.addEventListener('click', () => {
    kind.value = CELLARER_DRAFT_KINDS.includes(button.dataset.cellarerKind) ? button.dataset.cellarerKind : 'auto';
    prompt.value = '';
    showStatus(premiumAvailable()
      ? 'Cyril will prepare a draft. You remain in control of what is recorded.'
      : 'Cyril requires an active Premium Homestead and Cloud connection.', !premiumAvailable());
    submit.disabled = !premiumAvailable();
    dialog.showModal();
    setTimeout(() => prompt.focus(), 30);
  }));
  document.querySelector('#cellarerClose')?.addEventListener('click', close);
  document.querySelector('#cellarerCancel')?.addEventListener('click', close);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!premiumAvailable()) return showStatus('Connect to your Premium Homestead before asking Cyril.', true);
    if (!navigator.onLine) return showStatus('Cyril needs an internet connection. Your local app remains available.', true);
    submit.disabled = true;
    showStatus('Cyril is preparing a draft…');
    try {
      const cloud = window.REGULA_RUSTICA_CLOUD_CONTEXT;
      const localContext = window.RegulaRustica.cellarerContext(kind.value === 'auto' ? null : kind.value);
      const response = await fetch('/api/cyril/assisted-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cloud.session.access_token}` },
        body: JSON.stringify({ prompt: prompt.value.trim(), preferredKind: kind.value === 'auto' ? null : kind.value, context: localContext })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Cyril could not prepare this draft.');
      const draft = validateCellarerDraft(result.draft, localContext);
      close();
      window.RegulaRustica.openCellarerDraft(draft);
    } catch (error) {
      showStatus(error.message || 'Cyril could not prepare this draft.', true);
    } finally {
      submit.disabled = !premiumAvailable();
    }
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeCellarerDialog, { once: true });
  else initializeCellarerDialog();
}
