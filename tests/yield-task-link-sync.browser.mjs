import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), root = new URL('../', import.meta.url);
const engine = process.env.STORAGE_TEST_BROWSER || 'chromium';
const directory = process.env.YIELD_SYNC_SCREENSHOTS, screenshots = [];
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/cloud-runtime-config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('window.REGULA_RUSTICA_CLOUD_CONFIG={};'); return; }
  try { const file = new URL(`.${path === '/' ? '/index.html' : path}`, root); if (!file.href.startsWith(root.href)) throw Error('Invalid path'); const content = await readFile(file); res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[extname(file.pathname)] || 'application/octet-stream' }); res.end(content); } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
async function ready(page) { await page.waitForFunction(() => window.RegulaRusticaLocal && window.RegulaRusticaSync && !document.querySelector('.device-storage-startup')); }
async function capture(page, state) {
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('#syncNow').scrollIntoViewIfNeeded();
    const path = `${directory}/${engine}-${state}-${width}.png`; await page.screenshot({ path });
    const ui = await page.evaluate(() => { const el = document.querySelector('#syncNow'), r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { status: window.RegulaRusticaSync.getStatus(), dialog: document.querySelector('#accountCloudDeviceDetails').getBoundingClientRect().toJSON(), button: r.toJSON(), hit: hit === el || el.contains(hit), overflow: document.documentElement.scrollWidth > innerWidth }; });
    assert.ok(ui.hit && !ui.overflow); screenshots.push({ path, state, width, ui });
  }
}
try {
  browser = await require('playwright')[engine].launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => { if (sessionStorage.getItem('synthetic-seeded')) return; sessionStorage.setItem('synthetic-seeded', 'yes'); localStorage.setItem('regulaRusticaV5', JSON.stringify({ schemaVersion: 14, settings: { homesteadName: 'Synthetic Test Homestead', onboarding: { version: 1, completed: true, step: 8 } }, records: [], tasks: [], people: [], documents: [], attachments: [], events: [], notes: [], ledger: [], ledgerAllocations: [], relationships: [], assignments: [], calendarEvents: [], yieldEntries: [], choreWindows: [] })); });
  await page.goto(url); await ready(page);
  const original = await page.evaluate(async () => {
    const { LocalSyncState } = await import('/sync/local-state.mjs'); const { toCloud, DOMAIN_ORDER, COLLECTIONS } = await import('/sync/entities.mjs');
    const stamp = '2026-10-01T12:00:00.000Z', recordId = crypto.randomUUID(), taskId = crypto.randomUUID();
    const data = window.RegulaRusticaLocal.read();
    data.records = [{ id: recordId, name: 'Synthetic Dairy Cow', type: 'Animal', status: 'Active', identity: { species: 'Cattle', purpose: 'Dairy' }, stewardship: {}, createdAt: stamp, updatedAt: stamp }];
    data.tasks = [{ id: taskId, recordId, title: 'Synthetic morning milking', status: 'completed', completed: true, completedAt: stamp, dueDate: '2026-10-01', yieldType: 'milk', createdAt: stamp, updatedAt: stamp }];
    data.yieldEntries = [{ id: crypto.randomUUID(), recordId, taskId, type: 'milk', session: 'morning', occurredAt: stamp, quantity: 2, unit: 'gal', details: 'Synthetic production', createdAt: stamp, updatedAt: stamp }];
    await window.RegulaRusticaLocal.write(data, 'sync');
    const normalized = window.RegulaRusticaLocal.read(), state = new LocalSyncState(window.RegulaRusticaStorage);
    state.bind(crypto.randomUUID()); state.state.initialSyncCompleted = true;
    for (const table of DOMAIN_ORDER) for (const row of normalized[COLLECTIONS[table]] || []) { const entity = state.entity(table, row.id); entity.cloudVersion = 1; entity.cloudRow = { ...toCloud(table, row, state), homestead_id: state.state.homesteadId, version: 1, created_at: row.createdAt, updated_at: row.updatedAt, deleted_at: row.deletedAt || null }; }
    const entry = normalized.yieldEntries[0], op = state.enqueue({ table: 'yield_entries', localId: entry.id, type: 'create', payload: toCloud('yield_entries', entry, state) });
    state.fail(op, Object.assign(new Error('Task belongs to another Homestead'), { code: '23503' }));
    const entity = state.entity('tasks', taskId); entity.cloudId = crypto.randomUUID(); entity.cloudRow.id = entity.cloudId;
    state.save(); await state.flush();
    return { operation: op, canonical: entity.cloudId, localTaskId: taskId, homestead: state.state.homesteadId };
  });
  await page.reload(); await ready(page);
  assert.equal(await page.evaluate(() => JSON.parse(window.RegulaRusticaStorage.getItem('regulaRusticaSyncV1')).outbox[0].lastErrorCode), '23503');
  await page.evaluate(original => {
    window.yieldFixture = { calls: [] };
    const client = {
      from() { const query = { select() { return this; }, eq() { return this; }, is() { return this; }, or() { return this; }, order() { return this; }, limit() { return this; }, then(resolve, reject) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve, reject); } }; return query; },
      async rpc(name, args) {
        window.yieldFixture.calls.push({ name, args });
        if (name !== 'apply_housekeeping_sync_operation' || args.target_table !== 'yield_entries') throw Error('Unexpected synthetic cloud mutation');
        const durable = (await window.RegulaRusticaStorage.backend.readAll()).get('regulaRusticaSyncV1');
        const op = JSON.parse(durable).outbox.find(item => item.rowId === args.target_id);
        if (op.idempotencyKey !== args.operation_key || op.payload.details.task_id !== original.canonical) throw Error('Repair was not durably committed');
        return { data: { status: 'applied', row: { ...args.operation_payload, id: args.target_id, homestead_id: original.homestead, version: 1 } }, error: null };
      }
    };
    const context = { client, session: { access_token: 'synthetic-session', user: { id: 'synthetic-user' } }, homesteadId: original.homestead, role: 'steward', homesteadIdentity: { name: 'Synthetic Test Homestead' }, premium: { plan_key: 'premium', status: 'active', ends_at: null } };
    window.REGULA_RUSTICA_CLOUD_CONTEXT = context; window.dispatchEvent(new CustomEvent('regula-rustica:cloud-context', { detail: context }));
  }, original);
  await page.locator('button[data-view=settings]:visible').click(); await page.locator('[data-settings-category=cloud]').click(); await page.locator('[data-account-cloud-open=accountCloudDeviceDetails]').click();
  await page.locator('#syncNow').waitFor({ state: 'visible' }); await page.waitForFunction(() => !document.querySelector('#syncNow').disabled && document.querySelector('#syncConflicts').textContent.includes('23503'));
  assert.match(await page.locator('#syncConflicts').textContent(), /Yield create could not sync/); await capture(page, 'blocked');
  await page.locator('#syncNow').click(); await page.waitForFunction(() => window.RegulaRusticaSync.getStatus().label === 'Synced');
  assert.equal(await page.locator('#syncConflicts').textContent(), ''); await capture(page, 'synced');
  const after = await page.evaluate(async () => ({ state: JSON.parse((await window.RegulaRusticaStorage.backend.readAll()).get('regulaRusticaSyncV1')), local: window.RegulaRusticaLocal.read(), calls: window.yieldFixture.calls }));
  assert.equal(after.state.outbox.length, 0); assert.equal(after.calls.length, 1);
  const sent = after.calls[0].args; assert.notEqual(sent.operation_key, original.operation.idempotencyKey); assert.equal(sent.target_id, original.operation.rowId);
  const expected = structuredClone(original.operation.payload); expected.task_id = original.canonical; expected.details.task_id = original.canonical;
  assert.deepEqual(sent.operation_payload, expected); assert.equal(after.local.yieldEntries[0].taskId, original.localTaskId);
  await page.reload(); await ready(page); assert.equal(await page.evaluate(() => JSON.parse(window.RegulaRusticaStorage.getItem('regulaRusticaSyncV1')).outbox.length), 0);
  assert.deepEqual(errors, []);
  if (directory) await writeFile(`${directory}/${engine}-manifest.json`, JSON.stringify(screenshots, null, 2));
  console.log(`PASS ${engine}: native IndexedDB blocked Yield reload, manual narrow repair, durable changed key before RPC, Synced and second reload; ${screenshots.length} viewport captures`);
  await context.close();
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
