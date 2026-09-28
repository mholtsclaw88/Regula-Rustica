const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FREQUENCIES = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' };

function dateParts(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function addDays(value, days) {
  const date = dateParts(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function compactDate(value) { return value.replaceAll('-', ''); }
function compactTime(value) { return String(value || '00:00').slice(0, 5).replace(':', '') + '00'; }
function escapeText(value) {
  return String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replaceAll('\\', '\\\\').replace(/\r\n?|\n/g, '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,');
}

// RFC 5545 counts UTF-8 octets, not JavaScript characters, for folded lines.
function fold(line) {
  const pieces = [];
  let segment = '';
  let bytes = 0;
  for (const character of line) {
    const width = Buffer.byteLength(character, 'utf8');
    if (bytes + width > 75) {
      pieces.push(segment);
      segment = ' ';
      bytes = 1;
    }
    segment += character;
    bytes += width;
  }
  pieces.push(segment);
  return pieces.join('\r\n');
}

function occurrenceCount(start, until, frequency, interval) {
  const first = dateParts(start);
  const last = dateParts(until);
  if (!first || !last || last < first) return 0;
  if (frequency === 'daily') return Math.floor((last - first) / 86400000 / interval) + 1;
  if (frequency === 'weekly') return Math.floor((last - first) / 604800000 / interval) + 1;
  const months = (last.getUTCFullYear() - first.getUTCFullYear()) * 12 + last.getUTCMonth() - first.getUTCMonth();
  const lastOccurrence = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), Math.min(first.getUTCDate(), new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0)).getUTCDate())));
  return Math.max(0, Math.floor((months - (lastOccurrence > last ? 1 : 0)) / interval) + 1);
}

function dateRange(event, startDate) {
  const duration = Math.max(0, Math.round((dateParts(event.endDate) - dateParts(event.startDate)) / 86400000));
  const endDate = addDays(startDate, duration);
  if (event.allDay || !event.startTime) {
    return [`DTSTART;VALUE=DATE:${compactDate(startDate)}`, `DTEND;VALUE=DATE:${compactDate(addDays(endDate, 1))}`];
  }
  const start = `${compactDate(startDate)}T${compactTime(event.startTime)}`;
  let end = `${compactDate(endDate)}T${compactTime(event.endTime || event.startTime)}`;
  if (end <= start) {
    const instant = new Date(`${endDate}T${event.startTime.slice(0, 5)}:00Z`);
    instant.setUTCHours(instant.getUTCHours() + 1);
    end = instant.toISOString().replace(/[-:]/g, '').slice(0, 15);
  }
  return [`DTSTART:${start}`, `DTEND:${end}`];
}

function eventLines(event, startDate = event.startDate, instance = false) {
  const stamp = new Date(event.updatedAt || '2000-01-01T00:00:00Z').toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.id}${instance ? `-${compactDate(startDate)}` : ''}@regula-rustica`,
    `DTSTAMP:${stamp}`,
    ...dateRange(event, startDate),
    `SUMMARY:${escapeText(event.title)}`
  ];
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
  return lines;
}

function monthlyClampedDates(event, now) {
  const first = dateParts(event.startDate);
  const until = dateParts(event.recurrenceRule?.until) || new Date(Date.UTC(now.getUTCFullYear() + 2, now.getUTCMonth(), now.getUTCDate()));
  const rangeStart = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1));
  const interval = Number(event.recurrenceRule.interval) || 1;
  const results = [];
  for (let index = 0; index < 48; index += 1) {
    const month = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth() + index, 1));
    if (month > until || month.getUTCFullYear() > now.getUTCFullYear() + 2) break;
    const monthsFromStart = (month.getUTCFullYear() - first.getUTCFullYear()) * 12 + month.getUTCMonth() - first.getUTCMonth();
    if (monthsFromStart < 0 || monthsFromStart % interval) continue;
    const day = Math.min(first.getUTCDate(), new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate());
    const occurrence = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day));
    if (occurrence >= first && occurrence <= until && occurrence >= rangeStart) results.push(occurrence.toISOString().slice(0, 10));
  }
  return results;
}

export function serializeCalendarFeed(feed, now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Regula Rustica//Homestead Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(feed.name || 'Homestead Calendar')}`];
  for (const event of feed.events || []) {
    if (!dateParts(event.startDate) || !dateParts(event.endDate) || dateParts(event.endDate) < dateParts(event.startDate)) continue;
    const rule = event.recurrenceRule;
    const frequency = FREQUENCIES[rule?.frequency];
    const interval = Number(rule?.interval || 1);
    if (frequency === 'MONTHLY' && dateParts(event.startDate).getUTCDate() > 28) {
      for (const occurrence of monthlyClampedDates(event, now)) lines.push(...eventLines(event, occurrence, true), 'END:VEVENT');
      continue;
    }
    const item = eventLines(event);
    if (frequency && Number.isInteger(interval) && interval > 0) {
      const count = rule.until ? occurrenceCount(event.startDate, rule.until, rule.frequency, interval) : null;
      if (count !== 0) item.push(`RRULE:FREQ=${frequency};INTERVAL=${interval}${count ? `;COUNT=${count}` : ''}`);
    }
    lines.push(...item, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
