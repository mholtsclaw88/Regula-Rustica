import { COLLECTIONS, DOMAIN_ORDER, attachmentCloudReady, fromCloud, hasMeaningfulData, meaningfulCounts, operationOrder, toCloud } from './entities.mjs';
import { isLegacyOperation, legacyOperationAlreadySatisfied, legacyOperationOrder, validateLegacyOperation } from './legacy-recovery.mjs';

const totals = counts => Object.values(counts).reduce((sum, count) => sum + count, 0);

const RETRYABLE_CODES = new Set(['FETCH', 'NETWORK_ERROR', '408', '425', '429', '500', '502', '503', '504', '520', '522', '524', '40001', '40P01', '53300', '57014', '57P01']);

export function isRetryableSyncError(error) {
  const code = String(error?.code || error?.status || error?.statusCode || '').toUpperCase();
  const status = Number(error?.status || error?.statusCode || 0);
  if (RETRYABLE_CODES.has(code) || status >= 500) return true;
  return /failed to fetch|network|timeout|temporar|connection|offline/i.test(String(error?.message || error || ''));
}

const DEPENDENCIES = Object.freeze({
  records: [['homestead_people', 'stewardship.responsiblePersonId'], ['record_attachments', 'primary_photo_id']],
  record_documents: [['records', 'record_id']],
  record_attachments: [['record_documents', 'document_id'], ['records', 'record_id']],
  tasks: [['records', 'record_id'], ['tasks', 'parent_task_id'], ['chore_windows', 'chore_window_id']],
  routines: [['records', 'record_id'], ['chore_windows', 'chore_window_id'], ['homestead_people', 'person_id']],
  routine_occurrences: [['routines', 'routine_id'], ['tasks', 'legacy_task_id']],
  record_relationships: [['records', 'source_record_id'], ['records', 'target_record_id']],
  task_assignments: [['tasks', 'task_id'], ['homestead_people', 'person_id']],
  chronicle_entries: [['records', 'record_id'], ['tasks', 'task_id'], ['chronicle_entries', 'corrects_entry_id']],
  calendar_events: [['records', 'record_id']],
  yield_entries: [['records', 'record_id'], ['tasks', 'task_id'], ['routine_occurrences', 'routine_occurrence_id']],
  notes: [['records', 'record_id']],
  ledger_entries: [['records', 'record_id']],
  ledger_allocations: [['ledger_entries', 'ledger_entry_id'], ['records', 'record_id']]
});

const valueAt = (value, path) => path.split('.').reduce((current, key) => current?.[key], value);
const canonicalValue = value => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
};
const comparablePayload = payload => {
  const value = structuredClone(payload || {});
  delete value.id;
  delete value.client_updated_at;
  delete value.source;
  return canonicalValue(value);
};

function dependencyBlockers(operation, outbox) {
  if (operation.type === 'soft_delete') return [];
  return (DEPENDENCIES[operation.table] || []).flatMap(([table, path]) => {
    const rowId = valueAt(operation.payload, path);
    if (!rowId) return [];
    return outbox.filter(item => item.id !== operation.id && item.table === table && item.rowId === rowId && ['create', 'restore'].includes(item.type));
  });
}

export class SyncEngine {
  constructor({ state, cloud, readLocal, writeLocal, onStatus = () => {} }) {
    this.state = state;
    this.cloud = cloud;
    this.readLocal = readLocal;
    this.writeLocal = writeLocal;
    this.onStatus = onStatus;
    this.running = null;
  }

  async inspectFirstSync(homesteadId) {
    if (this.state.state.homesteadId && this.state.state.homesteadId !== homesteadId) return { case: 'boundary' };
    if (this.state.state.homesteadId === homesteadId && !this.state.state.initialSyncCompleted
      && ['running', 'failed'].includes(this.state.state.initialSyncState?.status)) {
      return { case: this.state.state.initialSyncState.case, cloudCounts: await this.cloud.counts(), resume: true };
    }
    const local = hasMeaningfulData(this.readLocal());
    const cloudCounts = await this.cloud.counts();
    const cloud = totals(cloudCounts) > 0;
    return { case: local ? (cloud ? 'C' : 'A') : (cloud ? 'B' : 'D'), cloudCounts };
  }

