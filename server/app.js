// The login + data API. The app itself is served elsewhere (Cloudflare Pages) and calls this
// with credentials, so CORS is locked to the app's origin(s).
import { createServer } from 'node:http';
import {
  verifyPassword, newToken, hashToken, sessionExpiry, needsRenewal, normalizeUsername,
  rateLimiter, SESSION_DAYS,
} from './auth.js';

const COOKIE = 'tlow_session';
const MAX_BODY = 2 * 1024 * 1024;
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

async function readJSON(req) {
  const refuse = (status, message) => {
    req.resume(); // discard the upload so the error response can still be delivered
    return new HttpError(status, message);
  };
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw refuse(415, 'Expected application/json');
  if (Number(req.headers['content-length']) > MAX_BODY) throw refuse(413, 'Body too large');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function validState(data) {
  return data && typeof data === 'object' && !Array.isArray(data)
    && Array.isArray(data.workouts) && Array.isArray(data.boulders);
}

/**
 * @param {object} opts
 * @param {ReturnType<import('./db.js').openDb>} opts.db
 * @param {string[]} opts.appOrigins  origins allowed to call the API, e.g. ['https://app.example.com']
 * @param {boolean} [opts.cookieSecure]  false only for plain-http local development
 */
export function createApp({ db, appOrigins, cookieSecure = true, limiter = rateLimiter() }) {
  const allowed = new Set(appOrigins);

  const setSessionCookie = (res, token, maxAgeSec) => {
    res.setHeader('Set-Cookie', [
      `${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`,
      ...(cookieSecure ? ['Secure'] : []),
    ].join('; '));
  };

  function currentSession(req, res) {
    const token = readCookie(req, COOKIE);
    if (!token) return null;
    const tokenHash = hashToken(token);
    const s = db.session(tokenHash);
    if (!s) return null;
    if (needsRenewal(s.expires_at)) {
      db.extendSession(tokenHash, sessionExpiry());
      setSessionCookie(res, token, SESSION_DAYS * 86400);
    }
    return { userId: s.user_id, username: s.username, tokenHash };
  }

  function requireSession(req, res) {
    const s = currentSession(req, res);
    if (!s) throw new HttpError(401, 'Not signed in');
    return s;
  }

  const routes = {
    'GET /api/health': () => ({ ok: true }),

    'POST /api/login': async (req, res) => {
      const body = await readJSON(req);
      const username = normalizeUsername(body.username);
      const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
      const keys = [`ip:${ip}`, `user:${username}`];
      if (limiter.blocked(keys)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
      const user = db.userByName(username);
      const ok = await verifyPassword(String(body.password ?? ''), user?.pass_hash);
      if (!ok || !user) {
        limiter.fail(keys);
        throw new HttpError(401, 'Wrong username or password');
      }
      limiter.reset([`user:${username}`]);
      const token = newToken();
      db.pruneSessions();
      db.addSession(hashToken(token), user.id, sessionExpiry());
      setSessionCookie(res, token, SESSION_DAYS * 86400);
      return { username: user.username };
    },

    'POST /api/logout': (req, res) => {
      const s = currentSession(req, res);
      if (s) db.removeSession(s.tokenHash);
      setSessionCookie(res, '', 0);
      return { ok: true };
    },

    'GET /api/me': (req, res) => ({ username: requireSession(req, res).username }),

    'GET /api/state': (req, res) => db.getState(requireSession(req, res).userId),

    'PUT /api/state': async (req, res) => {
      const { userId } = requireSession(req, res);
      const body = await readJSON(req);
      if (!Number.isInteger(body.baseRev) || body.baseRev < 0) throw new HttpError(400, 'baseRev must be a non-negative integer');
      if (!validState(body.data)) throw new HttpError(400, 'data must have workouts and boulders arrays');
      const { draft, ...data } = body.data; // the in-progress workout stays on the device
      const rev = db.putState(userId, body.baseRev, data);
      if (rev == null) {
        res.statusCode = 409;
        return db.getState(userId);
      }
      return { rev };
    },
  };

  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    const path = new URL(req.url, 'http://x').pathname;
    const send = (status, body) => {
      if (!res.headersSent) {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
      }
      res.end(JSON.stringify(body));
    };

    try {
      res.setHeader('Vary', 'Origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (origin) {
        if (!allowed.has(origin)) throw new HttpError(403, 'Origin not allowed');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      } else if (UNSAFE.has(req.method)) {
        // Browsers always send Origin on these; its absence means a non-browser or a stripped request.
        throw new HttpError(403, 'Origin header required');
      }

      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
        res.statusCode = 204;
        return res.end();
      }

      const handler = routes[`${req.method} ${path}`];
      if (!handler) throw new HttpError(404, 'Not found');
      res.statusCode = 200;
      const body = await handler(req, res); // may set a non-200 status, e.g. 409
      send(res.statusCode, body);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      send(err.status || 500, { error: err instanceof HttpError ? err.message : 'Server error' });
    }
  });
}
