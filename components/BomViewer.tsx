import React, { useMemo, useState } from 'react';
import bomData from '../bom/v3-bom.json';

// V3 electrical BOM: Robot > Sub-system > Subassembly > Part, built from the V3 Design
// Tracker fused with the V3 architecture (data repo tools/build_v3.py).

interface BomLine {
  lineId: string;
  parentLineId: string | null;
  level: number;
  lineType: 'assembly' | 'part';
  title?: string;
  ipn?: string | null;
  mpn?: string | null;
  description?: string | null;
  category?: string | null;
  qty?: number | null;
  uom?: string;
  revision?: string | null;
  status?: string | null;
  vendor?: string | null;
  leadTimeDays?: number | null;
  unitPrice?: number | null;
  datasheet?: string | null;
  whereUsed?: string[];
  lineConfig?: { modifications?: { type?: string; value?: string }[]; derivedIpn?: string; note?: string } | null;
}

interface Override {
  op: 'add' | 'remove' | 'substitute' | 'change_qty';
  lineId?: string;
  parentLineId?: string;
  qty?: number;
  line?: Partial<BomLine>;
  reason?: string;
}

interface Bom {
  bomId: string;
  revision: string;
  status: string;
  revisions: { revision: string; status: string; note?: string }[];
  geographies: Record<string, { label: string; overrides: Override[] }>;
  lines: BomLine[];
}

const BOM = bomData as unknown as Bom;

/** Base lines with one geography's overrides applied. */
function resolve(bom: Bom, geo: string | null): { lines: BomLine[]; changed: Set<string> } {
  const lines = bom.lines.map((l) => ({ ...l }));
  const changed = new Set<string>();
  if (!geo) return { lines, changed };
  const byId = new Map(lines.map((l) => [l.lineId, l]));
  const removed = new Set<string>();
  for (const ov of bom.geographies[geo]?.overrides ?? []) {
    const target = ov.lineId ? byId.get(ov.lineId) : undefined;
    if (ov.op === 'remove' && target) removed.add(target.lineId);
    if (ov.op === 'change_qty' && target && typeof ov.qty === 'number') {
      target.qty = ov.qty;
      changed.add(target.lineId);
    }
    if (ov.op === 'substitute' && target && ov.line) {
      Object.assign(target, ov.line);
      changed.add(target.lineId);
    }
    if (ov.op === 'add' && ov.parentLineId && byId.has(ov.parentLineId) && ov.line) {
      const parent = byId.get(ov.parentLineId)!;
      const added: BomLine = {
        lineType: 'part',
        ...ov.line,
        lineId: `${ov.parentLineId}/+${geo}/${ov.line.ipn ?? lines.length}`,
        parentLineId: ov.parentLineId,
        level: parent.level + 1,
      } as BomLine;
      lines.push(added);
      byId.set(added.lineId, added);
      changed.add(added.lineId);
    }
  }
  // drop removed lines and their descendants
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of lines) if (l.parentLineId && removed.has(l.parentLineId) && !removed.has(l.lineId)) {
      removed.add(l.lineId);
      grew = true;
    }
  }
  return { lines: lines.filter((l) => !removed.has(l.lineId)), changed };
}

