import React, { useCallback, useEffect, useMemo, useState } from 'react';

// V4 skeleton architecture: functional blocks by tier with candidate parts, read from the data
// repo's v4/skeleton.json through the dev server (/api/v4/skeleton, vite.config.ts). It is not
// the BOM: a block becomes a real part only when a part is chosen and added on the Canvas.
//
// Each block has two requirement sets:
//   architecture  derived here from the block's tier, quantity, links, ports and linked REQ items;
//                 read-only, it changes when the architecture changes.
//   component     written by the engineer for that block (block.componentReqs in skeleton.json);
//                 edited here and saved with PUT /api/v4/skeleton.
// "Sourcing sheet" joins the two into the requirement draft handed to supply chain.

type Level = 'must' | 'should' | 'could' | 'program' | 'open';
interface CReq { id: string; text: string; level: Level; category?: string; inputs?: string; outputs?: string; pl?: string; hazards?: string }
interface Block { id: string; tier: number; group: string; name: string; qty: number; candidate: string; status: string; note: string; ports: string[]; reqs: string[]; componentReqs?: CReq[] }
interface Link { from: string; to: string; kind: string; label: string }
interface Skeleton { note: string; status: string; decisions: { id: string; text: string }[]; tiers: { id: number; label: string; desc: string }[]; blocks: Block[]; links: Link[] }
interface ArchReq { id: string; text: string; from: string }
interface ReqItem { id: string; title: string; text: string }

const KIND_STYLE: Record<string, string> = {
  power: 'bg-red-50 text-red-700 border-red-200', safety: 'bg-amber-50 text-amber-800 border-amber-200', sto: 'bg-amber-50 text-amber-800 border-amber-200',
  can: 'bg-violet-50 text-violet-700 border-violet-200', gpio: 'bg-violet-50 text-violet-700 border-violet-200', pwm: 'bg-violet-50 text-violet-700 border-violet-200',
  gmsl2: 'bg-teal-50 text-teal-700 border-teal-200', i2c: 'bg-teal-50 text-teal-700 border-teal-200', encoder: 'bg-teal-50 text-teal-700 border-teal-200',
};
const kindStyle = (k: string) => KIND_STYLE[k] ?? 'bg-blue-50 text-blue-700 border-blue-200';

const LEVELS: { id: Level; label: string; style: string }[] = [
  { id: 'must', label: 'Must', style: 'bg-red-50 text-red-700 border-red-200' },
  { id: 'should', label: 'Should', style: 'bg-amber-50 text-amber-800 border-amber-200' },
  { id: 'could', label: 'Could', style: 'bg-slate-100 text-slate-600 border-slate-200' },
  { id: 'program', label: 'Programmed function', style: 'bg-sky-50 text-sky-700 border-sky-200' },
  { id: 'open', label: 'Open question', style: 'bg-orange-50 text-orange-700 border-orange-200' },
];
const levelOf = (id: Level) => LEVELS.find((l) => l.id === id) ?? LEVELS[0];

/** Architecture-level requirements of one block, derived from the skeleton and the requirements list. */
function archReqs(b: Block, doc: Skeleton, reqs: Map<string, ReqItem>): ArchReq[] {
  const name = (id: string) => doc.blocks.find((x) => x.id === id)?.name ?? id;
  const out: ArchReq[] = [];
  let n = 0;
  const add = (text: string, from: string) => out.push({ id: `${b.id}-A${++n}`, text, from });
  const tier = doc.tiers.find((t) => t.id === b.tier);
  add(`Quantity: ${b.qty} per robot.`, 'architecture');
  if (tier) add(`${tier.label}: ${tier.desc}.`, 'architecture');
  if (b.status === 'frozen') add('Part choice is frozen: the part must be the candidate listed, or an agreed form-fit-function equivalent.', 'architecture');
  for (const l of doc.links.filter((x) => x.to === b.id)) add(`Receives from ${name(l.from)} over ${l.kind}${l.label ? ` (${l.label})` : ''}.`, 'link');
  for (const l of doc.links.filter((x) => x.from === b.id)) add(`Provides to ${name(l.to)} over ${l.kind}${l.label ? ` (${l.label})` : ''}.`, 'link');
  for (const p of b.ports) add(`Provides: ${p}.`, 'ports');
  for (const id of b.reqs) {
    const r = reqs.get(id);
    add(r ? `${id} ${r.title}: ${r.text}` : `${id} (linked requirement, text not loaded)`, 'requirement');
  }
  if (b.note) add(`Context: ${b.note}`, 'note');
  return out;
}

