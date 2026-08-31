import { DOMAIN_ORDER } from './entities.mjs';
const PAGE_SIZE=200;

export const SYNC_RPC_ROUTES = Object.freeze({
  homestead_people: 'apply_people_sync_operation',
  records: 'apply_document_sync_operation',
  record_documents: 'apply_document_sync_operation',
  record_attachments: 'apply_document_sync_operation',
  chore_windows: 'apply_routine_sync_operation',
  tasks: 'apply_task_sync_operation',
  record_relationships: 'apply_sync_operation',
  task_assignments: 'apply_people_sync_operation',
  chronicle_entries: 'apply_sync_operation',
  calendar_events: 'apply_housekeeping_sync_operation',
  yield_entries: 'apply_housekeeping_sync_operation',
  notes: 'apply_sync_operation',
  ledger_entries: 'apply_sync_operation',
  ledger_allocations: 'apply_ledger_allocation_sync_operation'
});

export const LEGACY_SYNC_RPC_ROUTES = Object.freeze({
  routines: 'apply_routine_sync_operation',
  routine_occurrences: 'apply_routine_sync_operation'
});

export function rpcForSyncTable(table, { legacy = false } = {}) {
  const rpc = SYNC_RPC_ROUTES[table] || (legacy ? LEGACY_SYNC_RPC_ROUTES[table] : null);
  if (rpc) return rpc;
  const error = new Error(`No cloud synchronization route is registered for ${table || 'this change'}.`);
  error.code = 'SYNC_ROUTE_MISSING';
  throw error;
}

export class SupabaseSyncAdapter{
 constructor(client){this.client=client;}
 async currentHomestead(){const{data,error}=await this.client.rpc('current_homestead_id');if(error)throw error;return data;}
 async counts(){const result={};for(const table of DOMAIN_ORDER){let query=this.client.from(table).select('id',{count:'exact',head:true});if(table==='homestead_people')query=query.eq('person_type','child').is('deleted_at',null);const{count,error}=await query;if(error)throw error;result[table]=count||0;}return result;}
 async memberDirectory(){const{data,error}=await this.client.from('homestead_people').select('*').eq('person_type','member').order('updated_at',{ascending:true}).order('id',{ascending:true});if(error)throw error;return data||[];}
 async inspectLegacy(operation){if(!SYNC_RPC_ROUTES[operation.table]&&!LEGACY_SYNC_RPC_ROUTES[operation.table])return{supported:false,row:null};let{data,error}=await this.client.from(operation.table).select('*').eq('id',operation.rowId).maybeSingle();if(error)throw error;if(!data&&operation.table==='record_relationships'&&operation.type==='create'){const p=operation.payload||{};if(p.source_record_id&&p.target_record_id&&p.relationship_type){const equivalent=await this.client.from('record_relationships').select('*').eq('source_record_id',p.source_record_id).eq('target_record_id',p.target_record_id).eq('relationship_type',p.relationship_type).is('deleted_at',null).maybeSingle();if(equivalent.error)throw equivalent.error;data=equivalent.data;}}if(!data&&operation.table==='chore_windows'&&operation.type==='create'&&operation.payload?.system_key){const equivalent=await this.client.from('chore_windows').select('*').eq('system_key',operation.payload.system_key).is('deleted_at',null).maybeSingle();if(equivalent.error)throw equivalent.error;data=equivalent.data;}return{supported:true,row:data||null};}
 async apply(operation){const rpc=rpcForSyncTable(operation.table,{legacy:Boolean(operation.legacyRecovery)});const{data,error}=await this.client.rpc(rpc,{operation_key:operation.idempotencyKey,client_device_id:operation.deviceId,target_table:operation.table,target_id:operation.rowId,operation_kind:operation.type,expected_version:operation.baseVersion,client_timestamp:operation.clientUpdatedAt,operation_payload:operation.payload});if(error)throw error;return data;}
 async verifyMigration(expected){const refs={record_documents:['record_id'],record_attachments:['document_id','record_id'],record_relationships:['source_record_id','target_record_id'],tasks:['record_id','parent_task_id','chore_window_id'],homestead_people:['member_id'],task_assignments:['task_id','person_id','member_id'],chronicle_entries:['record_id','task_id','corrects_entry_id'],calendar_events:['record_id'],yield_entries:['record_id','task_id'],notes:['record_id'],ledger_entries:['record_id'],ledger_allocations:['ledger_entry_id','record_id']};for(const table of DOMAIN_ORDER){const rows=expected[table]||[];for(let offset=0;offset<rows.length;offset+=PAGE_SIZE){const batch=rows.slice(offset,offset+PAGE_SIZE),fields=['id',...(refs[table]||[])];const{data,error}=await this.client.from(table).select(fields.join(',')).in('id',batch.map(r=>r.id));if(error)throw error;const actual=new Map((data||[]).map(r=>[r.id,r]));for(const wanted of batch){const found=actual.get(wanted.id);if(!found)throw new Error(`Migration verification could not find ${table} row ${wanted.id}.`);for(const field of refs[table]||[])if((found[field]||null)!==(wanted[field]||null))throw new Error(`Migration relationship verification failed for ${table}.`);}}}return true;}
 async *changes(table,cursor=null){let next=cursor||{updatedAt:'1970-01-01T00:00:00.000Z',id:'00000000-0000-0000-0000-000000000000'};while(true){const{data,error}=await this.client.from(table).select('*').or(`updated_at.gt.${next.updatedAt},and(updated_at.eq.${next.updatedAt},id.gt.${next.id})`).order('updated_at',{ascending:true}).order('id',{ascending:true}).limit(PAGE_SIZE);if(error)throw error;if(!data?.length)return;const last=data[data.length-1];next={updatedAt:last.updated_at,id:last.id};yield{rows:data,cursor:next};if(data.length<PAGE_SIZE)return;}}
}
