import fs from 'node:fs';
import { db, schema, now } from './db/index.js';

/** Strip tracking params and fragments so the same posting isn't queued twice. */
export function normalizeUrl(raw: string) {
  const u = new URL(raw.trim());
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|gh_src|ref$|source$)/i.test(k)) u.searchParams.delete(k);
  return u.toString();
}

/** Accepts URLs one per line, or a CSV whose cells contain URLs. */
export function parseUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s,"'<>]+/g) ?? [];
  const out = new Set<string>();
  for (const f of found) { try { out.add(normalizeUrl(f)); } catch { /* skip junk */ } }
  return [...out];
}

export function enqueue(urls: string[]) {
  let added = 0;
  for (const url of urls) {
    const r = db.insert(schema.application).values({ url, createdAt: now(), updatedAt: now() }).onConflictDoNothing().run();
    added += r.changes;
  }
  return { added, skipped: urls.length - added };
}

export function enqueueFile(file: string) {
  return enqueue(parseUrls(fs.readFileSync(file, 'utf8')));
}
