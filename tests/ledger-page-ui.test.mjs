import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const [html, app, css, loader, refinements, worker] = await Promise.all([
  read('index.html'), read('app.js'), read('housekeeping.css'), read('ui-refinements.js'), read('ui-refinements-core.js'), read('service-worker.js')
]);

test('Ledger mirrors the reporting hierarchy used by Yield', () => {
  assert.match(html, /id="ledgerSummaryRange"/);
  assert.match(html, /<span class="label">Selected period<\/span><h3>At a Glance<\/h3>/);
  assert.match(html, /<h3>Ledger History<\/h3>/);
  assert.match(html, /class="report-footnote"/);
  assert.doesNotMatch(html, /<h3>Recent entries<\/h3>/);
  assert.doesNotMatch(refinements, /Receipt photos are compressed and saved/);
});

test('Ledger empty states provide contextual actions', () => {
  assert.match(app, /Nothing has been recorded yet\./);
  assert.match(app, /No ledger entries match these filters\./);
  assert.match(app, /data-ledger-empty-action="record"/);
  assert.match(app, /data-ledger-empty-action="clear"/);
});

test('Ledger rows expose receipt status without changing receipt storage', () => {
  assert.match(app, /data\.legacy\?\.receiptPhotos\?\.\[entry\.id\]/);
  assert.match(app, /Receipt attached/);
});

test('Ledger mobile masthead does not reserve a hidden seal column', () => {
  assert.match(css, /#ledger \.section-masthead:has\(\.section-masthead-seal\.hidden\)/);
});

test('Ledger page assets use the current offline cache version', () => {
  assert.match(worker, /regula-rustica-cyril-receipt-reader-v2/);
  assert.match(worker, /housekeeping\.css\?v=cyril-receipt-reader-v1/);
  assert.match(worker, /app\.js\?v=cyril-assisted-entry-v1/);
  for (const asset of ['ui-refinements.js', 'ui-refinements-core.js']) {
    assert.match(worker, new RegExp(`${asset.replace('.', '\\.')}\\?v=${asset === 'ui-refinements.js' ? 'cyril-receipt-reader-v2' : 'ledger-page-v1'}`));
  }
  assert.match(html, /housekeeping\.css\?v=cyril-receipt-reader-v1/);
  assert.match(html, /app\.js\?v=cyril-assisted-entry-v1/);
  assert.match(html, /ui-refinements\.js\?v=cyril-receipt-reader-v2/);
  assert.match(loader, /ui-refinements-core\.js\?v=ledger-page-v1/);
});