  queueLocalChanges(before, after) {
    // Once a device is bound, preserve edits in the durable outbox even while
    // first-sync/recovery is incomplete. Pushing still waits for initialization.
    if (!this.state.state.enabled || !this.state.state.homesteadId) return;
    for (const table of DOMAIN_ORDER) {
      const collection = COLLECTIONS[table];
      const cloudRows = rows => table === 'record_attachments' ? rows.filter(attachmentCloudReady) : rows;
      const previous = new Map(cloudRows(before[collection] || []).map(row => [row.id, row]));
      const current = new Map(cloudRows(after[collection] || []).map(row => [row.id, row]));
      for (const [id, row] of current) {
        if (table === 'yield_entries' && row.taskId) this.state.linkEntityIdentity(table, id, 'tasks', row.taskId);
        const old = previous.get(id);
        if (!old) {
          this.state.enqueue({ table, localId: id, type: 'create', payload: toCloud(table, row, this.state) });
          if (row.deletedAt || row.removedAt) this.state.enqueue({ table, localId: id, type: 'soft_delete', payload: toCloud(table, row, this.state) });
        }
        else if (JSON.stringify(table === 'record_attachments' ? toCloud(table, old, this.state) : old) !== JSON.stringify(table === 'record_attachments' ? toCloud(table, row, this.state) : row)) {
          const type = !old.deletedAt && row.deletedAt ? 'soft_delete' : old.deletedAt && !row.deletedAt ? 'restore' : 'update';
          this.state.enqueue({ table, localId: id, type, payload: toCloud(table, row, this.state), clientUpdatedAt: row.updatedAt });
        }
      }
      for (const [id, row] of previous) {
        if (!current.has(id)) this.state.enqueue({ table, localId: id, type: 'soft_delete', payload: toCloud(table, { ...row, deletedAt: new Date().toISOString() }, this.state) });
      }
    }
  }

  reconcileUntrackedLocalChanges() {
    if (!this.state.state.initialSyncCompleted) return 0;
    const local = this.readLocal();
    let reconciled = null;
    let queued = 0;
    for (const table of DOMAIN_ORDER) {
      const collection = COLLECTIONS[table];
      const rows = table === 'record_attachments'
        ? (local[collection] || []).filter(attachmentCloudReady)
        : (local[collection] || []);
      for (const row of rows) {
        if (this.state.state.outbox.some(item => item.table === table && item.localId === row.id)) continue;
        if (this.state.state.conflicts.some(item => item.table === table && item.localId === row.id && item.status === 'unresolved')) continue;
        const entity = this.state.entity(table, row.id);
        const currentPayload = toCloud(table, row, this.state);
        // Older device state can know the cloud version without retaining the
        // last cloud payload. That is not evidence that the row is missing.
        if (!entity.cloudRow && entity.cloudVersion != null) continue;
        if (!entity.cloudRow || entity.cloudVersion == null) {
          // A local tombstone with no known cloud row is already converged.
          // Do not recreate historical data merely to delete it again.
          if (row.deletedAt || row.removedAt) continue;
          this.state.enqueue({ table, localId: row.id, type: 'create', payload: currentPayload, clientUpdatedAt: row.updatedAt });
          queued += 1;
          continue;
        }
        const cloudLocal = fromCloud(table, entity.cloudRow, this.state);
        const cloudPayload = toCloud(table, cloudLocal, this.state);
        const cloudDeleted = Boolean(entity.cloudRow.deleted_at || entity.cloudRow.removed_at);
        const localDeleted = Boolean(row.deletedAt || row.removedAt);
        if (cloudDeleted && !localDeleted) {
          reconciled ||= structuredClone(local);
          const index = (reconciled[collection] || []).findIndex(item => item.id === row.id);
          if (index >= 0) reconciled[collection][index] = cloudLocal;
          continue;
        }
        if (JSON.stringify(comparablePayload(currentPayload)) === JSON.stringify(comparablePayload(cloudPayload))
          && cloudDeleted === localDeleted) continue;
        const type = !cloudDeleted && localDeleted ? 'soft_delete' : 'update';
        this.state.enqueue({ table, localId: row.id, type, payload: currentPayload, clientUpdatedAt: row.updatedAt });
        queued += 1;
      }
    }
    if (reconciled) this.writeLocal(reconciled, 'sync');
    return queued;
  }

