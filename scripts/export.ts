// Moves your data from the old JobDemon app (data/) into one backup file the extension imports
// (Setup → Backup → Import backup). API keys are never included: add them in Setup.
// Run: npm run export   → data/jobdemon-backup.json
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { portalName } from '../extension/src/shared/portal.js';
import type { Backup, HistoryItem, HistoryStatus, StoredFile } from '../extension/src/shared/store.js';

const data = path.resolve(process.env.DATA_DIR ?? 'data');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(data, f), 'utf8'));
const file = (f: string, name: string): StoredFile | undefined => {
  const p = path.join(data, f);
  if (!fs.existsSync(p)) return undefined;
  const buf = fs.readFileSync(p);
  return { name, type: 'application/pdf', size: buf.length, data: buf.toString('base64') };
};
// The same job twice counts once (same rule as the extension).
const jobKey = (url: string) => {
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|gh_src|source|ref|_gl|lever-|trk)/i.test(p)) u.searchParams.delete(p);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch { return url; }
};
// The old statuses; the queue is gone, so queued jobs come over as started.
const STATUS: Record<string, HistoryStatus> = { applied: 'applied', ready_to_submit: 'filled', human_review: 'needs_you', waiting_for_you: 'needs_you', in_progress: 'in_progress', queued: 'in_progress', duplicate: 'removed' };

const db = new Database(path.join(data, 'jobdemon.sqlite'), { readonly: true });
const rows = db.prepare('select * from application').all() as { id: number; url: string; company: string | null; role: string | null; status: string; reason: string | null; created_at: string; updated_at: string }[];
const history: Record<string, HistoryItem> = {};
for (const a of rows) {
  const key = jobKey(a.url);
  const letter = path.join(data, 'letters', `${a.id}-cover-letter.txt`);
  let host = '';
  try { host = new URL(a.url).hostname; } catch {}
  history[key] = {
    key, url: a.url, company: a.company ?? '', role: a.role ?? '', portal: portalName(host), status: STATUS[a.status] ?? 'in_progress',
    needs: a.status === 'human_review' ? (a.reason?.match(/"[^"]+"/g) ?? []).map((s) => s.slice(1, -1)) : [],
    createdAt: a.created_at, updatedAt: a.updated_at, ...(a.status === 'applied' ? { submittedAt: a.updated_at } : {}),
    ...(fs.existsSync(letter) ? { letter: fs.readFileSync(letter, 'utf8') } : {}),
  };
}

const resume = file(process.env.RESUME_FILE ?? 'resume.pdf', 'resume.pdf'), transcript = file('transcript.pdf', 'transcript.pdf');
const backup: Backup = {
  jobdemon: 1, profile: read('profile.json'), bank: read('answer_bank.json'), history,
  files: { ...(resume ? { resume } : {}), ...(transcript ? { transcript } : {}) },
};
const out = path.join(data, 'jobdemon-backup.json');
fs.writeFileSync(out, JSON.stringify(backup));
const n = (s: HistoryStatus) => Object.values(history).filter((h) => h.status === s).length;
console.log(`Wrote ${path.relative(process.cwd(), out)}: your profile, ${backup.bank.length} screening answers, ${rows.length} applications (${n('applied')} applied), ${Object.keys(backup.files).join(' + ') || 'no files'}.`);
console.log('In Chrome: JobDemon → Setup → 8. Backup → Import backup, choose that file, then add your API keys in 1. AI keys.');
