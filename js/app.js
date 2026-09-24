import { SESSIONS, exerciseById, exercisesFor, CYCLE_WEEKS } from './plan.js';
import {
  toISODate, cycleWeek, lastEntry, suggestNext, deloadOf, nextSession, validSets,
  fmtKg, fmtSets, e1rm, scheduleWarnings, roundKg, parseISODate,
} from './progression.js';
import * as store from './store.js';
import { lineChart } from './chart.js';

const app = document.getElementById('app');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const today = () => toISODate();
const fmtDate = (iso) => parseISODate(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const byDateDesc = (a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1);
const fmtRest = (s) => (s >= 120 ? `${s / 60} min` : `${s} s`);

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2500);
}

function suggestionFor(ex, { deload, date, excludeId }) {
  const s = suggestNext(ex, lastEntry(store.get().workouts, ex.id, { beforeDate: date, excludeId }));
  return deload ? deloadOf(ex, s) : s;
}

// ---------- routing ----------

const routes = { today: renderToday, log: renderLog, boulder: renderBoulder, progress: renderProgress, settings: renderSettings };

function route() {
  const name = (location.hash.slice(1) || 'today').split('?')[0];
  const fn = routes[name] || renderToday;
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.hash === `#${name}`));
  fn();
  window.scrollTo(0, 0);
}

const go = (name) => { if (location.hash === `#${name}`) route(); else location.hash = name; };

// ---------- Today ----------

function renderToday() {
  const s = store.get();
  const t = today();
  const cw = cycleWeek(s.settings.cycleStart, t);
  const next = nextSession(s.workouts);
  const warnings = scheduleWarnings({ workouts: s.workouts, boulders: s.boulders, climbDay: s.settings.climbDay, todayISO: t });

  const cycleCard = cw
    ? `<section class="card cycle ${cw.deload ? 'deload' : ''}">
         <div class="eyebrow">Cycle ${cw.cycle} · Week ${cw.week} of ${CYCLE_WEEKS}</div>
         <h2>${cw.phase}</h2>
         <p>${cw.blurb}</p>
         <div class="weeks">${Array.from({ length: CYCLE_WEEKS }, (_, i) => `<i class="${i + 1 < cw.week ? 'done' : i + 1 === cw.week ? 'now' : ''} ${i + 1 === CYCLE_WEEKS ? 'dl' : ''}"></i>`).join('')}</div>
       </section>`
    : `<section class="card cycle">
         <div class="eyebrow">9-week arc</div>
         <h2>Start your cycle</h2>
         <p>Weeks 1–2 find your weights, 3–8 build, week 9 deload, then restart.</p>
         <button class="btn" data-action="start-cycle">Start cycle this week</button>
       </section>`;

  const renderNext = (sessionId) => exercisesFor(sessionId).map((ex) => {
    const sg = suggestionFor(ex, { deload: cw?.deload, date: t });
    return `<li><span class="exname">${esc(ex.name)}${ex.key ? ' <b class="badge">KEY</b>' : ''}</span>
      <span class="muted">${sg.weight == null ? `${ex.sets} × ${ex.repMin}–${ex.repMax}` : `${fmtKg(sg.weight)} × ${sg.targets.join(', ')}`}</span></li>`;
  }).join('');

  const nextCard = s.draft
    ? `<section class="card">
         <div class="eyebrow">In progress</div>
         <h2>${SESSIONS[s.draft.session].name} · ${fmtDate(s.draft.date)}</h2>
         <button class="btn" data-action="goto" data-to="log">Resume workout</button>
       </section>`
    : `<section class="card">
         <div class="eyebrow">Next up</div>
         <h2>${SESSIONS[next].name} <span class="muted">— ${SESSIONS[next].subtitle}</span></h2>
         <ul class="plainlist">${renderNext(next)}</ul>
         <div class="row">
           <button class="btn" data-action="start-workout" data-session="${next}">Start ${SESSIONS[next].name}</button>
           <button class="btn ghost" data-action="start-workout" data-session="${next === 'A' ? 'B' : 'A'}">Do ${next === 'A' ? 'B' : 'A'} instead</button>
         </div>
       </section>`;

  const recent = [
    ...s.workouts.map((w) => ({ ...w, kind: 'lift' })),
    ...s.boulders.map((b) => ({ ...b, kind: 'boulder' })),
  ].sort(byDateDesc).slice(0, 6);

  app.innerHTML = `
    ${cycleCard}
    ${warnings.map((w) => `<div class="warn" role="note"><span aria-hidden="true">⚠</span> ${w}</div>`).join('')}
    ${nextCard}
    <section class="card">
      <div class="eyebrow">Recent</div>
      ${recent.length ? `<ul class="plainlist">${recent.map((r) => r.kind === 'lift'
        ? `<li><span>${fmtDate(r.date)}</span><span>${SESSIONS[r.session].name}${r.deload ? ' <b class="badge">DELOAD</b>' : ''}</span></li>`
        : `<li><span>${fmtDate(r.date)}</span><span>Boulder${r.hardestGrade ? ` · ${esc(r.hardestGrade)}` : ''}</span></li>`).join('')}</ul>`
        : '<p class="muted">Nothing logged yet.</p>'}
    </section>`;
}

