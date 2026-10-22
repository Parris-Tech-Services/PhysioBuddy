// Gentle, cumulative milestones. They only ever accumulate — there are no
// streaks to break — so a missed session never takes anything away.
import { TZ, zonedDate, slotFor, sortTimes } from './schedule.js';

const SESSION_STEPS = [1, 5, 10, 25, 50, 100, 200];
const MOVEMENT_STEPS = [100, 500, 1000, 2500, 5000];
const CHECKIN_STEPS = [7, 30];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Every milestone reached so far, each with the date it was first reached.
export function earnedMilestones({ sessions = [], checkins = {}, times = [] }, tz = TZ) {
  const sorted = sessions.filter((s) => !s.manual).slice().sort((a, b) => a.startedAt - b.startedAt);
  const out = [];
  let movements = 0;
  sorted.forEach((s, i) => {
    const n = i + 1;
    const date = zonedDate(s.startedAt, tz);
    if (SESSION_STEPS.includes(n)) out.push({ id: `sessions-${n}`, date, text: n === 1 ? 'First session done' : `${plural(n, 'session')} done` });
    const before = movements;
    movements += s.repsDone || 0;
    for (const step of MOVEMENT_STEPS) if (before < step && movements >= step) out.push({ id: `movements-${step}`, date, text: `${step.toLocaleString('en-AU')} movements guided` });
  });
  const slots = sortTimes(times);
  if (slots.length) {
    const byDay = new Map();
    for (const s of sorted) {
      const day = zonedDate(s.startedAt, tz);
      if (!byDay.has(day)) byDay.set(day, new Set());
      byDay.get(day).add(slotFor(s.startedAt, slots, tz));
    }
    const fullDay = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).find(([, set]) => slots.every((t) => set.has(t)));
    if (fullDay) out.push({ id: 'full-day', date: fullDay[0], text: `Every reminder slot done in one day (${slots.length} sessions)` });
  }
  const checkinDays = Object.keys(checkins).sort();
  for (const step of CHECKIN_STEPS) if (checkinDays.length >= step) out.push({ id: `checkins-${step}`, date: checkinDays[step - 1], text: `${step} daily check-ins` });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Milestones present in `after` but not in `before` — shown once, right
// after the session that earned them.
export function newMilestones(before, after) {
  const seen = new Set(before.map((m) => m.id));
  return after.filter((m) => !seen.has(m.id));
}
