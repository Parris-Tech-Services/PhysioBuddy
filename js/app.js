// UI shell: routes, rendering and wiring between the session engine, the voice
// coach, reminders and storage. Clinical facts come only from data.js (or
// programmes the person entered); session rules come only from session.js.
import { PROGRAMMES, EXERCISES, AREAS, CLINICIAN, getProgramme, getExercise, prescriptionHistory, doseChanges, describeDose } from './data.js';
import { createSession, apply, recover, summarize, currentItem, currentUnit, holdRemainingMs, remainingText } from './session.js';
import { TZ, zonedDate, programmeStatus, nextReminder, remindersForDate, slotFor, formatTime12, buildIcs, icsUtc, addDays, sortTimes } from './schedule.js';
import { dailySeries, weeklySummary, weeklyMessage, toCsv, exerciseFeedback } from './progress.js';
import { loadState, saveState, exportBackup, parseBackup, defaultState } from './store.js';
import { mountFigure, renderDiagram, FIGURES } from './figures.js';
import { Coach, Listener, englishVoices } from './voice.js';
import { COMMAND_HELP } from './commands.js';
import { addDoc, listDocs, getDoc, deleteDoc, clearDocs } from './docs.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const now = () => Date.now();
const view = $('#view');

let db = loadState(localStorage);
let storageOk = saveState(localStorage, db);
function save() {
  storageOk = saveState(localStorage, db);
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const allProgrammes = () => [...PROGRAMMES, ...db.customProgrammes];
const programmeById = (id) => getProgramme(id, db.customProgrammes);
const exerciseOf = (id) => getExercise(id, db.customExercises);
const activeProgrammes = () => db.activeProgrammeIds.map(programmeById).filter(Boolean);
const statusOf = (p) => programmeStatus(p, now(), db.programmeOverrides[p.id] || {});
const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtDateTime = (ms) => new Date(ms).toLocaleString('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Settings applied to the page ----------
function applySettings() {
  const s = db.settings;
  const root = document.documentElement;
  if (s.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', s.theme);
  root.style.setProperty('--font-scale', String(s.fontScale));
}

// ---------- Feedback: toast, sound, haptics ----------
let toastTimer = 0;
function toast(text) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

let audioCtx = null;
function beep(freq = 660, ms = 120) {
  if (!db.settings.sounds) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    o.type = 'sine';
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + ms / 1000 + 0.05);
  } catch {
    /* audio unavailable */
  }
}

function buzz(pattern = 30) {
  if (db.settings.haptics && navigator.vibrate) navigator.vibrate(pattern);
}

// ---------- Voice ----------
let caption = '';
let heard = '';
const coach = new Coach({
  getSettings: () => db.settings,
  onCaption: (text) => {
    caption = text;
    const el = $('#caption');
    if (el) el.textContent = text;
  },
  onSpeaking: (on) => listener.suspend(on),
});

let micStatus = { status: 'off', message: '' };
const listener = new Listener({
  onCommand: (cmd, transcript) => handleCommand(cmd, transcript, 'voice'),
  onHeard: (transcript, interim) => {
    heard = interim ? `Hearing: “${transcript.trim()}”` : heard;
    const el = $('#heard');
    if (el && interim) el.textContent = heard;
  },
  onStatus: (status, message) => {
    micStatus = { status, message };
    const el = $('#mic');
    if (el) el.outerHTML = micChip();
    if (message) toast(message);
  },
});

function micChip() {
  const s = micStatus.status;
  const label = { listening: '🎙️ Listening', starting: '🎙️ Starting…', paused: '🎙️ Listening (paused while I speak)', blocked: '🎙️ Mic blocked', unsupported: '🎙️ Voice not available', error: '🎙️ Voice unavailable', off: '🎙️ Voice commands off' }[s] || s;
  const cls = s === 'listening' || s === 'paused' ? 'chip live' : s === 'blocked' || s === 'error' ? 'chip warn' : 'chip';
  return `<button id="mic" class="${cls}" data-action="toggle-mic" aria-pressed="${db.settings.listenOn}">${label}</button>`;
}

function setListening(on) {
  db.settings.listenOn = on;
  save();
  if (on) listener.start();
  else listener.stop();
}

// ---------- Session ----------
const ENCOURAGE = ['Nicely done.', 'Well done — lovely and steady.', 'Good work. That one is done.', 'Great. Gentle and steady wins here.', 'Well done. Take a breath.'];
const RELAX = ['Remember to relax your shoulders.', 'No need to rush.', 'Keep breathing slowly.'];
let encourageIndex = 0;
let countTimer = 0;
let advanceTimer = 0;
let lastHoldMark = null;
let wakeLock = null;
let hurtOpen = false;

const S = () => db.activeSession;

function sessionItems(programme) {
  return programme.items.map((it) => ({ exerciseId: it.exerciseId, name: exerciseOf(it.exerciseId)?.name || it.asPrescribed, dose: it.dose }));
}

function startSession(programmeId, { exerciseId = null } = {}) {
  const programme = programmeById(programmeId);
  if (!programme) return;
  let items = sessionItems(programme);
  if (exerciseId) items = items.filter((it) => it.exerciseId === exerciseId);
  const p = exerciseId ? { ...programme, title: `${programme.title} — practice` } : programme;
  db.activeSession = createSession({ programme: p, items, now: now() });
  save();
  location.hash = '#/session';
  const greeting = programme.items.every((it) => exerciseOf(it.exerciseId)?.areas.includes('neck'))
    ? "Time for your neck exercises. We'll take it gently."
    : "Time for your exercises. We'll take it gently.";
  coach.speak(`${greeting} ${db.settings.askPain ? 'How is your discomfort right now, from zero to ten? Or say ready to start.' : 'Ready to start?'}`);
}

function itemDef(index) {
  const s = S();
  const programme = programmeById(s.programmeId);
  const it = s.items[index];
  const rx = programme ? programme.items.find((x) => x.exerciseId === it.exerciseId) : null;
  return { ex: exerciseOf(it.exerciseId) || { name: it.name, areas: [] }, rx, programme };
}

function dispatch(action) {
  const s = S();
  if (!s) return;
  const before = s.status;
  const res = apply(s, action, now());
  db.activeSession = res.state;
  if (before !== res.state.status && (res.state.status === 'finished' || res.state.status === 'stopped')) archiveSession();
  save();
  handleEffects(res.effects);
  render();
}

function archiveSession() {
  const summary = summarize(S());
  db.sessions = db.sessions.filter((x) => x.id !== summary.id).concat(summary);
  releaseWakeLock();
}

function spokenDose(rx) {
  if (!rx) return '';
  return `${describeDose(rx.dose)}.`;
}

function introText() {
  const s = S();
  const { ex, rx } = itemDef(s.index);
  const parts = [`${s.index === 0 ? 'First' : s.index === s.items.length - 1 ? 'Last one' : 'Next'}: ${ex.name}.`];
  if (ex.movement) parts.push(ex.movement);
  else if (rx) parts.push(rx.instructions);
  parts.push(spokenDose(rx));
  if (rx && rx.limit) parts.push(rx.limit);
  if (ex.hands) parts.push(ex.hands);
  parts.push("Say I'm ready, or tap Ready, when you're set.");
  return parts.filter(Boolean).join(' ');
}

function unitCue(unit, it) {
  const side = unit.side ? `${capitalise(unit.side)}, ` : '';
  if (unit.hold && unit.hold.required) return `${side}${unit.rep}. Get into position, then say start timer for your ${unit.hold.seconds}-second hold.`;
  if (unit.hold && it.unitIndex === 0) return `${side}${unit.rep}. Hold at the end of range for ${unit.hold.seconds} seconds if John showed you to — say start timer to time it, or done to move on.`;
  return `${side}${unit.rep}.`;
}

function handleEffects(effects) {
  const s = S();
  for (const e of effects) {
    if (e === 'introExercise') {
      clearTimeout(countTimer);
      coach.speak(introText());
    } else if (e === 'beginUnits' || e === 'repCounted' || e === 'holdComplete') {
      buzz(20);
      afterUnitChange(e);
    } else if (e === 'beginFree') {
      coach.speak("Take your time and do this as John showed you. Say done when you've finished.");
    } else if (e === 'holdStarted') {
      lastHoldMark = null;
      buzz(40);
      beep(520, 160);
      const u = currentUnit(s);
      coach.speak(`Hold for ${u.hold.seconds} seconds.`, { remember: false });
    } else if (e === 'holdNeeded') {
      const u = currentUnit(s);
      coach.speak(`This one has a ${u.hold.seconds}-second hold. Say start timer when you're in position.`);
    } else if (e === 'holdRunning') {
      coach.speak(`Keep holding — ${Math.ceil(holdRemainingMs(s, now()) / 1000)} seconds left.`, { remember: false });
    } else if (e === 'confirmFinishEarly') {
      coach.speak(`You have ${s.pendingConfirm.remaining} left. Finish this exercise now? Say yes or no.`);
    } else if (e === 'confirmFinishSession') {
      coach.speak(`There ${s.pendingConfirm.remaining === 1 ? 'is 1 exercise' : `are ${s.pendingConfirm.remaining} exercises`} left. Finish the session now? Say yes or no.`);
    } else if (e === 'exerciseComplete') {
      onExerciseComplete();
    } else if (e === 'sessionComplete') {
      clearTimeout(countTimer);
      buzz([40, 60, 40]);
      beep(784, 200);
      coach.speak(`That's the whole session done. Well done for looking after yourself.${db.settings.askPain ? ' How is your discomfort now, from zero to ten?' : ''}`);
    } else if (e === 'sessionStopped') {
      clearTimeout(countTimer);
      coach.speak("Okay, we've stopped. That's completely fine.");
    } else if (e === 'paused') {
      clearTimeout(countTimer);
      coach.speak('Paused. Say resume, or tap Resume, when you are ready.');
    } else if (e === 'resumed') {
      coach.speak('Carrying on.', { remember: false, onEnd: () => scheduleCount() });
    }
  }
}

function afterUnitChange(effect) {
  const s = S();
  const it = currentItem(s);
  const unit = currentUnit(s);
  if (!it || it.phase !== 'doing' || !unit) return;
  let text = unitCue(unit, it);
  if (effect === 'holdComplete') text = `And relax. ${text}`;
  if (db.settings.relaxCues && it.unitIndex > 0 && it.unitIndex % 6 === 0) text += ` ${RELAX[(it.unitIndex / 6) % RELAX.length]}`;
  coach.speak(text, { remember: effect !== 'repCounted', onEnd: () => scheduleCount() });
}

function onExerciseComplete() {
  clearTimeout(countTimer);
  const s = S();
  const it = currentItem(s);
  buzz([30, 40, 30]);
  beep(700, 140);
  const more = s.index + 1 < s.items.length;
  const msg = it.status === 'skipped' ? 'Skipped — no problem.' : ENCOURAGE[encourageIndex++ % ENCOURAGE.length];
  if (it.status === 'skipped') return;
  coach.speak(`${msg}${more ? ' Ready for the next one?' : ''}`, {
    remember: false,
    onEnd: () => scheduleAdvance(RATE_WINDOW_MS),
  });
}

// After an exercise, wait long enough for the optional rating taps, then
// move on by itself so a hands-free session never stalls.
const RATE_WINDOW_MS = 7000;
function scheduleAdvance(ms) {
  clearTimeout(advanceTimer);
  advanceTimer = setTimeout(() => {
    const cur = S();
    if (cur && cur.status === 'active' && currentItem(cur)?.phase === 'complete') dispatch({ type: 'next' });
  }, ms);
}

function rateExercise(field, value) {
  const s = S();
  db.activeSession = apply(s, { type: 'rate', index: s.index, [field]: value }, now()).state;
  save();
  const rating = currentItem(S()).rating || {};
  if (field === 'discomfort' && value === 'more') {
    scheduleAdvance(15000);
    coach.speak("Thanks for telling me. If that triggered a headache or significant pain, it's fine to stop — tap That hurts. Otherwise we'll carry on gently.", { remember: false });
  } else if (rating.discomfort && rating.difficulty) scheduleAdvance(1200);
  else scheduleAdvance(RATE_WINDOW_MS);
  render();
}

// Guided counting: after a rep cue, count it after `repSeconds` unless the
// rep needs a hold (holds are started by the person, never automatically
// counted).
function scheduleCount() {
  clearTimeout(countTimer);
  const s = S();
  if (!s || s.status !== 'active' || !db.settings.guidedCounting || hurtOpen || s.pendingConfirm) return;
  const it = currentItem(s);
  const unit = currentUnit(s);
  if (!it || it.phase !== 'doing' || !unit || unit.hold || it.hold) return;
  countTimer = setTimeout(() => dispatch({ type: 'repDone' }), db.settings.repSeconds * 1000);
}

function tickSession() {
  const s = S();
  if (!s || s.status !== 'active') return;
  const remaining = holdRemainingMs(s, now());
  if (remaining == null) return;
  const secs = Math.ceil(remaining / 1000);
  if (secs === 10 && lastHoldMark !== 10) {
    lastHoldMark = 10;
    coach.speak('Ten seconds.', { remember: false });
  }
  if (secs <= 3 && secs > 0 && lastHoldMark !== secs) {
    lastHoldMark = secs;
    beep(600, 90);
  }
  if (remaining <= 0) dispatch({ type: 'tick' });
  else updateTimer(remaining);
}

function updateTimer(remaining) {
  const it = currentItem(S());
  const el = $('#timer');
  if (!el || !it || !it.hold) return;
  const frac = remaining / it.hold.durationMs;
  $('.num', el).textContent = String(Math.ceil(remaining / 1000));
  $('.bar', el).style.strokeDashoffset = String(CIRC * (1 - frac));
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {
    /* not granted; the screen may dim, timers still recover */
  }
}

function releaseWakeLock() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

// ---------- Commands (voice and buttons share this path) ----------
function handleCommand(cmd, transcript, source) {
  if (source === 'voice') {
    heard = cmd ? `Heard “${transcript.trim()}” ✓` : `Heard “${transcript.trim()}” — not a command`;
    const el = $('#heard');
    if (el) el.textContent = heard;
  }
  if (!cmd) return;
  if (hurtOpen) return hurtCommand(cmd);
  const s = S();
  if (!s || !location.hash.startsWith('#/session')) {
    if (cmd === 'ready') startDefault();
    return;
  }
  if (s.pendingConfirm) {
    if (cmd === 'yes' || cmd === 'done') dispatch({ type: 'confirm' });
    else if (cmd === 'no') {
      dispatch({ type: 'cancelConfirm' });
      coach.speak('Okay, carrying on.', { onEnd: () => scheduleCount() });
    }
    return;
  }
  sessionCommand(cmd, s);
}

function sessionCommand(cmd, s) {
  const it = currentItem(s);
  if (s.status === 'finished' || s.status === 'stopped') {
    if (cmd === 'done' || cmd === 'next' || cmd === 'ready') leaveSession();
    return;
  }
  if (s.status === 'ready') {
    if (['ready', 'done', 'yes', 'next'].includes(cmd)) dispatch({ type: 'start' });
    return;
  }
  if (s.status === 'paused') {
    if (cmd === 'resume' || cmd === 'ready') dispatch({ type: 'resume' });
    else if (cmd === 'finish') dispatch({ type: 'finish' });
    else if (cmd === 'hurt') openHurt();
    else coach.speak('We are paused. Say resume to carry on, or finish session to stop.', { remember: false });
    return;
  }
  const simple = {
    hurt: () => openHurt(),
    finish: () => dispatch({ type: 'finish' }),
    stop: () => dispatch({ type: 'pause' }),
    pause: () => dispatch({ type: 'pause' }),
    repeat: () => coach.repeat(),
    howMany: () => coach.speak(remainingText(s), { remember: false }),
    skip: () => dispatch({ type: 'skip' }),
    startTimer: () => dispatch({ type: 'startHold' }),
  };
  if (simple[cmd]) return simple[cmd]();
  if (cmd === 'next') {
    if (it.phase === 'complete') dispatch({ type: 'next' });
    else coach.speak("Say done when you've finished this one, or skip this one to move on.", { remember: false });
  } else if (cmd === 'ready') {
    if (it.phase === 'intro') dispatch({ type: 'begin' });
    else if (currentUnit(s)?.hold && !it.hold) dispatch({ type: 'startHold' });
  } else if (cmd === 'done') {
    if (it.phase === 'doing' && it.units.length) dispatch({ type: 'repDone' });
    else dispatch({ type: 'done' });
  }
}

function hurtCommand(cmd) {
  if (cmd === 'finish' || cmd === 'stop' || cmd === 'yes') hurtChoice('stop');
  else if (cmd === 'skip') hurtChoice('skip');
  else if (cmd === 'resume' || cmd === 'ready' || cmd === 'no' || cmd === 'next') hurtChoice('continue');
}

function precautionsFor(programmeId) {
  const p = programmeById(programmeId);
  return p ? p.precautions : [];
}

function openHurt() {
  const s = S();
  if (!s) return;
  clearTimeout(countTimer);
  if (s.status === 'active') {
    const res = apply(s, { type: 'pause' }, now());
    db.activeSession = res.state;
  }
  db.activeSession = apply(S(), { type: 'symptom', kind: 'pain' }, now()).state;
  save();
  hurtOpen = true;
  const dlg = $('#hurt');
  const pre = precautionsFor(s.programmeId);
  $('#hurt-precautions').innerHTML = pre.length ? `<ul>${pre.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  if (!dlg.open) dlg.showModal();
  coach.speak("Okay, let's stop for a moment. Do you want to stop the session, skip this exercise, or carry on gently?");
}

function hurtChoice(choice) {
  const dlg = $('#hurt');
  hurtOpen = false;
  if (dlg.open) dlg.close();
  const kind = $('#hurt-headache')?.checked ? 'headache' : null;
  if (kind) db.activeSession = apply(S(), { type: 'symptom', kind: 'headache' }, now()).state;
  if (choice === 'stop') dispatch({ type: 'stop' });
  else if (choice === 'skip') {
    dispatch({ type: 'resume' });
    dispatch({ type: 'skip' });
  } else dispatch({ type: 'resume' });
}

function startDefault() {
  const p = activeProgrammes()[0];
  if (p) startSession(p.id);
}

function leaveSession() {
  clearTimeout(countTimer);
  coach.cancel();
  db.activeSession = null;
  save();
  location.hash = '#/home';
}

// ---------- Reminders ----------
let reminderTimer = 0;
let dueReminder = null;

function reminderProgramme() {
  return activeProgrammes().find((p) => p.defaultReminderTimes && p.defaultReminderTimes.length) || null;
}

function reminderWindow() {
  const p = reminderProgramme();
  if (!p) return null;
  const st = statusOf(p);
  return { programme: p, lastDay: st.temporary ? st.lastDay : null, expired: st.expired };
}

function sessionNear(slotMs) {
  return db.sessions.some((x) => Math.abs(x.startedAt - slotMs) < 75 * 60000 && x.startedAt >= slotMs - 75 * 60000);
}

// The latest reminder slot in the past 90 minutes that has no session yet.
function computeDue() {
  const w = reminderWindow();
  if (!db.reminders.enabled || !w || w.expired) return null;
  if (db.reminders.snoozeUntil && db.reminders.snoozeUntil > now()) return null;
  const today = zonedDate(now());
  const past = remindersForDate(today, db.reminders.times).filter((r) => r.at <= now() && now() - r.at < 90 * 60000);
  const slot = past[past.length - 1];
  if (!slot || sessionNear(slot.at) || db.reminders.dismissedSlots[`${today} ${slot.time}`]) return null;
  return { ...slot, date: today };
}

function scheduleReminders() {
  clearTimeout(reminderTimer);
  dueReminder = computeDue();
  const w = reminderWindow();
  if (!db.reminders.enabled || !w || w.expired) return;
  const next = nextReminder(now(), db.reminders.times, { lastDay: w.lastDay, snoozeUntil: db.reminders.snoozeUntil });
  if (!next) return;
  const wait = Math.max(1000, Math.min(next.at - now(), 30 * 60000));
  reminderTimer = setTimeout(() => {
    if (now() >= next.at - 1000) fireReminder(next);
    scheduleReminders();
    if (location.hash === '#/home' || location.hash === '') render();
  }, wait);
}

async function fireReminder(next) {
  if (next.snooze) db.reminders.snoozeUntil = null;
  db.reminders.lastNotifiedAt = now();
  save();
  if (sessionNear(next.at)) return;
  await showNotification('Time for your neck exercises', `${reminderProgramme()?.title || 'Physio'} — tap Start when you're ready.`);
}

async function showNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      tag: 'physio-reminder',
      renotify: true,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      actions: [
        { action: 'start', title: 'Start' },
        { action: 'snooze10', title: 'Snooze 10 min' },
        { action: 'done', title: 'Mark done' },
      ],
      data: { url: new URL('./', location.href).href },
    });
    return true;
  } catch {
    return false;
  }
}

