// Starts the API. Configuration comes from the environment:
//   APP_ORIGIN     comma-separated origins allowed to call the API (required), e.g. https://app.example.com
//   DATA_DIR       where tlow.db lives (default ./data)
//   PORT           default 3000
//   COOKIE_SECURE  set to 0 only for plain-http local development
import { openDb } from './db.js';
import { createApp } from './app.js';

const appOrigins = (process.env.APP_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
if (!appOrigins.length) {
  console.error('Set APP_ORIGIN to the app URL, e.g. APP_ORIGIN=https://app.example.com');
  process.exit(1);
}

const db = openDb(process.env.DATA_DIR || './data');
const port = Number(process.env.PORT || 3000);
const server = createApp({ db, appOrigins, cookieSecure: process.env.COOKIE_SECURE !== '0' });

server.listen(port, () => console.log(`API listening on :${port}, allowing ${appOrigins.join(', ')}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
