// npm run apply [-- urls.txt|urls.csv ...] [--watch]
// Fills applications and leaves them open in the browser. It never submits.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { eq, inArray } from 'drizzle-orm';
import { config } from './config.js';
import { db, schema } from './db/index.js';
import { enqueueFile } from './intake.js';
import { loadProfile } from './profile.js';
import { makeDecider } from './decider/index.js';
import { makeWriter } from './writer/index.js';
import { runApplication } from './portals/index.js';
import { closeBrowser, openFormCount, waitForBrowserClose } from './agent/browser.js';

/** Run queued applications: all of them, or only the ones whose ids are given. */
export async function processQueue(onlyIds?: number[]) {
  loadProfile(); // fail fast if the profile hasn't been imported
  // in_progress = interrupted mid-run; it is simply filled again.
  const apps = db.select().from(schema.application)
    .where(inArray(schema.application.status, ['queued', 'in_progress'])).all()
    .filter((a) => !onlyIds || onlyIds.includes(a.id));
  if (!apps.length) return 0;

  const decider = makeDecider();
  const writer = makeWriter();
  const queue = [...apps];
  const worker = async () => {
    for (let app = queue.shift(); app; app = queue.shift()) {
      console.log(`→ #${app.id} ${app.url}`);
      await runApplication(app, decider, writer);
      const done = db.select().from(schema.application).where(eq(schema.application.id, app.id)).get()!;
      console.log(`  #${app.id} ${done.status}${done.reason ? `: ${done.reason}` : ''}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, config.concurrency) }, worker));
  return apps.length;
}

async function main() {
  const args = process.argv.slice(2);
  for (const f of args.filter((a) => !a.startsWith('--'))) {
    const r = enqueueFile(f);
    console.log(`Queued ${r.added} new URL(s) from ${f} (${r.skipped} already known)`);
  }
  console.log('Fill-only: forms are filled and left open for you. The bot never submits.');
  if (args.includes('--watch')) {
    console.log('Watching for new URLs (add them in the control panel). Ctrl+C to stop.');
    for (;;) { await processQueue(); await new Promise((r) => setTimeout(r, 10000)); }
  }
  const n = await processQueue();
  if (!n) console.log('Nothing queued.');
  if (openFormCount() && !config.headless) {
    console.log(`\n${openFormCount()} filled form(s) are open in the browser window. Review and submit them yourself, then close the browser to exit.`);
    await waitForBrowserClose();
  }
  await closeBrowser();
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((e) => { console.error(e.message); process.exit(1); });
