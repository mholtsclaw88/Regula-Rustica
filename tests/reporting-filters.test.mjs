import assert from 'node:assert/strict';
import test from 'node:test';
import housekeeping from '../housekeeping-data.js';

test('reporting ranges are inclusive and default periods include today', () => {
  assert.deepEqual(housekeeping.reportingDateRange('today', '2026-08-17'), {
    period: 'today', start: '2026-08-17', end: '2026-08-17'
  });
  assert.deepEqual(housekeeping.reportingDateRange('7', '2026-08-17'), {
    period: '7', start: '2026-08-11', end: '2026-08-17'
  });
  assert.deepEqual(housekeeping.reportingDateRange('30', '2026-08-17'), {
    period: '30', start: '2026-07-19', end: '2026-08-17'
  });
  assert.deepEqual(housekeeping.reportingDateRange('ytd', '2026-08-17'), {
    period: 'ytd', start: '2026-01-01', end: '2026-08-17'
  });
});

test('date and type filters combine without changing stored entries', () => {
  const range = housekeeping.reportingDateRange('7', '2026-08-17');
  const entries = [
    { id: 'milk-recent', type: 'milk', date: '2026-08-15' },
    { id: 'eggs-recent', type: 'eggs', date: '2026-08-16' },
    { id: 'milk-old', type: 'milk', date: '2026-08-01' }
  ];
  const visible = entries.filter(entry => entry.type === 'milk' && housekeeping.matchesReportingDate(entry.date, range));
  assert.deepEqual(visible.map(entry => entry.id), ['milk-recent']);
  assert.equal(entries.length, 3);
});

test('all-time range accepts every valid historical date', () => {
  const range = housekeeping.reportingDateRange('all', '2026-08-17');
  assert.equal(range.start, null);
  assert.equal(housekeeping.matchesReportingDate('1999-04-03', range), true);
});
