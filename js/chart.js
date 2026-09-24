// Small SVG line chart: top-set weight and estimated 1RM over time (same kg axis).
// Hover/tap shows a crosshair and tooltip for the nearest session.

import { fmtKg } from './progression.js';

const W = 340, H = 200, PAD = { l: 40, r: 12, t: 12, b: 28 };

/**
 * points: [{ date: 'YYYY-MM-DD', label: string, weight: number, e1rm: number }]
 * Returns an element.
 */
export function lineChart(points) {
  const wrap = document.createElement('div');
  wrap.className = 'chart';
  if (points.length < 2) {
    wrap.innerHTML = `<p class="muted">Log this exercise ${points.length ? 'once more' : 'twice'} to see a chart.</p>`;
    return wrap;
  }
  const vals = points.flatMap((p) => [p.weight, p.e1rm]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 10;
  lo = Math.max(0, Math.floor((lo - span * 0.1) / 5) * 5);
  hi = Math.ceil((hi + span * 0.1) / 5) * 5;
  const x = (i) => PAD.l + (i * (W - PAD.l - PAD.r)) / (points.length - 1);
  const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const path = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const ticks = [lo, (lo + hi) / 2, hi];
  const short = (iso) => { const [, m, d] = iso.split('-'); return `${Number(d)}/${Number(m)}`; };

  wrap.innerHTML = `
    <div class="legend" aria-hidden="true">
      <span><i class="swatch s1"></i>Top set</span>
      <span><i class="swatch s2"></i>Est. 1RM</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Top-set weight and estimated one-rep max over time">
      ${ticks.map((t) => `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(t)}" y2="${y(t)}"/>
        <text class="axis" x="${PAD.l - 6}" y="${y(t) + 4}" text-anchor="end">${Math.round(t)}</text>`).join('')}
      <text class="axis" x="${x(0)}" y="${H - 8}" text-anchor="start">${short(points[0].date)}</text>
      <text class="axis" x="${x(points.length - 1)}" y="${H - 8}" text-anchor="end">${short(points.at(-1).date)}</text>
      <path class="line s2" d="${path('e1rm')}"/>
      <path class="line s1" d="${path('weight')}"/>
      ${points.map((p, i) => `<circle class="dot s2" cx="${x(i)}" cy="${y(p.e1rm)}" r="4"/>
        <circle class="dot s1" cx="${x(i)}" cy="${y(p.weight)}" r="4"/>`).join('')}
      <line class="crosshair" y1="${PAD.t}" y2="${H - PAD.b}" visibility="hidden"/>
      <rect class="hit" x="${PAD.l}" y="0" width="${W - PAD.l - PAD.r}" height="${H}" fill="transparent"/>
    </svg>
    <div class="tooltip" hidden></div>`;

  const svg = wrap.querySelector('svg');
  const cross = svg.querySelector('.crosshair');
  const tip = wrap.querySelector('.tooltip');
  const show = (evt) => {
    const r = svg.getBoundingClientRect();
    const sx = ((evt.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((sx - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1))));
    const p = points[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `<strong>${p.date}</strong><br>${p.label}<br><i class="swatch s1"></i>Top set ${fmtKg(p.weight)}<br><i class="swatch s2"></i>Est. 1RM ${fmtKg(Math.round(p.e1rm * 2) / 2)}`;
    const px = (x(i) / W) * r.width;
    tip.style.left = `${Math.min(Math.max(px - 80, 0), r.width - 160)}px`;
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
  return wrap;
}
