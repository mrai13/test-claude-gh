// On-device storage (localStorage) plus JSON export/import.

const KEY = 'tlow:v1';

const empty = () => ({
  version: 1,
  workouts: [], // { id, date, session, deload, entries: [{ exerciseId, sets: [{ weight, reps }] }], notes, createdAt }
  boulders: [], // { id, date, durationMin, hardestGrade, notes, createdAt }
  settings: { cycleStart: null, climbDay: 3 },
  draft: null, // in-progress workout, survives reloads at the gym
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* fall through to empty */ }
  return empty();
}

/** Accepts anything parsed from JSON; returns a valid state or throws. */
export function normalize(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.workouts) || !Array.isArray(data.boulders)) {
    throw new Error('Not a Two Lifts, One Wall backup file.');
  }
  const base = empty();
  return {
    ...base,
    workouts: data.workouts.filter((w) => w && w.id && w.date && Array.isArray(w.entries)),
    boulders: data.boulders.filter((b) => b && b.id && b.date),
    settings: { ...base.settings, ...(data.settings || {}) },
    draft: data.draft ?? null,
  };
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
}

export const get = () => state;

export function update(fn) {
  fn(state);
  persist();
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function exportJSON() {
  const { draft, ...rest } = state;
  return JSON.stringify({ ...rest, exportedAt: new Date().toISOString() }, null, 2);
}

export function importJSON(text) {
  state = normalize(JSON.parse(text));
  persist();
}

export function clearAll() {
  state = empty();
  persist();
}
