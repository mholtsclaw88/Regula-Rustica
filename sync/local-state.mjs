const STATE_KEY = 'regulaRusticaSyncV1';
const BACKUP_KEY = 'regulaRusticaSyncBackupsV1';

export const uuid = () => crypto.randomUUID();

export function emptySyncState() {
  return {
    schemaVersion: 1,
    deviceId: uuid(),
    enabled: false,
    homesteadId: null,
    initialSyncCompleted: false,
    initialSyncState: null,
    lastSuccessfulSyncAt: null,
    cursors: {},
    outbox: [],
    conflicts: [],
    entities: {},
    failedOperations: []
  };
}

function normalizeState(value) {
  const base = emptySyncState();
  if (!value || value.schemaVersion !== 1) return base;
  return {
    ...base,
    ...value,
    deviceId: /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value.deviceId || '') ? value.deviceId : base.deviceId,
    cursors: value.cursors && typeof value.cursors === 'object' ? value.cursors : {},
    outbox: Array.isArray(value.outbox) ? value.outbox.map(operation => ({
      ...operation,
      status: operation.status === 'failed' ? 'retryable' : (operation.status || 'pending'),
      attempts: Number(operation.attempts) || 0,
      lastAttemptAt: operation.lastAttemptAt || null,
      lastErrorCode: operation.lastErrorCode || null,
      lastErrorAt: operation.lastErrorAt || null,
      blockedBy: Array.isArray(operation.blockedBy) ? operation.blockedBy : []
    })) : [],
    conflicts: Array.isArray(value.conflicts) ? value.conflicts : [],
    entities: value.entities && typeof value.entities === 'object' ? value.entities : {},
    failedOperations: Array.isArray(value.failedOperations) ? value.failedOperations : []
  };
}

export class LocalSyncState {
  constructor(storage = localStorage) {
    this.storage = storage;
    this.state = this.load();
  }

  load() {
    try {
      return normalizeState(JSON.parse(this.storage.getItem(STATE_KEY)));
    } catch {
      return emptySyncState();
    }
  }

  save() {
    this.storage.setItem(STATE_KEY, JSON.stringify(this.state));
    return this.state;
  }

  entityKey(table, localId) { return `${table}:${localId}`; }

  entity(table, localId) {
    const key = this.entityKey(table, localId);
    if (!this.state.entities[key]) {
      this.state.entities[key] = {
        localId,
        cloudId: /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(localId) ? localId : uuid(),
        cloudVersion: null,
        cloudRow: null
      };
      this.save();
    }
    return this.state.entities[key];
  }

  linkEntityIdentity(table, localId, targetTable, targetLocalId) {
    const key = this.entityKey(table, localId);
    if (!this.state.entities[key]) {
      const target = this.entity(targetTable, targetLocalId);
      this.state.entities[key] = { localId, cloudId: target.cloudId, cloudVersion: null, cloudRow: null };
      this.save();
    }
    return this.state.entities[key];
  }

  localIdForCloud(table, cloudId) {
    const match = Object.entries(this.state.entities)
      .find(([key, value]) => key.startsWith(`${table}:`) && value.cloudId === cloudId);
    return match?.[1].localId || cloudId;
  }

  bind(homesteadId) {
    if (this.state.homesteadId && this.state.homesteadId !== homesteadId) {
      throw new Error('This local Homestead is connected to a different cloud Homestead.');
    }
    this.state.homesteadId = homesteadId;
    this.state.enabled = true;
    this.save();
  }

  enqueue({ table, localId, type, payload, baseVersion = null, clientUpdatedAt = new Date().toISOString() }) {
    const entity = this.entity(table, localId);
    const operation = {
      id: uuid(),
      idempotencyKey: uuid(),
      table,
      localId,
      rowId: entity.cloudId,
      type,
      homesteadId: this.state.homesteadId,
      deviceId: this.state.deviceId,
      baseVersion: baseVersion ?? entity.cloudVersion,
      clientUpdatedAt,
      payload,
      status: 'pending',
      attempts: 0,
      lastError: null
    };
    this.state.outbox.push(operation);
    this.save();
    return operation;
  }

