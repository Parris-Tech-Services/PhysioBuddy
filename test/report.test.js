import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, reportWindow } from '../js/report.js';
import { zonedTimeToMs } from '../js/schedule.js';
import { getProgramme } from '../js/data.js';

const acute = getProgramme('acute-neck-2026-10-22');
const session = (date, time, extra = {}) => ({
  id: `${date}${time}`, programmeId: acute.id, programmeTitle: acute.title, startedAt: zonedTimeToMs(date, time), status: 'finished', percent: 100,
  painBefore: null, painAfter: null, symptoms: [], exercises: [], ...extra,
});
const names = { 'active-cervical-rotation': 'Active neck rotation', 'passive-flexion': 'Chin to chest' };
const base = { programmes: [acute], exerciseName: (id) => names[id] || id, endDate: '2026-10-24', days: 7 };

test('report window covers the last N days inclusive', () => {
  assert.deepEqual(reportWindow('2026-10-24', 7), { from: '2026-10-18', to: '2026-10-24' });
});

test('report summarises sessions, discomfort, symptoms, ratings and questions', () => {
  const sessions = [
    session('2026-10-22', '16:31', { painBefore: 6, painAfter: 4, exercises: [{ exerciseId: 'active-cervical-rotation', status: 'completed', rating: { discomfort: 'mild', difficulty: 'hard' } }] }),
    session('2026-10-23', '06:40', { status: 'stopped', percent: 20, painBefore: 5, painAfter: 5, symptoms: [{ kind: 'headache', exerciseId: 'passive-flexion' }] }),
    session('2026-10-23', '08:30', { manual: true }),
    session('2026-10-01', '08:30'),
  ];
  const text = buildReport({
    ...base, sessions,
    checkins: { '2026-10-22': { pain: 6, headache: true, sleep: 'poor' }, '2026-10-24': { pain: 4, headache: false, sleep: 'good' }, '2026-09-01': { pain: 9 } },
    questions: [{ text: 'Keep doing rotations after day 4?', resolved: null }, { text: 'Old answered one', resolved: 1 }],
    flags: ['Rocking movements (Neck and lumbar recovery): Needs clarification'],
  });
  assert.match(text, /^Home exercise report for John Robins\nPeriod: 18 Oct 2026 – 24 Oct 2026/);
  assert.match(text, /- Acute neck recovery \(prescribed 22 Oct 2026; about every two hours while awake, including before bed and if awake overnight\): 3 sessions on 2 of 7 days/);
  assert.match(text, /- 3 total: 1 complete, 0 partly done, 1 stopped early, 1 marked done from a reminder \(not tracked\)/);
  assert.match(text, /Average before a session: 5\.5\/10, after: 4\.5\/10 \(2 sessions\)/);
  assert.match(text, /- 2 check-ins\. Average neck discomfort 5\/10 \(first 6, latest 4\)/);
  assert.match(text, /- Headache days: 22 Oct 2026/);
  assert.match(text, /- Sleep: 1 poor, 0 ok, 1 good/);
  assert.match(text, /- 23 Oct 2026: headache during Chin to chest/);
  assert.match(text, /- Active neck rotation: done 1×; 1× mild discomfort, 1× hard/);
  assert.match(text, /- Keep doing rotations after day 4\?/);
  assert.doesNotMatch(text, /Old answered one/);
  assert.match(text, /- Rocking movements \(Neck and lumbar recovery\): Needs clarification/);
  assert.match(text, /Not a clinical record\.\n$/);
});

test('an empty period says so plainly instead of inventing numbers', () => {
  const text = buildReport({ ...base, sessions: [] });
  assert.match(text, /- 0 total: 0 complete, 0 partly done, 0 stopped early\n/);
  assert.match(text, /Discomfort around sessions \(0–10, self-reported\)\n- Not recorded/);
  assert.match(text, /Daily check-ins\n- None recorded/);
  assert.match(text, /Questions for you\n- None/);
});
