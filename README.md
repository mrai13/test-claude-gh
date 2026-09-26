# Two Lifts, One Wall — training log

A phone web app for the *Two Lifts, One Wall* plan: two gym sessions a week plus one bouldering day, run with double progression.

- **Log workouts.** Session A (squat & bench) and Session B (press & legs) come pre-loaded with sets, rep ranges and rest times. Each set has +/- steppers.
- **Progression hints.** Every exercise shows last time's numbers and what to do next: add a rep, or once every set hits the top of the range, add weight (+2.5 kg upper body, +5 kg squat and RDL). Weights are prefilled.
- **The 9-week arc.** The week counter covers weeks 1–2 (find weights), 3–8 (build) and 9 (deload). In deload week the app uses half the sets at 60 % weight, then the cycle restarts.
- **Bouldering log.** Record date, duration, hardest send and notes. The app warns you when you're about to lift the day before your climbing day, or without a rest day in between.
- **Progress.** A chart per exercise shows top-set weight and estimated 1RM, with a history table and edit/delete for past workouts.
- **Private, synced, offline.** Sign in with a username and password; each account's data is kept separately on your server and shows up on all your devices. The phone keeps a copy, so logging works without signal and syncs when you're back online. Export and import a JSON backup from Settings.

A workout in progress is saved as you type, so it survives the phone locking or the page reloading. It stays on that device until you save it.

## How it's hosted

| Part | Where | What |
|---|---|---|
| App (`index.html`, `js/`, `css/`, …) | Cloudflare Pages, `<name>.<domain>` | Static files, deployed on every push to `main` |
| API (`server/`) | Your VPS in Docker, `<name>-api.<domain>` | Login and data storage (SQLite), reached through a Cloudflare Tunnel |

Pick any `<name>`, e.g. `lifts.example.com` and `lifts-api.example.com`: the app finds the API by adding `-api` to the first part of its own address (`js/config.js`). Keep both one level below your domain, which Cloudflare's free certificate covers. No npm dependencies anywhere: the API uses only Node 24 built-ins.

## Set up

You need a domain on Cloudflare and a server with Docker. Rootless Docker under a normal user works.

**1. API on the server**

Assumes a Cloudflare Tunnel already runs on this server on a Docker network named `tlow`, with a **public hostname** `<name>-api.<domain>` → service `HTTP`, URL `api:3000`. No ports need to be open: the tunnel connects out to Cloudflare.

Create `~/tlow/.env` from `.env.example` with `APP_ORIGIN=https://<name>.<domain>`, then:

```sh
git clone https://github.com/mrai13/test-claude-gh.git ~/tlow-src
cd ~/tlow-src && docker build -t tlow-api .
docker run -d --name api --restart unless-stopped --network tlow \
  --env-file ~/tlow/.env -v tlow-data:/data tlow-api
docker exec -it api node server/users.js add <your-name>   # asks for a password
```

`https://<name>-api.<domain>/api/health` should answer `{"ok":true}`.

**2. App on Cloudflare Pages**

**Workers & Pages → Create → Pages → Connect to Git**, pick this repo, then:

- Build command: `mkdir _site && cp -r index.html manifest.webmanifest sw.js css js icons _site/`
- Build output directory: `_site`

After the first deploy, add the custom domain `<name>.<domain>` under the project's **Custom domains**.

**3. Move your data over**

1. In the old GitHub Pages app: **Settings → Export backup**.
2. Open `https://<name>.<domain>`, sign in, then **Settings → Import backup**.
3. Turn off GitHub Pages: repo **Settings → Pages → Source: None**.

**4. Install on your phone**

Open `https://<name>.<domain>`. **iPhone:** in Safari, tap Share, then *Add to Home Screen*. **Android:** in Chrome, open the ⋮ menu and tap *Install app*.

## Running the server

```sh
docker exec -it api node server/users.js add <name>      # new account (no public sign-up)
docker exec -it api node server/users.js passwd <name>   # new password, signs them out everywhere
docker exec api node server/users.js remove <name>       # delete account and its data
docker exec api node server/users.js list
```

**Update** the API (your data stays in the `tlow-data` volume):

```sh
cd ~/tlow-src && git pull && docker build -t tlow-api . && docker rm -f api
docker run -d --name api --restart unless-stopped --network tlow \
  --env-file ~/tlow/.env -v tlow-data:/data tlow-api
```

**Back up** the database now and then (it's one file in the `tlow-data` volume):

```sh
docker cp api:/data/tlow.db ~/tlow-$(date +%F).db
```

## Run locally

Two terminals, Node 22.13+:

```sh
APP_ORIGIN=http://localhost:5173 COOKIE_SECURE=0 DATA_DIR=./data npm start   # API on :3000
npm run app                                                                 # app on :5173
DATA_DIR=./data npm run adduser -- <name>
```

Tests:

```sh
npm test
```

When you change app files, bump `VERSION` in `sw.js` so installed copies pick up the update.

## Layout

| Path | What |
|---|---|
| `js/plan.js` | The plan as data: exercises, sets, rep ranges, rest, increments |
| `js/progression.js` | Double-progression rules, cycle weeks, e1RM, schedule warnings (pure, tested) |
| `js/store.js` | Per-account data: offline copy, sync with the API, export/import |
| `js/sync.js` | Merging two devices' data (pure, tested) |
| `js/config.js` | Where the API is |
| `server/` | The API: `app.js` routes, `auth.js` passwords and sessions, `db.js` SQLite, `users.js` account CLI |
| `js/app.js` | Screens and interactions |
| `js/chart.js` | SVG progress chart |
| `sw.js`, `manifest.webmanifest` | Offline support and installability |
