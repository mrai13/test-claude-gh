import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge } from '../js/sync.js';

const base = (over = {}) => ({
  version: 1, workouts: [], boulders: [], settings: { cycleStart: null, climbDay: 3 },
  settingsUpdatedAt: 0, deleted: {}, draft: null, ...over,
});
const ids = (list) => list.map((x) => x.id).sort();

test('no remote copy: local is kept as is', () => {
  const local = base({ workouts: [{ id: 'a', createdAt: 1 }] });
  assert.equal(merge(local, null), local);
});

test('items only on one side are kept from both', () => {
  const m = merge(
    base({ workouts: [{ id: 'a', createdAt: 1 }], boulders: [{ id: 'x', createdAt: 1 }] }),
    base({ workouts: [{ id: 'b', createdAt: 2 }], boulders: [{ id: 'y', createdAt: 2 }] }),
  );
  assert.deepEqual(ids(m.workouts), ['a', 'b']);
  assert.deepEqual(ids(m.boulders), ['x', 'y']);
});

test('same item on both sides: the newer edit wins', () => {
  const local = base({ workouts: [{ id: 'a', notes: 'phone', createdAt: 1, updatedAt: 5 }] });
  const remote = base({ workouts: [{ id: 'a', notes: 'laptop', createdAt: 1, updatedAt: 9 }] });
  assert.equal(merge(local, remote).workouts[0].notes, 'laptop');
  assert.equal(merge(remote, local).workouts[0].notes, 'laptop');
});

test('items without updatedAt fall back to createdAt', () => {
  const local = base({ workouts: [{ id: 'a', notes: 'old', createdAt: 1 }] });
  const remote = base({ workouts: [{ id: 'a', notes: 'edited', createdAt: 1, updatedAt: 3 }] });
  assert.equal(merge(local, remote).workouts[0].notes, 'edited');
});

test('a deletion on one device removes the item from the other', () => {
  const local = base({ workouts: [], deleted: { a: 10 } });
  const remote = base({ workouts: [{ id: 'a', createdAt: 1, updatedAt: 5 }] });
  const m = merge(local, remote);
  assert.deepEqual(m.workouts, []);
  assert.deepEqual(m.deleted, { a: 10 });
  // and the other way round
  assert.deepEqual(merge(remote, local).workouts, []);
});

test('an edit made after the deletion brings the item back', () => {
  const local = base({ deleted: { a: 10 } });
  const remote = base({ workouts: [{ id: 'a', createdAt: 1, updatedAt: 20 }] });
  assert.deepEqual(ids(merge(local, remote).workouts), ['a']);
});

test('tombstones from both sides are combined, keeping the later time', () => {
  const m = merge(base({ deleted: { a: 5, b: 1 } }), base({ deleted: { a: 7, c: 2 } }));
  assert.deepEqual(m.deleted, { a: 7, b: 1, c: 2 });
});

test('the more recently changed settings win', () => {
  const local = base({ settings: { cycleStart: '2026-01-05', climbDay: 3 }, settingsUpdatedAt: 100 });
  const remote = base({ settings: { cycleStart: '2026-02-02', climbDay: 6 }, settingsUpdatedAt: 200 });
  const m = merge(local, remote);
  assert.deepEqual(m.settings, { cycleStart: '2026-02-02', climbDay: 6 });
  assert.equal(m.settingsUpdatedAt, 200);
  assert.deepEqual(merge(remote, local).settings, { cycleStart: '2026-02-02', climbDay: 6 });
});

test('the draft always stays from this device', () => {
  const draft = { session: 'A', entries: [] };
  assert.equal(merge(base({ draft }), base({ draft: { session: 'B' } })).draft, draft);
});
