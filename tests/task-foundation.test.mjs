import test from 'node:test';
import assert from 'node:assert/strict';
import tasks from '../task-foundation.js';
import housekeeping from '../housekeeping-data.js';

test('dairy and laying animals receive distinct Yield choices', () => {
  assert.deepEqual(tasks.eligibleYieldTypes({type:'Animal',identity:{purpose:'Dairy'}}), ['milk','meat']);
  assert.deepEqual(tasks.eligibleYieldTypes({type:'Animal',identity:{purpose:'Eggs'}}), ['eggs','meat']);
});

test('garden and hay records receive structured harvest choices', () => {
  assert.deepEqual(tasks.eligibleYieldTypes({type:'Land',identity:{landType:'Garden Plot'},name:'Kitchen Garden'}), ['harvest']);
  assert.deepEqual(tasks.eligibleYieldTypes({type:'Land',identity:{landType:'Hay Field'},name:'North Hay'}), ['forage']);
});

test('suggestions stay enabled while their recurring series is active', () => {
  const record={id:'cow',type:'Animal',identity:{purpose:'Dairy'}};
  const suggestion=tasks.suggestedTasks(record).find(item=>item.key==='dairy-milk-morning');
  assert.equal(suggestion.yieldType,'milk');
  const rule={frequency:'daily',mode:'fixed_schedule',interval:1,seriesId:'series',enabled:true};
  assert.equal(tasks.suggestionEnabled([{recordId:'cow',suggestionKey:suggestion.key,recurrenceRule:rule,deletedAt:null}],'cow',suggestion.key),true);
  assert.equal(tasks.suggestionEnabled([{recordId:'cow',suggestionKey:suggestion.key,recurrenceRule:rule,deletedAt:null,completed:true,status:'completed'}],'cow',suggestion.key),true);
  assert.equal(tasks.suggestionEnabled([{recordId:'cow',suggestionKey:suggestion.key,recurrenceRule:{...rule,enabled:false},deletedAt:null}],'cow',suggestion.key),false);
});

test('Dairy suggestions include both milking windows and Milk Yield metadata', () => {
  const suggestions=tasks.suggestedTasks({id:'cow',type:'Animal',identity:{purpose:'Dairy'}});
  assert.deepEqual(suggestions.filter(item=>item.key.startsWith('dairy-milk-')), [
    {key:'dairy-milk-morning',title:'Morning milking',frequency:'daily',windowKey:'morning',yieldType:'milk'},
    {key:'dairy-milk-evening',title:'Evening milking',frequency:'daily',windowKey:'evening',yieldType:'milk'}
  ]);
});

test('completed Suggested Task occurrences keep their series enabled', () => {
  const completed={id:'done',recordId:'cow',suggestionKey:'dairy-milk-morning',dueDate:'2026-08-18',recurrenceRule:{frequency:'daily',mode:'fixed_schedule',interval:1,seriesId:'series',enabled:true},deletedAt:null,completed:true,status:'completed'};
  assert.equal(tasks.suggestionEnabled([completed],'cow','dairy-milk-morning'),true);
  assert.equal(tasks.reactivateSuggestedTask([completed],'cow','dairy-milk-morning').id,'done');
});

test('a disabled or deleted suggestion reactivates once without duplicates', () => {
  const rule={frequency:'daily',mode:'fixed_schedule',interval:1,seriesId:'series',enabled:false};
  const disabled={id:'old',recordId:'cow',suggestionKey:'health',dueDate:'2026-08-18',recurrenceRule:rule,deletedAt:null,completed:false,status:'open',completedAt:null,updatedAt:'2026-08-18'};
  const older={...disabled,id:'older',dueDate:'2026-08-17',completed:true,status:'completed',recurrenceRule:{...rule,enabled:true},updatedAt:'2026-08-17'};
  const list=[older,disabled];
  const first=tasks.reactivateSuggestedTask(list,'cow','health',{dueDate:'2026-08-19',recurrenceRule:{frequency:'daily',mode:'fixed_schedule',interval:1},updatedAt:'2026-08-19'});
  const second=tasks.reactivateSuggestedTask(list,'cow','health',{dueDate:'2026-08-20',updatedAt:'2026-08-20'});
  assert.equal(first.id,'old');
  assert.equal(second.id,'old');
  assert.equal(first.recurrenceRule.enabled,true);
  assert.equal(first.completed,false);
  assert.equal(first.status,'open');
});

