// Run with: npm install --no-save --package-lock=false playwright@1.58.2
//           npx playwright install chromium && npm run test:browser
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const engines = require('playwright');
const engineName = process.env.STORAGE_TEST_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engineName));
const root = new URL('../', import.meta.url);
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  try {
    const file = new URL(`.${pathname === '/' ? '/index.html' : pathname}`, root);
    if (!file.href.startsWith(root.href)) throw new Error('Invalid path');
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file.pathname)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(content);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;

async function pageWithFixture({ failMigration = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(({ failMigration }) => {
    if (sessionStorage.getItem('fixture-seeded')) return;
    sessionStorage.setItem('fixture-seeded', 'yes');
    const stamp = '2026-10-14T16:00:00.000Z';
    const main = {
      schemaVersion: 14,
      settings: { homesteadName: 'Storage regression', onboarding: { version: 1, completed: true, step: 8 } },
      records: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Maple', type: 'Animal', status: 'Active', identity: { species: 'Cattle', purpose: 'Dairy', managedAs: 'Individual' }, stewardship: {}, createdAt: stamp, updatedAt: stamp }],
      tasks: [], people: [], documents: [], attachments: [], events: [], notes: [], ledger: [], ledgerAllocations: [], relationships: [], assignments: [], calendarEvents: [], yieldEntries: [], choreWindows: [],
      legacy: { receiptPhotos: { preserved: { dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(350_000) } } }
    };
    const raw = JSON.stringify(main);
    const backups = JSON.stringify([{ id: 'preserved-backup', reason: 'before-device-cloud-recovery', data: main }]);
    const sync = {
      schemaVersion: 1, deviceId: '00000000-0000-4000-8000-000000000002', enabled: true,
      homesteadId: '00000000-0000-4000-8000-000000000003', initialSyncCompleted: false,
      outbox: [{ id: 'preserved-operation', idempotencyKey: 'same-idempotency', table: 'ledger_entries', type: 'create', localId: 'waiting', rowId: '00000000-0000-4000-8000-000000000004', payload: { description: 'Preserved pending entry', amount: 3 }, status: 'pending' }],
      conflicts: [], entities: {}, cursors: {}, failedOperations: [], legacyRecoveryVersion: 2
    };
    localStorage.setItem('regulaRusticaV5', raw);
    localStorage.setItem('regulaRusticaSyncBackupsV1', backups);
    localStorage.setItem('regulaRusticaSyncV1', JSON.stringify(sync));
    localStorage.setItem('regression-account-session', 'preserved-session');
    let padding = '';
    try { while (true) { padding += 'p'.repeat(100_000); localStorage.setItem('unrelated-quota-pressure', padding); } } catch {}
    try {
      localStorage.setItem('regulaRusticaV5', raw + ' '.repeat(250_000));
      sessionStorage.setItem('quota-reproduced', 'no');
    } catch (error) { sessionStorage.setItem('quota-reproduced', error.name); }
    if (failMigration) {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const request = original.apply(this, args);
        if (this.transaction.db.name === 'regulaRusticaDeviceV1') this.transaction.abort();
        return request;
      };
    }
  }, { failMigration });
  const page = await context.newPage();
  return { context, page };
}

async function ready(page) {
  await page.waitForFunction(() => window.RegulaRustica && window.RegulaRusticaSync && !document.querySelector('.device-storage-startup'), undefined, { timeout: 15_000 });
}

