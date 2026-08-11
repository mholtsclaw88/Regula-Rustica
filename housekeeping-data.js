'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RegulaRusticaHousekeeping = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  function historicalYieldCandidate(event = {}) {
    if (!event.recordId || event.value === '' || !Number.isFinite(Number(event.value)) || Number(event.value) <= 0) return null;
    const label = String(event.eventType || '').trim().toLowerCase();
    let type;
    let session;
    if (['morning milk', 'am milk', 'milk am'].includes(label)) { type = 'milk'; session = 'morning'; }
    else if (['evening milk', 'pm milk', 'milk pm'].includes(label)) { type = 'milk'; session = 'evening'; }
    else if (label === 'egg collection') { type = 'eggs'; session = 'other'; }
    else return null;
    return {
      id: `yield-${event.id}`,
      recordId: event.recordId,
      type,
      session,
      occurredAt: event.occurredAt || `${event.date}T12:00:00`,
      quantity: Number(event.value),
      unit: event.unit || (type === 'eggs' ? 'eggs' : 'gal'),
      details: event.details || '',
      legacyEventId: event.id,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt
    };
  }

  function normalizeRecurrenceRule(rule = null) {
    const frequency = ['daily', 'weekly', 'monthly'].includes(rule?.frequency) ? rule.frequency : '';
    if (!frequency) return null;
    const candidateInterval = Math.floor(Number(rule?.interval) || 1);
    const configuredRoutine = rule?.routineType || rule?.routine_type || rule?.completionAction || rule?.completion_action;
    const routineType = ['milk_morning', 'milk_evening', 'egg_collection'].includes(configuredRoutine)
      ? configuredRoutine
      : null;
    return {
      mode: rule?.mode === 'after_completion' ? 'after_completion' : 'fixed_schedule',
      frequency,
      interval: Number.isFinite(candidateInterval) ? Math.max(1, candidateInterval) : 1,
      ...(routineType ? { routineType } : {})
    };
  }

  function routineType(task = {}) {
    return normalizeRecurrenceRule(task.recurrenceRule)?.routineType || null;
  }

  function routineYieldType(task = {}) {
    return routineType(task) === 'egg_collection' ? 'eggs' : routineType(task) ? 'milk' : null;
  }

  function routineSession(task = {}) {
    const type = routineType(task);
    if (type === 'milk_morning') return 'morning';
    if (type === 'milk_evening') return 'evening';
    if (type === 'egg_collection') return 'other';
    return null;
  }

  function routineLabel(task = {}) {
    const type = routineType(task);
    if (type === 'milk_morning') return 'Morning Milking';
    if (type === 'milk_evening') return 'Evening Milking';
    if (type === 'egg_collection') return 'Egg Collection';
    return '';
  }

  function taskWorkDate(task = {}) {
    return task.dueDate || task.availableFrom || '';
  }

  function localDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || '').slice(0, 10);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function matchesRoutineTask(task = {}, yieldEntry = {}) {
    const session = routineSession(task);
    const yieldType = routineYieldType(task);
    return Boolean(
      !task.deletedAt && !task.completed && task.status !== 'completed'
      && session && yieldEntry.type === yieldType
      && task.recordId && task.recordId === yieldEntry.recordId
      && session === yieldEntry.session
      && taskWorkDate(task) === localDate(yieldEntry.occurredAt)
    );
  }

  function matchingRoutineTasks(tasks = [], yieldEntry = {}) {
    return tasks.filter(task => matchesRoutineTask(task, yieldEntry));
  }

  function matchingYieldForTask(entries = [], task = {}) {
    const session = routineSession(task);
    const yieldType = routineYieldType(task);
    if (!session) return null;
    return entries.find(entry => !entry.deletedAt && entry.type === yieldType
      && entry.recordId === task.recordId && entry.session === session
      && localDate(entry.occurredAt) === taskWorkDate(task)) || null;
  }

  function dateParts(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }

  function formatDateParts(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function nextRecurringDueDate(task = {}, completionDate) {
    const rule = normalizeRecurrenceRule(task.recurrenceRule);
    const base = dateParts(rule?.mode === 'after_completion' ? completionDate : (task.dueDate || completionDate));
    if (!rule || !base) return null;
    if (rule.frequency === 'monthly') {
      const monthIndex = base.month - 1 + rule.interval;
      const year = base.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return formatDateParts(year, month, Math.min(base.day, lastDay));
    }
    const days = rule.frequency === 'weekly' ? rule.interval * 7 : rule.interval;
    const date = new Date(Date.UTC(base.year, base.month - 1, base.day + days));
    return formatDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  function recurrenceSummary(rule) {
    const normalized = normalizeRecurrenceRule(rule);
    if (!normalized) return '';
    const unit = normalized.frequency.replace('daily', 'day').replace('weekly', 'week').replace('monthly', 'month');
    const cadence = normalized.interval === 1 ? unit : `${normalized.interval} ${unit}s`;
    return `Repeats every ${cadence}${normalized.mode === 'after_completion' ? ' after completion' : ''}`;
  }

  return {
    historicalYieldCandidate, normalizeRecurrenceRule, nextRecurringDueDate, recurrenceSummary,
    routineType, routineYieldType, routineSession, routineLabel, taskWorkDate,
    matchingRoutineTasks, matchingYieldForTask
  };
}));
