// Messages between the pages, the content scripts and the background worker. Every reply is {ok, v} or {ok:false, error}.
import type { HistoryItem } from './store.js';
import type { Answer, JobCtx, Question } from './types.js';

/** What a frame did when asked to fill its page. */
export interface FillReport { fields: number; filled: number; needs: string[] }
/** "Continue" in progress for a tab: kept by the background so it survives the page loading something new. */
export interface Run { active: boolean; waiting?: string; filledAny: boolean; tries: Record<string, number>; started: string[]; lastClickAt: number }

export type ToBackground =
  | { t: 'job'; job: JobCtx; portal?: string }
  | { t: 'answer'; q: Question }
  | { t: 'file'; key: 'resume' | 'transcript' | 'cover_letter' }
  | { t: 'letter' }
  | { t: 'history'; patch: Partial<HistoryItem> }
  | { t: 'run:get' }
  | { t: 'run:set'; run: Run | null }
  | { t: 'frames'; op: 'fill' | 'hover' | 'stop'; retry?: boolean }
  | { t: 'log'; e: Record<string, unknown> }
  | { t: 'report' }
  | { t: 'submit:pending' }
  | { t: 'submit:get' }
  | { t: 'submit:done'; ok: boolean }
  | { t: 'open'; page: 'setup' | 'dashboard' | 'letter' };

export type ToFrame = { t: 'fill'; retry?: boolean } | { t: 'hover' } | { t: 'show' } | { t: 'applied' } | { t: 'stop' };

export type Reply<T> = { ok: true; v: T } | { ok: false; error: string };
export type AnswerReply = Answer;
export interface FileReply { name: string; type: string; data: string } // data: base64

export async function ask<T>(m: ToBackground): Promise<T> {
  const r = (await chrome.runtime.sendMessage(m)) as Reply<T> | undefined;
  if (!r) throw new Error('JobDemon is not responding (reload the page)');
  if (!r.ok) throw new Error(r.error);
  return r.v;
}
