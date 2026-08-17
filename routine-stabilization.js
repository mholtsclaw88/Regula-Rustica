'use strict';

(function expose(root, factory) {
  const routinesApi = typeof module === 'object' && module.exports
    ? require('./routines-data.js')
    : root.RegulaRusticaRoutines;
  const api = factory(routinesApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RegulaRusticaRoutineStabilization = api;
}(typeof globalThis === 'object' ? globalThis : this, routinesApi => {
  const datePart = value => String(value || '').slice(0, 10);
  const active = value => Boolean(value && !value.deletedAt);
  const stamp = value => String(value || '');
  const historicalCompletion = (occurrence, fallback) => occurrence?.occurrenceDate
    ? `${occurrence.occurrenceDate}T23:59:59.000Z`
    : fallback;

  function canonicalChoice(items = [], occurrenceCounts = new Map()) {
    return [...items].sort((a, b) => {
      const enabled = Number(b.enabled !== false) - Number(a.enabled !== false);
      if (enabled) return enabled;
      const occurrenceWeight = (occurrenceCounts.get(b.id) || 0) - (occurrenceCounts.get(a.id) || 0);
      if (occurrenceWeight) return occurrenceWeight;
      const created = stamp(a.createdAt).localeCompare(stamp(b.createdAt));
      if (created) return created;
      return String(a.id).localeCompare(String(b.id));
    })[0] || null;
  }

  function nextScheduledOnOrAfter(routine, targetDate) {
    const target = datePart(targetDate);
    let cursor = datePart(routine.firstDate || routine.nextDate);
    if (!cursor || !target) return null;
    if (cursor >= target) return cursor;
    for (let guard = 0; guard < 5000 && cursor < target; guard += 1) {
      const next = routinesApi.addDate(cursor, routine.frequency, routine.interval);
      if (!next || next === cursor) return null;
      cursor = next;
    }
    return cursor >= target ? cursor : null;
  }

  function dedupeSystemWindows(data, timestamp) {
    let changed = false;
    let duplicateCount = 0;
    const windows = data.choreWindows || [];
    const routineCounts = new Map();
    (data.routines || []).filter(active).forEach(routine => {
      if (routine.choreWindowId) routineCounts.set(routine.choreWindowId, (routineCounts.get(routine.choreWindowId) || 0) + 1);
    });
    const groups = new Map();
    windows.filter(window => active(window) && window.systemKey).forEach(window => {
      if (!groups.has(window.systemKey)) groups.set(window.systemKey, []);
      groups.get(window.systemKey).push(window);
    });
    groups.forEach(group => {
      if (group.length < 2) return;
      const winner = canonicalChoice(group, routineCounts);
      group.filter(window => window !== winner).forEach(duplicate => {
        (data.routines || []).filter(routine => active(routine) && routine.choreWindowId === duplicate.id).forEach(routine => {
          routine.choreWindowId = winner.id;
          routine.updatedAt = timestamp;
        });
        duplicate.enabled = false;
        duplicate.deletedAt = timestamp;
        duplicate.updatedAt = timestamp;
        changed = true;
        duplicateCount += 1;
      });
    });
    return { changed, duplicateCount };
  }

  function dedupeStructuredRoutines(data, timestamp) {
    let changed = false;
    let duplicateCount = 0;
    const occurrences = data.routineOccurrences || [];
    const occurrenceCounts = new Map();
    occurrences.filter(active).forEach(occurrence => {
      occurrenceCounts.set(occurrence.routineId, (occurrenceCounts.get(occurrence.routineId) || 0) + 1);
    });
    const groups = new Map();
    (data.routines || []).filter(routine => active(routine) && routine.routineType).forEach(routine => {
      const key = `${routine.recordId || ''}:${routine.routineType}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(routine);
    });
    groups.forEach(group => {
      if (group.length < 2) return;
      const winner = canonicalChoice(group, occurrenceCounts);
      group.filter(routine => routine !== winner).forEach(duplicate => {
        duplicate.enabled = false;
        duplicate.deletedAt = timestamp;
        duplicate.updatedAt = timestamp;
        occurrences.filter(occurrence => active(occurrence) && occurrence.routineId === duplicate.id && occurrence.status === 'pending').forEach(occurrence => {
          occurrence.status = 'skipped';
          occurrence.completionMethod = 'rollover';
          occurrence.completedAt = historicalCompletion(occurrence, timestamp);
          occurrence.updatedAt = timestamp;
        });
        changed = true;
        duplicateCount += 1;
      });
    });
    return { changed, duplicateCount };
  }

  function stabilizeRoutineDates(data, targetDate, timestamp, makeId) {
    let changed = false;
    let rolloverCount = 0;
    let createdCount = 0;
    const occurrences = data.routineOccurrences || (data.routineOccurrences = []);
    const activeRoutines = (data.routines || []).filter(routine => active(routine) && routine.enabled);

    activeRoutines.forEach(routine => {
      occurrences.filter(occurrence => active(occurrence) && occurrence.routineId === routine.id
        && occurrence.status === 'pending' && occurrence.occurrenceDate < targetDate).forEach(occurrence => {
        occurrence.status = 'skipped';
        occurrence.completionMethod = 'rollover';
        occurrence.completedAt = historicalCompletion(occurrence, timestamp);
        occurrence.updatedAt = timestamp;
        rolloverCount += 1;
        changed = true;
      });

      const scheduled = nextScheduledOnOrAfter(routine, targetDate);
      const todayOccurrence = occurrences.find(occurrence => active(occurrence)
        && occurrence.routineId === routine.id && occurrence.occurrenceDate === targetDate);

      if (scheduled === targetDate && !todayOccurrence) {
        occurrences.push(routinesApi.normalizeOccurrence({
          id: makeId(), routineId: routine.id, occurrenceDate: targetDate,
          createdAt: timestamp, updatedAt: timestamp
        }));
        createdCount += 1;
        changed = true;
      }

      const refreshedToday = occurrences.find(occurrence => active(occurrence)
        && occurrence.routineId === routine.id && occurrence.occurrenceDate === targetDate);
      let desiredNext = scheduled;
      if (scheduled === targetDate && refreshedToday && refreshedToday.status !== 'pending') {
        desiredNext = routinesApi.addDate(targetDate, routine.frequency, routine.interval);
      }
      if (desiredNext && routine.nextDate !== desiredNext) {
        routine.nextDate = desiredNext;
        routine.updatedAt = timestamp;
        changed = true;
      }
    });

    return { changed, rolloverCount, createdCount };
  }

  function stabilizeData(source = {}, options = {}) {
    const data = source;
    data.choreWindows ||= [];
    data.routines ||= [];
    data.routineOccurrences ||= [];
    const timestamp = options.now || new Date().toISOString();
    const targetDate = datePart(options.date || timestamp);
    const makeId = options.makeId || (() => crypto.randomUUID());

    const windows = dedupeSystemWindows(data, timestamp);
    const routines = dedupeStructuredRoutines(data, timestamp);
    const dates = stabilizeRoutineDates(data, targetDate, timestamp, makeId);
    return {
      data,
      changed: windows.changed || routines.changed || dates.changed,
      duplicateWindows: windows.duplicateCount,
      duplicateRoutines: routines.duplicateCount,
      rolloverCount: dates.rolloverCount,
      createdOccurrences: dates.createdCount
    };
  }

  return { stabilizeData, nextScheduledOnOrAfter, canonicalChoice };
}));

if (typeof document !== 'undefined') {
  (function installBrowserStabilization() {
    let running = false;
    let lastRolloverCount = 0;

    function localDate() {
      const now = new Date();
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 10);
    }

    function addUiStyles() {
      if (document.querySelector('#routine-stabilization-styles')) return;
      const style = document.createElement('style');
      style.id = 'routine-stabilization-styles';
      style.textContent = `
        #today > .grid2 { display:flex; flex-direction:column; gap:1rem; }
        #today > .grid2 > .card { width:100%; }
        .routine-rollover-note { margin:.25rem 0 .85rem; font-size:.88rem; color:var(--muted, #6b6256); }
      `;
      document.head.appendChild(style);
    }

    function arrangeToday() {
      const grid = document.querySelector('#today > .grid2');
      if (!grid) return;
      const tasks = document.querySelector('#todayTasks')?.closest('.card');
      const events = document.querySelector('#todayEvents')?.closest('.card');
      const glance = document.querySelector('#openCount')?.closest('.card');
      if (tasks) grid.appendChild(tasks);
      if (events) grid.appendChild(events);
      if (glance) grid.appendChild(glance);
    }

    function showRolloverNote(count) {
      document.querySelector('#routineRolloverNote')?.remove();
      if (!count) return;
      const root = document.querySelector('#todayChoreWindows');
      if (!root) return;
      const note = document.createElement('p');
      note.id = 'routineRolloverNote';
      note.className = 'routine-rollover-note';
      note.textContent = `${count} unfinished routine${count === 1 ? '' : 's'} from a previous day ${count === 1 ? 'was' : 'were'} marked missed so Today stays current.`;
      root.insertAdjacentElement('afterend', note);
    }

    function run() {
      if (running || !window.RegulaRusticaLocal?.read || !window.RegulaRusticaRoutineStabilization) return;
      running = true;
      try {
        const data = window.RegulaRusticaLocal.read();
        const result = window.RegulaRusticaRoutineStabilization.stabilizeData(data, {
          now: new Date().toISOString(), date: localDate(), makeId: () => crypto.randomUUID()
        });
        lastRolloverCount = result.rolloverCount;
        if (result.changed) window.RegulaRusticaLocal.write(data, 'routine-stabilization');
        arrangeToday();
        showRolloverNote(lastRolloverCount);
      } finally {
        running = false;
      }
    }

    function init() {
      addUiStyles();
      arrangeToday();
      run();
      window.addEventListener('regula-rustica:data-saved', event => {
        if (event.detail?.source === 'routine-stabilization') {
          arrangeToday();
          showRolloverNote(lastRolloverCount);
          return;
        }
        queueMicrotask(run);
      });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }());
}