// ---------- Log workout ----------

function buildEntries(session, deload, date) {
  return exercisesFor(session).map((ex) => {
    const sg = suggestionFor(ex, { deload, date });
    return { exerciseId: ex.id, sets: sg.targets.map(() => ({ weight: sg.weight ?? '', reps: '' })) };
  });
}

function startWorkout(session) {
  const t = today();
  const deload = !!cycleWeek(store.get().settings.cycleStart, t)?.deload;
  store.update((s) => {
    s.draft = { editingId: null, date: t, session, deload, notes: '', entries: buildEntries(session, deload, t) };
  });
  go('log');
}

function draftHasReps(d) {
  return d.entries.some((e) => e.sets.some((x) => x.reps !== ''));
}

function renderLog() {
  const d = store.get().draft;
  if (!d) {
    app.innerHTML = `<section class="card"><h2>No workout in progress</h2>
      <div class="row">
        <button class="btn" data-action="start-workout" data-session="A">Start Session A</button>
        <button class="btn" data-action="start-workout" data-session="B">Start Session B</button>
      </div></section>`;
    return;
  }
  const cards = d.entries.map((entry, ei) => {
    const ex = exerciseById(entry.exerciseId);
    const last = lastEntry(store.get().workouts, ex.id, { beforeDate: d.date, excludeId: d.editingId });
    const sg = suggestionFor(ex, { deload: d.deload, date: d.date, excludeId: d.editingId });
    return `<section class="card ex" data-ei="${ei}">
      <header>
        <h3>${esc(ex.name)}${ex.key ? ' <b class="badge">KEY</b>' : ''}</h3>
        <div class="muted">${ex.sets} × ${ex.repMin}–${ex.repMax} · rest ${fmtRest(ex.restSec)}${ex.dumbbell ? ' · kg per dumbbell' : ''}</div>
      </header>
      <details><summary>Form cue</summary><p>${esc(ex.cue)}</p></details>
      <p class="last">${last ? `Last (${fmtDate(last.date)}): <strong>${fmtSets(last.sets)}</strong>` : 'No history yet.'}</p>
      <p class="hint ${sg.kind}">${sg.kind === 'increase' ? '▲ ' : ''}${sg.text}</p>
      <div class="sets">
        ${entry.sets.map((set, si) => `
          <div class="set ${set.reps !== '' ? 'filled' : ''}" data-si="${si}">
            <span class="setno">${si + 1}</span>
            <div class="stepper">
              <button type="button" data-action="step" data-field="weight" data-delta="-${ex.increment}" aria-label="Less weight">−</button>
              <input data-field="weight" inputmode="decimal" value="${esc(set.weight)}" placeholder="kg" aria-label="Set ${si + 1} weight in kg">
              <button type="button" data-action="step" data-field="weight" data-delta="${ex.increment}" aria-label="More weight">+</button>
            </div>
            <span class="times">×</span>
            <div class="stepper">
              <button type="button" data-action="step" data-field="reps" data-delta="-1" aria-label="Fewer reps">−</button>
              <input data-field="reps" inputmode="numeric" value="${esc(set.reps)}" placeholder="${sg.targets[si] ?? ex.repMin}" aria-label="Set ${si + 1} reps">
              <button type="button" data-action="step" data-field="reps" data-delta="1" aria-label="More reps">+</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="row small">
        <button type="button" class="link" data-action="add-set">+ set</button>
        ${entry.sets.length > 1 ? '<button type="button" class="link" data-action="remove-set">− set</button>' : ''}
      </div>
    </section>`;
  }).join('');

  app.innerHTML = `
    <section class="card">
      <div class="eyebrow">${d.editingId ? 'Editing workout' : 'Logging'}</div>
      <div class="seg" role="group" aria-label="Session">
        ${['A', 'B'].map((id) => `<button type="button" class="${d.session === id ? 'on' : ''}" data-action="set-session" data-session="${id}">${SESSIONS[id].name}<small>${SESSIONS[id].subtitle}</small></button>`).join('')}
      </div>
      <div class="row">
        <label>Date <input type="date" data-field="date" value="${d.date}"></label>
        <label class="check"><input type="checkbox" data-field="deload" ${d.deload ? 'checked' : ''}> Deload</label>
      </div>
      <p class="muted small">Fill reps as you finish each set. The grey number is your target; tap + to start from it. Sets without reps aren’t saved.</p>
    </section>
    ${cards}
    <section class="card">
      <label>Notes<textarea data-field="notes" rows="2" placeholder="How did it feel? Anything hurt?">${esc(d.notes)}</textarea></label>
      <div class="row">
        <button class="btn" data-action="save-workout">Save workout</button>
        <button class="btn ghost danger" data-action="discard-workout">Discard</button>
      </div>
    </section>`;
}

function onLogInput(el) {
  const field = el.dataset.field;
  store.update((s) => {
    const d = s.draft;
    if (!d) return;
    if (field === 'date') d.date = el.value || today();
    else if (field === 'notes') d.notes = el.value;
    else if (field === 'weight' || field === 'reps') {
      const ei = Number(el.closest('.ex').dataset.ei);
      const si = Number(el.closest('.set').dataset.si);
      d.entries[ei].sets[si][field] = el.value.replace(',', '.').trim();
      el.closest('.set').classList.toggle('filled', d.entries[ei].sets[si].reps !== '');
    }
  });
}

function stepValue(btn) {
  const setEl = btn.closest('.set');
  const input = setEl.querySelector(`input[data-field="${btn.dataset.field}"]`);
  const delta = Number(btn.dataset.delta);
  let cur = input.value === '' ? null : Number(input.value.replace(',', '.'));
  if (btn.dataset.field === 'reps') {
    // First tap on an empty reps box fills in the target.
    input.value = cur == null || Number.isNaN(cur) ? input.placeholder : Math.max(0, cur + delta);
  } else {
    input.value = roundKg((Number.isNaN(cur) || cur == null ? 0 : cur) + delta);
  }
  onLogInput(input);
}

function saveWorkout() {
  const d = store.get().draft;
  const entries = d.entries
    .map((e) => ({ exerciseId: e.exerciseId, sets: validSets(e.sets).map((x) => ({ weight: Number(x.weight), reps: Number(x.reps) })) }))
    .filter((e) => e.sets.length);
  if (!entries.length) { toast('Enter reps for at least one set first.'); return; }
  store.update((s) => {
    const w = { id: d.editingId || store.uid(), date: d.date, session: d.session, deload: d.deload, notes: d.notes.trim(), entries };
    const i = s.workouts.findIndex((x) => x.id === w.id);
    if (i >= 0) s.workouts[i] = { ...s.workouts[i], ...w };
    else s.workouts.push({ ...w, createdAt: Date.now() });
    if (!s.settings.cycleStart) s.settings.cycleStart = d.date;
    s.draft = null;
  });
  toast('Workout saved 💪');
  go('today');
}

// ---------- Boulder ----------

function renderBoulder() {
  const s = store.get();
  const list = [...s.boulders].sort(byDateDesc);
  app.innerHTML = `
    <section class="card">
      <div class="eyebrow">Log a climbing session</div>
      <form id="boulder-form" class="stack">
        <label>Date <input type="date" name="date" value="${today()}" required></label>
        <div class="row">
          <label>Duration (min) <input name="durationMin" inputmode="numeric" placeholder="90"></label>
          <label>Hardest send <input name="hardestGrade" placeholder="e.g. V4 / 6B+"></label>
        </div>
        <label>Notes <textarea name="notes" rows="2" placeholder="Projects, fingers, skin…"></textarea></label>
        <button class="btn">Save session</button>
      </form>
    </section>
    <section class="card">
      <div class="eyebrow">History</div>
      ${list.length ? `<ul class="plainlist">${list.map((b) => `<li>
          <div><strong>${fmtDate(b.date)}</strong>${b.hardestGrade ? ` · ${esc(b.hardestGrade)}` : ''}${b.durationMin ? ` · ${esc(b.durationMin)} min` : ''}
          ${b.notes ? `<div class="muted small">${esc(b.notes)}</div>` : ''}</div>
          <button class="link danger" data-action="delete-boulder" data-id="${b.id}" aria-label="Delete">Delete</button></li>`).join('')}</ul>`
        : '<p class="muted">No climbing sessions logged yet.</p>'}
    </section>`;
  document.getElementById('boulder-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    store.update((st) => st.boulders.push({
      id: store.uid(), createdAt: Date.now(), date: f.get('date') || today(),
      durationMin: String(f.get('durationMin') || '').trim(), hardestGrade: String(f.get('hardestGrade') || '').trim(), notes: String(f.get('notes') || '').trim(),
    }));
    toast('Climb logged 🧗');
    renderBoulder();
  });
}

// ---------- Progress ----------

let progressExercise = 'squat';

function renderProgress() {
  const s = store.get();
  const ex = exerciseById(progressExercise);
  const rows = s.workouts
    .filter((w) => !w.deload)
    .map((w) => ({ w, e: w.entries.find((x) => x.exerciseId === ex.id) }))
    .filter((r) => r.e && r.e.sets.length)
    .sort((a, b) => byDateDesc(b.w, a.w));
  const points = rows.map(({ w, e }) => ({
    date: w.date,
    label: fmtSets(e.sets),
    weight: Math.max(...e.sets.map((x) => x.weight)),
    e1rm: Math.max(...e.sets.map((x) => e1rm(x.weight, x.reps))),
  }));
  const best = points.length ? Math.max(...points.map((p) => p.e1rm)) : 0;
  const delta = points.length > 1 ? points.at(-1).weight - points[0].weight : 0;

  app.innerHTML = `
    <section class="card">
      <label>Exercise
        <select id="ex-pick">
          ${['A', 'B'].map((sid) => `<optgroup label="${SESSIONS[sid].name}">${exercisesFor(sid).map((e) => `<option value="${e.id}" ${e.id === ex.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</optgroup>`).join('')}
        </select>
      </label>
      ${points.length ? `<div class="stats">
        <div><span class="big">${fmtKg(points.at(-1).weight)}</span><span class="muted">working weight</span></div>
        <div><span class="big">${fmtKg(Math.round(best * 2) / 2)}</span><span class="muted">best est. 1RM</span></div>
        <div><span class="big">${delta >= 0 ? '+' : ''}${fmtKg(delta)}</span><span class="muted">since ${fmtDate(points[0].date)}</span></div>
      </div>` : ''}
      <div id="chart-slot"></div>
      ${rows.length ? `<table class="history"><thead><tr><th>Date</th><th>Sets</th></tr></thead><tbody>
        ${[...rows].reverse().map(({ w, e }) => `<tr><td>${fmtDate(w.date)}</td><td>${fmtSets(e.sets)}</td></tr>`).join('')}
      </tbody></table>` : ''}
      <p class="muted small">Deload weeks are left out of the chart.</p>
    </section>
    <section class="card">
      <div class="eyebrow">All workouts</div>
      ${s.workouts.length ? `<ul class="plainlist">${[...s.workouts].sort(byDateDesc).map((w) => `<li>
        <div><strong>${fmtDate(w.date)}</strong> · ${SESSIONS[w.session].name}${w.deload ? ' <b class="badge">DELOAD</b>' : ''}
          ${w.notes ? `<div class="muted small">${esc(w.notes)}</div>` : ''}</div>
        <span class="row small"><button class="link" data-action="edit-workout" data-id="${w.id}">Edit</button>
        <button class="link danger" data-action="delete-workout" data-id="${w.id}">Delete</button></span></li>`).join('')}</ul>`
        : '<p class="muted">No workouts logged yet.</p>'}
    </section>`;
  document.getElementById('chart-slot').append(lineChart(points));
  document.getElementById('ex-pick').addEventListener('change', (e) => { progressExercise = e.target.value; renderProgress(); });
}

function editWorkout(id) {
  const s = store.get();
  if (s.draft && draftHasReps(s.draft) && !confirm('Replace the workout currently in progress?')) return;
  const w = s.workouts.find((x) => x.id === id);
  store.update((st) => {
    st.draft = {
      editingId: w.id, date: w.date, session: w.session, deload: !!w.deload, notes: w.notes || '',
      entries: exercisesFor(w.session).map((ex) => {
        const e = w.entries.find((x) => x.exerciseId === ex.id);
        return { exerciseId: ex.id, sets: e ? e.sets.map((x) => ({ weight: String(x.weight), reps: String(x.reps) })) : Array.from({ length: ex.sets }, () => ({ weight: '', reps: '' })) };
      }),
    };
  });
  go('log');
}

// ---------- Settings ----------

function renderSettings() {
  const s = store.get();
  app.innerHTML = `
    <section class="card stack">
      <div class="eyebrow">Schedule</div>
      <label>Cycle started on <input type="date" id="cycle-start" value="${s.settings.cycleStart || ''}"></label>
      <p class="muted small">Week 9 of each cycle is a deload, and new workouts start in deload mode automatically.</p>
      <label>Usual climbing day
        <select id="climb-day">
          <option value="">None / varies</option>
          ${WEEKDAYS.map((d, i) => `<option value="${i}" ${String(s.settings.climbDay) === String(i) ? 'selected' : ''}>${d}</option>`).join('')}
        </select>
      </label>
      <p class="muted small">Used to warn you when you’re about to lift the day before you climb.</p>
    </section>
    <section class="card stack">
      <div class="eyebrow">Your data</div>
      <p class="muted small">Everything stays on this device. Export a backup now and then, and before you switch phones.</p>
      <div class="row">
        <button class="btn" data-action="export">Export backup</button>
        <label class="btn ghost">Import backup<input type="file" id="import-file" accept="application/json,.json" hidden></label>
      </div>
      <button class="btn ghost danger" data-action="clear">Delete all data</button>
    </section>
    <section class="card stack">
      <div class="eyebrow">The five rules</div>
      <ol class="rules">
        <li><strong>Leave 1–2 reps in reserve</strong> on every set except the last of each exercise.</li>
        <li><strong>Take the full rest.</strong> Sets 2 and 3 are where the growth is.</li>
        <li><strong>Use straps</strong> on rows, pulldowns and RDLs.</li>
        <li><strong>Warm up in five minutes.</strong> Bike or rower, then empty bar × 8, ~60 % × 5.</li>
        <li><strong>Don’t add exercises.</strong> Energy left? Add weight next time.</li>
      </ol>
    </section>`;
  document.getElementById('cycle-start').addEventListener('change', (e) => {
    store.update((st) => { st.settings.cycleStart = e.target.value || null; });
    toast('Cycle start saved');
  });
  document.getElementById('climb-day').addEventListener('change', (e) => {
    store.update((st) => { st.settings.climbDay = e.target.value === '' ? null : Number(e.target.value); });
    toast('Climbing day saved');
  });
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (!confirm('Replace all data on this device with the backup?')) return;
      store.importJSON(text);
      toast('Backup imported');
      renderSettings();
    } catch (err) {
      toast(`Import failed: ${err.message}`);
    }
  });
}

function exportBackup() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `two-lifts-one-wall-${today()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- events ----------

app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action } = btn.dataset;
  const s = store.get();
  switch (action) {
    case 'goto': go(btn.dataset.to); break;
    case 'start-cycle': {
      // Cycle weeks run from the Monday of the current week.
      const d = new Date();
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      store.update((st) => { st.settings.cycleStart = toISODate(d); });
      renderToday();
      break;
    }
    case 'start-workout':
      if (s.draft && draftHasReps(s.draft) && !confirm('Discard the workout in progress?')) return;
      startWorkout(btn.dataset.session);
      break;
    case 'set-session': {
      const session = btn.dataset.session;
      if (session === s.draft.session) return;
      if (draftHasReps(s.draft) && !confirm('Switching session clears the sets entered so far. Continue?')) return;
      store.update((st) => { st.draft.session = session; st.draft.entries = buildEntries(session, st.draft.deload, st.draft.date); });
      renderLog();
      break;
    }
    case 'step': stepValue(btn); break;
    case 'add-set': {
      const ei = Number(btn.closest('.ex').dataset.ei);
      store.update((st) => { const sets = st.draft.entries[ei].sets; sets.push({ weight: sets.at(-1)?.weight ?? '', reps: '' }); });
      renderLog();
      break;
    }
    case 'remove-set': {
      const ei = Number(btn.closest('.ex').dataset.ei);
      store.update((st) => { st.draft.entries[ei].sets.pop(); });
      renderLog();
      break;
    }
    case 'save-workout': saveWorkout(); break;
    case 'discard-workout':
      if (!confirm(s.draft.editingId ? 'Discard your edits?' : 'Discard this workout?')) return;
      store.update((st) => { st.draft = null; });
      go('today');
      break;
    case 'edit-workout': editWorkout(btn.dataset.id); break;
    case 'delete-workout':
      if (!confirm('Delete this workout?')) return;
      store.update((st) => { st.workouts = st.workouts.filter((w) => w.id !== btn.dataset.id); });
      renderProgress();
      break;
    case 'delete-boulder':
      if (!confirm('Delete this climbing session?')) return;
      store.update((st) => { st.boulders = st.boulders.filter((b) => b.id !== btn.dataset.id); });
      renderBoulder();
      break;
    case 'export': exportBackup(); break;
    case 'clear':
      if (!confirm('Delete ALL workouts, climbs and settings on this device? This cannot be undone.')) return;
      store.clearAll();
      toast('All data deleted');
      renderSettings();
      break;
  }
});

app.addEventListener('input', (e) => {
  if (e.target.closest('.ex') || e.target.dataset.field === 'notes') onLogInput(e.target);
});

app.addEventListener('change', (e) => {
  const f = e.target.dataset.field;
  if (!store.get().draft) return;
  if (f === 'date') { onLogInput(e.target); renderLog(); }
  if (f === 'deload') {
    const deload = e.target.checked;
    store.update((st) => {
      st.draft.deload = deload;
      // Re-prefill weights and set counts only if nothing has been entered yet.
      if (!draftHasReps(st.draft)) st.draft.entries = buildEntries(st.draft.session, deload, st.draft.date);
    });
    renderLog();
  }
});

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
