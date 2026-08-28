// Minimal chart kit: single-series line chart (SVG, crosshair tooltip,
// keyboard-readable), horizontal bar chart (HTML), and table views.
// All labels/values are inserted via textContent — never innerHTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

export const fmtInt = (n) => Math.round(n).toLocaleString('en-GB');
export const fmtPct = (n) => `${(n * 100).toFixed(1)}%`;
export const fmtCompact = (n) => {
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return fmtInt(n);
};

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function htmlEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// ---- shared tooltip -------------------------------------------------------

let tooltipEl = null;
function tooltip() {
  if (!tooltipEl) {
    tooltipEl = htmlEl('div', 'tooltip');
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

function showTooltip(clientX, clientY, title, rows) {
  const tip = tooltip();
  tip.replaceChildren();
  tip.appendChild(htmlEl('div', 't-title', title));
  for (const r of rows) {
    const row = htmlEl('div', 't-row');
    const key = htmlEl('span', 't-key');
    if (r.color) key.style.borderTopColor = r.color;
    row.appendChild(key);
    row.appendChild(htmlEl('span', 't-val', r.value));
    if (r.name) row.appendChild(htmlEl('span', 't-name', r.name));
    tip.appendChild(row);
  }
  tip.style.display = 'block';
  const { width, height } = tip.getBoundingClientRect();
  let x = clientX + 14;
  let y = clientY - height - 10;
  if (x + width > window.innerWidth - 8) x = clientX - width - 14;
  if (y < 8) y = clientY + 14;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

export function hideTooltip() {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

// ---- scale helpers --------------------------------------------------------

function niceTicks(min, max, target = 4) {
  if (min === max) { min = min === 0 ? 0 : min * 0.9; max = max === 0 ? 1 : max * 1.1; }
  const span = max - min;
  const step0 = span / target;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => span / s <= target + 0.5) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

// ---- line chart -----------------------------------------------------------

// opts: { points: [{label, value}], name, yFormat, baselineZero }
export function lineChart(container, opts) {
  if (container._ro) container._ro.disconnect();
  const render = () => renderLine(container, opts);
  container._ro = new ResizeObserver(() => render());
  container._ro.observe(container);
  render();
}

function renderLine(container, { points, name = '', yFormat = fmtInt, baselineZero = false }) {
  container.replaceChildren();
  if (!points || points.length < 2) {
    container.appendChild(htmlEl('div', 'empty', points && points.length === 1
      ? `Only one data point so far (${yFormat(points[0].value)}) — the trend line appears once more snapshots are collected.`
      : 'No data yet.'));
    return;
  }

  const W = Math.max(300, container.clientWidth || 460);
  const H = 230;
  const m = { top: 14, right: 52, bottom: 26, left: 8 };
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (baselineZero) min = 0;
  const pad = (max - min) * 0.08;
  const { lo, hi, ticks } = niceTicks(baselineZero ? 0 : min - pad, max + pad);

  // Left margin sized to the widest tick label (~7px per char).
  const tickLabels = ticks.map(yFormat);
  m.left = Math.max(...tickLabels.map((t) => t.length)) * 7 + 12;

  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const x = (i) => m.left + (i / (points.length - 1)) * plotW;
  const y = (v) => m.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: '0' });
  svg.setAttribute('aria-label', `${name} line chart, ${points.length} points, latest ${yFormat(points.at(-1).value)}`);
  svg.style.width = `${W}px`;

  // gridlines + y tick labels (hairline, solid, recessive)
  for (let t = 0; t < ticks.length; t++) {
    const gy = y(ticks[t]);
    svg.appendChild(svgEl('line', {
      x1: m.left, x2: m.left + plotW, y1: gy, y2: gy,
      stroke: t === 0 ? 'var(--baseline)' : 'var(--grid)', 'stroke-width': 1,
    }));
    const lbl = svgEl('text', { x: m.left - 6, y: gy + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--text-muted)' });
    lbl.textContent = tickLabels[t];
    svg.appendChild(lbl);
  }

  // x labels: ~5, evenly spaced
  const every = Math.max(1, Math.round(points.length / 5));
  points.forEach((p, i) => {
    const isLast = i === points.length - 1;
    // Skip regular labels that would crowd the always-shown last label.
    if (!isLast && (i % every !== 0 || points.length - 1 - i < every * 0.6)) return;
    const lbl = svgEl('text', {
      x: x(i), y: H - 8, 'text-anchor': i === points.length - 1 ? 'end' : 'middle',
      'font-size': 11, fill: 'var(--text-muted)',
    });
    lbl.textContent = p.label;
    svg.appendChild(lbl);
  });

  // the line (2px, round joins) — single series in slot 1
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  svg.appendChild(svgEl('path', {
    d, fill: 'none', stroke: 'var(--series-1)', 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));

  // end marker: >=8px dot with a 2px surface ring, plus a direct end label
  const lastX = x(points.length - 1);
  const lastY = y(points.at(-1).value);
  svg.appendChild(svgEl('circle', { cx: lastX, cy: lastY, r: 4.5, fill: 'var(--series-1)', stroke: 'var(--surface-1)', 'stroke-width': 2 }));
  const endLbl = svgEl('text', { x: lastX + 8, y: lastY + 4, 'font-size': 11.5, 'font-weight': 650, fill: 'var(--text-primary)' });
  endLbl.textContent = yFormat(points.at(-1).value);
  svg.appendChild(endLbl);

  // crosshair + tooltip layer
  const cross = svgEl('line', { y1: m.top, y2: m.top + plotH, stroke: 'var(--baseline)', 'stroke-width': 1, visibility: 'hidden' });
  const dot = svgEl('circle', { r: 4.5, fill: 'var(--series-1)', stroke: 'var(--surface-1)', 'stroke-width': 2, visibility: 'hidden' });
  svg.appendChild(cross);
  svg.appendChild(dot);

  let focusIdx = points.length - 1;
  const showAt = (i, clientX, clientY) => {
    const px = x(i);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px);
    cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', px); dot.setAttribute('cy', y(points[i].value));
    dot.setAttribute('visibility', 'visible');
    showTooltip(clientX, clientY, points[i].label, [{ value: yFormat(points[i].value), name, color: 'var(--series-1)' }]);
  };
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    hideTooltip();
  };

  const hit = svgEl('rect', { x: m.left, y: m.top, width: plotW, height: plotH, fill: 'transparent' });
  hit.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - m.left) / plotW) * (points.length - 1));
    showAt(Math.max(0, Math.min(points.length - 1, i)), e.clientX, e.clientY);
  });
  hit.addEventListener('pointerleave', hide);
  svg.appendChild(hit);

  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    focusIdx = Math.max(0, Math.min(points.length - 1, focusIdx + (e.key === 'ArrowRight' ? 1 : -1)));
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + (x(focusIdx) / W) * rect.width;
    showAt(focusIdx, cx, rect.top + rect.height / 2);
  });
  svg.addEventListener('blur', hide);

  container.appendChild(svg);
}