function snooze(minutes) {
  db.reminders.snoozeUntil = now() + minutes * 60000;
  if (dueReminder) db.reminders.dismissedSlots[`${dueReminder.date} ${dueReminder.time}`] = true;
  save();
  scheduleReminders();
  toast(`Snoozed for ${minutes} minutes. I'll remind you while this app is open.`);
  render();
}

function markDoneFromReminder() {
  const p = reminderProgramme() || activeProgrammes()[0];
  if (!p) return;
  const t = now();
  db.sessions.push({ id: `m-${t}`, programmeId: p.id, programmeTitle: p.title, programmeKind: p.kind, startedAt: t, finishedAt: t, status: 'finished', manual: true, painBefore: null, painAfter: null, total: p.items.length, completed: p.items.length, partial: 0, skipped: 0, pending: 0, percent: 100, repsDone: 0, holdSeconds: 0, symptoms: [], exercises: [] });
  if (dueReminder) db.reminders.dismissedSlots[`${dueReminder.date} ${dueReminder.time}`] = true;
  save();
  scheduleReminders();
  toast('Marked as done. Nice work.');
  render();
}

function handleExternalAction(action) {
  if (action === 'start') startDefault();
  else if (/^snooze(10|20|30)$/.test(action)) snooze(Number(action.slice(6)));
  else if (action === 'done') markDoneFromReminder();
}

