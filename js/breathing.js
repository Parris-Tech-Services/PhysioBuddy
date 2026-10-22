// Optional paced-breathing break. Not part of any prescription — the UI
// labels it as general relaxation. Pure timing so the animation, captions
// and voice cues all agree on the current phase.

export const PATTERNS = Object.freeze({
  calm: { label: 'Calm (in 4, out 6)', inhale: 4, holdIn: 0, exhale: 6, holdOut: 0 },
  even: { label: 'Even (in 4, out 4)', inhale: 4, holdIn: 0, exhale: 4, holdOut: 0 },
});

export const DURATIONS = Object.freeze([1, 2, 3]);

const PHASES = [['inhale', 'Breathe in'], ['holdIn', 'Hold'], ['exhale', 'Breathe out'], ['holdOut', 'Hold']];

export function cycleSeconds(p) {
  return p.inhale + p.holdIn + p.exhale + p.holdOut;
}

// Phase at `ms` since start: name, caption, seconds left in the phase and
// the circle size from 0 (empty lungs) to 1 (full).
export function breathAt(p, ms) {
  const cycle = cycleSeconds(p) * 1000;
  let t = ((ms % cycle) + cycle) % cycle;
  for (const [key, caption] of PHASES) {
    const len = p[key] * 1000;
    if (!len) continue;
    if (t < len) {
      const frac = t / len;
      const size = key === 'inhale' ? frac : key === 'exhale' ? 1 - frac : key === 'holdIn' ? 1 : 0;
      return { phase: key, caption, secondsLeft: Math.ceil((len - t) / 1000), size, cycle: Math.floor(ms / cycle) + 1 };
    }
    t -= len;
  }
  return { phase: 'inhale', caption: 'Breathe in', secondsLeft: p.inhale, size: 0, cycle: 1 };
}

// Whole cycles that fit the chosen minutes (at least one).
export function totalCycles(p, minutes) {
  return Math.max(1, Math.round((minutes * 60) / cycleSeconds(p)));
}
