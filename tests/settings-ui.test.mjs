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
  assert.match(app, /showSettingsSection\('home'\)/);
});

test('existing Settings control contracts remain present exactly once', () => {
  [
    'homesteadForm', 'homesteadName', 'childForm', 'childName', 'childList',
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

test('Settings index has responsive desktop and mobile layouts', () => {
  assert.match(css, /\.settings-category-grid\s*\{[^}]*repeat\(2,/s);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.settings-category-grid\s*\{\s*grid-template-columns: 1fr;/);
  assert.match(css, /\.settings-section-head\s*\{[^}]*background:/s);
});
