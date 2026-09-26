// Your data lives on the server, per account. This device keeps a copy in localStorage so the app
// opens and logs offline; changes are pushed to the server in the background and merged if
// another device saved first. Also JSON export/import.
import { API_BASE } from './config.js';
import { merge } from './sync.js';

const USER_KEY = 'tlow:user'; // who last signed in on this device
const cacheKey = (username) => `tlow:v1:${username}`;
const PUSH_DELAY = 1000;

const empty = () => ({
  version: 1,
  workouts: [], // { id, date, session, deload, entries: [{ exerciseId, sets: [{ weight, reps }] }], notes, createdAt, updatedAt }
  boulders: [], // { id, date, durationMin, hardestGrade, notes, createdAt, updatedAt }
  settings: { cycleStart: null, climbDay: 3 },
  settingsUpdatedAt: 0,
  deleted: {}, // { [id]: deletedAt }, so deletions reach other devices
  draft: null, // in-progress workout, survives reloads at the gym; never leaves this device
});

let user = null;
let state = empty();
let rev = 0; // server revision this copy is based on
let dirty = false; // changes not yet on the server
let changeSeq = 0; // bumps on every shared change, to spot edits made while a push is in flight
let status = 'idle'; // idle | syncing | synced | offline | error | signed-out
let statusDetail = '';
const listeners = { status: new Set(), change: new Set() };

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
    settingsUpdatedAt: Number(data.settingsUpdatedAt) || 0,
    deleted: data.deleted && typeof data.deleted === 'object' ? { ...data.deleted } : {},
    draft: data.draft ?? null,
  };
}

const shared = ({ draft, ...rest }) => rest;

// ---------- local cache ----------

function loadCache() {
  state = empty();
  rev = 0;
  dirty = false;
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey(user)));
    if (c) {
      state = normalize(c.state);
      rev = c.rev || 0;
      dirty = !!c.dirty;
    }
  } catch { /* start empty */ }
}

function persist() {
  if (!user) return;
  try { localStorage.setItem(cacheKey(user), JSON.stringify({ rev, dirty, state })); } catch { /* storage full or blocked */ }
}

// ---------- server ----------

export class AuthError extends Error {}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API_BASE + path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new AuthError(json.error || 'Not signed in');
  if (!res.ok && res.status !== 409) throw new Error(json.error || `Server error (${res.status})`);
  return { status: res.status, ...json };
}

function setStatus(s, detail = '') {
  status = s;
  statusDetail = detail;
  listeners.status.forEach((fn) => fn(s, detail));
}

let pushTimer = null;
let syncing = null;
let again = false;

/** Pulls the server copy and pushes local changes. Safe to call any time; calls coalesce. */
export function sync() {
  clearTimeout(pushTimer);
  if (!user) return Promise.resolve();
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    do {
      again = false;
      await syncOnce();
    } while (again && status !== 'offline' && status !== 'signed-out');
  })().finally(() => { syncing = null; });
  return syncing;
}

async function syncOnce() {
  setStatus('syncing');
  try {
    if (!dirty) {
      const remote = await api('/api/state');
      if (remote.rev !== rev && remote.data) {
        state = { ...normalize(remote.data), draft: state.draft };
        rev = remote.rev;
        persist();
        listeners.change.forEach((fn) => fn());
      }
    }
    for (let attempt = 0; dirty && attempt < 5; attempt++) {
      const seq = changeSeq;
      const res = await api('/api/state', { method: 'PUT', body: { baseRev: rev, data: shared(state) } });
      if (res.status === 409) {
        // Another device saved first: fold its changes into ours and try again.
        state = merge(state, res.data && normalize(res.data));
        rev = res.rev;
        listeners.change.forEach((fn) => fn());
      } else {
        rev = res.rev;
        if (seq === changeSeq) dirty = false;
      }
      persist();
    }
    setStatus(dirty ? 'error' : 'synced', dirty ? 'Kept conflicting with another device' : '');
  } catch (err) {
    if (err instanceof AuthError) setStatus('signed-out');
    else if (err instanceof TypeError || !navigator.onLine) setStatus('offline'); // fetch network failure
    else setStatus('error', err.message);
  }
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(sync, PUSH_DELAY);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => sync());
  document.addEventListener('visibilitychange', () => sync()); // flush when hidden, refresh when reopened
}

