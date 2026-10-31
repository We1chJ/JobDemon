// Everything JobDemon keeps, in chrome.storage.local on this computer: your Setup, files, keys and history.
import { EMPTY_PROFILE, hash, type BankEntry, type Profile } from './profile.js';

export interface Settings {
  typesafeKey: string;
  openaiKey: string;
  openaiModel: string;
  /** Tests only: answer with the offline stand-in instead of calling Jev / OpenAI. */
  fake?: boolean;
}
export const DEFAULT_SETTINGS: Settings = { typesafeKey: '', openaiKey: '', openaiModel: 'gpt-4.1' };

export type FileKey = 'resume' | 'transcript';
export interface StoredFile { name: string; type: string; size: number; data: string } // data: base64

/** What a fill did for you, counted for the Time saved card. */
export type Action = 'typed' | 'picked' | 'ticked' | 'uploaded' | 'pages' | 'written' | 'letters';
export type HistoryStatus = 'in_progress' | 'filled' | 'needs_you' | 'applied' | 'removed';
export interface HistoryItem {
  key: string; // normalized URL
  url: string;
  company: string;
  role: string;
  portal: string;
  status: HistoryStatus;
  needs: string[];
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  letter?: string; // the cover letter written for it
  actions?: Partial<Record<Action, number>>; // none on applications from before these were counted
}

/** Everything except your API keys, as one file: moves your data between computers (and from the old app). */
export interface Backup {
  jobdemon: 1;
  profile: Profile;
  bank: BankEntry[];
  history: Record<string, HistoryItem>;
  files: Partial<Record<FileKey, StoredFile>>;
}

const area = () => chrome.storage.local;
async function get<T>(key: string, fallback: T): Promise<T> {
  const r = await area().get(key);
  return (r[key] as T | undefined) ?? fallback;
}
const set = (key: string, value: unknown) => area().set({ [key]: value });

export const store = {
  profile: () => get<Profile>('profile', EMPTY_PROFILE),
  setProfile: (p: Profile) => set('profile', p),
  bank: () => get<BankEntry[]>('bank', []),
  setBank: (b: BankEntry[]) => set('bank', b),
  settings: async () => ({ ...DEFAULT_SETTINGS, ...(await get<Partial<Settings>>('settings', {})) }),
  setSettings: async (s: Partial<Settings>) => set('settings', { ...(await store.settings()), ...s }),
  file: (k: FileKey) => get<StoredFile | null>(`file:${k}`, null),
  setFile: (k: FileKey, f: StoredFile | null) => (f ? set(`file:${k}`, f) : area().remove(`file:${k}`)),
  /** Your switch on the bar: click Submit when a form is complete. Off unless you turn it on. */
  autoSubmit: () => get<boolean>('autoSubmit', false),
  setAutoSubmit: (on: boolean) => set('autoSubmit', on),
  history: () => get<Record<string, HistoryItem>>('history', {}),
  setHistory: (h: Record<string, HistoryItem>) => set('history', h),
  /** Written answers already generated for a job, so a re-fill reuses them instead of writing again. */
  cached: async (key: string) => (await get<Record<string, string>>('written', {}))[key],
  cache: async (key: string, text: string) => set('written', { ...(await get<Record<string, string>>('written', {})), [key]: text }),
};

export async function exportBackup(): Promise<Backup> {
  const [profile, bank, history, resume, transcript] = await Promise.all([store.profile(), store.bank(), store.history(), store.file('resume'), store.file('transcript')]);
  return { jobdemon: 1, profile, bank, history, files: { ...(resume ? { resume } : {}), ...(transcript ? { transcript } : {}) } };
}
/** Replace your Setup, files and history with a backup's. API keys are kept. */
export async function importBackup(b: Backup) {
  if (b?.jobdemon !== 1 || !b.profile?.fields) throw new Error("that file isn't a JobDemon backup");
  await store.setProfile(b.profile);
  await store.setBank(b.bank ?? []);
  await store.setHistory({ ...(await store.history()), ...(b.history ?? {}) });
  for (const k of ['resume', 'transcript'] as const) if (b.files?.[k]) await store.setFile(k, b.files[k]!);
}

/** A fingerprint of everything that shapes answers: written answers are cached per version. */
export async function profileVersion() {
  return hash(JSON.stringify([await store.profile(), await store.bank()]));
}

/** The same job opened twice (tracking parameters, fragments) counts as one. */
export function jobKey(url: string) {
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|gh_src|source|ref|_gl|lever-|trk|fbclid|gclid)/i.test(p)) u.searchParams.delete(p);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch { return url; }
}

export async function updateHistory(url: string, patch: Partial<HistoryItem>) {
  const h = await store.history();
  const key = jobKey(url);
  const now = new Date().toISOString();
  const prev = h[key];
  const base: HistoryItem = prev ?? { key, url, company: '', role: '', portal: '', status: 'in_progress', needs: [], createdAt: now, updatedAt: now };
  h[key] = { ...base, ...patch, key, updatedAt: now, ...(patch.status === 'applied' && prev?.status !== 'applied' ? { submittedAt: now } : {}) };
  await store.setHistory(h);
  return h[key];
}

export const toBase64 = (buf: ArrayBuffer) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
export const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
