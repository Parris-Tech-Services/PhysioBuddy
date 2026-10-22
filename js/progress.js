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
