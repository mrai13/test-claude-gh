// SQLite storage: users, login sessions, and one JSON state document per user.
// Every state query takes the user id from the session, which keeps accounts apart.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'tlow.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS states (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      rev INTEGER NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const q = {
    userByName: db.prepare('SELECT id, username, pass_hash FROM users WHERE username = ?'),
    addUser: db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)'),
    setPass: db.prepare('UPDATE users SET pass_hash = ? WHERE username = ?'),
    removeUser: db.prepare('DELETE FROM users WHERE username = ?'),
    listUsers: db.prepare('SELECT username, created_at FROM users ORDER BY username'),
    addSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    session: db.prepare(`SELECT s.user_id, s.expires_at, u.username FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`),
    extendSession: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    removeSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    removeUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)'),
    pruneSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    state: db.prepare('SELECT rev, data FROM states WHERE user_id = ?'),
    insertState: db.prepare('INSERT INTO states (user_id, rev, data, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT (user_id) DO NOTHING'),
    updateState: db.prepare('UPDATE states SET rev = rev + 1, data = ?, updated_at = ? WHERE user_id = ? AND rev = ?'),
  };

  return {
    close: () => db.close(),

    userByName: (username) => q.userByName.get(username),
    addUser: (username, passHash) => q.addUser.run(username, passHash, Date.now()),
    /** Changing a password also signs that user out everywhere. */
    setPassword(username, passHash) {
      const changed = q.setPass.run(passHash, username).changes > 0;
      if (changed) q.removeUserSessions.run(username);
      return changed;
    },
    removeUser: (username) => q.removeUser.run(username).changes > 0,
    listUsers: () => q.listUsers.all(),

    addSession: (tokenHash, userId, expiresAt) => q.addSession.run(tokenHash, userId, expiresAt),
    session: (tokenHash) => q.session.get(tokenHash, Date.now()),
    extendSession: (tokenHash, expiresAt) => q.extendSession.run(expiresAt, tokenHash),
    removeSession: (tokenHash) => q.removeSession.run(tokenHash),
    pruneSessions: () => q.pruneSessions.run(Date.now()),

    getState(userId) {
      const row = q.state.get(userId);
      return row ? { rev: row.rev, data: JSON.parse(row.data) } : { rev: 0, data: null };
    },
    /** Saves only if the caller has seen the latest revision. Returns the new rev, or null on conflict. */
    putState(userId, baseRev, data) {
      const json = JSON.stringify(data);
      const now = Date.now();
      if (baseRev === 0) return q.insertState.run(userId, json, now).changes ? 1 : null;
      return q.updateState.run(json, now, userId, baseRev).changes ? baseRev + 1 : null;
    },
  };
}
