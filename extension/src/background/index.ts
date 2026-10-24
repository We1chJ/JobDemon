// The background worker: the only part that calls the AI. Pages and frames send it questions; it answers each
// with your whole Setup as context. It also keeps "Continue" going across page loads and your history.
import { answerQuestion } from '../shared/answer.js';
import { buildContext } from '../shared/context.js';
import type { FillReport, Reply, Run, ToBackground, ToFrame } from '../shared/msg.js';
import { textToPdf } from '../shared/pdf.js';
import { profileVersion, store, toBase64, updateHistory } from '../shared/store.js';
import type { Context, JobCtx } from '../shared/types.js';
import { coverLetter, makeBrain } from './ai.js';

interface TabJob { job: JobCtx; portal?: string }
const session = chrome.storage.session;
const tabJob = async (tab: chrome.tabs.Tab): Promise<TabJob> =>
  ((await session.get(`job:${tab.id}`))[`job:${tab.id}`] as TabJob | undefined) ?? { job: { url: tab.url ?? '', company: '', role: '', jd: '' } };

async function context(tab: chrome.tabs.Tab): Promise<Context> {
  const [{ job, portal }, profile, bank, version, resume, transcript] = await Promise.all([tabJob(tab), store.profile(), store.bank(), profileVersion(), store.file('resume'), store.file('transcript')]);
  return buildContext(profile, version, bank, job, { resume: !!resume, transcript: !!transcript }, portal);
}

async function letterFor(tab: chrome.tabs.Tab) {
  const ctx = await context(tab);
  const text = await coverLetter(await store.settings(), ctx.job, ctx.profile, ctx.profileVersion);
  await updateHistory(ctx.job.url, { letter: text });
  return { text, job: ctx.job };
}

// ── The debug report ────────────────────────────────────────────────────────
const MAX_LOG = 400;
const chains = new Map<number, Promise<unknown>>();
/** Add to a tab's log, one write at a time (frames log at the same moment). */
function appendLog(tabId: number, e: Record<string, unknown>) {
  const next = (chains.get(tabId) ?? Promise.resolve()).then(async () => {
    const k = `log:${tabId}`;
    const list = ((await session.get(k))[k] as Record<string, unknown>[] | undefined) ?? [];
    list.push(e);
    await session.set({ [k]: list.slice(-MAX_LOG) });
  }).catch(() => {});
  chains.set(tabId, next);
  return next;
}

