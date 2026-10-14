/**
 * The canvas as a PDF: the parts picked (MOMA, Sander, …), each with every sheet under it, one
 * sheet per page in hierarchy order, after a cover, the contents and the System overview. In the PDF
 * the hierarchy still works: a block that opens a sheet links to that sheet's page, a "◀ part"
 * block to where the part is drawn, and the breadcrumb at the top of a page to the pages above.
 */
import type { ArchData } from './data/architecture';
import { getSheet, sheetPath, type SheetId } from './useArchitecture';
import { buildPdf, textWidth, type PdfPage, type PdfShape, type PdfText, type Rgb } from './pdfWriter';

/** One sheet drawn: its image, its size in canvas pixels (= PDF points) and where its links are. */
export interface SheetShot {
  dataUrl: string;
  width: number;
  height: number;
  links: { x: number; y: number; w: number; h: number; sheet: SheetId }[];
}

/** Where a "◀ part" block on `sheetId` points: the sheet above when the part is there (it is the
 *  block this sheet opens from), else the nearest sheet up the path, else any sheet that has it. */
export function referenceSheet(doc: ArchData, sheetId: SheetId, label: string): SheetId | undefined {
  const name = label.match(/^◀\s*(.+)$/)?.[1].trim();
  if (!name) return undefined;
  const path = sheetPath(doc, sheetId);
  const up = path.length > 1 ? path[path.length - 2] : undefined;
  for (const id of [...path.slice(0, -1).reverse(), ...Object.keys(doc.sheets ?? {})]) {
    if (id === sheetId) continue;
    if (getSheet(doc, id)?.nodes.some((n) => (id === up && n.id === sheetId) || n.label === name)) return id;
  }
  return undefined;
}

/** The parts that can be picked: the System overview's blocks that open a sheet. */
export function exportParts(doc: ArchData): { id: string; label: string }[] {
  return doc.nodes.filter((n) => doc.sheets?.[n.id]).map((n) => ({ id: n.id, label: n.label }));
}

/** The System overview, then for each picked part its sheet and every sheet below it, depth first in block order. */
export function exportSheets(doc: ArchData, parts: string[]): SheetId[] {
  const out: SheetId[] = [null];
  const seen = new Set<SheetId>([null]);
  const walk = (id: SheetId) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    for (const n of getSheet(doc, id)?.nodes ?? []) if (doc.sheets?.[n.id]) walk(n.id);
  };
  for (const p of exportParts(doc)) if (parts.includes(p.id)) walk(p.id);
  return out;
}

// Every page A3 landscape (420 × 297 mm), the usual size for electrical drawings, with a header
// (ORIGIN, the document, the part), a breadcrumb of pills and a footer (document, page n of N).
// A sheet is scaled to fit between them and centred; its image keeps its own resolution, so
// zooming in the PDF still shows the detail of a big sheet. A small sheet is not blown up.
const PAGE_W = 1190.55, PAGE_H = 841.89;
const MARGIN = 40;
const TOP = 112;         // the drawing starts below the header and the breadcrumb
const BOTTOM = 58;       // and ends above the footer
const INK: Rgb = [15, 23, 42], MUTED: Rgb = [100, 116, 139], RULE: Rgb = [226, 232, 240];
const ACCENT: Rgb = [37, 99, 235], PILL: Rgb = [241, 245, 249], WHITE: Rgb = [255, 255, 255];
const LINE_TYPES: [string, Rgb][] = [
  ['Power', [239, 68, 68]], ['Communication', [59, 130, 246]], ['Safety', [234, 179, 8]], ['Ground', [34, 197, 94]],
];

/** The text, cut with "…" to fit a width. */
function fit(text: string, width: number, size: number, bold: boolean): string {
  if (textWidth(text, size, bold) <= width) return text;
  let t = text;
  while (t.length > 4 && textWidth(`${t}...`, size, bold) > width) t = t.slice(0, -1);
  return `${t}...`;
}

/** Header and footer, the same on every page after the cover. */
function frame(doc: string, part: string, page: number, total: number): { shapes: PdfShape[]; texts: PdfText[] } {
  const right = (t: string, size: number, bold: boolean) => PAGE_W - MARGIN - textWidth(t, size, bold);
  return {
    shapes: [
      { x: MARGIN, y: 44, w: PAGE_W - 2 * MARGIN, h: 0, line: true, stroke: RULE, lineWidth: 0.8 },
      { x: MARGIN, y: PAGE_H - 40, w: PAGE_W - 2 * MARGIN, h: 0, line: true, stroke: RULE, lineWidth: 0.8 },
    ],
    texts: [
      { text: 'ORIGIN', x: MARGIN, y: 32, size: 11, bold: true, color: INK },
      { text: doc, x: MARGIN + textWidth('ORIGIN', 11, true) + 14, y: 32, size: 10, color: MUTED },
      ...(part ? [{ text: part, x: right(part, 11, true), y: 32, size: 11, bold: true, color: INK }] : []),
      { text: `${doc}${part ? ` · ${part}` : ''}`, x: MARGIN, y: PAGE_H - 22, size: 8.5, color: MUTED },
      { text: `Page ${page} of ${total}`, x: right(`Page ${page} of ${total}`, 8.5, false), y: PAGE_H - 22, size: 8.5, color: MUTED },
    ],
  };
}

