// Builds the extension into extension/dist (load that folder in chrome://extensions → Load unpacked).
// node extension/build.mjs [--watch]
import { build, context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const here = import.meta.dirname, out = path.join(here, 'dist');
const shared = { bundle: true, target: 'chrome120', loader: { '.svg': 'text' }, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning', minify: !process.argv.includes('--dev') };
const jobs = [
  { entryPoints: { background: path.join(here, 'src/background/index.ts') }, format: 'esm' },
  { entryPoints: { content: path.join(here, 'src/content/index.ts') }, format: 'iife' },
  { entryPoints: Object.fromEntries(['setup', 'dashboard', 'letter'].map((p) => [`pages/${p}`, path.join(here, `src/pages/${p}.${p === 'dashboard' ? 'tsx' : 'ts'}`)])), format: 'iife' },
].map((j) => ({ ...shared, ...j, outdir: out }));

fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
fs.cpSync(path.join(here, 'static'), out, { recursive: true });

// Toolbar and store icons, drawn from assets/logo.svg.
const icons = path.join(out, 'icons');
if (!fs.existsSync(path.join(icons, '128.png'))) {
  const svg = fs.readFileSync(path.join(here, '..', 'assets', 'logo.svg'), 'utf8');
  fs.writeFileSync(path.join(icons, 'logo.svg'), svg);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const n of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: n, height: n });
    await page.setContent(`<html><body style="margin:0;display:grid;place-items:center;width:${n}px;height:${n}px;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `height="${n}" width="${Math.round((n * 104) / 120)}"`)}</body></html>`);
    await page.screenshot({ path: path.join(icons, `${n}.png`), omitBackground: true });
  }
  await browser.close();
}

if (process.argv.includes('--watch')) {
  for (const j of jobs) await (await context(j)).watch();
  console.log('Watching extension/src…');
} else {
  await Promise.all(jobs.map((j) => build(j)));
  console.log(`Built ${path.relative(process.cwd(), out)}`);
}
