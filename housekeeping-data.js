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
    return {
      mode: rule?.mode === 'after_completion' ? 'after_completion' : 'fixed_schedule',
      frequency,
      interval: Number.isFinite(candidateInterval) ? Math.max(1, candidateInterval) : 1
    };
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

  function matchesYieldTask(task = {}, yieldEntry = {}) {
    const yieldType = task.yieldType || null;
    return Boolean(
      !task.deletedAt && !task.completed && task.status !== 'completed'
      && yieldType && yieldEntry.type === yieldType
      && task.recordId && task.recordId === yieldEntry.recordId
      && taskWorkDate(task) === localDate(yieldEntry.occurredAt)
    );
  }

  function matchingYieldTasks(tasks = [], yieldEntry = {}) {
    return tasks.filter(task => matchesYieldTask(task, yieldEntry));
  }

  function matchingYieldForTask(entries = [], task = {}) {
    const yieldType = task.yieldType || null;
    if (!yieldType) return null;
    return entries.find(entry => !entry.deletedAt && entry.type === yieldType
      && entry.recordId === task.recordId
      && localDate(entry.occurredAt) === taskWorkDate(task)) || null;
  }

  function taskCalendarBounds(task = {}) {
    const start = task.availableFrom || task.dueDate || '';
    const end = task.dueDate || task.availableFrom || '';
    if (!start || !end) return null;
    return start <= end ? { start, end } : { start: end, end: start };
  }

  function taskCalendarSegment(task = {}, date = '') {
    const bounds = taskCalendarBounds(task);
    if (!bounds || date < bounds.start || date > bounds.end) return null;
    if (bounds.start === bounds.end) return 'single';
    if (date === bounds.start) return 'start';
    if (date === bounds.end) return 'end';
    return 'middle';
  }

  function taskCalendarBarSegment(task = {}, date = '', dayOfWeek = -1) {
    const bounds = taskCalendarBounds(task);
    if (!bounds || bounds.start === bounds.end || !taskCalendarSegment(task, date)) return null;
    const starts = date === bounds.start || dayOfWeek === 0;
    const ends = date === bounds.end || dayOfWeek === 6;
    return { starts, ends, showLabel: starts };
  }

  function reportingDateRange(period = '30', todayValue = localDate(new Date())) {
    const todayParts = dateParts(todayValue);
    if (!todayParts) return { period: 'all', start: null, end: null };
    if (period === 'all') return { period, start: null, end: todayValue };
    if (period === 'ytd') return { period, start: formatDateParts(todayParts.year, 1, 1), end: todayValue };
    const days = period === 'today' ? 1 : Math.max(1, Number(period) || 30);
    const start = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day - (days - 1)));
    return {
      period,
      start: formatDateParts(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()),
      end: todayValue
    };
  }

  function matchesReportingDate(dateValue, range = {}) {
    const date = String(dateValue || '').slice(0, 10);
    if (!date) return false;
    return (!range.start || date >= range.start) && (!range.end || date <= range.end);
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
    taskWorkDate, matchesYieldTask, matchingYieldTasks, matchingYieldForTask,
    taskCalendarBounds, taskCalendarSegment, taskCalendarBarSegment,
    reportingDateRange, matchesReportingDate
  };
}));
