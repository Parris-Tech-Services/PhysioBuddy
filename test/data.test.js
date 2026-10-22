import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAMMES, EXERCISES, getProgramme, prescriptionHistory, doseChanges, describeDose } from '../js/data.js';
import { FIGURES } from '../js/figures.js';

const byId = (id) => getProgramme(id);
const item = (pid, exId) => byId(pid).items.find((it) => it.exerciseId === exId);

test('October acute neck programme keeps the prescribed doses exactly', () => {
  const p = byId('acute-neck-2026-10-22');
  assert.equal(p.prescribedOn, '2026-10-22');
  assert.deepEqual(p.items.map((it) => it.exerciseId), ['active-cervical-rotation', 'passive-rotation-hold', 'passive-flexion', 'passive-extension', 'posture-drill-mirror']);
  assert.deepEqual(item(p.id, 'active-cervical-rotation').dose, { sides: ['left', 'right'], reps: 10, holdSeconds: null, holdPolicy: 'none', frequency: null });
  assert.deepEqual(item(p.id, 'passive-rotation-hold').dose, { sides: ['left', 'right'], reps: 5, holdSeconds: 30, holdPolicy: 'every', frequency: null });
  assert.deepEqual(item(p.id, 'passive-flexion').dose, { sides: null, reps: 10, holdSeconds: 30, holdPolicy: 'last', frequency: null });
  assert.equal(item(p.id, 'passive-extension').dose.reps, 10);
  assert.equal(item(p.id, 'posture-drill-mirror').dose.reps, null);
  assert.deepEqual(p.defaultReminderTimes, ['06:30', '08:30', '16:30', '18:30', '20:30', '22:30']);
  assert.equal(p.durationDays, 4);
});

test('the 4-5/10 discomfort limit applies only to active rotation', () => {
  const limited = PROGRAMMES.flatMap((p) => p.items).filter((it) => /4–5/.test(it.limit || ''));
  assert.deepEqual(limited.map((it) => it.exerciseId), ['active-cervical-rotation']);
});

test('doses the summaries do not state stay unspecified', () => {
  const june = byId('neck-lumbar-2026-06-03');
  for (const it of june.items.filter((x) => x.exerciseId !== 'prone-press-up')) {
    assert.equal(it.dose.reps, null, it.exerciseId);
    assert.equal(it.dose.holdSeconds, null, it.exerciseId);
  }
  assert.equal(item('neck-back-upper-2026-03-31', 'doorway-pec-stretch').dose.reps, null);
  assert.match(describeDose(june.items[0].dose), /No count specified/);
});

test('headache and significant-pain precautions are preserved', () => {
  assert.ok(byId('neck-headache-2026-03-17').precautions.some((x) => /headache/i.test(x) && /John/.test(x)));
  assert.ok(byId('neck-lumbar-2026-06-03').precautions.some((x) => /significant pain/i.test(x)));
});

test('March prescriptions stay separate and their dose changes are surfaced', () => {
  const hist = prescriptionHistory('chin-tuck');
  assert.deepEqual(hist.map((h) => h.programme.prescribedOn), ['2026-03-17', '2026-03-31']);
  assert.equal(hist[0].item.dose.holdPolicy, 'last');
  assert.equal(hist[1].item.dose.holdPolicy, 'every');
  assert.ok(doseChanges().some((c) => c.exerciseId === 'chin-tuck'));
});

test('every exercise has a drawable figure or is flagged for clarification', () => {
  for (const [id, ex] of Object.entries(EXERCISES)) {
    if (ex.figure) assert.ok(FIGURES[ex.figure], `${id} figure ${ex.figure}`);
    else {
      const flagged = PROGRAMMES.flatMap((p) => p.items).filter((it) => it.exerciseId === id).every((it) => (it.flags || []).some((f) => /clarification/i.test(f)));
      assert.ok(flagged, `${id} has no figure and no clarification flag`);
    }
  }
});

test('every prescribed item points at a library exercise', () => {
  for (const p of PROGRAMMES) for (const it of p.items) assert.ok(EXERCISES[it.exerciseId], it.exerciseId);
});
