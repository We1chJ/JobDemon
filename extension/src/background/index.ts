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
      const had = (await session.get(`job:${id}`))[`job:${id}`] as TabJob | undefined;
      const host = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };
      if (!had || (host(had.job.url) !== host(m.job.url) && m.job.jd.length > 200)) await session.set({ [`job:${id}`]: { job: m.job, portal: m.portal } });
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
    case 'frames': return frames(id, m.op === 'fill' ? { t: 'fill', retry: m.retry } : { t: 'hover' });
    case 'close': return setTimeout(() => void chrome.tabs.remove(id), 200);
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
chrome.tabs.onRemoved.addListener((id) => void session.remove([`job:${id}`, `run:${id}`]));
chrome.runtime.onInstalled.addListener((d) => { if (d.reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL('pages/setup.html') }); });
