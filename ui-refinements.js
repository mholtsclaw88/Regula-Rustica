'use strict';

(function () {
  const nativePrompt = window.prompt.bind(window);
  const nativeConfirm = window.confirm.bind(window);

  window.prompt = function refinedPrompt(message, defaultValue) {
    const text = String(message || '');
    const match = text.match(/^(.+?) has no matching Yield\. Type R to record Yield, W to complete without Yield, or C to cancel\.$/);
    if (!match) return nativePrompt(message, defaultValue);

    const routineName = match[1];
    if (nativeConfirm(`${routineName} has no yield recorded.\n\nRecord the yield now?`)) return 'R';
    if (nativeConfirm(`Complete ${routineName} without recording a yield?`)) return 'W';
    return 'C';
  };

  function addStyles() {
    if (document.querySelector('#record-navigation-refinement-styles')) return;
    const style = document.createElement('style');
    style.id = 'record-navigation-refinement-styles';
    style.textContent = `
      .record-workspace { display:grid; grid-template-columns: 170px minmax(0,1fr); gap:1rem; margin-top:1rem; align-items:start; }
      .record-section-nav { position:sticky; top:1rem; display:flex; flex-direction:column; gap:.25rem; padding:.45rem; border:1px solid var(--line, #cdbf9f); border-radius:12px; background:rgba(255,255,255,.28); }
      .record-section-nav button { appearance:none; border:0; background:transparent; color:inherit; text-align:left; padding:.65rem .75rem; border-radius:8px; font:inherit; cursor:pointer; }
      .record-section-nav button:hover { background:rgba(91,71,43,.08); }
      .record-section-nav button.active { background:rgba(91,71,43,.14); font-weight:700; }
      .record-section-content { min-width:0; }
      .record-section-panel { display:none; }
      .record-section-panel.active { display:block; }
      .record-section-panel > .record-section-heading { margin:0 0 .75rem; }
      .record-context, .tabs-mini { display:none !important; }
      @media (max-width: 720px) {
        .record-workspace { display:block; }
        .record-section-nav { position:static; flex-direction:row; overflow-x:auto; margin-bottom:.75rem; scrollbar-width:thin; }
        .record-section-nav button { flex:0 0 auto; text-align:center; white-space:nowrap; }
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

  function buildRecordNavigation() {
    const card = document.querySelector('#recordView > .card');
    if (!card || card.querySelector('.record-workspace')) return;

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

    nav.addEventListener('click', event => {
      const button = event.target.closest('button[data-record-section]');
      if (!button) return;
      activate(nav, panels, button.dataset.recordSection);
    });

    workspace.append(nav, content);
    const oldTabs = card.querySelector('.tabs-mini');
    if (oldTabs) oldTabs.insertAdjacentElement('beforebegin', workspace);
    else card.appendChild(workspace);
    activate(nav, panels, 'stewardship');
  }

  function init() {
    addStyles();
    buildRecordNavigation();
    const observer = new MutationObserver(() => buildRecordNavigation());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
