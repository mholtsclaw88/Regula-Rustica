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
    const normalized = {
      mode: rule?.mode === 'after_completion' ? 'after_completion' : 'fixed_schedule',
      frequency,
      interval: Number.isFinite(candidateInterval) ? Math.max(1, candidateInterval) : 1,
      enabled: rule?.enabled !== false
    };
    if (rule?.seriesId) normalized.seriesId = String(rule.seriesId);
    if (rule?.seriesDeleted === true) normalized.seriesDeleted = true;
    return normalized;
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

  function choreWindowEndPassed(choreWindow = {}, workDate = '', now = new Date()) {
    if (!workDate) return false;
    const currentDate = localDate(now);
    if (workDate < currentDate) return true;
    if (workDate > currentDate) return false;
    const boundary = choreWindow.endTime
      ? new Date(`${workDate}T${choreWindow.endTime}:00`)
      : new Date(`${workDate}T23:59:59.999`);
    return new Date(now).getTime() > boundary.getTime();
  }

  function taskIsOverdue(task = {}, choreWindow = null, now = new Date()) {
    if (task.completed || task.deletedAt || task.recurrenceRule?.enabled === false || task.recurrenceRule?.seriesDeleted === true) return false;
    const workDate = taskWorkDate(task);
    if (!workDate) return false;
    if (choreWindow) return choreWindowEndPassed(choreWindow, workDate, now);
    return Boolean(task.dueDate && task.dueDate < localDate(now));
  }

  function taskInCurrentChoreWindow(task = {}, choreWindow = {}, now = new Date()) {
    return taskWorkDate(task) === localDate(now) && (task.completed || !taskIsOverdue(task, choreWindow, now));
  }

  function dailyPlannerProjection({ tasks = [], choreWindows = [], calendarEvents = [], workDate = localDate(new Date()), now = new Date() } = {}) {
    const visibleTask = task => !task.deletedAt && task.recurrenceRule?.enabled !== false && task.recurrenceRule?.seriesDeleted !== true;
    const windows = choreWindows
      .filter(window => !window.deletedAt && window.enabled && window.startTime && window.endTime)
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
    const windowById = new Map(windows.map(window => [window.id, window]));
    const windowItems = windows.map(window => {
      const windowTasks = tasks.filter(task => visibleTask(task) && task.choreWindowId === window.id && taskWorkDate(task) === workDate);
      return {
        id: `window:${window.id}`,
        type: 'window',
        time: window.startTime,
        endTime: window.endTime,
        window,
        tasks: windowTasks,
        completed: windowTasks.filter(task => task.completed).length
      };
    });
    const events = calendarEvents.filter(event => !event.deletedAt && event.startDate <= workDate && event.endDate >= workDate);
    const allDayEvents = events.filter(event => event.allDay || !event.startTime);
    const eventItems = events.filter(event => !event.allDay && event.startTime).map(event => ({
      id: `event:${event.id}`,
      type: 'event',
      time: event.startTime,
      endTime: event.endTime || event.startTime,
      event
    }));
    const schedule = [...windowItems, ...eventItems]
      .sort((a, b) => a.time.localeCompare(b.time) || (a.type === b.type ? a.id.localeCompare(b.id) : a.type === 'window' ? -1 : 1));
    const timeNow = localDate(now) === workDate
      ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      : '00:00';
    const current = schedule.find(item => item.time <= timeNow && item.endTime >= timeNow) || null;
    const next = schedule.find(item => item.time >= timeNow && item.id !== current?.id) || null;

    const openTasks = tasks.filter(task => visibleTask(task) && !task.completed);
    const isActionable = task => {
      if (!task.availableFrom && !task.dueDate) return true;
      if (task.availableFrom && task.availableFrom <= workDate) return true;
      return Boolean(!task.availableFrom && task.dueDate && task.dueDate <= workDate);
    };
    const overdue = openTasks.filter(task => taskIsOverdue(task, windowById.get(task.choreWindowId) || null, now));
    const otherWork = openTasks
      .filter(task => !task.choreWindowId && isActionable(task) && !overdue.includes(task))
      .sort((a, b) => {
        const priority = { urgent: 0, high: 1, normal: 2, low: 3 };
        return (priority[a.priority] ?? 2) - (priority[b.priority] ?? 2)
          || String(a.dueDate || '9999-12-31').localeCompare(String(b.dueDate || '9999-12-31'))
          || String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id));
      });
    const overdueGroups = new Map();
    overdue.forEach(task => {
      const series = task.recurrenceRule?.seriesId || (task.recurrenceRule ? `${task.recordId || ''}:${task.suggestionKey || task.title}:${task.choreWindowId || ''}` : null);
      const key = series ? `series:${series}` : `task:${task.id}`;
      const existing = overdueGroups.get(key);
      if (!existing) overdueGroups.set(key, { task, count: 1 });
      else {
        existing.count += 1;
        if (taskWorkDate(task) > taskWorkDate(existing.task)) existing.task = task;
      }
    });
    const needsAttention = [...overdueGroups.values()].sort((a, b) => taskWorkDate(b.task).localeCompare(taskWorkDate(a.task)));

    return {
      schedule,
      allDayEvents,
      otherWork,
      needsAttention,
      overdueOccurrenceCount: overdue.length,
      currentId: current?.id || null,
      nextId: next?.id || null,
      windowItems,
      eventCount: events.length
    };
  }

  function yieldDefaultsForTask(task = {}, choreWindows = []) {
    const choreWindow = choreWindows.find(item => !item.deletedAt && item.id === task.choreWindowId) || null;
    return {
      date: taskWorkDate(task),
      session: ['morning', 'evening', 'other'].includes(choreWindow?.daypart) ? choreWindow.daypart : null,
      time: choreWindow?.startTime || null
    };
  }

  function linkedYieldsForTask(entries = [], taskId) {
    if (!taskId) return [];
    return entries.filter(entry => !entry.deletedAt && entry.taskId === taskId);
  }

  function reopenTask(task, yieldEntries = [], { deleteLinkedYield = false, timestamp = new Date().toISOString() } = {}) {
    if (!task) return [];
    const linkedYields = linkedYieldsForTask(yieldEntries, task.id);
    task.completed = false;
    task.status = 'open';
    task.completedAt = null;
    task.updatedAt = timestamp;
    if (deleteLinkedYield) linkedYields.forEach(entry => {
      entry.deletedAt = timestamp;
      entry.updatedAt = timestamp;
    });
    return linkedYields;
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
    taskWorkDate, choreWindowEndPassed, taskIsOverdue, taskInCurrentChoreWindow, dailyPlannerProjection, yieldDefaultsForTask,
    matchesYieldTask, matchingYieldTasks, matchingYieldForTask,
    linkedYieldsForTask, reopenTask,
    taskCalendarBounds, taskCalendarSegment, taskCalendarBarSegment,
    reportingDateRange, matchesReportingDate
  };
}));
