import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exerciseById } from '../js/plan.js';
import {
  suggestNext, deloadOf, cycleWeek, e1rm, lastEntry, nextSession, scheduleWarnings, fmtSets, daysBetween,
} from '../js/progression.js';

const squat = exerciseById('squat');
const bench = exerciseById('bench');
const lateral = exerciseById('lateral');
const sets = (w, ...reps) => reps.map((r) => ({ weight: w, reps: r }));

test('no history: start at the bottom of the range', () => {
  const s = suggestNext(squat, null);
  assert.equal(s.kind, 'start');
  assert.equal(s.weight, null);
  assert.deepEqual(s.targets, [5, 5, 5]);
});

test('reps first: 5,5,5 -> add a rep at the same weight', () => {
  const s = suggestNext(squat, { sets: sets(60, 5, 5, 5) });
  assert.equal(s.kind, 'reps');
  assert.equal(s.weight, 60);
  assert.deepEqual(s.targets, [6, 5, 5]);
});

test('reps first: the lowest set gets the extra rep', () => {
  assert.deepEqual(suggestNext(squat, { sets: sets(60, 7, 6, 6) }).targets, [7, 7, 6]);
});

test('squat 8,8,8 -> +5 kg, back to 5 reps', () => {
  const s = suggestNext(squat, { sets: sets(60, 8, 8, 8) });
  assert.equal(s.kind, 'increase');
  assert.equal(s.weight, 65);
  assert.deepEqual(s.targets, [5, 5, 5]);
});

test('bench 10,10,10 -> +2.5 kg, back to 6 reps', () => {
  const s = suggestNext(bench, { sets: sets(40, 10, 10, 10) });
  assert.equal(s.weight, 42.5);
  assert.deepEqual(s.targets, [6, 6, 6]);
});

test('only 2 of 3 sets at the top -> stay', () => {
  const s = suggestNext(bench, { sets: sets(40, 10, 10, 9) });
  assert.equal(s.kind, 'reps');
  assert.deepEqual(s.targets, [10, 10, 10]);
});

test('lateral raise has 2 sets', () => {
  assert.equal(suggestNext(lateral, { sets: sets(8, 15, 15) }).kind, 'increase');
});

test('fewer sets logged than planned is not an increase', () => {
  const s = suggestNext(squat, { sets: sets(60, 8, 8) });
  assert.equal(s.kind, 'reps');
  assert.deepEqual(s.targets, [8, 8, 8]);
  assert.deepEqual(suggestNext(bench, { sets: sets(40, 8) }).targets, [9, 8, 8]);
});

test('deload: half the sets rounded up, 60 % weight', () => {
  const d = deloadOf(squat, suggestNext(squat, { sets: sets(62.5, 6, 6, 6) }));
  assert.equal(d.weight, 37.5);
  assert.deepEqual(d.targets, [5, 5]);
});

test('cycle weeks: 1–2 find, 3–8 build, 9 deload, then restart', () => {
  assert.equal(cycleWeek('2026-01-05', '2026-01-04'), null);
  assert.equal(cycleWeek('2026-01-05', '2026-01-05').week, 1);
  assert.equal(cycleWeek('2026-01-05', '2026-01-18').phase, 'Find your weights');
  assert.equal(cycleWeek('2026-01-05', '2026-01-19').phase, 'Build');
  const dl = cycleWeek('2026-01-05', '2026-03-02');
  assert.equal(dl.week, 9);
  assert.equal(dl.deload, true);
  const next = cycleWeek('2026-01-05', '2026-03-09');
  assert.deepEqual([next.week, next.cycle], [1, 2]);
});

test('daysBetween survives DST changes', () => {
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
});

test('e1rm (Epley)', () => {
  assert.equal(e1rm(100, 1), 100);
  assert.equal(Math.round(e1rm(60, 8)), 76);
});

test('lastEntry skips deload workouts and the one being edited', () => {
  const workouts = [
    { id: 'a', date: '2026-01-05', session: 'A', entries: [{ exerciseId: 'squat', sets: sets(60, 5, 5, 5) }] },
    { id: 'b', date: '2026-01-12', session: 'A', deload: true, entries: [{ exerciseId: 'squat', sets: sets(35, 5, 5) }] },
    { id: 'c', date: '2026-01-19', session: 'A', entries: [{ exerciseId: 'squat', sets: sets(60, 6, 6, 5) }] },
  ];
  assert.deepEqual(lastEntry(workouts, 'squat').sets.map((s) => s.reps), [6, 6, 5]);
  assert.equal(lastEntry(workouts, 'squat', { excludeId: 'c' }).date, '2026-01-05');
  assert.equal(lastEntry(workouts, 'squat', { beforeDate: '2026-01-10' }).date, '2026-01-05');
  assert.equal(lastEntry(workouts, 'bench'), null);
});

test('next session alternates', () => {
  assert.equal(nextSession([]), 'A');
  assert.equal(nextSession([{ date: '2026-01-05', session: 'A', entries: [] }]), 'B');
});

test('schedule warnings', () => {
  // 2026-01-06 is a Tuesday; Wednesday (3) is climbing day.
  const w = scheduleWarnings({ workouts: [{ date: '2026-01-05' }], boulders: [], climbDay: 3, todayISO: '2026-01-06' });
  assert.equal(w.length, 2);
  assert.equal(scheduleWarnings({ workouts: [], boulders: [], climbDay: 3, todayISO: '2026-01-08' }).length, 0);
});

test('fmtSets groups equal weights', () => {
  assert.equal(fmtSets([...sets(60, 8, 8), ...sets(62.5, 6)]), '60 kg × 8, 8 · 62.5 kg × 6');
});
