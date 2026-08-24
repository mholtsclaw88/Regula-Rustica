import '../records-relationships.js';

export const DOMAIN_ORDER = ['homestead_people','records','record_documents','record_attachments','chore_windows','tasks','record_relationships','task_assignments','chronicle_entries','calendar_events','yield_entries','notes','ledger_entries','ledger_allocations'];
export const COLLECTIONS = {records:'records',record_documents:'documents',record_attachments:'attachments',homestead_people:'people',chore_windows:'choreWindows',tasks:'tasks',record_relationships:'relationships',task_assignments:'assignments',chronicle_entries:'events',calendar_events:'calendarEvents',yield_entries:'yieldEntries',notes:'notes',ledger_entries:'ledger',ledger_allocations:'ledgerAllocations'};
const iso=v=>v||new Date().toISOString();
const cloudId=(s,t,id)=>id?s.entity(t,id).cloudId:null;
const localId=(s,t,id)=>id?s.localIdForCloud(t,id):null;
export const attachmentCloudReady=row=>Boolean(row?.storagePath)&&(row.syncState==='synced'||!row.syncState||Boolean(row.deletedAt));

export function toCloud(t,r,s,source='manual'){
 const c={id:cloudId(s,t,r.id),client_updated_at:iso(r.updatedAt||r.createdAt),source};
 if(t==='records'){const x={...(r.stewardship||{})},identity={...(r.identity||{}),profilePhotoCrop:r.profilePhotoCrop||{x:50,y:50,zoom:1}};if(x.responsiblePersonId)x.responsiblePersonId=cloudId(s,'homestead_people',x.responsiblePersonId);return{...c,type:r.type.toLowerCase(),name:r.name,status:r.status,identity,stewardship:x,primary_photo_id:cloudId(s,'record_attachments',r.profilePhotoAttachmentId)};}
 if(t==='record_documents')return{...c,record_id:cloudId(s,'records',r.recordId),title:r.title||null,body:r.body||null};
 if(t==='record_attachments')return{...c,document_id:cloudId(s,'record_documents',r.documentId),record_id:cloudId(s,'records',r.recordId),storage_bucket:'record-documents',storage_path:r.storagePath,file_name:r.filename,mime_type:r.mimeType,file_size_bytes:Number(r.size)};
 if(t==='homestead_people')return{...c,person_type:r.personType||'child',display_name:r.displayName,member_id:r.memberId||null};
 if(t==='chore_windows')return{...c,system_key:r.systemKey||null,name:r.name,display_order:Number(r.displayOrder||0),enabled:r.enabled!==false,daypart:r.daypart||null};
 if(t==='tasks')return{...c,record_id:cloudId(s,'records',r.recordId),title:r.title,description:r.description||null,status:r.completed?'completed':(r.status||'open'),priority:r.priority||'normal',due_date:r.dueDate||null,available_from:r.availableFrom||null,completed_at:r.completedAt||null,recurrence_rule:r.recurrenceRule||null,parent_task_id:cloudId(s,'tasks',r.parentTaskId),chore_window_id:cloudId(s,'chore_windows',r.choreWindowId),yield_type:r.yieldType||null,suggestion_key:r.suggestionKey||null};
 if(t==='record_relationships')return{...c,source_record_id:cloudId(s,'records',r.sourceRecordId),target_record_id:cloudId(s,'records',r.targetRecordId),relationship_type:r.relationshipType,started_at:r.startedAt||null,ended_at:r.endedAt||null,details:r.details||{}};
 if(t==='task_assignments')return{...c,task_id:cloudId(s,'tasks',r.taskId),person_id:cloudId(s,'homestead_people',r.personId),member_id:r.memberId||null,assignment_type:r.assignmentType||'assignee',removed_at:r.removedAt||null};
 if(t==='chronicle_entries')return{...c,record_id:cloudId(s,'records',r.recordId),task_id:cloudId(s,'tasks',r.taskId),event_type:r.eventType||'Other',occurred_at:r.occurredAt||`${r.date}T12:00:00.000Z`,summary:r.summary||null,details:{text:r.details||'',...(r.extraDetails||{})},value:r.value===''?null:r.value,unit:r.unit||null,corrects_entry_id:cloudId(s,'chronicle_entries',r.correctsEntryId)};
 if(t==='calendar_events')return{...c,record_id:cloudId(s,'records',r.recordId),title:r.title,start_date:r.startDate,end_date:r.endDate||r.startDate,all_day:Boolean(r.allDay),start_time:r.allDay?null:(r.startTime||null),end_time:r.allDay?null:(r.endTime||null),location:r.location||null,notes:r.notes||null};
 if(t==='yield_entries'){const task=cloudId(s,'tasks',r.taskId);return{...c,record_id:cloudId(s,'records',r.recordId),task_id:task,yield_type:r.type,occurred_at:new Date(r.occurredAt).toISOString(),session:r.session||'other',quantity:Number(r.quantity),unit:r.unit,unusable_quantity:Number(r.unusableQuantity||0),details:{text:r.details||'',product:r.product||'',legacy_event_id:cloudId(s,'chronicle_entries',r.legacyEventId),task_id:task}};}
 if(t==='notes')return{...c,record_id:cloudId(s,'records',r.recordId),title:r.title||null,body:r.text||r.body||'',pinned:Boolean(r.pinned)};
 if(t==='ledger_entries')return{...c,record_id:cloudId(s,'records',r.recordId),entry_type:r.type,entry_date:r.date,description:r.description,amount:Number(r.amount),currency_code:r.currencyCode||'USD',category:r.category||null,vendor_or_source:r.vendorOrSource||null};
 if(t==='ledger_allocations')return{...c,ledger_entry_id:cloudId(s,'ledger_entries',r.ledgerEntryId),record_id:cloudId(s,'records',r.recordId),amount:Number(r.amount)};
 throw new Error(`Unsupported sync table: ${t}`);
}

