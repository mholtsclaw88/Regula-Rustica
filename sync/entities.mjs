export const DOMAIN_ORDER = ['records', 'homestead_people', 'chore_windows', 'routines', 'tasks', 'routine_occurrences', 'record_relationships', 'task_assignments', 'chronicle_entries', 'calendar_events', 'yield_entries', 'notes', 'ledger_entries'];

export const COLLECTIONS = {
  records: 'records',
  homestead_people: 'people',
  chore_windows: 'choreWindows',
  routines: 'routines',
  tasks: 'tasks',
  routine_occurrences: 'routineOccurrences',
  record_relationships: 'relationships',
  task_assignments: 'assignments',
  chronicle_entries: 'events',
  calendar_events: 'calendarEvents',
  yield_entries: 'yieldEntries',
  notes: 'notes',
  ledger_entries: 'ledger'
};

const iso = value => value || new Date().toISOString();
const cloudId = (state, table, localId) => localId ? state.entity(table, localId).cloudId : null;
const localId = (state, table, value) => value ? state.localIdForCloud(table, value) : null;

export function toCloud(table, row, state, source = 'manual') {
  const common = { id: cloudId(state, table, row.id), client_updated_at: iso(row.updatedAt || row.createdAt), source };
  if (table === 'records') return { ...common, type: row.type.toLowerCase(), name: row.name, status: row.status, identity: row.identity || {}, stewardship: row.stewardship || {} };
  if (table === 'homestead_people') return { ...common, person_type: row.personType || 'child', display_name: row.displayName, member_id: row.memberId || null };
  if (table === 'chore_windows') return { ...common, system_key: row.systemKey || null, name: row.name, display_order: Number(row.displayOrder || 0), enabled: row.enabled !== false, daypart: row.daypart || null };
  if (table === 'routines') return { ...common, record_id: cloudId(state, 'records', row.recordId), name: row.name, routine_type: row.routineType || null, enabled: row.enabled !== false, frequency: row.frequency, interval: Number(row.interval || 1), first_date: row.firstDate, next_date: row.nextDate, chore_window_id: cloudId(state, 'chore_windows', row.choreWindowId), person_id: cloudId(state, 'homestead_people', row.personId) };
  if (table === 'tasks') {
    const recurrenceRule = row.recurrenceRule ? { ...row.recurrenceRule } : null;
    if (recurrenceRule && row.routineMigrationId) recurrenceRule.migratedToRoutineId = cloudId(state, 'routines', row.routineMigrationId);
    return { ...common, record_id: cloudId(state, 'records', row.recordId), title: row.title, description: row.description || null, status: row.completed ? 'completed' : (row.status || 'open'), priority: row.priority || 'normal', due_date: row.dueDate || null, available_from: row.availableFrom || null, completed_at: row.completedAt || null, recurrence_rule: recurrenceRule, parent_task_id: cloudId(state, 'tasks', row.parentTaskId) };
  }
  if (table === 'routine_occurrences') return { ...common, routine_id: cloudId(state, 'routines', row.routineId), occurrence_date: row.occurrenceDate, status: row.status, completion_method: row.completionMethod || null, completed_at: row.completedAt || null, legacy_task_id: cloudId(state, 'tasks', row.legacyTaskId) };
  if (table === 'record_relationships') return { ...common, source_record_id: cloudId(state, 'records', row.sourceRecordId), target_record_id: cloudId(state, 'records', row.targetRecordId), relationship_type: row.relationshipType, started_at: row.startedAt || null, ended_at: row.endedAt || null, details: row.details || {} };
  if (table === 'task_assignments') return { ...common, task_id: cloudId(state, 'tasks', row.taskId), person_id: cloudId(state, 'homestead_people', row.personId), member_id: row.memberId || null, assignment_type: row.assignmentType || 'assignee', removed_at: row.removedAt || null };
  if (table === 'chronicle_entries') return { ...common, record_id: cloudId(state, 'records', row.recordId), task_id: cloudId(state, 'tasks', row.taskId), event_type: row.eventType || 'Other', occurred_at: row.occurredAt || `${row.date}T12:00:00.000Z`, summary: row.summary || null, details: { text: row.details || '', ...(row.extraDetails || {}) }, value: row.value === '' ? null : row.value, unit: row.unit || null, corrects_entry_id: cloudId(state, 'chronicle_entries', row.correctsEntryId) };
  if (table === 'calendar_events') return { ...common, record_id: cloudId(state, 'records', row.recordId), title: row.title, start_date: row.startDate, end_date: row.endDate || row.startDate, all_day: Boolean(row.allDay), start_time: row.allDay ? null : (row.startTime || null), end_time: row.allDay ? null : (row.endTime || null), location: row.location || null, notes: row.notes || null };
  if (table === 'yield_entries') {
    const taskId = cloudId(state, 'tasks', row.taskId);
    const occurrenceId = cloudId(state, 'routine_occurrences', row.routineOccurrenceId);
    return { ...common, record_id: cloudId(state, 'records', row.recordId), task_id: taskId, routine_occurrence_id: occurrenceId, yield_type: row.type, occurred_at: new Date(row.occurredAt).toISOString(), session: row.session || 'other', quantity: Number(row.quantity), unit: row.unit, unusable_quantity: Number(row.unusableQuantity || 0), details: { text: row.details || '', legacy_event_id: cloudId(state, 'chronicle_entries', row.legacyEventId), task_id: taskId, routine_occurrence_id: occurrenceId } };
  }
  if (table === 'notes') return { ...common, record_id: cloudId(state, 'records', row.recordId), title: row.title || null, body: row.text || row.body || '', pinned: Boolean(row.pinned) };
  if (table === 'ledger_entries') return { ...common, record_id: cloudId(state, 'records', row.recordId), entry_type: row.type, entry_date: row.date, description: row.description, amount: Number(row.amount), currency_code: row.currencyCode || 'USD', category: row.category || null, vendor_or_source: row.vendorOrSource || null };
  throw new Error(`Unsupported sync table: ${table}`);
}

