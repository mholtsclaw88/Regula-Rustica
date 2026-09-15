import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, app, css] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../housekeeping.css', import.meta.url), 'utf8')
]);

test('Settings home exposes one focused destination for every category', () => {
  const categories = [...html.matchAll(/data-settings-category="([^"]+)"/g)].map(match => match[1]);
  const panels = [...html.matchAll(/data-settings-panel="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(categories, ['identity', 'people', 'rhythm', 'cloud', 'backup', 'about']);
  assert.deepEqual(panels.sort(), [...categories].sort());
  assert.match(app, /showSettingsSection\(button\.dataset\.settingsCategory\)/);
  assert.match(html, /data-settings-view="calendar"/);
  assert.match(app, /button\.dataset\.settingsView/);
  assert.match(app, /showSettingsSection\('home'\)/);
});

test('existing Settings control contracts remain present exactly once', () => {
  [
    'homesteadForm', 'homesteadName', 'homesteadMotto', 'homesteadLocation',
    'homesteadLogoInput', 'removeHomesteadLogo', 'saveHomesteadIdentity', 'childForm', 'childName', 'childList',
    'addChoreWindow', 'choreWindowList', 'cloudAuthForm', 'cloudStatus',
    'syncControls', 'syncRecovery', 'syncResetFromCloud', 'exportData', 'importData', 'resetData'
  ].forEach(id => assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id));
});

test('device sync recovery is explicit, confirmed, and uses the existing cloud download path', async () => {
  const runtime = await readFile(new URL('../sync/runtime.mjs', import.meta.url), 'utf8');
  assert.match(html, /Reset this device from cloud/);
  assert.match(html, /Cloud data is not deleted/);
  assert.match(runtime, /window\.confirm\('Are you sure\?/);
  assert.match(runtime, /RegulaRusticaLocal\.exportBackup\(\)/);
  assert.match(runtime, /engine\.resetDeviceFromCloud\(context\.homesteadId\)/);
});

test('Settings summary derives from real local and cloud state', () => {
  assert.match(app, /activePeople\(\)\.length/);
  assert.match(app, /data\.choreWindows\.filter/);
  assert.match(app, /REGULA_RUSTICA_CLOUD_CONTEXT/);
  assert.match(app, /data\.settings\.homesteadName/);
});

test('Homestead identity is restrained on Today and Records and omits absent optional lines', () => {
  assert.match(html, /class="homestead-bookplate"/);
  assert.match(html, /id="todayHomesteadName"/);
  assert.match(html, /class="[^"]*hidden[^"]*" id="todayHomesteadMotto"/);
  assert.match(html, /class="[^"]*hidden[^"]*" id="todayHomesteadLocation"/);
  assert.match(html, /class="records-homestead-identity"/);
  assert.match(app, /classList\.toggle\('hidden', !identity\.motto\)/);
  assert.match(app, /classList\.toggle\('hidden', !identity\.location\)/);
  assert.doesNotMatch(app, /homesteadLogo[^\n]*Regula Rustica/i);
});

test('shared Homestead identity uses the existing Homestead row and private image storage', async () => {
  const [auth, documents] = await Promise.all([
    readFile(new URL('../cloud-auth.js', import.meta.url), 'utf8'),
    readFile(new URL('../record-documents.js', import.meta.url), 'utf8')
  ]);
  assert.match(auth, /from\('homesteads'\)\.select\('name,motto,location,logo_storage_path'\)/);
  assert.match(app, /from\('homesteads'\)\.update\(/);
  assert.match(documents, /homesteads\/\$\{context\.homesteadId\}\/identity\//);
  assert.match(documents, /saveHomesteadLogo/);
  assert.match(app, /removeHomesteadLogoRequested/);
});

test('Settings index has responsive desktop and mobile layouts', () => {
  assert.match(css, /\.settings-category-grid\s*\{[^}]*repeat\(3,/s);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.settings-category-grid\s*\{\s*grid-template-columns: 1fr;/);
  assert.match(css, /\.settings-section-head\s*\{[^}]*background:/s);
});