// ---------- session ----------

/**
 * Finds out who is signed in and loads their data. Returns the username, or null if nobody is.
 * Offline, it trusts the last user who signed in on this device and works from the local copy.
 */
export async function init() {
  const saved = localStorage.getItem(USER_KEY);
  try {
    user = (await api('/api/me')).username;
    localStorage.setItem(USER_KEY, user);
  } catch (err) {
    if (err instanceof AuthError || !saved) {
      user = null;
      if (err instanceof AuthError) return null;
      throw err; // can't reach the server and nobody has signed in here before
    }
    user = saved;
  }
  loadCache();
  sync();
  return user;
}

export async function login(username, password) {
  let res;
  try {
    res = await api('/api/login', { method: 'POST', body: { username, password } });
  } catch (err) {
    if (err instanceof TypeError) throw new Error('Can’t reach the server. Check your connection.');
    throw err;
  }
  user = res.username;
  localStorage.setItem(USER_KEY, user);
  loadCache();
  await sync();
  return user;
}

/** Signs out and removes this account's copy from the device. */
export async function logout() {
  if (dirty) await sync();
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  try {
    localStorage.removeItem(cacheKey(user));
    localStorage.removeItem(USER_KEY);
  } catch { /* ignore */ }
  user = null;
  state = empty();
  rev = 0;
  dirty = false;
  setStatus('signed-out');
}

export const username = () => user;
export const syncStatus = () => ({ status, detail: statusDetail, pending: dirty });
export const onStatus = (fn) => listeners.status.add(fn);
/** Called when data arrives from the server, so the screen can refresh. */
export const onRemoteChange = (fn) => listeners.change.add(fn);

// ---------- reading and changing data ----------

export const get = () => state;

export function update(fn) {
  const before = JSON.stringify(shared(state));
  const settingsBefore = JSON.stringify(state.settings);
  fn(state);
  if (JSON.stringify(state.settings) !== settingsBefore) state.settingsUpdatedAt = Date.now();
  if (JSON.stringify(shared(state)) !== before) {
    dirty = true;
    changeSeq++;
    schedulePush();
  }
  persist();
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function exportJSON() {
  const { draft, ...rest } = state;
  return JSON.stringify({ ...rest, exportedAt: new Date().toISOString() }, null, 2);
}

/** Replaces everything with the backup, on this device and (after sync) on the account. */
export function importJSON(text) {
  const incoming = normalize(JSON.parse(text));
  const now = Date.now();
  update((s) => {
    const keep = new Set([...incoming.workouts, ...incoming.boulders].map((x) => x.id));
    const deleted = { ...incoming.deleted };
    for (const x of [...s.workouts, ...s.boulders]) if (!keep.has(x.id)) deleted[x.id] = now;
    for (const id of keep) delete deleted[id];
    s.workouts = incoming.workouts.map((w) => ({ ...w, updatedAt: now }));
    s.boulders = incoming.boulders.map((b) => ({ ...b, updatedAt: now }));
    s.settings = incoming.settings;
    s.deleted = deleted;
    s.settingsUpdatedAt = now; // the backup's settings should win even if they match
    s.draft = null;
  });
}

export function clearAll() {
  const now = Date.now();
  update((s) => {
    for (const x of [...s.workouts, ...s.boulders]) s.deleted[x.id] = now;
    s.workouts = [];
    s.boulders = [];
    s.settings = empty().settings;
    s.settingsUpdatedAt = now;
    s.draft = null;
  });
}