// ---- horizontal bar chart -------------------------------------------------

// opts: { items: [{label, value, tooltipRows}], format }
export function hBars(container, { items, format = fmtPct }) {
  container.replaceChildren();
  if (!items || !items.length) {
    container.appendChild(htmlEl('div', 'empty', 'No data yet.'));
    return;
  }
  const max = Math.max(...items.map((i) => i.value));
  const wrap = htmlEl('div', 'hbar');
  for (const item of items) {
    const row = htmlEl('span', 'row-hit');
    row.tabIndex = 0;
    const cat = htmlEl('span', 'cat', item.label);
    cat.title = item.label;
    const track = htmlEl('span', 'track');
    const bar = htmlEl('span', 'bar');
    bar.style.width = `${Math.max(0.5, (item.value / max) * 100)}%`;
    track.appendChild(bar);
    track.appendChild(htmlEl('span', 'val', format(item.value))); // value at the bar tip
    row.appendChild(cat);
    row.appendChild(track);

    const show = (cx, cy) => showTooltip(cx, cy, item.label,
      (item.tooltipRows || [{ value: format(item.value) }]).map((r) => ({ ...r, color: 'var(--series-1)' })));
    row.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
    row.addEventListener('pointerleave', hideTooltip);
    row.addEventListener('focus', () => {
      const r = bar.getBoundingClientRect();
      show(r.right, r.top);
    });
    row.addEventListener('blur', hideTooltip);
    wrap.appendChild(row);
  }
  container.appendChild(wrap);
}

// ---- table view -----------------------------------------------------------

export function dataTable(container, headers, rows, numericCols = []) {
  container.replaceChildren();
  const table = htmlEl('table', 'data');
  const thead = htmlEl('thead');
  const trh = htmlEl('tr');
  headers.forEach((h, i) => {
    const th = htmlEl('th', numericCols.includes(i) ? 'num' : '', h);
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = htmlEl('tbody');
  for (const row of rows) {
    const tr = htmlEl('tr');
    row.forEach((cell, i) => tr.appendChild(htmlEl('td', numericCols.includes(i) ? 'num' : '', String(cell))));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}
