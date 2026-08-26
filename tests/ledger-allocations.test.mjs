import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { COLLECTIONS, DOMAIN_ORDER, toCloud, fromCloud } from '../sync/entities.mjs';
import ledgerAllocationDisplay from '../ledger-allocation-display.js';
const state={entity:(table,id)=>({cloudId:`cloud-${id}`}),localIdForCloud:(table,id)=>id?.replace(/^cloud-/,'')};

const records = ['a', 'b', 'c'].map(id => ({ id, name: `Record ${id.toUpperCase()}`, deletedAt: null }));
const entry = { id: 'entry-1', type: 'expense', date: '2026-08-26', description: 'Shared fencing', amount: 90, recordId: 'a', deletedAt: null };
const allocation = (id, recordId, amount, overrides = {}) => ({ id, ledgerEntryId: entry.id, recordId, amount, deletedAt: null, ...overrides });
const allocatedData = () => ({
  records: structuredClone(records),
  ledger: [structuredClone(entry)],
  ledgerAllocations: [allocation('allocation-a', 'a', 30), allocation('allocation-b', 'b', 20), allocation('allocation-c', 'c', 40)]
});

test('ledger allocations are a first-class sync domain',()=>{assert.ok(DOMAIN_ORDER.includes('ledger_allocations'));assert.equal(COLLECTIONS.ledger_allocations,'ledgerAllocations');});
test('ledger allocation references and amount map to cloud',()=>{const row=toCloud('ledger_allocations',{id:'a1',ledgerEntryId:'l1',recordId:'r1',amount:42.5,createdAt:'2026-08-16T00:00:00Z'},state);assert.equal(row.ledger_entry_id,'cloud-l1');assert.equal(row.record_id,'cloud-r1');assert.equal(row.amount,42.5);});
test('ledger allocation maps back to local references',()=>{const row=fromCloud('ledger_allocations',{id:'cloud-a1',ledger_entry_id:'cloud-l1',record_id:'cloud-r1',amount:'42.50',created_at:'2026-08-16T00:00:00Z',updated_at:'2026-08-16T00:00:00Z'},state);assert.equal(row.ledgerEntryId,'l1');assert.equal(row.recordId,'r1');assert.equal(row.amount,42.5);});

test('single-Record Ledger entries retain their full amount', () => {
  const data = { records, ledger: [entry], ledgerAllocations: [] };
  assert.deepEqual(ledgerAllocationDisplay.entriesForRecord(data, 'a').map(item => item.amount), [90]);
  assert.deepEqual(ledgerAllocationDisplay.entriesForRecord(data, 'b'), []);
});

test('two-Record allocations appear under both Records with their own shares', () => {
  const data = allocatedData();
  data.ledgerAllocations.pop();
  assert.equal(ledgerAllocationDisplay.entriesForRecord(data, 'a')[0].amount, 30);
  assert.equal(ledgerAllocationDisplay.entriesForRecord(data, 'b')[0].amount, 20);
  assert.deepEqual(ledgerAllocationDisplay.entriesForRecord(data, 'c'), []);
});

test('three-Record allocation recognizes every secondary Record without duplicating the transaction', () => {
  const data = allocatedData();
  assert.deepEqual(['a', 'b', 'c'].map(recordId => ledgerAllocationDisplay.entriesForRecord(data, recordId)[0].amount), [30, 20, 40]);
  assert.equal(data.ledger.length, 1);
  assert.equal(ledgerAllocationDisplay.entryAllocationSummary(data, data.ledger[0]).allocated, 90);
  assert.equal(data.ledger[0].amount, 90);
});

test('Record Ledger totals use allocated shares while global amount remains canonical', () => {
  const data = allocatedData();
  const totals = ['a', 'b', 'c'].map(recordId => ledgerAllocationDisplay.totalsForRecord(ledgerAllocationDisplay.entriesForRecord(data, recordId)));
  assert.deepEqual(totals.map(item => item.expenses), [30, 20, 40]);
  assert.deepEqual(totals.map(item => item.net), [-30, -20, -40]);
  assert.equal(data.ledger[0].amount, 90);
});

test('allocation edits add and remove Record visibility using the same Ledger entry', () => {
  const data = allocatedData();
  data.ledger[0].description = 'Updated shared fencing';
  data.ledgerAllocations.find(item => item.recordId === 'b').deletedAt = '2026-08-27T12:00:00Z';
  data.ledgerAllocations.find(item => item.recordId === 'a').amount = 50;
  assert.equal(ledgerAllocationDisplay.entriesForRecord(data, 'a')[0].entry.description, 'Updated shared fencing');
  assert.equal(ledgerAllocationDisplay.entriesForRecord(data, 'a')[0].amount, 50);
  assert.deepEqual(ledgerAllocationDisplay.entriesForRecord(data, 'b'), []);
  data.ledgerAllocations.push(allocation('allocation-b-2', 'b', 10));
  assert.equal(ledgerAllocationDisplay.entriesForRecord(data, 'b')[0].amount, 10);
  assert.equal(data.ledger.length, 1);
});

test('deleting the canonical Ledger entry removes it from every allocated Record', () => {
  const data = allocatedData();
  data.ledger[0].deletedAt = '2026-08-27T12:00:00Z';
  assert.deepEqual(['a', 'b', 'c'].map(recordId => ledgerAllocationDisplay.entriesForRecord(data, recordId).length), [0, 0, 0]);
});

test('secondary allocation relationships survive JSON reload and cloud mapping', () => {
  const reloaded = JSON.parse(JSON.stringify(allocatedData()));
  assert.equal(ledgerAllocationDisplay.entriesForRecord(reloaded, 'c')[0].amount, 40);
  const roundTripped = reloaded.ledgerAllocations.map(item => {
    const cloud = toCloud('ledger_allocations', item, state);
    return fromCloud('ledger_allocations', {
      id: cloud.id,
      ledger_entry_id: cloud.ledger_entry_id,
      record_id: cloud.record_id,
      amount: cloud.amount,
      created_at: '2026-08-26T12:00:00Z',
      updated_at: '2026-08-26T12:00:00Z'
    }, state);
  });
  const synced = { ...reloaded, ledgerAllocations: roundTripped };
  assert.deepEqual(['a', 'b', 'c'].map(recordId => ledgerAllocationDisplay.entriesForRecord(synced, recordId)[0].amount), [30, 20, 40]);
});

test('ledger allocation form stays opt-in and begins with one Primary Record row', async () => {
  const source = await readFile(new URL('../ledger-allocations.js', import.meta.url), 'utf8');
  assert.match(source, /Add allocation \/ split this entry/);
  assert.match(source, /initialRecordId: linkedSelect\?\.value \|\| ''/);
  assert.doesNotMatch(source, /openSecondRow: true/);
  assert.match(source, /Unallocated/);
});