/** The sourcing sheet for one block as Markdown: what supply chain needs to find a component. */
function sheetMarkdown(b: Block, doc: Skeleton, arch: ArchReq[]): string {
  const cr = b.componentReqs ?? [];
  const rank = (l: Level) => LEVELS.findIndex((x) => x.id === l);
  const line = (r: CReq) => {
    const extra = [r.inputs && `inputs: ${r.inputs}`, r.outputs && `outputs: ${r.outputs}`, r.pl && `required PL: ${r.pl}`, r.hazards && `hazards: ${r.hazards}`].filter(Boolean).join('; ');
    return `- **${r.id}** [${levelOf(r.level).label}] ${r.text}${extra ? ` (${extra})` : ''}`;
  };
  const sourced = cr.filter((r) => r.level !== 'open').sort((a, z) => rank(a.level) - rank(z.level));
  const open = cr.filter((r) => r.level === 'open');
  const cats = [...new Set(sourced.map((r) => r.category ?? 'Component'))];
  const lines = [
    `# Sourcing requirement: ${b.qty > 1 ? `${b.qty}× ` : ''}${b.name}`,
    '',
    `Block ${b.id} · Tier ${b.tier} · ${b.group} · status: ${b.status}. Draft ${new Date().toISOString().slice(0, 10)} from the V4 skeleton architecture (${doc.status}).`,
    '',
    `**Current candidate:** ${b.candidate || 'none'}`,
    '',
    '## A. What the architecture needs from this component',
    '',
    ...arch.map((r) => `- **${r.id}** ${r.text}`),
    '',
    '## B. Component requirements',
    '',
  ];
  if (!sourced.length) lines.push('_None entered yet._', '');
  for (const c of cats) {
    lines.push(`### ${c}`, '', ...sourced.filter((r) => (r.category ?? 'Component') === c).map(line), '');
  }
  if (open.length) lines.push('## C. Open questions (not yet requirements)', '', ...open.map(line), '');
  lines.push(
    '## Please return',
    '',
    '- At least 2 candidate parts that meet every Must (plus the candidate above if it does), with datasheet link, price and lead time.',
    '- Lifecycle status (active / NRND / EOL) and stock source for each.',
    '- For every Must: the datasheet value or a note why it is not met.',
    '',
  );
  return lines.join('\n');
}

