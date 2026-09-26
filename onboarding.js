'use strict';

(() => {
  const root = document.querySelector('#onboarding');
  if (!root || !window.RegulaRusticaLocal) return;
  const $ = selector => root.querySelector(selector);
  const screens = [...root.querySelectorAll('[data-onboarding-step]')];
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const standardSteps = [1, 2, 3, 5, 6, 7, 8];
  const today = () => {
    const date = new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const onboarding = data => data.settings.onboarding || { version: 1, step: 1, mode: null, completed: false, dismissed: false };
  const write = (data, source = 'onboarding') => window.RegulaRusticaLocal.write(data, source);
  let currentStep = 1;
  let logoFile = null;
  let logoUrl = '';
  let logoCrop = { x: 50, y: 50, zoom: 1 };
  let logoDrag = null;
  const invitationLinks = new Map();

  function updateState(values) {
    const data = window.RegulaRusticaLocal.read();
    data.settings.onboarding = { ...onboarding(data), ...values, version: 1 };
    write(data);
    return data;
  }

  function nextStep(step = currentStep) {
    return step === 3 ? 5 : Math.min(8, step + 1);
  }

  function previousStep(step = currentStep) {
    return step === 5 ? 3 : Math.max(1, step - 1);
  }

  function showStep(step, persist = true) {
    currentStep = Math.min(8, Math.max(1, Number(step || 1)));
    if (currentStep === 4) currentStep = 3;
    screens.forEach(screen => screen.classList.toggle('hidden', Number(screen.dataset.onboardingStep) !== currentStep));
    const position = standardSteps.indexOf(currentStep);
    $('#onboardingProgress').textContent = position < 0 ? 'Cloud' : `Step ${roman[position]}`;
    $('#onboardingProgress').setAttribute('aria-label', position < 0 ? 'Cloud account setup' : `Onboarding section ${position + 1} of 7`);
    $('#onboardingBack').classList.toggle('hidden', currentStep === 1);
    $('#onboardingLater').classList.toggle('hidden', currentStep === 1 || currentStep === 8);
    if (persist) updateState({ step: currentStep, dismissed: false });
    if (currentStep === 2) renderHomestead();
    if (currentStep === 5) renderPeople();
    if (currentStep === 6) renderRecords();
    if (currentStep === 7) renderRhythm();
    if (currentStep === 8) renderFinal();
    root.scrollTo({ top: 0 });
  }

  function open() {
    root.classList.remove('hidden');
    document.body.classList.add('onboarding-open');
    showStep(onboarding(window.RegulaRusticaLocal.read()).step || 1, false);
  }

  function close() {
    root.classList.add('hidden');
    document.body.classList.remove('onboarding-open');
  }

  function renderHomestead() {
    const data = window.RegulaRusticaLocal.read();
    $('#onboardingHomesteadName').value = data.settings.homesteadName === 'My Homestead' ? '' : data.settings.homesteadName || '';
    $('#onboardingHomesteadLocation').value = data.settings.homesteadLocation || '';
    logoCrop = window.RegulaRusticaJournal.normalizeProfileCrop(data.settings.homesteadLogoCrop);
    $('#onboardingLogoZoom').value = String(logoCrop.zoom);
    renderLogoPreview();
  }

  async function renderLogoPreview() {
    const data = window.RegulaRusticaLocal.read();
    const img = $('#onboardingLogoPreview');
    const source = logoUrl || (data.settings.homesteadLogo ? await window.RegulaRusticaDocuments.urlFor(data.settings.homesteadLogo).catch(() => '') : '');
    img.hidden = !source;
    $('#onboardingLogoEmpty').classList.toggle('hidden', Boolean(source));
    $('#onboardingLogoRemove').classList.toggle('hidden', !source);
    $('#onboardingLogoFraming').classList.toggle('hidden', !source);
    if (!source) return;
    img.src = source;
    img.alt = `${data.settings.homesteadName || 'Homestead'} seal preview`;
    window.RegulaRusticaJournal.applyProfileCrop(img, logoCrop);
  }

  $('#onboardingLogoInput').addEventListener('change', event => {
    logoFile = event.target.files[0] || null;
    if (logoUrl) URL.revokeObjectURL(logoUrl);
    logoUrl = logoFile ? URL.createObjectURL(logoFile) : '';
    logoCrop = { x: 50, y: 50, zoom: 1 };
    $('#onboardingLogoZoom').value = '1';
    renderLogoPreview();
  });
  $('#onboardingLogoRemove').addEventListener('click', () => {
    logoFile = null;
    if (logoUrl) URL.revokeObjectURL(logoUrl);
    logoUrl = '';
    const data = window.RegulaRusticaLocal.read();
    data.settings.homesteadLogo = null;
    data.settings.homesteadLogoCrop = { x: 50, y: 50, zoom: 1 };
    write(data);
    renderLogoPreview();
  });
  $('#onboardingLogoZoom').addEventListener('input', event => {
    logoCrop = window.RegulaRusticaJournal.normalizeProfileCrop({ ...logoCrop, zoom: event.target.value });
    renderLogoPreview();
  });
  $('#onboardingLogoCropPreview').addEventListener('pointerdown', event => {
    if ($('#onboardingLogoPreview').hidden) return;
    logoDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, crop: { ...logoCrop } };
    event.currentTarget.setPointerCapture(event.pointerId);
  });
  $('#onboardingLogoCropPreview').addEventListener('pointermove', event => {
    if (!logoDrag || logoDrag.id !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    logoCrop = window.RegulaRusticaJournal.normalizeProfileCrop({
      ...logoDrag.crop,
      x: logoDrag.crop.x - ((event.clientX - logoDrag.x) / bounds.width) * 100,
      y: logoDrag.crop.y - ((event.clientY - logoDrag.y) / bounds.height) * 100
    });
    renderLogoPreview();
  });
  ['pointerup', 'pointercancel'].forEach(type => $('#onboardingLogoCropPreview').addEventListener(type, event => {
    if (logoDrag?.id === event.pointerId) logoDrag = null;
  }));

  $('#onboardingHomesteadForm').addEventListener('submit', async event => {
    event.preventDefault();
    const status = $('#onboardingHomesteadStatus');
    const name = $('#onboardingHomesteadName').value.trim();
    if (!name) return;
    status.textContent = 'Saving the Homestead…';
    try {
      const data = window.RegulaRusticaLocal.read();
      data.settings.homesteadName = name;
      data.settings.homesteadLocation = $('#onboardingHomesteadLocation').value.trim();
      data.settings.homesteadLogoCrop = logoCrop;
      if (logoFile) data.settings.homesteadLogo = await window.RegulaRusticaDocuments.saveHomesteadLogo(logoFile);
      data.settings.onboarding = { ...onboarding(data), step: 3, completed: false, dismissed: false };
      write(data);
      logoFile = null;
      status.textContent = '';
      showStep(3, false);
    } catch (error) {
      status.textContent = error.message || 'The Homestead could not be saved.';
      status.classList.add('error');
    }
  });

  $('#onboardingModeContinue').addEventListener('click', () => {
    updateState({ mode: 'local', step: 5 });
    showStep(5, false);
  });
  root.querySelectorAll('[name="onboardingAuthMode"]').forEach(input => input.addEventListener('change', () => {
    const signup = input.value === 'signup' && input.checked;
    $('#onboardingAuthNameLabel').classList.toggle('hidden', !signup);
    $('#onboardingAuthPassword').autocomplete = signup ? 'new-password' : 'current-password';
  }));
  $('#onboardingReturnLocal').addEventListener('click', () => {
    updateState({ mode: 'local', step: 5 });
    showStep(5, false);
  });
  $('#onboardingAuthForm').addEventListener('submit', async event => {
    event.preventDefault();
    const api = window.RegulaRusticaCloudAuth;
    const status = $('#onboardingAuthStatus');
    if (!api) { status.textContent = 'Cloud access is still starting. Try again in a moment.'; return; }
    const mode = root.querySelector('[name="onboardingAuthMode"]:checked').value;
    const email = $('#onboardingAuthEmail').value.trim();
    const password = $('#onboardingAuthPassword').value;
    status.textContent = mode === 'signup' ? 'Creating your account…' : 'Signing in…';
    try {
      const result = mode === 'signup'
        ? await api.signUp($('#onboardingAuthName').value.trim(), email, password)
        : await api.signIn(email, password);
      if (!result?.session) {
        status.textContent = 'Check your email to confirm the account, then return here and sign in.';
        root.querySelector('[name="onboardingAuthMode"][value="signin"]').checked = true;
        $('#onboardingAuthNameLabel').classList.add('hidden');
        return;
      }
      let context = window.REGULA_RUSTICA_CLOUD_CONTEXT;
      if (!context?.homesteadId) context = await api.createHomestead(window.RegulaRusticaLocal.read().settings.homesteadName);
      if (!context?.homesteadId) throw new Error('The shared Homestead could not be established.');
      if (context.premium?.status !== 'active' || context.premium.plan_key !== 'premium' || (context.premium.ends_at && Date.parse(context.premium.ends_at) <= Date.now())) throw new Error('Premium is required for Cloud Sync. Your local Farm Book is unchanged. Redeem a gift in Settings → Premium to continue.');
      const local = window.RegulaRusticaLocal.read();
      if (local.settings.homesteadLogo && !local.settings.homesteadLogo.storagePath) {
        local.settings.homesteadLogo = await window.RegulaRusticaDocuments.uploadHomesteadLogo(local.settings.homesteadLogo);
        write(local, 'onboarding-logo-upload');
      }
      const identity = await context.client.from('homesteads').update({
        name: local.settings.homesteadName,
        motto: local.settings.homesteadMotto || null,
        location: local.settings.homesteadLocation || null,
        logo_storage_path: local.settings.homesteadLogo?.storagePath || null,
        logo_crop: local.settings.homesteadLogoCrop
      }).eq('id', context.homesteadId).select('name,motto,location,logo_storage_path,logo_crop').single();
      if (identity.error) throw identity.error;
      context.homesteadIdentity = identity.data;
      if (!window.RegulaRusticaSync?.isInitialized()) await window.RegulaRusticaSync.initializeUpload();
      updateState({ step: 5 });
      showStep(5, false);
    } catch (error) {
      status.textContent = error.message || 'Cloud setup could not be completed.';
      status.classList.add('error');
    }
  });

  function renderPeople() {
    const data = window.RegulaRusticaLocal.read();
    const shared = onboarding(data).mode === 'shared';
    const invites = shared && root.querySelector('[name="onboardingPersonAccess"]:checked')?.value === 'invite';
    $('#onboardingPersonAccess').classList.toggle('hidden', !shared);
    $('#onboardingLocalAccess').classList.toggle('hidden', shared);
    $('#onboardingInviteFields').classList.toggle('hidden', !invites);
    $('#onboardingInviteEmail').required = invites;
    $('#onboardingPersonSubmit').textContent = invites ? 'Add person & create invitation' : 'Add person';
    const list = $('#onboardingPeopleList');
    list.innerHTML = '';
    const context = window.REGULA_RUSTICA_CLOUD_CONTEXT;
    const selfName = context?.session?.user?.user_metadata?.display_name || context?.session?.user?.email || 'You';
    const self = document.createElement('div');
    self.className = 'onboarding-list-row';
    self.innerHTML = `<strong>${escapeHtml(selfName)}</strong><span>${shared ? 'Current Steward' : 'Steward of this device'}</span>`;
    list.append(self);
    data.people.filter(person => !person.deletedAt && !person.removedAt && person.personType !== 'member').forEach(person => {
      const row = document.createElement('div');
      row.className = 'onboarding-list-row';
      row.innerHTML = `<strong>${escapeHtml(person.displayName)}</strong><span>Household person · no account required</span>`;
      list.append(row);
    });
    invitationLinks.forEach((link, email) => {
      const row = document.createElement('div');
      row.className = 'onboarding-list-row invitation-link';
      row.innerHTML = `<div><strong>Invitation ready</strong><span>${escapeHtml(email)}</span></div><input aria-label="Private invitation link" readonly value="${escapeHtml(link)}">`;
      list.append(row);
    });
  }
  root.querySelectorAll('[name="onboardingPersonAccess"]').forEach(input => input.addEventListener('change', event => {
    const invites = event.target.value === 'invite' && event.target.checked;
    $('#onboardingInviteFields').classList.toggle('hidden', !invites);
    $('#onboardingInviteEmail').required = invites;
    $('#onboardingPersonSubmit').textContent = invites ? 'Add person & create invitation' : 'Add person';
  }));
  $('#onboardingPersonForm').addEventListener('submit', async event => {
    event.preventDefault();
    const status = $('#onboardingPersonStatus');
    status.textContent = '';
    status.classList.remove('error');
    const name = $('#onboardingPersonName').value.trim();
    if (!name) return;
    const data = window.RegulaRusticaLocal.read();
    data.people.push({ id: crypto.randomUUID(), personType: 'child', displayName: name, status: 'active', active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    write(data);
    const invites = onboarding(data).mode === 'shared' && root.querySelector('[name="onboardingPersonAccess"]:checked')?.value === 'invite';
    if (invites) {
      const email = $('#onboardingInviteEmail').value.trim();
      if (email && window.RegulaRusticaCloudAuth) {
        try {
          const invitation = await window.RegulaRusticaCloudAuth.createInvitation(email, $('#onboardingInviteRole').value);
          if (invitation?.link) invitationLinks.set(email, invitation.link);
        } catch (error) {
          status.textContent = `${name} was added to the household, but the invitation could not be created: ${error.message}`;
          status.classList.add('error');
        }
      }
    }
    event.target.reset();
    $('#onboardingPersonSubmit').textContent = 'Add person';
    $('#onboardingInviteEmail').required = false;
    $('#onboardingInviteFields').classList.add('hidden');
    renderPeople();
  });

  function renderRecords() {
    const data = window.RegulaRusticaLocal.read();
    const list = $('#onboardingRecordList');
    list.innerHTML = '';
    data.records.filter(record => !record.deletedAt).forEach(record => {
      const row = document.createElement('div');
      row.className = 'onboarding-list-row';
      row.innerHTML = `<strong>${escapeHtml(record.name)}</strong><span>${escapeHtml(record.type)}</span>`;
      list.append(row);
    });
  }
  $('#onboardingRecordForm').addEventListener('submit', event => {
    event.preventDefault();
    const type = root.querySelector('[name="onboardingRecordType"]:checked')?.value || 'Animal';
    window.RegulaRustica.openRecordEditor(type);
  });
  root.querySelectorAll('[name="onboardingRecordType"]').forEach(input => input.addEventListener('change', event => {
    $('#onboardingRecordForm button[type="submit"]').textContent = `Add ${event.target.value} Record`;
  }));
  window.addEventListener('regula-rustica:data-saved', () => {
    if (currentStep === 6 && !root.classList.contains('hidden')) renderRecords();
  });

  function enabledSuggestionTask(data, recordId, suggestionKey) {
    return data.tasks.find(task => task.recordId === recordId && task.suggestionKey === suggestionKey && window.RegulaRusticaTasks.recurrenceEnabled(task));
  }
  function setSuggestion(record, suggestion, choreWindowId) {
    const data = window.RegulaRusticaLocal.read();
    const existing = enabledSuggestionTask(data, record.id, suggestion.key);
    if (!choreWindowId) {
      if (existing) window.RegulaRusticaTasks.disableSuggestedTask(data.tasks, record.id, suggestion.key, new Date().toISOString());
      write(data);
      return;
    }
    if (existing) {
      existing.choreWindowId = choreWindowId === 'other' ? null : choreWindowId;
      existing.updatedAt = new Date().toISOString();
      write(data);
      return;
    }
    const timestamp = new Date().toISOString();
    const recurrenceRule = { frequency: suggestion.frequency, interval: 1, mode: 'fixed_schedule', enabled: true };
    const values = { dueDate: today(), choreWindowId: choreWindowId === 'other' ? null : choreWindowId, yieldType: suggestion.yieldType, recurrenceRule, updatedAt: timestamp };
    const restored = window.RegulaRusticaTasks.reactivateSuggestedTask(data.tasks, record.id, suggestion.key, values);
    if (!restored) data.tasks.push({ id: crypto.randomUUID(), recordId: record.id, title: suggestion.title, dueDate: today(), completed: false, status: 'open', priority: 'normal', recurrenceRule, choreWindowId: values.choreWindowId, yieldType: suggestion.yieldType, suggestionKey: suggestion.key, createdAt: timestamp, updatedAt: timestamp });
    write(data);
  }
  function renderRhythm() {
    const data = window.RegulaRusticaLocal.read();
    ['morning', 'evening'].forEach(key => {
      const windowRow = data.choreWindows.find(item => item.systemKey === key && !item.deletedAt);
      $(`[name="${key}Start"]`).value = windowRow?.startTime || '';
      $(`[name="${key}End"]`).value = windowRow?.endTime || '';
    });
    const suggestions = $('#onboardingSuggestions');
    suggestions.innerHTML = '';
    const windows = data.choreWindows.filter(item => !item.deletedAt && item.enabled).sort((a, b) => a.displayOrder - b.displayOrder);
    data.records.filter(record => !record.deletedAt).forEach(record => window.RegulaRusticaTasks.suggestedTasks(record).forEach(suggestion => {
      const task = enabledSuggestionTask(data, record.id, suggestion.key);
      const row = document.createElement('label');
      row.className = 'onboarding-suggestion';
      row.innerHTML = `<span><strong>${escapeHtml(suggestion.title)}</strong><small>${escapeHtml(record.name)} · ${escapeHtml(suggestion.frequency)}</small></span><select aria-label="Place ${escapeHtml(suggestion.title)}"><option value="">Disabled</option><option value="other">Other Work</option>${windows.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')}</select>`;
      const select = row.querySelector('select');
      select.value = task ? task.choreWindowId || 'other' : '';
      select.addEventListener('change', () => { setSuggestion(record, suggestion, select.value); renderRhythmPreview(); });
      suggestions.append(row);
    }));
    if (!suggestions.children.length) suggestions.innerHTML = '<p class="onboarding-note">Add a Record to see applicable Suggested Tasks, or establish the rhythm later.</p>';
    renderRhythmPreview();
  }
  function renderRhythmPreview() {
    const data = window.RegulaRusticaLocal.read();
    const root = $('#onboardingRhythmPreview');
    root.innerHTML = '';
    data.choreWindows.filter(item => !item.deletedAt && item.enabled).sort((a, b) => a.displayOrder - b.displayOrder).forEach(item => {
      const count = data.tasks.filter(task => !task.deletedAt && window.RegulaRusticaTasks.recurrenceEnabled(task) && task.choreWindowId === item.id).length;
      const row = document.createElement('div');
      row.className = 'onboarding-rhythm-row';
      row.innerHTML = `<strong>${escapeHtml(item.name)}</strong><span>${count} recurring task${count === 1 ? '' : 's'}</span>`;
      root.append(row);
    });
    const other = data.tasks.filter(task => !task.deletedAt && window.RegulaRusticaTasks.recurrenceEnabled(task) && !task.choreWindowId).length;
    if (other) root.insertAdjacentHTML('beforeend', `<div class="onboarding-rhythm-row"><strong>Other Work</strong><span>${other} recurring task${other === 1 ? '' : 's'}</span></div>`);
  }
  $('#onboardingWindowForm').addEventListener('submit', event => {
    event.preventDefault();
    const status = $('#onboardingWindowStatus');
    const values = Object.fromEntries(new FormData(event.target));
    for (const key of ['morning', 'evening']) {
      const validation = window.RegulaRusticaTasks.validateWindowTimes(values[`${key}Start`], values[`${key}End`]);
      if (!validation.valid) { status.textContent = `${key[0].toUpperCase()}${key.slice(1)}: ${validation.message}`; status.classList.add('error'); return; }
    }
    const data = window.RegulaRusticaLocal.read();
    ['morning', 'evening'].forEach(key => {
      const item = data.choreWindows.find(window => window.systemKey === key && !window.deletedAt);
      Object.assign(item, { startTime: values[`${key}Start`], endTime: values[`${key}End`], enabled: true, updatedAt: new Date().toISOString() });
    });
    write(data);
    status.textContent = 'Chore Windows saved.';
    status.classList.remove('error');
    renderRhythmPreview();
  });

  async function renderFinal() {
    const data = window.RegulaRusticaLocal.read();
    const identity = data.settings;
    const logoUrl = identity.homesteadLogo ? await window.RegulaRusticaDocuments.urlFor(identity.homesteadLogo).catch(() => '') : '';
    $('#onboardingFinalBookplate').innerHTML = `<span class="seal">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="">` : escapeHtml((identity.homesteadName || 'H').split(/\s+/).map(word => word[0]).join('').slice(0, 2))}</span><div><h3>${escapeHtml(identity.homesteadName)}</h3>${identity.homesteadLocation ? `<p>${escapeHtml(identity.homesteadLocation)}</p>` : ''}</div>`;
    const date = new Date();
    $('#onboardingFinalDate').textContent = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const activeTasks = data.tasks.filter(task => !task.deletedAt && !task.completed && task.dueDate === today() && task.recurrenceRule?.enabled !== false);
    const windows = data.choreWindows.filter(item => !item.deletedAt && item.enabled).sort((a, b) => a.displayOrder - b.displayOrder);
    $('#onboardingFinalStats').innerHTML = `<div class="onboarding-final-stat"><strong>${activeTasks.length}</strong><span>Tasks today</span></div><div class="onboarding-final-stat"><strong>${windows.length}</strong><span>Chore windows</span></div><div class="onboarding-final-stat"><strong>${data.records.filter(record => !record.deletedAt).length}</strong><span>Records in care</span></div>`;
    const schedule = $('#onboardingFinalSchedule');
    schedule.innerHTML = '';
    windows.forEach(item => {
      const tasks = activeTasks.filter(task => task.choreWindowId === item.id);
      const block = document.createElement('div');
      block.className = 'onboarding-final-window';
      block.innerHTML = `<div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(window.RegulaRusticaTasks.formatClockTime(item.startTime))} · ${tasks.length} task${tasks.length === 1 ? '' : 's'}</small></div>${tasks.map(task => `<div class="onboarding-final-task">□ ${escapeHtml(task.title)}${task.recordId ? ` · ${escapeHtml(data.records.find(record => record.id === task.recordId)?.name || '')}` : ''}</div>`).join('')}`;
      schedule.append(block);
    });
    if (!windows.length) schedule.innerHTML = '<p class="onboarding-note">The daily rhythm can be established later in Settings.</p>';
  }

  root.querySelectorAll('[data-onboarding-next]').forEach(button => button.addEventListener('click', () => showStep(nextStep())));
  root.querySelectorAll('[data-onboarding-skip]').forEach(button => button.addEventListener('click', () => showStep(nextStep())));
  $('#onboardingBack').addEventListener('click', () => showStep(previousStep()));
  $('#onboardingLater').addEventListener('click', () => { updateState({ dismissed: true }); close(); });
  document.querySelector('#onboardingResumeButton').addEventListener('click', () => { updateState({ dismissed: false }); open(); });
  function finish(openPremium = false) {
    updateState({ step: 8, completed: true, dismissed: false });
    close();
    window.RegulaRustica.materializeRecurringTasks('onboarding-finish');
    document.querySelector(`.nav button[data-view="${openPremium ? 'settings' : 'today'}"]`)?.click();
    if (openPremium) requestAnimationFrame(() => {
      document.querySelector('[data-settings-category="cloud"]')?.click();
      document.querySelector('#accountCloudPremiumDetails').open = true;
    });
  }
  $('#onboardingFinish').addEventListener('click', () => finish());
  $('#onboardingExplorePremium').addEventListener('click', () => finish(true));
  $('#onboardingSkipSetup').addEventListener('click', () => { updateState({ mode: 'local', dismissed: true }); close(); });
  $('#onboardingReturningSignIn').addEventListener('click', () => {
    updateState({ dismissed: true });
    close();
    document.querySelector('.nav button[data-view="settings"]')?.click();
    requestAnimationFrame(() => {
      document.querySelector('[data-settings-category="cloud"]')?.click();
      document.querySelector('#accountCloudAccountDetails').open = true;
    });
  });
  window.addEventListener('regula-rustica:cloud-context', () => { if (currentStep === 5) renderPeople(); });

  const state = onboarding(window.RegulaRusticaLocal.read());
  if (!state.completed && !state.dismissed) open();
})();
