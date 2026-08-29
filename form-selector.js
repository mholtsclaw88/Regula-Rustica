'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.RegulaRusticaFormSelector = api;
    api.install();
  }
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const SEARCH_THRESHOLD = 10;
  const recordKinds = new Set(['Animal', 'Land', 'Equipment', 'Structure', 'Work']);
  let active = null;
  let dialog = null;
  let observer = null;
  let serial = 0;

  function optionParts(option) {
    const text = String(option?.textContent || option?.label || '').trim();
    const explicit = String(option?.dataset?.meta || '').trim();
    if (explicit) return { label: text, meta: explicit };
    const match = text.match(/^(.*?)\s*(?:\((Animal|Land|Equipment|Structure|Work)\)|—\s*(Animal|Land|Equipment|Structure|Work))$/);
    const meta = match?.[2] || match?.[3] || '';
    return meta && recordKinds.has(meta) ? { label: match[1].trim(), meta } : { label: text, meta: '' };
  }

  function filterOptions(options, query = '') {
    const needle = String(query).trim().toLocaleLowerCase();
    return [...options].filter(option => !needle || `${option.label} ${option.meta}`.toLocaleLowerCase().includes(needle));
  }

  function nextOptionIndex(length, current, direction) {
    if (!length) return -1;
    if (direction === 'home') return 0;
    if (direction === 'end') return length - 1;
    return (Math.max(0, current) + (direction === 'previous' ? length - 1 : 1)) % length;
  }

  function labelText(select) {
    const label = select.closest('label');
    const text = label ? [...label.childNodes]
      .filter(node => node.nodeType === 3)
      .map(node => node.textContent.trim()).filter(Boolean).join(' ') : '';
    return text.replace(/\s*\(optional\)\s*/i, '').trim() || select.getAttribute('aria-label') || select.name || 'Choose an option';
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'rr-selector-dialog';
    dialog.innerHTML = `<div class="rr-selector-panel" role="document">
      <div class="rr-selector-header"><div><div class="label">Choose</div><h2 id="rrSelectorTitle">Select</h2></div><button type="button" class="btn ghost rr-selector-close" aria-label="Close selector">✕</button></div>
      <label class="rr-selector-search hidden">Search<input type="search" autocomplete="off"></label>
      <div class="rr-selector-list" role="listbox" tabindex="0" aria-labelledby="rrSelectorTitle"></div>
      <div class="rr-selector-actions"><button type="button" class="btn secondary rr-selector-cancel">Cancel</button></div>
    </div>`;
    document.body.append(dialog);
    dialog.querySelector('.rr-selector-close').addEventListener('click', close);
    dialog.querySelector('.rr-selector-cancel').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.querySelector('input').addEventListener('input', event => renderList(event.target.value));
    dialog.querySelector('.rr-selector-list').addEventListener('keydown', onListKeydown);
    return dialog;
  }

  function close() {
    if (!active) return;
    const trigger = active.trigger;
    active = null;
    if (dialog?.open) dialog.close();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
  }

  function choose(value) {
    if (!active) return;
    const { select } = active;
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    syncTrigger(select);
    close();
  }

  function optionRows(query = '') {
    if (!active) return [];
    return filterOptions([...active.select.options].filter(option => !option.disabled).map(option => ({
      value: option.value,
      selected: option.value === active.select.value,
      ...optionParts(option)
    })), query);
  }

  function renderList(query = '') {
    const list = dialog.querySelector('.rr-selector-list');
    const rows = optionRows(query);
    list.innerHTML = '';
    rows.forEach((option, index) => {
      const row = document.createElement('div');
      row.className = 'rr-selector-option';
      row.id = `rr-selector-option-${index}`;
      row.dataset.value = option.value;
      row.dataset.index = index;
      row.tabIndex = -1;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.selected));
      row.innerHTML = `<span class="rr-selector-option-copy"><strong></strong>${option.meta ? '<small></small>' : ''}</span><span class="rr-selector-check" aria-hidden="true">✓</span>`;
      row.querySelector('strong').textContent = option.label;
      if (option.meta) row.querySelector('small').textContent = option.meta;
      row.addEventListener('click', () => choose(option.value));
      list.append(row);
    });
    if (!rows.length) list.innerHTML = '<p class="rr-selector-empty">No matching options.</p>';
    const selected = list.querySelector('[aria-selected="true"]') || list.querySelector('[role="option"]');
    if (selected) {
      selected.classList.add('rr-selector-focused');
      list.setAttribute('aria-activedescendant', selected.id);
      selected.scrollIntoView({ block: 'nearest' });
    } else list.removeAttribute('aria-activedescendant');
  }

  function onListKeydown(event) {
    const rows = [...event.currentTarget.querySelectorAll('[role="option"]')];
    if (!rows.length) return;
    let current = rows.findIndex(row => row.classList.contains('rr-selector-focused'));
    let direction = null;
    if (event.key === 'ArrowDown') direction = 'next';
    else if (event.key === 'ArrowUp') direction = 'previous';
    else if (event.key === 'Home') direction = 'home';
    else if (event.key === 'End') direction = 'end';
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (current >= 0) choose(rows[current].dataset.value);
      return;
    }
    if (!direction) return;
    event.preventDefault();
    current = nextOptionIndex(rows.length, current, direction);
    rows.forEach((row, index) => row.classList.toggle('rr-selector-focused', index === current));
    event.currentTarget.setAttribute('aria-activedescendant', rows[current].id);
    rows[current].scrollIntoView({ block: 'nearest' });
  }

  function open(select, trigger) {
    if (select.disabled) return;
    const host = ensureDialog();
    active = { select, trigger };
    host.querySelector('#rrSelectorTitle').textContent = `Select ${labelText(select)}`;
    const search = host.querySelector('.rr-selector-search');
    const searchInput = search.querySelector('input');
    const searchable = select.options.length >= SEARCH_THRESHOLD;
    search.classList.toggle('hidden', !searchable);
    searchInput.placeholder = /record/i.test(labelText(select)) ? 'Search records…' : 'Search options…';
    searchInput.value = '';
    renderList();
    trigger.setAttribute('aria-expanded', 'true');
    host.showModal();
    requestAnimationFrame(() => (searchable ? searchInput : host.querySelector('.rr-selector-list')).focus());
  }

  function syncTrigger(select) {
    const trigger = select.parentElement?.querySelector(':scope > .rr-selector-trigger');
    if (!trigger) return;
    const selected = select.selectedOptions[0];
    const parts = optionParts(selected);
    trigger.querySelector('.rr-selector-value').textContent = parts.label || 'Select';
    const meta = trigger.querySelector('.rr-selector-value-meta');
    meta.textContent = parts.meta;
    meta.classList.toggle('hidden', !parts.meta);
    trigger.disabled = select.disabled;
  }

  function enhance(select) {
    if (select.dataset.rrSelector === 'true' || select.closest('.rr-selector-dialog')) return;
    select.dataset.rrSelector = 'true';
    select.classList.add('rr-selector-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    if (!select.id) select.id = `rr-native-select-${++serial}`;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'rr-selector-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', labelText(select));
    trigger.innerHTML = '<span><span class="rr-selector-value"></span><small class="rr-selector-value-meta hidden"></small></span><span class="rr-selector-chevron" aria-hidden="true">⌄</span>';
    trigger.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); open(select, trigger); });
    select.addEventListener('change', () => syncTrigger(select));
    select.insertAdjacentElement('afterend', trigger);
    syncTrigger(select);
  }

  function enhanceAll(root = document) {
    root.querySelectorAll('#modalFields select').forEach(enhance);
  }

  function install() {
    const start = () => {
      const fields = document.querySelector('#modalFields');
      if (!fields || observer) return;
      observer = new MutationObserver(() => queueMicrotask(() => enhanceAll(fields)));
      observer.observe(fields, { childList: true, subtree: true });
      enhanceAll(fields);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  return { SEARCH_THRESHOLD, optionParts, filterOptions, nextOptionIndex, enhanceAll, install };
}));
