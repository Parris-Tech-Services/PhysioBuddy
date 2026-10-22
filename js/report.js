// Plain-text progress report for the treating physiotherapist. Pure: built
// only from stored sessions, check-ins and questions, so what John reads is
// exactly what the person recorded — nothing is inferred or scored.
import { TZ, zonedDate, addDays, daysBetween } from './schedule.js';
import { exerciseFeedback } from './progress.js';

const fmt = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

export function reportWindow(endDate, days) {
  return { from: addDays(endDate, -(days - 1)), to: endDate };
}

function inWindow(ms, w, tz) {
  const d = zonedDate(ms, tz);
  return d >= w.from && d <= w.to;
}

function programmeLines(sessions, programmes, w) {
  return programmes.map((p) => {
    const list = sessions.filter((s) => s.programmeId === p.id);
    const days = new Set(list.map((s) => s.day)).size;
    return `- ${p.title} (prescribed ${fmt(p.prescribedOn)}${p.frequency ? `; ${p.frequency.charAt(0).toLowerCase()}${p.frequency.slice(1).replace(/\.$/, '')}` : ''}): ${list.length} ${list.length === 1 ? 'session' : 'sessions'} on ${days} of ${daysBetween(w.from, w.to) + 1} days`;
  });
}

function painLines(sessions) {
  const both = sessions.filter((s) => s.painBefore != null && s.painAfter != null);
  if (!both.length) return ['- Not recorded'];
  return [`- Average before a session: ${avg(both.map((s) => s.painBefore))}/10, after: ${avg(both.map((s) => s.painAfter))}/10 (${both.length} sessions)`];
}

function checkinLines(checkins, w) {
  const days = Object.entries(checkins || {}).filter(([d]) => d >= w.from && d <= w.to).sort(([a], [b]) => a.localeCompare(b));
  if (!days.length) return ['- None recorded'];
  const pains = days.map(([, c]) => c.pain).filter((x) => typeof x === 'number');
  const headaches = days.filter(([, c]) => c.headache === true).map(([d]) => fmt(d));
  const sleep = days.map(([, c]) => c.sleep).filter(Boolean);
  const lines = [`- ${days.length} ${days.length === 1 ? 'check-in' : 'check-ins'}. Average neck discomfort ${avg(pains) ?? '–'}/10 (first ${pains[0] ?? '–'}, latest ${pains[pains.length - 1] ?? '–'})`];
  lines.push(`- Headache days: ${headaches.length ? headaches.join(', ') : 'none reported'}`);
  if (sleep.length) lines.push(`- Sleep: ${['poor', 'ok', 'good'].map((k) => `${sleep.filter((x) => x === k).length} ${k}`).join(', ')}`);
  return lines;
}

export function buildReport({ sessions, programmes, checkins = {}, questions = [], flags = [], exerciseName, endDate, days = 7, clinician = 'John Robins', tz = TZ }) {
  const w = reportWindow(endDate, days);
  const list = sessions.filter((s) => inWindow(s.startedAt, w, tz)).map((s) => ({ ...s, day: zonedDate(s.startedAt, tz) }));
  const tracked = list.filter((s) => !s.manual);
  const full = tracked.filter((s) => s.status === 'finished' && s.percent === 100).length;
  const stopped = tracked.filter((s) => s.status === 'stopped').length;
  const symptoms = list.flatMap((s) => (s.symptoms || []).map((e) => `- ${fmt(s.day)}: ${e.kind}${e.exerciseId ? ` during ${exerciseName(e.exerciseId)}` : ''}`));
  const feedback = exerciseFeedback(list, w.from, tz).map((r) => {
    const notes = [r.discomfort.more && `${r.discomfort.more}× more discomfort than usual`, r.discomfort.mild && `${r.discomfort.mild}× mild discomfort`, r.difficulty.hard && `${r.difficulty.hard}× hard`, r.difficulty.easy && `${r.difficulty.easy}× easy`].filter(Boolean);
    return `- ${exerciseName(r.exerciseId)}: done ${r.done}×${notes.length ? `; ${notes.join(', ')}` : ''}`;
  });
  const open = [...questions.filter((q) => !q.resolved).map((q) => q.text), ...flags];
  const lines = [
    `Home exercise report for ${clinician}`,
    `Period: ${fmt(w.from)} – ${fmt(w.to)}`,
    '',
    'Programmes',
    ...(programmes.length ? programmeLines(list, programmes, w) : ['- No active programme']),
    '',
    'Sessions',
    `- ${list.length} total: ${full} complete, ${tracked.length - full - stopped} partly done, ${stopped} stopped early${list.length - tracked.length ? `, ${list.length - tracked.length} marked done from a reminder (not tracked)` : ''}`,
    '',
    'Discomfort around sessions (0–10, self-reported)',
    ...painLines(tracked),
    '',
    'Daily check-ins',
    ...checkinLines(checkins, w),
    '',
    'Symptoms reported during sessions',
    ...(symptoms.length ? symptoms : ['- None']),
    '',
    'How each exercise felt',
    ...(feedback.length ? feedback : ['- No exercises recorded']),
    '',
    'Questions for you',
    ...(open.length ? open.map((q) => `- ${q}`) : ['- None']),
    '',
    'Self-reported from the PhysioBuddy app. Not a clinical record.',
  ];
  return lines.join('\n') + '\n';
}
