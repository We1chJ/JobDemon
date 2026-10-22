// Plain-text documents to PDF, using the browser engine the bot already has (no extra dependencies).
import { chromium } from 'playwright';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function textToPdf(text: string): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;font:11.5pt/1.5 Georgia,"Times New Roman",serif;color:#111}
      pre{margin:0;white-space:pre-wrap;font:inherit}
    </style></head><body><pre>${escape(text)}</pre></body></html>`);
    return await page.pdf({ format: 'Letter', margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' }, printBackground: false });
  } finally {
    await browser.close();
  }
}
