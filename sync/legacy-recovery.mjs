export const LEGACY_RECOVERY_VERSION = 1;

export const LEGACY_DOMAIN_ORDER = Object.freeze([
  'homestead_people', 'records', 'chore_windows', 'routines', 'tasks', 'routine_occurrences',
  'record_relationships', 'task_assignments', 'chronicle_entries', 'calendar_events',
  'yield_entries', 'notes', 'ledger_entries', 'ledger_allocations'
]);

const LEGACY_DOMAINS = new Set(['routines', 'routine_occurrences']);
const OPERATION_TYPES = new Set(['create', 'update', 'soft_delete', 'restore']);

export function markLegacyOperation(operation) {
  if (!operation || operation.legacyRecovery) return operation;
  const historicalFailure = Number(operation.attempts) > 0
    || Boolean(operation.lastError || operation.lastErrorCode || operation.lastAttemptAt);
  if (!historicalFailure && !LEGACY_DOMAINS.has(operation.table)) return operation;
  return {
    ...operation,
    legacyRecovery: {
      version: LEGACY_RECOVERY_VERSION,
      originalTable: operation.table || null,
      originalRowId: operation.rowId || null,
      originalStatus: operation.status || null,
      originalErrorCode: operation.lastErrorCode || null
    }
  };
}

export const isLegacyOperation = operation => operation?.legacyRecovery?.version === LEGACY_RECOVERY_VERSION;

export function legacyOperationOrder(operation, fallbackOrder) {
  if (!isLegacyOperation(operation) || !LEGACY_DOMAINS.has(operation.table)) return fallbackOrder(operation);
  const domain = LEGACY_DOMAIN_ORDER.indexOf(operation.table);
  const type = operation.type === 'create' || operation.type === 'restore' ? 0 : operation.type === 'update' ? 1 : 2;
  return (type === 2 ? LEGACY_DOMAIN_ORDER.length - domain : domain) * 10 + type;
}

export function validateLegacyOperation(operation) {
  if (!isLegacyOperation(operation)) return null;
  if (!operation.id || !operation.idempotencyKey || !operation.table || !operation.localId || !operation.rowId
    || !operation.deviceId || !operation.homesteadId || !OPERATION_TYPES.has(operation.type)
    || !operation.payload || typeof operation.payload !== 'object' || Array.isArray(operation.payload)) {
    const error = new Error('A historical change is malformed and was preserved for review.');
    error.code = 'LEGACY_OPERATION_MALFORMED';
    return error;
  }
  return null;
}

const ignoredPayloadFields = new Set(['id', 'client_updated_at', 'source']);

function equivalent(left, right) {
  if (left === right) return true;
  if (left == null || right == null || typeof left !== typeof right) return false;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length
    && left.every((item, index) => equivalent(item, right[index]));
  if (typeof left === 'object') {
    const keys = Object.keys(left);
    return keys.every(key => equivalent(left[key], right[key]));
  }
  return false;
}

export function legacyOperationAlreadySatisfied(operation, serverRow) {
  if (!isLegacyOperation(operation)) return false;
  if (operation.type === 'soft_delete' && (!serverRow || serverRow.deleted_at)) return true;
  if (!serverRow) return false;
  if (operation.type === 'restore' && serverRow.deleted_at) return false;
  return Object.entries(operation.payload || {})
    .filter(([key]) => !ignoredPayloadFields.has(key))
    .every(([key, value]) => equivalent(value, serverRow[key]));
}
