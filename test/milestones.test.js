import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earnedMilestones, newMilestones } from '../js/milestones.js';
import { zonedTimeToMs } from '../js/schedule.js';

const times = ['06:30', '08:30', '16:30', '18:30', '20:30', '22:30'];
const s = (date, time, reps = 50, extra = {}) => ({ startedAt: zonedTimeToMs(date, time), repsDone: reps, ...extra });

test('milestones accumulate from sessions, movements, full days and check-ins', () => {
  const sessions = [
    s('2026-10-22', '06:35'), s('2026-10-22', '08:31'), s('2026-10-22', '16:40'),
    s('2026-10-23', '18:30'), s('2026-10-23', '20:30', 10), s('2026-10-23', '22:31'),
    s('2026-10-23', '09:00', 0, { manual: true }),
  ];
  const ids = earnedMilestones({ sessions, times }).map((m) => m.id);
  assert.deepEqual(ids, ['sessions-1', 'movements-100', 'sessions-5']);
  const fullDay = [...times.map((t) => s('2026-10-24', t, 1))];
  const m = earnedMilestones({ sessions: fullDay, times });
  assert.ok(m.some((x) => x.id === 'full-day' && x.date === '2026-10-24'));
  const checkins = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`2026-10-${String(10 + i).padStart(2, '0')}`, { pain: 3 }]));
  assert.deepEqual(earnedMilestones({ checkins }).map((x) => [x.id, x.date]), [['checkins-7', '2026-10-16']]);
});

test('manual "marked done" entries do not count and nothing is ever lost', () => {
  assert.deepEqual(earnedMilestones({ sessions: [s('2026-10-22', '06:30', 500, { manual: true })], times }), []);
  const before = earnedMilestones({ sessions: [s('2026-10-22', '06:35')], times });
  const after = earnedMilestones({ sessions: [s('2026-10-22', '06:35'), s('2026-10-22', '08:35', 60)], times });
  assert.deepEqual(newMilestones(before, after).map((x) => x.text), ['100 movements guided']);
  assert.deepEqual(newMilestones(after, after), []);
});
