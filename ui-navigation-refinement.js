'use strict';

(function () {
  const MOBILE_QUERY = '(max-width: 720px)';
  let observerQueued = false;

  function addStyles() {
    if (document.querySelector('#ui-navigation-refinement-styles')) return;
    const style = document.createElement('style');
    style.id = 'ui-navigation-refinement-styles';
    style.textContent = `
      .section-head { align-items:flex-start; }
      .section-head > div > .label { display:block; margin-bottom:.18rem; }
      .section-head h2 { margin-top:0; }

      .record-type-filter,
      #ledger > .choice-filter,
      #yield > .choice-filter { margin-bottom:1rem; }
      .record-type-filter .choice-pills,
      #ledger > .choice-filter .choice-pills,
      #yield > .choice-filter .choice-pills { flex-wrap:nowrap; overflow-x:auto; padding-bottom:.2rem; scrollbar-width:thin; }
      .record-type-filter .choice-pills label,
      #ledger > .choice-filter .choice-pills label,
      #yield > .choice-filter .choice-pills label { flex:0 0 auto; white-space:nowrap; }

      #tasks .card { padding-top:.85rem; }
      #tasks .task-choice-filter { margin-bottom:.65rem; }
      #tasks #taskAdvancedFilters { margin:.35rem 0 1rem; border-top:1px solid var(--line, #cdbf9f); border-bottom:1px solid var(--line, #cdbf9f); padding:.25rem 0; }
      #tasks #taskAdvancedFilters > summary { cursor:pointer; font-weight:700; padding:.6rem 0; }
      #tasks #taskAdvancedFilters .task-choice-filter { margin:.35rem 0 .75rem; }
      #tasks #taskAdvancedFilters .filters { margin-top:.5rem; }

      .calendar-toolbar { gap:.75rem; }
      .calendar-display-options { position:relative; }
      .calendar-display-options > summary { list-style:none; cursor:pointer; }
      .calendar-display-options > summary::-webkit-details-marker { display:none; }
      .calendar-display-options[open] .calendar-filters { margin-top:.5rem; }
      .calendar-display-options .calendar-filters { margin-bottom:0; }

      .settings-nav { display:flex; flex-direction:column; align-items:stretch; gap:.3rem; padding:.45rem; border:1px solid var(--line, #cdbf9f); border-radius:12px; background:rgba(255,255,255,.26); }
      .settings-nav button { width:100%; text-align:left; justify-content:flex-start; }

      #today .today-section,
      #today > .grid2 > .card { width:100%; }
      #today .quick #todayAddRecord { display:none !important; }

      .nav-more-wrap { display:none; position:relative; }
      .nav-more-menu { position:absolute; right:0; top:calc(100% + .35rem); min-width:160px; z-index:30; padding:.35rem; border:1px solid var(--line, #cdbf9f); border-radius:12px; background:var(--paper, #f7f1e5); box-shadow:0 10px 28px rgba(42,34,24,.18); }
      .nav-more-menu[hidden] { display:none; }
      .nav-more-menu button { display:block; width:100%; text-align:left; border:0; background:transparent; padding:.68rem .75rem; border-radius:8px; color:inherit; font:inherit; }
      .nav-more-menu button:hover,
      .nav-more-menu button.active { background:rgba(91,71,43,.12); }

      @media (min-width: 721px) {
        #settings { display:grid; grid-template-columns:170px minmax(0,1fr); column-gap:1rem; }
        #settings > .section-head { grid-column:1 / -1; }
        #settings > .settings-nav { grid-column:1; align-self:start; position:sticky; top:4rem; }
        #settings > .grid2 { grid-column:2; display:block; }
        #settings .settings-section { width:100%; }
      }

      @media (max-width: 720px) {
        .nav { overflow:visible; }
        .nav > button[data-view="yield"],
        .nav > button[data-view="ledger"],
        .nav > button[data-view="settings"] { display:none; }
        .nav-more-wrap { display:block; margin-left:auto; }
        .nav-more-wrap > button { height:100%; }

        .section-head { gap:.65rem; }
        .section-head .btn.primary { flex:0 0 auto; }
        .record-type-filter { overflow:hidden; }
        .record-type-filter legend,
        #ledger > .choice-filter legend,
        #yield > .choice-filter legend { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }

        #tasks .choice-pills { flex-wrap:nowrap; overflow-x:auto; scrollbar-width:thin; }
        #tasks .choice-pills label { flex:0 0 auto; white-space:nowrap; }

        .calendar-toolbar { align-items:stretch; }
        .calendar-toolbar > * { width:100%; }
        .calendar-toolbar .calendar-nav { justify-content:space-between; }
        .calendar-view-pills { overflow-x:auto; flex-wrap:nowrap; }
        .calendar-view-pills label { flex:0 0 auto; }

        #settings { display:block; }
        .settings-nav { position:static; flex-direction:row; overflow-x:auto; margin-bottom:.8rem; scrollbar-width:thin; }
        .settings-nav button { width:auto; flex:0 0 auto; white-space:nowrap; text-align:center; }
        #settings > .grid2 { display:block; }
        #settings .settings-section { width:100%; }
      }
    `;
    document.head.appendChild(style);
  }

  function simplifyTaskFilters() {
    const advanced = document.querySelector('#taskAdvancedFilters');
    if (!advanced || advanced.dataset.refined === 'true') return;
    const taskFilters = [...document.querySelectorAll('#tasks .task-choice-filter')];
    const timing = taskFilters.find(fieldset => fieldset.querySelector('[name="taskTimingFilter"]'));
    const filters = advanced.querySelector('.filters');
    if (timing && filters) advanced.insertBefore(timing, filters);
    const summary = advanced.querySelector('summary');
    if (summary) summary.textContent = 'Filter & sort';
    advanced.open = false;
    advanced.dataset.refined = 'true';
  }

  function simplifyCalendarControls() {
    const toolbar = document.querySelector('#calendar .calendar-toolbar');
    const filters = toolbar?.querySelector('.calendar-filters');
    if (!toolbar || !filters || toolbar.querySelector('.calendar-display-options')) return;
    const details = document.createElement('details');
    details.className = 'calendar-display-options';
    const summary = document.createElement('summary');
    summary.className = 'btn secondary';
    summary.textContent = 'Show';
    filters.parentNode.insertBefore(details, filters);
    details.append(summary, filters);
  }

  function refineSettingsLabels() {
    const cloud = document.querySelector('.settings-nav [data-settings-target="settingCloud"]');
    if (cloud) cloud.textContent = 'Cloud & Sharing';
    const backup = document.querySelector('.settings-nav [data-settings-target="settingBackup"]');
    if (backup) backup.textContent = 'Backup & Restore';
  }

  function buildMoreNavigation() {
    const nav = document.querySelector('.nav[aria-label="Primary navigation"]');
    if (!nav || nav.querySelector('.nav-more-wrap')) return;
    const destinations = [
      ['yield', 'Yield'],
      ['ledger', 'Ledger'],
      ['settings', 'Settings']
    ];
    const wrap = document.createElement('div');
    wrap.className = 'nav-more-wrap';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'More';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-haspopup', 'menu');
    const menu = document.createElement('div');
    menu.className = 'nav-more-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');

    destinations.forEach(([view, label]) => {
      const proxy = document.createElement('button');
      proxy.type = 'button';
      proxy.dataset.proxyView = view;
      proxy.textContent = label;
      proxy.setAttribute('role', 'menuitem');
      proxy.addEventListener('click', () => {
        nav.querySelector(`button[data-view="${view}"]`)?.click();
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        syncMoreState();
      });
      menu.appendChild(proxy);
    });

    toggle.addEventListener('click', event => {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      toggle.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', event => {
      if (!wrap.contains(event.target)) {
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
    wrap.append(toggle, menu);
    nav.appendChild(wrap);
    syncMoreState();
  }

  function syncMoreState() {
    const nav = document.querySelector('.nav[aria-label="Primary navigation"]');
    const wrap = nav?.querySelector('.nav-more-wrap');
    if (!nav || !wrap) return;
    const active = nav.querySelector('button[data-view].active')?.dataset.view || '';
    const inMore = ['yield', 'ledger', 'settings'].includes(active);
    const toggle = wrap.querySelector(':scope > button');
    toggle?.classList.toggle('active', inMore);
    wrap.querySelectorAll('[data-proxy-view]').forEach(button => button.classList.toggle('active', button.dataset.proxyView === active));
  }

  function refineToday() {
    const tasks = document.querySelector('#todayTasks')?.closest('.card');
    const events = document.querySelector('#todayEvents')?.closest('.card');
    const glance = document.querySelector('#openCount')?.closest('.card');
    const grid = document.querySelector('#today > .grid2');
    const desired = [tasks, events, glance].filter(Boolean);
    if (!grid || !desired.length) return;
    const current = [...grid.children].filter(node => desired.includes(node));
    const alreadyOrdered = current.length === desired.length && desired.every((node, index) => current[index] === node);
    if (alreadyOrdered) return;
    desired.forEach(node => grid.appendChild(node));
  }

  function refresh() {
    if (observerQueued) return;
    observerQueued = true;
    queueMicrotask(() => {
      observerQueued = false;
      addStyles();
      buildMoreNavigation();
      simplifyTaskFilters();
      simplifyCalendarControls();
      refineSettingsLabels();
      refineToday();
      syncMoreState();
    });
  }

  function init() {
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    window.matchMedia(MOBILE_QUERY).addEventListener?.('change', refresh);
    window.addEventListener('regula-rustica:data-saved', refresh);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
