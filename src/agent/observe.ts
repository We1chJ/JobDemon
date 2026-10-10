import type { Page } from 'playwright';
import type { ElementInfo } from '../types.js';

// Kept as a plain string so the bundler can't inject helpers that don't exist in the page.
const OBSERVE_JS = String.raw`(() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const labelOf = (el) => {
    const parts = [];
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) lb.split(/\s+/).forEach((id) => { const n = document.getElementById(id); if (n) parts.push(n.innerText); });
    if (el.id) document.querySelectorAll('label[for="' + CSS.escape(el.id) + '"]').forEach((l) => parts.push(l.innerText));
    const wrap = el.closest('label'); if (wrap) parts.push(wrap.innerText);
    const fs = el.closest('fieldset'); if (fs && fs.querySelector('legend')) parts.push(fs.querySelector('legend').innerText);
    if (!parts.length) {
      let p = el.parentElement;
      for (let i = 0; i < 3 && p && !parts.length; i++, p = p.parentElement) {
        const t = clean(p.innerText); if (t && t.length < 200) parts.push(t);
      }
    }
    if (el.placeholder) parts.push('placeholder: ' + el.placeholder);
    if (!parts.length && el.name) parts.push(el.name);
    if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.type === 'submit') parts.unshift(el.innerText || el.value || '');
    return clean(parts.join(' / '));
  };
  document.querySelectorAll('[data-jd-idx],[data-jd-opt]').forEach((e) => { e.removeAttribute('data-jd-idx'); e.removeAttribute('data-jd-opt'); });
  const out = [];
  const seenRadio = new Set();
  const nodes = document.querySelectorAll('input, textarea, select, button, a[role=button], [role=combobox], [role=checkbox]');
  for (const el of nodes) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden') continue;
    if (type !== 'file' && type !== 'radio' && type !== 'checkbox' && !visible(el)) continue;
    if (el.disabled) continue;
    const idx = out.length;
    const isCombo = el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list';
    const tag = isCombo ? 'combobox' : el.tagName.toLowerCase();
    const required = el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(labelOf(el));
    if (type === 'radio') {
      if (!el.name || seenRadio.has(el.name)) continue;
      seenRadio.add(el.name);
      const radios = [...document.querySelectorAll('input[type=radio][name="' + CSS.escape(el.name) + '"]')];
      const group = el.closest('fieldset') || el.parentElement.parentElement;
      const options = radios.map((r, k) => { r.setAttribute('data-jd-opt', idx + ':' + k); return clean((r.closest('label') || {}).innerText || r.value); });
      const checked = radios.find((r) => r.checked);
      const legend = group && group.querySelector('legend');
      out.push({ idx, key: 'radio:' + el.name, tag: 'radio', type: 'radio', label: clean(legend ? legend.innerText : labelOf(el)), value: checked ? clean((checked.closest('label') || {}).innerText || checked.value) : '', required: radios.some((r) => r.required), options });
      continue;
    }
    el.setAttribute('data-jd-idx', String(idx));
    const label = labelOf(el);
    let value = '';
    let options;
    if (el.tagName === 'SELECT') { options = [...el.options].map((o) => clean(o.text)).filter(Boolean); value = el.value ? clean(el.options[el.selectedIndex].text) : ''; }
    else if (type === 'checkbox') value = el.checked ? 'checked' : '';
    else if (type === 'file') value = el.files && el.files.length ? el.files[0].name : '';
    else if ('value' in el && tag !== 'button') value = clean(el.value);
    out.push({ idx, key: (el.name || el.id || label).slice(0, 120), tag, type, label, value, required, options });
  }
  return out;
})()`;

export async function observe(page: Page, handled: Set<string>): Promise<ElementInfo[]> {
  const raw = (await page.evaluate(OBSERVE_JS)) as Omit<ElementInfo, 'handled'>[];
  return raw.map((e) => ({ ...e, handled: handled.has(e.key) }));
}

/** Company, role and job description text read off the apply page. */
export async function readJob(page: Page) {
  return (await page.evaluate(String.raw`(() => {
    const title = document.title || '';
    const og = (p) => (document.querySelector('meta[property="' + p + '"]') || {}).content || '';
    const h1 = ((document.querySelector('h1') || {}).innerText || '').trim();
    let company = '', role = '';
    const m = title.match(/Job Application for (.+?) at (.+)$/i);
    if (m) { role = m[1].trim(); company = m[2].trim(); }
    role = role || h1 || og('og:title') || title;
    company = company || og('og:site_name') || location.hostname.replace(/^(www|boards|job-boards|jobs)\./, '').split('.')[0];
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('form, script, style, nav, footer').forEach((n) => n.remove());
    const jd = (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 12000);
    return { company, role, jd };
  })()`)) as { company: string; role: string; jd: string };
}

/** CAPTCHA / login walls go straight to the human queue. Invisible reCAPTCHA badges are ignored. */
export async function detectBlocker(page: Page): Promise<string | null> {
  return (await page.evaluate(String.raw`(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 30 && r.height > 30; };
    for (const f of document.querySelectorAll('iframe')) {
      const src = f.src || '';
      if (/hcaptcha|challenges\.cloudflare|turnstile/.test(src) && vis(f)) return 'CAPTCHA on page';
      if (/recaptcha/.test(src) && !/size=invisible/.test(src) && vis(f)) return 'CAPTCHA on page';
    }
    const pw = [...document.querySelectorAll('input[type=password]')].find(vis);
    if (pw) return 'Login or account creation required';
    return null;
  })()`)) as string | null;
}
