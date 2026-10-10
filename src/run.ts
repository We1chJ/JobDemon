// npm run apply [-- urls.txt|urls.csv ...] [--watch]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { eq, inArray } from 'drizzle-orm';
import { config } from './config.js';
import { db, schema } from './db/index.js';
import { enqueueFile } from './intake.js';
import { loadProfile } from './profile.js';
import { makeDecider } from './decider/index.js';
import { makeWriter } from './writer/index.js';
import { runApplication } from './agent/loop.js';

export async function processQueue() {
  loadProfile(); // fail fast if the profile hasn't been imported
  // in_progress = crashed mid-run; it resumes (and the submit guard prevents double-submits).
  const apps = db.select().from(schema.application)
    .where(inArray(schema.application.status, ['queued', 'in_progress'])).all();
  if (!apps.length) return 0;

  const browser = await chromium.launch({ headless: config.headless });
  const decider = makeDecider();
  const writer = makeWriter();
  const queue = [...apps];
  const worker = async () => {
    for (let app = queue.shift(); app; app = queue.shift()) {
      console.log(`→ #${app.id} ${app.url}${config.live || app.live ? ' [LIVE]' : ' [dry-run]'}`);
      await runApplication(browser, app, decider, writer);
      const done = db.select().from(schema.application).where(eq(schema.application.id, app.id)).get()!;
      console.log(`  #${app.id} ${done.status}${done.reason ? `: ${done.reason}` : ''}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, config.concurrency) }, worker));
  await browser.close();
  return apps.length;
}

async function main() {
  const args = process.argv.slice(2);
  for (const f of args.filter((a) => !a.startsWith('--'))) {
    const r = enqueueFile(f);
    console.log(`Queued ${r.added} new URL(s) from ${f} (${r.skipped} already known)`);
  }
  console.log(config.live ? 'LIVE mode: applications WILL be submitted.' : 'Dry-run mode: forms are filled but not submitted. Approve in the review UI.');
  if (args.includes('--watch')) {
    console.log('Watching for new URLs (add them in the review UI). Ctrl+C to stop.');
    for (;;) { await processQueue(); await new Promise((r) => setTimeout(r, 10000)); }
  }
  const n = await processQueue();
  if (!n) console.log('Nothing queued.');
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((e) => { console.error(e.message); process.exit(1); });