  async initialize(choice, homesteadId) {
    const inspection = await this.inspectFirstSync(homesteadId);
    if (inspection.case === 'boundary') throw new Error('This device contains a different Homestead. Synchronization was stopped.');
    if (inspection.case === 'C' && choice !== 'cloud') throw new Error('Two populated Homesteads cannot be merged automatically.');
    this.state.bind(homesteadId);
    this.state.state.initialSyncState = { case: inspection.case, status: 'running', startedAt: new Date().toISOString() };
    this.state.save();
    try {
      if (inspection.case === 'A' && choice === 'upload') await this.uploadInitial();
      else if ((inspection.case === 'B' && choice === 'download') || (inspection.case === 'C' && choice === 'cloud')) {
        if (inspection.case === 'C') this.state.createVerifiedBackup(this.readLocal(), 'before-cloud-replacement');
        await this.downloadInitial();
      } else if (inspection.case !== 'D') throw new Error('Choose the safe first-sync action shown.');
      this.state.state.initialSyncCompleted = true;
      this.state.state.initialSyncState = { ...this.state.state.initialSyncState, status: 'complete', completedAt: new Date().toISOString() };
      this.state.save();
      await this.sync();
    } catch (error) {
      this.state.state.initialSyncState = { ...this.state.state.initialSyncState, status: 'failed', error: error.message };
      this.state.save();
      throw error;
    }
  }

  async uploadInitial() {
    const local = this.readLocal();
    const expected = Object.fromEntries(DOMAIN_ORDER.map(table => [table, []]));
    this.state.createVerifiedBackup(local, 'before-first-cloud-migration');
    for (const table of DOMAIN_ORDER) {
      const rows = table === 'record_attachments' ? (local[COLLECTIONS[table]] || []).filter(attachmentCloudReady) : (local[COLLECTIONS[table]] || []);
      for (const row of rows) {
        if (table === 'yield_entries' && row.taskId) this.state.linkEntityIdentity(table, row.id, 'tasks', row.taskId);
        const payload = toCloud(table, row, this.state, 'migration');
        expected[table].push(payload);
        const entity = this.state.entity(table, row.id);
        const pending = this.state.state.outbox.filter(item => item.table === table && item.localId === row.id);
        if (entity.cloudVersion == null && !pending.length) this.state.enqueue({ table, localId: row.id, type: 'create', payload });
        if ((row.deletedAt || row.removedAt) && entity.cloudVersion == null && !pending.some(item => item.type === 'soft_delete')) {
          this.state.enqueue({ table, localId: row.id, type: 'soft_delete', payload });
        }
      }
    }
    await this.push();
    if (this.state.state.outbox.length) throw new Error('Initial upload is incomplete; pending changes were preserved.');
    if (this.state.state.conflicts.some(item => item.status === 'unresolved')) throw new Error('Initial upload needs conflict review and was not marked complete.');
    const localCounts = meaningfulCounts(local);
    const cloudCounts = await this.cloud.counts();
    for (const table of DOMAIN_ORDER) {
      if (cloudCounts[table] < localCounts[table]) throw new Error(`Migration verification failed for ${table}.`);
    }
    await this.cloud.verifyMigration(expected);
  }

