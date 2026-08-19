import test from 'node:test';
import assert from 'node:assert/strict';
import tasks from '../task-foundation.js';

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