try {
  browser = await engines[engineName].launch({ headless: true });
  console.log(`Testing ${engineName}`);
  const { context, page } = await pageWithFixture();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await ready(page);
  const migrated = await page.evaluate(() => ({
    reproduced: sessionStorage.getItem('quota-reproduced'),
    name: window.RegulaRusticaLocal.read().records[0].name,
    originalKey: localStorage.getItem('regulaRusticaV5'),
    session: localStorage.getItem('regression-account-session'),
    backup: JSON.parse(window.RegulaRusticaStorage.getItem('regulaRusticaSyncBackupsV1'))[0].id,
    sync: JSON.parse(window.RegulaRusticaStorage.getItem('regulaRusticaSyncV1'))
  }));
  assert.equal(migrated.reproduced, 'QuotaExceededError');
  assert.equal(migrated.name, 'Maple');
  assert.equal(migrated.originalKey, null);
  assert.equal(migrated.session, 'preserved-session');
  assert.equal(migrated.backup, 'preserved-backup');
  assert.equal(migrated.sync.deviceId, '00000000-0000-4000-8000-000000000002');
  assert.equal(migrated.sync.outbox[0].idempotencyKey, 'same-idempotency');
  console.log('PASS native browser quota reproduced; records, backup, device identity, queue, and session preserved');

  await page.evaluate(async () => {
    const data = window.RegulaRusticaLocal.read();
    data.legacy.receiptPhotos.large = { dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(6 * 1024 * 1024) };
    await window.RegulaRusticaLocal.write(data, 'browser-regression');
    await window.RegulaRusticaStorage.flush();
  });
  await page.reload(); await ready(page);
  assert.ok(await page.evaluate(() => window.RegulaRusticaLocal.read().legacy.receiptPhotos.large.dataUrl.length > 6 * 1024 * 1024));
  console.log('PASS a working copy larger than the entire localStorage quota saves and reloads');

  await page.waitForFunction(() => window.RegulaRusticaReceipts && window.RegulaRusticaLedgerAllocations?.applyDraft);
  await page.evaluate(() => window.openModal('ledger'));
  await page.locator('#modalForm [name="description"]').fill('Browser regression ledger entry');
  await page.locator('#modalForm [name="amount"]').fill('3.50');
  await page.evaluate(() => {
    const storage = window.RegulaRusticaStorage;
    const commit = storage.backend.commit.bind(storage.backend);
    storage.backend.commit = async batch => {
      await new Promise(resolve => { window.releaseLedgerSave = resolve; });
      storage.backend.commit = commit;
      await commit(batch);
    };
    document.querySelector('#modalForm').requestSubmit();
    document.querySelector('#modalForm').requestSubmit();
  });
  await page.waitForFunction(() => typeof window.releaseLedgerSave === 'function');
  assert.ok(!(await page.locator('#modalSubmit').isEnabled()));
  await page.evaluate(() => window.releaseLedgerSave());
  await page.waitForFunction(() => !document.querySelector('#modal').open);
  await page.evaluate(() => window.RegulaRusticaStorage.flush());
  assert.equal(await page.evaluate(() => window.RegulaRusticaLocal.read().ledger.filter(entry => entry.description === 'Browser regression ledger entry').length), 1);
  console.log('PASS repeated Ledger submissions during persistence save only one entry');

  await page.evaluate(() => {
    const storage = window.RegulaRusticaStorage;
    window.restoreLedgerCommit = storage.backend.commit.bind(storage.backend);
    storage.backend.commit = async () => { throw new Error('simulated Ledger disk full'); };
    window.openModal('ledger');
  });
  await page.locator('#modalForm [name="description"]').fill('Retried Ledger entry');
  await page.locator('#modalForm [name="amount"]').fill('7');
  await page.locator('#modalSubmit').click();
  await page.waitForFunction(() => document.querySelector('.device-storage-error') && document.querySelector('#modalForm').dataset.saving === 'false');
  await page.evaluate(() => { window.RegulaRusticaStorage.backend.commit = window.restoreLedgerCommit; });
  await page.locator('#modalSubmit').click();
  await page.waitForFunction(() => !document.querySelector('#modal').open);
  await page.evaluate(() => window.RegulaRusticaStorage.flush());
  assert.equal(await page.evaluate(() => window.RegulaRusticaLocal.read().ledger.filter(entry => entry.description === 'Retried Ledger entry').length), 1);
  console.log('PASS retrying a failed Ledger form preserves its draft identity without duplication');

  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload(); await ready(page);
  assert.equal(await page.evaluate(() => window.RegulaRusticaLocal.read().records[0].name), 'Maple');
  assert.equal(await page.evaluate(() => window.RegulaRusticaLocal.read().ledger.length), 2);
  console.log('PASS offline reload hydrates the saved Farm Book and all new bootstrap modules');
  await context.setOffline(false);

  await page.evaluate(async () => {
    const storage = window.RegulaRusticaStorage;
    window.restoreDeviceCommit = storage.backend.commit.bind(storage.backend);
    storage.backend.commit = async () => { throw new Error('simulated disk full'); };
    const data = window.RegulaRusticaLocal.read();
    data.settings.homesteadName = 'Uncommitted edit';
    try { await window.RegulaRusticaLocal.write(data); } catch {}
  });
  assert.ok(await page.locator('.device-storage-error').isVisible());
  assert.notEqual(await page.evaluate(async () => JSON.parse((await window.RegulaRusticaStorage.backend.readAll()).get('regulaRusticaV5')).settings.homesteadName), 'Uncommitted edit');
  await page.evaluate(() => { window.RegulaRusticaStorage.backend.commit = window.restoreDeviceCommit; });
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await page.locator('.device-storage-error').waitFor({ state: 'detached' });
  await page.reload(); await ready(page);
  assert.equal(await page.evaluate(() => window.RegulaRusticaLocal.read().settings.homesteadName), 'Uncommitted edit');
  assert.deepEqual(errors, []);
  console.log('PASS failed saves retain the committed copy, show a visible notice, and retry without losing the edit');
  await context.close();

  const failed = await pageWithFixture({ failMigration: true });
  await failed.page.goto(url);
  await failed.page.locator('.device-storage-startup[role="alert"]').waitFor();
  assert.equal(await failed.page.evaluate(() => JSON.parse(localStorage.getItem('regulaRusticaV5')).records[0].name), 'Maple');
  assert.equal(await failed.page.evaluate(() => typeof window.RegulaRustica), 'undefined');
  console.log('PASS an aborted native IndexedDB migration keeps the original copy and blocks an empty startup');
  await failed.context.close();

  const blank = await browser.newContext(); const newPage = await blank.newPage();
  await newPage.goto(url); await ready(newPage);
  assert.equal(await newPage.evaluate(() => window.RegulaRusticaLocal.read().records.length), 0);
  assert.equal(await newPage.evaluate(() => window.RegulaRusticaLocal.read().settings.onboarding.completed), false);
  assert.ok(await newPage.locator('#onboarding').isVisible());
  console.log('PASS a truly new device still opens the empty onboarding flow');
  await blank.close();
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
