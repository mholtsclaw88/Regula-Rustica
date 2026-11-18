// Run with: npm install --no-save --package-lock=false playwright@1.58.2
//           npx playwright install chromium && npm run test:browser
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { createRequire } from 'node:module';
import { waitForControlledWorker } from './helpers/controlled-worker.mjs';

const require = createRequire(import.meta.url);
const engines = require('playwright');
const engineName = process.env.STORAGE_TEST_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engineName));
const root = new URL('../', import.meta.url);
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/cloud-runtime-config.js') {
    // Netlify generates this asset on every deploy. Keep the browser fixture
    // complete and offline-cacheable, without connecting to a real backend.
    response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' });
    response.end('window.REGULA_RUSTICA_CLOUD_CONFIG = {};');
    return;
  }
  try {
    const file = new URL(`.${pathname === '/' ? '/index.html' : pathname}`, root);
    if (!file.href.startsWith(root.href)) throw new Error('Invalid path');
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file.pathname)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(content);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}`;
let browser;
const screenshotDirectory = process.env.STORAGE_TEST_SCREENSHOTS;
const screenshots = [];
async function captureLedger(page, state) {
  if (!screenshotDirectory) return;
  await mkdir(screenshotDirectory, { recursive: true });
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const path = `${screenshotDirectory}/${state}-${width}.png`;
    await page.screenshot({ path });
    screenshots.push({ path, state, width, ui: await page.evaluate(() => ({
      modalOpen: document.querySelector('#modal').open,
      focusedField: document.activeElement.name || document.activeElement.id,
      saveError: document.querySelector('.device-storage-error')?.textContent || '',
      inlineError: document.querySelector('#modalSaveError')?.textContent || '',
      inlineErrorBounds: document.querySelector('#modalSaveError')?.getBoundingClientRect().toJSON(),
      formMode: document.querySelector('#modalForm').dataset.formMode,
      formValues: Object.fromEntries(new FormData(document.querySelector('#modalForm'))),
      ledger: window.RegulaRusticaLocal.read().ledger.map(({ description, amount }) => ({ description, amount }))
    })) });
  }
  await writeFile(`${screenshotDirectory}/manifest.json`, JSON.stringify(screenshots, null, 2));
  await page.setViewportSize({ width: 390, height: 844 });
}

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

async function reportWorkerControlFailure(page, label) {
  try {
    const state = await page.evaluate(async () => {
      const worker = value => value ? { state: value.state, scriptURL: value.scriptURL } : null;
      const details = Promise.all([navigator.serviceWorker.getRegistrations(), caches.keys()]).then(([registrations, cacheKeys]) => ({
        url: location.href, visibility: document.visibilityState, focused: document.hasFocus(),
        controller: worker(navigator.serviceWorker.controller), cacheKeys,
        registrations: registrations.map(value => ({ scope: value.scope, active: worker(value.active), waiting: worker(value.waiting), installing: worker(value.installing) }))
      }));
      let timer;
      try { return await Promise.race([details, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Worker diagnostics timed out')), 5000); })]); }
      finally { clearTimeout(timer); }
    });
    console.error('SERVICE_WORKER_CONTROL_TIMEOUT', JSON.stringify({ label, ...state }));
  } catch (error) { console.error('SERVICE_WORKER_CONTROL_DIAGNOSTICS_FAILED', label, error.message); }
}

async function prepareControlledWorker(page) {
  try {
    await waitForControlledWorker(page);
  } catch (error) { await reportWorkerControlFailure(page, 'before-large-copy-reload'); throw error; }
}

// Keep the original keyboard gate; emit only control/lifecycle metadata on failure.
async function startKeyboardDiagnostic(page) {
  await page.evaluate(() => {
    const events = [];
    const identify = node => node?.id || node?.getAttribute?.('name') || node?.tagName || null;
    const record = event => {
      const row = { type: event.type, key: event.key, shift: event.shiftKey,
        target: identify(event.target), active: identify(document.activeElement),
        hasFocus: document.hasFocus(), visibility: document.visibilityState };
      events.push(row);
      if (events.length > 100) events.shift();
      queueMicrotask(() => { row.defaultPrevented = event.defaultPrevented; });
    };
    const types = ['keydown', 'keyup', 'focusin', 'focusout'];
    for (const type of types) document.addEventListener(type, record, true);
    window.storageKeyboardDiagnostic = { events, stop: () => {
      for (const type of types) document.removeEventListener(type, record, true);
    } };
  });
}
async function keyboardDiagnosticSnapshot(page) {
  return page.evaluate(() => {
    const identify = node => node?.id || node?.getAttribute?.('name') || node?.tagName || null;
    const controls = [...document.querySelectorAll('#modal button, #modal input, #modal select, #modal textarea, #modal [tabindex]')]
      .map(node => ({ target: identify(node), disabled: node.matches(':disabled'), tabIndex: node.tabIndex,
        visible: Boolean(node.getClientRects().length), bounds: node.getBoundingClientRect().toJSON() }));
    return { platform: navigator.platform, userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight }, active: identify(document.activeElement),
      hasFocus: document.hasFocus(), visibility: document.visibilityState,
      modal: document.querySelector('#modal').matches(':modal'),
      saving: document.querySelector('#modalForm').dataset.saving, controls,
      events: window.storageKeyboardDiagnostic.events };
  });
}
async function stopKeyboardDiagnostic(page) {
  await page.evaluate(() => { window.storageKeyboardDiagnostic?.stop(); delete window.storageKeyboardDiagnostic; });
}

async function nativeKeyboardControlProbe(page) {
  const control = await page.context().newPage();
  try {
    await control.setViewportSize(page.viewportSize());
    await control.setContent('<dialog id="modal"><form id="modalForm" data-saving="false"><input name="controlInput"><button type="button" id="modalCancel">Cancel</button><button type="button" id="modalSubmit">Save</button></form></dialog>');
    await control.locator('#modal').evaluate(node => node.showModal());
    await startKeyboardDiagnostic(control);
    await control.locator('#modalSubmit').focus();
    await control.keyboard.press('Shift+Tab');
    console.error('STORAGE_KEYBOARD_NATIVE_CONTROL', JSON.stringify(await keyboardDiagnosticSnapshot(control)));
  } finally { await control.close(); }
}

async function ready(page) {
  await page.waitForFunction(() => window.RegulaRustica && window.RegulaRusticaSync && !document.querySelector('.device-storage-startup'), undefined, { timeout: 15_000 });
}

async function recoveryUiReady(page) {
  // Recovery updates its in-memory state before the final durable flush and
  // status render. Wait for the user-facing overview, not that intermediate state.
  await page.waitForFunction(() => window.RegulaRusticaSync.getStatus().label === 'Synced'
    && document.querySelector('#accountCloudPremiumState').textContent === 'Active'
    && document.querySelector('#accountCloudDeviceState').textContent === 'Synced'
    && document.querySelector('#accountCloudNextTitle').textContent === 'Your Homestead is in step'
    && document.querySelector('#accountCloudNextAction').textContent === ''
    && document.querySelector('#accountCloudNextAction').classList.contains('hidden'));
}

const recoveryScreenshots = [];
async function captureRecovery(page, state) {
  const directory = process.env.RECOVERY_TEST_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.locator('button[data-view=settings]:visible').click();
  await page.locator('[data-settings-category=cloud]').click();
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('#accountCloudNext').scrollIntoViewIfNeeded();
    const ui = await page.evaluate(() => ({
      premium: document.querySelector('#accountCloudPremiumState').textContent,
      device: document.querySelector('#accountCloudDeviceState').textContent,
      title: document.querySelector('#accountCloudNextTitle').textContent,
      action: document.querySelector('#accountCloudNextAction').textContent,
      sync: window.RegulaRusticaSync.getStatus(),
      writes: window.recoveryFixture.writes
    }));
    for (const fullPage of [false, true]) {
      const path = `${directory}/${state}-${width}-${fullPage ? 'full' : 'viewport'}.png`;
      await page.screenshot({ path, fullPage });
      recoveryScreenshots.push({ path, state, width, fullPage, ui });
    }
  }
  await writeFile(`${directory}/manifest.json`, JSON.stringify(recoveryScreenshots, null, 2));
  await page.setViewportSize({ width: 390, height: 844 });
}

async function recoveryFixture({ pending = false } = {}) {
  const fixture = await pageWithFixture();
  await fixture.page.goto(url); await ready(fixture.page);
  await fixture.page.evaluate(async pending => {
    const storage = window.RegulaRusticaStorage;
    const state = JSON.parse(storage.getItem('regulaRusticaSyncV1'));
    await storage.setItem('regulaRusticaSyncBackupsV1', JSON.stringify([{ id: 'preserved-backup', reason: 'before-device-cloud-recovery', data: window.RegulaRusticaLocal.read() }]));
    state.outbox = [];
    state.initialSyncState = { case: 'device-cloud-recovery', status: 'failed', backupId: 'preserved-backup', error: "Failed to execute 'setItem' on 'Storage': setting regulaRusticaV5 exceeded the quota." };
    if (pending) {
      const data = window.RegulaRusticaLocal.read();
      data.records[0].name = 'Newer local Maple';
      await window.RegulaRusticaLocal.write(data, 'sync');
      state.outbox.push({ id: 'new-local-operation', idempotencyKey: 'new-local-key', homesteadId: state.homesteadId, deviceId: state.deviceId, table: 'records', type: 'update', localId: data.records[0].id, rowId: data.records[0].id, payload: { name: 'Newer local Maple' }, status: 'pending' });
    }
    await storage.setItem('regulaRusticaSyncV1', JSON.stringify(state));
    await storage.flush();
  }, pending);
  await fixture.page.reload(); await ready(fixture.page);
  return fixture;
}

async function connectFixtureCloud(page, { failDownload = false } = {}) {
  await page.evaluate(async failDownload => {
    const stamp = '2026-10-14T16:00:00.000Z';
    const rows = { records: [{ id: '00000000-0000-4000-8000-000000000011', version: 3, name: 'Cloud Maple', type: 'animal', status: 'Active', identity: { species: 'Cattle', purpose: 'Dairy', managedAs: 'Individual' }, stewardship: {}, created_at: stamp, updated_at: stamp, deleted_at: null }] };
    window.recoveryFixture = { writes: [], failDownload };
    const client = {
      from(table) {
        let head = false;
        const filters = [];
        const query = {
          select(fields, options) { head = options?.head; return this; },
          eq(key, value) { filters.push(row => row[key] === value); return this; },
          is(key, value) { filters.push(row => (row[key] ?? null) === value); return this; },
          or(value) {
            const match = value.match(/^updated_at\.gt\.(.*),and\(updated_at\.eq\..*,id\.gt\.(.*)\)$/);
            if (!match) throw new Error('Unexpected fixture cursor');
            filters.push(row => row.updated_at > match[1] || (row.updated_at === match[1] && row.id > match[2]));
            return this;
          },
          order() { return this; }, limit() { return this; },
          then(resolve, reject) {
            if (!head && table === 'records' && window.recoveryFixture.failDownload) {
              return Promise.resolve({ error: { message: 'Fixture cloud download interrupted', code: 'FETCH' } }).then(resolve, reject);
            }
            const data = (rows[table] || []).filter(row => filters.every(filter => filter(row)));
            return Promise.resolve({ data, count: data.length, error: null }).then(resolve, reject);
          }
        };
        return query;
      },
      async rpc(name, args) {
        window.recoveryFixture.writes.push({ name, args });
        throw new Error('Cloud recovery must never write to the cloud');
      }
    };
    window.REGULA_RUSTICA_CLOUD = { url: 'https://fixture.invalid', publishableKey: 'fixture-key' };
    const context = { client, session: { access_token: 'fixture-session', user: { id: 'fixture-user' } }, homesteadId: '00000000-0000-4000-8000-000000000003', role: 'steward', homesteadIdentity: { name: 'Recovery test Homestead' }, premium: { plan_key: 'premium', status: 'active', ends_at: null } };
    window.REGULA_RUSTICA_CLOUD_CONTEXT = context;
    window.dispatchEvent(new CustomEvent('regula-rustica:cloud-context', { detail: context }));
  }, failDownload);
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
  // Finish first installation/claim before testing durable reload. A navigation
  // started during installation can commit after claim with no controller.
  await prepareControlledWorker(page);
  await page.reload(); await ready(page);
  assert.ok(await page.evaluate(() => window.RegulaRusticaLocal.read().legacy.receiptPhotos.large.dataUrl.length > 6 * 1024 * 1024));
  console.log('PASS a working copy larger than the entire localStorage quota saves and reloads');

  await page.waitForFunction(() => window.RegulaRusticaReceipts && window.RegulaRusticaLedgerAllocations?.applyDraft);
  const focusedField = await page.evaluate(() => {
    // A user may choose another field before deferred modal callbacks run.
    // Drain callbacks explicitly to exercise that ordering without a sleep.
    const scheduled = [];
    const originalTimeout = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => {
      scheduled.push(() => callback(...args));
      return 0;
    };
    try {
      window.openModal('ledger');
      const amount = document.querySelector('#modalForm [name="amount"]');
      amount.focus();
      scheduled.forEach(callback => callback());
      return document.activeElement.name;
    } finally { window.setTimeout = originalTimeout; }
  });
  assert.equal(focusedField, 'amount', 'opening a form must not later steal focus from a field the user chose');
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
    window.failedLedgerCommits = 0;
    storage.backend.commit = async () => { window.failedLedgerCommits++; throw new Error('simulated Ledger disk full'); };
    window.openModal('ledger');
  });
  await page.locator('#modalForm [name="description"]').fill('Retried Ledger entry');
  await page.locator('#modalForm [name="amount"]').fill('7');
  assert.deepEqual(await page.evaluate(() => {
    const form = new FormData(document.querySelector('#modalForm'));
    return { description: form.get('description'), amount: form.get('amount') };
  }), { description: 'Retried Ledger entry', amount: '7' });
  await page.locator('#modalSubmit').click();
  await page.waitForFunction(() => document.querySelector('.device-storage-error') && document.querySelector('#modalForm').dataset.saving === 'false');
  assert.equal(await page.locator('#modalSaveError[role="alert"]').count(), 1);
  await page.locator('#modalSaveError').waitFor({ state: 'visible' });
  assert.match(await page.locator('#modalSaveError').textContent(), /Your draft is still here.*choose Save to try again/);
  const failedDraft = await page.evaluate(() => window.RegulaRusticaLocal.read().ledger.find(entry => entry.description === 'Retried Ledger entry'));
  assert.equal(failedDraft.amount, 7);
  assert.equal(await page.evaluate(async () => JSON.parse((await window.RegulaRusticaStorage.backend.readAll()).get('regulaRusticaV5')).ledger.filter(entry => entry.description === 'Retried Ledger entry').length), 0);
  await captureLedger(page, 'ledger-save-error');
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await page.locator('#modalSaveError').boundingBox();
    const save = await page.locator('#modalSubmit').boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 844);
    assert.ok(save && save.y >= bounds.y + bounds.height && save.height >= 44 && save.y + save.height <= 844);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await startKeyboardDiagnostic(page);
  try {
    await page.locator('#modalSubmit').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'modalCancel');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'modalSubmit');
  } catch (error) {
    try {
      console.error('STORAGE_KEYBOARD_FAILURE', JSON.stringify(await keyboardDiagnosticSnapshot(page)));
      // Observe whether native focus completes later, but always rethrow the original
      // assertion: this diagnostic cannot turn the failing gate into a pass.
      try {
        await page.waitForFunction(() => document.activeElement.id === 'modalCancel', undefined, { timeout: 2000 });
        console.error('STORAGE_KEYBOARD_LATE_CANCEL', JSON.stringify(await keyboardDiagnosticSnapshot(page)));
      } catch { console.error('STORAGE_KEYBOARD_NO_LATE_CANCEL'); }
      await nativeKeyboardControlProbe(page);
    } catch (diagnosticError) { console.error('STORAGE_KEYBOARD_DIAGNOSTIC_ERROR', diagnosticError.name); }
    throw error;
  } finally {
    try { await stopKeyboardDiagnostic(page); }
    catch (diagnosticError) { console.error('STORAGE_KEYBOARD_DIAGNOSTIC_CLEANUP_ERROR', diagnosticError.name); }
  }
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.failedLedgerCommits >= 2 && document.querySelector('#modalForm').dataset.saving === 'false');
  assert.ok(await page.locator('#modalSaveError').isVisible());
  assert.deepEqual(await page.evaluate(() => {
    const form = new FormData(document.querySelector('#modalForm'));
    return { description: form.get('description'), amount: form.get('amount') };
  }), { description: 'Retried Ledger entry', amount: '7' });
  assert.equal(await page.evaluate(() => window.RegulaRusticaLocal.read().ledger.find(entry => entry.description === 'Retried Ledger entry').id), failedDraft.id);
  await page.evaluate(() => { window.RegulaRusticaStorage.backend.commit = window.restoreLedgerCommit; });
  await page.locator('#modalCancel').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'modalSubmit');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#modal').open);
  await page.evaluate(() => window.RegulaRusticaStorage.flush());
  assert.equal(await page.evaluate(() => window.RegulaRusticaLocal.read().ledger.filter(entry => entry.description === 'Retried Ledger entry').length), 1);
  assert.equal(await page.locator('#modalSaveError').textContent(), '');
  assert.ok(!(await page.locator('#modalSaveError').isVisible()));
  await page.evaluate(() => window.openModal('ledger'));
  assert.ok(!(await page.locator('#modalSaveError').isVisible()));
  await page.locator('#modalCancel').click();
  console.log('PASS retrying a failed Ledger form preserves its draft identity without duplication');
  if (screenshotDirectory) {
    await page.evaluate(() => document.querySelector('.nav button[data-view="ledger"]').click());
    await page.getByText('Retried Ledger entry', { exact: true }).waitFor({ state: 'visible' });
    await captureLedger(page, 'ledger-retry-success');
  }

  try {
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller);
  } catch (error) { await reportWorkerControlFailure(page, 'before-offline-reload'); throw error; }
  // Playwright WebKit's offline flag rejects even literal service-worker
  // responses (microsoft/playwright#42775). Stop the origin instead so the
  // real network failure and the app's cache fallback are still exercised.
  if (engineName === 'webkit') await new Promise(resolve => server.close(resolve));
  else await context.setOffline(true);
  const offlineResponse = await page.reload(); await ready(page);
  assert.ok(offlineResponse.fromServiceWorker());
  assert.equal(await page.evaluate(() => window.RegulaRusticaLocal.read().records[0].name), 'Maple');
  assert.equal(await page.evaluate(() => window.RegulaRusticaLocal.read().ledger.length), 2);
  if (engineName === 'webkit') {
    const negative = await browser.newContext();
    const noWorker = await negative.newPage();
    await assert.rejects(noWorker.goto(url));
    await negative.close();
  }
  console.log('PASS offline reload hydrates the saved Farm Book and all new bootstrap modules');
  if (engineName === 'webkit') await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  else await context.setOffline(false);

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

  const secondary = await pageWithFixture();
  await secondary.page.goto(url); await ready(secondary.page);
  await secondary.page.evaluate(async () => {
    const local = window.RegulaRusticaLocal.read();
    const stamp = '2026-10-14T16:00:00.000Z';
    const task = { id: 'secondary-task', title: 'Record milk', recordId: local.records[0].id, completed: true, status: 'completed', completedAt: stamp, createdAt: stamp, updatedAt: stamp };
    const entry = { id: 'secondary-yield', taskId: task.id, recordId: task.recordId, type: 'milk', quantity: 1, unit: 'gal', occurredAt: stamp, createdAt: stamp, updatedAt: stamp, deletedAt: null };
    local.tasks.push(task); local.yieldEntries.push(entry);
    await window.RegulaRusticaLocal.write(local, 'browser-fixture');
    const storage = window.RegulaRusticaStorage;
    window.secondaryCommit = storage.backend.commit.bind(storage.backend);
    storage.backend.commit = async () => { throw new Error('simulated secondary action disk full'); };
    window.openTaskReopen(task, [entry]);
  });
  await secondary.page.locator('#modalCompleteWithoutYield').click();
  await secondary.page.locator('#modalSaveError').waitFor({ state: 'visible' });
  assert.match(await secondary.page.locator('#modalSaveError').textContent(), /Keep this form open and review your entries before closing/);
  assert.doesNotMatch(await secondary.page.locator('#modalSaveError').textContent(), /choose Save/);
  assert.equal(await secondary.page.evaluate(async () => JSON.parse((await window.RegulaRusticaStorage.backend.readAll()).get('regulaRusticaV5')).tasks.find(task => task.id === 'secondary-task').completed), true);
  await secondary.page.evaluate(() => { window.RegulaRusticaStorage.backend.commit = window.secondaryCommit; });
  await secondary.page.locator('#modalCompleteWithoutYield').click();
  await secondary.page.waitForFunction(() => !document.querySelector('#modal').open);
  assert.equal(await secondary.page.evaluate(async () => JSON.parse((await window.RegulaRusticaStorage.backend.readAll()).get('regulaRusticaV5')).tasks.find(task => task.id === 'secondary-task').completed), false);
  await secondary.page.evaluate(() => {
    window.RegulaRusticaStorage.backend.commit = async () => { throw new Error('simulated note disk full'); };
    window.openModal('note', null, window.RegulaRusticaLocal.read().records[0].id);
  });
  await secondary.page.locator('#modalForm [name="text"]').fill('Retained note form input');
  await secondary.page.locator('#modalSubmit').click();
  await secondary.page.locator('#modalSaveError').waitFor({ state: 'visible' });
  assert.match(await secondary.page.locator('#modalSaveError').textContent(), /Keep this form open and review your entries before closing/);
  assert.doesNotMatch(await secondary.page.locator('#modalSaveError').textContent(), /choose Save|saved successfully/);
  assert.equal(await secondary.page.locator('#modalForm [name="text"]').inputValue(), 'Retained note form input');
  await captureLedger(secondary.page, 'note-save-error');
  await secondary.page.locator('#modalCancel').click();
  await secondary.page.evaluate(() => window.openModal('note', null, window.RegulaRusticaLocal.read().records[0].id));
  assert.equal(await secondary.page.locator('#modalSaveError').textContent(), '');
  assert.ok(!(await secondary.page.locator('#modalSaveError').isVisible()));
  await secondary.page.locator('#modalCancel').click();
  await secondary.page.evaluate(async () => { window.RegulaRusticaStorage.backend.commit = window.secondaryCommit; await window.RegulaRusticaStorage.flush(); });
  await secondary.context.close();
  console.log('PASS secondary and note failures show honest in-dialog guidance, retain form input, and reset on a new modal');

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
  assert.equal(await newPage.evaluate(() => window.RegulaRusticaLocal.read().choreWindows.length), 2);
  assert.ok(await newPage.locator('#onboarding').isVisible());
  console.log('PASS a truly new device still opens the empty onboarding flow');
  await blank.close();

  const recovery = await recoveryFixture();
  await connectFixtureCloud(recovery.page);
  await recoveryUiReady(recovery.page);
  const recovered = await recovery.page.evaluate(() => ({
    data: window.RegulaRusticaLocal.read(),
    state: JSON.parse(window.RegulaRusticaStorage.getItem('regulaRusticaSyncV1')),
    backups: JSON.parse(window.RegulaRusticaStorage.getItem('regulaRusticaSyncBackupsV1')),
    writes: window.recoveryFixture.writes,
    premium: document.querySelector('#accountCloudPremiumState').textContent,
    device: document.querySelector('#accountCloudDeviceState').textContent,
    action: document.querySelector('#accountCloudNextAction').textContent
  }));
  assert.equal(recovered.data.records[0].name, 'Cloud Maple');
  assert.equal(recovered.data.legacy.receiptPhotos.preserved.dataUrl.length, 350_023);
  assert.equal(recovered.state.deviceId, '00000000-0000-4000-8000-000000000002');
  assert.equal(recovered.state.initialSyncCompleted, true);
  assert.equal(recovered.state.initialSyncState.status, 'complete');
  assert.equal(recovered.state.initialSyncState.backupId, 'preserved-backup');
  assert.deepEqual(recovered.data.choreWindows, []);
  assert.deepEqual(recovered.state.outbox, []);
  assert.equal(recovered.backups[0].data.records[0].name, 'Maple');
  assert.deepEqual(recovered.writes, []);
  assert.equal(recovered.premium, 'Active');
  assert.equal(recovered.device, 'Synced');
  assert.notEqual(recovered.action, 'Finish setup');
  await recovery.page.reload(); await ready(recovery.page);
  assert.deepEqual(await recovery.page.evaluate(() => window.RegulaRusticaLocal.read().choreWindows), []);
  await connectFixtureCloud(recovery.page);
  await recoveryUiReady(recovery.page);
  assert.deepEqual(await recovery.page.evaluate(() => JSON.parse(window.RegulaRusticaStorage.getItem('regulaRusticaSyncV1')).outbox), []);
  await recovery.page.evaluate(async () => {
    const local = window.RegulaRusticaLocal.read();
    local.settings.homesteadMotto = 'An ordinary local edit';
    await window.RegulaRusticaLocal.write(local, 'user');
  });
  assert.deepEqual(await recovery.page.evaluate(() => window.RegulaRusticaLocal.read().choreWindows), []);
  assert.deepEqual(await recovery.page.evaluate(() => JSON.parse(window.RegulaRusticaStorage.getItem('regulaRusticaSyncV1')).outbox), []);
  assert.deepEqual(await recovery.page.evaluate(() => window.recoveryFixture.writes), []);
  console.log('PASS Premium device reopens from failed recovery, finishes the cloud download, and stays initialized without any cloud writes');
  await recovery.context.close();

  const paused = await recoveryFixture({ pending: true });
  await connectFixtureCloud(paused.page);
  await paused.page.waitForFunction(() => window.RegulaRusticaSync.getStatus().label === 'Sync recovery');
  await paused.page.locator('#headerSyncStatus').click();
  await paused.page.locator('#accountCloudNextAction').click();
  assert.ok(!(await paused.page.locator('#syncFirstActions').isVisible()));
  assert.ok(await paused.page.getByRole('button', { name: 'Back up and retry cloud download', exact: true }).isVisible());
  assert.equal(await paused.page.locator('#accountCloudNextAction').textContent(), 'Review recovery');
  paused.page.once('dialog', dialog => dialog.dismiss());
  await paused.page.locator('#syncRetryCloudRecovery').click();
  assert.equal(await paused.page.evaluate(() => window.RegulaRusticaLocal.read().records[0].name), 'Newer local Maple');
  assert.equal(await paused.page.evaluate(() => JSON.parse(window.RegulaRusticaStorage.getItem('regulaRusticaSyncV1')).outbox.length), 1);
  const backupDownload = paused.page.waitForEvent('download');
  paused.page.once('dialog', dialog => dialog.accept());
  await paused.page.locator('#syncRetryCloudRecovery').click();
  await backupDownload;
  await recoveryUiReady(paused.page);
  const safeRetry = await paused.page.evaluate(() => ({
    backups: JSON.parse(window.RegulaRusticaStorage.getItem('regulaRusticaSyncBackupsV1')),
    writes: window.recoveryFixture.writes
  }));
  assert.ok(safeRetry.backups.some(backup => backup.data.records.some(row => row.name === 'Maple')));
  assert.ok(safeRetry.backups.some(backup => backup.data.records.some(row => row.name === 'Newer local Maple')));
  assert.deepEqual(safeRetry.writes, []);
  console.log('PASS newer local work pauses cloud recovery; cancel preserves it and confirmed retry keeps both backups');
  await paused.context.close();

  const retry = await recoveryFixture();
  await connectFixtureCloud(retry.page, { failDownload: true });
  await retry.page.waitForFunction(() => document.querySelector('#syncStatus').textContent.includes('Fixture cloud download interrupted'));
  await retry.page.waitForFunction(() => document.querySelector('#accountCloudDeviceState').textContent === 'Sync recovery'
    && document.querySelector('#accountCloudNextAction').textContent === 'Review recovery');
  await captureRecovery(retry.page, 'recovery-paused');
  await retry.page.evaluate(() => {
    window.recoveryFixture.failDownload = false;
    window.dispatchEvent(new Event('online'));
  });
  await recoveryUiReady(retry.page);
  assert.deepEqual(await retry.page.evaluate(() => window.RegulaRusticaLocal.read().choreWindows), []);
  assert.deepEqual(await retry.page.evaluate(() => JSON.parse(window.RegulaRusticaStorage.getItem('regulaRusticaSyncV1')).outbox), []);
  assert.deepEqual(await retry.page.evaluate(() => window.recoveryFixture.writes), []);
  await captureRecovery(retry.page, 'recovery-complete');
  console.log('PASS a failed recovery retains an actionable error and automatically continues on reconnect');
  await retry.context.close();
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
