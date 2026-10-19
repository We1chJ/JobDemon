// App settings changed from the control panel, kept in data/settings.json.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export interface Settings { concurrency: number }

const file = () => path.join(config.dataDir, 'settings.json');
export const MAX_CONCURRENCY = 5;

export function loadSettings(): Settings {
  let saved: Partial<Settings> = {};
  try { saved = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { /* none saved yet */ }
  const n = Number(saved.concurrency ?? config.concurrency);
  return { concurrency: Math.min(MAX_CONCURRENCY, Math.max(1, Number.isFinite(n) ? Math.round(n) : 1)) };
}

export function saveSettings(s: Partial<Settings>) {
  fs.writeFileSync(file(), JSON.stringify({ ...loadSettings(), ...s }, null, 2) + '\n');
}
