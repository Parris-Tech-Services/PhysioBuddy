import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, acceptResult } from '../js/commands.js';
import { zonedTimeToMs, zonedDate, nextReminder, programmeStatus, slotFor, buildIcs, formatTime12 } from '../js/schedule.js';
import { getProgramme } from '../js/data.js';
import { dailySeries, weeklySummary, weeklyMessage, toCsv } from '../js/progress.js';
import { defaultState, normaliseState, loadState, saveState, exportBackup, parseBackup } from '../js/store.js';

test('voice commands map to the right action', () => {
  const cases = {
    'Start exercises': 'ready', "I'm ready": 'ready', 'Done': 'done', 'next exercise': 'next', 'Repeat that': 'repeat',
    'how many left?': 'howMany', 'start timer': 'startTimer', 'Pause': 'pause', 'resume': 'resume', 'skip this one': 'skip',
    'That hurts': 'hurt', 'finish session': 'finish', 'yes': 'yes', 'no': 'no', 'stop': 'stop',
  };
  for (const [phrase, cmd] of Object.entries(cases)) assert.equal(parseCommand(phrase), cmd, phrase);
});

test('negated or unrelated speech never triggers a command', () => {
  for (const phrase of ["I'm not done yet", "don't skip", 'not ready', 'what a nice day', '']) assert.equal(parseCommand(phrase), null, phrase);
});

test('interim and low-confidence results are ignored', () => {
  assert.equal(acceptResult({ transcript: 'done', confidence: 0.9, isFinal: false }), null);
  assert.equal(acceptResult({ transcript: 'done', confidence: 0.2, isFinal: true }), null);
  assert.equal(acceptResult({ transcript: 'done', confidence: 0, isFinal: true }), 'done');
});

test('Sydney reminder times follow daylight saving', () => {
  // 6:30 am AEDT (UTC+11) in October, AEST (UTC+10) in June.
  assert.equal(new Date(zonedTimeToMs('2026-10-23', '06:30')).toISOString(), '2026-10-22T19:30:00.000Z');
  assert.equal(new Date(zonedTimeToMs('2026-06-03', '06:30')).toISOString(), '2026-06-02T20:30:00.000Z');
  assert.equal(zonedDate(Date.UTC(2026, 9, 22, 14, 0)), '2026-10-23');
});

const times = ['06:30', '08:30', '16:30', '18:30', '20:30', '22:30'];

test('next reminder is the following slot, rolling to tomorrow after 10:30 pm', () => {
  const at = zonedTimeToMs('2026-10-22', '09:00');
  assert.equal(nextReminder(at, times).time, '16:30');
  const late = zonedTimeToMs('2026-10-22', '23:00');
  const n = nextReminder(late, times);
  assert.equal(n.time, '06:30');
  assert.equal(n.date, '2026-10-23');
});

test('reminders stop after a temporary programme ends and snooze takes priority', () => {
  const late = zonedTimeToMs('2026-10-25', '23:00');
  assert.equal(nextReminder(late, times, { lastDay: '2026-10-25' }), null);
  const at = zonedTimeToMs('2026-10-22', '09:00');
  const n = nextReminder(at, times, { snoozeUntil: at + 10 * 60000 });
  assert.equal(n.snooze, true);
});

test('October programme runs 4 days then asks for review', () => {
  const p = getProgramme('acute-neck-2026-10-22');
  const d1 = programmeStatus(p, zonedTimeToMs('2026-10-22', '12:00'));
  assert.equal(d1.day, 1);
  assert.equal(d1.expired, false);
  const after = programmeStatus(p, zonedTimeToMs('2026-10-26', '08:00'));
  assert.equal(after.expired, true);
  assert.equal(after.reviewDue, true);
  const extended = programmeStatus(p, zonedTimeToMs('2026-10-26', '08:00'), { extendedUntil: '2026-10-28', reviewedAt: 1 });
  assert.equal(extended.expired, false);
  assert.equal(getProgramme('neck-headache-2026-03-17') && programmeStatus(getProgramme('neck-headache-2026-03-17'), Date.now()).temporary, false);
});

test('sessions are matched to reminder slots', () => {
  assert.equal(slotFor(zonedTimeToMs('2026-10-22', '16:40'), times), '16:30');
  assert.equal(slotFor(zonedTimeToMs('2026-10-22', '16:20'), times), '16:30');
  assert.equal(slotFor(zonedTimeToMs('2026-10-22', '05:00'), times), '06:30');
  assert.equal(formatTime12('22:30'), '10:30 pm');
});

