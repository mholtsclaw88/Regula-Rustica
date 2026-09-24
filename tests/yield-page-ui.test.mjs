import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const [html, app, css, worker] = await Promise.all([
  read('index.html'), read('app.js'), read('housekeeping.css'), read('service-worker.js')
]);

test('Yield uses the reporting-first masthead and contextual type menu', () => {
  assert.match(html, /id="yieldAdd"/);
  for (const id of ['addMilkYield', 'addEggYield', 'addMeatYield', 'addHarvestYield', 'addForageYield']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="yieldSummary"/);
  assert.match(html, /id="yieldSummaryRange"/);
  assert.match(html, /<h3>Yield History<\/h3>/);
  assert.doesNotMatch(html, /id="today(?:Milk|Egg|Other)Yield"/);
});

test('Yield summary is unit-safe and grouped by actual Yield type', () => {
  assert.match(app, /const YIELD_INDICATORS =/);
  assert.match(app, /function yieldIconSvg/);
  assert.match(app, /\['milk', 'eggs', 'meat', 'harvest', 'forage'\]\.forEach/);
  assert.match(app, /summarizeYield\(entries\)/);
  assert.doesNotMatch(app, /todayOtherYield/);
  assert.match(css, /\.yield-summary-grid/);
  assert.match(css, /\.yield-summary-card/);
});

test('Yield history distinguishes true empty data from filtered results', () => {
  assert.match(app, /Nothing has been recorded yet\./);
  assert.match(app, /No Yield matches these filters\./);
  assert.match(app, /data-yield-empty-action="record"/);
  assert.match(app, /data-yield-empty-action="clear"/);
});

test('Record Yield keeps a recent summary while listing complete linked history', () => {
  assert.match(html, /Production and harvest history for this Record\./);
  assert.match(app, /recordYields\.forEach\(entry =>/);
  assert.doesNotMatch(app, /recentYields\.forEach\(entry =>/);
  assert.match(app, /if \(!recordYields\.length\)/);
  assert.match(html, /id="recordSectionYieldAdd"/);
});

test('Yield page assets use the current offline cache version', () => {
  assert.match(worker, /regula-rustica-cyril-record-matching-v1/);
  assert.match(worker, /housekeeping\.css\?v=cyril-receipt-reader-v1/);
  assert.match(html, /housekeeping\.css\?v=cyril-receipt-reader-v1/);
  assert.match(worker, /app\.js\?v=cyril-record-matching-v1/);
  assert.match(html, /app\.js\?v=cyril-record-matching-v1/);
});
