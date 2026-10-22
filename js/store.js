// Persistent app state. localStorage holds one versioned JSON document (small,
// synchronous, survives reloads); attached PDFs live in IndexedDB because they
// are binary and larger. Everything stays on this device unless exported.

import { emptyFunction, normaliseFunction } from './function.js';

export const STORE_KEY = 'joshhealth.physio.v1';
export const SCHEMA_VERSION = 1;

export function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      theme: 'auto',
      fontScale: 1,
      voiceOn: true,
      listenOn: false,
      speechRate: 0.95,
      voiceName: null,
      guidedCounting: true,
      repSeconds: 4,
      relaxCues: true,
      figureMode: 'animated',
      sounds: true,
      haptics: true,
      askPain: true,
    },
    activeProgrammeIds: ['acute-neck-2026-10-22'],
    customProgrammes: [],
    customExercises: {},
    programmeOverrides: {},
    reminders: { enabled: false, times: ['06:30', '08:30', '16:30', '18:30', '20:30', '22:30'], snoozeUntil: null, lastNotifiedAt: null, dismissedSlots: {} },
    sessions: [],
    activeSession: null,
    questions: [],
    checkins: {},
    function: emptyFunction(),
  };
}

// Merge stored data over defaults so new settings appear after an update and
// unknown or malformed fields cannot break the app.
export function normaliseState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== SCHEMA_VERSION) return base;
  return {
    ...base,
    settings: { ...base.settings, ...(isObj(raw.settings) ? raw.settings : {}) },
    activeProgrammeIds: Array.isArray(raw.activeProgrammeIds) ? raw.activeProgrammeIds.filter((x) => typeof x === 'string') : base.activeProgrammeIds,
    customProgrammes: Array.isArray(raw.customProgrammes) ? raw.customProgrammes.filter(isValidProgramme) : [],
    customExercises: isObj(raw.customExercises) ? raw.customExercises : {},
    programmeOverrides: isObj(raw.programmeOverrides) ? raw.programmeOverrides : {},
    reminders: { ...base.reminders, ...(isObj(raw.reminders) ? raw.reminders : {}) },
    sessions: Array.isArray(raw.sessions) ? raw.sessions.filter((s) => isObj(s) && typeof s.startedAt === 'number') : [],
    activeSession: isObj(raw.activeSession) && Array.isArray(raw.activeSession.items) ? raw.activeSession : null,
    questions: Array.isArray(raw.questions) ? raw.questions.filter((q) => isObj(q) && typeof q.text === 'string') : [],
    checkins: isObj(raw.checkins) ? raw.checkins : {},
    function: normaliseFunction(raw.function),
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function isValidProgramme(p) {
  return isObj(p) && typeof p.id === 'string' && typeof p.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.prescribedOn || '')
    && (p.kind === 'prescribed' || p.kind === 'custom') && Array.isArray(p.items)
    && p.items.every((it) => isObj(it) && typeof it.exerciseId === 'string' && isObj(it.dose));
}

export function loadState(storage) {
  try {
    const text = storage.getItem(STORE_KEY);
    return normaliseState(text ? JSON.parse(text) : null);
  } catch {
    return defaultState();
  }
}

// Returns false when the browser refuses to store (private mode, quota), so
// the UI can say progress is not being saved instead of failing silently.
export function saveState(storage, state) {
  try {
    storage.setItem(STORE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function exportBackup(state, now) {
  return JSON.stringify({ app: 'joshhealth-physio', exportedAt: new Date(now).toISOString(), data: state }, null, 2);
}

// Import replaces the current state only when the file is a recognised backup.
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not a valid backup (it is not JSON).');
  }
  if (!parsed || parsed.app !== 'joshhealth-physio' || !isObj(parsed.data)) throw new Error('That file is not a physio app backup.');
  if (parsed.data.schemaVersion !== SCHEMA_VERSION) throw new Error('That backup is from an unsupported version.');
  return normaliseState(parsed.data);
}
