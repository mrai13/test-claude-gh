# Two Lifts, One Wall — training log

A phone web app for the *Two Lifts, One Wall* plan: two gym sessions a week plus one bouldering day, run with double progression.

- **Log workouts.** Session A (squat & bench) and Session B (press & legs) come pre-loaded with sets, rep ranges and rest times. Each set has +/- steppers.
- **Progression hints.** Every exercise shows last time's numbers and what to do next: add a rep, or once every set hits the top of the range, add weight (+2.5 kg upper body, +5 kg squat and RDL). Weights are prefilled.
- **The 9-week arc.** The week counter covers weeks 1–2 (find weights), 3–8 (build) and 9 (deload). In deload week the app uses half the sets at 60 % weight, then the cycle restarts.
- **Bouldering log.** Record date, duration, hardest send and notes. The app warns you when you're about to lift the day before your climbing day, or without a rest day in between.
- **Progress.** A chart per exercise shows top-set weight and estimated 1RM, with a history table and edit/delete for past workouts.
- **Offline and private.** Works without signal once opened. Data is stored only on your phone. Export and import a JSON backup from Settings.

A workout in progress is saved as you type, so it survives the phone locking or the page reloading.

## Install on your phone

1. Open the GitHub Pages URL (`https://<user>.github.io/test-claude-gh/`).
2. **iPhone:** in Safari, tap Share, then *Add to Home Screen*. **Android:** in Chrome, open the ⋮ menu and tap *Install app*.

## Run locally

No build step and no dependencies. Serve the folder with any static server:

```sh
python3 -m http.server 5173   # or: npm start
```

Tests (Node 20+):

```sh
npm test
```

## Deploy

`.github/workflows/deploy.yml` runs the tests and publishes the site to GitHub Pages on every push to `main`. It needs a one-time setup: go to **Settings → Pages → Source** and choose **GitHub Actions**.

When you change app files, bump `VERSION` in `sw.js` so installed copies pick up the update.

## Layout

| Path | What |
|---|---|
| `js/plan.js` | The plan as data: exercises, sets, rep ranges, rest, increments |
| `js/progression.js` | Double-progression rules, cycle weeks, e1RM, schedule warnings (pure, tested) |
| `js/store.js` | localStorage persistence, export/import |
| `js/app.js` | Screens and interactions |
| `js/chart.js` | SVG progress chart |
| `sw.js`, `manifest.webmanifest` | Offline support and installability |
