'use strict';

(function () {
  let context = null;
  let pending = null;

  const read = () => window.RegulaRusticaLocal?.read?.();
  const write = data => window.RegulaRusticaLocal?.write?.(data, 'ledger-allocations');
  const money = value => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(value || 0));

  function activeRecords(data) {
    return (data.records || [])
      .filter(record => !record.deletedAt && record.status !== 'Archived')
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function rows(root) {
    return [...root.querySelectorAll('.ledger-allocation-row')]
      .map(row => ({
        id: row.dataset.id || null,
        recordId: row.querySelector('select').value,
        amount: Number(row.querySelector('input').value || 0)
      }))
      .filter(item => item.recordId && item.amount > 0);
  }

  function updateSummary(root) {
    const total = Number(root.closest('form')?.querySelector('[name=amount]')?.value || 0);
    const allocated = rows(root).reduce((sum, item) => sum + item.amount, 0);
    const remaining = total - allocated;
    const output = root.querySelector('.allocation-summary');
    if (!output) return;

    if (Math.abs(remaining) < .005 && total > 0) {
      output.textContent = `Allocated ${money(allocated)} · Unallocated ${money(0)} · Fully allocated`;
    } else {
      output.textContent = `Allocated ${money(allocated)} · Unallocated ${money(Math.max(remaining, 0))}`;
    }
    output.classList.toggle('allocation-error', remaining < -.004);
    if (remaining < -.004) output.textContent = `Allocated ${money(allocated)} · Over allocated ${money(Math.abs(remaining))}`;
  }

  function addRow(root, item = {}) {
    const data = read();
    const row = document.createElement('div');
    row.className = 'ledger-allocation-row';
    row.dataset.id = item.id || '';

    const recordWrap = document.createElement('label');
    recordWrap.className = 'allocation-record form-field';
    recordWrap.append('Record');
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Allocated Record');
    select.add(new Option('Choose Record', ''));
    activeRecords(data).forEach(record => select.add(new Option(`${record.name} (${record.type})`, record.id)));
    select.value = item.recordId || '';
    recordWrap.append(select);

    const amountWrap = document.createElement('label');
    amountWrap.className = 'allocation-amount form-field';
    amountWrap.append('Amount');
    const amount = document.createElement('input');
    amount.type = 'number';
    amount.step = '.01';
    amount.min = '.01';
    amount.placeholder = '0.00';
    amount.value = item.amount || '';
    amount.setAttribute('aria-label', 'Allocated amount');
    amountWrap.append(amount);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn ghost allocation-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      row.remove();
      updateSummary(root);
    });
    select.addEventListener('change', () => updateSummary(root));
    amount.addEventListener('input', () => updateSummary(root));

    row.append(recordWrap, amountWrap, remove);
    root.querySelector('.allocation-rows').append(row);
    updateSummary(root);
  }

  function setSplitMode(box, linkedSelect, enabled, options = {}) {
    const trigger = box.querySelector('.allocation-trigger');
    const panel = box.querySelector('.allocation-panel');
    box.dataset.split = enabled ? 'true' : 'false';
    panel.hidden = !enabled;
    trigger.setAttribute('aria-expanded', String(enabled));
    trigger.checked = enabled;

    if (!enabled || box.querySelector('.ledger-allocation-row')) return;

    addRow(box, { recordId: options.initialRecordId || linkedSelect?.value || '' });
    if (options.openSecondRow) addRow(box);
  }

  function augment(id) {
    const fields = document.querySelector('#modalFields');
    if (!fields || fields.querySelector('.ledger-allocation-field')) return;

    const data = read();
    data.ledgerAllocations ||= [];
    const entry = id ? (data.ledger || []).find(item => item.id === id) : null;
    const existing = entry
      ? data.ledgerAllocations.filter(item => !item.deletedAt && item.ledgerEntryId === entry.id)
      : [];

    const linkedSelect = fields.querySelector('[name=recordId]');
    const linkedLabel = linkedSelect?.closest('label') || null;
    if (linkedLabel?.firstChild) linkedLabel.firstChild.textContent = 'Primary Record (optional)';
    if (linkedSelect && !linkedSelect.value && existing[0]?.recordId) linkedSelect.value = existing[0].recordId;

    const box = document.createElement('div');
    box.className = 'ledger-allocation-field';
    box.dataset.split = 'false';
    box.innerHTML = `
      <label class="allocation-toggle"><input type="checkbox" class="allocation-trigger" aria-expanded="false">Add allocation / split this entry</label>
      <div class="allocation-panel" hidden>
        <p class="meta">Allocate this transaction among multiple Records. Allocation 1 starts with the Primary Record selected above. A remainder may stay unallocated for general Homestead costs.</p>
        <div class="allocation-rows"></div>
        <button type="button" class="btn secondary allocation-add">+ Add another Record</button>
        <div class="allocation-summary"></div>
      </div>`;
    const slot = fields.querySelector('.ledger-allocation-slot');
    if (slot) slot.append(box);
    else fields.append(box);

    const trigger = box.querySelector('.allocation-trigger');
    const add = box.querySelector('.allocation-add');

    add.addEventListener('click', () => addRow(box));
    fields.querySelector('[name=amount]')?.addEventListener('input', () => updateSummary(box));

    trigger.addEventListener('change', () => {
      const split = box.dataset.split === 'true';
      if (!split) {
        setSplitMode(box, linkedSelect, true, {
          initialRecordId: linkedSelect?.value || ''
        });
        updateSummary(box);
        return;
      }

      const hasAllocations = box.querySelectorAll('.ledger-allocation-row').length > 0;
      if (hasAllocations && !confirm('Stop splitting this entry? The allocation rows will be removed when you save.')) {
        trigger.checked = true;
        return;
      }
      box.querySelector('.allocation-rows').innerHTML = '';
      setSplitMode(box, linkedSelect, false);
      updateSummary(box);
    });

    existing.forEach(item => addRow(box, item));
    if (existing.length) setSplitMode(box, linkedSelect, true);
    updateSummary(box);
  }

  function capture(event) {
    if (!context) return;
    const box = document.querySelector('.ledger-allocation-field');
    if (!box) return;

    const split = box.dataset.split === 'true';
    const allocations = split ? rows(box) : [];
    const total = Number(document.querySelector('#modalFields [name=amount]')?.value || 0);
    const allocated = allocations.reduce((sum, item) => sum + item.amount, 0);

    const recordIds = allocations.map(item => item.recordId);
    if (new Set(recordIds).size !== recordIds.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      alert('Each Record can appear only once in a split receipt. Combine amounts for the same Record.');
      return;
    }

    if (allocated > total + .004) {
      event.preventDefault();
      event.stopImmediatePropagation();
      alert('Allocated amounts cannot exceed the transaction total.');
      return;
    }

    if (split && allocations.length === 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      alert('Add at least one Record and dollar amount, or stop splitting this receipt.');
      return;
    }

    const fields = document.querySelector('#modalFields');
    pending = {
      id: context.id,
      allocations,
      description: fields.querySelector('[name=description]')?.value.trim() || '',
      date: fields.querySelector('[name=date]')?.value || '',
      amount: total
    };

    if (split) {
      const linked = fields.querySelector('[name=recordId]');
      if (linked) linked.value = '';
    }
  }

  function apply() {
    if (!pending) return;
    const saved = pending;
    pending = null;
    const data = read();
    if (!data) return;

    data.ledgerAllocations ||= [];
    let entry = saved.id
      ? (data.ledger || []).find(item => item.id === saved.id && !item.deletedAt)
      : null;

    if (!entry) {
      entry = [...(data.ledger || [])]
        .filter(item => !item.deletedAt && item.description === saved.description && item.date === saved.date && Number(item.amount) === saved.amount)
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    }
    if (!entry) return;

    const now = new Date().toISOString();
    const wanted = new Map(saved.allocations.map(item => [item.recordId, item]));
    data.ledgerAllocations
      .filter(item => !item.deletedAt && item.ledgerEntryId === entry.id)
      .forEach(item => {
        const next = wanted.get(item.recordId);
        if (next) {
          item.amount = next.amount;
          item.updatedAt = now;
          wanted.delete(item.recordId);
        } else {
          item.deletedAt = now;
          item.updatedAt = now;
        }
      });

    wanted.forEach(item => data.ledgerAllocations.push({
      id: crypto.randomUUID(),
      ledgerEntryId: entry.id,
      recordId: item.recordId,
      amount: item.amount,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    }));
    write(data);
  }

  function styles() {
    if (document.querySelector('#ledger-allocation-styles')) return;
    const style = document.createElement('style');
    style.id = 'ledger-allocation-styles';
    style.textContent = `
      .ledger-allocation-field { grid-column:1/-1; margin-top:.05rem; }
      .allocation-toggle { display:flex; grid-template-columns:auto 1fr; align-items:center; gap:.55rem; width:fit-content; cursor:pointer; }
      .allocation-toggle .allocation-trigger { width:20px; height:20px; margin:0; }
      .allocation-panel { margin-top:.55rem; padding:.8rem 0 0; border-top:1px solid var(--line,#cdbf9f); }
      .allocation-panel[hidden] { display:none; }
      .ledger-allocation-row { display:grid; grid-template-columns:minmax(0,1fr) 8rem auto; gap:.55rem; margin:.55rem 0; align-items:end; }
      .ledger-allocation-row label { margin:0; }
      .allocation-summary { margin-top:.6rem; font-weight:600; }
      .allocation-error { color:#8b2f2f; }
      @media(max-width:600px) {
        .ledger-allocation-row { grid-template-columns:1fr 7rem; }
        .ledger-allocation-row .allocation-remove { grid-column:1/-1; justify-self:start; }
      }`;
    document.head.append(style);
  }

  function install() {
    styles();
    const original = window.openModal;
    if (typeof original === 'function' && !original.__allocWrapped) {
      const wrapped = function (mode, id) {
        context = mode === 'ledger' ? { id: id || null } : null;
        pending = null;
        const result = original.apply(this, arguments);
        if (mode === 'ledger') queueMicrotask(() => augment(id || null));
        return result;
      };
      wrapped.__allocWrapped = true;
      window.openModal = wrapped;
    }

    document.querySelector('#modalForm')?.addEventListener('submit', capture, true);
    window.addEventListener('regula-rustica:data-saved', event => {
      if (event.detail?.source !== 'ledger-allocations') apply();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
}());
