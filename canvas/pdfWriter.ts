/**
 * A small PDF writer for the canvas export: pages with an image (the sheet as a JPEG), text,
 * simple shapes (rules, rounded panels, swatches) and links - areas on the page or words - that
 * jump to another page of the same file. No library: a PDF with images, the two built-in
 * Times fonts, vector shapes and link annotations is a few objects.
 */

export type Rgb = [number, number, number];

export interface PdfText {
  text: string;
  x: number;
  /** Baseline, from the top of the page. */
  y: number;
  size: number;
  bold?: boolean;
  /** 0-255 RGB; links default to blue, other text to near-black. */
  color?: Rgb;
  /** Page index this text links to. */
  link?: number;
}

export interface PdfShape {
  /** A rectangle (rounded with `radius`) or, with `line`, a straight line from x,y to x+w,y+h. */
  x: number;
  y: number;
  w: number;
  h: number;
  radius?: number;
  fill?: Rgb;
  stroke?: Rgb;
  lineWidth?: number;
  line?: boolean;
}

export interface PdfLink {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Page index to open. */
  page: number;
}

export interface PdfPage {
  /** Page size in points (1/72 inch). */
  width: number;
  height: number;
  /** Drawn first, under everything else. */
  shapes?: PdfShape[];
  /** A JPEG (data URL) drawn at x, y (from the top) with size w × h in points. */
  image?: { dataUrl: string; x: number; y: number; w: number; h: number };
  texts: PdfText[];
  /** Areas from the top-left of the page. */
  links: PdfLink[];
}

const enc = new TextEncoder();

// Characters Times has in WinAnsi beyond ASCII: code and width (1/1000 em).
const EXTRA: Record<string, [number, number]> = {
  '›': [0x9b, 333], '‹': [0x8b, 333], '·': [0xb7, 250], '—': [0x97, 1000], '–': [0x96, 500],
  '•': [0x95, 350], '©': [0xa9, 760], '×': [0xd7, 564],
};
const ASCII_FOR: Record<string, string> = { '◀': '<', '◂': '<', '▶': '>', '▸': '>', '→': '->', '←': '<-' };

/** Text in Times (WinAnsi) as a PDF string; other characters become close ASCII. */
function pdfString(s: string): string {
  let out = '';
  for (const ch of s.replace(/[◀◂▶▸→←]/g, (c) => ASCII_FOR[c])) {
    if (EXTRA[ch]) out += `\\${EXTRA[ch][0].toString(8)}`;
    else if (/[\x20-\x7e]/.test(ch)) out += /[\\()]/.test(ch) ? `\\${ch}` : ch;
    else out += '?';
  }
  return `(${out})`;
}

function jpegBytes(dataUrl: string): { bytes: Uint8Array; width: number; height: number } {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // pixel size from the first start-of-frame marker
  for (let i = 2; i < bytes.length - 9; ) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const m = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return { bytes, height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    i += 2 + len;
  }
  throw new Error('not a JPEG');
}

// Times-Roman / Times-Bold advance widths (1/1000 em) for printable ASCII, from the standard
// font metrics: the PDF's own text is set in Times (Times New Roman in every reader).
const TIMES = [
  250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500,
  500, 500, 278, 278, 564, 564, 564, 444, 921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722,
  556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, 333, 444, 500, 444, 500, 444, 333, 500,
  500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541,
];
const TIMES_BOLD = [
  250, 333, 555, 500, 500, 1000, 833, 278, 333, 333, 500, 570, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500,
  500, 500, 333, 333, 570, 570, 570, 500, 930, 722, 667, 722, 722, 667, 611, 778, 778, 389, 500, 778, 667, 944, 722, 778,
  611, 778, 722, 556, 667, 722, 722, 1000, 722, 722, 667, 333, 278, 333, 581, 500, 333, 500, 556, 444, 556, 444, 333, 500,
  556, 278, 333, 556, 278, 833, 556, 500, 556, 556, 444, 389, 333, 556, 500, 722, 500, 500, 444, 394, 220, 394, 520,
];

/** Width in points of text set in Times, as written to the PDF. */
export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s.replace(/[◀◂▶▸→←]/g, (c) => ASCII_FOR[c]))
    w += EXTRA[ch]?.[1] ?? (bold ? TIMES_BOLD : TIMES)[ch.charCodeAt(0) - 32] ?? 500;
  return (w * size) / 1000;
}

const rgb = (c: Rgb) => c.map((v) => Math.round((v / 255) * 1000) / 1000).join(' ');