  async downloadInitial() {
    const empty = { ...this.readLocal() };
    DOMAIN_ORDER.forEach(table => { empty[COLLECTIONS[table]] = []; });
    this.writeLocal(empty, 'sync');
    this.state.state.cursors = {};
    this.state.save();
    await this.pull();
  }

  async resetDeviceFromCloud(homesteadId) {
    if (!this.cloud || !homesteadId) throw new Error('Sign in to a cloud Homestead before resetting this device.');
    const cloudCounts = await this.cloud.counts();
    if (totals(cloudCounts) === 0) throw new Error('The cloud Homestead is empty. This device was not reset.');
    this.state.prepareCloudRecovery(this.readLocal(), homesteadId);
    try {
      await this.downloadInitial();
      this.state.state.initialSyncCompleted = true;
      this.state.state.initialSyncState = {
        ...this.state.state.initialSyncState,
        status: 'complete',
        completedAt: new Date().toISOString()
      };
      this.state.save();
      await this.sync();
    } catch (error) {
      this.state.state.initialSyncCompleted = false;
      this.state.state.initialSyncState = {
        ...this.state.state.initialSyncState,
        status: 'failed',
        error: error.message
      };
      this.state.save();
      throw error;
    }
  }

  async sync({ retryBlocked = false } = {}) {
    if (this.running) return this.running;
    this.running = (async () => {
      this.onStatus('syncing');
      try {
        this.reconcileUntrackedLocalChanges();
        await this.push({ retryBlocked });
        await this.pull();
        this.reconcileUntrackedLocalChanges();
        if (this.state.state.outbox.some(item => item.status === 'pending')) {
          await this.push();
          await this.pull();
          this.reconcileUntrackedLocalChanges();
        }
        const waiting = this.state.state.outbox.length > 0
          || this.state.state.conflicts.some(item => item.status === 'unresolved');
        if (!waiting) this.state.state.lastSuccessfulSyncAt = new Date().toISOString();
        this.state.save();
        this.onStatus(waiting ? 'attention' : 'synced');
      } catch (error) {
        this.onStatus(navigator.onLine ? 'problem' : 'offline', error);
        throw error;
      } finally { this.running = null; }
    })();
    return this.running;
  }

  async push({ retryBlocked = false } = {}) {
    if (retryBlocked) this.state.retryBlocked();
    const queue = [...this.state.state.outbox].sort((a, b) => legacyOperationOrder(a, operationOrder) - legacyOperationOrder(b, operationOrder));
    for (const operation of queue) {
      if (operation.homesteadId !== this.state.state.homesteadId) throw new Error('A queued change belongs to a different Homestead.');
      if (operation.status === 'blocked') continue;
      const legacyError = validateLegacyOperation(operation);
      if (legacyError) {
        this.state.fail(operation, legacyError);
        continue;
      }
      const blockers = dependencyBlockers(operation, this.state.state.outbox);
      if (blockers.length) {
        this.state.waitForDependencies(operation, blockers);
        continue;
      }
      operation.status = 'pending';
      operation.blockedBy = [];
      try {
        if (isLegacyOperation(operation) && typeof this.cloud.inspectLegacy === 'function') {
          const inspection = await this.cloud.inspectLegacy(operation);
          if (inspection.supported && legacyOperationAlreadySatisfied(operation, inspection.row)) {
            this.state.complete(operation, inspection.row);
            continue;
          }
          if (inspection.supported && operation.type === 'create' && inspection.row) {
            this.state.addConflict(operation, inspection.row);
            continue;
          }
          if (inspection.supported && operation.type !== 'create' && !inspection.row) {
            const error = new Error('The historical target is not present in this Homestead; the change was preserved.');
            error.code = 'LEGACY_TARGET_MISSING';
            this.state.fail(operation, error);
            continue;
          }
          if (inspection.supported && operation.type !== 'create' && operation.baseVersion == null) {
            this.state.addConflict(operation, inspection.row);
            continue;
          }
        }
        const result = await this.cloud.apply(operation);
        if (result.status === 'conflict' && legacyOperationAlreadySatisfied(operation, result.row)) this.state.complete(operation, result.row);
        else if (result.status === 'conflict') this.state.addConflict(operation, result.row);
        else this.state.complete(operation, result.row);
      } catch (error) {
        this.state.fail(operation, error, { retryable: isRetryableSyncError(error) });
      }
    }
  }

