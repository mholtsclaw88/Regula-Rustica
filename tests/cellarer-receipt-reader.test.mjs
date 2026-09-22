import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateReceiptLedgerDraft } from '../cellarer-receipt-reader.mjs';
import receiptHandler from '../netlify/functions/cyril-receipt-reader.mts';

const context = {
  today: '2026-09-22', timezone: 'America/New_York',
  records: [{ id: 'hens', name: 'Laying Hens', type: 'Animal' }]
};
const image = `data:image/jpeg;base64,${Buffer.concat([
  Buffer.from([0xff, 0xd8]), Buffer.alloc(1000), Buffer.from([0xff, 0xd9])
]).toString('base64')}`;
const request = (body, token = 'token') => new Request('https://example.test/api/cyril/receipt-reader', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

test('receipt draft requires a legible positive total and real date', () => {
  assert.throws(() => validateReceiptLedgerDraft({ title: 'Feed', amount: null, date: '2026-09-22' }, context), /positive receipt total/);
  assert.throws(() => validateReceiptLedgerDraft({ title: 'Feed', amount: 12.5, date: '2026-02-30' }, context), /receipt date/);
  assert.throws(() => validateReceiptLedgerDraft({ title: 'Feed', amount: 12.5, date: '2026-09-22', recordId: 'unknown' }, context), /not available/);
  const draft = validateReceiptLedgerDraft({ title: 'Layer feed', amount: 12.5, date: '2026-09-22', vendorOrSource: 'Feed Mill', recordId: 'hens' }, context);
  assert.equal(draft.kind, 'ledger');
  assert.equal(draft.ledgerType, 'expense');
  assert.equal(draft.recordId, 'hens');
});

test('receipt request rejects unauthenticated and invalid images before any paid call', async () => {
  const unauthenticated = await receiptHandler(new Request('https://example.test/api/cyril/receipt-reader', { method: 'POST', body: '{}' }));
  assert.equal(unauthenticated.status, 401);
  const invalid = await receiptHandler(request({ image: 'data:image/svg+xml;base64,AAAA', context }));
  assert.equal(invalid.status, 400);
});

test('receipt reader verifies Cloud identity and distinct Premium allowance before inference', async () => {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  const calls = [];
  globalThis.Netlify = { env: { get: name => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'publishable' }[name]) } };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: 'user' });
    return Response.json([{ allowed: false, reason: 'premium_required' }]);
  };
  try {
    const response = await receiptHandler(request({ image, context }));
    assert.equal(response.status, 403);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].url.endsWith('/rest/v1/rpc/consume_premium_feature'));
    assert.equal(JSON.parse(calls[1].options.body).feature_key, 'cellarer_receipt_reader');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  }
});

test('receipt image yields only a reviewed Ledger draft, never a direct write', async () => {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  const calls = [];
  globalThis.Netlify = { env: { get: name => ({
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'publishable',
    OPENAI_BASE_URL: 'https://gateway.example/v1', OPENAI_API_KEY: 'gateway-key'
  }[name]) } };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: 'user' });
    if (String(url).includes('consume_premium_feature')) return Response.json([{ allowed: true, remaining: 29, reason: 'allowed' }]);
    return Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({
      title: 'Layer feed', amount: 24.5, date: '2026-09-22', vendorOrSource: 'Feed Mill', category: 'Feed', recordId: 'hens'
    }) }] }] });
  };
  try {
    const response = await receiptHandler(request({ image, note: 'For laying hens', context }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.draft.kind, 'ledger');
    assert.equal(body.draft.amount, 24.5);
    assert.equal(body.draft.recordId, 'hens');
    assert.equal(calls.length, 3);
    const ai = JSON.parse(calls[2].options.body);
    assert.equal(ai.store, false);
    assert.equal(ai.model, 'gpt-5.6-luna');
    assert.equal(ai.input[1].content[1].type, 'input_image');
    assert.equal(ai.input[1].content[1].image_url, image);
    assert.equal(ai.text.format.strict, true);
    assert.ok(calls.every(call => !call.url.includes('/rest/v1/ledger_entries')));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  }
});

test('unreadable receipt fields fail closed without creating a Ledger entry', async () => {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  globalThis.Netlify = { env: { get: name => ({
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'publishable',
    OPENAI_BASE_URL: 'https://gateway.example/v1', OPENAI_API_KEY: 'gateway-key'
  }[name]) } };
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: 'user' });
    if (String(url).includes('consume_premium_feature')) return Response.json([{ allowed: true }]);
    return Response.json({ output_text: JSON.stringify({
      title: 'Feed', amount: null, date: null, vendorOrSource: null, category: null, recordId: null
    }) });
  };
  try {
    const response = await receiptHandler(request({ image, context }));
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /positive receipt total/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  }
});

test('receipt UI reuses the existing Ledger form and local-only attachment path', async () => {
  const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const [html, client, receiptStorage, app, worker] = await Promise.all([
    read('index.html'), read('cellarer-receipt-reader.mjs'), read('ledger-receipt-modal.js'), read('app.js'), read('service-worker.js')
  ]);
  assert.match(html, /id="cellarerReceipt"/);
  assert.match(html, /id="cellarerReceiptDialog"/);
  assert.match(html, /receipt photos do not cloud-sync/);
  assert.match(client, /openCellarerDraft\(draft\)/);
  assert.match(client, /stageForOpenLedger\(receipt\)/);
  assert.match(receiptStorage, /stageForOpenLedger\(receipt\)/);
  assert.match(receiptStorage, /receiptMap\(data\)\[entry\.id\] = pending\.receipt/);
  assert.match(app, /if \(draft\.kind === 'ledger'\)/);
  assert.match(worker, /regula-rustica-cyril-receipt-reader-v1/);
  assert.match(worker, /cellarer-receipt-reader\.mjs\?v=cyril-receipt-reader-v1/);
});