export function fromCloud(table, row, state) {
  const common = { id: localId(state, table, row.id), createdAt: row.created_at || row.assigned_at, updatedAt: row.updated_at || row.assigned_at, deletedAt: row.deleted_at || row.removed_at || null };
  if (table === 'records') return { ...common, type: row.type[0].toUpperCase() + row.type.slice(1), name: row.name, status: row.status, identity: row.identity || {}, stewardship: row.stewardship || {} };
  if (table === 'homestead_people') return { ...common, personType: row.person_type, displayName: row.display_name, memberId: row.member_id || null };
  if (table === 'chore_windows') return { ...common, systemKey: row.system_key, name: row.name, displayOrder: row.display_order, enabled: row.enabled, daypart: row.daypart };
  if (table === 'routines') return { ...common, recordId: localId(state, 'records', row.record_id), name: row.name, routineType: row.routine_type, enabled: row.enabled, frequency: row.frequency, interval: row.interval, firstDate: row.first_date, nextDate: row.next_date, choreWindowId: localId(state, 'chore_windows', row.chore_window_id), personId: localId(state, 'homestead_people', row.person_id) };
  if (table === 'tasks') {
    const routineMigrationId = row.recurrence_rule?.migratedToRoutineId ? localId(state, 'routines', row.recurrence_rule.migratedToRoutineId) : null;
    return { ...common, recordId: localId(state, 'records', row.record_id), title: row.title, description: row.description || '', status: row.status, completed: row.status === 'completed', dueDate: row.due_date || '', availableFrom: row.available_from || '', completedAt: row.completed_at, priority: row.priority, recurrenceRule: row.recurrence_rule, routineMigrationId, parentTaskId: localId(state, 'tasks', row.parent_task_id) };
  }
  if (table === 'routine_occurrences') return { ...common, routineId: localId(state, 'routines', row.routine_id), occurrenceDate: row.occurrence_date, status: row.status, completionMethod: row.completion_method, completedAt: row.completed_at, legacyTaskId: localId(state, 'tasks', row.legacy_task_id) };
  if (table === 'record_relationships') return { ...common, sourceRecordId: localId(state, 'records', row.source_record_id), targetRecordId: localId(state, 'records', row.target_record_id), relationshipType: row.relationship_type, startedAt: row.started_at, endedAt: row.ended_at, details: row.details || {} };
  if (table === 'task_assignments') return { ...common, taskId: localId(state, 'tasks', row.task_id), personId: localId(state, 'homestead_people', row.person_id), memberId: row.member_id, assignmentType: row.assignment_type, assignedAt: row.assigned_at, removedAt: row.removed_at };
  if (table === 'chronicle_entries') return { ...common, recordId: localId(state, 'records', row.record_id), taskId: localId(state, 'tasks', row.task_id), eventType: row.event_type, date: row.occurred_at.slice(0, 10), occurredAt: row.occurred_at, summary: row.summary, details: row.details?.text || '', extraDetails: row.details || {}, value: row.value ?? '', unit: row.unit || '', correctsEntryId: localId(state, 'chronicle_entries', row.corrects_entry_id) };
  if (table === 'calendar_events') return { ...common, recordId: localId(state, 'records', row.record_id), title: row.title, startDate: row.start_date, endDate: row.end_date, allDay: row.all_day, startTime: row.start_time || '', endTime: row.end_time || '', location: row.location || '', notes: row.notes || '' };
  if (table === 'yield_entries') return { ...common, recordId: localId(state, 'records', row.record_id), taskId: localId(state, 'tasks', row.task_id), routineOccurrenceId: localId(state, 'routine_occurrences', row.routine_occurrence_id || row.details?.routine_occurrence_id), type: row.yield_type, occurredAt: row.occurred_at, session: row.session, quantity: Number(row.quantity), unit: row.unit, unusableQuantity: Number(row.unusable_quantity || 0), details: row.details?.text || '', legacyEventId: localId(state, 'chronicle_entries', row.details?.legacy_event_id) };
  if (table === 'notes') return { ...common, recordId: localId(state, 'records', row.record_id), title: row.title || '', text: row.body, pinned: row.pinned };
  if (table === 'ledger_entries') return { ...common, recordId: localId(state, 'records', row.record_id), type: row.entry_type, date: row.entry_date, description: row.description, amount: Number(row.amount), currencyCode: row.currency_code, category: row.category, vendorOrSource: row.vendor_or_source };
  throw new Error(`Unsupported sync table: ${table}`);
}

export function meaningfulCounts(data) {
  return Object.fromEntries(DOMAIN_ORDER.map(table => [table, (data[COLLECTIONS[table]] || []).filter(row =>
    !row.deletedAt && !row.removedAt && (table !== 'homestead_people' || row.personType === 'child')
  ).length]));
}

export const hasMeaningfulData = data => Object.values(meaningfulCounts(data)).some(Boolean);

export function operationOrder(operation) {
  const domain = DOMAIN_ORDER.indexOf(operation.table);
  const type = operation.type === 'create' || operation.type === 'restore' ? 0 : operation.type === 'update' ? 1 : 2;
  return (type === 2 ? DOMAIN_ORDER.length - domain : domain) * 10 + type;
}
