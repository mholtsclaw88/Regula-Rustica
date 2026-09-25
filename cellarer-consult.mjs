export const CELLARER_CONSULT_FEATURE_KEY = 'cellarer_ask_farm_book';
export const CONSULT_SECTIONS = ['records', 'tasks', 'yield', 'ledger', 'calendar', 'recordEvents', 'journal', 'choreWindows'];

const field = (value, length = 240) => String(value ?? '').slice(0, length);

export function sanitizeConsultContext(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const fields = {
    records: ['id', 'name', 'type', 'status', 'species', 'purpose'],
    tasks: ['title', 'status', 'recordId', 'availableFrom', 'dueDate', 'completedAt', 'choreWindowId', 'recurrence'],
    yield: ['type', 'recordId', 'occurredAt', 'quantity', 'unit', 'product'],
    ledger: ['type', 'date', 'amount', 'description', 'category', 'vendorOrSource', 'recordId', 'allocatedRecordIds'],
    calendar: ['title', 'startDate', 'endDate', 'location', 'recordId', 'recurrence'],
    recordEvents: ['eventType', 'date', 'recordId', 'details'],
    journal: ['kind', 'date', 'recordId', 'text'],
    choreWindows: ['id', 'name', 'startTime', 'endTime', 'enabled']
  };
  const limits = { records: 80, tasks: 100, yield: 60, ledger: 60, calendar: 60, recordEvents: 60, journal: 60, choreWindows: 30 };
  const result = { today: field(source.today, 10), timezone: field(source.timezone, 80),
    homesteadName: field(source.homesteadName, 160), sections: {}, coverage: {} };
  for (const section of CONSULT_SECTIONS) {
    const rows = Array.isArray(source.sections?.[section]) ? source.sections[section] : [];
    result.sections[section] = rows.slice(0, limits[section]).map(row => {
      const cleaned = {};
      for (const key of fields[section]) {
        const value = row?.[key];
        if (key === 'allocatedRecordIds') cleaned[key] = Array.isArray(value) ? value.slice(0, 20).map(id => field(id, 80)) : [];
        else if (typeof value === 'number' && Number.isFinite(value)) cleaned[key] = value;
        else if (typeof value === 'boolean') cleaned[key] = value;
        else cleaned[key] = field(value, key === 'text' || key === 'details' ? 360 : 160);
      }
      return cleaned;
    });
    const total = Number(source.coverage?.[section]);
    result.coverage[section] = Number.isSafeInteger(total) && total >= rows.length ? total : rows.length;
  }
  return result;
}

export function validateConsultAnswer(input) {
  if (!input || typeof input.answer !== 'string' || !input.answer.trim()) throw new Error('Cyril returned an empty answer. Try again.');
  return { answer: input.answer.trim().slice(0, 3000), caveat: typeof input.caveat === 'string' ? input.caveat.trim().slice(0, 500) : '' };
}

function premiumAvailable() {
  const cloud = window.REGULA_RUSTICA_CLOUD_CONTEXT;
  return Boolean(cloud?.session?.access_token && cloud?.homesteadId && cloud?.premium?.status === 'active'
    && cloud.premium.feature_keys?.includes(CELLARER_CONSULT_FEATURE_KEY));
}

function initializeConsult() {
  const dialog = document.querySelector('#cellarerConsultDialog');
  const form = document.querySelector('#cellarerConsultForm');
  if (!dialog || !form || form.dataset.initialized) return;
  form.dataset.initialized = 'true';
  const question = document.querySelector('#cellarerConsultQuestion');
  const status = document.querySelector('#cellarerConsultStatus');
  const answer = document.querySelector('#cellarerConsultAnswer');
  const answerText = document.querySelector('#cellarerConsultAnswerText');
  const caveat = document.querySelector('#cellarerConsultCaveat');
  const submit = document.querySelector('#cellarerConsultSubmit');
  let request = null;
  let generation = 0;
  const message = (value, error = false) => { status.textContent = value; status.classList.toggle('error', error); };
  const close = () => { generation++; request?.abort(); if (dialog.open) dialog.close(); };
  window.addEventListener('regula-rustica:cellarer-consult-request', () => {
    generation++; request?.abort(); question.value = ''; answer.hidden = true; answerText.textContent = ''; caveat.textContent = '';
    submit.disabled = !premiumAvailable(); submit.textContent = 'Ask Cyril';
    message(premiumAvailable() ? 'Ask one question. You can edit it and ask again.' : 'Consult Cyril requires an active Premium Homestead and Cloud connection.', !premiumAvailable());
    dialog.showModal(); setTimeout(() => question.focus(), 30);
  });
  document.querySelector('#cellarerConsultClose')?.addEventListener('click', close);
  document.querySelector('#cellarerConsultCancel')?.addEventListener('click', close);
  dialog.addEventListener('cancel', () => { generation++; request?.abort(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const prompt = question.value.trim();
    if (!prompt) return message('Enter a question for Cyril.', true);
    if (!premiumAvailable()) return message('Connect to your Premium Homestead before asking Cyril.', true);
    if (!navigator.onLine) return message('Cyril needs an internet connection. Your local app remains available.', true);
    if (!window.RegulaRustica?.cellarerConsultContext) return message('Homestead data is still loading. Try again shortly.', true);
    request?.abort(); const current = ++generation; request = new AbortController();
    submit.disabled = true; answer.hidden = true; message('Cyril is consulting the Homestead…');
    try {
      const cloud = window.REGULA_RUSTICA_CLOUD_CONTEXT;
      const response = await fetch('/api/cyril/consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cloud.session.access_token}` },
        body: JSON.stringify({ question: prompt, context: window.RegulaRustica.cellarerConsultContext() }),
        signal: request.signal
      });
      const result = await response.json().catch(() => ({}));
      if (current !== generation || !dialog.open) return;
      if (!response.ok) throw new Error(result.error || 'Cyril could not answer just now.');
      const responseText = validateConsultAnswer(result);
      answerText.textContent = responseText.answer;
      caveat.textContent = responseText.caveat;
      caveat.hidden = !responseText.caveat;
      answer.hidden = false;
      submit.textContent = 'Revise and ask again';
      message('To clarify, edit your question above and ask again. This does not start a chat.');
    } catch (error) {
      if (current === generation && error?.name !== 'AbortError') message(error?.message || 'Cyril could not answer just now.', true);
    } finally {
      if (current === generation) { request = null; submit.disabled = !premiumAvailable(); }
    }
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeConsult, { once: true });
  else initializeConsult();
}