  async pull() {
    if (typeof this.cloud.memberDirectory === 'function') {
      const rows = await this.cloud.memberDirectory();
      const next = structuredClone(this.readLocal());
      next.people ||= [];
      for (const row of rows) {
        const converted = fromCloud('homestead_people', row, this.state);
        const index = next.people.findIndex(item => item.id === converted.id);
        if (index < 0) next.people.push(converted); else next.people[index] = converted;
        const entity = this.state.entity('homestead_people', converted.id);
        entity.cloudVersion = row.version ?? entity.cloudVersion;
        entity.cloudRow = row;
      }
      this.writeLocal(next, 'sync');
      this.state.save();
    }
    for (const table of DOMAIN_ORDER) {
      for await (const page of this.cloud.changes(table, this.state.state.cursors[table])) {
        const next = structuredClone(this.readLocal());
        const collection = COLLECTIONS[table];
        next[collection] ||= [];
        for (const row of page.rows) {
          const localId = this.state.localIdForCloud(table, row.id);
          const entity = this.state.entity(table, localId);
          const pending = this.state.state.outbox.find(item => item.table === table && item.localId === localId);
          if (pending && entity.cloudVersion != null && row.version !== entity.cloudVersion) {
            this.state.addConflict(pending, row);
            continue;
          }
          const converted = fromCloud(table, row, this.state);
          const index = next[collection].findIndex(item => item.id === converted.id);
          if (index < 0) next[collection].push(converted); else next[collection][index] = converted;
          entity.cloudVersion = row.version ?? entity.cloudVersion;
          entity.cloudRow = row;
        }
        this.writeLocal(next, 'sync');
        this.state.state.cursors[table] = page.cursor;
        this.state.save();
      }
    }
  }

  async resolveConflict(conflictId, choice) {
    const conflict = this.state.state.conflicts.find(item => item.id === conflictId && item.status === 'unresolved');
    if (!conflict) return;
    if (!conflict.cloudRow?.id || conflict.cloudRow.version == null) throw new Error('The cloud version for this conflict is unavailable. Sync again before resolving it.');
    const entity = this.state.entity(conflict.table, conflict.localId);
    entity.cloudId = conflict.cloudRow.id;
    entity.cloudVersion = conflict.cloudRow.version;
    entity.cloudRow = conflict.cloudRow;
    if (choice === 'cloud') {
      const next = structuredClone(this.readLocal());
      const collection = COLLECTIONS[conflict.table];
      next[collection] ||= [];
      const resolved = fromCloud(conflict.table, conflict.cloudRow, this.state);
      let index = next[collection].findIndex(item => item.id === conflict.localId || item.id === conflict.cloudRow.id);
      if (index < 0) { next[collection].push(resolved); index = next[collection].length - 1; } else next[collection][index] = resolved;
      next[collection] = next[collection].filter((item, itemIndex) => itemIndex === index || ![conflict.localId, conflict.cloudRow.id].includes(item.id));
      this.writeLocal(next, 'sync');
      conflict.status = 'kept_cloud';
    } else if (choice === 'local') {
      const payload = { ...conflict.localPayload, id: conflict.cloudRow.id };
      this.state.enqueue({ table: conflict.table, localId: conflict.localId, type: 'update', payload, baseVersion: conflict.cloudRow.version });
      conflict.status = 'use_local_queued';
    } else throw new Error('Unknown conflict resolution.');
    conflict.resolvedAt = new Date().toISOString();
    this.state.save();
    await this.sync();
  }
}
