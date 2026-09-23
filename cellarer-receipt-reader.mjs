import { resolveCellarerRecord, sanitizeCellarerContext, validateCellarerDraft } from './cellarer-assisted-entry.mjs';

export const CELLARER_RECEIPT_FEATURE_KEY = 'cellarer_receipt_reader';

export function receiptRecordFromNote(note, records = []) {
  return resolveCellarerRecord(note, records);
}

function validatedAllocations(input, context, total) {
  const records = new Set(context.records.map(record => record.id));
  const amounts = new Map();
  const lines = Array.isArray(input.lineItems) ? input.lineItems.slice(0, 30) : [];
  for (const item of lines) {
    const amount = Number(item?.amount);
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > .001) continue;
    const recordId = resolveCellarerRecord(item.description, context.records);
    if (!recordId) continue;
    if (!records.has(recordId)) continue;
    amounts.set(recordId, (amounts.get(recordId) || 0) + Math.round(amount * 100));
  }
  if (!lines.length && Array.isArray(input.allocations)) {
    for (const item of input.allocations.slice(0, 30)) {
      const cents = Math.round(Number(item?.amount) * 100);
      if (!records.has(item?.recordId) || !Number.isFinite(cents) || cents <= 0) {
        throw new Error('Cyril returned an invalid Record allocation.');
      }
      amounts.set(item.recordId, (amounts.get(item.recordId) || 0) + cents);
    }
  }
  const allocatedCents = [...amounts.values()].reduce((sum, cents) => sum + cents, 0);
  if (allocatedCents > Math.round(total * 100)) throw new Error('Cyril allocated more than the receipt total.');
  return [...amounts].map(([recordId, cents]) => ({ recordId, amount: cents / 100 }));
}

export function validateReceiptLedgerDraft(input, context) {
  if (!input || typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Cyril could not read a positive receipt total. Enter this receipt manually.');
  }
  const date = typeof input.date === 'string' ? input.date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))
    || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('Cyril could not read the receipt date. Enter this receipt manually.');
  }
  const title = typeof input.title === 'string' && input.title.trim()
    ? input.title.trim() : typeof input.vendorOrSource === 'string' ? input.vendorOrSource.trim() : '';
  if (!title) throw new Error('Cyril could not read a receipt description. Enter this receipt manually.');
  const cleanContext = sanitizeCellarerContext(context);
  const allocations = validatedAllocations(input, cleanContext, input.amount);
  const recordId = allocations.length > 1 ? null : input.recordId || (allocations.length === 1 ? allocations[0].recordId : null);
  const draft = validateCellarerDraft({
    kind: 'ledger', ledgerType: 'expense', title, amount: input.amount, date,
    vendorOrSource: input.vendorOrSource, category: input.category, recordId
  }, cleanContext);
  const vendor = String(draft.vendorOrSource || '').toLocaleLowerCase();
  const supportedByHistory = vendor && (cleanContext.knownVendors.some(name => name.toLocaleLowerCase() === vendor)
    || cleanContext.ledgerHistory.some(entry =>
    String(entry.vendorOrSource || '').toLocaleLowerCase() === vendor
    || (vendor.length >= 4 && String(entry.description || '').toLocaleLowerCase().includes(vendor))));
  return {
    ...draft,
    allocations,
    vendorSource: input.vendorSource === 'history'
      ? supportedByHistory ? 'history' : 'unknown'
      : input.vendorSource === 'unknown' ? 'unknown' : 'receipt'
  };
}

function premiumAvailable() {
  const cloud = window.REGULA_RUSTICA_CLOUD_CONTEXT;
  return Boolean(cloud?.session?.access_token && cloud?.homesteadId && cloud?.premium?.status === 'active'
    && cloud.premium.feature_keys?.includes(CELLARER_RECEIPT_FEATURE_KEY));
}

