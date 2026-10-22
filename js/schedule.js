// Reminder times and programme windows, evaluated in Australia/Sydney so
// daylight saving changes are handled by the platform's time-zone database.

export const TZ = 'Australia/Sydney';

const partsFmt = new Map();
function formatter(tz) {
  if (!partsFmt.has(tz)) {
    partsFmt.set(tz, new Intl.DateTimeFormat('en-AU', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return partsFmt.get(tz);
}

export function zonedParts(ms, tz = TZ) {
  const out = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

// 'YYYY-MM-DD' of an instant in the zone.
export function zonedDate(ms, tz = TZ) {
  const p = zonedParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// UTC instant for a wall-clock time in the zone. Two passes settle the offset
// on either side of a DST change.
export function zonedTimeToMs(dateStr, timeStr, tz = TZ) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(guess, tz);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wall - seen;
  }
  return guess;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const toUtc = (s) => Date.UTC(...s.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

export function sortTimes(times) {
  return [...new Set(times.filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].sort();
}

// A temporary programme runs from its prescription date for `durationDays`
// calendar days (or until an extension the person recorded after review).
export function programmeWindow(programme, override = {}, tz = TZ) {
  if (!programme.durationDays) return { start: programme.prescribedOn, lastDay: null, temporary: false };
  const lastDay = override.extendedUntil || addDays(programme.prescribedOn, programme.durationDays - 1);
  return { start: programme.prescribedOn, lastDay, temporary: true, tz };
}

export function programmeStatus(programme, now, override = {}, tz = TZ) {
  const today = zonedDate(now, tz);
  const w = programmeWindow(programme, override, tz);
  const day = daysBetween(w.start, today) + 1;
  if (!w.temporary) return { today, day, temporary: false, expired: false, reviewDue: false, lastDay: null };
  const expired = today > w.lastDay;
  return { today, day, temporary: true, expired, reviewDue: expired && !override.reviewedAt, lastDay: w.lastDay };
}

export function remindersForDate(dateStr, times, tz = TZ) {
  return sortTimes(times).map((time) => ({ time, at: zonedTimeToMs(dateStr, time, tz) }));
}

// Next reminder after `now`, or null once the temporary programme has ended.
export function nextReminder(now, times, { lastDay = null, snoozeUntil = null } = {}, tz = TZ) {
  const candidates = [];
  if (snoozeUntil && snoozeUntil > now) candidates.push({ time: 'snooze', at: snoozeUntil, snooze: true });
  const today = zonedDate(now, tz);
  for (let i = 0; i < 2; i++) {
    const date = addDays(today, i);
    if (lastDay && date > lastDay) break;
    for (const r of remindersForDate(date, times, tz)) if (r.at > now) candidates.push({ ...r, date });
  }
  candidates.sort((a, b) => a.at - b.at);
  return candidates[0] || null;
}

// Which reminder slot a session belongs to: the latest slot at or before the
// session start (an early session counts towards the first slot of the day).
export function slotFor(ms, times, tz = TZ) {
  const day = remindersForDate(zonedDate(ms, tz), times, tz);
  if (!day.length) return null;
  let slot = day[0].time;
  for (const r of day) if (r.at <= ms + 15 * 60000) slot = r.time;
  return slot;
}

export function formatTime12(time) {
  const [h, m] = time.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

// iCalendar export so reminders can be added to Google Calendar, which
// notifies reliably even when the browser is closed.
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Australia/Sydney',
  'BEGIN:STANDARD', 'DTSTART:19700405T030000', 'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU', 'TZOFFSETFROM:+1100', 'TZOFFSETTO:+1000', 'TZNAME:AEST', 'END:STANDARD',
  'BEGIN:DAYLIGHT', 'DTSTART:19701004T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU', 'TZOFFSETFROM:+1000', 'TZOFFSETTO:+1100', 'TZNAME:AEDT', 'END:DAYLIGHT',
  'END:VTIMEZONE',
];

// RFC 5545: UNTIL must be UTC when DTSTART carries a TZID.
export const icsUtc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function buildIcs({ title, times, startDate, lastDay, url, stamp }) {
  const compact = (s) => s.replace(/-/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JoshHealth//Physio//EN', 'CALSCALE:GREGORIAN', ...VTIMEZONE];
  for (const time of sortTimes(times)) {
    const hm = time.replace(':', '');
    const [h, m] = time.split(':').map(Number);
    const endH = String(h + (m + 15 >= 60 ? 1 : 0)).padStart(2, '0');
    const endM = String((m + 15) % 60).padStart(2, '0');
    lines.push(
      'BEGIN:VEVENT',
      `UID:physio-${compact(startDate)}-${hm}@joshhealth`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Australia/Sydney:${compact(startDate)}T${hm}00`,
      `DTEND;TZID=Australia/Sydney:${compact(startDate)}T${endH}${endM}00`,
      ...(lastDay ? [`RRULE:FREQ=DAILY;UNTIL=${icsUtc(zonedTimeToMs(lastDay, '23:59'))}`] : ['RRULE:FREQ=DAILY']),
      `SUMMARY:${title}`,
      `DESCRIPTION:Time for your physio exercises. Open: ${url}`,
      `URL:${url}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
