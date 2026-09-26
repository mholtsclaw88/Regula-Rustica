import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CELLARER_DRAFT_SCHEMA,
  resolveCellarerRecord,
  sanitizeCellarerContext,
  validateCellarerDraft
} from '../cellarer-assisted-entry.mjs';
import cellarerHandler from '../netlify/functions/cyril-assisted-entry.mts';

const [html, app, styles, client, fn, migration, worker] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../housekeeping.css', import.meta.url), 'utf8'),
  readFile(new URL('../cellarer-assisted-entry.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/cyril-assisted-entry.mts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260922182819_cellarer_assisted_entry_quota.sql', import.meta.url), 'utf8'),
  readFile(new URL('../service-worker.js', import.meta.url), 'utf8')
]);

const context = sanitizeCellarerContext({
  today: '2026-09-22', timezone: 'America/New_York',
  records: [
    { id: 'daisy', name: 'Daisy', type: 'Animal', eligibleYieldTypes: ['milk'] },
    { id: 'garden', name: 'Kitchen Garden', type: 'Land', eligibleYieldTypes: ['harvest'] }
  ],
  people: [{ id: 'keeper', name: 'Keeper' }],
  choreWindows: [{ id: 'morning', name: 'Morning', startTime: '06:00', endTime: '09:00' }]
});

test('strict draft schema requires one known shape and no extra properties', () => {
  assert.equal(CELLARER_DRAFT_SCHEMA.additionalProperties, false);
  assert.ok(CELLARER_DRAFT_SCHEMA.required.includes('kind'));
  assert.ok(CELLARER_DRAFT_SCHEMA.required.includes('recordId'));
  assert.deepEqual(CELLARER_DRAFT_SCHEMA.properties.kind.enum, ['task', 'yield', 'ledger', 'journal_note', 'record_event', 'calendar_event']);
});

test('draft validation accepts supported local references and normalizes a task', () => {
  const draft = validateCellarerDraft({
    kind: 'task', title: 'Check Daisy', recordId: 'daisy', personId: 'keeper',
    choreWindowId: 'morning', priority: 'high', recurrenceFrequency: 'daily', recurrenceInterval: 1
  }, context);
  assert.equal(draft.recordId, 'daisy');
  assert.equal(draft.personId, 'keeper');
  assert.equal(draft.recurrenceMode, 'fixed_schedule');
});

test('Record matching uses unique animal species, but never guesses among peers', () => {
  const records = [
    { id: 'milo', name: 'Milo', type: 'Animal', species: 'Cat' },
    { id: 'porkers', name: 'Porkers', type: 'Animal', species: 'Pig' }
  ];
  assert.equal(resolveCellarerRecord('Buy cat food', records), 'milo');
  assert.equal(resolveCellarerRecord('Pig feed', records), 'porkers');
  assert.equal(resolveCellarerRecord('Pig feed and cat food', records), null);
  assert.equal(resolveCellarerRecord('Buy cat food', [...records, { id: 'luna', name: 'Luna', type: 'Animal', species: 'Cat' }]), null);
  assert.equal(resolveCellarerRecord('Feed Milo', records), 'milo');
  assert.equal(resolveCellarerRecord('Service the tractor', [{ id: 'tractor', name: 'John Deere', type: 'Equipment', equipmentType: 'Tractor' }]), 'tractor');
  assert.equal(resolveCellarerRecord('Bale hay', [{ id: 'field', name: 'North Field', type: 'Land', currentUse: 'Hay' }]), 'field');
  assert.equal(resolveCellarerRecord('Collect eggs', [{ id: 'flock', name: 'Freedom Rangers', type: 'Animal', eligibleYieldTypes: ['eggs'] }], 'task'), 'flock');
  assert.equal(resolveCellarerRecord('Buy eggs', [{ id: 'flock', name: 'Freedom Rangers', type: 'Animal', eligibleYieldTypes: ['eggs'] }], 'ledger'), null);
  assert.equal(resolveCellarerRecord('Buy eggs', [{ id: 'flock', name: 'Freedom Rangers', type: 'Animal', eligibleYieldTypes: ['eggs'] }], 'task'), null);
  assert.equal(resolveCellarerRecord('Buy milk', [{ id: 'cow', name: 'Daisy', type: 'Animal', eligibleYieldTypes: ['milk'] }], 'task'), null);
  assert.equal(resolveCellarerRecord('Collect eggs and feed pigs', [
    { id: 'flock', name: 'Freedom Rangers', type: 'Animal', species: 'Chicken', eligibleYieldTypes: ['eggs'] },
    { id: 'pigs', name: 'Feeder pigs', type: 'Animal', species: 'Pig' }
  ], 'task'), null);
  assert.equal(resolveCellarerRecord('Collect eggs', [
    { id: 'flock-a', name: 'A', eligibleYieldTypes: ['eggs'] },
    { id: 'flock-b', name: 'B', eligibleYieldTypes: ['eggs'] }
  ], 'task'), null);
  assert.equal(resolveCellarerRecord('Add a task', [{ id: 'a', name: 'A', type: 'Animal' }], 'task'), null);
});

