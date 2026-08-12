'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RegulaRusticaRecordsV2 = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const ROUTINES = {
    milk_morning: { label: 'Morning Milking', frequency: 'daily', yieldType: 'milk' },
    milk_evening: { label: 'Evening Milking', frequency: 'daily', yieldType: 'milk' },
    egg_collection: { label: 'Egg Collection', frequency: 'daily', yieldType: 'eggs' },
    animal_condition_check: { label: 'Weight / Body Condition Check', frequency: 'monthly' },
    animal_hoof_check: { label: 'Hoof / Foot Check', frequency: 'monthly' },
    animal_health_check: { label: 'General Health Check', frequency: 'weekly' },
    pasture_boundary_inspection: { label: 'Fence / Boundary Inspection', frequency: 'weekly' },
    pasture_condition_check: { label: 'Pasture Condition Check', frequency: 'weekly' },
    pasture_mow: { label: 'Mow / Clip Pasture', frequency: 'monthly' },
    garden_inspection: { label: 'Garden Inspection', frequency: 'weekly' },
    garden_weed: { label: 'Weed', frequency: 'weekly' },
    garden_water_check: { label: 'Irrigation / Watering Check', frequency: 'daily' },
    orchard_inspection: { label: 'Orchard Inspection', frequency: 'monthly' },
    orchard_ground_maintenance: { label: 'Mow / Ground Maintenance', frequency: 'monthly' },
    orchard_tree_check: { label: 'Tree Condition Check', frequency: 'monthly' },
    field_inspection: { label: 'Field Inspection', frequency: 'weekly' },
    field_access_readiness: { label: 'Equipment / Access Readiness Check', frequency: 'monthly' },
    woodlot_inspection: { label: 'Boundary / Trail Inspection', frequency: 'monthly' },
    water_condition_observation: { label: 'Condition / Water-Level Observation', frequency: 'weekly' },
    equipment_inspect: { label: 'Inspect', frequency: 'monthly' },
    equipment_service: { label: 'Routine Service / Maintenance', frequency: 'monthly' },
    equipment_storage: { label: 'Clean / Prepare for Storage', frequency: 'monthly' },
    structure_inspect: { label: 'Inspect', frequency: 'monthly' },
    structure_clean: { label: 'Clean', frequency: 'monthly' },
    structure_seasonal_check: { label: 'Seasonal Condition Check', frequency: 'monthly' }
  };

  const LAND_ROUTINES = {
    pasture: ['pasture_boundary_inspection', 'pasture_condition_check', 'pasture_mow'],
    'garden plot': ['garden_inspection', 'garden_weed', 'garden_water_check'],
    orchard: ['orchard_inspection', 'orchard_ground_maintenance', 'orchard_tree_check'],
    'hay field': ['field_inspection', 'field_access_readiness'],
    woodlot: ['woodlot_inspection'],
    pond: ['water_condition_observation'],
    wetland: ['water_condition_observation']
  };

  function normalizeRelationship(value = {}) {
    const createdAt = value.createdAt || value.startedAt || new Date().toISOString();
    return {
      id: value.id || crypto.randomUUID(),
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

  function replaceRelationship(relationships, { sourceRecordId, relationshipType, targetRecordId = null, details = {}, now, makeId }) {
    const timestamp = now || new Date().toISOString();
    const active = activeRelationships(relationships, sourceRecordId, relationshipType)
      .filter(item => relationshipType !== 'parent_of' || item.details?.parentRole === details.parentRole);
    if (active.length === 1 && active[0].targetRecordId === targetRecordId) return active[0];
    active.forEach(item => {
      item.endedAt = timestamp;
      item.updatedAt = timestamp;
    });
    if (!targetRecordId) return null;
    const created = normalizeRelationship({
      id: makeId ? makeId() : undefined,
      sourceRecordId,
      targetRecordId,
      relationshipType,
      startedAt: timestamp,
      details,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    relationships.push(created);
    return created;
  }

  function reverseLocationContents(records = [], relationships = [], targetRecordId) {
    const byId = new Map(records.filter(record => !record.deletedAt).map(record => [record.id, record]));
    return relationships
      .filter(item => isActive(item) && item.relationshipType === 'located_on' && item.targetRecordId === targetRecordId)
      .map(item => byId.get(item.sourceRecordId))
      .filter(record => record && ['Animal', 'Equipment'].includes(record.type))
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  }

  function parentsFor(relationships = [], animalId) {
    const result = { dam: null, sire: null };
    relationships.filter(item => isActive(item) && item.relationshipType === 'parent_of' && item.targetRecordId === animalId)
      .forEach(item => { if (item.details?.parentRole in result) result[item.details.parentRole] = item.sourceRecordId; });
    return result;
  }

  function offspringFor(relationships = [], parentId) {
    return relationships.filter(item => isActive(item) && item.relationshipType === 'parent_of' && item.sourceRecordId === parentId)
      .map(item => ({ recordId: item.targetRecordId, parentRole: item.details?.parentRole || '' }));
  }

  function upgradeRelationships(records = [], relationships = [], sourceVersion = 9, makeId, now) {
    const normalized = relationships.map(normalizeRelationship);
    if (Number(sourceVersion || 0) >= 9) return normalized;
    const timestamp = now || new Date().toISOString();
    const recordIds = new Set(records.filter(record => !record.deletedAt).map(record => record.id));
    records.filter(record => !record.deletedAt && record.type === 'Work').forEach(record => {
      const targetRecordId = record.identity?.linkedRecordId;
      if (!targetRecordId || !recordIds.has(targetRecordId)) return;
      const exists = normalized.some(item => isActive(item) && item.sourceRecordId === record.id
        && item.targetRecordId === targetRecordId && item.relationshipType === 'related_to');
      if (!exists) normalized.push(normalizeRelationship({
        id: makeId ? makeId() : undefined,
        sourceRecordId: record.id,
        targetRecordId,
        relationshipType: 'related_to',
        startedAt: timestamp,
        details: { purpose: 'work_link', migratedFrom: 'identity.linkedRecordId' },
        createdAt: timestamp,
        updatedAt: timestamp
      }));
    });
    return normalized;
  }

  function suggestionsFor(record = {}) {
    if (record.status === 'Archived') return [];
    let types = [];
    if (record.type === 'Animal') {
      const purpose = String(record.identity?.purpose || '').toLowerCase();
      if (purpose === 'dairy') types.push('milk_morning', 'milk_evening');
      if (purpose === 'eggs') types.push('egg_collection');
      types.push('animal_health_check', 'animal_condition_check');
      if (/cattle|goat|sheep|pig|horse|donkey|hoof/i.test(String(record.identity?.species || ''))) types.push('animal_hoof_check');
    } else if (record.type === 'Land') {
      types = LAND_ROUTINES[String(record.identity?.landType || '').toLowerCase()] || [];
    } else if (record.type === 'Equipment') {
      types = ['equipment_inspect', 'equipment_service', 'equipment_storage'];
    } else if (record.type === 'Structure') {
      types = ['structure_inspect', 'structure_clean', 'structure_seasonal_check'];
    }
    return types.slice(0, 5).map(type => ({ type, ...ROUTINES[type] }));
  }

  function routineDefinition(type) { return ROUTINES[type] || null; }
  function isYieldRoutine(type) { return Boolean(ROUTINES[type]?.yieldType); }
  function knownRoutineTypes() { return Object.keys(ROUTINES); }

  return {
    ROUTINES, normalizeRelationship, isActive, activeRelationships, currentLocation,
    replaceRelationship, reverseLocationContents, parentsFor, offspringFor, upgradeRelationships,
    suggestionsFor, routineDefinition, isYieldRoutine, knownRoutineTypes
  };
}));
