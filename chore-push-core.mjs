import housekeeping from './housekeeping-data.js';

export function openWindowChoreCount(tasks, windowId, workDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate || '')) return 0;
  const now = new Date(`${workDate}T12:00:00Z`);
  const source = Array.isArray(tasks) ? tasks : [];
  const activeSeries = new Set(source.filter(task => !task.deletedAt)
    .map(task => task.recurrenceRule?.seriesId).filter(Boolean));
  const normalized = source.filter(task => !task.deletedAt || activeSeries.has(task.recurrenceRule?.seriesId))
    .map(task => ({
    ...task,
    completed: task.completed === true || task.status === 'completed'
    }));
  const projection = housekeeping.dailyPlannerProjection({
    tasks: normalized,
    choreWindows: [{ id: windowId, name: 'Chore Window', enabled: true,
      startTime: '00:00', endTime: '23:59' }],
    workDate,
    now,
    calendarRange: true,
    includeCompleted: true
  });
  return projection.windowItems.find(item => item.window.id === windowId)?.tasks
    .filter(task => !task.completed && task.status !== 'cancelled').length || 0;
}

export function reminderText(windowName, count) {
  const name = String(windowName || 'Chore').trim().slice(0, 80);
  return {
    title: `${name} chores to review`,
    body: `${count} ${count === 1 ? 'task remains' : 'tasks remain'}. Open your Farm Book when you are ready.`
  };
}