export function buildPdf(pages: PdfPage[], title: string): Blob {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array | string) => {
    const u = typeof b === 'string' ? enc.encode(b) : b;
    chunks.push(u);
    length += u.length;
  };
  // object numbers: 1 catalog, 2 pages, 3 font, 4 bold font, 5 info, then per page: page, contents, image
  const pageObj = (i: number) => 6 + i * 3;
  const total = 5 + pages.length * 3;
  const obj = (n: number, body: string | Uint8Array[], dict?: string) => {
    offsets[n] = length;
    if (typeof body === 'string') { push(`${n} 0 obj\n${body}\nendobj\n`); return; }
    push(`${n} 0 obj\n${dict}\nstream\n`);
    body.forEach(push);
    push('\nendstream\nendobj\n');
  };
  const num = (v: number) => (Math.round(v * 100) / 100).toString();

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R /PageMode /UseNone >>');
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`);
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>');
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>');
  obj(5, `<< /Title ${pdfString(title)} /Producer (Origin Hardware Architecture Studio) >>`);

  pages.forEach((p, i) => {
    const H = p.height;
    const dest = (k: number) => `[${pageObj(k)} 0 R /Fit]`;
    const annots = [
      ...p.links.map((l) => ({ ...l })),
      ...p.texts.filter((t) => t.link !== undefined).map((t) => ({
        x: t.x - 2, y: t.y - t.size, w: textWidth(t.text, t.size, t.bold) + 4, h: t.size * 1.3, page: t.link!,
      })),
    ].filter((l) => l.page >= 0 && l.page < pages.length && l.page !== i)
      .map((l) => `<< /Type /Annot /Subtype /Link /Border [0 0 0] /Rect [${num(l.x)} ${num(H - l.y - l.h)} ${num(l.x + l.w)} ${num(H - l.y)}] /Dest ${dest(l.page)} >>`);
    const img = p.image ? jpegBytes(p.image.dataUrl) : null;
    obj(pageObj(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.width)} ${num(H)}] `
      + `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${img ? ` /XObject << /Im ${pageObj(i) + 2} 0 R >>` : ''} >> `
      + `/Contents ${pageObj(i) + 1} 0 R${annots.length ? ` /Annots [${annots.join(' ')}]` : ''} >>`);
    const ops: string[] = [];
    for (const s of p.shapes ?? []) {
      const style = [s.fill && `${rgb(s.fill)} rg`, s.stroke && `${rgb(s.stroke)} RG`, `${num(s.lineWidth ?? 0.75)} w`].filter(Boolean).join(' ');
      const paint = s.line ? 'S' : s.fill && s.stroke ? 'B' : s.fill ? 'f' : 'S';
      const x = s.x, y = H - s.y - (s.line ? 0 : s.h);  // PDF y runs up from the bottom
      let path: string;
      if (s.line) path = `${num(s.x)} ${num(H - s.y)} m ${num(s.x + s.w)} ${num(H - s.y - s.h)} l`;
      else if (s.radius) {
        const r = Math.min(s.radius, s.w / 2, s.h / 2), k = r * 0.5523, X = x + s.w, Y = y + s.h;
        path = `${num(x + r)} ${num(y)} m ${num(X - r)} ${num(y)} l ${num(X - r + k)} ${num(y)} ${num(X)} ${num(y + r - k)} ${num(X)} ${num(y + r)} c `
          + `${num(X)} ${num(Y - r)} l ${num(X)} ${num(Y - r + k)} ${num(X - r + k)} ${num(Y)} ${num(X - r)} ${num(Y)} c `
          + `${num(x + r)} ${num(Y)} l ${num(x + r - k)} ${num(Y)} ${num(x)} ${num(Y - r + k)} ${num(x)} ${num(Y - r)} c `
          + `${num(x)} ${num(y + r)} l ${num(x)} ${num(y + r - k)} ${num(x + r - k)} ${num(y)} ${num(x + r)} ${num(y)} c h`;
      } else path = `${num(x)} ${num(y)} ${num(s.w)} ${num(s.h)} re`;
      ops.push(`q ${style} ${path} ${paint} Q`);
    }
    if (p.image) {
      const { x, y, w, h } = p.image;
      ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(H - y - h)} cm /Im Do Q`);
    }
    for (const t of p.texts) {
      const color = t.color ?? (t.link !== undefined ? [29, 92, 217] : [26, 31, 41]) as Rgb;
      ops.push(`BT /${t.bold ? 'F2' : 'F1'} ${num(t.size)} Tf ${rgb(color)} rg ${num(t.x)} ${num(H - t.y)} Td ${pdfString(t.text)} Tj ET`);
    }
    const content = enc.encode(ops.join('\n'));
    obj(pageObj(i) + 1, [content], `<< /Length ${content.length} >>`);
    if (img) obj(pageObj(i) + 2, [img.bytes],
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>`);
    else obj(pageObj(i) + 2, '<< >>');
  });

  const xref = length;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= total; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}