/** The tab's log as text to paste to Claude, with your personal details taken out. */
async function report(tab: chrome.tabs.Tab) {
  await chains.get(tab.id!);
  const [entries, { job, portal }, profile, settings] = await Promise.all([
    session.get(`log:${tab.id}`).then((r) => (r[`log:${tab.id}`] as Record<string, unknown>[] | undefined) ?? []), tabJob(tab), store.profile(), store.settings(),
  ]);
  let text = JSON.stringify({
    jobdemon: chrome.runtime.getManifest().version, made: new Date().toISOString(), page: (tab.url ?? '').split(/[?#]/)[0],
    job: { company: job.company, role: job.role, portal }, ai: settings.fake ? 'offline test brain' : `Jev + ${settings.openaiModel}`,
    entries: entries.map((e) => ({ at: e.at, where: e.where, type: e.type, ...e })), // storage sorts keys: put these first again
  }, null, 1);
  // Your details as typed in Setup, then anything shaped like an email address or a phone number.
  const mine = Object.entries(profile.fields)
    .filter(([k, v]) => v && v.length >= 3 && /name|email|phone|address|street|zip|postal|city|linkedin|github|website|birth/i.test(k))
    .sort((a, b) => b[1].length - a[1].length);
  for (const [k, v] of mine) text = text.split(v).join(`[${k}]`);
  return text.replace(/[^\s"@]+@[^\s"@]+\.[a-z]{2,}/gi, '[email]').replace(/(?<![\d-])\+?(?:\d[\s().-]*){10,15}(?![\d-])/g, '[number]');
}

/** Ask every frame inside the tab (not the page itself) to do something, one after another. */
async function frames(tabId: number, m: ToFrame): Promise<FillReport> {
  const all = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
  const out: FillReport = { fields: 0, filled: 0, needs: [] };
  for (const f of all.filter((x) => x.frameId !== 0 && /^https?:/.test(x.url))) {
    const r = (await chrome.tabs.sendMessage(tabId, m, { frameId: f.frameId }).catch(() => null)) as Reply<FillReport | null> | null;
    if (r?.ok && r.v) { out.fields += r.v.fields; out.filled += r.v.filled; out.needs.push(...r.v.needs); }
  }
  return out;
}

async function handle(m: ToBackground, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const tab = sender.tab;
  if (m.t === 'open') return chrome.tabs.create({ url: chrome.runtime.getURL(`pages/${m.page}.html`) });
  if (!tab?.id) throw new Error('not from a tab');
  const id = tab.id;
  switch (m.t) {
    case 'job': {
      // The first page of an application has the job description; later pages keep it unless the site changes.
      // Another job in the same tab replaces it; a later step of the same application (little text, same site) doesn't.
      const got = await session.get([`job:${id}`, `run:${id}`]);
      const had = got[`job:${id}`] as TabJob | undefined, running = !!(got[`run:${id}`] as Run | undefined)?.active;
      const host = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };
      const laterStep = had && host(had.job.url) === host(m.job.url) && m.job.jd.length < 1000;
      if (!had || (!running && !laterStep && had.job.url !== m.job.url)) {
        await session.set({ [`job:${id}`]: { job: m.job, portal: m.portal } });
        if (had) await session.remove(`log:${id}`); // a different job: its own log
      }
      return null;
    }
    case 'answer': {
      const ctx = await context(tab);
      const brain = makeBrain(await store.settings());
      if (m.q.attach) {
        const a = await answerQuestion({ ...m.q, candidates: ctx.files.map((f) => f.label) }, ctx, brain);
        return a.kind === 'pick' ? { ...a, slot: ctx.files[a.indexes[0]].key } : a;
      }
      const a = await answerQuestion(m.q, ctx, brain);
      if (a.kind === 'text' && a.because === 'cover letter') await updateHistory(ctx.job.url, { letter: a.value });
      return a;
    }
    case 'file': {
      if (m.key === 'cover_letter') {
        const { text, job } = await letterFor(tab);
        const company = job.company.replace(/[^\w .&-]+/g, '').trim();
        return { name: `Cover Letter${company ? ` - ${company}` : ''}.pdf`, type: 'application/pdf', data: toBase64(textToPdf(text).buffer as ArrayBuffer) };
      }
      const f = await store.file(m.key);
      return f && { name: f.name, type: f.type, data: f.data };
    }
    case 'letter': return (await letterFor(tab)).text;
    case 'history': {
      const { job, portal } = await tabJob(tab);
      return updateHistory(job.url, { company: job.company, role: job.role, portal: portal ?? '', ...m.patch });
    }
    case 'run:get': return ((await session.get(`run:${id}`))[`run:${id}`] as Run | undefined) ?? null;
    case 'run:set': return m.run ? session.set({ [`run:${id}`]: m.run }) : session.remove(`run:${id}`);
    case 'frames': return frames(id, m.op === 'fill' ? { t: 'fill', retry: m.retry } : { t: m.op });
    case 'log': return appendLog(id, m.e);
    case 'report': return report(tab);
    case 'submit:pending': {
      // Only on pages JobDemon knows as a job application (it showed its bar there).
      if (!(await session.get(`job:${id}`))[`job:${id}`]) return false;
      await session.set({ [`submit:${id}`]: { at: Date.now(), url: sender.url ?? tab.url ?? '' } });
      return true;
    }
    case 'submit:get': {
      const p = (await session.get(`submit:${id}`))[`submit:${id}`] as { at: number; url: string } | undefined;
      return p && Date.now() - p.at < 120000 ? p : null;
    }
    case 'submit:done': {
      if (!(await session.get(`submit:${id}`))[`submit:${id}`]) return null;
      await session.remove(`submit:${id}`);
      if (!m.ok) return null;
      const { job, portal } = await tabJob(tab);
      await updateHistory(job.url, { company: job.company, role: job.role, portal: portal ?? '', status: 'applied', needs: [] });
      await session.remove(`run:${id}`);
      await chrome.tabs.sendMessage(id, { t: 'applied' } satisfies ToFrame, { frameId: 0 }).catch(() => {});
      return null;
    }
  }
}

chrome.runtime.onMessage.addListener((m: ToBackground, sender, reply: (r: Reply<unknown>) => void) => {
  handle(m, sender).then((v) => reply({ ok: true, v: v ?? null }), (e: Error) => reply({ ok: false, error: e.message.split('\n')[0] }));
  return true;
});

// The toolbar icon shows the widget on any page.
chrome.action.onClicked.addListener((tab) => { if (tab.id) void chrome.tabs.sendMessage(tab.id, { t: 'show' } satisfies ToFrame, { frameId: 0 }).catch(() => {}); });
// An Apply link that opens the application in a new tab: "Continue" carries on there.
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.id || !tab.openerTabId) return;
  const from = tab.openerTabId;
  const got = await session.get([`run:${from}`, `job:${from}`]);
  const run = got[`run:${from}`] as Run | undefined;
  if (!run?.active || Date.now() - run.lastClickAt > 5000) return;
  await session.set({ [`run:${tab.id}`]: { ...run, lastClickAt: Date.now() }, ...(got[`job:${from}`] ? { [`job:${tab.id}`]: got[`job:${from}`] } : {}) });
  await session.remove(`run:${from}`);
});
chrome.tabs.onRemoved.addListener((id) => void session.remove([`job:${id}`, `run:${id}`, `submit:${id}`, `log:${id}`]));
chrome.runtime.onInstalled.addListener((d) => { if (d.reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL('pages/setup.html') }); });
