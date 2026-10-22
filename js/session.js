// Exercise-session state machine. Pure and clock-injected: every transition
// takes `now` (ms) so a session survives screen locks and reloads — hold
// timers are stored as absolute end times, not as running intervals.
//
// apply(state, action, now) -> { state, effects }
// `effects` are UI cues (speech, haptics); the reducer itself has no I/O.

// Expand a prescribed dose into the ordered units the person works through.
// Two-sided exercises alternate (left 1, right 1, left 2, ...), matching
// "turn left and right"; each side still gets the prescribed count.
export function buildUnits(dose) {
  if (dose.reps == null) return [];
  const sides = dose.sides || [null];
  const units = [];
  for (let rep = 1; rep <= dose.reps; rep++) {
    for (const side of sides) units.push({ side, rep, hold: holdFor(dose, rep) });
  }
  return units;
}

function holdFor(dose, rep) {
  if (dose.holdSeconds == null) return null;
  if (dose.holdPolicy === 'every') return { seconds: dose.holdSeconds, required: true };
  if (dose.holdPolicy === 'last' && rep === dose.reps) return { seconds: dose.holdSeconds, required: true };
  if (dose.holdPolicy === 'unclear') return { seconds: dose.holdSeconds, required: false };
  return null;
}

export function createSession({ programme, items, now, id }) {
  return {
    schemaVersion: 1,
    id: id || `s-${now}`,
    programmeId: programme.id,
    programmeTitle: programme.title,
    programmeKind: programme.kind,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    status: 'ready',
    pausedAt: null,
    painBefore: null,
    painAfter: null,
    index: 0,
    pendingConfirm: null,
    events: [],
    items: items.map((it) => ({
      exerciseId: it.exerciseId,
      name: it.name,
      units: buildUnits(it.dose),
      unitIndex: 0,
      phase: 'intro',
      status: 'pending',
      hold: null,
      holdsCompletedSeconds: 0,
    })),
  };
}

const clone = (s) => structuredClone(s);
export const currentItem = (s) => s.items[s.index] || null;
export const currentUnit = (s) => {
  const it = currentItem(s);
  return it ? it.units[it.unitIndex] || null : null;
};

export function holdRemainingMs(s, now) {
  const it = currentItem(s);
  if (!it || !it.hold) return null;
  if (it.hold.endsAt == null) return it.hold.remainingMs;
  return Math.max(0, it.hold.endsAt - now);
}

const HANDLERS = {
  start(s, a, now, fx) {
    if (s.status !== 'ready') return;
    s.status = 'active';
    fx.push('introExercise');
  },
  setPain(s, a) {
    if (a.when === 'before') s.painBefore = a.value;
    if (a.when === 'after') s.painAfter = a.value;
  },
  begin(s, a, now, fx) {
    const it = currentItem(s);
    if (!it || it.phase !== 'intro') return;
    it.phase = 'doing';
    it.startedAt = now;
    fx.push(it.units.length ? 'beginUnits' : 'beginFree');
  },
  startHold(s, a, now, fx) {
    const it = currentItem(s);
    const unit = currentUnit(s);
    if (!it || it.phase !== 'doing' || !unit || !unit.hold || it.hold) return;
    const ms = unit.hold.seconds * 1000;
    it.hold = { startedAt: now, endsAt: now + ms, remainingMs: ms, durationMs: ms };
    fx.push('holdStarted');
  },
  tick(s, a, now, fx) {
    const it = currentItem(s);
    if (!it || !it.hold || it.hold.endsAt == null || it.hold.endsAt > now) return;
    it.holdsCompletedSeconds += it.hold.durationMs / 1000;
    it.hold = null;
    fx.push('holdComplete');
    advanceUnit(s, it, now, fx);
  },
  repDone(s, a, now, fx) {
    const it = currentItem(s);
    const unit = currentUnit(s);
    if (!it || it.phase !== 'doing' || !unit) return;
    if (it.hold) {
      fx.push('holdRunning');
      return;
    }
    if (unit.hold && unit.hold.required) {
      fx.push('holdNeeded');
      return;
    }
    advanceUnit(s, it, now, fx);
  },
  done(s, a, now, fx) {
    const it = currentItem(s);
    if (!it) return;
    if (it.phase === 'intro') return HANDLERS.begin(s, a, now, fx);
    if (it.phase === 'complete') return HANDLERS.next(s, a, now, fx);
    const remaining = it.units.length - it.unitIndex;
    if (remaining > 0 && !a.confirm) {
      s.pendingConfirm = { type: 'finishEarly', remaining };
      fx.push('confirmFinishEarly');
      return;
    }
    completeItem(s, it, remaining > 0 ? 'partial' : 'completed', now, fx);
  },
  confirm(s, a, now, fx) {
    if (!s.pendingConfirm) return;
    const pending = s.pendingConfirm;
    s.pendingConfirm = null;
    if (pending.type === 'finishEarly') HANDLERS.done(s, { confirm: true }, now, fx);
    if (pending.type === 'finishSession') HANDLERS.finish(s, { confirm: true }, now, fx);
  },
  cancelConfirm(s) {
    s.pendingConfirm = null;
  },
  skip(s, a, now, fx) {
    const it = currentItem(s);
    if (!it || it.phase === 'complete') return;
    it.hold = null;
    completeItem(s, it, it.unitIndex > 0 ? 'partial' : 'skipped', now, fx);
    HANDLERS.next(s, a, now, fx);
  },
  next(s, a, now, fx) {
    const it = currentItem(s);
    if (!it || it.phase !== 'complete') return;
    if (s.index + 1 >= s.items.length) {
      finishSession(s, 'finished', now, fx);
      return;
    }
    s.index += 1;
    fx.push('introExercise');
  },
  pause(s, a, now, fx) {
    if (s.status !== 'active') return;
    s.status = 'paused';
    s.pausedAt = now;
    const it = currentItem(s);
    if (it && it.hold && it.hold.endsAt != null) {
      it.hold.remainingMs = Math.max(0, it.hold.endsAt - now);
      it.hold.endsAt = null;
    }
    fx.push('paused');
  },
  resume(s, a, now, fx) {
    if (s.status !== 'paused') return;
    s.status = 'active';
    s.pausedAt = null;
    const it = currentItem(s);
    if (it && it.hold && it.hold.endsAt == null) it.hold.endsAt = now + it.hold.remainingMs;
    fx.push('resumed');
  },
  symptom(s, a, now) {
    s.events.push({ t: now, type: 'symptom', kind: a.kind, note: a.note || null, exerciseId: currentItem(s)?.exerciseId || null });
  },
  stop(s, a, now, fx) {
    const it = currentItem(s);
    if (it && it.phase !== 'complete') completeItem(s, it, it.unitIndex > 0 ? 'partial' : 'skipped', now, []);
    finishSession(s, 'stopped', now, fx);
  },
  finish(s, a, now, fx) {
    const remaining = s.items.filter((it) => it.phase !== 'complete').length;
    if (remaining > 0 && !a.confirm) {
      s.pendingConfirm = { type: 'finishSession', remaining };
      fx.push('confirmFinishSession');
      return;
    }
    for (const it of s.items) if (it.phase !== 'complete') completeItem(s, it, it.unitIndex > 0 ? 'partial' : 'skipped', now, []);
    finishSession(s, 'finished', now, fx);
  },
};

