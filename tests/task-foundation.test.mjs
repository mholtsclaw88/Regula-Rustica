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

test('suggestions are templates and only an active equivalent suppresses Enable', () => {
  const record={id:'cow',type:'Animal',identity:{purpose:'Dairy'}};
  const suggestion=tasks.suggestedTasks(record).find(item=>item.key==='dairy-milk-morning');
  assert.equal(suggestion.yieldType,'milk');
  assert.equal(tasks.suggestionEnabled([{recordId:'cow',suggestionKey:suggestion.key,deletedAt:'2026-08-17'}],'cow',suggestion.key),false);
  assert.equal(tasks.suggestionEnabled([{recordId:'cow',suggestionKey:suggestion.key,deletedAt:null}],'cow',suggestion.key),true);
  assert.equal(tasks.suggestionEnabled([{recordId:'cow',suggestionKey:suggestion.key,deletedAt:null,completed:true,status:'completed'}],'cow',suggestion.key),false);
});

test('Dairy suggestions include both milking windows and Milk Yield metadata', () => {
  const suggestions=tasks.suggestedTasks({id:'cow',type:'Animal',identity:{purpose:'Dairy'}});
  assert.deepEqual(suggestions.filter(item=>item.key.startsWith('dairy-milk-')), [
    {key:'dairy-milk-morning',title:'Morning milking',frequency:'daily',windowKey:'morning',yieldType:'milk'},
    {key:'dairy-milk-evening',title:'Evening milking',frequency:'daily',windowKey:'evening',yieldType:'milk'}
  ]);
});

test('completed stale suggestions can be enabled without duplicating an open Task', () => {
  const completed={id:'done',recordId:'cow',suggestionKey:'dairy-milk-morning',deletedAt:null,completed:true,status:'completed'};
  const list=[completed];
  assert.equal(tasks.suggestionEnabled(list,'cow','dairy-milk-morning'),false);
  assert.equal(tasks.reactivateSuggestedTask(list,'cow','dairy-milk-morning'),null);

  const open={id:'open',recordId:'cow',suggestionKey:'dairy-milk-morning',deletedAt:null,completed:false,status:'open'};
  list.push(open);
  assert.equal(tasks.suggestionEnabled(list,'cow','dairy-milk-morning'),true);
  assert.equal(tasks.reactivateSuggestedTask(list,'cow','dairy-milk-morning').id,'open');
});

test('a disabled or deleted suggestion reactivates once without duplicates', () => {
  const disabled={id:'old',recordId:'cow',suggestionKey:'health',deletedAt:'2026-08-17',completed:true,status:'completed',completedAt:'2026-08-17',updatedAt:'2026-08-17'};
  const older={...disabled,id:'older',updatedAt:'2026-08-16'};
  const list=[older,disabled];
  const first=tasks.reactivateSuggestedTask(list,'cow','health',{dueDate:'2026-08-18',updatedAt:'2026-08-18'});
  const second=tasks.reactivateSuggestedTask(list,'cow','health',{dueDate:'2026-08-19',updatedAt:'2026-08-19'});
  assert.equal(first.id,'old');
  assert.equal(second.id,'old');
  assert.equal(list.filter(task=>!task.deletedAt&&task.suggestionKey==='health').length,1);
  assert.equal(first.completed,false);
  assert.equal(first.status,'open');
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
