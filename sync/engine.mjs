import { COLLECTIONS, DOMAIN_ORDER, attachmentCloudReady, fromCloud, hasMeaningfulData, meaningfulCounts, operationOrder, toCloud } from './entities.mjs';

const totals = counts => Object.values(counts).reduce((sum, count) => sum + count, 0);

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
    if (!this.state.state.initialSyncCompleted) return;
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

  async sync() {
    if (this.running) return this.running;
    this.running = (async () => {
      this.onStatus('syncing');
      try {
        await this.push();
        await this.pull();
        this.state.state.lastSuccessfulSyncAt = new Date().toISOString();
        this.state.save();
        this.onStatus('synced');
      } catch (error) {
        this.onStatus(navigator.onLine ? 'problem' : 'offline', error);
        throw error;
      } finally { this.running = null; }
    })();
    return this.running;
  }

  async push() {
    const queue = [...this.state.state.outbox].sort((a, b) => operationOrder(a) - operationOrder(b));
    for (const operation of queue) {
      if (operation.homesteadId !== this.state.state.homesteadId) throw new Error('A queued change belongs to a different Homestead.');
      try {
        const result = await this.cloud.apply(operation);
        if (result.status === 'conflict') this.state.addConflict(operation, result.row);
        else this.state.complete(operation, result.row);
      } catch (error) {
        this.state.fail(operation, error);
        break;
      }
    }
  }

  async pull() {
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
    if (choice === 'cloud') {
      const next = structuredClone(this.readLocal());
      const collection = COLLECTIONS[conflict.table];
      const resolved = fromCloud(conflict.table, conflict.cloudRow, this.state);
      const index = next[collection].findIndex(item => item.id === conflict.localId);
      if (index < 0) next[collection].push(resolved); else next[collection][index] = resolved;
      this.writeLocal(next, 'sync');
      conflict.status = 'kept_cloud';
    } else if (choice === 'local') {
      this.state.entity(conflict.table, conflict.localId).cloudVersion = conflict.cloudRow.version;
      this.state.enqueue({ table: conflict.table, localId: conflict.localId, type: 'update', payload: conflict.localPayload, baseVersion: conflict.cloudRow.version });
      conflict.status = 'use_local_queued';
    } else throw new Error('Unknown conflict resolution.');
    conflict.resolvedAt = new Date().toISOString();
    this.state.save();
    await this.sync();
  }
}