test('AI context keeps bounded Record facts and prior Ledger summaries, not receipt bytes', () => {
  const clean = sanitizeCellarerContext({
    records: [{ id: 'milo', name: 'Milo', type: 'Animal', species: 'Cat', privateNotes: 'Do not send' }],
    ledgerHistory: [{ description: 'Feed Store cat food', vendorOrSource: 'Feed Store', receiptPhoto: 'private bytes' }]
  });
  assert.equal(clean.records[0].species, 'Cat');
  assert.equal(clean.ledgerHistory[0].vendorOrSource, 'Feed Store');
  assert.equal('privateNotes' in clean.records[0], false);
  assert.equal('receiptPhoto' in clean.ledgerHistory[0], false);
  assert.equal(clean.records[0].equipmentType, null);
});

test('Yield drafts must use an eligible type for the selected Record', () => {
  assert.throws(() => validateCellarerDraft({ kind: 'yield', recordId: 'daisy', yieldType: 'eggs', quantity: 2 }, context), /not available/);
  const draft = validateCellarerDraft({ kind: 'yield', recordId: 'daisy', yieldType: 'milk', quantity: 1.5, unit: 'gal' }, context);
  assert.equal(draft.quantity, 1.5);
});

test('unknown local references and incomplete drafts are rejected', () => {
  assert.throws(() => validateCellarerDraft({ kind: 'ledger', title: 'Feed', amount: 20, recordId: 'unknown' }, context), /not available/);
  assert.throws(() => validateCellarerDraft({ kind: 'calendar_event', title: 'Vet visit' }, context), /start date/);
});

