'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.RegulaRusticaRecordRelationships = api;
    api.installBrowserIntegration();
  }
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const nowIso = () => new Date().toISOString();
  const makeId = () => crypto.randomUUID();
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);

  function normalizeRelationship(value = {}) {
    const createdAt = value.createdAt || value.startedAt || nowIso();
    return {
      id: value.id || makeId(),
      sourceRecordId: value.sourceRecordId || value.source_record_id || null,
      targetRecordId: value.targetRecordId || value.target_record_id || null,
      relationshipType: value.relationshipType || value.relationship_type || 'related_to',
      startedAt: value.startedAt || value.started_at || createdAt,
      endedAt: value.endedAt || value.ended_at || null,
      details: value.details && typeof value.details === 'object' ? value.details : {},
      createdAt,
      updatedAt: value.updatedAt || value.updated_at || createdAt,
      deletedAt: value.deletedAt || value.deleted_at || null
    };
  }

  const isActive = relationship => Boolean(relationship && !relationship.deletedAt && !relationship.endedAt);

  function activeRelationships(relationships = [], sourceRecordId, relationshipType) {
    return relationships.filter(item => isActive(item) && item.sourceRecordId === sourceRecordId
      && item.relationshipType === relationshipType);
  }

  function currentLocation(relationships = [], sourceRecordId) {
    return activeRelationships(relationships, sourceRecordId, 'located_on')[0] || null;
  }

  function replaceRelationship(relationships, { sourceRecordId, relationshipType, targetRecordId = null, details = {}, timestamp = nowIso() }) {
    const active = activeRelationships(relationships, sourceRecordId, relationshipType)
      .filter(item => relationshipType !== 'parent_of' || item.details?.parentRole === details.parentRole);
    if (active.length === 1 && active[0].targetRecordId === targetRecordId) return active[0];
    active.forEach(item => {
      item.endedAt = timestamp;
      item.updatedAt = timestamp;
    });
    if (!targetRecordId) return null;
    const created = normalizeRelationship({
      id: makeId(), sourceRecordId, targetRecordId, relationshipType,
      startedAt: timestamp, details, createdAt: timestamp, updatedAt: timestamp
    });
    relationships.push(created);
    return created;
  }

  function setParent(relationships, animalId, parentRole, parentId, timestamp = nowIso()) {
    const active = relationships.filter(item => isActive(item) && item.relationshipType === 'parent_of'
      && item.targetRecordId === animalId && item.details?.parentRole === parentRole);
    if (active.length === 1 && active[0].sourceRecordId === parentId) return active[0];
    active.forEach(item => {
      item.endedAt = timestamp;
      item.updatedAt = timestamp;
    });
    if (!parentId) return null;
    const created = normalizeRelationship({
      id: makeId(), sourceRecordId: parentId, targetRecordId: animalId,
      relationshipType: 'parent_of', startedAt: timestamp, details: { parentRole },
      createdAt: timestamp, updatedAt: timestamp
    });
    relationships.push(created);
    return created;
  }

  function parentsFor(relationships = [], animalId) {
    const result = { dam: null, sire: null };
    relationships.filter(item => isActive(item) && item.relationshipType === 'parent_of' && item.targetRecordId === animalId)
      .forEach(item => {
        if (item.details?.parentRole === 'dam' || item.details?.parentRole === 'sire') result[item.details.parentRole] = item.sourceRecordId;
      });
    return result;
  }

  function offspringFor(relationships = [], parentId) {
    return relationships.filter(item => isActive(item) && item.relationshipType === 'parent_of'
      && item.sourceRecordId === parentId).map(item => item.targetRecordId);
  }

  function reverseLocationContents(records = [], relationships = [], targetRecordId) {
    const byId = new Map(records.filter(record => !record.deletedAt).map(record => [record.id, record]));
    return relationships.filter(item => isActive(item) && item.relationshipType === 'located_on'
      && item.targetRecordId === targetRecordId)
      .map(item => byId.get(item.sourceRecordId))
      .filter(record => record && ['Animal', 'Equipment'].includes(record.type))
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  }

  const normalizedSpecies = value => String(value || '').trim().toLowerCase();

  function parentAnimalOptions(records = [], animalId, species) {
    const expectedSpecies = normalizedSpecies(species);
    if (!expectedSpecies) return [];
    return records
      .filter(record => !record.deletedAt && record.status === 'Active' && record.type === 'Animal'
        && record.id !== animalId
        && String(record.identity?.managedAs || 'Individual').trim().toLowerCase() !== 'group'
        && normalizedSpecies(record.identity?.species) === expectedSpecies)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(record => ({ label: record.name, value: record.id }));
  }

  function activePersonOptions(data = {}) {
    const seen = new Set();
    return (data.people || [])
      .filter(person => {
        const status = String(person.status || '').toLowerCase();
        if (!person.id || person.deletedAt || person.removedAt || person.active === false
          || ['inactive', 'archived', 'removed', 'suspended'].includes(status)) return false;
        const key = person.memberId ? `member:${person.memberId}` : `person:${person.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || '')))
      .map(person => ({
        label: `${person.displayName || 'Unnamed person'}${person.personType === 'child' ? ' (child)' : ''}`,
        value: person.id
      }));
  }

  function withResponsiblePerson(stewardship = {}, responsiblePersonId = '') {
    const next = { ...stewardship, responsiblePersonId: responsiblePersonId || '' };
    delete next.responsible;
    return next;
  }

  function installBrowserIntegration() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    let activeRecordId = null;
    let recordModalContext = null;
    let pendingRecordSave = null;
    let applyingStructuredSave = false;

    const read = () => window.RegulaRusticaLocal?.read?.() || null;
    const write = data => window.RegulaRusticaLocal?.write?.(data, 'records-relationships');
    const activeRecords = data => (data?.records || []).filter(record => !record.deletedAt && record.status !== 'Archived');
    const personName = (data, id, fallback = '') => data.people?.find(person => !person.deletedAt && person.id === id)?.displayName || fallback;
    const recordName = (data, id) => data.records?.find(record => record.id === id)?.name || '';

    function labelStarting(root, prefix) {
      return [...root.querySelectorAll('label')].find(label => label.firstChild?.textContent?.trim().startsWith(prefix));
    }

    function makeSelectLabel(labelText, name, options, selected = '') {
      const label = document.createElement('label');
      label.dataset.recordsRelationships = 'true';
      label.append(document.createTextNode(labelText));
      const select = document.createElement('select');
      select.name = name;
      options.forEach(option => select.add(new Option(option.label, option.value)));
      select.value = selected || '';
      label.append(select);
      return label;
    }

    function locationOptions(data, recordId) {
      return [{ label: 'Other / Unspecified', value: '' }, ...activeRecords(data)
        .filter(record => record.id !== recordId && ['Land', 'Structure'].includes(record.type))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(record => ({ label: `${record.name} — ${record.type}`, value: record.id }))];
    }

    function personOptions(data) {
      return [{ label: 'Not selected', value: '' }, ...activePersonOptions(data)];
    }

    function animalOptions(data, animalId, species) {
      return [{ label: 'Not recorded', value: '' }, ...parentAnimalOptions(data.records, animalId, species)];
    }

    function replaceLabel(root, prefixes, replacement) {
      const existing = prefixes.map(prefix => labelStarting(root, prefix)).find(Boolean);
      if (existing) existing.replaceWith(replacement);
      else root.append(replacement);
    }

    function augmentRecordForm(id) {
      const root = document.querySelector('#modalFields');
      if (!root) return;
      const data = read();
      if (!data) return;
      const type = root.querySelector('[name=type]')?.value;
      if (!type) return;
      const record = data.records.find(item => item.id === id) || { id: null, type, identity: {}, stewardship: {} };
      const relationshipList = data.relationships || (data.relationships = []);
      const pendingResponsible = root.querySelector('[name=rrResponsiblePerson]')?.value;
      const pendingDam = root.querySelector('[name=rrDam]')?.value;
      const pendingSire = root.querySelector('[name=rrSire]')?.value;
      root.querySelectorAll('[data-records-relationships=true]').forEach(node => node.remove());

      if (type === 'Structure') labelStarting(root, 'Location (optional)')?.remove();

      if (['Animal', 'Equipment'].includes(type)) {
        const selected = record.id ? currentLocation(relationshipList, record.id)?.targetRecordId || '' : '';
        replaceLabel(root, ['Current location'], makeSelectLabel('Current location', 'rrCurrentLocation', locationOptions(data, record.id), selected));
      }

      if (['Animal', 'Equipment', 'Structure', 'Work'].includes(type)) {
        replaceLabel(root,
          ['Responsible person (optional)', 'Assigned household member (optional)', 'Responsible household member (optional)'],
          makeSelectLabel('Responsible person (optional)', 'rrResponsiblePerson', personOptions(data), pendingResponsible ?? (record.stewardship?.responsiblePersonId || ''))
        );
      }

      if (type === 'Land') labelStarting(root, 'Current occupants (optional)')?.remove();

      if (type === 'Animal') {
        const parents = record.id ? parentsFor(relationshipList, record.id) : { dam: null, sire: null };
        const species = root.querySelector('[name=species]')?.value || record.identity?.species || '';
        const parentWrap = document.createElement('div');
        parentWrap.dataset.recordsRelationships = 'true';
        parentWrap.className = 'form-grid rr-parentage';
        parentWrap.append(
          makeSelectLabel('Dam (optional)', 'rrDam', animalOptions(data, record.id, species), pendingDam ?? parents.dam),
          makeSelectLabel('Sire (optional)', 'rrSire', animalOptions(data, record.id, species), pendingSire ?? parents.sire)
        );
        root.append(parentWrap);
        const managed = root.querySelector('[name=managedAs]');
        const update = () => parentWrap.classList.toggle('hidden', managed?.value === 'Group');
        managed?.addEventListener('change', update);
        const speciesInput = root.querySelector('[name=species]');
        if (speciesInput && !speciesInput.dataset.rrParentBound) {
          speciesInput.dataset.rrParentBound = 'true';
          speciesInput.addEventListener('input', () => augmentRecordForm(id));
        }
        update();
      }

      if (type === 'Work') {
        const relation = record.id ? activeRelationships(relationshipList, record.id, 'related_to')
          .find(item => item.details?.purpose === 'work_link') : null;
        const linked = root.querySelector('[name=linkedRecordId]');
        if (linked && relation?.targetRecordId) linked.value = relation.targetRecordId;
      }

      const typeSelect = root.querySelector('[name=type]');
      if (typeSelect && !typeSelect.dataset.rrBound) {
        typeSelect.dataset.rrBound = 'true';
        typeSelect.addEventListener('change', () => queueMicrotask(() => augmentRecordForm(id)));
      }
    }

    function resolveVisibleRecord(data) {
      if (activeRecordId) {
        const record = data.records.find(item => item.id === activeRecordId);
        if (record) return record;
      }
      const name = document.querySelector('#recordTitle')?.textContent?.trim();
      const type = document.querySelector('#recordTypeLabel')?.textContent?.trim();
      return data.records.find(record => !record.deletedAt && record.name === name && record.type === type) || null;
    }

    function identitySummary(record, data) {
      const identity = record.identity || {};
      const parts = record.type === 'Animal'
        ? [identity.managedAs, identity.species, identity.breed, identity.purpose, identity.quantity ? `Quantity: ${identity.quantity}` : '']
        : record.type === 'Land' ? [identity.landType, identity.size]
          : record.type === 'Equipment' ? [identity.equipmentType, identity.make, identity.model]
            : record.type === 'Structure' ? [identity.structureType]
              : [identity.workType, identity.targetDate ? `Target: ${identity.targetDate}` : ''];
      if (record.type === 'Work') {
        const relation = activeRelationships(data.relationships || [], record.id, 'related_to').find(item => item.details?.purpose === 'work_link');
        if (relation) parts.push(`Linked to: ${recordName(data, relation.targetRecordId)}`);
      }
      return parts.filter(Boolean).join(' · ') || 'No identifying details yet.';
    }

    function stewardshipSummary(record, data) {
      const stewardship = record.stewardship || {};
      const parts = [];
      if (['Animal', 'Equipment'].includes(record.type)) {
        const relation = currentLocation(data.relationships || [], record.id);
        const location = relation ? recordName(data, relation.targetRecordId) : stewardship.location;
        if (location) parts.push(`Location: ${location}`);
      }
      if (record.type === 'Land') {
        if (stewardship.currentUse) parts.push(`Use: ${stewardship.currentUse}`);
        if (stewardship.rotationStage) parts.push(`Rotation: ${stewardship.rotationStage}`);
      }
      if (record.type === 'Structure') {
        if (stewardship.currentUse) parts.push(`Use: ${stewardship.currentUse}`);
        if (stewardship.condition) parts.push(`Condition: ${stewardship.condition}`);
      }
      if (record.type === 'Work') {
        if (stewardship.stage) parts.push(`Stage: ${stewardship.stage}`);
        if (stewardship.blockedBy) parts.push(`Blocked by: ${stewardship.blockedBy}`);
      }
      if (['Animal', 'Equipment', 'Structure', 'Work'].includes(record.type)) {
        const responsible = personName(data, stewardship.responsiblePersonId, stewardship.responsible || '');
        if (responsible) parts.push(`Responsible: ${responsible}`);
      }
      return parts.join(' · ') || 'No current stewardship details.';
    }

    function ensureRelationshipSection() {
      let section = document.querySelector('#recordRelationships');
      if (section) return section;
      const stewardship = document.querySelector('#recordStewardship');
      if (!stewardship) return null;
      section = document.createElement('div');
      section.id = 'recordRelationships';
      section.className = 'record-relationships';
      section.innerHTML = '<h4>Connected Records</h4><div id="recordRelationshipList" class="steward-box"></div>';
      stewardship.after(section);
      return section;
    }

    function enhanceRecordView() {
      if (!document.querySelector('#recordView.active')) return;
      const data = read();
      if (!data) return;
      const record = resolveVisibleRecord(data);
      if (!record) return;
      activeRecordId = record.id;
      const identity = document.querySelector('#recordIdentity');
      const stewardship = document.querySelector('#recordStewardship');
      if (identity) identity.textContent = identitySummary(record, data);
      if (stewardship) stewardship.textContent = stewardshipSummary(record, data);

      const section = ensureRelationshipSection();
      const root = section?.querySelector('#recordRelationshipList');
      if (!section || !root) return;
      const lines = [];
      const location = currentLocation(data.relationships || [], record.id);
      if (location) lines.push(`<strong>Current location:</strong> ${escapeHtml(recordName(data, location.targetRecordId))}`);
      if (['Land', 'Structure'].includes(record.type)) {
        const contents = reverseLocationContents(data.records, data.relationships || [], record.id);
        const animals = contents.filter(item => item.type === 'Animal');
        const equipment = contents.filter(item => item.type === 'Equipment');
        if (animals.length) lines.push(`<strong>Current occupants:</strong> ${animals.map(item => escapeHtml(item.name)).join(', ')}`);
        if (equipment.length) lines.push(`<strong>Equipment stored here:</strong> ${equipment.map(item => escapeHtml(item.name)).join(', ')}`);
      }
      if (record.type === 'Animal') {
        const parents = parentsFor(data.relationships || [], record.id);
        if (parents.dam) lines.push(`<strong>Dam:</strong> ${escapeHtml(recordName(data, parents.dam))}`);
        if (parents.sire) lines.push(`<strong>Sire:</strong> ${escapeHtml(recordName(data, parents.sire))}`);
        const offspring = offspringFor(data.relationships || [], record.id).map(id => recordName(data, id)).filter(Boolean);
        if (offspring.length) lines.push(`<strong>Offspring:</strong> ${offspring.map(escapeHtml).join(', ')}`);
      }
      const relatedTargets = activeRelationships(data.relationships || [], record.id, 'related_to')
        .map(item => recordName(data, item.targetRecordId)).filter(Boolean);
      if (relatedTargets.length) lines.push(`<strong>Related records:</strong> ${relatedTargets.map(escapeHtml).join(', ')}`);
      const relatedWork = (data.relationships || []).filter(item => isActive(item) && item.relationshipType === 'related_to'
        && item.targetRecordId === record.id)
        .map(item => data.records.find(recordItem => recordItem.id === item.sourceRecordId))
        .filter(item => item?.type === 'Work');
      if (relatedWork.length) lines.push(`<strong>Related Work:</strong> ${relatedWork.map(item => escapeHtml(item.name)).join(', ')}`);
      root.innerHTML = lines.map(line => `<p>${line}</p>`).join('');
      section.classList.toggle('hidden', !lines.length);
    }

    function captureRecordSubmit() {
      if (recordModalContext?.mode !== 'record') return;
      const root = document.querySelector('#modalFields');
      if (!root) return;
      pendingRecordSave = {
        id: recordModalContext.id,
        name: root.querySelector('[name=name]')?.value?.trim() || '',
        type: root.querySelector('[name=type]')?.value || '',
        locationId: root.querySelector('[name=rrCurrentLocation]')?.value || '',
        responsiblePersonId: root.querySelector('[name=rrResponsiblePerson]')?.value || '',
        damId: root.querySelector('[name=rrDam]')?.value || '',
        sireId: root.querySelector('[name=rrSire]')?.value || '',
        workTargetId: root.querySelector('[name=linkedRecordId]')?.value || '',
        managedAs: root.querySelector('[name=managedAs]')?.value || ''
      };
    }

    function applyStructuredRecordSave() {
      if (!pendingRecordSave || applyingStructuredSave) return;
      const pending = pendingRecordSave;
      pendingRecordSave = null;
      const data = read();
      if (!data) return;
      const record = pending.id
        ? data.records.find(item => item.id === pending.id)
        : [...data.records].filter(item => !item.deletedAt && item.name === pending.name && item.type === pending.type)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      if (!record) return;
      data.relationships ||= [];
      record.stewardship ||= {};
      const timestamp = nowIso();

      if (['Animal', 'Equipment'].includes(record.type)) {
        replaceRelationship(data.relationships, {
          sourceRecordId: record.id, relationshipType: 'located_on', targetRecordId: pending.locationId || null,
          details: { purpose: 'current_location' }, timestamp
        });
        delete record.stewardship.location;
      }
      if (['Animal', 'Equipment', 'Structure', 'Work'].includes(record.type)) {
        record.stewardship = withResponsiblePerson(record.stewardship, pending.responsiblePersonId);
      }
      if (record.type === 'Land') delete record.stewardship.currentOccupants;
      if (record.type === 'Structure' && record.identity) delete record.identity.location;
      if (record.type === 'Animal') {
        const individual = pending.managedAs !== 'Group';
        setParent(data.relationships, record.id, 'dam', individual ? pending.damId || null : null, timestamp);
        setParent(data.relationships, record.id, 'sire', individual ? pending.sireId || null : null, timestamp);
      }
      if (record.type === 'Work') {
        replaceRelationship(data.relationships, {
          sourceRecordId: record.id, relationshipType: 'related_to', targetRecordId: pending.workTargetId || null,
          details: { purpose: 'work_link' }, timestamp
        });
      }
      record.updatedAt = timestamp;
      applyingStructuredSave = true;
      write(data);
      applyingStructuredSave = false;
      activeRecordId = record.id;
      queueMicrotask(enhanceRecordView);
    }

    function install() {
      if (!window.RegulaRusticaLocal) {
        setTimeout(install, 50);
        return;
      }
      const originalOpenRecord = window.openRecord;
      if (typeof originalOpenRecord === 'function' && !originalOpenRecord.__rrWrapped) {
        const wrapped = function(id) {
          activeRecordId = id;
          const result = originalOpenRecord.apply(this, arguments);
          queueMicrotask(enhanceRecordView);
          return result;
        };
        wrapped.__rrWrapped = true;
        window.openRecord = wrapped;
      }
      const originalOpenModal = window.openModal;
      if (typeof originalOpenModal === 'function' && !originalOpenModal.__rrWrapped) {
        const wrapped = function(mode, id) {
          recordModalContext = { mode, id: id || null };
          const result = originalOpenModal.apply(this, arguments);
          if (mode === 'record') queueMicrotask(() => augmentRecordForm(id || null));
          return result;
        };
        wrapped.__rrWrapped = true;
        window.openModal = wrapped;
      }
      document.querySelector('#modalForm')?.addEventListener('submit', captureRecordSubmit, true);
      window.addEventListener('regula-rustica:data-saved', event => {
        if (event.detail?.source !== 'records-relationships') applyStructuredRecordSave();
        queueMicrotask(enhanceRecordView);
      });
      document.addEventListener('click', event => {
        if (event.target.closest('#recordEdit')) queueMicrotask(() => augmentRecordForm(activeRecordId));
      });
      queueMicrotask(enhanceRecordView);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }

  return {
    normalizeRelationship, isActive, activeRelationships, currentLocation, replaceRelationship,
    setParent, parentsFor, offspringFor, reverseLocationContents, parentAnimalOptions,
    activePersonOptions, withResponsiblePerson, installBrowserIntegration
  };
}));
