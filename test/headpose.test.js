import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anglesFromMatrix, MovementCounter, AXIS_FOR_FIGURE } from '../js/headpose.js';
import { EXERCISES } from '../js/data.js';

const rad = (d) => (d * Math.PI) / 180;
// Column-major 4×4 matrices.
const rotY = (d) => [Math.cos(rad(d)), 0, -Math.sin(rad(d)), 0, 0, 1, 0, 0, Math.sin(rad(d)), 0, Math.cos(rad(d)), 0, 0, 0, -50, 1];
const rotX = (d) => [1, 0, 0, 0, 0, Math.cos(rad(d)), Math.sin(rad(d)), 0, 0, -Math.sin(rad(d)), Math.cos(rad(d)), 0, 0, 0, -50, 1];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test('angles are recovered from rotation matrices', () => {
  const y = anglesFromMatrix(rotY(30));
  close(y.yaw, 30);
  close(y.pitch, 0);
  const x = anglesFromMatrix(rotX(-25));
  close(x.pitch, -25);
  close(x.yaw, 0);
});

function feed(counter, values, start = 0, step = 66) {
  const events = [];
  values.forEach((v, i) => events.push(...counter.update(v, start + i * step).map((e) => [e, i])));
  return events;
}

test('neutral is calibrated from the first readings, so a tilted phone is fine', () => {
  const c = new MovementCounter({ calibrationSamples: 5 });
  const ev = feed(c, [10, 11, 9, 10, 10]);
  assert.deepEqual(ev, [['calibrated', 4]]);
  assert.equal(c.baseline, 10);
  // 10° raw = neutral; no movement counted.
  assert.deepEqual(feed(c, Array(20).fill(10.5), 1000), []);
});

test('an out-and-back turn in either direction counts one rep', () => {
  const c = new MovementCounter({ calibrationSamples: 3, smoothing: 1 });
  feed(c, [0, 0, 0]);
  const out = [...Array(6).fill(35), ...Array(4).fill(2)];
  const ev = feed(c, out, 1000);
  assert.deepEqual(ev.map(([e]) => e), ['reached', 'rep']);
  const back = feed(c, [...Array(6).fill(-30), ...Array(3).fill(0)], 5000);
  assert.deepEqual(back.map(([e]) => e), ['reached', 'rep']);
  assert.equal(c.reps, 2);
  assert.equal(c.direction, -1);
});

test('brief flicks and jitter do not count', () => {
  const c = new MovementCounter({ calibrationSamples: 3, smoothing: 1, dwellMs: 250 });
  feed(c, [0, 0, 0]);
  // One frame past the threshold (66 ms) is too short.
  assert.deepEqual(feed(c, [40, 0, 0, 0], 1000), []);
  // Noise around neutral never reaches the threshold.
  assert.deepEqual(feed(c, [5, -6, 7, -4, 6, -7, 3], 2000), []);
  // Staying out without coming back is "reached" but not yet a rep.
  assert.deepEqual(feed(c, Array(10).fill(30), 3000).map(([e]) => e), ['reached']);
  assert.equal(c.reps, 0);
});

test('smoothing and progress behave sensibly', () => {
  const c = new MovementCounter({ calibrationSamples: 1, smoothing: 0.5, threshold: 20 });
  feed(c, [0]);
  c.update(20, 100);
  assert.equal(c.value, 10);
  assert.equal(c.progress, 0.5);
  assert.deepEqual(c.update(Number.NaN, 200), []);
  c.recalibrate();
  assert.equal(c.calibrated, false);
});

test('every camera-tracked figure is used by a library exercise', () => {
  const figures = new Set(Object.values(EXERCISES).map((e) => e.figure));
  for (const fig of Object.keys(AXIS_FOR_FIGURE)) assert.ok(figures.has(fig), fig);
});
