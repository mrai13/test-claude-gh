// Pure logic: double progression, cycle weeks, estimated 1RM, date helpers.
import { CYCLE_WEEKS } from './plan.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local YYYY-MM-DD for a Date. */
export function toISODate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parse YYYY-MM-DD as a local-midnight Date. */
export function parseISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Whole days from a to b (both YYYY-MM-DD). DST-safe. */
export function daysBetween(a, b) {
  return Math.round((parseISODate(b) - parseISODate(a)) / DAY_MS);
}

export function addDays(iso, n) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Round to the nearest 0.5 kg (and never below 0). */
export const roundKg = (kg) => Math.max(0, Math.round(kg * 2) / 2);

/** Epley estimated one-rep max. */
export function e1rm(weight, reps) {
  if (!weight || !reps) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

/**
 * Where you are in the 9-week arc.
 * Returns null if the cycle hasn't started yet.
 */
export function cycleWeek(startISO, todayISO) {
  if (!startISO) return null;
  const days = daysBetween(startISO, todayISO);
  if (days < 0) return null;
  const weeksIn = Math.floor(days / 7);
  const week = (weeksIn % CYCLE_WEEKS) + 1;
  const cycle = Math.floor(weeksIn / CYCLE_WEEKS) + 1;
  let phase, blurb;
  if (week <= 2) {
    phase = 'Find your weights';
    blurb = 'Deliberately too easy. Dial in form, find starting weights. You aren’t undertraining.';
  } else if (week <= 8) {
    phase = 'Build';
    blurb = 'Every session you’re either adding a rep or adding weight.';
  } else {
    phase = 'Deload';
    blurb = 'Same exercises, half the sets, 60 % of the weight. Climb normally.';
  }
  return { week, cycle, phase, blurb, deload: week === CYCLE_WEEKS };
}

/** Sets that count: both weight and reps entered. */
export const validSets = (sets = []) =>
  sets.filter((s) => Number(s.reps) > 0 && s.weight !== '' && s.weight != null && Number(s.weight) >= 0);

/** The most recent non-deload logged entry for an exercise, as {date, sets}. */
export function lastEntry(workouts, exerciseId, { beforeDate, excludeId } = {}) {
  const sorted = [...workouts]
    .filter((w) => !w.deload && w.id !== excludeId && (!beforeDate || w.date <= beforeDate))
    .sort((a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i].entries.find((x) => x.exerciseId === exerciseId);
    const sets = e ? validSets(e.sets) : [];
    if (sets.length) return { date: sorted[i].date, sets: sets.map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) })) };
  }
  return null;
}

/**
 * Double progression: reps first, then weight.
 * Returns { kind, weight, targets: number[], text }.
 *  - 'start'    no history: pick a weight for the bottom of the range with 2 reps in reserve
 *  - 'increase' every set hit the top of the range: add the increment, drop to bottom reps
 *  - 'reps'     same weight, beat last time by one rep
 */
export function suggestNext(ex, last) {
  const bottom = Array(ex.sets).fill(ex.repMin);
  if (!last || !last.sets.length) {
    return {
      kind: 'start', weight: null, targets: bottom,
      text: `Pick a weight you can do for ${ex.repMin} reps with 2 left in the tank.`,
    };
  }
  const weight = Math.max(...last.sets.map((s) => s.weight));
  const atWeight = last.sets.filter((s) => s.weight === weight).map((s) => s.reps);
  const allTop = atWeight.length >= ex.sets && atWeight.slice(0, ex.sets).every((r) => r >= ex.repMax);
  if (allTop) {
    const next = roundKg(weight + ex.increment);
    return {
      kind: 'increase', weight: next, targets: bottom,
      text: `All sets hit ${ex.repMax}. Go up ${ex.increment} kg to ${fmtKg(next)} and drop to ${ex.repMin} reps.`,
    };
  }
  // Same weight: repeat last reps (capped at the top of the range) and add one rep to the lowest set.
  // Sets you didn't log last time copy the last logged set.
  const reps = Array.from({ length: ex.sets }, (_, i) => Math.min(ex.repMax, atWeight[i] ?? atWeight.at(-1)));
  let lowest = 0;
  reps.forEach((r, i) => { if (r < reps[lowest]) lowest = i; });
  if (reps[lowest] < ex.repMax) reps[lowest] += 1;
  return {
    kind: 'reps', weight, targets: reps,
    text: `Stay at ${fmtKg(weight)} and beat last time: aim for ${reps.join(', ')}.`,
  };
}

/** Deload version of a suggestion: half the sets (rounded up), 60 % of the weight. */
export function deloadOf(ex, suggestion) {
  const sets = Math.ceil(ex.sets / 2);
  const weight = suggestion.weight == null ? null : roundKg(suggestion.weight * 0.6);
  return {
    kind: 'deload', weight, targets: Array(sets).fill(ex.repMin),
    text: weight == null
      ? `Deload: ${sets} easy sets.`
      : `Deload: ${sets} × ${ex.repMin} at ${fmtKg(weight)} (60 %).`,
  };
}

/** Next session: alternate from the last logged one; A if nothing logged. */
export function nextSession(workouts) {
  if (!workouts.length) return 'A';
  const last = [...workouts].sort((a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1)).at(-1);
  return last.session === 'A' ? 'B' : 'A';
}

export function fmtKg(kg) {
  return `${Number.isInteger(kg) ? kg : kg.toFixed(1).replace(/\.0$/, '')} kg`;
}

/** "60 kg × 8, 8, 7" — groups consecutive sets at the same weight. */
export function fmtSets(sets) {
  const groups = [];
  for (const s of sets) {
    const g = groups.at(-1);
    if (g && g.weight === s.weight) g.reps.push(s.reps);
    else groups.push({ weight: s.weight, reps: [s.reps] });
  }
  return groups.map((g) => `${fmtKg(g.weight)} × ${g.reps.join(', ')}`).join(' · ');
}

/**
 * Schedule warnings for training on `todayISO`.
 * climbDay: 0–6 (Sun–Sat) — the usual bouldering weekday, or null.
 */
export function scheduleWarnings({ workouts, boulders, climbDay, todayISO }) {
  const out = [];
  const tomorrow = parseISODate(addDays(todayISO, 1)).getDay();
  if (climbDay != null && tomorrow === Number(climbDay)) {
    out.push('Tomorrow is your climbing day. The plan says don’t lift the day before you climb.');
  }
  const yesterday = addDays(todayISO, -1);
  if (workouts.some((w) => w.date === yesterday)) {
    out.push('You lifted yesterday. Keep a full rest day between any two of your three sessions.');
  } else if (boulders.some((b) => b.date === yesterday)) {
    out.push('You climbed yesterday. Keep a full rest day between any two of your three sessions.');
  }
  return out;
}
