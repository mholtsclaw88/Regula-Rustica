import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { sanitizeConsultContext, validateConsultAnswer } from '../cellarer-consult.mjs';
import consultHandler, { consultInstructions, config } from '../netlify/functions/cyril-consult.mts';

const [html, client, app, worker] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../cellarer-consult.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../service-worker.js', import.meta.url), 'utf8')
]);
const context = { today: '2026-09-24', timezone: 'America/New_York', sections: {
  records: [{ id: 'daisy', name: 'Daisy', type: 'Animal', status: 'Active', photoBytes: 'secret' }],
  yield: [{ type: 'milk', recordId: 'daisy', occurredAt: '2026-09-24T06:00', quantity: 2, unit: 'gal' }]
}, coverage: { records: 1, yield: 1 } };
const request = body => new Request('https://example.test/api/cyril/consult', {
  method: 'POST', headers: { Authorization: 'Bearer test-token' }, body: JSON.stringify(body)
});

test('Consult Cyril is one question and one replaceable answer, not a chat', () => {
  assert.equal((html.match(/id="cellarerConsult"/g) || []).length, 1);
  assert.match(html, /id="cellarerConsultDialog"/);
  assert.doesNotMatch(html, /Ask About the Homestead|Consult Cyril <small>Coming later/);
  assert.match(client, /question\.value\.trim\(\)/);
  assert.match(client, /answerText\.textContent = responseText\.answer/);
  assert.match(client, /answer\.hidden = true/);
  assert.doesNotMatch(client, /previous_response_id|conversationId|chatHistory/);
  assert.match(app, /function cellarerConsultContext\(\)/);
  assert.match(worker, /cellarer-consult\.mjs\?v=cyril-copy-v1/);
  assert.equal(config.path, '/api/cyril/consult');
});

test('only allowlisted bounded Homestead facts reach Cyril', () => {
  const clean = sanitizeConsultContext(context);
  assert.equal(clean.sections.records[0].name, 'Daisy');
  assert.equal('photoBytes' in clean.sections.records[0], false);
  assert.equal(clean.sections.yield[0].quantity, 2);
  assert.match(consultInstructions(clean), /snapshot can be limited/);
  assert.equal(validateConsultAnswer({ answer: 'Two gallons.', caveat: '' }).answer, 'Two gallons.');
  assert.throws(() => validateConsultAnswer({ answer: '' }), /empty answer/);
});

test('Consult requires Cloud identity and distinct Premium allowance before AI', async () => {
  const unauthenticated = await consultHandler(new Request('https://example.test/api/cyril/consult', { method: 'POST', body: '{}' }));
  assert.equal(unauthenticated.status, 401);
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
    const response = await consultHandler(request({ question: 'How much milk?', context }));
    assert.equal(response.status, 403);
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[1].options.body).feature_key, 'cellarer_ask_farm_book');
  } finally { globalThis.fetch = originalFetch; globalThis.Netlify = originalNetlify; }
});

test('each question is a fresh read-only request and returns one answer', async () => {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  const calls = [];
  globalThis.Netlify = { env: { get: name => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'publishable',
    OPENAI_BASE_URL: 'https://gateway.example/v1', OPENAI_API_KEY: 'gateway-key' }[name]) } };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: 'user' });
    if (String(url).includes('consume_premium_feature')) return Response.json([{ allowed: true, remaining: 9 }]);
    return Response.json({ output_text: JSON.stringify({ answer: 'Daisy produced 2 gal of milk today.', caveat: '' }) });
  };
  try {
    for (const question of ['How much milk?', 'How much did Daisy produce today?']) {
      const response = await consultHandler(request({ question, context }));
      assert.equal(response.status, 200);
      assert.match((await response.json()).answer, /2 gal/);
    }
    assert.equal(calls.length, 6);
    const ai = JSON.parse(calls[2].options.body);
    assert.equal(ai.store, false);
    assert.equal(ai.input.length, 2);
    assert.equal(ai.input[1].content, 'How much milk?');
    assert.equal(ai.text.format.strict, true);
    assert.ok(calls.every(call => !call.url.includes('/rest/v1/ledger_entries')));
  } finally { globalThis.fetch = originalFetch; globalThis.Netlify = originalNetlify; }
});
