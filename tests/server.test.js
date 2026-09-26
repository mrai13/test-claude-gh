import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hashPassword, rateLimiter } from '../server/auth.js';

const APP = 'https://app.example.test';
let dir, db, server, base;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tlow-'));
  db = openDb(dir);
  db.addUser('alice', await hashPassword('alice-password'));
  db.addUser('bob', await hashPassword('bob-password'));
  db.addUser('carol', await hashPassword('carol-password'));
  server = createApp({ db, appOrigins: [APP], limiter: rateLimiter({ max: 3 }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** fetch with the app's Origin, JSON body and an optional session cookie. */
async function call(path, { method = 'GET', body, cookie, origin = APP, ip } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (ip) headers['CF-Connecting-IP'] = ip;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

async function login(username, password, ip = `10.0.0.${Math.floor(Math.random() * 250)}`) {
  const r = await call('/api/login', { method: 'POST', body: { username, password }, ip });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.headers.get('set-cookie').split(';')[0];
}

const state = (n) => ({ version: 1, workouts: [{ id: `w${n}`, date: '2026-09-01', entries: [] }], boulders: [], settings: {} });

test('requests without a session get 401', async () => {
  assert.equal((await call('/api/me')).status, 401);
  assert.equal((await call('/api/state')).status, 401);
  assert.equal((await call('/api/state', { method: 'PUT', body: { baseRev: 0, data: state(1) } })).status, 401);
});

test('a wrong password is refused', async () => {
  const r = await call('/api/login', { method: 'POST', body: { username: 'alice', password: 'nope' }, ip: '10.1.1.1' });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('set-cookie'), null);
  const unknown = await call('/api/login', { method: 'POST', body: { username: 'nobody', password: 'x' }, ip: '10.1.1.1' });
  assert.equal(unknown.status, 401);
});

test('repeated failures are rate-limited, per IP and per username', async () => {
  for (let i = 0; i < 3; i++) {
    await call('/api/login', { method: 'POST', body: { username: 'carol', password: 'wrong' }, ip: '10.2.2.2' });
  }
  // Even the right password is refused while blocked…
  const blocked = await call('/api/login', { method: 'POST', body: { username: 'carol', password: 'carol-password' }, ip: '10.2.2.3' });
  assert.equal(blocked.status, 429);
  // …and the IP is blocked for other usernames too.
  const sameIp = await call('/api/login', { method: 'POST', body: { username: 'bob', password: 'bob-password' }, ip: '10.2.2.2' });
  assert.equal(sameIp.status, 429);
});

test('login sets a secure session cookie and /api/me knows the user', async () => {
  const r = await call('/api/login', { method: 'POST', body: { username: ' Alice ', password: 'alice-password' }, ip: '10.3.3.3' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { username: 'alice' });
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /^tlow_session=[\w-]{20,};/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(flag), flag);
  const me = await call('/api/me', { cookie: cookie.split(';')[0] });
  assert.deepEqual(me.json, { username: 'alice' });
});

test('state round-trips, and the draft is never stored', async () => {
  const cookie = await login('alice', 'alice-password');
  assert.deepEqual((await call('/api/state', { cookie })).json, { rev: 0, data: null });
  const put = await call('/api/state', { method: 'PUT', cookie, body: { baseRev: 0, data: { ...state(1), draft: { session: 'A' } } } });
  assert.deepEqual(put.json, { rev: 1 });
  const got = await call('/api/state', { cookie });
  assert.equal(got.json.rev, 1);
  assert.deepEqual(got.json.data, state(1));
});

test('a save based on an outdated revision gets 409 and the server copy', async () => {
  const cookie = await login('bob', 'bob-password');
  assert.equal((await call('/api/state', { method: 'PUT', cookie, body: { baseRev: 0, data: state(1) } })).json.rev, 1);
  assert.equal((await call('/api/state', { method: 'PUT', cookie, body: { baseRev: 1, data: state(2) } })).json.rev, 2);
  const stale = await call('/api/state', { method: 'PUT', cookie, body: { baseRev: 1, data: state(3) } });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.json, { rev: 2, data: state(2) });
  const staleFirst = await call('/api/state', { method: 'PUT', cookie, body: { baseRev: 0, data: state(4) } });
  assert.equal(staleFirst.status, 409);
});

test('one user can never read or write another user\'s data', async () => {
  const alice = await login('alice', 'alice-password');
  const bob = await login('bob', 'bob-password');
  const aliceBefore = (await call('/api/state', { cookie: alice })).json;
  const bobState = (await call('/api/state', { cookie: bob })).json;
  assert.notDeepEqual(aliceBefore.data, bobState.data);
  await call('/api/state', { method: 'PUT', cookie: bob, body: { baseRev: bobState.rev, data: state(99) } });
  assert.deepEqual((await call('/api/state', { cookie: alice })).json, aliceBefore);
});

test('logout ends the session', async () => {
  const cookie = await login('alice', 'alice-password');
  const out = await call('/api/logout', { method: 'POST', cookie });
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await call('/api/me', { cookie })).status, 401);
});

test('changing a password signs the user out everywhere', async () => {
  const cookie = await login('bob', 'bob-password');
  db.setPassword('bob', await hashPassword('new-bob-password'));
  assert.equal((await call('/api/me', { cookie })).status, 401);
  db.setPassword('bob', await hashPassword('bob-password'));
});

test('CORS: only the app origin is allowed, with credentials', async () => {
  const pre = await fetch(`${base}/api/state`, {
    method: 'OPTIONS', headers: { Origin: APP, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), APP);
  assert.equal(pre.headers.get('access-control-allow-credentials'), 'true');
  assert.match(pre.headers.get('access-control-allow-methods'), /PUT/);

  const cookie = await login('alice', 'alice-password');
  const evil = await call('/api/state', { cookie, origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const evilLogin = await call('/api/login', { method: 'POST', body: { username: 'alice', password: 'alice-password' }, origin: 'https://evil.example' });
  assert.equal(evilLogin.status, 403);
});

test('changes without an Origin header are refused', async () => {
  const cookie = await login('alice', 'alice-password');
  const r = await call('/api/state', { method: 'PUT', cookie, origin: null, body: { baseRev: 0, data: state(1) } });
  assert.equal(r.status, 403);
});

test('bad bodies are rejected', async () => {
  const cookie = await login('alice', 'alice-password');
  const notJson = await fetch(`${base}/api/state`, { method: 'PUT', headers: { Origin: APP, Cookie: cookie, 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(notJson.status, 415);
  const shape = await call('/api/state', { method: 'PUT', cookie, body: { baseRev: 0, data: { workouts: 'x' } } });
  assert.equal(shape.status, 400);
  const huge = await call('/api/state', { method: 'PUT', cookie, body: { baseRev: 0, data: { ...state(1), pad: 'x'.repeat(3 * 1024 * 1024) } } });
  assert.equal(huge.status, 413);
});
