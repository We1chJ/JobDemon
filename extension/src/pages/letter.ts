// Cover letter: paste a job posting and get a letter written from your Setup, nothing invented.
import { html } from '../shared/html.js';
import { ask } from '../shared/msg.js';
import { textToPdf } from '../shared/pdf.js';
import { download, render } from './ui.js';

function draw(v: { company?: string; jd?: string; letter?: string; note?: string; error?: string; busy?: boolean } = {}) {
  render('letter', html`
<div class="page-head"><div><h1>Cover letter</h1><p class="note" style="margin:4px 0 0">Paste a job posting and get a cover letter written from your Setup: your template, your examples and your profile, nothing invented. The company and job title are read from the posting.</p></div></div>
${v.error ? html`<div class="callout t-danger" role="alert">${v.error}</div>` : ''}
<section class="sec" aria-labelledby="jd-h">
<form id="jd-form">
<h2 id="jd-h" class="sr">Job</h2>
<label class="lbl sr" for="jd">Job description</label>
<textarea id="jd" name="jd" rows="16" required placeholder="Paste the whole job posting here, including the company name and job title.">${v.jd ?? ''}</textarea>
<div class="row" style="margin-top:12px"><button class="btn btn-primary" ${v.busy ? html`disabled aria-busy="true"` : ''}>${v.busy ? 'Writing…' : 'Generate cover letter'}</button><span class="muted" style="font-size:14px">Takes 10–30 seconds.</span></div>
</form></section>
${v.letter ? html`<section class="sec" aria-labelledby="out-h">
<div class="sec-head"><h2 id="out-h">Your cover letter</h2>${v.note ? html`<span class="muted">${v.note}</span>` : ''}</div>
<p class="note">Edit it here if you like: Copy and Download use what's in the box.</p>
<label class="lbl sr" for="letter">Cover letter</label>
<textarea id="letter" rows="24" style="font:inherit;line-height:1.6">${v.letter}</textarea>
<div class="row" style="margin-top:12px"><button type="button" class="btn" data-copy-from="letter">Copy text</button><button type="button" class="btn btn-primary" id="pdf">Download PDF</button></div>
</section>` : ''}`);
  document.getElementById('jd-form')!.addEventListener('submit', (e) => { e.preventDefault(); void generate((document.getElementById('jd') as HTMLTextAreaElement).value); });
  document.getElementById('pdf')?.addEventListener('click', () => {
    const text = (document.getElementById('letter') as HTMLTextAreaElement).value.trim();
    if (text) download(`Cover Letter${v.company ? ` - ${v.company.replace(/[^\w .&-]+/g, '').trim()}` : ''}.pdf`, textToPdf(text));
  });
}

async function generate(raw: string) {
  const jd = raw.replace(/\r\n/g, '\n').trim();
  if (!jd) return draw({ error: 'Paste a job description first.' });
  draw({ jd, busy: true });
  try {
    const r = await ask<{ company: string; role: string; text?: string; ok?: boolean; score?: number }>({ t: 'letter:posting', jd });
    if (r.text === undefined) return draw({ jd, error: `Couldn't find the ${!r.company ? 'company name' : 'job title'} in that text. Paste the whole posting, including the company and job title.` });
    draw({ jd, company: r.company, letter: r.text, note: `${r.role} at ${r.company} · ${r.ok ? `relevance ${r.score!.toFixed(1)}/4` : `relevance only ${r.score!.toFixed(1)}/4 after 3 drafts: check it closely`}` });
  } catch (e) {
    draw({ jd, error: `Error: couldn't write the letter because ${(e as Error).message.split('\n')[0]}` });
  }
}

draw();
