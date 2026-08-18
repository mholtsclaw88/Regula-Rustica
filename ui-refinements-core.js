'use strict';

(function () {
  const nativePrompt = window.prompt.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  let refreshQueued = false;

  window.prompt = function refinedPrompt(message, defaultValue) {
    const text = String(message || '');
    const match = text.match(/^(.+?) has no matching Yield\. Type R to record Yield, W to complete without Yield, or C to cancel\.$/);
    if (!match) return nativePrompt(message, defaultValue);

    const routineName = match[1];
    if (nativeConfirm(`${routineName} has no yield recorded.\n\nRecord the yield now?`)) return 'R';
    if (nativeConfirm(`Complete ${routineName} without recording a yield?`)) return 'W';
    return 'C';
  };

  const readData = () => window.RegulaRusticaLocal?.read?.() || null;
  const writeData = data => window.RegulaRusticaLocal?.write?.(data, 'ledger-receipt');

  function receiptMap(data) {
    data.legacy ||= {};
    data.legacy.receiptPhotos ||= {};
    return data.legacy.receiptPhotos;
  }

  function addStyles() {
    if (document.querySelector('#record-navigation-refinement-styles')) return;
    const style = document.createElement('style');
    style.id = 'record-navigation-refinement-styles';
    style.textContent = `
      .record-context, .tabs-mini { display:none !important; }
      .ledger-receipt-action.has-receipt::before { content:'✓ '; }
      .receipt-storage-note { margin:.65rem 0 1rem; font-size:.86rem; color:var(--muted, #6b6256); }
      .receipt-dialog { width:min(92vw, 620px); }
      .receipt-dialog img { display:block; width:100%; max-height:68vh; object-fit:contain; border-radius:10px; border:1px solid var(--line, #cdbf9f); background:#fff; }
      .receipt-dialog .receipt-meta { margin:.65rem 0 0; color:var(--muted, #6b6256); font-size:.86rem; }
      .receipt-dialog .receipt-actions { display:flex; flex-wrap:wrap; gap:.5rem; justify-content:flex-end; margin-top:1rem; }
      @media (max-width: 720px) {
        .receipt-dialog .receipt-actions .btn { flex:1 1 auto; }
      }
    `;
    document.head.appendChild(style);
  }

  function activate(nav, panels, key) {
    nav.querySelectorAll('button[data-record-section]').forEach(button => {
      const active = button.dataset.recordSection === key;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    panels.forEach(panel => panel.classList.toggle('active', panel.dataset.recordSectionPanel === key));
  }

  function wireRecordNavigation(workspace) {
    const nav = workspace?.querySelector('.record-section-nav');
    const panels = [...(workspace?.querySelectorAll('.record-section-panel') || [])];
    if (!nav || !panels.length || nav.dataset.wired === 'true') return;
    nav.dataset.wired = 'true';
    nav.addEventListener('click', event => {
      const button = event.target.closest('button[data-record-section]');
      if (button) activate(nav, panels, button.dataset.recordSection);
    });
  }

  function buildRecordNavigation() {
    const card = document.querySelector('#recordView > .card');
    if (!card) return;
    const existingWorkspace = card.querySelector('.record-workspace');
    if (existingWorkspace) {
      wireRecordNavigation(existingWorkspace);
      return;
    }

    const stewardship = document.querySelector('#recordStewardship');
    const routines = document.querySelector('#recordRoutines');
    const existingPanels = {
      tasks: document.querySelector('#panelTasks'),
      chronicle: document.querySelector('#panelChronicle'),
      notes: document.querySelector('#panelNotes'),
      ledger: document.querySelector('#panelLedger'),
      photos: document.querySelector('#panelPhotos')
    };
    if (!stewardship || !routines || Object.values(existingPanels).some(panel => !panel)) return;

    const workspace = document.createElement('div');
    workspace.className = 'record-workspace';
    const nav = document.createElement('nav');
    nav.className = 'record-section-nav';
    nav.setAttribute('aria-label', 'Record sections');
    nav.setAttribute('role', 'tablist');
    const content = document.createElement('div');
    content.className = 'record-section-content';

    const sections = [
      ['stewardship', 'Stewardship', stewardship],
      ['routines', 'Routines', routines],
      ['tasks', 'Tasks', existingPanels.tasks],
      ['chronicle', 'Chronicle', existingPanels.chronicle],
      ['notes', 'Notes', existingPanels.notes],
      ['ledger', 'Ledger', existingPanels.ledger],
      ['photos', 'Photos', existingPanels.photos]
    ];

    const panels = [];
    sections.forEach(([key, label, node], index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.recordSection = key;
      button.textContent = label;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', `recordSection-${key}`);
      nav.appendChild(button);

      const panel = document.createElement('section');
      panel.id = `recordSection-${key}`;
      panel.dataset.recordSectionPanel = key;
      panel.className = `record-section-panel${index === 0 ? ' active' : ''}`;
      panel.setAttribute('role', 'tabpanel');
      const heading = document.createElement('h3');
      heading.className = 'record-section-heading';
      heading.textContent = label;
      panel.appendChild(heading);
      node.classList.remove('record-panel', 'active');
      panel.appendChild(node);
      content.appendChild(panel);
      panels.push(panel);
    });

    workspace.append(nav, content);
    const oldTabs = card.querySelector('.tabs-mini');
    if (oldTabs) oldTabs.insertAdjacentElement('beforebegin', workspace);
    else card.appendChild(workspace);
    wireRecordNavigation(workspace);
    activate(nav, panels, 'stewardship');
  }

  function ensureReceiptDialog() {
    let dialog = document.querySelector('#ledgerReceiptDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'ledgerReceiptDialog';
    dialog.className = 'receipt-dialog';
    dialog.innerHTML = `
      <div class="row"><h2>Ledger receipt</h2><button type="button" class="btn ghost receipt-close" aria-label="Close">✕</button></div>
      <img alt="Receipt attachment">
      <p class="receipt-meta"></p>
      <div class="receipt-actions">
        <button type="button" class="btn secondary receipt-replace">Replace photo</button>
        <button type="button" class="btn danger receipt-remove">Remove photo</button>
        <button type="button" class="btn primary receipt-done">Done</button>
      </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('.receipt-close').addEventListener('click', () => dialog.close());
    dialog.querySelector('.receipt-done').addEventListener('click', () => dialog.close());
    return dialog;
  }

  function pickReceipt(ledgerId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      try {
        const attachment = await compressReceipt(file);
        const data = readData();
        if (!data) throw new Error('Local data is unavailable.');
        const entry = data.ledger?.find(item => item.id === ledgerId && !item.deletedAt);
        if (!entry) throw new Error('Ledger entry no longer exists.');
        receiptMap(data)[ledgerId] = attachment;
        writeData(data);
      } catch (error) {
        console.warn('Receipt photo could not be saved.', error);
        alert(error?.message || 'Receipt photo could not be saved.');
      }
    }, { once: true });
    input.click();
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be opened.')); };
      image.src = url;
    });
  }

  function canvasData(image, maxEdge, quality) {
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function compressReceipt(file) {
    if (!file.type.startsWith('image/')) throw new Error('Choose a photo or image file.');
    if (file.size > 20 * 1024 * 1024) throw new Error('That photo is too large. Choose an image under 20 MB.');
    const image = await loadImage(file);
    let dataUrl = canvasData(image, 1000, .62);
    if (dataUrl.length > 300000) dataUrl = canvasData(image, 900, .5);
    if (dataUrl.length > 300000) dataUrl = canvasData(image, 720, .45);
    if (dataUrl.length > 350000) throw new Error('The receipt could not be compressed enough for safe offline storage. Try a tighter photo of the receipt.');
    return {
      dataUrl,
      capturedAt: new Date().toISOString(),
      originalName: file.name || 'Receipt photo',
      mimeType: 'image/jpeg'
    };
  }

  function removeReceipt(ledgerId) {
    const data = readData();
    if (!data) return;
    const photos = receiptMap(data);
    if (!photos[ledgerId]) return;
    if (!nativeConfirm('Remove this receipt photo? The Ledger entry will remain.')) return;
    delete photos[ledgerId];
    writeData(data);
    document.querySelector('#ledgerReceiptDialog')?.close();
  }

  function showReceipt(ledgerId) {
    const data = readData();
    const attachment = data?.legacy?.receiptPhotos?.[ledgerId];
    if (!attachment?.dataUrl) return pickReceipt(ledgerId);
    const dialog = ensureReceiptDialog();
    dialog.dataset.ledgerId = ledgerId;
    dialog.querySelector('img').src = attachment.dataUrl;
    dialog.querySelector('.receipt-meta').textContent = attachment.capturedAt
      ? `Saved ${new Date(attachment.capturedAt).toLocaleString()} · Stored on this device and in backups.`
      : 'Stored on this device and in backups.';
    dialog.querySelector('.receipt-replace').onclick = () => { dialog.close(); pickReceipt(ledgerId); };
    dialog.querySelector('.receipt-remove').onclick = () => removeReceipt(ledgerId);
    dialog.showModal();
  }

  function addReceiptButton(row, entry, photos) {
    if (!row || row.querySelector('[data-ledger-receipt-action]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.ledgerReceiptAction = 'true';
    button.className = `btn ghost ledger-receipt-action${photos[entry.id] ? ' has-receipt' : ''}`;
    button.textContent = photos[entry.id] ? 'Receipt' : 'Add receipt';
    button.title = photos[entry.id] ? 'View receipt photo' : 'Take or choose a receipt photo';
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (photos[entry.id]) showReceipt(entry.id);
      else pickReceipt(entry.id);
    });
    const actions = row.querySelector('.actions');
    if (actions) actions.prepend(button);
    else row.appendChild(button);
  }

  function mainLedgerEntries(data) {
    const filter = document.querySelector('[name="ledgerTypeFilter"]:checked')?.value || 'all';
    const period = document.querySelector('[name="ledgerDateFilter"]:checked')?.value || '30';
    const today = new Date();
    const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const range = window.RegulaRusticaHousekeeping.reportingDateRange(period, localToday);
    return (data.ledger || []).filter(entry => !entry.deletedAt && (filter === 'all' || entry.type === filter)
      && window.RegulaRusticaHousekeeping.matchesReportingDate(entry.date, range))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  function currentRecord(data) {
    if (!document.querySelector('#recordView.active')) return null;
    const title = document.querySelector('#recordTitle')?.textContent?.trim();
    const type = document.querySelector('#recordTypeLabel')?.textContent?.trim();
    return data.records?.find(record => !record.deletedAt && record.name === title && record.type === type) || null;
  }

  function enhanceLedgerReceipts() {
    const data = readData();
    if (!data) return;
    const photos = receiptMap(data);

    const ledgerList = document.querySelector('#ledgerList');
    if (ledgerList) {
      const rows = [...ledgerList.children].filter(node => node.classList.contains('task'));
      mainLedgerEntries(data).forEach((entry, index) => addReceiptButton(rows[index], entry, photos));
      const section = document.querySelector('#ledger');
      if (section && !section.querySelector('.receipt-storage-note')) {
        const note = document.createElement('p');
        note.className = 'receipt-storage-note';
        note.textContent = 'Receipt photos are compressed and saved on this device and in downloaded backups. Ledger entries sync to the cloud; receipt-photo cloud sync is not yet enabled.';
        ledgerList.before(note);
      }
    }

    const record = currentRecord(data);
    const recordLedger = document.querySelector('#panelLedger');
    if (record && recordLedger) {
      const entries = (data.ledger || []).filter(entry => !entry.deletedAt && entry.recordId === record.id)
        .sort((a, b) => b.date.localeCompare(a.date));
      const rows = [...recordLedger.children].filter(node => node.classList.contains('task'));
      entries.forEach((entry, index) => addReceiptButton(rows[index], entry, photos));
    }
  }

  function refreshEnhancements() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      buildRecordNavigation();
      enhanceLedgerReceipts();
    });
  }

  function init() {
    addStyles();
    ensureReceiptDialog();
    refreshEnhancements();
    const observer = new MutationObserver(refreshEnhancements);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('regula-rustica:data-saved', refreshEnhancements);
    document.addEventListener('change', event => {
      if (event.target.matches('[name="ledgerTypeFilter"], [name="ledgerDateFilter"]')) refreshEnhancements();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
