import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const [html, app, css, refinements, worker] = await Promise.all([
  read('index.html'), read('app.js'), read('housekeeping.css'), read('ui-refinements.js'), read('service-worker.js')
]);

test('Record header is quiet while every section owns its creation action', () => {
  assert.doesNotMatch(html, /id="recordAdd"/);
  assert.match(html, /id="recordEdit"/);
  assert.match(html, /id="recordSectionAddTask"/);
  assert.match(html, /id="recordSectionYieldAdd"/);
  assert.match(html, /id="journalAdd"/);
  assert.match(html, /id="recordSectionAddLedger"/);
});

test('Journal Entry menu includes structured Record Events and filters them', () => {
  assert.match(html, /id="journalAddEvent"/);
  assert.match(html, /data-journal-filter="events"/);
  assert.match(app, /journalAddEvent[^\n]+openModal\('event', null, currentRecordId\)/);
  assert.match(app, /journalFilter = button\.dataset\.journalFilter/);
});

test('At a Glance exposes recent Journal activity and direct section jumps', () => {
  assert.match(html, /id="recordOverviewActivity"/);
  for (const section of ['tasks', 'yield', 'journal']) assert.match(html, new RegExp(`data-record-jump="${section}"`));
  assert.match(app, /buildJournalItems\(data, record\.id\)\.slice\(0, 3\)/);
  assert.match(app, /function activateRecordSection\(section/);
  assert.match(app, /activateRecordSection\(jump\.dataset\.recordJump, \{ scroll: true \}\)/);
});

test('mobile uses the real sticky text tab list without a generated dropdown', () => {
  assert.match(css, /\.record-section-nav \{ position: sticky; top: 57px;/);
  assert.match(css, /grid-template-columns: repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /\.record-section-nav button\.active::after/);
  assert.doesNotMatch(refinements, /record-mobile-sections|installMobileRecordSections|syncMobileRecordSection/);
});

test('updated Record detail assets share one offline cache version', () => {
  assert.match(worker, /regula-rustica-cyril-receipt-reader-v2/);
  assert.match(worker, /housekeeping\.css\?v=cyril-receipt-reader-v1/);
  assert.match(html, /housekeeping\.css\?v=cyril-receipt-reader-v1/);
  assert.match(worker, /app\.js\?v=cyril-assisted-entry-v1/);
  assert.match(html, /app\.js\?v=cyril-assisted-entry-v1/);
  assert.match(worker, /ui-refinements\.js\?v=cyril-receipt-reader-v2/);
  assert.match(html, /ui-refinements\.js\?v=cyril-receipt-reader-v2/);
});