export async function exportPdf(opts: {
  doc: ArchData;
  parts: string[];
  sheetName: (id: SheetId) => string;
  capture: (id: SheetId) => Promise<SheetShot>;
  onProgress?: (done: number, total: number, name: string) => void;
}): Promise<Blob> {
  const { doc, parts, sheetName, capture, onProgress } = opts;
  const sheets = exportSheets(doc, parts);
  const all = exportParts(doc);
  const picked = all.filter((p) => parts.includes(p.id));
  const platform = /\bV\d+(\.\d+)?\b/.exec(doc.title ?? '')?.[0] ?? '';
  const docName = `${platform ? `${platform} ` : ''}Electrical Architecture`;
  const partsLine = picked.length === all.length ? 'All subsystems' : picked.map((p) => p.label).join(' · ');
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  // the part a sheet belongs to: the picked part on its path (none for the System overview)
  const partOf = (id: SheetId) => sheetName(sheetPath(doc, id)[1] ?? null);

  // Contents: one line per sheet, indented by depth, in columns, over as many pages as it needs.
  const C_TOP = 150, ROW = 16, COLS = 3, colW = (PAGE_W - 2 * MARGIN) / COLS;
  const rows = Math.floor((PAGE_H - BOTTOM - C_TOP) / ROW);
  const entries = sheets.map((id) => ({ id, depth: id === null ? -1 : sheetPath(doc, id).length - 2 }));
  const contentsPages = Math.max(1, Math.ceil(entries.length / (rows * COLS)));
  // page 0: cover; then contents; then one page per sheet
  const pageOf = new Map<SheetId, number>(sheets.map((s, i) => [s, 1 + contentsPages + i]));
  const total = 1 + contentsPages + sheets.length;
  const pages: PdfPage[] = [];

  // ---- cover
  const cover: PdfPage = { width: PAGE_W, height: PAGE_H, texts: [], links: [], shapes: [
    { x: 0, y: 0, w: 14, h: PAGE_H, fill: ACCENT },
    { x: MARGIN + 30, y: 380, w: 72, h: 4, fill: ACCENT },
    { x: MARGIN + 30, y: PAGE_H - 150, w: PAGE_W - 2 * MARGIN - 30, h: 0, line: true, stroke: RULE, lineWidth: 0.8 },
  ] };
  const L = MARGIN + 30;
  cover.texts.push(
    { text: 'ORIGIN', x: L, y: 120, size: 16, bold: true, color: INK },
    { text: 'Hardware Architecture', x: L + textWidth('ORIGIN', 16, true) + 12, y: 120, size: 13, color: MUTED },
    { text: `Origin ${docName}`, x: L, y: 300, size: 40, bold: true, color: INK },
    { text: fit(partsLine, PAGE_W - L - MARGIN, 22, false), x: L, y: 345, size: 22, color: ACCENT },
    ...(picked.length === all.length ? [{ text: picked.map((p) => p.label).join(' · '), x: L, y: 410, size: 12, color: MUTED }] : []),
    { text: 'Canvas export', x: L, y: 470, size: 10, bold: true, color: MUTED },
    { text: date, x: L, y: 488, size: 12, color: INK },
    { text: 'Contents', x: L + 220, y: 470, size: 10, bold: true, color: MUTED },
    { text: `${sheets.length} sheets · ${total} pages`, x: L + 220, y: 488, size: 12, color: INK, link: 1 },
    { text: 'Lines', x: L, y: 540, size: 10, bold: true, color: MUTED },
  );
  let lx = L;
  for (const [name, c] of LINE_TYPES) {
    cover.shapes!.push({ x: lx, y: 553, w: 26, h: 5, radius: 2.5, fill: c });
    cover.texts.push({ text: name, x: lx + 34, y: 560, size: 11, color: INK });
    lx += 34 + textWidth(name, 11, false) + 34;
  }
  cover.texts.push(
    { text: 'Click a block that opens a sheet, a  <  block, or the path at the top of a page to go there.', x: L, y: PAGE_H - 120, size: 10, color: MUTED },
    { text: `Origin Hardware Architecture Studio · ${doc.title ?? ''}`, x: L, y: PAGE_H - 100, size: 9, color: MUTED },
  );
  pages.push(cover);

  // ---- contents
  for (let cp = 0; cp < contentsPages; cp++) {
    const f = frame(docName, partsLine, 2 + cp, total);
    const texts: PdfText[] = [...f.texts,
      { text: `Contents${contentsPages > 1 ? ` (${cp + 1} of ${contentsPages})` : ''}`, x: MARGIN, y: 96, size: 22, bold: true, color: INK },
      { text: partsLine, x: MARGIN, y: 118, size: 11, color: MUTED }];
    const shapes: PdfShape[] = [...f.shapes];
    entries.slice(cp * rows * COLS, (cp + 1) * rows * COLS).forEach((e, n) => {
      const col = Math.floor(n / rows), x0 = MARGIN + col * colW, y = C_TOP + (n % rows) * ROW;
      const x = x0 + 16 * Math.max(0, e.depth);
      const head = e.depth <= 0, size = head ? 11 : 9.5;
      if (e.depth === 0) shapes.push({ x: x0, y: y - 11, w: 3, h: 14, fill: ACCENT });
      const page = pageOf.get(e.id)! + 1;
      texts.push({ text: fit(sheetName(e.id), colW - (x - x0) - 52, size, head), x: x + (e.depth === 0 ? 10 : 0), y, size, bold: head,
        color: head ? INK : [51, 65, 85], link: pageOf.get(e.id) });
      texts.push({ text: String(page), x: x0 + colW - 24 - textWidth(String(page), 8.5, false), y, size: 8.5, color: MUTED });
    });
    pages.push({ width: PAGE_W, height: PAGE_H, texts, shapes, links: [] });
  }

  // ---- one page per sheet
  for (let i = 0; i < sheets.length; i++) {
    const id = sheets[i];
    onProgress?.(i, sheets.length, sheetName(id));
    const shot = await capture(id);
    const f = frame(docName, id === null ? '' : partOf(id), pageOf.get(id)! + 1, total);
    // breadcrumb pills: Contents › System overview › MOMA › …; the current one filled, the
    // others links; set smaller until the row fits the page
    const items = [{ text: 'Contents', page: 1 }, ...sheetPath(doc, id).map((p) => ({ text: sheetName(p), page: pageOf.get(p) ?? -1 }))];
    let size = 10;
    const PAD = 9, GAP = 18;
    const rowWidth = (s: number) => items.reduce((w, c) => w + textWidth(c.text, s, true) + 2 * PAD, 0) + GAP * (items.length - 1);
    while (size > 6 && rowWidth(size) > PAGE_W - 2 * MARGIN) size -= 0.5;
    const shapes: PdfShape[] = [...f.shapes], texts: PdfText[] = [...f.texts], links: PdfPage['links'] = [];
    let x = MARGIN;
    const Y = 62, PH = size + 11;
    items.forEach((c, n) => {
      const last = n === items.length - 1, w = textWidth(c.text, size, true) + 2 * PAD;
      shapes.push({ x, y: Y, w, h: PH, radius: PH / 2, fill: last ? ACCENT : PILL });
      texts.push({ text: c.text, x: x + PAD, y: Y + PH / 2 + size * 0.36, size, bold: true, color: last ? WHITE : c.page >= 0 ? ACCENT : MUTED });
      if (!last && c.page >= 0) links.push({ x, y: Y, w, h: PH, page: c.page });
      x += w;
      if (!last) { texts.push({ text: '›', x: x + GAP / 2 - 3, y: Y + PH / 2 + size * 0.36, size: size + 2, color: MUTED }); x += GAP; }
    });
    // the drawing, centred in the space between the breadcrumb and the footer
    const areaW = PAGE_W - 2 * MARGIN, areaH = PAGE_H - TOP - BOTTOM;
    const k = Math.min(1, areaW / shot.width, areaH / shot.height);
    const w = shot.width * k, h = shot.height * k;
    const ox = MARGIN + (areaW - w) / 2, oy = TOP + (areaH - h) / 2;
    pages.push({
      width: PAGE_W, height: PAGE_H, shapes, texts,
      image: { dataUrl: shot.dataUrl, x: ox, y: oy, w, h },
      links: [...links, ...shot.links.map((l) => ({ x: ox + l.x * k, y: oy + l.y * k, w: l.w * k, h: l.h * k, page: pageOf.get(l.sheet) ?? -1 }))],
    });
  }
  onProgress?.(sheets.length, sheets.length, 'Writing the PDF');
  return buildPdf(pages, `Origin ${docName} - ${partsLine}`);
}
