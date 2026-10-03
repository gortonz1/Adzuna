// Job trends dashboard server.
//
// Serves the static dashboard from public/ and a small JSON API that either
// proxies Adzuna (when ADZUNA_APP_ID/ADZUNA_APP_KEY are set) or returns
// deterministic demo data. Live responses are cached on disk and the daily
// AI-mention counts are appended to a snapshot file so the "AI jobs over time"
// trend accumulates real history — Adzuna itself only exposes salary history,
// not keyword-count history.

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdzunaClient } from './lib/adzuna.js';
import { createStore } from './lib/store.js';
import * as demo from './lib/demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const AI_QUERY = process.env.ADZUNA_AI_QUERY || 'AI';
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const LIVE = Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
const VALID_COUNTRIES = new Set(demo.COUNTRIES.map((c) => c.code));

const client = LIVE
  ? new AdzunaClient({
      appId: process.env.ADZUNA_APP_ID,
      appKey: process.env.ADZUNA_APP_KEY,
      dataDir: DATA_DIR,
    })
  : null;

const store = createStore({ dataDir: DATA_DIR });

// country -> { status: 'loading'|'ready'|'error', done, total, data, error }
const overviewJobs = new Map();

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function appendSnapshot(country, overview) {
  await store.append(country, {
    date: new Date().toISOString().slice(0, 10),
    total: overview.total,
    ai: overview.ai,
    share: overview.share,
    categories: Object.fromEntries(overview.categories.map((c) => [c.tag, { label: c.label, total: c.total, ai: c.ai }])),
  });
}

// Full market scan: total + AI counts overall and per category. Roughly
// 2 * categories + 3 API calls, which the client spaces out under the rate
// limit, so a cold run takes a couple of minutes. Results cache for 24h.
// Rebuild an overview from the latest stored snapshot, so the dashboard has
// something to show after a restart while the first scan is still running.
async function overviewFromStore(country) {
  const latest = (await store.list(country)).at(-1);
  if (!latest?.categories) return null;
  const categories = Object.entries(latest.categories)
    .filter(([, c]) => c.total > 0)
    .map(([tag, c]) => ({
      tag,
      // Older snapshots didn't store labels; derive one from the tag.
      label: c.label || tag.replace(/-/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()).replace(/\bIt\b/, 'IT'),
      total: c.total,
      ai: c.ai,
      share: c.ai / c.total,
    }));
  return {
    country,
    generatedAt: `${latest.date}T00:00:00.000Z`,
    total: latest.total,
    ai: latest.ai,
    share: latest.share,
    categories,
  };
}

async function buildLiveOverview(country) {
  // Keep serving the previous results while the refresh runs (stale-while-revalidate).
  const prev = overviewJobs.get(country)?.data ?? null;
  const job = { status: 'loading', done: 0, total: 1, data: prev, error: null };
  overviewJobs.set(country, job);
  try {
    if (!job.data) {
      job.data = await overviewFromStore(country).catch((err) => {
        console.warn(`overview(${country}): no stored snapshot to fall back on:`, err.message);
        return null;
      });
    }
    const cats = await client.categories(country);
    if (job.data) {
      // Fix up labels guessed from tags in the stored-snapshot fallback.
      const labels = new Map(cats.map((c) => [c.tag, c.label]));
      job.data = { ...job.data, categories: job.data.categories.map((c) => ({ ...c, label: labels.get(c.tag) || c.label })) };
    }
    job.total = cats.length * 2 + 2;
    const tick = () => { job.done += 1; };

    const total = await client.count(country); tick();
    const ai = await client.count(country, { what: AI_QUERY }); tick();
    const categories = [];
    for (const c of cats) {
      const t = await client.count(country, { category: c.tag }); tick();
      const a = await client.count(country, { category: c.tag, what: AI_QUERY }); tick();
      if (t > 0) categories.push({ tag: c.tag, label: c.label, total: t, ai: a, share: a / t });
    }
    job.data = {
      country,
      generatedAt: new Date().toISOString(),
      total,
      ai,
      share: total ? ai / total : 0,
      categories,
    };
    job.status = 'ready';
    await appendSnapshot(country, job.data);
  } catch (err) {
    // With earlier data to show, keep serving it and let the hourly collector retry.
    job.status = job.data ? 'ready' : 'error';
    job.error = err.message;
    console.error(`overview(${country}) failed:`, err.message);
  }
}

function getCountry(url) {
  const c = (url.searchParams.get('country') || 'gb').toLowerCase();
  return VALID_COUNTRIES.has(c) ? c : 'gb';
}

async function handleApi(url) {
  const country = getCountry(url);

  switch (url.pathname) {
    case '/api/meta':
      return {
        demo: !LIVE,
        aiQuery: AI_QUERY,
        countries: demo.COUNTRIES,
      };

    case '/api/overview': {
      if (!LIVE) return { status: 'ready', demo: true, data: demo.demoOverview(country) };
      let job = overviewJobs.get(country);
      if (!job || job.status === 'error') {
        buildLiveOverview(country);
        job = overviewJobs.get(country);
      }
      return { status: job.status, done: job.done, total: job.total, data: job.data, error: job.error };
    }

    case '/api/snapshots':
      if (!LIVE) return { demo: true, snapshots: demo.demoSnapshots(country) };
      return { snapshots: await store.list(country) };

    case '/api/health':
      return { ok: true, live: LIVE, store: store.kind };

    case '/api/history': {
      const category = url.searchParams.get('category') || 'it-jobs';
      if (!LIVE) return { demo: true, months: demo.demoSalaryHistory(country, category) };
      return { months: await client.salaryHistory(country, category) };
    }

    case '/api/top_companies': {
      const category = url.searchParams.get('category') || undefined;
      if (!LIVE) return { demo: true, companies: demo.demoTopCompanies(country, category) };
      return { companies: await client.topCompanies(country, { what: AI_QUERY, category }) };
    }

    default:
      return null;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const body = await handleApi(url);
      if (body === null) {
        res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      }
      return;
    }
    serveStatic(res, url.pathname);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Job trends dashboard: http://localhost:${PORT}`);
  console.log(`Snapshot store: ${store.kind}`);
  console.log(LIVE
    ? `Live mode — AI query: "${AI_QUERY}". First overview per country takes a few minutes (rate-limited).`
    : 'Demo mode — set ADZUNA_APP_ID and ADZUNA_APP_KEY in .env for live data.');
});

// Daily snapshot collector: in live mode, make sure each tracked country gets
// one snapshot per day (buildLiveOverview appends it on completion). Checked
// hourly so a restart or a failed run just retries later in the day.
const SNAPSHOT_COUNTRIES = (process.env.SNAPSHOT_COUNTRIES || 'gb')
  .split(',').map((c) => c.trim().toLowerCase()).filter((c) => VALID_COUNTRIES.has(c));

async function collectDailySnapshots() {
  const today = new Date().toISOString().slice(0, 10);
  for (const country of SNAPSHOT_COUNTRIES) {
    try {
      const job = overviewJobs.get(country);
      if (job && job.status === 'loading') continue;
      const snapshots = await store.list(country);
      if (snapshots.some((s) => s.date === today)) continue;
      console.log(`collecting daily snapshot for ${country}…`);
      await buildLiveOverview(country);
    } catch (err) {
      console.error(`snapshot collection failed for ${country}:`, err.message);
    }
  }
}

if (LIVE) {
  collectDailySnapshots();
  setInterval(collectDailySnapshots, 60 * 60 * 1000);
}
