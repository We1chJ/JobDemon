// Plain text to a Letter-size PDF (Times, 11.5pt, 1-inch margins), written by hand: no library, no browser print.
const W = 612, H = 792, M = 72, SIZE = 11.5, LEAD = 17;
// Times-Roman advance widths (per 1000 em) for printable ASCII 32..126.
const TIMES = [250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444,
  921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500,
  333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541];
const width = (s: string) => [...s].reduce((n, c) => n + (TIMES[c.charCodeAt(0) - 32] ?? 500), 0) * SIZE / 1000;
// Typographic characters to their plain equivalents (the standard font's encoding has no Unicode).
const plain = (s: string) => s.replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"').replace(/[–—−]/g, '-')
  .replace(/…/g, '...').replace(/•/g, '-').replace(/ /g, ' ').normalize('NFKD').replace(/[^\x20-\x7E\n]/g, '');

function lines(text: string) {
  const out: string[] = [];
  for (const para of plain(text).split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && width(next) > W - 2 * M) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

export function textToPdf(text: string): Uint8Array {
  const all = lines(text), perPage = Math.floor((H - 2 * M) / LEAD);
  const pages: string[][] = [];
  for (let i = 0; i < all.length; i += perPage) pages.push(all.slice(i, i + perPage));
  if (!pages.length) pages.push([]);
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  // Objects: 1 catalog, 2 pages, 3 font, then a page + its content stream for each page.
  const objs: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>'];
  const kids: string[] = [];
  for (const p of pages) {
    const stream = `BT /F1 ${SIZE} Tf ${LEAD} TL ${M} ${H - M - SIZE} Td ${p.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length + 2} 0 R >>`);
    kids.push(`${objs.length} 0 R`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