  complete(operation, serverRow) {
    const entity = this.entity(operation.table, operation.localId);
    if (serverRow?.id) entity.cloudId = serverRow.id;
    entity.cloudVersion = serverRow?.version ?? entity.cloudVersion;
    entity.cloudRow = serverRow || entity.cloudRow;
    this.state.outbox = this.state.outbox.filter(item => item.id !== operation.id);
    this.state.failedOperations = this.state.failedOperations.filter(item => item.operationId !== operation.id);
    if (entity.cloudVersion != null) {
      this.state.outbox
        .filter(item => item.table === operation.table && item.localId === operation.localId && item.baseVersion === operation.baseVersion)
        .forEach(item => { item.baseVersion = entity.cloudVersion; });
    }
    this.save();
  }

  fail(operation, error, { retryable = false } = {}) {
    operation.status = retryable ? 'retryable' : 'blocked';
    operation.attempts += 1;
    operation.lastError = String(error?.message || error);
    operation.lastErrorCode = String(error?.code || error?.status || error?.statusCode || (retryable ? 'SYNC_RETRYABLE' : 'SYNC_BLOCKED'));
    operation.lastAttemptAt = new Date().toISOString();
    operation.lastErrorAt = operation.lastAttemptAt;
    operation.blockedBy = [];
    this.state.failedOperations = this.state.failedOperations.filter(item => item.operationId !== operation.id);
    this.state.failedOperations.push({
      operationId: operation.id,
      table: operation.table,
      type: operation.type,
      localId: operation.localId,
      attempts: operation.attempts,
      error: operation.lastError,
      errorCode: operation.lastErrorCode,
      retryable,
      failedAt: operation.lastErrorAt
    });
    this.save();
  }

  waitForDependencies(operation, blockers) {
    operation.status = 'dependency';
    operation.blockedBy = blockers.map(item => item.id);
    operation.lastError = 'Waiting for an earlier related change.';
    operation.lastErrorCode = 'SYNC_DEPENDENCY';
    operation.lastErrorAt = new Date().toISOString();
    this.save();
  }

  retryBlocked() {
    this.state.outbox.forEach(operation => {
      if (['blocked', 'dependency'].includes(operation.status)) {
        operation.status = 'retryable';
        operation.blockedBy = [];
      }
    });
    this.save();
  }

  addConflict(operation, cloudRow) {
    const existing = this.state.conflicts.find(item => item.table === operation.table && item.localId === operation.localId && item.status === 'unresolved');
    const conflict = existing || { id: uuid(), table: operation.table, localId: operation.localId, rowId: operation.rowId, status: 'unresolved' };
    Object.assign(conflict, {
      localPayload: operation.payload,
      localBaseVersion: operation.baseVersion,
      cloudRow,
      operationId: operation.id,
      detectedAt: new Date().toISOString()
    });
    if (!existing) this.state.conflicts.push(conflict);
    this.state.outbox = this.state.outbox.filter(item => item.id !== operation.id);
    this.save();
    return conflict;
  }

  createVerifiedBackup(data, reason) {
    const backup = { id: uuid(), createdAt: new Date().toISOString(), reason, data };
    const existing = (() => {
      try { return JSON.parse(this.storage.getItem(BACKUP_KEY)) || []; } catch { return []; }
    })();
    existing.unshift(backup);
    this.storage.setItem(BACKUP_KEY, JSON.stringify(existing.slice(0, 3)));
    const verified = JSON.parse(this.storage.getItem(BACKUP_KEY));
    if (!verified.some(item => item.id === backup.id && JSON.stringify(item.data) === JSON.stringify(data))) {
      throw new Error('The safety backup could not be verified. Migration was not started.');
    }
    return backup;
  }
}

export const SYNC_STORAGE_KEYS = { state: STATE_KEY, backups: BACKUP_KEY };
