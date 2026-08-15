'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RegulaRusticaRoutines = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const TYPES = {
    milk_morning: { name: 'Morning Milking', windowKey: 'morning', yieldType: 'milk', session: 'morning' },
    milk_evening: { name: 'Evening Milking', windowKey: 'evening', yieldType: 'milk', session: 'evening' },
    egg_collection: { name: 'Egg Collection', windowKey: 'morning', yieldType: 'eggs', session: 'other' }
  };
  const DEFAULT_WINDOWS = [
    { id: 'chore-window-morning', systemKey: 'morning', name: 'Morning', displayOrder: 10, enabled: true, daypart: 'morning' },
    { id: 'chore-window-evening', systemKey: 'evening', name: 'Evening', displayOrder: 20, enabled: true, daypart: 'evening' }
  ];

  const iso = value => value || new Date().toISOString();
  const datePart = value => String(value || '').slice(0, 10);
  const addDate = (date, frequency, interval = 1) => {
    const value = new Date(`${date}T12:00:00`);
    if (frequency === 'daily') value.setDate(value.getDate() + interval);
    else if (frequency === 'weekly') value.setDate(value.getDate() + 7 * interval);
    else if (frequency === 'monthly') value.setMonth(value.getMonth() + interval);
    else return null;
    return value.toISOString().slice(0, 10);
  };

  function normalizeWindow(value = {}) {
    const createdAt = iso(value.createdAt || value.created_at);
    return {
      id: value.id || crypto.randomUUID(),
      systemKey: value.systemKey || value.system_key || null,
      name: value.name || 'Chore Window',
      displayOrder: Number(value.displayOrder ?? value.display_order ?? 100),
      enabled: value.enabled !== false,
      daypart: value.daypart || null,
      createdAt,
      updatedAt: iso(value.updatedAt || value.updated_at || createdAt),
      deletedAt: value.deletedAt || value.deleted_at || null
    };
  }

  function normalizeRoutine(value = {}) {
    const createdAt = iso(value.createdAt || value.created_at);
    const frequency = ['daily', 'weekly', 'monthly'].includes(value.frequency) ? value.frequency : 'daily';
    return {
      id: value.id || crypto.randomUUID(),
      recordId: value.recordId || value.record_id || null,
      name: value.name || TYPES[value.routineType || value.routine_type]?.name || 'Routine',
      routineType: value.routineType || value.routine_type || null,
      enabled: value.enabled !== false,
      frequency,
      interval: Math.max(1, Number(value.interval || 1)),
      firstDate: datePart(value.firstDate || value.first_date),
      nextDate: datePart(value.nextDate || value.next_date || value.firstDate || value.first_date),
      choreWindowId: value.choreWindowId || value.chore_window_id || null,
      personId: value.personId || value.person_id || null,
      createdAt,
      updatedAt: iso(value.updatedAt || value.updated_at || createdAt),
      deletedAt: value.deletedAt || value.deleted_at || null
    };
  }

  function normalizeOccurrence(value = {}) {
    const createdAt = iso(value.createdAt || value.created_at);
    return {
      id: value.id || crypto.randomUUID(),
      routineId: value.routineId || value.routine_id || null,
      occurrenceDate: datePart(value.occurrenceDate || value.occurrence_date),
      status: ['pending', 'completed', 'skipped'].includes(value.status) ? value.status : 'pending',
      completionMethod: value.completionMethod || value.completion_method || null,
      completedAt: value.completedAt || value.completed_at || null,
      legacyTaskId: value.legacyTaskId || value.legacy_task_id || null,
      createdAt,
      updatedAt: iso(value.updatedAt || value.updated_at || createdAt),
      deletedAt: value.deletedAt || value.deleted_at || null
    };
  }

  const active = value => Boolean(value && !value.deletedAt);
  const definition = type => TYPES[type] || null;
  const isYieldBacked = routine => Boolean(TYPES[routine?.routineType]?.yieldType);
  const routineWindow = (routine, windows) => windows.find(window => active(window) && window.id === routine.choreWindowId) || null;
  const matchingYield = (routine, occurrence, entries = []) => {
    const known = definition(routine?.routineType);
    if (!known) return null;
    return entries.find(entry => !entry.deletedAt && entry.recordId === routine.recordId
      && entry.type === known.yieldType && entry.session === known.session
      && datePart(entry.occurredAt) === occurrence.occurrenceDate) || null;
  };

  function completeOccurrence(routine, occurrence, method, now, makeId, occurrences) {
    if (!routine || !occurrence || occurrence.status !== 'pending') return null;
    const timestamp = iso(now);
    occurrence.status = method === 'skipped' ? 'skipped' : 'completed';
    occurrence.completionMethod = method;
    occurrence.completedAt = timestamp;
    occurrence.updatedAt = timestamp;
    if (!routine.enabled) return null;
    const nextDate = addDate(occurrence.occurrenceDate, routine.frequency, routine.interval);
    if (!nextDate) return null;
    routine.nextDate = nextDate;
    routine.updatedAt = timestamp;
    const exists = occurrences.some(item => active(item) && item.routineId === routine.id && item.occurrenceDate === nextDate);
    if (exists) return null;
    const next = normalizeOccurrence({ id: makeId?.(), routineId: routine.id, occurrenceDate: nextDate, createdAt: timestamp, updatedAt: timestamp });
    occurrences.push(next);
    return next;
  }

  function suggestedTypes(record = {}) {
    if (record.type !== 'Animal' || record.status === 'Archived') return [];
    const purpose = String(record.identity?.purpose || '').toLowerCase();
    if (purpose === 'dairy') return ['milk_morning', 'milk_evening'];
    if (purpose === 'eggs') return ['egg_collection'];
    return [];
  }

  function migrateTaskBacked(source = {}, options = {}) {
    const timestamp = iso(options.now);
    const makeId = options.makeId || (() => crypto.randomUUID());
    const people = source.people || [];
    const assignments = source.assignments || [];
    const windows = (source.choreWindows || []).map(normalizeWindow);
    DEFAULT_WINDOWS.forEach(defaultWindow => {
      if (!windows.some(window => active(window) && window.systemKey === defaultWindow.systemKey)) {
        windows.push(normalizeWindow({ ...defaultWindow, createdAt: timestamp, updatedAt: timestamp }));
      }
    });
    const routines = (source.routines || []).map(normalizeRoutine);
    const occurrences = (source.routineOccurrences || []).map(normalizeOccurrence);
    const tasks = source.tasks || [];
    const ensurePendingOccurrence = routine => {
      if (!active(routine) || !routine.enabled || occurrences.some(item => active(item) && item.routineId === routine.id && item.status === 'pending')) return;
      const latest = occurrences.filter(item => active(item) && item.routineId === routine.id)
        .sort((a, b) => b.occurrenceDate.localeCompare(a.occurrenceDate))[0];
      const occurrenceDate = latest
        ? addDate(latest.occurrenceDate, routine.frequency, routine.interval)
        : routine.nextDate || routine.firstDate;
      if (!occurrenceDate || occurrences.some(item => active(item) && item.routineId === routine.id && item.occurrenceDate === occurrenceDate)) return;
      routine.nextDate = occurrenceDate;
      occurrences.push(normalizeOccurrence({ id: makeId(), routineId: routine.id, occurrenceDate, createdAt: timestamp, updatedAt: timestamp }));
    };
    if (Number(source.schemaVersion || source.version || 0) >= 9) {
      routines.forEach(ensurePendingOccurrence);
      return { windows, routines, occurrences, tasks };
    }

    const structured = tasks.filter(task => TYPES[task.recurrenceRule?.routineType]);
    const groups = new Map();
    structured.forEach(task => {
      const key = `${task.recordId || ''}:${task.recurrenceRule.routineType}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    });
    groups.forEach(group => {
      group.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const open = group.find(task => !task.deletedAt && !task.completed && task.status !== 'completed') || group[group.length - 1];
      const type = open.recurrenceRule.routineType;
      const known = TYPES[type];
      const window = windows.find(item => item.systemKey === known.windowKey);
      const existing = routines.find(routine => routine.recordId === open.recordId && routine.routineType === type && !routine.deletedAt);
      const assignment = assignments.find(item => item.taskId === open.id && !item.removedAt);
      const routine = existing || normalizeRoutine({
        id: group[0].id,
        recordId: open.recordId,
        name: known.name,
        routineType: type,
        enabled: true,
        frequency: open.recurrenceRule.frequency,
        interval: open.recurrenceRule.interval,
        firstDate: datePart(group[0].dueDate || group[0].availableFrom),
        nextDate: datePart(open.dueDate || open.availableFrom),
        choreWindowId: window?.id || null,
        personId: people.some(person => person.id === assignment?.personId) ? assignment.personId : null,
        createdAt: group[0].createdAt,
        updatedAt: timestamp
      });
      if (!existing) routines.push(routine);
      group.forEach(task => {
        const date = datePart(task.dueDate || task.availableFrom);
        task.routineMigrationId = routine.id;
        if (!date || occurrences.some(item => item.routineId === routine.id && item.occurrenceDate === date)) return;
        occurrences.push(normalizeOccurrence({
          id: task.id,
          routineId: routine.id,
          occurrenceDate: date,
          status: task.completed || task.status === 'completed' ? 'completed' : 'pending',
          completionMethod: task.completed || task.status === 'completed' ? 'migration' : null,
          completedAt: task.completedAt,
          legacyTaskId: task.id,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt || timestamp
        }));
      });
    });
    (source.yieldEntries || []).forEach(entry => {
      if (!entry.routineOccurrenceId && entry.taskId) {
        const occurrence = occurrences.find(item => item.legacyTaskId === entry.taskId);
        if (occurrence) entry.routineOccurrenceId = occurrence.id;
      }
    });
    routines.forEach(ensurePendingOccurrence);
    return { windows, routines, occurrences, tasks };
  }

  return {
    TYPES, DEFAULT_WINDOWS, normalizeWindow, normalizeRoutine, normalizeOccurrence, active, definition,
    isYieldBacked, routineWindow, matchingYield, completeOccurrence, suggestedTypes, migrateTaskBacked, addDate
  };
}));

if (typeof document !== 'undefined' && !document.querySelector('script[data-ui-refinements]')) {
  const script = document.createElement('script');
  script.src = 'ui-refinements.js?v=record-nav-v1';
  script.dataset.uiRefinements = 'true';
  document.head.appendChild(script);
}