function initializeReceiptReader() {
  const dialog = document.querySelector('#cellarerReceiptDialog');
  const form = document.querySelector('#cellarerReceiptForm');
  if (!dialog || !form) return;
  const camera = document.querySelector('#cellarerReceiptCamera');
  const picker = document.querySelector('#cellarerReceiptFile');
  const preview = document.querySelector('#cellarerReceiptPreview');
  const note = document.querySelector('#cellarerReceiptNote');
  const recordSelect = document.querySelector('#cellarerReceiptRecord');
  const status = document.querySelector('#cellarerReceiptStatus');
  const submit = document.querySelector('#cellarerReceiptSubmit');
  let selected = null;
  let selection = 0;
  let requestController = null;
  const message = (value, error = false) => {
    status.textContent = value;
    status.classList.toggle('error', error);
  };
  const close = () => {
    selection++;
    requestController?.abort();
    selected = null;
    preview.removeAttribute('src');
    if (dialog.open) dialog.close();
  };
  window.addEventListener('regula-rustica:cellarer-receipt-request', () => {
    selection++;
    requestController?.abort();
    selected = null;
    camera.value = '';
    picker.value = '';
    note.value = '';
    const records = window.RegulaRustica?.cellarerContext?.('ledger')?.records || [];
    recordSelect.replaceChildren(new Option('Let Cyril suggest one', ''));
    records.forEach(record => recordSelect.add(new Option(`${record.name} (${record.type})`, record.id)));
    preview.removeAttribute('src');
    preview.classList.add('hidden');
    submit.disabled = true;
    message(premiumAvailable()
      ? 'Choose a clear photo showing the date and total.'
      : 'Receipt Reader requires an active Premium Homestead and Cloud connection.', !premiumAvailable());
    dialog.showModal();
  });
  document.querySelector('#cellarerReceiptTake')?.addEventListener('click', () => camera.click());
  document.querySelector('#cellarerReceiptChoose')?.addEventListener('click', () => picker.click());
  for (const input of [camera, picker]) input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    requestController?.abort();
    const current = ++selection;
    selected = null;
    submit.disabled = true;
    message('Preparing receipt photo…');
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP receipt photo.');
      if (!window.RegulaRusticaReceipts?.prepareFile) throw new Error('Receipt images are not ready. Reload and try again.');
      const prepared = await window.RegulaRusticaReceipts.prepareFile(file);
      if (current !== selection) return;
      selected = prepared;
      preview.src = prepared.dataUrl;
      preview.classList.remove('hidden');
      submit.disabled = !premiumAvailable();
      message(premiumAvailable() ? 'Photo ready. Review the draft before saving anything.'
        : 'Receipt Reader requires an active Premium Homestead and Cloud connection.', !premiumAvailable());
    } catch (error) {
      if (current === selection) message(error?.message || 'This photo could not be prepared.', true);
    }
  });
  document.querySelector('#cellarerReceiptClose')?.addEventListener('click', close);
  document.querySelector('#cellarerReceiptCancel')?.addEventListener('click', close);
  dialog.addEventListener('cancel', () => { selection++; requestController?.abort(); selected = null; preview.removeAttribute('src'); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!selected) return message('Choose a receipt photo first.', true);
    if (!premiumAvailable()) return message('Connect to your Premium Homestead before asking Cyril.', true);
    if (!navigator.onLine) return message('Cyril needs an internet connection. Your local Ledger remains available.', true);
    if (!window.RegulaRusticaReceipts?.stageForOpenLedger || !window.RegulaRustica?.openCellarerDraft) {
      return message('The Ledger form is not ready. Reload and try again.', true);
    }
    submit.disabled = true;
    message('Cyril is reading the receipt…');
    const current = selection;
    const controller = new AbortController();
    requestController = controller;
    try {
      const cloud = window.REGULA_RUSTICA_CLOUD_CONTEXT;
      const context = window.RegulaRustica.cellarerContext('ledger');
      const response = await fetch('/api/cyril/receipt-reader', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cloud.session.access_token}` },
        body: JSON.stringify({ image: selected.dataUrl, note: note.value.trim(), preferredRecordId: recordSelect.value || null, context }),
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (current !== selection || !dialog.open) return;
      if (!response.ok) throw new Error(result.error || 'Cyril could not read this receipt.');
      const draft = validateReceiptLedgerDraft(result.draft, context);
      if (draft.allocations.length && !window.RegulaRusticaLedgerAllocations?.applyDraft) {
        throw new Error('Ledger allocations are still loading. Wait a moment and try again.');
      }
      const receipt = selected;
      close();
      window.RegulaRustica.openCellarerDraft(draft);
      window.RegulaRusticaReceipts.stageForOpenLedger(receipt);
    } catch (error) {
      if (current === selection && dialog.open && error?.name !== 'AbortError') {
        message(error?.message || 'Cyril could not read this receipt.', true);
      }
    } finally {
      if (requestController === controller) requestController = null;
      submit.disabled = !selected || !premiumAvailable();
    }
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeReceiptReader, { once: true });
  else initializeReceiptReader();
}
