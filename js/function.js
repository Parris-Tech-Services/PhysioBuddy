// Weekly everyday-activity check, modelled on the Patient-Specific
// Functional Scale: the person names up to three activities their problem
// makes hard and rates each 0 (unable) to 10 (as well as before). Pure
// functions over `db.function`; the app only displays change, it never
// interprets a score clinically.
import { daysBetween } from './schedule.js';

export const MAX_ACTIVITIES = 3;
export const CHECK_INTERVAL_DAYS = 7;

export function emptyFunction() {
  return { activities: [], ratings: [] };
}

export function normaliseFunction(raw) {
  if (!raw || typeof raw !== 'object') return emptyFunction();
  return {
    activities: Array.isArray(raw.activities) ? raw.activities.filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string') : [],
    ratings: Array.isArray(raw.ratings) ? raw.ratings.filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.scores && typeof r.scores === 'object') : [],
  };
}

export const activeActivities = (fn) => fn.activities.filter((a) => !a.archived);

export function addActivity(fn, name, now) {
  const text = String(name || '').trim().slice(0, 120);
  if (!text || activeActivities(fn).length >= MAX_ACTIVITIES) return fn;
  return { ...fn, activities: [...fn.activities, { id: `act-${now}`, name: text, addedAt: now, archived: false }] };
}

// Archived activities keep their history for the report but stop being asked.
export function archiveActivity(fn, id) {
  return { ...fn, activities: fn.activities.map((a) => (a.id === id ? { ...a, archived: true } : a)) };
}

// Record (or replace) one day's scores. Invalid or unknown entries are dropped.
export function recordRatings(fn, date, scores, now) {
  const ids = new Set(activeActivities(fn).map((a) => a.id));
  const clean = Object.fromEntries(Object.entries(scores || {}).filter(([id, v]) => ids.has(id) && Number.isInteger(v) && v >= 0 && v <= 10));
  if (!Object.keys(clean).length) return fn;
  const others = fn.ratings.filter((r) => r.date !== date);
  return { ...fn, ratings: [...others, { date, at: now, scores: clean }].sort((a, b) => a.date.localeCompare(b.date)) };
}

export function lastCheckDate(fn) {
  return fn.ratings.length ? fn.ratings[fn.ratings.length - 1].date : null;
}

export function isCheckDue(fn, today) {
  if (!activeActivities(fn).length) return false;
  const last = lastCheckDate(fn);
  return !last || daysBetween(last, today) >= CHECK_INTERVAL_DAYS;
}

// First and latest score per activity, plus the change between them.
export function activitySummary(fn) {
  return fn.activities.map((a) => {
    const scored = fn.ratings.filter((r) => typeof r.scores[a.id] === 'number');
    const first = scored[0] || null;
    const latest = scored[scored.length - 1] || null;
    return {
      id: a.id,
      name: a.name,
      archived: Boolean(a.archived),
      count: scored.length,
      first: first ? { date: first.date, score: first.scores[a.id] } : null,
      latest: latest ? { date: latest.date, score: latest.scores[a.id] } : null,
      change: first && latest && first !== latest ? latest.scores[a.id] - first.scores[a.id] : null,
    };
  });
}
