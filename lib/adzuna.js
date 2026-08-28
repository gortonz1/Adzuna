// Thin Adzuna API client with request throttling and a disk cache.
// The free tier is rate-limited (roughly 25 requests/min, 250/day), so every
// response is cached for CACHE_TTL_MS and live requests are spaced out.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = 'https://api.adzuna.com/v1/api';
const MIN_INTERVAL_MS = 2600; // keep safely under 25 requests/min
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class AdzunaClient {
  constructor({ appId, appKey, dataDir }) {
    this.appId = appId;
    this.appKey = appKey;
    this.cacheFile = path.join(dataDir, 'cache.json');
    this.cache = this.#loadCache(dataDir);
    this.queue = Promise.resolve();
    this.lastRequestAt = 0;
  }

  #loadCache(dataDir) {
    try {
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
      return JSON.parse(readFileSync(this.cacheFile, 'utf8'));
    } catch {
      return {};
    }
  }

  #saveCache() {
    try {
      writeFileSync(this.cacheFile, JSON.stringify(this.cache));
    } catch (err) {
      console.warn('cache write failed:', err.message);
    }
  }

  async #get(pathname, params = {}) {
    const url = new URL(`${BASE_URL}${pathname}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const cacheKey = url.toString();
    const hit = this.cache[cacheKey];
    if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.body;

    url.searchParams.set('app_id', this.appId);
    url.searchParams.set('app_key', this.appKey);

    // Serialize live requests and enforce the minimum spacing between them.
    this.queue = this.queue.then(async () => {
      const wait = this.lastRequestAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Adzuna ${res.status} for ${pathname}: ${text.slice(0, 200)}`);
      }
      return res.json();
    });
    const body = await this.queue;
    this.cache[cacheKey] = { t: Date.now(), body };
    this.#saveCache();
    return body;
  }

  async categories(country) {
    const body = await this.#get(`/jobs/${country}/categories`);
    return (body.results || [])
      .map((c) => ({ tag: c.tag, label: c.label }))
      .filter((c) => c.tag !== 'unknown');
  }

  // Total number of live ads matching the filters. We only need the count,
  // so ask for a single result per page.
  async count(country, { what, category } = {}) {
    const body = await this.#get(`/jobs/${country}/search/1`, {
      results_per_page: 1,
      what,
      category,
    });
    return body.count ?? 0;
  }

  // Average advertised salary by month for a category. Returns [{month, salary}].
  async salaryHistory(country, category, months = 12) {
    const body = await this.#get(`/jobs/${country}/history`, { category, months });
    return Object.entries(body.month || {})
      .map(([month, salary]) => ({ month, salary }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  // Employers advertising the most ads for a query. Returns [{name, count, avgSalary}].
  async topCompanies(country, { what, category } = {}) {
    const body = await this.#get(`/jobs/${country}/top_companies`, { what, category });
    return (body.leaderboard || []).map((c) => ({
      name: c.canonical_name || c.display_name || 'Unknown',
      count: c.count ?? 0,
      avgSalary: c.average_salary ?? null,
    }));
  }
}