function advanceUnit(s, it, now, fx) {
  it.unitIndex += 1;
  if (it.unitIndex >= it.units.length) {
    completeItem(s, it, 'completed', now, fx);
    return;
  }
  fx.push('repCounted');
}

function completeItem(s, it, status, now, fx) {
  it.phase = 'complete';
  it.status = status;
  it.hold = null;
  it.finishedAt = now;
  fx.push('exerciseComplete');
}

function finishSession(s, status, now, fx) {
  s.status = status;
  s.finishedAt = now;
  s.pendingConfirm = null;
  fx.push(status === 'finished' ? 'sessionComplete' : 'sessionStopped');
}

const ENDED = new Set(['finished', 'stopped']);
const ALWAYS_ALLOWED = new Set(['setPain', 'symptom', 'confirm', 'cancelConfirm']);

export function apply(state, action, now) {
  const handler = HANDLERS[action.type];
  if (!handler) throw new Error(`Unknown session action: ${action.type}`);
  if (ENDED.has(state.status) && !ALWAYS_ALLOWED.has(action.type)) return { state, effects: [] };
  if (state.status === 'paused' && !['resume', 'stop', ...ALWAYS_ALLOWED].includes(action.type)) {
    return { state, effects: ['pausedIgnored'] };
  }
  const next = clone(state);
  const effects = [];
  handler(next, action, now, effects);
  next.updatedAt = now;
  return { state: next, effects };
}

// Session recovered after the app was closed or the screen locked: complete a
// hold that ran out meanwhile, then report how it looks now.
export function recover(state, now) {
  if (state.status !== 'active') return { state, effects: [] };
  return apply(state, { type: 'tick' }, now);
}

export function summarize(s) {
  const counts = { completed: 0, partial: 0, skipped: 0, pending: 0 };
  let repsDone = 0;
  let holdSeconds = 0;
  for (const it of s.items) {
    counts[it.status] += 1;
    repsDone += it.unitIndex;
    holdSeconds += it.holdsCompletedSeconds;
  }
  const total = s.items.length;
  const score = counts.completed + counts.partial * 0.5;
  return {
    id: s.id,
    programmeId: s.programmeId,
    programmeTitle: s.programmeTitle,
    programmeKind: s.programmeKind,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    status: s.status,
    painBefore: s.painBefore,
    painAfter: s.painAfter,
    total,
    ...counts,
    percent: total ? Math.round((score / total) * 100) : 0,
    repsDone,
    holdSeconds,
    symptoms: s.events.filter((e) => e.type === 'symptom'),
    exercises: s.items.map((it) => ({ exerciseId: it.exerciseId, status: it.status, reps: it.unitIndex, of: it.units.length, holdSeconds: it.holdsCompletedSeconds })),
  };
}

// What "how many left?" answers.
export function remainingText(s) {
  const it = currentItem(s);
  if (!it) return 'All done.';
  const exercisesLeft = s.items.length - s.index - 1;
  const after = exercisesLeft === 1 ? '1 more exercise after this one' : `${exercisesLeft} more exercises after this one`;
  if (!it.units.length) return `No count for this one. ${exercisesLeft ? after : 'This is the last exercise'}.`;
  const unit = currentUnit(s);
  const left = it.units.length - it.unitIndex;
  const sideText = unit && unit.side ? ` Next is your ${unit.side} side, repetition ${unit.rep}.` : '';
  return `${left} ${left === 1 ? 'movement' : 'movements'} left.${sideText} ${exercisesLeft ? after : 'This is the last exercise'}.`;
}
