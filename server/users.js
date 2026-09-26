// Account management. There is no sign-up page; accounts are created here.
//   node server/users.js add <name>      create an account (asks for a password)
//   node server/users.js passwd <name>   change a password (signs that user out everywhere)
//   node server/users.js remove <name>   delete an account and all its data
//   node server/users.js list
// With stdin not a terminal, the password is read from the first line of stdin.
import { createInterface } from 'node:readline';
import { openDb } from './db.js';
import { hashPassword, normalizeUsername, USERNAME_RE, MIN_PASSWORD } from './auth.js';

function readLine() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.once('line', (line) => { rl.close(); resolve(line); });
    rl.once('close', () => resolve(''));
  });
}

function askHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const { stdin } = process;
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (c === '\u0003') process.exit(130); // Ctrl-C
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function askPassword() {
  if (!process.stdin.isTTY) return readLine();
  const pw = await askHidden('Password: ');
  const again = await askHidden('Repeat password: ');
  if (pw !== again) fail('Passwords do not match.');
  return pw;
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const [cmd, rawName] = process.argv.slice(2);
const name = normalizeUsername(rawName);
const usage = 'Usage: node server/users.js add|passwd|remove <name>  |  list';

if (cmd !== 'list' && !USERNAME_RE.test(name)) fail(rawName ? 'Usernames use a-z, 0-9, dot, dash or underscore (max 32).' : usage);

const db = openDb(process.env.DATA_DIR || './data');

switch (cmd) {
  case 'add':
  case 'passwd': {
    const exists = Boolean(db.userByName(name));
    if (cmd === 'add' && exists) fail(`User ${name} already exists. Use passwd to change the password.`);
    if (cmd === 'passwd' && !exists) fail(`No user ${name}.`);
    const pw = await askPassword();
    if (pw.length < MIN_PASSWORD) fail(`Password must be at least ${MIN_PASSWORD} characters.`);
    const hash = await hashPassword(pw);
    if (cmd === 'add') db.addUser(name, hash);
    else db.setPassword(name, hash);
    console.log(cmd === 'add' ? `Created ${name}.` : `Password changed for ${name}; their devices must sign in again.`);
    break;
  }
  case 'remove':
    console.log(db.removeUser(name) ? `Removed ${name} and their data.` : `No user ${name}.`);
    break;
  case 'list':
    for (const u of db.listUsers()) console.log(`${u.username}\t${new Date(u.created_at).toISOString().slice(0, 10)}`);
    break;
  default:
    fail(usage);
}
db.close();