test('calendar export has one daily event per reminder ending on the review date', () => {
  const ics = buildIcs({ title: 'Physio', times, startDate: '2026-10-22', lastDay: '2026-10-25', url: 'https://example.test/physio/', stamp: '20261022T000000Z' });
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 6);
  assert.match(ics, /DTSTART;TZID=Australia\/Sydney:20261022T063000/);
  assert.match(ics, /RRULE:FREQ=DAILY;UNTIL=20261025T125900Z/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

const sum = (startedAt, extra = {}) => ({ id: String(startedAt), programmeTitle: 'Acute neck recovery', startedAt, status: 'finished', percent: 100, completed: 5, partial: 0, skipped: 0, repsDone: 50, holdSeconds: 330, painBefore: 5, painAfter: 3, symptoms: [], ...extra });

test('progress summaries count days, completion and pain change', () => {
  const s = [sum(zonedTimeToMs('2026-10-22', '06:35')), sum(zonedTimeToMs('2026-10-22', '08:40'), { percent: 50, painAfter: 4 }), sum(zonedTimeToMs('2026-10-20', '16:31'))];
  const series = dailySeries(s, '2026-10-22', 3);
  assert.deepEqual(series.map((d) => d.sessions), [1, 0, 2]);
  assert.equal(series[2].full, 1);
  const w = weeklySummary(s, '2026-10-22');
  assert.equal(w.sessions, 3);
  assert.equal(w.activeDays, 2);
  assert.match(weeklyMessage(w), /2 days this week/);
  assert.match(weeklyMessage({ sessions: 0 }), /fresh week/);
  assert.match(toCsv(s), /^date,start_time,programme/);
});

test('storage survives bad data and round-trips backups', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(loadState(storage), defaultState());
  mem.set('joshhealth.physio.v1', '{not json');
  assert.deepEqual(loadState(storage), defaultState());
  const s = defaultState();
  s.settings.speechRate = 1.1;
  assert.equal(saveState(storage, s), true);
  assert.equal(loadState(storage).settings.speechRate, 1.1);
  assert.equal(saveState({ setItem() { throw new Error('quota'); } }, s), false);
  const restored = parseBackup(exportBackup(s, Date.UTC(2026, 9, 22)));
  assert.equal(restored.settings.speechRate, 1.1);
  assert.throws(() => parseBackup('{"app":"other"}'), /not a physio app backup/);
  assert.throws(() => parseBackup('nope'), /not JSON/);
  assert.equal(normaliseState({ schemaVersion: 1, customProgrammes: [{ id: 'x' }] }).customProgrammes.length, 0);
});

test('exercise feedback counts ratings per exercise within the window', async () => {
  const { exerciseFeedback } = await import('../js/progress.js');
  const s = [
    sum(zonedTimeToMs('2026-10-22', '06:35'), { exercises: [{ exerciseId: 'a', status: 'completed', rating: { discomfort: 'more', difficulty: 'hard' } }, { exerciseId: 'b', status: 'skipped', rating: null }] }),
    sum(zonedTimeToMs('2026-10-22', '08:35'), { exercises: [{ exerciseId: 'a', status: 'partial', rating: { difficulty: 'easy' } }] }),
    sum(zonedTimeToMs('2026-10-01', '08:35'), { exercises: [{ exerciseId: 'a', status: 'completed', rating: { difficulty: 'hard' } }] }),
  ];
  const rows = exerciseFeedback(s, '2026-10-09');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { exerciseId: 'a', done: 2, discomfort: { none: 0, mild: 0, more: 1 }, difficulty: { easy: 1, ok: 0, hard: 1 } });
});

test('daily check-ins validate answers and build a day-by-day trend', async () => {
  const { updateCheckin, checkinSeries } = await import('../js/progress.js');
  let c = {};
  c = updateCheckin(c, '2026-10-22', 'pain', 6, 1);
  c = updateCheckin(c, '2026-10-22', 'headache', true, 2);
  c = updateCheckin(c, '2026-10-22', 'sleep', 'poor', 3);
  c = updateCheckin(c, '2026-10-22', 'pain', 11, 4);
  c = updateCheckin(c, '2026-10-22', 'sleep', 'great', 5);
  c = updateCheckin(c, '2026-10-24', 'pain', 3, 6);
  assert.deepEqual(c['2026-10-22'], { pain: 6, headache: true, sleep: 'poor', at: 3 });
  const series = checkinSeries(c, '2026-10-24', 3);
  assert.deepEqual(series.map((d) => d.pain), [6, null, 3]);
  assert.deepEqual(series.map((d) => d.headache), [true, false, false]);
});
