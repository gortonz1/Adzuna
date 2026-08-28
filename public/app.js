import { lineChart, hBars, dataTable, fmtInt, fmtPct, fmtCompact, hideTooltip } from '/charts.js';

const CURRENCY = { gb: '£', us: '$', au: 'A$', ca: 'C$', de: '€', fr: '€', in: '₹', nl: '€', nz: 'NZ$', pl: 'zł ', sg: 'S$', za: 'R' };

const state = {
  country: 'gb',
  category: 'it-jobs',
  meta: null,
  overview: null,
  snapshots: [],
  history: [],
  companies: [],
};

const $ = (sel) => document.querySelector(sel);
const panels = {};
for (const card of document.querySelectorAll('.card')) {
  const body = card.querySelector('.body');
  const panel = { body, view: 'chart', render: null };
  panels[card.dataset.panel] = panel;
  for (const btn of card.querySelectorAll('.view-toggle button')) {
    btn.addEventListener('click', () => {
      panel.view = btn.dataset.view;
      for (const b of card.querySelectorAll('.view-toggle button')) {
        b.setAttribute('aria-pressed', String(b === btn));
      }
      hideTooltip();
      panel.render?.();
    });
  }
}

const fmtSalary = (n) => `${CURRENCY[state.country] || ''}${fmtCompact(n)}`;

