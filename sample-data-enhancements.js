'use strict';

(function installSampleDataEnhancements() {
  const SAMPLE_NAME = 'Wood Thief Homestead';
  const FIXTURE_VERSION = 1;

  const today = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };

  const atLocalNoon = date => `${date}T12:00:00`;

  function looksLikeBaseSample(data) {
    if (!data || data.settings?.homesteadName !== SAMPLE_NAME) return false;
    if (data.legacy?.sampleFixtureVersion >= FIXTURE_VERSION) return false;
    const ids = new Set((data.records || []).filter(record => !record.deletedAt).map(record => record.id));
    return ids.size === 4
      && ['daisy', 'north', 'tractor', 'woodshed'].every(id => ids.has(id))
      && (data.routines || []).filter(routine => !routine.deletedAt).length === 0;
  }

  function addRoutine(data, { id, recordId, name, routineType, windowKey }) {
    const date = today();
    const timestamp = new Date().toISOString();
    const window = (data.choreWindows || []).find(item => !item.deletedAt && item.systemKey === windowKey);
    data.routines.push({
      id,
      recordId,
      name,
      routineType,
      enabled: true,
      frequency: 'daily',
      interval: 1,
      firstDate: date,
      nextDate: date,
      choreWindowId: window?.id || null,
      personId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    });
    data.routineOccurrences.push({
      id: `${id}-today`,
      routineId: id,
      occurrenceDate: date,
      status: 'pending',
      completionMethod: null,
      completedAt: null,
      legacyTaskId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    });
  }

  function enhance(data) {
    if (!looksLikeBaseSample(data)) return false;
    const timestamp = new Date().toISOString();
    const date = today();

    data.records.push({
      id: 'laying-hens',
      type: 'Animal',
      name: 'Laying Hens',
      status: 'Active',
      identity: {
        managedAs: 'Group',
        species: 'Chicken',
        breed: 'Mixed laying flock',
        purpose: 'Eggs',
        quantity: 12
      },
      stewardship: {
        location: 'Hen house',
        responsible: '',
        currentUse: 'Egg flock',
        stage: ''
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    });

    addRoutine(data, {
      id: 'sample-routine-milk-morning',
      recordId: 'daisy',
      name: 'Morning Milking',
      routineType: 'milk_morning',
      windowKey: 'morning'
    });
    addRoutine(data, {
      id: 'sample-routine-milk-evening',
      recordId: 'daisy',
      name: 'Evening Milking',
      routineType: 'milk_evening',
      windowKey: 'evening'
    });
    addRoutine(data, {
      id: 'sample-routine-egg-collection',
      recordId: 'laying-hens',
      name: 'Egg Collection',
      routineType: 'egg_collection',
      windowKey: 'morning'
    });

    data.calendarEvents ||= [];
    data.calendarEvents.push(
      {
        id: 'sample-event-feed-delivery',
        title: 'Feed delivery',
        startDate: date,
        endDate: date,
        allDay: true,
        startTime: '',
        endTime: '',
        location: 'Barn',
        notes: 'Sample event for Calendar testing.',
        recordId: 'laying-hens',
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null
      },
      {
        id: 'sample-event-vet-visit',
        title: 'Routine livestock check',
        startDate: date,
        endDate: date,
        allDay: false,
        startTime: '14:00',
        endTime: '15:00',
        location: 'Barn',
        notes: 'Sample timed event for Calendar testing.',
        recordId: 'daisy',
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null
      }
    );

    data.events ||= [];
    data.events.push({
      id: 'sample-chronicle-hens-added',
      recordId: 'laying-hens',
      eventType: 'Purchase',
      date,
      occurredAt: atLocalNoon(date),
      value: '',
      unit: '',
      details: 'Sample flock added for feature testing.',
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    });

    data.legacy ||= {};
    data.legacy.sampleFixtureVersion = FIXTURE_VERSION;
    return true;
  }

  function apply() {
    const local = window.RegulaRusticaLocal;
    if (!local?.read || !local?.write) return;
    const data = local.read();
    if (enhance(data)) local.write(data, 'sample-fixtures');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else queueMicrotask(apply);
}());
