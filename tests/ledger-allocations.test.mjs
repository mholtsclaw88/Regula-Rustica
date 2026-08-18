import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { COLLECTIONS, DOMAIN_ORDER, toCloud, fromCloud } from '../sync/entities.mjs';
const state={entity:(table,id)=>({cloudId:`cloud-${id}`}),localIdForCloud:(table,id)=>id?.replace(/^cloud-/,'')};
test('ledger allocations are a first-class sync domain',()=>{assert.ok(DOMAIN_ORDER.includes('ledger_allocations'));assert.equal(COLLECTIONS.ledger_allocations,'ledgerAllocations');});
test('ledger allocation references and amount map to cloud',()=>{const row=toCloud('ledger_allocations',{id:'a1',ledgerEntryId:'l1',recordId:'r1',amount:42.5,createdAt:'2026-08-16T00:00:00Z'},state);assert.equal(row.ledger_entry_id,'cloud-l1');assert.equal(row.record_id,'cloud-r1');assert.equal(row.amount,42.5);});
test('ledger allocation maps back to local references',()=>{const row=fromCloud('ledger_allocations',{id:'cloud-a1',ledger_entry_id:'cloud-l1',record_id:'cloud-r1',amount:'42.50',created_at:'2026-08-16T00:00:00Z',updated_at:'2026-08-16T00:00:00Z'},state);assert.equal(row.ledgerEntryId,'l1');assert.equal(row.recordId,'r1');assert.equal(row.amount,42.5);});

test('ledger allocation form stays opt-in and begins with one Primary Record row', async () => {
  const source = await readFile(new URL('../ledger-allocations.js', import.meta.url), 'utf8');
  assert.match(source, /Add allocation \/ split this entry/);
  assert.match(source, /initialRecordId: linkedSelect\?\.value \|\| ''/);
  assert.doesNotMatch(source, /openSecondRow: true/);
  assert.match(source, /Unallocated/);
});