function monthLabel(iso) {
  const [y, m] = iso.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[m - 1]} ${String(y).slice(2)}`;
}

// Daily snapshots can pile up; show at most ~40 points, thinning evenly.
function thin(points, max = 40) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[Math.floor(i)]);
  if (out.at(-1) !== points.at(-1)) out.push(points.at(-1));
  return out;
}

async function api(path, params = {}) {
  const url = new URL(path, location.origin);
  url.searchParams.set('country', state.country);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return res.json();
}

function setBanner(html) {
  const banner = $('#banner');
  if (!html) { banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  banner.replaceChildren(...html);
}

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---- renderers ------------------------------------------------------------

function renderKpis() {
  const box = $('#kpis');
  box.replaceChildren();
  const o = state.overview;
  if (!o) return;

  const tiles = [];
  tiles.push({ label: 'Live vacancies', value: fmtCompact(o.total) });
  tiles.push({ label: `Vacancies mentioning “${state.meta.aiQuery}”`, value: fmtCompact(o.ai) });

  const snaps = state.snapshots;
  let delta = null;
  if (snaps.length >= 2) {
    const pp = (snaps.at(-1).share - snaps.at(-2).share) * 100;
    delta = { text: `${pp >= 0 ? '+' : ''}${pp.toFixed(2)} pp vs previous snapshot`, up: pp >= 0 };
  }
  tiles.push({ label: 'AI share of all ads', value: fmtPct(o.share), delta });

  const top = [...o.categories].sort((a, b) => b.share - a.share)[0];
  if (top) tiles.push({ label: 'Profession asking for AI most', value: top.label.replace(/ Jobs$/, ''), delta: { text: `${fmtPct(top.share)} of its ads` } });

  for (const t of tiles) {
    const tile = el('div', undefined, 'tile');
    tile.appendChild(el('div', t.label, 'label'));
    const value = el('div', t.value, 'value');
    if (t.value.length > 14) value.style.fontSize = '20px';
    tile.appendChild(value);
    if (t.delta) tile.appendChild(el('div', t.delta.text, `delta${t.delta.up ? ' up' : ''}`));
    box.appendChild(tile);
  }
}

function renderAiCount() {
  const p = panels['ai-count'];
  const points = thin(state.snapshots).map((s) => ({ label: monthLabel(s.date), value: s.ai }));
  p.render = () => p.view === 'chart'
    ? lineChart(p.body, { points, name: 'AI-mentioning vacancies', yFormat: fmtCompact })
    : dataTable(p.body, ['Date', 'AI-mentioning vacancies'], state.snapshots.map((s) => [s.date, fmtInt(s.ai)]), [1]);
  p.render();
}

function renderAiShare() {
  const p = panels['ai-share'];
  const points = thin(state.snapshots).map((s) => ({ label: monthLabel(s.date), value: s.share }));
  p.render = () => p.view === 'chart'
    ? lineChart(p.body, { points, name: 'AI share of all vacancies', yFormat: fmtPct })
    : dataTable(p.body, ['Date', 'AI share'], state.snapshots.map((s) => [s.date, fmtPct(s.share)]), [1]);
  p.render();
}

function renderByProfession() {
  const p = panels['by-profession'];
  const cats = state.overview ? [...state.overview.categories].sort((a, b) => b.share - a.share).slice(0, 14) : [];
  const items = cats.map((c) => ({
    label: c.label.replace(/ Jobs$/, ''),
    value: c.share,
    tooltipRows: [
      { value: fmtPct(c.share), name: 'of its ads mention AI' },
      { value: fmtInt(c.ai), name: `AI ads of ${fmtInt(c.total)} total` },
    ],
  }));
  p.render = () => p.view === 'chart'
    ? hBars(p.body, { items, format: fmtPct })
    : dataTable(p.body, ['Profession', 'AI ads', 'All ads', 'AI share'],
        (state.overview?.categories || []).map((c) => [c.label, fmtInt(c.ai), fmtInt(c.total), fmtPct(c.share)]), [1, 2, 3]);
  p.render();
}

function renderSalary() {
  const p = panels['salary'];
  const catLabel = $('#category-select').selectedOptions[0]?.textContent || '';
  $('#salary-title').textContent = `Average advertised salary — ${catLabel}`;
  const points = state.history.map((h) => ({ label: monthLabel(h.month), value: h.salary }));
  p.render = () => p.view === 'chart'
    ? lineChart(p.body, { points, name: 'Average advertised salary', yFormat: fmtSalary })
    : dataTable(p.body, ['Month', 'Average salary'], state.history.map((h) => [h.month, fmtSalary(h.salary)]), [1]);
  p.render();
}

function renderCompanies() {
  const p = panels['companies'];
  const catLabel = $('#category-select').selectedOptions[0]?.textContent || '';
  $('#companies-title').textContent = `Top employers advertising AI roles — ${catLabel}`;
  p.render = () => dataTable(p.body, ['Employer', 'Live AI ads', 'Avg salary'],
    state.companies.map((c) => [c.name, fmtInt(c.count), c.avgSalary ? fmtSalary(c.avgSalary) : '—']), [1, 2]);
  p.render();
}

function renderAll() {
  renderKpis();
  renderAiCount();
  renderAiShare();
  renderByProfession();
  renderSalary();
  renderCompanies();
}

// ---- data loading ---------------------------------------------------------

function setRefetching(on) {
  for (const p of Object.values(panels)) p.body.classList.toggle('refetching', on);
}

async function loadOverview() {
  // Live mode builds the overview in the background; poll until it's ready.
  for (;;) {
    const res = await api('/api/overview');
    if (res.status === 'ready') {
      setBanner(state.meta.demo ? demoBannerNodes() : null);
      return res.data;
    }
    if (res.status === 'error') throw new Error(res.error || 'overview failed');
    const frag = [el('span', '')];
    const strong = el('strong', 'Scanning the market… ');
    frag[0].appendChild(strong);
    frag[0].appendChild(document.createTextNode(
      `fetching live counts from Adzuna (${res.done}/${res.total} requests, rate-limited). This first run takes a few minutes; results are cached for 24h.`));
    const track = el('div', undefined, 'progress-track');
    const fill = el('div', undefined, 'progress-fill');
    fill.style.width = `${Math.round((res.done / Math.max(1, res.total)) * 100)}%`;
    track.appendChild(fill);
    setBanner([frag[0], track]);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

function demoBannerNodes() {
  const span = el('span', '');
  const strong = el('strong', 'Demo data. ');
  span.appendChild(strong);
  span.appendChild(document.createTextNode(
    'All numbers on this page are synthetic. Add your free Adzuna API keys to .env (see README) to see live data.'));
  return [span];
}

function populateCategories() {
  const catSel = $('#category-select');
  const prev = state.category;
  catSel.replaceChildren();
  for (const c of state.overview.categories) {
    const opt = el('option', c.label);
    opt.value = c.tag;
    catSel.appendChild(opt);
  }
  if ([...catSel.options].some((o) => o.value === prev)) catSel.value = prev;
  else catSel.selectedIndex = 0;
  state.category = catSel.value;
}

async function loadCountryData() {
  setRefetching(true);
  try {
    const [overview, snaps] = await Promise.all([loadOverview(), api('/api/snapshots')]);
    state.overview = overview;
    state.snapshots = snaps.snapshots || [];
    populateCategories();
    await loadCategoryData(false);
    renderAll();
  } catch (err) {
    setBanner([el('span', `Something went wrong: ${err.message}`)]);
  } finally {
    setRefetching(false);
  }
}

async function loadCategoryData(rerender = true) {
  if (rerender) {
    panels['salary'].body.classList.add('refetching');
    panels['companies'].body.classList.add('refetching');
  }
  try {
    const [hist, comp] = await Promise.all([
      api('/api/history', { category: state.category }),
      api('/api/top_companies', { category: state.category }),
    ]);
    state.history = hist.months || [];
    state.companies = comp.companies || [];
    if (rerender) { renderSalary(); renderCompanies(); }
  } finally {
    panels['salary'].body.classList.remove('refetching');
    panels['companies'].body.classList.remove('refetching');
  }
}

async function init() {
  state.meta = await api('/api/meta');
  $('#ai-query').textContent = state.meta.aiQuery;
  if (state.meta.demo) setBanner(demoBannerNodes());

  const countrySel = $('#country-select');
  for (const c of state.meta.countries) {
    const opt = el('option', c.label);
    opt.value = c.code;
    countrySel.appendChild(opt);
  }
  countrySel.value = state.country;
  countrySel.addEventListener('change', () => {
    state.country = countrySel.value;
    loadCountryData();
  });

  const catSel = $('#category-select');
  catSel.addEventListener('change', () => {
    state.category = catSel.value;
    loadCategoryData();
  });

  await loadCountryData();
}

init().catch((err) => setBanner([el('span', `Failed to start: ${err.message}`)]));