export const SkeletonViewer: React.FC = () => {
  const [doc, setDoc] = useState<Skeleton | null>(null);
  const [etag, setEtag] = useState('');
  const [reqs, setReqs] = useState<Map<string, ReqItem>>(new Map());
  const [error, setError] = useState('');
  const [sel, setSel] = useState('ICU');
  const [q, setQ] = useState('');
  const [drafts, setDrafts] = useState<Record<string, CReq[]>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [sheet, setSheet] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    fetch('/api/v4/skeleton', { cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error(await r.text()); setEtag(r.headers.get('ETag') ?? ''); return r.json(); })
      .then((d) => { setDoc(d); setDrafts({}); })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(() => {
    load();
    // the linked requirements give the architecture-level text; the tab still works without them
    fetch('/api/v4/requirements', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.requirements) setReqs(new Map((d.requirements as { id: string; title: string; text: string }[]).map((r) => [r.id, { id: r.id, title: r.title, text: r.text }]))); })
      .catch(() => {});
  }, [load]);

  const byId = useMemo(() => new Map((doc?.blocks ?? []).map((b) => [b.id, b])), [doc]);
  if (error) return <div className="p-6 text-sm text-red-700">Could not load the skeleton: {error}</div>;
  if (!doc) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  const match = (b: Block) => !q.trim() || `${b.name} ${b.candidate} ${b.group} ${b.id}`.toLowerCase().includes(q.toLowerCase());
  const cur = byId.get(sel);
  const out = doc.links.filter((l) => l.from === sel);
  const inn = doc.links.filter((l) => l.to === sel);
  const list = (b: Block): CReq[] => drafts[b.id] ?? b.componentReqs ?? [];
  const dirty = Object.keys(drafts).length > 0;
  const emptyText = Object.values(drafts).some((l) => l.some((r) => !r.text.trim()));
  const edit = (b: Block, next: CReq[]) => setDrafts((d) => ({ ...d, [b.id]: next }));
  const nextId = (b: Block, items: CReq[]) => {
    const used = new Set(items.map((r) => r.id));
    for (let i = items.length + 1; ; i++) if (!used.has(`${b.id}-C${i}`)) return `${b.id}-C${i}`;
  };

  const save = async () => {
    setSaving(true); setSaveError('');
    try {
      const r = await fetch('/api/v4/skeleton', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': etag }, body: JSON.stringify({ componentReqs: drafts }) });
      if (!r.ok) throw new Error(await r.text());
      load();
    } catch (e) { setSaveError(String((e as Error).message ?? e)); }
    setSaving(false);
  };

  const LinkRow = ({ l, other }: { l: Link; other: string }) => (
    <button onClick={() => setSel(other)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 text-left text-sm">
      <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${kindStyle(l.kind)}`}>{l.kind}</span>
      <span className="flex-1 truncate">{byId.get(other)?.name ?? other}</span>
      <span className="text-xs text-slate-400">{l.label}</span>
    </button>
  );

  const sheetFor = (b: Block) => sheetMarkdown({ ...b, componentReqs: list(b) }, doc, archReqs(b, doc, reqs));
  const download = (b: Block) => {
    const url = URL.createObjectURL(new Blob([sheetFor(b)], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url; a.download = `sourcing-${b.id}.md`; a.click();
    URL.revokeObjectURL(url);
  };
  const copy = async (b: Block) => {
    try { await navigator.clipboard.writeText(sheetFor(b)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: use Download */ }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 min-w-0 overflow-auto p-5">
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <h2 className="text-xl font-semibold">V4 skeleton architecture</h2>
          <span className="text-xs px-2 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200">{doc.status}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search blocks…" className="ml-auto border rounded px-3 py-1.5 text-sm w-64" />
        </div>
        <p className="text-sm text-slate-500 mb-4 max-w-3xl">{doc.note}</p>
        <details className="mb-5 text-sm">
          <summary className="cursor-pointer text-slate-600">Closed Tier 1 decisions ({doc.decisions.length})</summary>
          <ul className="mt-2 space-y-1">{doc.decisions.map((d) => <li key={d.id}><span className="font-mono text-xs text-slate-500">{d.id}</span> {d.text}</li>)}</ul>
        </details>
        {doc.tiers.map((t) => {
          const blocks = doc.blocks.filter((b) => b.tier === t.id && match(b));
          const groups = [...new Set(blocks.map((b) => b.group))];
          return (
            <section key={t.id} className="mb-7">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600 border-b pb-1 mb-3">{t.label} <span className="font-normal normal-case text-slate-400">· {t.desc} · {blocks.length} blocks</span></h3>
              {groups.map((g) => (
                <div key={g} className="mb-3">
                  <div className="text-xs font-medium text-slate-500 mb-1.5">{g}</div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
                    {blocks.filter((b) => b.group === g).map((b) => {
                      const n = list(b).length;
                      return (
                        <button key={b.id} onClick={() => setSel(b.id)}
                          className={`text-left border rounded-md px-3 py-2 bg-white hover:border-blue-400 ${sel === b.id ? 'border-blue-500 ring-1 ring-blue-300' : 'border-slate-200'} ${b.status === 'frozen' ? 'border-l-4 border-l-slate-500' : ''}`}>
                          <div className="flex items-start gap-1">
                            <div className="text-sm font-medium flex-1">{b.qty > 1 ? `${b.qty}× ` : ''}{b.name}</div>
                            {n > 0 && <span className="text-[10px] px-1.5 rounded bg-blue-50 text-blue-700 border border-blue-200" title="Component requirements entered">{n}</span>}
                          </div>
                          <div className="text-xs text-slate-500 truncate">{b.candidate}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {blocks.length === 0 && <div className="text-sm text-slate-400">No match.</div>}
            </section>
          );
        })}
      </div>
      {cur && (
        <aside className="w-[440px] shrink-0 border-l bg-white overflow-auto p-4 text-sm">
          <div className="text-xs text-slate-500">{`Tier ${cur.tier} · ${cur.group} · ${cur.status}`}</div>
          <h3 className="text-lg font-semibold mb-1">{cur.qty > 1 ? `${cur.qty}× ` : ''}{cur.name}</h3>
          <div className="mb-3"><span className="text-xs uppercase text-slate-400">Candidate</span><div>{cur.candidate}</div></div>
          {cur.note && <p className="mb-3 text-slate-600">{cur.note}</p>}
          <button onClick={() => setSheet(true)} className="w-full mb-4 px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium">Sourcing sheet for supply chain</button>

          <div className="mb-4">
            <div className="text-xs uppercase text-slate-400 mb-1">Architecture requirements <span className="normal-case">(derived, read-only)</span></div>
            <ul className="space-y-1">
              {archReqs(cur, doc, reqs).map((r) => (
                <li key={r.id} className="text-slate-700 border-l-2 border-slate-200 pl-2"><span className="font-mono text-[11px] text-slate-400 mr-1">{r.id}</span>{r.text}</li>
              ))}
            </ul>
          </div>

          <div className="mb-4">
            <div className="flex items-center mb-1">
              <div className="text-xs uppercase text-slate-400 flex-1">Component requirements <span className="normal-case">({list(cur).length})</span></div>
              <button onClick={() => edit(cur, [...list(cur), { id: nextId(cur, list(cur)), text: '', level: 'must' }])} className="text-xs px-2 py-0.5 rounded border border-slate-300 hover:bg-slate-50">+ Add</button>
            </div>
            {list(cur).length === 0 && <p className="text-xs text-slate-400">None yet. Add what this component must meet; they join the architecture requirements in the sourcing sheet.</p>}
            <ul className="space-y-2">
              {list(cur).map((r, i) => (
                <li key={r.id} className="border rounded p-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[11px] text-slate-500">{r.id}</span>
                    <select value={r.level} onChange={(e) => edit(cur, list(cur).map((x, j) => (j === i ? { ...x, level: e.target.value as Level } : x)))} className={`text-[11px] border rounded px-1 py-0.5 ${levelOf(r.level).style}`}>
                      {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                    </select>
                    {r.category && <span className="text-[11px] text-slate-400 truncate">{r.category}</span>}
                    <button onClick={() => edit(cur, list(cur).filter((_, j) => j !== i))} className="ml-auto text-xs text-slate-400 hover:text-red-600" aria-label="Delete requirement">Delete</button>
                  </div>
                  <textarea value={r.text} rows={Math.min(8, Math.max(2, Math.ceil(r.text.length / 55)))} onChange={(e) => edit(cur, list(cur).map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                    className="w-full border rounded px-2 py-1 text-sm" placeholder="Requirement text" />
                  {(r.inputs || r.outputs || r.pl || r.hazards) && (
                    <div className="mt-1 text-[11px] text-slate-500 space-y-0.5">
                      {r.inputs && <div><span className="text-slate-400">Inputs:</span> {r.inputs}</div>}
                      {r.outputs && <div><span className="text-slate-400">Outputs:</span> {r.outputs}</div>}
                      {r.pl && <div><span className="text-slate-400">Required PL:</span> {r.pl}</div>}
                      {r.hazards && <div><span className="text-slate-400">Hazards:</span> {r.hazards}</div>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {dirty && (
              <div className="sticky bottom-0 bg-white pt-2 mt-2 border-t">
                <div className="flex items-center gap-2">
                  <button disabled={saving || emptyText} onClick={save} className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium">{saving ? 'Saving…' : 'Save requirements'}</button>
                  <button disabled={saving} onClick={() => setDrafts({})} className="px-3 py-1.5 rounded-md border border-slate-300 text-sm">Discard</button>
                </div>
                {emptyText && <p className="text-xs text-amber-700 mt-1">A requirement has no text.</p>}
                {saveError && <p className="text-xs text-red-700 mt-1 whitespace-pre-wrap">{saveError}</p>}
              </div>
            )}
          </div>

          {cur.reqs.length > 0 && <div className="mb-3"><div className="text-xs uppercase text-slate-400 mb-1">Linked requirements</div><div className="flex flex-wrap gap-1">{cur.reqs.map((r) => <span key={r} className="text-xs px-1.5 py-0.5 rounded border bg-slate-50 text-slate-600" title={reqs.get(r)?.title}>{r}</span>)}</div></div>}
          {out.length > 0 && <div className="mb-3"><div className="text-xs uppercase text-slate-400 mb-1">Connects to</div>{out.map((l, i) => <LinkRow key={i} l={l} other={l.to} />)}</div>}
          {inn.length > 0 && <div className="mb-3"><div className="text-xs uppercase text-slate-400 mb-1">Connected from</div>{inn.map((l, i) => <LinkRow key={i} l={l} other={l.from} />)}</div>}
        </aside>
      )}

      {sheet && cur && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={() => setSheet(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b">
              <h3 className="font-semibold flex-1">Sourcing sheet: {cur.name}</h3>
              {dirty && <span className="text-xs text-amber-700">includes unsaved edits</span>}
              <button onClick={() => copy(cur)} className="px-3 py-1.5 rounded-md border border-slate-300 text-sm">{copied ? 'Copied' : 'Copy Markdown'}</button>
              <button onClick={() => download(cur)} className="px-3 py-1.5 rounded-md border border-slate-300 text-sm">Download .md</button>
              <button onClick={() => window.print()} className="px-3 py-1.5 rounded-md border border-slate-300 text-sm">Print</button>
              <button onClick={() => setSheet(false)} className="px-3 py-1.5 rounded-md bg-slate-800 text-white text-sm">Close</button>
            </div>
            <pre className="overflow-auto p-5 text-sm whitespace-pre-wrap font-sans leading-relaxed">{sheetFor(cur)}</pre>
          </div>
        </div>
      )}
    </div>
  );
};
