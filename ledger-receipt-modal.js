'use strict';

(function () {
  let stagedReceipt = null;
  let ledgerContext = null;
  let pendingSave = null;

  const readData = () => window.RegulaRusticaLocal?.read?.() || null;
  const writeData = data => window.RegulaRusticaLocal?.write?.(data, 'ledger-receipt-modal');

  function receiptMap(data) {
    data.legacy ||= {};
    data.legacy.receiptPhotos ||= {};
    return data.legacy.receiptPhotos;
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
    if (!file?.type?.startsWith('image/')) throw new Error('Choose a photo or image file.');
    if (file.size > 20 * 1024 * 1024) throw new Error('That image is too large. Choose one under 20 MB.');
    const image = await loadImage(file);
    let dataUrl = canvasData(image, 1000, .62);
    if (dataUrl.length > 300000) dataUrl = canvasData(image, 900, .5);
    if (dataUrl.length > 300000) dataUrl = canvasData(image, 720, .45);
    if (dataUrl.length > 350000) throw new Error('The receipt could not be compressed enough. Try a tighter photo of the receipt.');
    return {
      dataUrl,
      capturedAt: new Date().toISOString(),
      originalName: file.name || 'Receipt image',
      mimeType: 'image/jpeg'
    };
  }

  function ensureStyles() {
    if (document.querySelector('#ledger-receipt-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'ledger-receipt-modal-styles';
    style.textContent = `
      .ledger-receipt-field { grid-column:1 / -1; padding:.8rem; border:1px solid var(--line, #cdbf9f); border-radius:10px; }
      .ledger-receipt-field strong { display:block; margin-bottom:.35rem; }
      .ledger-receipt-field .receipt-form-actions { display:flex; flex-wrap:wrap; align-items:center; gap:.55rem; }
      .ledger-receipt-field .receipt-form-status { color:var(--muted, #6b6256); font-size:.86rem; }
      .ledger-receipt-field input[type=file] { position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; }
    `;
    document.head.appendChild(style);
  }

  function augmentLedgerForm(id) {
    const root = document.querySelector('#modalFields');
    if (!root || root.querySelector('.ledger-receipt-field')) return;
    const data = readData();
    const existing = id ? data?.legacy?.receiptPhotos?.[id] : null;

    const wrap = document.createElement('div');
    wrap.className = 'ledger-receipt-field';
    wrap.innerHTML = `
      <strong>Receipt image (optional)</strong>
      <div class="receipt-form-actions">
        <button type="button" class="btn secondary receipt-choose">${existing ? 'Replace image' : 'Choose image'}</button>
        <span class="receipt-form-status">${existing ? 'Receipt image attached.' : 'On a phone, this can open the camera. On desktop, choose an image file.'}</span>
      </div>
      <input class="receipt-file" type="file" accept="image/*" capture="environment">`;
    const slot = root.querySelector('.ledger-receipt-slot');
    if (slot) slot.appendChild(wrap);
    else root.appendChild(wrap);

    const input = wrap.querySelector('.receipt-file');
    const button = wrap.querySelector('.receipt-choose');
    const status = wrap.querySelector('.receipt-form-status');
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      status.textContent = 'Preparing image…';
      try {
        stagedReceipt = await compressReceipt(file);
        button.textContent = 'Replace image';
        status.textContent = `Ready to save: ${file.name || 'receipt image'}`;
      } catch (error) {
        stagedReceipt = null;
        status.textContent = error?.message || 'Receipt image could not be prepared.';
      }
    });
  }

  function captureLedgerSubmit() {
    if (!ledgerContext || !stagedReceipt) return;
    const root = document.querySelector('#modalFields');
    pendingSave = {
      id: ledgerContext.id || null,
      receipt: stagedReceipt,
      description: root?.querySelector('[name=description]')?.value?.trim() || '',
      date: root?.querySelector('[name=date]')?.value || '',
      amount: Number(root?.querySelector('[name=amount]')?.value || 0)
    };
    stagedReceipt = null;
  }

  function applyPendingReceipt() {
    if (!pendingSave) return;
    const pending = pendingSave;
    pendingSave = null;
    const data = readData();
    if (!data) return;
    let entry = pending.id ? data.ledger?.find(item => item.id === pending.id && !item.deletedAt) : null;
    if (!entry) {
      entry = [...(data.ledger || [])]
        .filter(item => !item.deletedAt && item.description === pending.description && item.date === pending.date && Number(item.amount) === pending.amount)
        .sort((a, b) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || '')))[0];
    }
    if (!entry) return;
    receiptMap(data)[entry.id] = pending.receipt;
    writeData(data);
  }

  function install() {
    ensureStyles();
    const originalOpenModal = window.openModal;
    if (typeof originalOpenModal === 'function' && !originalOpenModal.__ledgerReceiptWrapped) {
      const wrapped = function(mode, id) {
        ledgerContext = mode === 'ledger' ? { id: id || null } : null;
        stagedReceipt = null;
        const result = originalOpenModal.apply(this, arguments);
        if (mode === 'ledger') queueMicrotask(() => augmentLedgerForm(id || null));
        return result;
      };
      wrapped.__ledgerReceiptWrapped = true;
      window.openModal = wrapped;
    }
    document.querySelector('#modalForm')?.addEventListener('submit', captureLedgerSubmit, true);
    window.addEventListener('regula-rustica:data-saved', event => {
      if (event.detail?.source !== 'ledger-receipt-modal') applyPendingReceipt();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
}());
