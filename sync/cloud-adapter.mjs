import { DOMAIN_ORDER } from './entities.mjs';

const PAGE_SIZE = 200;

export class SupabaseSyncAdapter {
  constructor(client) { this.client = client; }

  async currentHomestead() {
    const { data, error } = await this.client.rpc('current_homestead_id');
    if (error) throw error;
    return data;
  }

  async counts() {
    const result = {};
    for (const table of DOMAIN_ORDER) {
      const { count, error } = await this.client.from(table).select('id', { count: 'exact', head: true });
      if (error) throw error;
      result[table] = count || 0;
    }
    return result;
  }

  async apply(operation) {
    const { data, error } = await this.client.rpc('apply_sync_operation', {
      operation_key: operation.idempotencyKey,
      client_device_id: operation.deviceId,
      target_table: operation.table,
      target_id: operation.rowId,
      operation_kind: operation.type,
      expected_version: operation.baseVersion,
      client_timestamp: operation.clientUpdatedAt,
      operation_payload: operation.payload
    });
    if (error) throw error;
    return data;
  }

  async verifyMigration(expected) {
    const referenceFields = {
      record_relationships: ['source_record_id', 'target_record_id'],
      tasks: ['record_id', 'parent_task_id'],
      task_assignments: ['task_id', 'member_id'],
      chronicle_entries: ['record_id', 'task_id', 'corrects_entry_id'],
      notes: ['record_id'], ledger_entries: ['record_id']
    };
    for (const table of DOMAIN_ORDER) {
      const rows = expected[table] || [];
      for (let offset = 0; offset < rows.length; offset += PAGE_SIZE) {
        const batch = rows.slice(offset, offset + PAGE_SIZE);
        const fields = ['id', ...(referenceFields[table] || [])];
        const { data, error } = await this.client.from(table).select(fields.join(',')).in('id', batch.map(row => row.id));
        if (error) throw error;
        const actual = new Map((data || []).map(row => [row.id, row]));
        for (const wanted of batch) {
          const found = actual.get(wanted.id);
          if (!found) throw new Error(`Migration verification could not find ${table} row ${wanted.id}.`);
          for (const field of referenceFields[table] || []) {
            if ((found[field] || null) !== (wanted[field] || null)) throw new Error(`Migration relationship verification failed for ${table}.`);
          }
        }
      }
    }
    return true;
  }

  async *changes(table, cursor = null) {
    let next = cursor || { updatedAt: '1970-01-01T00:00:00.000Z', id: '00000000-0000-0000-0000-000000000000' };
    while (true) {
      let query = this.client.from(table).select('*')
        .or(`updated_at.gt.${next.updatedAt},and(updated_at.eq.${next.updatedAt},id.gt.${next.id})`)
        .order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(PAGE_SIZE);
      const { data, error } = await query;
      if (error) throw error;
      if (!data?.length) return;
      const last = data[data.length - 1];
      next = { updatedAt: last.updated_at, id: last.id };
      yield { rows: data, cursor: next };
      if (data.length < PAGE_SIZE) return;
    }
  }
}