test('missing and previously deleted built-in suggestions are available as Disabled without creating work', () => {
  const record={id:'hens',type:'Animal',identity:{purpose:'Eggs'}};
  const suggestion=tasks.suggestedTasks(record).find(item=>item.key==='laying-collect-eggs');
  const deleted={id:'deleted-eggs',recordId:'hens',suggestionKey:suggestion.key,dueDate:'2026-08-18',recurrenceRule:{frequency:'daily',mode:'fixed_schedule',interval:1,seriesId:'eggs',enabled:false,seriesDeleted:true},deletedAt:null,completed:false,status:'open'};
  const missing=[];
  assert.ok(suggestion);
  assert.equal(tasks.suggestionEnabled([deleted],record.id,suggestion.key),false);
  assert.equal(tasks.suggestionEnabled(missing,record.id,suggestion.key),false);
  assert.equal(missing.length,0);
  assert.equal(deleted.recurrenceRule.seriesDeleted,true);
  const restored=tasks.reactivateSuggestedTask([deleted],record.id,suggestion.key,{dueDate:'2026-08-19',updatedAt:'2026-08-19T08:00:00Z'});
  assert.equal(restored.id,'deleted-eggs');
  assert.equal(restored.deletedAt,null);
  assert.equal(restored.recurrenceRule.enabled,true);
  assert.equal(restored.recurrenceRule.seriesDeleted,undefined);
});

test('repairing Suggested Task availability never resurrects an ordinary deleted Task', () => {
  const ordinary={id:'ordinary',recordId:'hens',suggestionKey:null,deletedAt:'2026-08-18T12:00:00Z',recurrenceRule:null};
  tasks.suggestedTasks({id:'hens',type:'Animal',identity:{purpose:'Eggs'}});
  assert.equal(ordinary.deletedAt,'2026-08-18T12:00:00Z');
  assert.equal(tasks.isBuiltInSuggestedTask(ordinary),false);
  const deletable={...ordinary,deletedAt:null};
  assert.equal(tasks.deleteTask(deletable,'2026-08-19T12:00:00Z'),true);
  assert.equal(deletable.deletedAt,'2026-08-19T12:00:00Z');
});

test('Work does not auto-suggest recurring stewardship', () => {
  assert.deepEqual(tasks.suggestedTasks({id:'project',type:'Work',identity:{}}),[]);
});

test('reopening a Yield-linked Task can preserve all linked Yield', () => {
  const task={id:'milk-task',completed:true,status:'completed',completedAt:'2026-08-20T12:00:00Z'};
  const yields=[
    {id:'linked-one',taskId:'milk-task',deletedAt:null},
    {id:'linked-two',taskId:'milk-task',deletedAt:null}
  ];
  housekeeping.reopenTask(task,yields,{deleteLinkedYield:false,timestamp:'2026-08-20T13:00:00Z'});
  assert.equal(task.completed,false);
  assert.equal(task.status,'open');
  assert.equal(task.completedAt,null);
  assert.equal(yields.filter(entry=>entry.deletedAt).length,0);
});

test('reopening a Yield-linked Task deletes only exact linked Yield when requested', () => {
  const task={id:'milk-task',recordId:'cow',completed:true,status:'completed',completedAt:'2026-08-20T12:00:00Z'};
  const yields=[
    {id:'linked',taskId:'milk-task',recordId:'cow',occurredAt:'2026-08-20T08:00:00Z',deletedAt:null},
    {id:'unrelated',taskId:'other-task',recordId:'cow',occurredAt:'2026-08-20T08:00:00Z',deletedAt:null}
  ];
  housekeeping.reopenTask(task,yields,{deleteLinkedYield:true,timestamp:'2026-08-20T13:00:00Z'});
  assert.equal(yields[0].deletedAt,'2026-08-20T13:00:00Z');
  assert.equal(yields[0].updatedAt,'2026-08-20T13:00:00Z');
  assert.equal(yields[1].deletedAt,null);
});

test('reopening an ordinary Task works without Yield changes', () => {
  const task={id:'ordinary',completed:true,status:'completed',completedAt:'2026-08-20T12:00:00Z'};
  const yields=[{id:'other-yield',taskId:'milk-task',deletedAt:null}];
  assert.deepEqual(housekeeping.linkedYieldsForTask(yields,task.id),[]);
  housekeeping.reopenTask(task,yields,{timestamp:'2026-08-20T13:00:00Z'});
  assert.equal(task.completed,false);
  assert.equal(yields[0].deletedAt,null);
});
