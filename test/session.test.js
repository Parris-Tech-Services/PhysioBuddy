import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProgramme } from '../js/data.js';
import { buildUnits, createSession, apply, recover, summarize, currentItem, currentUnit, holdRemainingMs, remainingText } from '../js/session.js';

const acute = getProgramme('acute-neck-2026-10-22');
const items = (p) => p.items.map((it) => ({ exerciseId: it.exerciseId, name: it.asPrescribed, dose: it.dose }));
const T0 = Date.UTC(2026, 9, 22, 5, 30);

function run(state, actions, start = T0) {
  let s = state;
  let t = start;
  const effects = [];
  for (const a of actions) {
    t += a.after ?? 1000;
    const r = apply(s, a, t);
    s = r.state;
    effects.push(...r.effects);
  }
  return { s, t, effects };
}

test('units: two-sided reps alternate and each side gets the full count', () => {
  const u = buildUnits(acute.items[0].dose);
  assert.equal(u.length, 20);
  assert.deepEqual(u.slice(0, 3).map((x) => `${x.side}${x.rep}`), ['left1', 'right1', 'left2']);
  assert.equal(u.filter((x) => x.side === 'left').length, 10);
  assert.ok(u.every((x) => x.hold === null));
});

test('units: holds follow the prescribed policy', () => {
  const holdEach = buildUnits(acute.items[1].dose);
  assert.equal(holdEach.length, 10);
  assert.ok(holdEach.every((x) => x.hold && x.hold.seconds === 30 && x.hold.required));
  const holdLast = buildUnits(acute.items[2].dose);
  assert.deepEqual(holdLast.map((x) => Boolean(x.hold)), [...Array(9).fill(false), true]);
  assert.deepEqual(buildUnits(acute.items[4].dose), []);
  const unclear = buildUnits({ reps: 10, holdSeconds: 30, holdPolicy: 'unclear', sides: null });
  assert.ok(unclear.every((x) => x.hold && !x.hold.required));
});

test('a full October session completes every exercise with the prescribed counts', () => {
  let s = createSession({ programme: acute, items: items(acute), now: T0 });
  let t = T0;
  const step = (a, dt = 1000) => {
    t += dt;
    s = apply(s, a, t).state;
  };
  step({ type: 'setPain', when: 'before', value: 5 });
  step({ type: 'start' });
  for (let guard = 0; s.status === 'active' && guard < 500; guard++) {
    const it = currentItem(s);
    const unit = currentUnit(s);
    if (it.phase === 'intro') step({ type: 'begin' });
    else if (it.phase === 'complete') step({ type: 'next' });
    else if (!it.units.length) step({ type: 'done' });
    else if (unit.hold && !it.hold) step({ type: 'startHold' });
    else if (it.hold) step({ type: 'tick' }, unit.hold.seconds * 1000);
    else step({ type: 'repDone' });
  }
  assert.equal(s.status, 'finished');
  const sum = summarize(s);
  assert.equal(sum.completed, 5);
  assert.equal(sum.percent, 100);
  assert.equal(sum.repsDone, 20 + 10 + 10 + 10);
  assert.equal(sum.holdSeconds, 10 * 30 + 30);
  assert.equal(sum.painBefore, 5);
});

test('a required hold cannot be skipped by saying done', () => {
  let s = createSession({ programme: acute, items: items(acute).slice(1, 2), now: T0 });
  ({ s } = run(s, [{ type: 'start' }, { type: 'begin' }]));
  const r = apply(s, { type: 'repDone' }, T0 + 5000);
  assert.deepEqual(r.effects, ['holdNeeded']);
  assert.equal(currentItem(r.state).unitIndex, 0);
});

test('done during a running hold does not count the rep early', () => {
  let s = createSession({ programme: acute, items: items(acute).slice(1, 2), now: T0 });
  const r1 = run(s, [{ type: 'start' }, { type: 'begin' }, { type: 'startHold' }]);
  const r2 = apply(r1.s, { type: 'repDone' }, r1.t + 10000);
  assert.deepEqual(r2.effects, ['holdRunning']);
  assert.equal(currentItem(r2.state).unitIndex, 0);
});

test('hold timers survive pause, screen lock and reload', () => {
  let s = createSession({ programme: acute, items: items(acute).slice(1, 2), now: T0 });
  const r = run(s, [{ type: 'start' }, { type: 'begin' }, { type: 'startHold' }]);
  s = r.s;
  // Pause 10 s into the hold, leave for 5 minutes, resume.
  s = apply(s, { type: 'pause' }, r.t + 10000).state;
  assert.equal(holdRemainingMs(s, r.t + 300000), 20000);
  s = apply(s, { type: 'resume' }, r.t + 300000).state;
  assert.equal(holdRemainingMs(s, r.t + 305000), 15000);
  // Screen locked past the end: recovery completes the hold once.
  const rec = recover(JSON.parse(JSON.stringify(s)), r.t + 400000);
  assert.deepEqual(rec.effects, ['holdComplete', 'repCounted']);
  assert.equal(currentItem(rec.state).unitIndex, 1);
  assert.equal(currentItem(rec.state).holdsCompletedSeconds, 30);
});

