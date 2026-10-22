import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyFunction, normaliseFunction, addActivity, archiveActivity, recordRatings, isCheckDue, activitySummary, activeActivities, lastCheckDate } from '../js/function.js';
import { buildReport } from '../js/report.js';

const withActivities = () => {
  let fn = emptyFunction();
  fn = addActivity(fn, '  Checking traffic when driving ', 1);
  fn = addActivity(fn, 'Sleeping through the night', 2);
  return fn;
};

test('activities are trimmed, capped at three and archived without losing history', () => {
  let fn = withActivities();
  fn = addActivity(fn, 'Computer work', 3);
  assert.equal(addActivity(fn, 'Fourth', 4), fn, 'fourth activity rejected');
  assert.equal(addActivity(withActivities(), '   ', 5).activities.length, 2, 'blank rejected');
  assert.equal(fn.activities[0].name, 'Checking traffic when driving');
  fn = recordRatings(fn, '2026-10-22', { 'act-1': 3 }, 10);
  fn = archiveActivity(fn, 'act-1');
  assert.equal(activeActivities(fn).length, 2);
  assert.equal(activitySummary(fn)[0].latest.score, 3);
  assert.equal(addActivity(fn, 'New one', 6).activities.length, 4, 'archiving frees a slot');
});

test('ratings validate scores, replace the same day and track change', () => {
  let fn = withActivities();
  fn = recordRatings(fn, '2026-10-22', { 'act-1': 3, 'act-2': 11, unknown: 5 }, 10);
  assert.deepEqual(fn.ratings, [{ date: '2026-10-22', at: 10, scores: { 'act-1': 3 } }]);
  fn = recordRatings(fn, '2026-10-22', { 'act-1': 4, 'act-2': 2 }, 11);
  assert.equal(fn.ratings.length, 1);
  assert.equal(recordRatings(fn, '2026-10-23', { 'act-1': 1.5 }, 12), fn, 'nothing valid -> unchanged');
  fn = recordRatings(fn, '2026-10-29', { 'act-1': 7 }, 13);
  const [drive, sleep] = activitySummary(fn);
  assert.deepEqual([drive.first.score, drive.latest.score, drive.change, drive.count], [4, 7, 3, 2]);
  assert.deepEqual([sleep.latest.score, sleep.change], [2, null]);
  assert.equal(lastCheckDate(fn), '2026-10-29');
});

test('the check is due weekly once activities exist', () => {
  assert.equal(isCheckDue(emptyFunction(), '2026-10-22'), false);
  let fn = withActivities();
  assert.equal(isCheckDue(fn, '2026-10-22'), true);
  fn = recordRatings(fn, '2026-10-22', { 'act-1': 3 }, 1);
  assert.equal(isCheckDue(fn, '2026-10-28'), false);
  assert.equal(isCheckDue(fn, '2026-10-29'), true);
});

test('malformed stored data is cleaned', () => {
  assert.deepEqual(normaliseFunction(null), emptyFunction());
  const fn = normaliseFunction({ activities: [{ id: 'a', name: 'x' }, { id: 1 }], ratings: [{ date: 'bad', scores: {} }, { date: '2026-10-22', scores: { a: 2 } }] });
  assert.equal(fn.activities.length, 1);
  assert.equal(fn.ratings.length, 1);
});

test('report lists activity change, marking ones no longer tracked', () => {
  let fn = withActivities();
  fn = recordRatings(fn, '2026-10-15', { 'act-1': 2, 'act-2': 5 }, 1);
  fn = recordRatings(fn, '2026-10-22', { 'act-1': 6 }, 2);
  fn = archiveActivity(fn, 'act-2');
  const text = buildReport({ sessions: [], programmes: [], fn, exerciseName: (x) => x, endDate: '2026-10-22' });
  assert.match(text, /- Checking traffic when driving: 2 → 6\/10 \(15 Oct 2026 to 22 Oct 2026\)/);
  assert.match(text, /- Sleeping through the night: 5\/10 on 15 Oct 2026 \[no longer tracked\]/);
  assert.match(buildReport({ sessions: [], programmes: [], exerciseName: (x) => x, endDate: '2026-10-22' }), /as well as before\)\n- Not recorded/);
});
