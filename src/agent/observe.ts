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
    // Upload widgets are often labelled just "Attach"; use the group's heading (e.g. "Resume/CV") instead.
    if (parts.length && /^(attach|upload|choose file|browse)$/i.test(clean(parts.join(' ')))) {
      parts.length = 0;
      let p = el.parentElement;
      const generic = /^(attach|upload|choose file|browse|enter manually|dropbox|google drive)$/i;
      for (let i = 0; i < 8 && p && !parts.length; i++, p = p.parentElement) {
        const head = [...p.querySelectorAll('label, legend, [class*="label"], [id*="label"]')].find((h) => {
          const t = clean(h.innerText);
          return !h.contains(el) && t && t.length < 80 && !generic.test(t);
        });
        if (head) parts.push(clean(head.innerText));
      }
      if (!parts.length) parts.push((el.name || el.id || 'file').replace(/[_-]+/g, ' '));
    }
    if (el.placeholder) parts.push('placeholder: ' + el.placeholder);
    if (!parts.length && el.name) parts.push(el.name);
    if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.type === 'submit' || /^(tab|link|button)$/.test(el.getAttribute('role') || '')) parts.unshift(el.innerText || el.value || '');
    return clean(parts.join(' / '));
  };
  document.querySelectorAll('[data-jd-idx],[data-jd-opt],[data-jd-groupbtn]').forEach((e) => { e.removeAttribute('data-jd-idx'); e.removeAttribute('data-jd-opt'); e.removeAttribute('data-jd-groupbtn'); });
  const out = [];
  const seenRadio = new Set();
  // Button-style choice groups (e.g. Ashby's Yes / No buttons beside a hidden checkbox) are one question.
  const groupOf = new Map();
  for (const cb of document.querySelectorAll('input[type=checkbox]')) {
    const btns = [...(cb.parentElement ? cb.parentElement.querySelectorAll(':scope > button[aria-pressed], :scope > [role=button][aria-pressed]') : [])];
    if (btns.length >= 2) { groupOf.set(cb, btns); btns.forEach((b) => b.setAttribute('data-jd-groupbtn', '1')); }
  }
  // Links and tabs too: the way into an application is often an "Apply" link or an "Application" tab.
  const nodes = document.querySelectorAll('input, textarea, select, button, a[href], [role=button], [role=tab], [role=link], [role=combobox], [role=checkbox]');
  for (const el of nodes) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden') continue;
    if (el.hasAttribute('data-jd-groupbtn')) continue; // part of a choice group, handled with its checkbox
    // Bot traps ("This input is for robots only, do not enter if you're human"): never touch them.
    // ("Leave blank if none" on a real question is NOT a trap: only "leave THIS field blank" wording counts.)
    if (/for robots only|if you.?re (a )?human|leave this (field|input|box) (blank|empty)|honeypot/i.test(labelOf(el))) continue;
    if (groupOf.has(el)) {
      const btns = groupOf.get(el);
      const idx = out.length;
      const box = el.closest('[data-field-path]') || el.parentElement.parentElement;
      const lab = box && box.querySelector('label');
      const options = btns.map((b, k) => { b.setAttribute('data-jd-opt', idx + ':' + k); return clean(b.innerText); });
      const pressed = btns.find((b) => b.getAttribute('aria-pressed') === 'true');
      out.push({ idx, key: 'group:' + (el.name || el.id || idx), tag: 'radio', type: 'radio', label: clean(lab ? lab.innerText : labelOf(el)), value: pressed ? clean(pressed.innerText) : '', required: el.required || /\*\s*$/.test(lab ? lab.innerText : ''), options });
      continue;
    }
    if (type !== 'file' && type !== 'radio' && type !== 'checkbox' && !visible(el)) continue;
    // Hidden checkboxes/radios are fine when they're styled behind a visible label; otherwise they're
    // leftovers (e.g. Workday's Create Account "Terms and Conditions" box, still in the page but hidden).
    if ((type === 'checkbox' || type === 'radio') && !visible(el)) {
      const lab = (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label') || (el.parentElement && el.parentElement.querySelector('label'));
      const btns = el.parentElement ? el.parentElement.querySelectorAll('button[aria-pressed]') : [];
      if (!(lab && visible(lab)) && !btns.length) continue;
    }
    if (el.disabled) continue;
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') || '';
      if (!clean(el.innerText) || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    }
    // Hidden helpers behind custom dropdowns ("Select...", phone country) aren't real fields.
    if (el.tagName === 'INPUT' && type !== 'file' && type !== 'radio' && type !== 'checkbox' && el.getAttribute('role') !== 'combobox'
        && (el.tabIndex === -1 || el.getAttribute('aria-hidden') === 'true')) continue;
    if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && /toggle flyout|^clear/i.test(el.getAttribute('aria-label') || '')) continue;
    const idx = out.length;
    // Pick lists: standard comboboxes, plus search-style pickers (Workday: a "Search" box you type in and pick from).
    const searchPicker = el.tagName === 'INPUT' && (type === 'text' || type === 'search' || !type) && /^search\b/i.test(el.placeholder || '')
      && !!el.closest('[data-automation-id], form');
    const isCombo = el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list' || searchPicker;
    const role = el.getAttribute('role');
    const tag = isCombo ? 'combobox' : role === 'tab' ? 'tab' : el.tagName.toLowerCase();
    const required = el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(labelOf(el));
    // Radio groups, and checkbox lists that share one name ("select all that apply"), are one question each.
    const grouped = type === 'radio' || (type === 'checkbox' && el.name && document.querySelectorAll('input[type=checkbox][name="' + CSS.escape(el.name) + '"]').length > 1);
    if (grouped) {
      if (!el.name || seenRadio.has(type + ':' + el.name)) continue;
      seenRadio.add(type + ':' + el.name);
      const optLabel = (r) => (r.id && document.querySelector('label[for="' + CSS.escape(r.id) + '"]')) || r.closest('label');
      const radios = [...document.querySelectorAll('input[type=' + type + '][name="' + CSS.escape(el.name) + '"]')]
        .filter((r) => type === 'radio' || visible(r) || (optLabel(r) && visible(optLabel(r))));
      if (!radios.length) continue;
      const group = el.closest('[data-field-path]') || el.closest('fieldset') || el.closest('[class*="question"]') || el.parentElement.parentElement;
      // Option text: its own <label for>, a wrapping <label>, or the value.
      const optText = (r) => clean((r.id && document.querySelector('label[for="' + CSS.escape(r.id) + '"]') || r.closest('label') || {}).innerText || r.getAttribute('aria-label') || r.value);
      const options = radios.map((r, k) => { r.setAttribute('data-jd-opt', idx + ':' + k); return optText(r); });
      const checked = radios.filter((r) => r.checked);
      // Question text: a legend, or the group's first label that isn't one of the option labels (Ashby).
      const optionLabels = new Set(radios.map((r) => r.id && document.querySelector('label[for="' + CSS.escape(r.id) + '"]')).filter(Boolean));
      const head = group && (group.querySelector('legend')
        || [...group.querySelectorAll('label')].find((l) => !optionLabels.has(l) && !radios.some((r) => l.contains(r)))
        // e.g. Lever: <div class="application-label"><div class="text">Question</div></div>
        || [...group.querySelectorAll('[class*="label"]')].find((l) => !radios.some((r) => l.contains(r)) && clean(l.innerText)));
      out.push({ idx, key: (type === 'radio' ? 'radio:' : 'check:') + el.name, tag: type === 'radio' ? 'radio' : 'checkgroup', type, label: clean(head ? head.innerText : labelOf(el)), value: checked.map(optText).join(', '), required: radios.some((r) => r.required), options });
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
    if (tag === 'combobox' && !value) {
      // Custom dropdowns clear their text box after a pick and show the choice elsewhere (react-select "single-value").
      // Look only within this field: stop before reaching a container that holds another input.
      let p = el.parentElement;
      for (let i = 0; i < 5 && p && !value; i++, p = p.parentElement) {
        if ([...p.querySelectorAll('input, select, textarea')].some((x) => x !== el && x.type !== 'hidden' && x.tabIndex !== -1)) break;
        const v = p.querySelector('[class*="single-value"],[class*="singleValue"],[data-automation-id*="selectedItem" i],[data-automation-id="promptSelectionLabel"]');
        if (v) value = clean(v.innerText);
      }
    }
    // Checkboxes in a list often share one name: tell them apart by id or their own label.
    // Identity: name, then Workday's stable data-automation-id, then id, then label (two "If so, please explain" boxes share a label).
    const aid = el.getAttribute('data-automation-id');
    const key = type === 'checkbox' && el.name ? el.name + ':' + (el.id || label) : (el.name || (aid ? aid + ':' + label : '') || el.id || label);
    out.push({ idx, key: key.slice(0, 120), tag, type, label, value, required, options });
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
    // Only a CAPTCHA you can actually see counts. Invisible reCAPTCHA (e.g. Ashby) sits in hidden iframes.
    const vis = (el) => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return r.width > 30 && r.height > 30 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
    };
    for (const f of document.querySelectorAll('iframe')) {
      const src = f.src || '';
      const r = f.getBoundingClientRect();
      if (/recaptcha/.test(src) && Math.round(r.width) === 256 && Math.round(r.height) === 60) continue; // the corner badge
      if (/hcaptcha|challenges\.cloudflare|turnstile/.test(src) && vis(f)) return 'CAPTCHA on page';
      if (/recaptcha/.test(src) && !/size=invisible/.test(src) && vis(f)) return 'CAPTCHA on page';
    }
    // Password boxes are short (~20px tall), so they get their own visibility test.
    const shown = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 30 && r.height > 8 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const pw = [...document.querySelectorAll('input[type=password]')].find(shown);
    if (pw) return 'Login or account creation required';
    // Verify-email screens: only when there is a visible box asking for the code itself
    // (page text alone isn't enough: a job description may well say "check your email").
    const codeBox = [...document.querySelectorAll('input:not([type=hidden])')].find((i) => shown(i) &&
      /verif|one.?time|\botp\b|security code|access code|confirmation code|6.?digit/i.test([i.name, i.id, i.placeholder, i.getAttribute('autocomplete'), i.getAttribute('aria-label'), (i.labels && i.labels[0] ? i.labels[0].innerText : '')].join(' ')));
    if (codeBox) return 'Email verification required';
    return null;
  })()`)) as string | null;
}

/** An application form embedded in an iframe (e.g. a Greenhouse form on a company's career page). */
export async function findEmbeddedForm(page: Page): Promise<string | null> {
  return (await page.evaluate(String.raw`(() => {
    const ats = /greenhouse|lever\.co|ashbyhq|myworkdayjobs|workday|smartrecruiters|icims|jobvite|bamboohr|workable|\/embed\/|job_app|\/apply/i;
    for (const f of document.querySelectorAll('iframe')) {
      const r = f.getBoundingClientRect();
      if (f.src && ats.test(f.src) && r.width > 200 && r.height > 200) return f.src;
    }
    return null;
  })()`)) as string | null;
}
