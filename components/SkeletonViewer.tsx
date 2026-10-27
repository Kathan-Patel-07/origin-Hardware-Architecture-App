import React, { useEffect, useMemo, useState } from 'react';

// V4 skeleton architecture: functional blocks by tier with candidate parts, read from the data
// repo's v4/skeleton.json through the dev server (/api/v4/skeleton, vite.config.ts). It is not
// the BOM: a block becomes a real part only when a part is chosen and added on the Canvas.

interface Block { id: string; tier: number; group: string; name: string; qty: number; candidate: string; status: string; note: string; ports: string[]; reqs: string[] }
interface Link { from: string; to: string; kind: string; label: string }
interface Skeleton { note: string; status: string; decisions: { id: string; text: string }[]; tiers: { id: number; label: string; desc: string }[]; blocks: Block[]; links: Link[] }

const KIND_STYLE: Record<string, string> = {
  power: 'bg-red-50 text-red-700 border-red-200', safety: 'bg-amber-50 text-amber-800 border-amber-200', sto: 'bg-amber-50 text-amber-800 border-amber-200',
  can: 'bg-violet-50 text-violet-700 border-violet-200', gpio: 'bg-violet-50 text-violet-700 border-violet-200', pwm: 'bg-violet-50 text-violet-700 border-violet-200',
  gmsl2: 'bg-teal-50 text-teal-700 border-teal-200', i2c: 'bg-teal-50 text-teal-700 border-teal-200', encoder: 'bg-teal-50 text-teal-700 border-teal-200',
};
const kindStyle = (k: string) => KIND_STYLE[k] ?? 'bg-blue-50 text-blue-700 border-blue-200';

export const SkeletonViewer: React.FC = () => {
  const [doc, setDoc] = useState<Skeleton | null>(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState('ICU');
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch('/api/v4/skeleton', { cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); })
      .then(setDoc)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const byId = useMemo(() => new Map((doc?.blocks ?? []).map((b) => [b.id, b])), [doc]);
  if (error) return <div className="p-6 text-sm text-red-700">Could not load the skeleton: {error}</div>;
  if (!doc) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  const match = (b: Block) => !q.trim() || `${b.name} ${b.candidate} ${b.group} ${b.id}`.toLowerCase().includes(q.toLowerCase());
  const cur = byId.get(sel);
  const out = doc.links.filter((l) => l.from === sel);
  const inn = doc.links.filter((l) => l.to === sel);

  const LinkRow = ({ l, other }: { l: Link; other: string }) => (
    <button onClick={() => setSel(other)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 text-left text-sm">
      <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${kindStyle(l.kind)}`}>{l.kind}</span>
      <span className="flex-1 truncate">{byId.get(other)?.name ?? other}</span>
      <span className="text-xs text-slate-400">{l.label}</span>
    </button>
  );

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
                    {blocks.filter((b) => b.group === g).map((b) => (
                      <button key={b.id} onClick={() => setSel(b.id)}
                        className={`text-left border rounded-md px-3 py-2 bg-white hover:border-blue-400 ${sel === b.id ? 'border-blue-500 ring-1 ring-blue-300' : 'border-slate-200'} ${b.status === 'frozen' ? 'border-l-4 border-l-slate-700' : ''}`}>
                        <div className="text-sm font-medium">{b.qty > 1 ? `${b.qty}× ` : ''}{b.name}</div>
                        <div className="text-xs text-slate-500 truncate">{b.candidate}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {blocks.length === 0 && <div className="text-sm text-slate-400">No match.</div>}
            </section>
          );
        })}
      </div>
      {cur && (
        <aside className="w-[360px] shrink-0 border-l bg-white overflow-auto p-4 text-sm">
          <div className="text-xs text-slate-500">{`Tier ${cur.tier} · ${cur.group} · ${cur.status}`}</div>
          <h3 className="text-lg font-semibold mb-1">{cur.qty > 1 ? `${cur.qty}× ` : ''}{cur.name}</h3>
          <div className="mb-3"><span className="text-xs uppercase text-slate-400">Candidate</span><div>{cur.candidate}</div></div>
          {cur.note && <p className="mb-3 text-slate-600">{cur.note}</p>}
          {cur.ports.length > 0 && <div className="mb-3"><div className="text-xs uppercase text-slate-400 mb-1">Ports</div><ul className="list-disc pl-5">{cur.ports.map((p) => <li key={p}>{p}</li>)}</ul></div>}
          {cur.reqs.length > 0 && <div className="mb-3"><div className="text-xs uppercase text-slate-400 mb-1">Requirements</div><div className="flex flex-wrap gap-1">{cur.reqs.map((r) => <span key={r} className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-100">{r}</span>)}</div></div>}
          {out.length > 0 && <div className="mb-3"><div className="text-xs uppercase text-slate-400 mb-1">Connects to</div>{out.map((l, i) => <LinkRow key={i} l={l} other={l.to} />)}</div>}
          {inn.length > 0 && <div className="mb-3"><div className="text-xs uppercase text-slate-400 mb-1">Connected from</div>{inn.map((l, i) => <LinkRow key={i} l={l} other={l.from} />)}</div>}
        </aside>
      )}
    </div>
  );
};
