/**
 * The canvas as a PDF: the parts picked (MOMA, Sander, …), each with every sheet under it, one
 * sheet per page in hierarchy order, behind a contents page and the System overview. In the PDF
 * the hierarchy still works: a block that opens a sheet links to that sheet's page, a "◀ part"
 * block to where the part is drawn, and the breadcrumb at the top of a page to the pages above.
 */
import type { ArchData } from './data/architecture';
import { getSheet, sheetPath, type SheetId } from './useArchitecture';
import { buildPdf, textWidth, type PdfPage, type PdfText } from './pdfWriter';

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

// Every page A3 landscape (420 × 297 mm), the usual size for electrical drawings. A sheet is
// scaled to fit and centred; its image keeps its own resolution, so zooming in the PDF still
// shows the detail of a big sheet. A small sheet is not blown up past its own size.
const PAGE_W = 1190.55, PAGE_H = 841.89;
const HEADER = 64;  // points above the drawing: breadcrumb and page line
const MARGIN = 36;

/** The text, cut with "..." to fit a width (a contents column). */
function fit(text: string, width: number, size: number, bold: boolean): string {
  if (textWidth(text, size, bold) <= width) return text;
  let t = text;
  while (t.length > 4 && textWidth(`${t}...`, size, bold) > width) t = t.slice(0, -1);
  return `${t}...`;
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
  const title = doc.title ?? 'Architecture';
  const picked = exportParts(doc).filter((p) => parts.includes(p.id));
  const pages: PdfPage[] = [];

  // Contents: one line per sheet, indented by depth, in columns, over as many pages as it needs
  // (all five parts are ~175 lines). Sheets follow, so the sheet pages are known up front.
  const TOP = 136, ROW = 15, COLS = 3, colW = (PAGE_W - 2 * MARGIN) / COLS;
  const rows = Math.floor((PAGE_H - MARGIN - TOP) / ROW);
  const entries = sheets.map((id) => ({ id, depth: id === null ? -1 : sheetPath(doc, id).length - 2 }));
  const contentsPages = Math.max(1, Math.ceil(entries.length / (rows * COLS)));
  const pageOf = new Map<SheetId, number>(sheets.map((s, i) => [s, contentsPages + i]));
  const total = contentsPages + sheets.length;
  for (let cp = 0; cp < contentsPages; cp++) {
    const texts: PdfText[] = [
      { text: title, x: MARGIN, y: 60, size: 22, bold: true },
      { text: `Canvas export - ${picked.map((p) => p.label).join(', ')} - ${new Date().toISOString().slice(0, 10)}`, x: MARGIN, y: 84, size: 11 },
      { text: 'Click a name to open its page. On a page, click a block that opens a sheet, a "<" block, or the path at the top.', x: MARGIN, y: 102, size: 9 },
      { text: `Contents${contentsPages > 1 ? ` (${cp + 1} of ${contentsPages})` : ''} - page ${cp + 1} of ${total}`, x: MARGIN, y: 120, size: 8.5 },
    ];
    entries.slice(cp * rows * COLS, (cp + 1) * rows * COLS).forEach((e, n) => {
      const col = Math.floor(n / rows), x = MARGIN + col * colW + 14 * (e.depth + 1);
      const size = e.depth <= 0 ? 10.5 : 9;
      texts.push({ text: fit(sheetName(e.id), colW - (x - MARGIN - col * colW) - 8, size, e.depth <= 0), x,
        y: TOP + (n % rows) * ROW, size, bold: e.depth <= 0, link: pageOf.get(e.id) });
    });
    pages.push({ width: PAGE_W, height: PAGE_H, texts, links: [] });
  }

  for (let i = 0; i < sheets.length; i++) {
    const id = sheets[i];
    onProgress?.(i, sheets.length, sheetName(id));
    const shot = await capture(id);
    const areaW = PAGE_W - 2 * MARGIN, areaH = PAGE_H - HEADER - MARGIN;
    const k = Math.min(1, areaW / shot.width, areaH / shot.height);
    const ox = MARGIN + (areaW - shot.width * k) / 2, oy = HEADER;  // centred across, from the top
    // breadcrumb: Contents › System overview › MOMA › …, each a link but the last; a long path
    // is set smaller until it fits the page width
    const path = sheetPath(doc, id);
    const items = [{ text: 'Contents', page: 0 }, ...path.map((p) => ({ text: sheetName(p), page: pageOf.get(p) ?? -1 }))];
    let size = 11;
    const SEP = 16;
    const widthAt = (s: number) => items.reduce((w, c, n) => w + textWidth(c.text, n === items.length - 1 ? s * 1.15 : s, n === items.length - 1) + (n < items.length - 1 ? SEP : 0), 0);
    while (size > 6 && widthAt(size) > PAGE_W - 2 * MARGIN) size -= 0.5;
    const crumbs: PdfText[] = [];
    let x = MARGIN;
    items.forEach((c, n) => {
      const last = n === items.length - 1, s = last ? size * 1.15 : size;
      crumbs.push({ text: c.text, x, y: 28, size: s, bold: last, ...(last || c.page < 0 ? {} : { link: c.page }) });
      x += textWidth(c.text, s, last);
      if (!last) { crumbs.push({ text: '>', x: x + SEP / 2 - 3, y: 28, size }); x += SEP; }
    });
    crumbs.push({ text: `Page ${pageOf.get(id)! + 1} of ${total}`, x: MARGIN, y: 46, size: 8.5 });
    pages.push({
      width: PAGE_W, height: PAGE_H,
      image: { dataUrl: shot.dataUrl, x: ox, y: oy, w: shot.width * k, h: shot.height * k },
      texts: crumbs,
      links: shot.links.map((l) => ({ x: ox + l.x * k, y: oy + l.y * k, w: l.w * k, h: l.h * k, page: pageOf.get(l.sheet) ?? -1 })),
    });
  }
  onProgress?.(sheets.length, sheets.length, 'Writing the PDF');
  return buildPdf(pages, `${title} - ${picked.map((p) => p.label).join(', ')}`);
}