test('finishing an exercise early asks for confirmation and records it as partial', () => {
  let s = createSession({ programme: acute, items: items(acute).slice(0, 2), now: T0 });
  ({ s } = run(s, [{ type: 'start' }, { type: 'begin' }, { type: 'repDone' }, { type: 'repDone' }]));
  const ask = apply(s, { type: 'done' }, T0 + 60000);
  assert.deepEqual(ask.effects, ['confirmFinishEarly']);
  assert.equal(ask.state.pendingConfirm.remaining, 18);
  assert.equal(currentItem(ask.state).phase, 'doing');
  const no = apply(ask.state, { type: 'cancelConfirm' }, T0 + 61000);
  assert.equal(no.state.pendingConfirm, null);
  const yes = apply(ask.state, { type: 'confirm' }, T0 + 61000);
  assert.equal(currentItem(yes.state).status, 'partial');
});

test('skip, symptom report and stop are recorded without guessing completion', () => {
  let s = createSession({ programme: acute, items: items(acute), now: T0 });
  ({ s } = run(s, [{ type: 'start' }, { type: 'skip' }, { type: 'begin' }, { type: 'symptom', kind: 'pain' }, { type: 'stop' }]));
  assert.equal(s.status, 'stopped');
  const sum = summarize(s);
  assert.equal(sum.skipped, 2);
  assert.equal(sum.completed, 0);
  assert.equal(sum.symptoms.length, 1);
  assert.equal(sum.symptoms[0].exerciseId, 'passive-rotation-hold');
  // Ended sessions ignore further moves.
  assert.deepEqual(apply(s, { type: 'begin' }, T0 + 99999).effects, []);
});

test('paused sessions ignore actions other than resume and stop', () => {
  let s = createSession({ programme: acute, items: items(acute), now: T0 });
  ({ s } = run(s, [{ type: 'start' }, { type: 'pause' }]));
  const r = apply(s, { type: 'begin' }, T0 + 9000);
  assert.deepEqual(r.effects, ['pausedIgnored']);
  assert.equal(currentItem(r.state).phase, 'intro');
});

test('finishing the session early needs confirmation', () => {
  let s = createSession({ programme: acute, items: items(acute), now: T0 });
  ({ s } = run(s, [{ type: 'start' }]));
  const ask = apply(s, { type: 'finish' }, T0 + 9000);
  assert.deepEqual(ask.effects, ['confirmFinishSession']);
  const yes = apply(ask.state, { type: 'confirm' }, T0 + 9500);
  assert.equal(yes.state.status, 'finished');
  assert.equal(summarize(yes.state).skipped, 5);
});

test('how-many-left answer reflects position', () => {
  let s = createSession({ programme: acute, items: items(acute), now: T0 });
  ({ s } = run(s, [{ type: 'start' }, { type: 'begin' }, { type: 'repDone' }]));
  assert.match(remainingText(s), /^19 movements left\. Next is your right side, repetition 1\. 4 more exercises/);
});

test('unknown actions are rejected loudly', () => {
  const s = createSession({ programme: acute, items: items(acute), now: T0 });
  assert.throws(() => apply(s, { type: 'nope' }, T0), /Unknown session action/);
});

test('per-exercise ratings are optional, validated and kept in the summary', () => {
  let s = createSession({ programme: acute, items: items(acute).slice(3, 5), now: T0 });
  ({ s } = run(s, [{ type: 'start' }, { type: 'begin' }]));
  // Not rateable until the exercise is finished.
  assert.equal(apply(s, { type: 'rate', index: 0, difficulty: 'hard' }, T0 + 5000).state.items[0].rating, undefined);
  ({ s } = run(s, Array.from({ length: 10 }, () => ({ type: 'repDone' })), T0 + 5000));
  s = apply(s, { type: 'rate', index: 0, discomfort: 'mild' }, T0 + 60000).state;
  s = apply(s, { type: 'rate', index: 0, difficulty: 'hard' }, T0 + 61000).state;
  s = apply(s, { type: 'rate', index: 0, difficulty: 'impossible' }, T0 + 62000).state;
  assert.deepEqual(s.items[0].rating, { discomfort: 'mild', difficulty: 'hard' });
  // Skipped exercises cannot be rated; finished sessions can still record ratings.
  ({ s } = run(s, [{ type: 'next' }, { type: 'skip' }], T0 + 62000));
  assert.equal(s.status, 'finished');
  assert.equal(apply(s, { type: 'rate', index: 1, difficulty: 'easy' }, T0 + 70000).state.items[1].rating, undefined);
  const sum = summarize(s);
  assert.deepEqual(sum.exercises[0].rating, { discomfort: 'mild', difficulty: 'hard' });
  assert.equal(sum.exercises[1].rating, null);
});