export function fromCloud(t,r,s){
 const c={id:localId(s,t,r.id),createdAt:r.created_at||r.assigned_at,updatedAt:r.updated_at||r.assigned_at,deletedAt:r.deleted_at||r.removed_at||null};
 if(t==='records'){const x={...(r.stewardship||{})},identity={...(r.identity||{})},profilePhotoCrop=identity.profilePhotoCrop;delete identity.profilePhotoCrop;if(x.responsiblePersonId)x.responsiblePersonId=localId(s,'homestead_people',x.responsiblePersonId);return{...c,type:r.type[0].toUpperCase()+r.type.slice(1),name:r.name,status:r.status,identity,stewardship:x,profilePhotoAttachmentId:localId(s,'record_attachments',r.primary_photo_id),profilePhotoCrop};}
 if(t==='record_documents')return{...c,recordId:localId(s,'records',r.record_id),title:r.title||'',body:r.body||''};
 if(t==='record_attachments')return{...c,documentId:localId(s,'record_documents',r.document_id),recordId:localId(s,'records',r.record_id),storagePath:r.storage_path,filename:r.file_name,mimeType:r.mime_type,size:Number(r.file_size_bytes),syncState:'synced',syncError:''};
 if(t==='homestead_people')return{...c,personType:r.person_type,displayName:r.display_name,memberId:r.member_id||null};
 if(t==='chore_windows')return{...c,systemKey:r.system_key,name:r.name,displayOrder:r.display_order,enabled:r.enabled,daypart:r.daypart};
 if(t==='tasks')return{...c,recordId:localId(s,'records',r.record_id),title:r.title,description:r.description||'',status:r.status,completed:r.status==='completed',dueDate:r.due_date||'',availableFrom:r.available_from||'',completedAt:r.completed_at,priority:r.priority,recurrenceRule:r.recurrence_rule,parentTaskId:localId(s,'tasks',r.parent_task_id),choreWindowId:localId(s,'chore_windows',r.chore_window_id),yieldType:r.yield_type,suggestionKey:r.suggestion_key};
 if(t==='record_relationships')return{...c,sourceRecordId:localId(s,'records',r.source_record_id),targetRecordId:localId(s,'records',r.target_record_id),relationshipType:r.relationship_type,startedAt:r.started_at,endedAt:r.ended_at,details:r.details||{}};
 if(t==='task_assignments')return{...c,taskId:localId(s,'tasks',r.task_id),personId:localId(s,'homestead_people',r.person_id),memberId:r.member_id,assignmentType:r.assignment_type,assignedAt:r.assigned_at,removedAt:r.removed_at};
 if(t==='chronicle_entries')return{...c,recordId:localId(s,'records',r.record_id),taskId:localId(s,'tasks',r.task_id),eventType:r.event_type,date:r.occurred_at.slice(0,10),occurredAt:r.occurred_at,summary:r.summary,details:r.details?.text||'',extraDetails:r.details||{},value:r.value??'',unit:r.unit||'',correctsEntryId:localId(s,'chronicle_entries',r.corrects_entry_id)};
 if(t==='calendar_events')return{...c,recordId:localId(s,'records',r.record_id),title:r.title,startDate:r.start_date,endDate:r.end_date,allDay:r.all_day,startTime:r.start_time||'',endTime:r.end_time||'',location:r.location||'',notes:r.notes||''};
 if(t==='yield_entries')return{...c,recordId:localId(s,'records',r.record_id),taskId:localId(s,'tasks',r.task_id),type:r.yield_type,occurredAt:r.occurred_at,session:r.session,quantity:Number(r.quantity),unit:r.unit,unusableQuantity:Number(r.unusable_quantity||0),details:r.details?.text||'',product:r.details?.product||'',legacyEventId:localId(s,'chronicle_entries',r.details?.legacy_event_id)};
 if(t==='notes')return{...c,recordId:localId(s,'records',r.record_id),title:r.title||'',text:r.body,pinned:r.pinned};
 if(t==='ledger_entries')return{...c,recordId:localId(s,'records',r.record_id),type:r.entry_type,date:r.entry_date,description:r.description,amount:Number(r.amount),currencyCode:r.currency_code,category:r.category,vendorOrSource:r.vendor_or_source};
 if(t==='ledger_allocations')return{...c,ledgerEntryId:localId(s,'ledger_entries',r.ledger_entry_id),recordId:localId(s,'records',r.record_id),amount:Number(r.amount)};
 throw new Error(`Unsupported sync table: ${t}`);
}
export function meaningfulCounts(data){return Object.fromEntries(DOMAIN_ORDER.map(t=>[t,(data[COLLECTIONS[t]]||[]).filter(r=>!r.deletedAt&&!r.removedAt&&(t!=='homestead_people'||r.personType==='child')&&(t!=='record_attachments'||attachmentCloudReady(r))).length]));}
export const hasMeaningfulData=data=>Object.values(meaningfulCounts(data)).some(Boolean);
export function operationOrder(o){const d=DOMAIN_ORDER.indexOf(o.table),t=o.type==='create'||o.type==='restore'?0:o.type==='update'?1:2;if(o.table==='records'&&o.type==='update'&&o.payload?.primary_photo_id)return(DOMAIN_ORDER.indexOf('record_attachments')+1)*10+1;return(t===2?DOMAIN_ORDER.length-d:d)*10+t;}
