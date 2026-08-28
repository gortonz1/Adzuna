// Snapshot storage. When SUPABASE_URL / SUPABASE_ANON_KEY / SNAPSHOT_SECRET are
// set, snapshots live in a Supabase Postgres table (durable across deploys);
// otherwise they fall back to a local JSON file per country.
//
// Writes go through the `record_adzuna_snapshot` RPC, a security-definer
// function that validates SNAPSHOT_SECRET server-side — the anon key alone
// cannot insert rows. Reads are plain selects (the table is public-read).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

export class SupabaseStore {
  constructor({ url, anonKey, secret }) {
    this.url = url.replace(/\/$/, '');
    this.anonKey = anonKey;
    this.secret = secret;
    this.kind = 'supabase';
  }

  async #rest(pathname, options = {}) {
    const res = await fetch(`${this.url}${pathname}`, {
      ...options,
      headers: {
        apikey: this.anonKey,
        authorization: `Bearer ${this.anonKey}`,
        'content-type': 'application/json',
        ...options.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async list(country) {
    const rows = await this.#rest(
      `/rest/v1/adzuna_snapshots?country=eq.${encodeURIComponent(country)}` +
      '&select=snapshot_date,total,ai,share,categories&order=snapshot_date.asc',
    );
    return rows.map((r) => ({
      date: r.snapshot_date,
      total: r.total,
      ai: r.ai,
      share: r.share,
      categories: r.categories,
    }));
  }

  async append(country, snap) {
    await this.#rest('/rest/v1/rpc/record_adzuna_snapshot', {
      method: 'POST',
      body: JSON.stringify({
        p_secret: this.secret,
        p_country: country,
        p_date: snap.date,
        p_total: snap.total,
        p_ai: snap.ai,
        p_share: snap.share,
        p_categories: snap.categories ?? null,
      }),
    });
  }
}

export class FileStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.kind = 'file';
  }

  #file(country) {
    return path.join(this.dataDir, `snapshots-${country}.json`);
  }

  async list(country) {
    try {
      return JSON.parse(readFileSync(this.#file(country), 'utf8'));
    } catch {
      return [];
    }
  }

  async append(country, snap) {
    const snapshots = await this.list(country);
    const existing = snapshots.findIndex((s) => s.date === snap.date);
    if (existing >= 0) snapshots[existing] = snap;
    else snapshots.push(snap);
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
    writeFileSync(this.#file(country), JSON.stringify(snapshots, null, 2));
  }
}

export function createStore({ dataDir }) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SNAPSHOT_SECRET } = process.env;
  if (SUPABASE_URL && SUPABASE_ANON_KEY && SNAPSHOT_SECRET) {
    return new SupabaseStore({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, secret: SNAPSHOT_SECRET });
  }
  return new FileStore(dataDir);
}
