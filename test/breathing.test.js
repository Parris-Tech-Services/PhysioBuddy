import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATTERNS, breathAt, totalCycles, cycleSeconds } from '../js/breathing.js';

test('calm pattern moves through inhale and exhale with the right timing', () => {
  const p = PATTERNS.calm;
  assert.equal(cycleSeconds(p), 10);
  assert.deepEqual(breathAt(p, 0), { phase: 'inhale', caption: 'Breathe in', secondsLeft: 4, size: 0, cycle: 1 });
  assert.equal(breathAt(p, 2000).size, 0.5);
  const out = breathAt(p, 4000);
  assert.equal(out.phase, 'exhale');
  assert.equal(out.secondsLeft, 6);
  assert.equal(out.size, 1);
  assert.equal(breathAt(p, 7000).size, 0.5);
  assert.equal(breathAt(p, 10000).cycle, 2);
  assert.equal(breathAt(p, 10000).phase, 'inhale');
});

test('holds are supported and cycles fit the chosen minutes', () => {
  const box = { inhale: 4, holdIn: 4, exhale: 4, holdOut: 4 };
  assert.equal(breathAt(box, 5000).phase, 'holdIn');
  assert.equal(breathAt(box, 5000).size, 1);
  assert.equal(breathAt(box, 13000).phase, 'holdOut');
  assert.equal(breathAt(box, 13000).size, 0);
  assert.equal(totalCycles(PATTERNS.calm, 2), 12);
  assert.equal(totalCycles(PATTERNS.even, 1), 8);
  assert.equal(totalCycles(box, 0), 1);
});
