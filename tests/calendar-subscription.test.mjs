import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serializeCalendarFeed } from '../calendar-subscription.mjs';
import feedHandler from '../netlify/functions/calendar-feed.mts';

const event = (overrides = {}) => ({
  id: '7e203c7a-7db4-4f3c-84a0-c6a87876098a', title: 'Farmers market',
  startDate: '2026-09-05', endDate: '2026-09-05', allDay: true,
  startTime: null, endTime: null, location: '', notes: '', recurrenceRule: null,
  updatedAt: '2026-09-01T12:30:00Z', ...overrides
});

test('all-day Calendar events have an exclusive end and stable UID', () => {
  const output = serializeCalendarFeed({ name: 'Woodthief Homestead', events: [event()] });
  assert.match(output, /X-WR-CALNAME:Woodthief Homestead\r\n/);
  assert.match(output, /UID:7e203c7a-7db4-4f3c-84a0-c6a87876098a@regula-rustica\r\n/);
  assert.match(output, /DTSTART;VALUE=DATE:20260905\r\nDTEND;VALUE=DATE:20260906/);
  assert.ok(output.endsWith('END:VCALENDAR\r\n'));
});

test('timed events and private text are escaped without changing local wall time', () => {
  const output = serializeCalendarFeed({ events: [event({ allDay: false, startTime: '10:30', endTime: '11:45', title: 'Feed, tools; more', notes: 'First\nSecond', location: 'Barn\\shed' })] });
  assert.match(output, /DTSTART:20260905T103000\r\nDTEND:20260905T114500/);
  assert.match(output, /SUMMARY:Feed\\, tools\\; more/);
  assert.match(output, /DESCRIPTION:First\\nSecond/);
  assert.match(output, /LOCATION:Barn\\\\shed/);
});

test('recurring event uses a bounded RFC recurrence count when it has an end date', () => {
  const output = serializeCalendarFeed({ events: [event({ recurrenceRule: { frequency: 'weekly', interval: 2, until: '2026-10-03' } })] });
  assert.match(output, /RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3/);
});

test('end-of-month recurrence follows the app clamping rule in February', () => {
  const output = serializeCalendarFeed({ events: [event({ startDate: '2026-01-31', endDate: '2026-01-31', recurrenceRule: { frequency: 'monthly', interval: 1, until: '2026-03-31' } })] }, new Date('2026-02-15T00:00:00Z'));
  assert.match(output, /DTSTART;VALUE=DATE:20260228/);
  assert.match(output, /DTSTART;VALUE=DATE:20260331/);
  assert.doesNotMatch(output, /RRULE:FREQ=MONTHLY/);
});

test('folded content never exceeds 75 UTF-8 octets per line', () => {
  const output = serializeCalendarFeed({ events: [event({ notes: 'á'.repeat(100) })] });
  for (const line of output.split('\r\n').filter(Boolean)) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
});

test('UI and database keep link issuance Steward-only and revocable', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../supabase/migrations/20260928020000_calendar_subscription_links.sql', import.meta.url), 'utf8');
  assert.match(html, /id="calendarSubscribe"/);
  assert.match(html, /id="calendarSubscriptionRevoke"/);
  assert.match(migration, /has_capability\('manage_homestead'\)/);
  assert.match(migration, /has_premium_feature\('cloud_sync'\)/);
  assert.match(migration, /delete from private\.calendar_subscription_links/);
  assert.match(migration, /revoke all on private\.calendar_subscription_links from public, anon, authenticated/);
});

test('Google and Apple buttons use the shared Supabase OAuth session', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('../cloud-auth.js', import.meta.url), 'utf8');
  for (const id of ['cloudGoogleSignIn', 'cloudAppleSignIn', 'onboardingGoogleSignIn', 'onboardingAppleSignIn']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(auth, /client\.auth\.signInWithOAuth\(\{ provider, options: \{ redirectTo \} \}\)/);
});

test('feed endpoint rejects bad tokens without contacting the database', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('unexpected network access'); };
  try {
    const response = await feedHandler(new Request('https://example.test/calendar/nope.ics'), { params: { token: 'nope.ics' } });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  } finally { globalThis.fetch = originalFetch; }
});

test('valid private link returns read-only iCalendar with no service-role key', async () => {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  const token = '7e203c7a-7db4-4f3c-84a0-c6a87876098a';
  globalThis.Netlify = { env: { get: key => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' })[key] } };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://example.supabase.co/rest/v1/rpc/read_calendar_subscription');
    assert.equal(options.headers.apikey, 'sb_publishable_test');
    assert.equal(options.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(options.body), { raw_token: token });
    return Response.json({ name: 'Test Homestead', events: [event()] });
  };
  try {
    const response = await feedHandler(new Request(`https://example.test/calendar/${token}.ics`), { params: { token: `${token}.ics` } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/calendar/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(await response.text(), /SUMMARY:Farmers market/);
  } finally { globalThis.fetch = originalFetch; globalThis.Netlify = originalNetlify; }
});