const money = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const BomViewer: React.FC = () => {
  const geoKeys = Object.keys(BOM.geographies);
  const [geo, setGeo] = useState<string>(geoKeys[0] ?? '');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [placement, setPlacement] = useState<'all' | 'placed' | 'unplaced'>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openLine, setOpenLine] = useState<string | null>(null);

  const { lines, changed } = useMemo(() => resolve(BOM, geo || null), [geo]);
  const children = useMemo(() => {
    const m = new Map<string | null, BomLine[]>();
    for (const l of lines) m.set(l.parentLineId, [...(m.get(l.parentLineId) ?? []), l]);
    return m;
  }, [lines]);
  const parts = lines.filter((l) => l.lineType === 'part');
  const categories = [...new Set(parts.map((l) => l.category || '—'))].sort();

  const q = query.trim().toLowerCase();
  const partMatches = (l: BomLine) =>
    (category === 'all' || (l.category || '—') === category) &&
    (placement === 'all' || (placement === 'placed') === Boolean(l.whereUsed?.length)) &&
    (!q || [l.ipn, l.mpn, l.description, l.vendor, ...(l.whereUsed ?? [])].some((x) => (x ?? '').toLowerCase().includes(q)));

  // assembly subtotals over the parts that pass the filters
  const subtotal = useMemo(() => {
    const memo = new Map<string, { parts: number; cost: number; unpriced: number }>();
    const walk = (id: string): { parts: number; cost: number; unpriced: number } => {
      if (memo.has(id)) return memo.get(id)!;
      const t = { parts: 0, cost: 0, unpriced: 0 };
      for (const c of children.get(id) ?? []) {
        if (c.lineType === 'part') {
          if (!partMatches(c)) continue;
          t.parts += 1;
          if (isNum(c.unitPrice) && isNum(c.qty)) t.cost += c.unitPrice * c.qty;
          else t.unpriced += 1;
        } else {
          const s = walk(c.lineId);
          t.parts += s.parts;
          t.cost += s.cost;
          t.unpriced += s.unpriced;
        }
      }
      memo.set(id, t);
      return t;
    };
    return walk;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, q, category, placement]);

  const rows: BomLine[] = [];
  const visit = (id: string | null) => {
    for (const l of children.get(id) ?? []) {
      if (l.lineType === 'part') {
        if (partMatches(l)) rows.push(l);
        continue;
      }
      if (subtotal(l.lineId).parts === 0 && (q || category !== 'all' || placement !== 'all')) continue;
      rows.push(l);
      if (!collapsed.has(l.lineId)) visit(l.lineId);
    }
  };
  visit(null);

  const root = lines.find((l) => l.parentLineId === null);
  const total = root ? subtotal(root.lineId) : { parts: 0, cost: 0, unpriced: 0 };
  const placed = parts.filter((l) => l.whereUsed?.length).length;

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const exportCsv = () => {
    const head = ['Level', 'Sub-system / Subassembly', 'IPN', 'MPN', 'Description', 'Category', 'Qty', 'UoM',
      'Revision', 'Status', 'Vendor', 'Lead time (days)', 'Unit price', 'Where used'];
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const out = [head.join(',')];
    for (const l of lines) {
      out.push([l.level, l.lineType === 'assembly' ? l.title : '', l.ipn, l.mpn, l.description, l.category, l.qty,
        l.uom, l.revision, l.status, l.vendor, l.leadTimeDays, l.unitPrice, (l.whereUsed ?? []).join(' ')]
        .map(cell).join(','));
    }
    const url = URL.createObjectURL(new Blob([out.join('\n') + '\n'], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${BOM.bomId}-rev${BOM.revision}-${geo || 'base'}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const overrides = BOM.geographies[geo]?.overrides ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-slate-200 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">V3 Electrical BOM</h2>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-slate-300 text-slate-600">
              Rev {BOM.revision}
            </span>
            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
              BOM.status === 'released' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
              {BOM.status}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {parts.length} part lines · {placed} placed in the architecture · {total.parts} shown
            {total.cost > 0 && <> · est. ₹{money(total.cost)} per robot{total.unpriced ? ` (+${total.unpriced} unpriced)` : ''}</>}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg" role="group" aria-label="Geography">
          {geoKeys.map((g) => (
            <button key={g} onClick={() => setGeo(g)}
              className={`px-3 py-1 text-xs font-semibold rounded-md ${geo === g ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
              {g}
            </button>
          ))}
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search IPN, MPN, description, vendor, node…"
          className="flex-1 min-w-[220px] text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="text-sm border border-slate-300 rounded-lg px-2 py-1.5">
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={placement} onChange={(e) => setPlacement(e.target.value as 'all' | 'placed' | 'unplaced')}
          className="text-sm border border-slate-300 rounded-lg px-2 py-1.5">
          <option value="all">In / not in architecture</option>
          <option value="placed">In the architecture</option>
          <option value="unplaced">Not in the architecture</option>
        </select>
        <div className="flex gap-2">
          <button onClick={() => setCollapsed(new Set())} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">Expand all</button>
          <button onClick={() => setCollapsed(new Set(lines.filter((l) => l.level === 2).map((l) => l.lineId)))}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">Collapse to subassemblies</button>
          <button onClick={exportCsv} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-700">Export CSV</button>
        </div>
      </div>
      {geo && (
        <div className="px-6 py-2 text-xs bg-slate-50 border-b border-slate-200 text-slate-600">
          {BOM.geographies[geo]?.label}:{' '}
          {overrides.length
            ? `${overrides.length} regional difference(s) applied; changed lines are marked.`
            : 'no regional differences recorded yet — this is the base BOM.'}
          {' '}Revisions: {BOM.revisions.map((r) => `${r.revision} (${r.status})`).join(', ')}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-white shadow-sm z-10">
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2 font-semibold">Item</th>
              <th className="px-3 py-2 font-semibold">IPN</th>
              <th className="px-3 py-2 font-semibold">MPN</th>
              <th className="px-3 py-2 font-semibold">Category</th>
              <th className="px-3 py-2 font-semibold text-right">Qty</th>
              <th className="px-3 py-2 font-semibold">Rev</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Vendor</th>
              <th className="px-3 py-2 font-semibold text-right">Lead (d)</th>
              <th className="px-3 py-2 font-semibold text-right">Unit ₹</th>
              <th className="px-3 py-2 font-semibold">Where used</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) =>
              l.lineType === 'assembly' ? (
                <tr key={l.lineId} className={l.level === 0 ? 'bg-slate-800 text-white' : l.level === 1 ? 'bg-slate-200' : 'bg-slate-50'}>
                  <td colSpan={11} className="px-3 py-1.5" style={{ paddingLeft: 12 + l.level * 18 }}>
                    <button onClick={() => toggle(l.lineId)} className="font-semibold inline-flex items-center gap-2">
                      <span className="font-mono w-3">{collapsed.has(l.lineId) ? '▸' : '▾'}</span>
                      {l.title}
                      <span className={`font-normal ${l.level === 0 ? 'text-slate-300' : 'text-slate-500'}`}>
                        {subtotal(l.lineId).parts} parts
                        {subtotal(l.lineId).cost > 0 && ` · ₹${money(subtotal(l.lineId).cost)}`}
                      </span>
                    </button>
                  </td>
                </tr>
              ) : (
                <React.Fragment key={l.lineId}>
                  <tr onClick={() => setOpenLine(openLine === l.lineId ? null : l.lineId)}
                    className={`border-b border-slate-100 hover:bg-blue-50 cursor-pointer ${changed.has(l.lineId) ? 'bg-amber-50' : ''}`}>
                    <td className="px-3 py-1.5 text-slate-800" style={{ paddingLeft: 12 + l.level * 18 }}>
                      {l.description}
                      {l.lineConfig && <span className="ml-2 text-[10px] px-1 rounded bg-violet-100 text-violet-800">modified</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono whitespace-nowrap">{l.ipn}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-600">{l.mpn}</td>
                    <td className="px-3 py-1.5">{l.category}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{l.qty ?? '—'}</td>
                    <td className="px-3 py-1.5 font-mono">{l.revision}</td>
                    <td className="px-3 py-1.5">{l.status}</td>
                    <td className="px-3 py-1.5">{l.vendor}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{l.leadTimeDays ?? ''}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{isNum(l.unitPrice) ? money(l.unitPrice) : ''}</td>
                    <td className="px-3 py-1.5">
                      {l.whereUsed?.length
                        ? <span className="text-emerald-700">{l.whereUsed.length} node{l.whereUsed.length > 1 ? 's' : ''}</span>
                        : <span className="text-slate-400">not in architecture</span>}
                    </td>
                  </tr>
                  {openLine === l.lineId && (
                    <tr className="bg-blue-50/50 border-b border-slate-200">
                      <td colSpan={11} className="px-6 py-3 text-slate-700">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Where used in the V3 architecture</div>
                            {l.whereUsed?.length ? l.whereUsed.map((w) => <div key={w} className="font-mono">{w.replace(':', ' / ')}</div>)
                              : <div className="text-slate-400">No architecture node matches this tracker part.</div>}
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Line configuration</div>
                            {l.lineConfig ? <pre className="font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(l.lineConfig, null, 2)}</pre>
                              : <div className="text-slate-400">Used as supplied (no modification recorded).</div>}
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Documents</div>
                            {l.datasheet?.startsWith('http')
                              ? <a href={l.datasheet} target="_blank" rel="noreferrer" className="text-blue-700 underline break-all">Datasheet</a>
                              : <div className="text-slate-400">{l.datasheet || 'No datasheet in the tracker.'}</div>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ),
            )}
            {rows.length === 0 && (
              <tr><td colSpan={11} className="px-6 py-10 text-center text-slate-400">No lines match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
