import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const [html, onboarding, app, auth, sync, worker] = await Promise.all([
  read('index.html'), read('onboarding.js'), read('app.js'), read('cloud-auth.js'), read('sync/runtime.mjs'), read('service-worker.js')
]);

test('first-run flow exposes eight ordered, resumable screens', () => {
  const steps = [...html.matchAll(/data-onboarding-step="(\d)"/g)].map(match => Number(match[1]));
  assert.deepEqual(steps, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.match(html, /Put the Homestead in order\./);
  assert.match(html, /Enter Regula Rustica/);
  assert.match(html, /Continue establishing your Homestead/);
  assert.match(onboarding, /dismissed: true/);
  assert.match(onboarding, /onboardingResumeButton/);
});

test('local path skips account setup while shared path uses production cloud services', () => {
  assert.match(onboarding, /step === 3 && mode === 'local' \? 5/);
  assert.match(onboarding, /selected === 'shared' \? 4 : 5/);
  assert.match(onboarding, /RegulaRusticaCloudAuth/);
  assert.match(onboarding, /RegulaRusticaSync\.initializeUpload\(\)/);
  assert.match(auth, /RegulaRusticaCloudAuth = Object\.freeze\(\{ signIn, signUp, createHomestead, createInvitation \}\)/);
  assert.match(sync, /initializeUpload: async/);
});

test('onboarding writes to real Homestead, people, Record, task, and Chore Window models', () => {
  assert.match(onboarding, /settings\.homesteadName = name/);
  assert.match(onboarding, /personType: 'child'/);
  assert.match(onboarding, /data\.records\.push\(record\)/);
  assert.match(onboarding, /RegulaRusticaTasks\.suggestedTasks\(record\)/);
  assert.match(onboarding, /RegulaRusticaTasks\.reactivateSuggestedTask/);
  assert.match(onboarding, /data\.choreWindows\.find/);
  assert.match(onboarding, /uploadHomesteadLogo/);
  assert.match(onboarding, /logo_storage_path/);
  assert.match(app, /onboardingCloudSetup/);
  assert.match(app, /onboarding: data\.settings\.onboarding/);
  assert.doesNotMatch(onboarding, /Maple|Wood Thief/);
});

test('household roles and optional invitation semantics are disclosed', () => {
  for (const role of ['Steward', 'Keeper', 'Hand', 'Guest']) assert.match(html, new RegExp(`<dt>${role}<\\/dt>`));
  assert.match(html, /Only those you invite need a Regula Rustica account/);
  assert.match(onboarding, /createInvitation/);
});

test('new installs start empty and incomplete while legacy installs default to completed', () => {
  assert.match(app, /const FIRST_RUN_DATA = \{[^]*completed: false/);
  assert.match(app, /records: \[\], tasks: \[\], people: \[\]/);
  assert.match(app, /completed: value\.completed !== false/);
  assert.match(app, /return structuredClone\(FIRST_RUN_DATA\)/);
});

test('onboarding assets are part of the offline shell', () => {
  assert.match(worker, /regula-rustica-onboarding-v2/);
  assert.match(worker, /onboarding\.css\?v=onboarding-v2/);
  assert.match(worker, /onboarding\.js\?v=onboarding-v2/);
});
