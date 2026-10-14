/**
 * A small PDF writer for the canvas export: one page per sheet, the sheet as a JPEG image under
 * a heading, and links - areas on the page (a block that opens a sheet) and words in the heading
 * (the breadcrumb) - that jump to another page of the same file. No library: a PDF with images,
 * one built-in font and link annotations is a few objects.
 */

export interface PdfText {
  text: string;
  x: number;
  /** Baseline, from the top of the page. */
  y: number;
  size: number;
  bold?: boolean;
  /** Page index this text links to. */
  link?: number;
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
  /** A JPEG (data URL) drawn at x, y (from the top) with size w × h in points. */
  image?: { dataUrl: string; x: number; y: number; w: number; h: number };
  texts: PdfText[];
  /** Areas from the top-left of the page. */
  links: PdfLink[];
}

const enc = new TextEncoder();

/** Text in Helvetica (WinAnsi): characters outside it become close ASCII. */
function pdfString(s: string): string {
  const ascii = s
    .replace(/[◀◂]/g, '<')
    .replace(/[▶▸]/g, '>')
    .replace(/›/g, '>')
    .replace(/[–—]/g, '-')
    .replace(/·/g, '-')
    .replace(/[^\x20-\x7e]/g, '?');
  return `(${ascii.replace(/([\\()])/g, '\\$1')})`;
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

// Helvetica advance widths (1/1000 em) for printable ASCII, from the standard font metrics; bold
// is about 5 % wider. Long part names set at a flat average overran the next breadcrumb item.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Width in points of text set in Helvetica (as written to the PDF: see pdfString). */
export const textWidth = (s: string, size: number, bold = false) =>
  (pdfString(s).slice(1, -1).replace(/\\(.)/g, '$1').split('')
    .reduce((w, ch) => w + (HELV[ch.charCodeAt(0) - 32] ?? 556), 0) * size * (bold ? 1.05 : 1)) / 1000;

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
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
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
    if (p.image) {
      const { x, y, w, h } = p.image;
      ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(H - y - h)} cm /Im Do Q`);
    }
    for (const t of p.texts) {
      ops.push(`BT /${t.bold ? 'F2' : 'F1'} ${num(t.size)} Tf ${t.link !== undefined ? '0.11 0.36 0.85 rg' : '0.1 0.12 0.16 rg'} `
        + `${num(t.x)} ${num(H - t.y)} Td ${pdfString(t.text)} Tj ET`);
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