function downloadFile(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadIcs() {
  const w = reminderWindow();
  if (!w) return toast('No active programme has reminder times.');
  const today = zonedDate(now());
  const start = today > w.programme.prescribedOn ? today : w.programme.prescribedOn;
  const ics = buildIcs({ title: 'Physio: neck exercises', times: db.reminders.times, startDate: start, lastDay: w.lastDay, url: new URL('./', location.href).href, stamp: icsUtc(now()) });
  downloadFile('physio-reminders.ics', 'text/calendar', ics);
}

// ---------- Rendering ----------
const CIRC = 2 * Math.PI * 70;
let figureCtl = null;
let figureKey = '';
let figureEl = null;

function setNav(route) {
  for (const a of document.querySelectorAll('.nav a')) {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function route() {
  const hash = location.hash || '#/home';
  const [path, arg] = hash.slice(2).split('/');
  return { path: path || 'home', arg: arg ? decodeURIComponent(arg) : null };
}

function render() {
  const { path, arg } = route();
  document.body.classList.toggle('in-session', path === 'session' && Boolean(S()));
  const pages = { home: renderHome, session: renderSession, library: renderLibrary, exercise: () => renderExercise(arg), programme: () => renderProgramme(arg), progress: renderProgress, settings: renderSettings, add: renderAdd, help: renderHelp };
  const fn = pages[path] || renderHome;
  if (path !== 'session') stopFigure();
  fn();
  setNav({ exercise: 'library', programme: 'library', add: 'library', help: 'settings' }[path] || path);
}

function stopFigure() {
  if (figureCtl) figureCtl.stop();
  figureCtl = null;
  figureKey = '';
  figureEl = null;
}

function storageBanner() {
  return storageOk ? '' : '<div class="banner stop" role="alert">This browser is not letting the app save progress (private mode or storage full). Your session will still run, but it will not be remembered.</div>';
}

function painScale(when, value) {
  const btns = Array.from({ length: 11 }, (_, i) => `<button type="button" data-action="pain" data-when="${when}" data-value="${i}" aria-pressed="${value === i}" aria-label="${i} out of 10">${i}</button>`).join('');
  return `<div class="pain-scale" role="group" aria-label="Discomfort from 0 to 10">${btns}</div><p class="small muted">0 = no discomfort, 10 = worst imaginable.</p>`;
}

function renderHome() {
  const active = activeProgrammes();
  const s = S();
  const resume = s && !['finished', 'stopped'].includes(s.status)
    ? `<div class="card"><h2>Pick up where you left off</h2><p class="muted">${esc(s.programmeTitle)} — exercise ${s.index + 1} of ${s.items.length}, started ${fmtDateTime(s.startedAt)}.</p><div class="row"><a class="btn primary" href="#/session">Resume session</a><button class="btn" data-action="discard-session">Start fresh</button></div></div>`
    : '';
  const due = dueReminder
    ? `<div class="banner info" role="status"><strong>It's exercise time (${formatTime12(dueReminder.time)}).</strong><div class="row" style="margin-top:8px"><button class="btn primary small" data-action="start" data-id="${esc(reminderProgramme()?.id)}">Start</button><button class="btn small" data-action="snooze" data-min="10">Snooze 10</button><button class="btn small" data-action="snooze" data-min="20">20</button><button class="btn small" data-action="snooze" data-min="30">30</button><button class="btn small" data-action="mark-done">Mark done</button></div></div>`
    : '';
  const cards = active.map(programmeCard).join('') || `<div class="card"><h2>No programme active</h2><p class="muted">Choose a programme from the Library, or add new instructions from John.</p><a class="btn primary" href="#/library">Open Library</a></div>`;
  view.innerHTML = `
    <header class="topbar"><div><h1>PhysioBuddy</h1><div class="sub">${new Date().toLocaleDateString('en-AU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })}</div></div>${micChip()}</header>
    ${storageBanner()}${due}${resume}${cards}
    <p class="small muted">This app supports ${esc(CLINICIAN.name)}'s prescribed exercises. It does not replace his assessment. If something feels wrong, stop and contact him.</p>`;
}

function programmeCard(p) {
  const st = statusOf(p);
  const dayText = (st.temporary ? `Day ${Math.max(1, st.day)} of ${p.durationDays} · ${esc(p.durationText)}` : esc(p.frequency || '')).replace(/\.$/, '');
  const review = st.temporary && st.expired
    ? `<div class="banner warn"><strong>Time to review this programme with John.</strong> It was prescribed for ${esc(p.durationText.replace(/, then.*/, ''))} from ${fmtDate(p.prescribedOn)}${st.lastDay ? ` (last day ${fmtDate(st.lastDay)})` : ''}. Reminders for it have stopped.
        <div class="row" style="margin-top:8px"><button class="btn small" data-action="extend" data-id="${esc(p.id)}">John said keep going</button><button class="btn small" data-action="deactivate" data-id="${esc(p.id)}">Finished — move to Library</button></div></div>`
    : '';
  return `<section class="card" aria-labelledby="pc-${esc(p.id)}">
    <div class="row"><span class="tag ${p.kind === 'custom' ? 'custom' : 'rx'}">${p.kind === 'custom' ? 'My custom routine' : `Prescribed ${fmtDate(p.prescribedOn)}`}</span></div>
    <h2 id="pc-${esc(p.id)}">${esc(p.title)}</h2>
    <p class="muted small">${dayText}. ${p.items.length} exercises.</p>
    ${review}
    <button class="btn primary huge block" data-action="start" data-id="${esc(p.id)}">▶ Start My Exercises</button>
    ${slotsHtml(p)}
    <div class="row" style="margin-top:10px"><a class="btn small soft" href="#/programme/${encodeURIComponent(p.id)}">Prescription &amp; precautions</a></div>
  </section>`;
}

function slotsHtml(p) {
  if (!p.defaultReminderTimes || !p.defaultReminderTimes.length) return '';
  const times = db.reminders.times;
  const today = zonedDate(now());
  const todays = db.sessions.filter((x) => x.programmeId === p.id && zonedDate(x.startedAt) === today);
  const done = new Set(todays.map((x) => slotFor(x.startedAt, times)));
  const chips = sortTimes(times).map((t) => `<div class="slot ${done.has(t) ? 'done' : ''}">${done.has(t) ? '✓ ' : ''}${formatTime12(t)}</div>`).join('');
  const off = db.reminders.enabled ? '' : '<p class="small"><a href="#/settings">Turn on reminders</a> for these times.</p>';
  return `<h3>Today</h3><div class="slots" aria-label="Today's sessions">${chips}</div>${off}<p class="small muted">${todays.length ? `${todays.length} ${todays.length === 1 ? 'session' : 'sessions'} today. Lovely work.` : 'Every session counts — start whenever suits you.'}</p>`;
}

function renderSession() {
  const s = S();
  if (!s) {
    location.hash = '#/home';
    return;
  }
  if (s.status === 'ready') return renderPre(s);
  if (s.status === 'finished' || s.status === 'stopped') return renderFinished(s);
  requestWakeLock();
  const it = currentItem(s);
  const { ex, rx } = itemDef(s.index);
  const unit = currentUnit(s);
  const done = s.items.filter((x) => x.phase === 'complete').length;
  const pct = Math.round(((done + (it.units.length ? it.unitIndex / it.units.length : 0)) / s.items.length) * 100);
  const handsfree = document.body.classList.contains('handsfree');
  view.innerHTML = `
    <header class="topbar"><button class="btn small" data-action="exit-session" aria-label="Leave session (progress is saved)">✕</button><div class="spacer"></div>${micChip()}<button class="btn small" data-action="handsfree" aria-pressed="${handsfree}">${handsfree ? 'Standard view' : 'Hands-free view'}</button></header>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Session progress"><div style="width:${pct}%"></div></div>
    <p class="small muted" style="margin:6px 0 0">Exercise ${s.index + 1} of ${s.items.length} · ${esc(s.programmeTitle)}</p>
    <h1 class="ex-title">${esc(ex.name)}</h1>
    <div class="dose">${rx ? esc(describeDose(rx.dose)) : ''}</div>
    ${rx && rx.limit ? `<div class="limit">⚠ ${esc(rx.limit)}</div>` : ''}
    ${s.status === 'paused' ? '<div class="banner warn" role="status"><strong>Paused.</strong> Your place is saved.</div>' : ''}
    ${confirmHtml(s)}
    <div class="figure-box" id="figure-slot">${ex.figure ? '' : clarifyHtml()}</div>
    ${stageHtml(s, it, unit, rx)}
    <div class="caption" id="caption" aria-live="polite">${esc(caption)}</div>
    <div class="heard" id="heard" aria-live="polite">${esc(heard)}</div>
    ${detailsHtml(ex, rx)}`;
  mountSessionFigure(ex, unit, it);
  if (it.hold) updateTimer(holdRemainingMs(s, now()));
}

function clarifyHtml() {
  return '<div class="banner warn">No picture: the prescription does not describe this movement clearly enough to illustrate. Do it only as John demonstrated, or skip it and ask him.</div>';
}

function mountSessionFigure(ex, unit, it) {
  const slot = $('#figure-slot');
  if (!ex.figure || !slot) return;
  const side = unit && unit.side && it.phase === 'doing' ? unit.side : null;
  const key = `${ex.figure}|${side}|${db.settings.figureMode}`;
  if (key !== figureKey || !figureEl) {
    if (figureCtl) figureCtl.stop();
    figureEl = document.createElement('div');
    figureCtl = mountFigure(figureEl, ex.figure, { mode: db.settings.figureMode, side, reducedMotion: reducedMotion() });
    figureKey = key;
  }
  slot.prepend(figureEl);
  const cap = document.createElement('div');
  cap.className = 'cap';
  cap.textContent = `${FIGURES[ex.figure].caption}${side ? ` · ${side} side` : ''} · faint figure = start position`;
  slot.append(cap);
}

function confirmHtml(s) {
  if (!s.pendingConfirm) return '';
  const q = s.pendingConfirm.type === 'finishEarly'
    ? `You have ${s.pendingConfirm.remaining} left. Finish this exercise now?`
    : `${s.pendingConfirm.remaining} ${s.pendingConfirm.remaining === 1 ? 'exercise is' : 'exercises are'} left. Finish the session now?`;
  return `<div class="banner info" role="alertdialog" aria-label="Confirm"><strong>${q}</strong><div class="two actions"><button class="btn primary" data-action="confirm">Yes</button><button class="btn" data-action="cancel-confirm">No, keep going</button></div></div>`;
}

function stageHtml(s, it, unit, rx) {
  const hurt = '<button class="btn stop" data-action="hurt">That hurts</button>';
  const paused = s.status === 'paused';
  const pauseBtn = paused ? '<button class="btn primary" data-action="resume">▶ Resume</button>' : '<button class="btn" data-action="pause">❚❚ Pause</button>';
  if (it.phase === 'intro') {
    return `<div class="actions">
      <button class="btn primary huge" data-action="begin" ${paused ? 'disabled' : ''}>I'm ready</button>
      <div class="three hide-handsfree"><button class="btn" data-action="repeat">🔊 Repeat</button><button class="btn" data-action="skip" ${paused ? 'disabled' : ''}>Skip</button>${pauseBtn}</div>
      ${hurt}</div>`;
  }
  if (it.phase === 'complete') {
    const rate = it.status === 'skipped' ? '' : ratingHtml(it.rating || {});
    return `<div class="celebrate"><div class="big-emoji" aria-hidden="true">✓</div><p><strong>${it.status === 'skipped' ? 'Skipped' : 'Done'}</strong></p></div>${rate}<div class="actions"><button class="btn primary huge" data-action="next">Next exercise →</button></div>`;
  }
  if (!it.units.length) {
    return `<p class="muted" style="text-align:center">No count prescribed — do this as John showed you.</p>
      <div class="actions"><button class="btn primary huge" data-action="done" ${paused ? 'disabled' : ''}>✓ Done</button>
      <div class="three hide-handsfree"><button class="btn" data-action="repeat">🔊 Repeat</button><button class="btn" data-action="skip">Skip</button>${pauseBtn}</div>${hurt}</div>`;
  }
  const holdUi = it.hold || (unit.hold && unit.hold.required) ? timerHtml(it, unit) : '';
  const dots = it.units.map((u, i) => `<span class="${i < it.unitIndex ? 'on' : ''}" title="${u.side ? `${u.side} ` : ''}${u.rep}"></span>`).join('');
  const perSide = rx && rx.dose.sides ? ` each side` : '';
  const primary = it.hold
    ? `<button class="btn huge" disabled>Holding… breathe slowly</button>`
    : unit.hold && unit.hold.required
      ? `<button class="btn primary huge" data-action="start-hold" ${paused ? 'disabled' : ''}>Start ${unit.hold.seconds}-second hold</button>`
      : `<button class="btn primary huge" data-action="rep" ${paused ? 'disabled' : ''}>✓ Rep done</button>`;
  const optionalHold = unit.hold && !unit.hold.required && !it.hold ? `<button class="btn soft" data-action="start-hold">Time a ${unit.hold.seconds}-second hold (optional)</button>` : '';
  const guided = db.settings.guidedCounting && !unit.hold ? `<p class="small muted" style="text-align:center">Counting for you every ${db.settings.repSeconds} seconds. Tap Rep done to go faster.</p>` : '';
  return `${unit.side ? `<div class="side-label">${capitalise(unit.side)} side</div>` : ''}
    <div class="counter" aria-live="polite"><span class="big">${unit.rep}</span><span class="of">of ${rx ? rx.dose.reps : '?'}${perSide}</span></div>
    <div class="dots" aria-hidden="true">${dots}</div>
    ${holdUi}${guided}
    <div class="actions">${primary}${optionalHold}
      <div class="three hide-handsfree"><button class="btn" data-action="repeat">🔊 Repeat</button><button class="btn" data-action="finish-exercise">Finish exercise</button>${pauseBtn}</div>
      <button class="btn hide-handsfree" data-action="skip">Skip this one</button>
      ${hurt}
    </div>`;
}

const RATING_LABELS = {
  discomfort: { none: 'No discomfort', mild: 'Mild', more: 'More than usual' },
  difficulty: { easy: 'Easy', ok: 'OK', hard: 'Hard' },
};

function ratingHtml(rating) {
  const group = (field, title) => `<div class="rate-group" role="group" aria-label="${title}"><span class="small muted">${title}</span><div class="row">${Object.entries(RATING_LABELS[field]).map(([v, label]) => `<button class="chip" data-action="rate" data-field="${field}" data-value="${v}" aria-pressed="${rating[field] === v}">${label}</button>`).join('')}</div></div>`;
  const warn = rating.discomfort === 'more' ? '<div class="banner warn small">If this triggered a headache or significant pain, stop and contact John. Tap <strong>That hurts</strong> on the next screen to stop.</div>' : '';
  return `<div class="card stack"><strong>How did that feel? <span class="muted small">(optional)</span></strong>${group('discomfort', 'Discomfort')}${group('difficulty', 'Difficulty')}${warn}</div>`;
}

function timerHtml(it, unit) {
  const secs = it.hold ? Math.ceil(it.hold.remainingMs / 1000) : unit.hold.seconds;
  return `<div class="timer" id="timer" role="timer" aria-label="Hold timer"><svg viewBox="0 0 160 160"><circle class="track" cx="80" cy="80" r="70" fill="none" stroke-width="12"/><circle class="bar" cx="80" cy="80" r="70" fill="none" stroke-width="12" stroke-linecap="round" stroke-dasharray="${CIRC}" stroke-dashoffset="${it.hold ? 0 : 0}"/></svg><div class="num">${secs}</div></div>`;
}

function detailsHtml(ex, rx) {
  const facts = [['Start', ex.start], ['Movement', ex.movement], ['End', ex.end], ['Area', ex.target], ['Hands', ex.hands]].filter(([, v]) => v);
  const flags = rx && rx.flags ? `<div class="banner warn small">${rx.flags.map(esc).join('<br>')}</div>` : '';
  return `<details class="hide-handsfree"><summary>Detailed instructions</summary>
    ${rx ? `<p><strong>John's instructions:</strong> ${esc(rx.instructions)}</p>` : ''}
    <dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${flags}
    <p class="small muted">Prescribed exercise names: ${esc(rx ? rx.asPrescribed : ex.clinicalName || ex.name)}.</p></details>`;
}

function renderPre(s) {
  const p = programmeById(s.programmeId);
  view.innerHTML = `
    <header class="topbar"><button class="btn small" data-action="exit-session">✕</button><div class="spacer"></div>${micChip()}</header>
    <h1 class="ex-title">${esc(s.programmeTitle)}</h1>
    <p class="muted">${s.items.length} ${s.items.length === 1 ? 'exercise' : 'exercises'}. One at a time — I'll guide you.</p>
    ${p && p.precautions.length ? `<div class="banner warn small">${p.precautions.map(esc).join('<br>')}</div>` : ''}
    ${db.settings.askPain ? `<div class="card"><h2>How is your discomfort right now?</h2>${painScale('before', s.painBefore)}</div>` : ''}
    <button class="btn primary huge block" data-action="begin-session">▶ Start</button>
    <div class="caption" id="caption" aria-live="polite" style="margin-top:12px">${esc(caption)}</div>
    <div class="heard" id="heard">${esc(heard)}</div>
    <details><summary>What can I say?</summary><dl class="facts">${COMMAND_HELP.map(([k, v]) => `<dt>“${esc(k)}”</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>`;
}

function renderFinished(s) {
  const sum = db.sessions.find((x) => x.id === s.id) || summarize(s);
  const stopped = s.status === 'stopped';
  const pre = stopped ? precautionsFor(s.programmeId) : [];
  view.innerHTML = `
    <div class="celebrate"><div class="big-emoji" aria-hidden="true">${stopped ? '🌿' : '🎉'}</div>
    <h1>${stopped ? 'Session stopped' : 'Session complete'}</h1>
    <p class="muted">${stopped ? "Stopping when something doesn't feel right is the right call." : 'Well done for looking after yourself.'}</p></div>
    ${pre.length ? `<div class="banner warn">${pre.map(esc).join('<br>')}</div>` : ''}
    <div class="card"><h2>Summary</h2><p>${sum.completed} completed, ${sum.partial} partly done, ${sum.skipped} skipped.</p><p class="muted small">${sum.repsDone} movements counted · ${Math.round(sum.holdSeconds)} seconds of holds.</p></div>
    ${db.settings.askPain ? `<div class="card"><h2>How is your discomfort now?</h2>${painScale('after', s.painAfter)}</div>` : ''}
    <button class="btn primary huge block" data-action="leave-session">Back to Today</button>
    <div class="caption" id="caption" style="margin-top:12px">${esc(caption)}</div>`;
}

function renderLibrary() {
  const progs = allProgrammes().slice().sort((a, b) => b.prescribedOn.localeCompare(a.prescribedOn));
  const byArea = Object.entries(AREAS).map(([key, label]) => {
    const ids = Object.keys({ ...EXERCISES, ...db.customExercises }).filter((id) => exerciseOf(id).areas.includes(key));
    if (!ids.length) return '';
    return `<h3>${label}</h3><ul class="list">${ids.map(exerciseRow).join('')}</ul>`;
  }).join('');
  const changes = doseChanges(allProgrammes());
  view.innerHTML = `
    <header class="topbar"><h1>Library</h1><a class="btn small primary" href="#/add">+ Add instructions</a></header>
    <section class="card"><h2>Programmes</h2><ul class="list">${progs.map(programmeRow).join('')}</ul>
      <p class="small muted">Only programmes marked Active appear on Today. Older prescriptions are never merged into today's treatment.</p></section>
    ${changes.length ? `<section class="card"><h2>Dose changed between prescriptions</h2><p class="small muted">These exercises were prescribed with different doses on different dates. Each programme keeps its own dose — check with John which applies now.</p><ul class="list">${changes.map((c) => `<li><a href="#/exercise/${encodeURIComponent(c.exerciseId)}">${esc(exerciseOf(c.exerciseId).name)}</a><div class="small muted">${c.history.map((h) => `${fmtDate(h.programme.prescribedOn)}: ${esc(describeDose(h.item.dose))}`).join(' · ')}</div></li>`).join('')}</ul></section>` : ''}
    <section class="card"><h2>All exercises</h2>${byArea}</section>`;
}

function programmeRow(p) {
  const active = db.activeProgrammeIds.includes(p.id);
  return `<li><div class="row"><div><a href="#/programme/${encodeURIComponent(p.id)}"><strong>${esc(p.title)}</strong></a><div class="small muted">${p.kind === 'custom' ? 'My custom routine' : `Prescribed by ${esc(p.clinician)}`} · ${fmtDate(p.prescribedOn)}</div></div><div class="spacer"></div>${active ? '<span class="chip ok">Active</span>' : ''}</div></li>`;
}

function exerciseRow(id) {
  const ex = exerciseOf(id);
  const thumb = ex.figure ? renderDiagram(ex.figure) : '<span aria-hidden="true">?</span>';
  const n = prescriptionHistory(id, allProgrammes()).length;
  return `<li><a class="ex-link" href="#/exercise/${encodeURIComponent(id)}"><span class="thumb">${thumb}</span><span><strong>${esc(ex.name)}</strong><br><span class="small muted">${n} ${n === 1 ? 'prescription' : 'prescriptions'}${ex.figure ? '' : ' · needs clarification'}</span></span></a></li>`;
}

function renderExercise(id) {
  const ex = exerciseOf(id);
  if (!ex) return renderLibrary();
  const hist = prescriptionHistory(id, allProgrammes());
  const facts = [['Start', ex.start], ['Movement', ex.movement], ['End', ex.end], ['Area', ex.target], ['Hands', ex.hands]].filter(([, v]) => v);
  const mode = db.settings.figureMode;
  view.innerHTML = `
    <header class="topbar"><a class="btn small" href="#/library">← Library</a></header>
    <h1 class="ex-title">${esc(ex.name)}</h1><p class="muted small">${esc(ex.clinicalName || '')}</p>
    ${ex.figure ? `<div class="row" role="group" aria-label="Picture style">${['animated', 'diagram', 'pictures'].map((m) => `<button class="chip" data-action="figure-mode" data-mode="${m}" aria-pressed="${mode === m}">${{ animated: 'Animation', diagram: 'Diagram', pictures: 'Start & end' }[m]}</button>`).join('')}</div><div class="figure-box" id="ex-fig"></div><p class="small muted" style="text-align:center">${esc(FIGURES[ex.figure].caption)}. Orange = area being moved; dotted arrow = direction.</p>` : clarifyHtml()}
    ${facts.length ? `<div class="card"><h2>How to</h2><dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>` : ''}
    <div class="card"><h2>Prescription history</h2><ul class="list">${hist.map(({ programme: p, item }) => `<li><strong>${fmtDate(p.prescribedOn)}</strong> — <a href="#/programme/${encodeURIComponent(p.id)}">${esc(p.title)}</a>${db.activeProgrammeIds.includes(p.id) ? ' <span class="chip ok">Active</span>' : ''}
      <div>${esc(item.asPrescribed)}: “${esc(item.instructions)}”</div><div class="small"><strong>Dose:</strong> ${esc(describeDose(item.dose))}${item.dose.frequency ? ` · ${esc(item.dose.frequency)}` : ''}</div>
      ${item.flags ? `<div class="banner warn small">${item.flags.map(esc).join('<br>')}</div>` : ''}
      <div class="small muted">Source: ${esc(p.source || 'Entered by you')}</div>
      <button class="btn small soft" data-action="practice" data-id="${esc(p.id)}" data-ex="${esc(id)}">Practise with this dose</button></li>`).join('')}</ul></div>`;
  if (ex.figure) mountFigure($('#ex-fig'), ex.figure, { mode, reducedMotion: reducedMotion() });
}

function gmailLink(p) {
  if (p.kind !== 'prescribed' || !p.source || !/emailed/.test(p.source)) return '';
  const after = addDays(p.prescribedOn, -1).replace(/-/g, '/');
  const before = addDays(p.prescribedOn, 2).replace(/-/g, '/');
  const q = encodeURIComponent(`from:nookal.com after:${after} before:${before}`);
  return `<a class="btn small soft" href="https://mail.google.com/mail/u/0/#search/${q}" target="_blank" rel="noopener">Open the original email in Gmail</a>`;
}

function renderProgramme(id) {
  const p = programmeById(id);
  if (!p) return renderLibrary();
  const active = db.activeProgrammeIds.includes(p.id);
  const st = statusOf(p);
  view.innerHTML = `
    <header class="topbar"><a class="btn small" href="#/library">← Library</a></header>
    <span class="tag ${p.kind === 'custom' ? 'custom' : 'rx'}">${p.kind === 'custom' ? 'My custom routine — not prescribed' : `Prescribed by ${esc(p.clinician)}`}</span>
    <h1 class="ex-title">${esc(p.title)}</h1>
    <p class="muted">${fmtDate(p.prescribedOn)}${p.focus ? ` · ${esc(p.focus)}` : ''}</p>
    <div class="card"><dl class="facts"><dt>How often</dt><dd>${esc(p.frequency || 'Not specified')}</dd><dt>How long</dt><dd>${esc(p.durationText || 'Not specified')}${st.temporary ? ` (last day ${fmtDate(st.lastDay)})` : ''}</dd>${p.position ? `<dt>Position</dt><dd>${esc(p.position)}</dd>` : ''}<dt>Source</dt><dd>${esc(p.source || 'Entered by you')}</dd></dl>
      ${p.precautions.length ? `<h3>Precautions</h3><ul>${p.precautions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="row">${active ? `<button class="btn" data-action="deactivate" data-id="${esc(p.id)}">Remove from Today</button><button class="btn primary" data-action="start" data-id="${esc(p.id)}">▶ Start</button>` : `<button class="btn primary" data-action="activate" data-id="${esc(p.id)}">Add to Today</button>`}</div></div>
    <div class="card"><h2>Original prescription</h2><p class="small muted">Exactly as written in the summary:</p>
      <ol>${p.items.map((it) => `<li><strong>${esc(it.asPrescribed)}</strong> — ${esc(it.instructions)}${it.flags ? `<div class="small" style="color:var(--warn)">${it.flags.map(esc).join(' ')}</div>` : ''}</li>`).join('')}</ol>
      <div class="row">${gmailLink(p)}</div>
      <h3>PDF copies on this phone</h3><p class="small muted">Attach the PDF from John. It stays on this device only — it is never uploaded.</p>
      <ul class="list" id="docs"><li class="muted small">Loading…</li></ul>
      <label class="btn small soft"><input type="file" accept="application/pdf,image/*" data-action="attach" data-id="${esc(p.id)}" hidden>📎 Attach PDF</label></div>`;
  refreshDocs(p.id);
}

async function refreshDocs(programmeId) {
  const el = $('#docs');
  if (!el) return;
  try {
    const docs = await listDocs(programmeId);
    el.innerHTML = docs.length ? docs.map((d) => `<li class="row"><span>📄 ${esc(d.name)}</span><span class="spacer"></span><button class="btn small" data-action="open-doc" data-doc="${esc(d.id)}">Open</button><button class="btn small" data-action="remove-doc" data-doc="${esc(d.id)}" data-id="${esc(programmeId)}">Remove</button></li>`).join('') : '<li class="small muted">No PDF attached yet.</li>';
  } catch {
    el.innerHTML = '<li class="small muted">This browser does not allow storing files here.</li>';
  }
}

function barChart(series) {
  const w = 320;
  const h = 120;
  const max = Math.max(3, ...series.map((d) => d.sessions));
  const bw = w / series.length;
  const bars = series.map((d, i) => {
    const fullH = (d.full / max) * (h - 24);
    const partH = (d.partial / max) * (h - 24);
    const x = i * bw + 3;
    return `<rect class="bar" x="${x}" y="${h - 16 - fullH}" width="${bw - 6}" height="${fullH}" rx="3"/><rect class="bar partial" x="${x}" y="${h - 16 - fullH - partH}" width="${bw - 6}" height="${partH}" rx="3"/>${i % 2 === 0 ? `<text class="axis" x="${x + (bw - 6) / 2}" y="${h - 2}" text-anchor="middle">${Number(d.date.slice(8))}</text>` : ''}`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Sessions per day over the last ${series.length} days"><line class="grid" x1="0" x2="${w}" y1="${h - 16}" y2="${h - 16}"/>${bars}</svg>`;
}

function painChart(series) {
  const w = 320;
  const h = 120;
  const pts = (key) => series.map((d, i) => (d[key] == null ? null : [i * (w / (series.length - 1 || 1)), 8 + (1 - d[key] / 10) * (h - 30)])).filter(Boolean);
  const line = (p, cls) => (p.length > 1 ? `<polyline class="${cls}" points="${p.map((q) => q.join(',')).join(' ')}"/>` : '');
  const dots = (p, cls) => p.map((q) => `<circle class="${cls}" cx="${q[0]}" cy="${q[1]}" r="3.5"/>`).join('');
  const b = pts('painBefore');
  const a = pts('painAfter');
  if (!b.length && !a.length) return '<p class="small muted">Record your discomfort before and after a session to see a trend here.</p>';
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Average discomfort before and after sessions"><text class="axis" x="0" y="10">10</text><text class="axis" x="0" y="${h - 20}">0</text>${line(b, 'line')}${dots(b, 'dot')}${line(a, 'line2')}${dots(a, 'dot2')}</svg><p class="small"><span style="color:var(--accent)">●</span> before &nbsp; <span style="color:var(--primary)">●</span> after</p>`;
}

function renderProgress() {
  const today = zonedDate(now());
  const series = dailySeries(db.sessions, today, 14);
  const w = weeklySummary(db.sessions, today);
  const recent = db.sessions.slice().sort((a, b) => b.startedAt - a.startedAt).slice(0, 25);
  view.innerHTML = `
    <header class="topbar"><h1>Progress</h1></header>
    <section class="card"><h2>This week</h2><p>${esc(weeklyMessage(w))}</p>
      <div class="row"><span class="chip">${w.sessions} ${w.sessions === 1 ? 'session' : 'sessions'}</span><span class="chip">${w.activeDays}/7 days</span>${w.averageCompletion != null ? `<span class="chip">${w.averageCompletion}% average completion</span>` : ''}${w.symptomReports ? `<span class="chip warn">${w.symptomReports} symptom reports</span>` : ''}</div></section>
    <section class="card"><h2>Sessions, last 14 days</h2>${barChart(series)}<p class="small muted">Solid = full session, outlined = partly done.</p></section>
    <section class="card"><h2>Discomfort</h2>${painChart(series)}</section>
    ${feedbackHtml(addDays(today, -13))}
    ${calendarHtml(today)}
    <section class="card"><h2>History</h2>${recent.length ? `<ul class="list">${recent.map(historyRow).join('')}</ul>` : '<p class="muted">Your sessions will appear here.</p>'}
      <div class="row"><button class="btn small" data-action="export-csv">Export CSV</button><button class="btn small" data-action="print">Print report</button></div></section>`;
}

function feedbackHtml(fromDate) {
  const rows = exerciseFeedback(db.sessions, fromDate).filter((r) => exerciseOf(r.exerciseId));
  if (!rows.length) return '';
  const parts = (r) => [
    r.discomfort.more && `${r.discomfort.more}× more discomfort than usual`,
    r.discomfort.mild && `${r.discomfort.mild}× mild discomfort`,
    r.difficulty.hard && `${r.difficulty.hard}× hard`,
    r.difficulty.easy && `${r.difficulty.easy}× easy`,
  ].filter(Boolean).join(' · ') || 'No ratings yet';
  return `<section class="card"><h2>How each exercise felt</h2><p class="small muted">Last 14 days, from the optional ratings after each exercise.</p><ul class="list">${rows.map((r) => `<li><strong>${esc(exerciseOf(r.exerciseId).name)}</strong> <span class="small muted">· done ${r.done}×</span><div class="small${r.discomfort.more ? '" style="color:var(--warn)' : ''}">${parts(r)}</div></li>`).join('')}</ul></section>`;
}

function calendarHtml(today) {
  const [y, m] = today.split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const startDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const counts = new Map(dailySeries(db.sessions, addDays(first, daysInMonth - 1), daysInMonth).map((d) => [d.date, d.sessions]));
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push('<div></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const date = addDays(first, d - 1);
    const n = counts.get(date) || 0;
    cells.push(`<div class="slot ${n ? 'done' : ''}" aria-label="${date}: ${n} sessions"${date === today ? ' style="outline:2px solid var(--primary)"' : ''}>${d}${n ? `<br><span class="small">${n}✓</span>` : ''}</div>`);
  }
  return `<section class="card"><h2>${new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</h2><div class="slots" style="grid-template-columns:repeat(7,1fr)">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div class="small muted" style="text-align:center">${d}</div>`).join('')}${cells.join('')}</div></section>`;
}

function historyRow(x) {
  const pain = x.painBefore != null || x.painAfter != null ? ` · discomfort ${x.painBefore ?? '–'} → ${x.painAfter ?? '–'}` : '';
  const label = x.manual ? 'Marked done from reminder' : x.status === 'stopped' ? 'Stopped early' : `${x.percent}% complete`;
  return `<li><strong>${fmtDateTime(x.startedAt)}</strong><div class="small">${esc(x.programmeTitle)} · ${label}${pain}</div>${x.symptoms && x.symptoms.length ? `<div class="small" style="color:var(--warn)">Reported: ${x.symptoms.map((e) => esc(e.kind)).join(', ')}</div>` : ''}</li>`;
}

function renderSettings() {
  const s = db.settings;
  const voices = englishVoices();
  const w = reminderWindow();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const next = w && !w.expired && db.reminders.enabled ? nextReminder(now(), db.reminders.times, { lastDay: w.lastDay, snoozeUntil: db.reminders.snoozeUntil }) : null;
  view.innerHTML = `
    <header class="topbar"><h1>Settings</h1><a class="btn small" href="#/help">Help</a></header>
    <section class="card"><h2>Look and feel</h2>
      <label class="field">Theme<select data-setting="theme"><option value="auto">Match my phone</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label class="field">Text size<select data-setting="fontScale" data-type="number"><option value="0.9">Smaller</option><option value="1">Normal</option><option value="1.15">Large</option><option value="1.3">Extra large</option></select></label>
      <label class="field">Pictures<select data-setting="figureMode"><option value="animated">Animated demonstration</option><option value="diagram">Simple diagram</option><option value="pictures">Start and end pictures</option></select></label>
      ${toggle('sounds', 'Gentle countdown sounds')}${toggle('haptics', 'Vibration feedback')}${toggle('askPain', 'Ask about discomfort before and after')}
    </section>
    <section class="card"><h2>Voice coach</h2>
      ${toggle('voiceOn', 'Speak instructions aloud')}
      <label class="field">Speaking speed <span class="muted small">(${s.speechRate.toFixed(2)}×)</span><input type="range" min="0.6" max="1.4" step="0.05" data-setting="speechRate" data-type="number" value="${s.speechRate}"></label>
      <label class="field">Voice<select data-setting="voiceName"><option value="">Automatic (Australian English if available)</option>${voices.map((v) => `<option value="${esc(v.name)}">${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select></label>
      <button class="btn small" data-action="test-voice">🔊 Test voice</button>
      ${toggle('listenOn', 'Listen for voice commands')}
      <p class="small muted">${listener.supported ? 'Uses the microphone only while the app is open. Every command also has a button.' : 'This browser does not support voice commands — buttons work everywhere.'}</p>
      ${toggle('guidedCounting', 'Count reps for me')}
      <label class="field">Seconds per rep when counting<select data-setting="repSeconds" data-type="number">${[3, 4, 5, 6, 8].map((n) => `<option value="${n}">${n} seconds</option>`).join('')}</select></label>
      ${toggle('relaxCues', 'Remind me to relax my shoulders and not rush')}
    </section>
    <section class="card"><h2>Reminders</h2>
      ${w ? `<p class="small muted">For <strong>${esc(w.programme.title)}</strong>${w.lastDay ? `, until ${fmtDate(w.lastDay)}` : ''}. Times are Sydney time.</p>` : '<p class="small muted">No active programme has reminder times.</p>'}
      ${w && w.expired ? '<div class="banner warn small">This programme has passed its review date, so reminders have stopped.</div>' : ''}
      <div class="switch"><span>App reminders</span><input type="checkbox" data-action="toggle-reminders" ${db.reminders.enabled ? 'checked' : ''}></div>
      <div class="times">${db.reminders.times.map((t, i) => `<input type="time" value="${t}" data-action="time" data-index="${i}" aria-label="Reminder ${i + 1}"><button class="btn small" data-action="remove-time" data-index="${i}" aria-label="Remove ${formatTime12(t)}">✕</button>`).join('')}<button class="btn small" data-action="add-time">+ Add time</button></div>
      <p class="small">Notification permission: <strong>${esc(perm)}</strong>${next ? ` · next: ${fmtDateTime(next.at)}` : ''}</p>
      <div class="row"><button class="btn small" data-action="notif-permission">Allow notifications</button><button class="btn small" data-action="test-notification">Send test notification</button></div>
      <div class="banner info small"><strong>Reliable reminders:</strong> web apps can only show reminders while Chrome keeps the app alive, so they may not appear when the phone has been idle. For dependable alerts, add the reminder times to your calendar:<div class="row" style="margin-top:8px"><button class="btn small" data-action="ics">Download calendar reminders (.ics)</button></div></div>
    </section>
    <section class="card"><h2>Your data</h2><p class="small muted">Stored only on this device. Nothing is sent anywhere.</p>
      <div class="row"><button class="btn small" data-action="export-json">Back up (JSON)</button><label class="btn small"><input type="file" accept="application/json" data-action="import" hidden>Restore backup</label><button class="btn small" data-action="export-csv">Export CSV</button></div>
      <p class="small" id="persist"></p>
      <button class="btn small stop" data-action="wipe">Delete all app data</button></section>`;
  for (const el of view.querySelectorAll('select[data-setting]')) el.value = String(s[el.dataset.setting] ?? '');
  showPersistence();
}

function toggle(key, label) {
  return `<label class="switch"><span>${label}</span><input type="checkbox" data-setting="${key}" data-type="bool" ${db.settings[key] ? 'checked' : ''}></label>`;
}

async function showPersistence() {
  const el = $('#persist');
  if (!el || !navigator.storage || !navigator.storage.persisted) return;
  const persisted = await navigator.storage.persisted();
  el.textContent = persisted ? 'Storage is protected from automatic clearing.' : 'Tip: install the app (Add to Home screen) so Chrome keeps your progress safe.';
}

function renderHelp() {
  view.innerHTML = `
    <header class="topbar"><a class="btn small" href="#/settings">← Settings</a></header>
    <h1 class="ex-title">Help</h1>
    <div class="card"><h2>Voice commands</h2><dl class="facts">${COMMAND_HELP.map(([k, v]) => `<dt>“${esc(k)}”</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <p class="small muted">“Done” counts one rep at a time; it never finishes a whole exercise without asking. The app does not watch or detect your movements — it trusts what you tell it.</p></div>
    <div class="card"><h2>Install on your phone</h2><p>In Chrome, open the ⋮ menu and choose <strong>Add to Home screen</strong> (or <strong>Install app</strong>). It then opens full-screen and works offline.</p></div>
    <div class="card"><h2>Safety</h2><p>This app follows ${esc(CLINICIAN.name)}'s written instructions. It never increases repetitions, holds or frequency. If an exercise triggers a headache or significant pain, stop and contact John.</p></div>`;
}

// Add new instructions from John, or a custom routine (always labelled).
function renderAdd() {
  const options = Object.keys({ ...EXERCISES, ...db.customExercises }).map((id) => `<option value="${esc(id)}">${esc(exerciseOf(id).name)}</option>`).join('');
  view.innerHTML = `
    <header class="topbar"><a class="btn small" href="#/library">← Library</a></header>
    <h1 class="ex-title">Add instructions</h1>
    <form id="add-form" class="card">
      <label class="field">Type<select name="kind"><option value="prescribed">New instructions from John</option><option value="custom">My own custom routine (not prescribed)</option></select></label>
      <label class="field">Title<input name="title" required placeholder="e.g. Neck follow-up"></label>
      <label class="field">Date prescribed<input name="date" type="date" required value="${zonedDate(now())}"></label>
      <label class="field">How often<input name="frequency" placeholder="As written, e.g. twice daily"></label>
      <label class="field">How long (days, leave blank if ongoing)<input name="days" type="number" min="1" max="365"></label>
      <label class="field">Precautions (one per line)<textarea name="precautions" rows="3"></textarea></label>
      <div id="rows"></div>
      <button type="button" class="btn small" data-action="add-row">+ Add exercise</button>
      <p class="small muted">Only enter what the instructions say. Leave reps or holds blank if they are not stated.</p>
      <button class="btn primary block" type="submit">Save</button>
    </form>
    <template id="row-tpl"><fieldset class="card"><legend>Exercise</legend>
      <label class="field">Exercise<select name="exerciseId"><option value="__new">New exercise…</option>${options}</select></label>
      <label class="field">New exercise name (if new)<input name="newName"></label>
      <label class="field">Instructions as written<textarea name="instructions" rows="2" required></textarea></label>
      <div class="row"><label class="field">Reps<input name="reps" type="number" min="1" max="100"></label><label class="field">Hold (seconds)<input name="hold" type="number" min="1" max="600"></label></div>
      <label class="field">Hold applies to<select name="holdPolicy"><option value="none">No hold</option><option value="every">Every rep</option><option value="last">Last rep only</option><option value="unclear">Not stated</option></select></label>
      <label class="switch"><span>Counted on each side (left and right)</span><input type="checkbox" name="sides"></label>
    </fieldset></template>`;
  addRow();
}

function addRow() {
  $('#rows').append($('#row-tpl').content.cloneNode(true));
}

function saveAddForm(form) {
  const fd = new FormData(form);
  const kind = fd.get('kind');
  const id = `${kind}-${Date.now()}`;
  const items = [];
  for (const fs of form.querySelectorAll('#rows fieldset')) {
    const get = (n) => fs.querySelector(`[name="${n}"]`);
    let exerciseId = get('exerciseId').value;
    const newName = get('newName').value.trim();
    if (exerciseId === '__new') {
      if (!newName) continue;
      exerciseId = `custom-${newName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      db.customExercises[exerciseId] = db.customExercises[exerciseId] || { name: newName, clinicalName: newName, areas: ['neck'], figure: null, start: null, movement: null, end: null, target: null, hands: null };
    }
    const num = (n) => (get(n).value ? Number(get(n).value) : null);
    const hold = num('hold');
    items.push({
      exerciseId,
      asPrescribed: exerciseOf(exerciseId).name,
      instructions: get('instructions').value.trim(),
      dose: { sides: get('sides').checked ? ['left', 'right'] : null, reps: num('reps'), holdSeconds: hold, holdPolicy: hold ? get('holdPolicy').value : 'none', frequency: null },
    });
  }
  if (!items.length) return toast('Add at least one exercise.');
  const days = fd.get('days') ? Number(fd.get('days')) : null;
  db.customProgrammes.push({
    id, kind, title: String(fd.get('title')).trim(), prescribedOn: String(fd.get('date')), clinician: kind === 'prescribed' ? CLINICIAN.name : 'Me',
    source: kind === 'prescribed' ? 'Entered by you from John\'s instructions' : 'My custom routine', frequency: String(fd.get('frequency') || ''),
    durationDays: days, durationText: days ? `${days} days, then review.` : 'Not specified.', defaultReminderTimes: [],
    precautions: String(fd.get('precautions') || '').split('\n').map((x) => x.trim()).filter(Boolean), items,
  });
  save();
  toast('Saved. It is in your Library — add it to Today when you want to use it.');
  location.hash = `#/programme/${encodeURIComponent(id)}`;
}

// ---------- Events ----------
const ACTIONS = {
  start: (el) => startSession(el.dataset.id),
  practice: (el) => startSession(el.dataset.id, { exerciseId: el.dataset.ex }),
  'begin-session': () => {
    if (S().status === 'ready') dispatch({ type: 'start' });
  },
  begin: () => dispatch({ type: 'begin' }),
  rep: () => dispatch({ type: 'repDone' }),
  done: () => dispatch({ type: 'done' }),
  'finish-exercise': () => dispatch({ type: 'done' }),
  'start-hold': () => dispatch({ type: 'startHold' }),
  next: () => dispatch({ type: 'next' }),
  skip: () => dispatch({ type: 'skip' }),
  pause: () => dispatch({ type: 'pause' }),
  resume: () => dispatch({ type: 'resume' }),
  repeat: () => coach.repeat(),
  confirm: () => dispatch({ type: 'confirm' }),
  'cancel-confirm': () => {
    dispatch({ type: 'cancelConfirm' });
    scheduleCount();
  },
  hurt: () => openHurt(),
  'hurt-stop': () => hurtChoice('stop'),
  'hurt-skip': () => hurtChoice('skip'),
  'hurt-continue': () => hurtChoice('continue'),
  pain: (el) => {
    const value = Number(el.dataset.value);
    db.activeSession = apply(S(), { type: 'setPain', when: el.dataset.when, value }, now()).state;
    const sum = db.sessions.find((x) => x.id === S().id);
    if (sum && el.dataset.when === 'after') sum.painAfter = value;
    save();
    render();
  },
  'leave-session': () => leaveSession(),
  rate: (el) => rateExercise(el.dataset.field, el.dataset.value),
  'exit-session': () => {
    const s = S();
    if (s && s.status === 'active') dispatch({ type: 'pause' });
    clearTimeout(countTimer);
    coach.cancel();
    location.hash = '#/home';
  },
  'discard-session': () => {
    if (S() && S().items.some((x) => x.phase === 'complete')) {
      db.activeSession = apply(S(), { type: 'stop' }, now()).state;
      archiveSession();
    }
    db.activeSession = null;
    save();
    render();
  },
  handsfree: () => {
    document.body.classList.toggle('handsfree');
    if (document.body.classList.contains('handsfree') && !db.settings.listenOn) setListening(true);
    render();
  },
  'toggle-mic': () => setListening(!db.settings.listenOn),
  activate: (el) => {
    const p = programmeById(el.dataset.id);
    const old = p.kind === 'prescribed' && p.id !== PROGRAMMES[0].id;
    if (old && !confirm(`This prescription is from ${fmtDate(p.prescribedOn)}. Only add it to Today if John has asked you to do these exercises now. Add it?`)) return;
    db.activeProgrammeIds = [...new Set([...db.activeProgrammeIds, p.id])];
    save();
    render();
  },
  deactivate: (el) => {
    db.activeProgrammeIds = db.activeProgrammeIds.filter((x) => x !== el.dataset.id);
    db.programmeOverrides[el.dataset.id] = { ...(db.programmeOverrides[el.dataset.id] || {}), reviewedAt: now() };
    save();
    scheduleReminders();
    render();
  },
  extend: (el) => {
    const days = Number(prompt('How many more days did John ask you to continue?', '3'));
    if (!days || days < 1 || days > 60) return;
    db.programmeOverrides[el.dataset.id] = { extendedUntil: addDays(zonedDate(now()), days - 1), reviewedAt: now(), note: `Extended ${days} days on ${zonedDate(now())}` };
    save();
    scheduleReminders();
    render();
  },
  snooze: (el) => snooze(Number(el.dataset.min)),
  'mark-done': () => markDoneFromReminder(),
  'figure-mode': (el) => {
    db.settings.figureMode = el.dataset.mode;
    save();
    render();
  },
  'test-voice': () => coach.speak("Hi Josh. I'll guide you through your exercises, nice and gently."),
  'toggle-reminders': (el) => {
    db.reminders.enabled = el.checked;
    save();
    if (el.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(render);
    scheduleReminders();
    render();
  },
  'add-time': () => {
    db.reminders.times = sortTimes([...db.reminders.times, '12:00']);
    save();
    render();
  },
  'remove-time': (el) => {
    db.reminders.times.splice(Number(el.dataset.index), 1);
    save();
    scheduleReminders();
    render();
  },
  'notif-permission': async () => {
    if (!('Notification' in window)) return toast('Notifications are not supported in this browser.');
    const r = await Notification.requestPermission();
    toast(r === 'granted' ? 'Notifications allowed.' : 'Notifications are not allowed. You can change this in Chrome site settings.');
    render();
  },
  'test-notification': async () => {
    const ok = await showNotification('Test reminder', 'If you can see this, notifications work on this device.');
    toast(ok ? 'Test sent — check your notification shade.' : 'Could not show a notification. Allow notifications first.');
  },
  ics: () => downloadIcs(),
  'export-json': () => downloadFile(`physio-backup-${zonedDate(now())}.json`, 'application/json', exportBackup(db, now())),
  'export-csv': () => downloadFile(`physio-sessions-${zonedDate(now())}.csv`, 'text/csv', toCsv(db.sessions)),
  print: () => window.print(),
  wipe: async () => {
    if (!confirm('Delete all sessions, settings and attached PDFs from this device? This cannot be undone. Consider a backup first.')) return;
    db = defaultState();
    save();
    await clearDocs().catch(() => {});
    applySettings();
    render();
  },
  'open-doc': async (el) => {
    const d = await getDoc(el.dataset.doc);
    if (d) window.open(URL.createObjectURL(d.blob), '_blank');
  },
  'remove-doc': async (el) => {
    if (!confirm('Remove this PDF from this device?')) return;
    await deleteDoc(el.dataset.doc);
    refreshDocs(el.dataset.id);
  },
  'add-row': () => addRow(),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  fn(el);
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.setting) {
    const v = el.dataset.type === 'bool' ? el.checked : el.dataset.type === 'number' ? Number(el.value) : el.value || null;
    db.settings[el.dataset.setting] = v;
    save();
    applySettings();
    if (el.dataset.setting === 'listenOn') setListening(v);
    if (el.dataset.setting !== 'speechRate') render();
    return;
  }
  const action = el.dataset.action;
  if (action === 'toggle-reminders') ACTIONS['toggle-reminders'](el);
  else if (action === 'time') {
    db.reminders.times[Number(el.dataset.index)] = el.value;
    db.reminders.times = sortTimes(db.reminders.times);
    save();
    scheduleReminders();
    render();
  } else if (action === 'attach' && el.files[0]) {
    await addDoc(el.dataset.id, el.files[0]);
    refreshDocs(el.dataset.id);
  } else if (action === 'import' && el.files[0]) {
    try {
      db = parseBackup(await el.files[0].text());
      save();
      applySettings();
      toast('Backup restored.');
      render();
    } catch (err) {
      toast(err.message);
    }
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'add-form') {
    e.preventDefault();
    saveAddForm(e.target);
  }
});

$('#hurt').addEventListener('cancel', (e) => {
  e.preventDefault();
  hurtChoice('continue');
});

window.addEventListener('hashchange', render);

// Recover after the screen was locked or the app was in the background:
// finish any hold that ran out and refresh due reminders.
function resync() {
  const s = S();
  if (s) {
    const res = recover(s, now());
    db.activeSession = res.state;
    save();
    if (res.effects.includes('holdComplete')) handleEffects(res.effects);
  }
  scheduleReminders();
  render();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    resync();
    if (S() && S().status === 'active') requestWakeLock();
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'reminder-action') handleExternalAction(e.data.action);
  });
}
if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', () => route().path === 'settings' && render());
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

setInterval(tickSession, 250);

// Boot
applySettings();
const params = new URLSearchParams(location.search);
if (params.get('action')) {
  const action = params.get('action');
  history.replaceState(null, '', location.pathname + (location.hash || '#/home'));
  setTimeout(() => handleExternalAction(action), 0);
}
// A session that was running when the app closed resumes paused, after first
// completing any hold that ran out meanwhile.
if (S() && S().status === 'active') {
  db.activeSession = recover(S(), now()).state;
  db.activeSession = apply(S(), { type: 'pause' }, now()).state;
  save();
}
resync();
if (db.settings.listenOn) listener.start();
