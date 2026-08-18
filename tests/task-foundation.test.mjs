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

test('suggestions are templates and a deleted equivalent is not recreated', () => {
  const record={id:'cow',type:'Animal',identity:{purpose:'Dairy'}};
  const suggestion=tasks.suggestedTasks(record).find(item=>item.key==='dairy-milk-morning');
  assert.equal(suggestion.yieldType,'milk');
  assert.equal(tasks.suggestionEnabled([{recordId:'cow',suggestionKey:suggestion.key,deletedAt:'2026-08-17'}],'cow',suggestion.key),true);
});

test('Work does not auto-suggest recurring stewardship', () => {
  assert.deepEqual(tasks.suggestedTasks({id:'project',type:'Work',identity:{}}),[]);
});