test('Assisted Entry uses existing forms and always marks the result as a reviewable draft', () => {
  assert.match(html, /id="cellarerDialog"/);
  assert.equal((html.match(/id="cellarerDeskToggle"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-cellarer-kind=|Draft with Cyril/);
  assert.match(html, /id="cellarerDesk"[^>]*hidden/);
  assert.match(html, /id="cellarerPrepare"/);
  assert.match(html, /id="cellarerConsult"/);
  assert.doesNotMatch(html, /Ask About the Homestead|Consult Cyril <small>Coming later/);
  assert.match(html, /Cyril will determine where it belongs/);
  assert.match(client, /kind\.value = 'auto'/);
  assert.match(client, /toggle\.setAttribute\('aria-expanded', 'true'\)/);
  assert.match(client, /event\.key === 'Escape'/);
  assert.match(app, /function openCellarerDraft\(draft\)/);
  assert.match(app, /openModal\('task'/);
  assert.match(app, /openModal\('yield'/);
  assert.match(app, /openModal\('ledger'/);
  assert.match(app, /openModal\('document'/);
  assert.match(app, /openModal\('event'/);
  assert.match(app, /openModal\('calendar'/);
  assert.match(app, /setModalDraftValue\('value', draft\.eventValue\)/);
  assert.match(app, /\['recurrenceUntil', draft\.recurrenceUntil\]/);
  assert.ok(CELLARER_DRAFT_SCHEMA.required.includes('eventValue'));
  assert.ok(CELLARER_DRAFT_SCHEMA.required.includes('recurrenceUntil'));
  assert.match(app, /Review and adjust this entry before recording it/);
  assert.match(styles, /\.cellarer-draft-notice/);
});

test('server endpoint verifies Supabase access, consumes Premium quota, and uses structured output', () => {
  const userCheck = fn.indexOf("supabaseRequest('/auth/v1/user'");
  const quotaCheck = fn.indexOf("consume_premium_feature");
  const aiCall = fn.indexOf("/responses");
  assert.ok(userCheck >= 0 && quotaCheck > userCheck && aiCall > quotaCheck);
  assert.match(fn, /model: 'gpt-5\.6-luna'/);
  assert.match(fn, /store: false/);
  assert.match(fn, /type: 'json_schema'/);
  assert.match(fn, /windowLimit: 10/);
  assert.match(fn, /Netlify\.env\.get\('OPENAI_BASE_URL'\)/);
});

test('server endpoint refuses unauthenticated and non-Premium requests before AI inference', async () => {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  const calls = [];
  globalThis.Netlify = { env: { get: name => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'publishable' }[name]) } };
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: 'user' });
    return Response.json([{ allowed: false, remaining: 0, reason: 'premium_required' }]);
  };
  try {
    const unauthenticated = await cellarerHandler(new Request('https://example.test/api/cyril/assisted-entry', { method: 'POST', body: '{}' }));
    assert.equal(unauthenticated.status, 401);
    assert.equal(calls.length, 0);
    const free = await cellarerHandler(new Request('https://example.test/api/cyril/assisted-entry', {
      method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Add a task', context })
    }));
    assert.equal(free.status, 403);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].endsWith('/rest/v1/rpc/consume_premium_feature'));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  }
});

test('server endpoint returns a validated draft and never writes the entry itself', async () => {
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
    if (String(url).includes('consume_premium_feature')) return Response.json([{ allowed: true, remaining: 99, reason: 'allowed' }]);
    return Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ kind: 'task', title: 'Check Daisy', recordId: 'daisy' }) }] }] });
  };
  try {
    const response = await cellarerHandler(new Request('https://example.test/api/cyril/assisted-entry', {
      method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Check Daisy tomorrow', preferredKind: 'task', context })
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.draft.kind, 'task');
    assert.equal(body.draft.recordId, 'daisy');
    assert.equal(calls.length, 3);
    const aiPayload = JSON.parse(calls[2].options.body);
    assert.equal(aiPayload.store, false);
    assert.equal(aiPayload.text.format.strict, true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  }
});

test('server links an unambiguous Record Event even when AI leaves recordId blank', async () => {
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
      kind: 'record_event', recordId: null, recordEventType: 'Weighed', date: '2026-09-22',
      description: 'Weighed Daisy', eventValue: '500', eventUnit: 'lb'
    }) });
  };
  try {
    const response = await cellarerHandler(new Request('https://example.test/api/cyril/assisted-entry', {
      method: 'POST', headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ prompt: 'Weighed Daisy at 500 lb', context })
    }));
    const { draft } = await response.json();
    assert.equal(response.status, 200);
    assert.equal(draft.recordId, 'daisy');
    assert.equal(draft.eventValue, '500');
    assert.equal(draft.eventUnit, 'lb');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  }
});

test('daily quota is private, atomic, Homestead-scoped, and cached assets are versioned', () => {
  assert.match(migration, /create table private\.premium_feature_usage/);
  assert.match(migration, /primary key \(homestead_id, feature_key, window_started_at\)/);
  assert.match(migration, /on conflict on constraint premium_feature_usage_pkey/);
  assert.match(migration, /public\.has_premium_feature\(normalized_feature\)/);
  assert.match(migration, /revoke all on table private\.premium_feature_usage from public, anon, authenticated/);
  assert.match(worker, /regula-rustica-account-cloud-dialogs-v1/);
  assert.match(worker, /cellarer-assisted-entry\.mjs\?v=cyril-consult-v1/);
});
