// Progress summaries derived from stored session summaries. Pure functions;
// the stored sessions are the only authority, nothing here is persisted.
import { TZ, zonedDate, addDays } from './schedule.js';

export function sessionsByDay(sessions, tz = TZ) {
  const map = new Map();
  for (const s of sessions) {
    const day = zonedDate(s.startedAt, tz);
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(s);
  }
  return map;
}

export function dailySeries(sessions, endDate, days, tz = TZ) {
  const byDay = sessionsByDay(sessions, tz);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(endDate, -i);
    const list = byDay.get(date) || [];
    const full = list.filter((s) => s.percent === 100).length;
    out.push({ date, sessions: list.length, full, partial: list.length - full, painBefore: avg(list.map((s) => s.painBefore)), painAfter: avg(list.map((s) => s.painAfter)) });
  }
  return out;
}

function avg(values) {
  const v = values.filter((x) => typeof x === 'number');
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}

export function weeklySummary(sessions, endDate, tz = TZ) {
  const week = dailySeries(sessions, endDate, 7, tz);
  const inWeek = sessions.filter((s) => zonedDate(s.startedAt, tz) >= week[0].date && zonedDate(s.startedAt, tz) <= endDate);
  const activeDays = week.filter((d) => d.sessions > 0).length;
  const pctAvg = avg(inWeek.map((s) => s.percent));
  const changes = inWeek.filter((s) => s.painBefore != null && s.painAfter != null).map((s) => s.painBefore - s.painAfter);
  return {
    from: week[0].date,
    to: endDate,
    sessions: inWeek.length,
    activeDays,
    averageCompletion: pctAvg,
    averagePainChange: changes.length ? avg(changes) : null,
    symptomReports: inWeek.reduce((n, s) => n + (s.symptoms ? s.symptoms.length : 0), 0),
  };
}

// Encouraging, guilt-free line for the weekly summary.
export function weeklyMessage(w) {
  if (!w.sessions) return 'A fresh week. Whenever you are ready, one gentle session is a great start.';
  const days = w.activeDays === 1 ? '1 day' : `${w.activeDays} days`;
  let msg = `You looked after your neck on ${days} this week — ${w.sessions} ${w.sessions === 1 ? 'session' : 'sessions'} in total.`;
  if (w.averagePainChange != null && w.averagePainChange > 0) msg += ` On average your discomfort eased by ${w.averagePainChange} points after a session.`;
  return msg;
}

export function toCsv(sessions, tz = TZ) {
  const header = ['date', 'start_time', 'programme', 'status', 'percent', 'completed', 'partial', 'skipped', 'reps', 'hold_seconds', 'pain_before', 'pain_after', 'symptoms'];
  const timeFmt = new Intl.DateTimeFormat('en-AU', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const rows = sessions.map((s) => [
    zonedDate(s.startedAt, tz), timeFmt.format(new Date(s.startedAt)), s.programmeTitle, s.status, s.percent, s.completed, s.partial, s.skipped,
    s.repsDone, s.holdSeconds, s.painBefore ?? '', s.painAfter ?? '', (s.symptoms || []).map((e) => e.kind).join('; '),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

function csvCell(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Per-exercise feedback since `fromDate` (inclusive): how often each exercise
// was done and how the optional discomfort/difficulty ratings fell.
export function exerciseFeedback(sessions, fromDate, tz = TZ) {
  const out = new Map();
  for (const s of sessions) {
    if (zonedDate(s.startedAt, tz) < fromDate) continue;
    for (const ex of s.exercises || []) {
      if (ex.status === 'skipped' || ex.status === 'pending') continue;
      if (!out.has(ex.exerciseId)) out.set(ex.exerciseId, { exerciseId: ex.exerciseId, done: 0, discomfort: { none: 0, mild: 0, more: 0 }, difficulty: { easy: 0, ok: 0, hard: 0 } });
      const row = out.get(ex.exerciseId);
      row.done += 1;
      if (ex.rating && ex.rating.discomfort in row.discomfort) row.discomfort[ex.rating.discomfort] += 1;
      if (ex.rating && ex.rating.difficulty in row.difficulty) row.difficulty[ex.rating.difficulty] += 1;
    }
  }
  return [...out.values()];
}

// One point per day for the check-in trend; days without a check-in are null.
export function checkinSeries(checkins, endDate, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(endDate, -i);
    const c = (checkins || {})[date] || {};
    out.push({ date, pain: typeof c.pain === 'number' ? c.pain : null, headache: c.headache === true, sleep: c.sleep || null });
  }
  return out;
}

export const SLEEP_OPTIONS = Object.freeze(['poor', 'ok', 'good']);

// Merge one answer into a day's check-in, ignoring invalid values.
export function updateCheckin(checkins, date, field, value, now) {
  const valid = {
    pain: Number.isInteger(value) && value >= 0 && value <= 10,
    headache: typeof value === 'boolean',
    sleep: SLEEP_OPTIONS.includes(value),
  }[field];
  if (!valid) return checkins;
  return { ...checkins, [date]: { ...(checkins[date] || {}), [field]: value, at: now } };
}
