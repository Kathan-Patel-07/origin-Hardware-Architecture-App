import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// V4 requirements (PRD-v4 §4): a tree (system > subsystem > component) built from what was
// said - every requirement keeps the words it came from, and a click plays that moment of the
// recording. Stored in the data repo's v4 checkout (requirements/), read and saved through the
// dev server (/api/v4/requirements, vite.config.ts), which runs the §4.2 checks before writing.

type Level = 'system' | 'subsystem' | 'component';
type Status = 'draft' | 'in_review' | 'approved' | 'obsolete';
interface SourceRef { source: string; at: number; quote: string }
interface Requirement {
  id: string;
  title: string;
  text: string;
  rationale: string;
  parentId: string | null;
  level: Level;
  subsystem: string;
  variant: string;
  driver: string;
  owner: string;
  status: Status;
  createdBy: string;
  createdDate: string;
  sources: SourceRef[];
  openQuestions: string[];
  notes: string;
}
interface Segment { start: number; end: number; text: string }
interface Source { id: string; kind: string; title: string; by: string; date: string; file: string; audio: string; duration: number; segments: Segment[] }

const LEVELS: Level[] = ['system', 'subsystem', 'component'];
const PREFIX: Record<Level, string> = { system: 'REQ-SYS-', subsystem: 'REQ-SUB-', component: 'REQ-CMP-' };
const STATUSES: Status[] = ['draft', 'in_review', 'approved', 'obsolete'];
const STATUS_STYLE: Record<Status, string> = {
  draft: 'bg-amber-50 text-amber-800 border-amber-200',
  in_review: 'bg-blue-50 text-blue-700 border-blue-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  obsolete: 'bg-slate-100 text-slate-500 border-slate-200 line-through',
};
const STATUS_TEXT: Record<Status, string> = { draft: 'Draft', in_review: 'In review', approved: 'Approved', obsolete: 'Obsolete' };
const SUBSYSTEMS = ['', 'moma', 'tools', 'operation_station', 'handheld_mapper'];
const VARIANTS = ['all', 'US', 'Global'];

// Compliance mode is a view filter only, worked out from data already in each requirement:
// CE = the EN 60204-1 gap analysis (SRC-004) or an "EN 60204-1: also closes" note;
// ISO 13849 = the ISO 13849-1 gap analysis (SRC-003) or 13849 named in the title/text.
// A requirement with neither tag takes its parent's, so a branch stays together. Untagged
// all the way up = general product requirement, shown in both modes.
type Compliance = 'ce' | 'ce_iso';
type Tag = 'ce' | 'iso' | 'both' | 'general';
const ownTag = (r: Requirement): Tag | null => {
  const ce = r.sources.some((s) => s.source === 'SRC-004') || r.notes.includes('EN 60204-1: also closes');
  const iso = r.sources.some((s) => s.source === 'SRC-003') || /13849/.test(`${r.title} ${r.text}`);
  return ce && iso ? 'both' : ce ? 'ce' : iso ? 'iso' : null;
};

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const audioUrl = (s: Source) => `/api/v4/requirements/audio/${encodeURIComponent(s.audio)}`;

function nextId(reqs: Requirement[], level: Level) {
  const used = new Set(reqs.map((r) => r.id));
  let i = 1;
  while (used.has(`${PREFIX[level]}${String(i).padStart(3, '0')}`)) i++;
  return `${PREFIX[level]}${String(i).padStart(3, '0')}`;
}

export function RequirementsViewer() {
  const [reqs, setReqs] = useState<Requirement[] | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [etag, setEtag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'requirements' | 'sources'>('requirements');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | Status>('');
  const [variant, setVariant] = useState('');
  const [compliance, setCompliance] = useState<Compliance>('ce_iso');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState<{ source: string; at: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/v4/requirements', { cache: 'no-store' });
      if (!r.ok) throw new Error(await r.text());
      const d = (await r.json()) as { requirements: Requirement[]; sources: Source[] };
      setReqs(d.requirements);
      setSources(d.sources);
      setEtag(r.headers.get('ETag'));
      setDirty(false);
      setError(null);
      setSelected((s) => s ?? d.requirements[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    if (import.meta.env.DEV) void load();
  }, [load]);

  const save = async () => {
    if (!reqs) return;
    setSaveMsg({ text: 'Saving…' });
    const r = await fetch('/api/v4/requirements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
      body: JSON.stringify({ requirements: reqs }),
    });
    if (!r.ok) return setSaveMsg({ text: `Not saved: ${await r.text()}`, error: true });
    setEtag(r.headers.get('ETag'));
    setDirty(false);
    setSaveMsg({ text: 'Saved to requirements/requirements.json on v4' });
    setTimeout(() => setSaveMsg(null), 4000);
  };

  const update = (id: string, patch: Partial<Requirement>) => {
    setReqs((rs) => rs && rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const add = (parent: Requirement | null) => {
    if (!reqs) return;
    const level: Level = parent ? LEVELS[Math.min(LEVELS.indexOf(parent.level) + 1, 2)] : 'system';
    const id = nextId(reqs, level);
    const r: Requirement = {
      id, title: 'New requirement', text: '', rationale: '', parentId: parent?.id ?? null, level,
      subsystem: parent?.subsystem ?? '', variant: parent?.variant ?? 'all', driver: parent?.driver ?? '', owner: 'Kathan',
      status: 'draft', createdBy: 'Kathan', createdDate: new Date().toISOString().slice(0, 10), sources: [], openQuestions: [], notes: '',
    };
    setReqs([...reqs, r]);
    setSelected(id);
    setDirty(true);
    if (parent) setCollapsed((c) => { const n = new Set(c); n.delete(parent.id); return n; });
  };

  const byId = useMemo(() => new Map((reqs ?? []).map((r) => [r.id, r])), [reqs]);
  const children = useMemo(() => {
    const m = new Map<string | null, Requirement[]>();
    for (const r of reqs ?? []) (m.get(r.parentId) ?? m.set(r.parentId, []).get(r.parentId)!).push(r);
    for (const list of m.values()) list.sort((a, b) => a.id.localeCompare(b.id));
    return m;
  }, [reqs]);
  const tags = useMemo(() => {
    const m = new Map<string, Tag>();
    const tagOf = (r: Requirement, seen = new Set<string>()): Tag => {
      const known = m.get(r.id);
      if (known) return known;
      const parent = r.parentId ? byId.get(r.parentId) : undefined;
      const t = ownTag(r) ?? (parent && !seen.has(r.id) ? tagOf(parent, seen.add(r.id)) : 'general');
      m.set(r.id, t);
      return t;
    };
    for (const r of reqs ?? []) tagOf(r);
    return m;
  }, [reqs, byId]);
  const inMode = useCallback((r: Requirement) => compliance === 'ce_iso' || tags.get(r.id) !== 'iso', [compliance, tags]);
  const modeCount = useMemo(() => (reqs ?? []).filter(inMode).length, [reqs, inMode]);
  const matches = useCallback(
    (r: Requirement) =>
      inMode(r) &&
      (!status || r.status === status) &&
      (!variant || r.variant === variant) &&
      (!query || `${r.id} ${r.title} ${r.text} ${r.driver} ${r.sources.map((s) => s.quote).join(' ')}`.toLowerCase().includes(query.toLowerCase())),
    [inMode, status, variant, query],
  );
  // a branch stays visible when anything under it matches the filters
  const visible = useCallback(
    (r: Requirement): boolean => matches(r) || (children.get(r.id) ?? []).some(visible),
    [matches, children],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of reqs ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [reqs]);
  const openQuestions = (reqs ?? []).reduce((n, r) => n + r.openQuestions.length, 0);

  const exportCsv = () => {
    if (!reqs) return;
    const cols = ['id', 'title', 'text', 'parentId', 'level', 'subsystem', 'variant', 'compliance', 'driver', 'status', 'owner', 'openQuestions', 'source'];
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = reqs.filter(inMode).map((r) => [r.id, r.title, r.text, r.parentId ?? '', r.level, r.subsystem, r.variant, tags.get(r.id) ?? '', r.driver, r.status, r.owner,
      r.openQuestions.join(' | '), r.sources.map((s) => `${s.source} @ ${mmss(s.at)}`).join(' | ')].map((v) => q(String(v))).join(','));
    const url = URL.createObjectURL(new Blob([[cols.join(','), ...rows].join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = compliance === 'ce' ? 'v4-requirements-ce-only.csv' : 'v4-requirements.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!import.meta.env.DEV)
    return <Notice>Requirements are edited with the dev server: run <code>npm run dev</code> with the data repo's <code>v4</code> branch checked out next to the app.</Notice>;
  if (error) return <Notice error>Could not load the requirements: {error}</Notice>;
  if (!reqs) return <Notice>Loading the requirements…</Notice>;

  const sel = selected ? byId.get(selected) ?? null : null;
  const renderNode = (r: Requirement, depth: number): React.ReactNode => {
    if (!visible(r)) return null;
    const kids = children.get(r.id) ?? [];
    const open = !collapsed.has(r.id);
    const tag = tags.get(r.id);
    // shown only because something below it is in the current mode
    const context = !inMode(r);
    return (
      <div key={r.id}>
        <div
          onClick={() => setSelected(r.id)}
          title={context ? 'Not part of the CE-only set; shown because requirements below it are' : undefined}
          className={`group flex items-start gap-2 pr-3 py-1.5 cursor-pointer border-l-2 ${context ? 'opacity-50' : ''} ${selected === r.id ? 'bg-blue-50 border-blue-500' : 'border-transparent hover:bg-slate-50'}`}
          style={{ paddingLeft: 12 + depth * 18 }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setCollapsed((c) => { const n = new Set(c); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; }); }}
            className={`w-4 text-slate-400 text-xs mt-0.5 ${kids.length ? '' : 'invisible'}`}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? '▾' : '▸'}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mono text-[10px] text-slate-500">{r.id}</span>
              <span className={`text-[10px] px-1.5 rounded border ${STATUS_STYLE[r.status]}`}>{STATUS_TEXT[r.status]}</span>
              {(tag === 'ce' || tag === 'both') && <span className="text-[10px] px-1.5 rounded border border-sky-200 bg-sky-50 text-sky-700">CE</span>}
              {(tag === 'iso' || tag === 'both') && <span className="text-[10px] px-1.5 rounded border border-rose-200 bg-rose-50 text-rose-700">13849</span>}
              {r.variant !== 'all' && <span className="text-[10px] px-1.5 rounded border border-violet-200 bg-violet-50 text-violet-700">{r.variant}</span>}
              {r.openQuestions.length > 0 && <span className="text-[10px] px-1.5 rounded border border-orange-200 bg-orange-50 text-orange-700">{r.openQuestions.length} ?</span>}
              {kids.length > 0 && <span className="text-[10px] text-slate-400">{kids.length} below</span>}
            </div>
            <div className={`text-sm ${depth === 0 ? 'font-semibold text-slate-900' : 'text-slate-800'} ${r.status === 'obsolete' ? 'line-through text-slate-400' : ''}`}>{r.title}</div>
          </div>
        </div>
        {open && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-4 bg-white border-b border-slate-200 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-[240px]">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">V4 Requirements</h2>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-slate-300 text-slate-600">{reqs.length}</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {STATUSES.filter((s) => counts[s]).map((s) => `${counts[s]} ${STATUS_TEXT[s].toLowerCase()}`).join(' · ')}
            {openQuestions ? ` · ${openQuestions} open questions` : ''} · from {sources.length} voice note{sources.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg" role="group" aria-label="View">
          {(['requirements', 'sources'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`text-xs px-3 py-1 rounded-md ${view === v ? 'bg-white shadow-sm text-slate-900 font-semibold' : 'text-slate-500'}`}>
              {v === 'requirements' ? 'Requirements' : 'Sources (what was said)'}
            </button>
          ))}
        </div>
        {view === 'requirements' && (
          <>
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg" role="group" aria-label="Compliance mode">
              {([['ce', 'CE only'], ['ce_iso', 'CE + ISO 13849-1']] as const).map(([m, label]) => (
                <button key={m} onClick={() => setCompliance(m)}
                  className={`text-xs px-3 py-1 rounded-md ${compliance === m ? 'bg-white shadow-sm text-slate-900 font-semibold' : 'text-slate-500'}`}>
                  {label}
                </button>
              ))}
              <span className="text-[11px] text-slate-500 px-1.5">{modeCount} of {reqs.length}</span>
            </div>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search requirements and quotes…"
              className="flex-1 min-w-[200px] text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            <select value={status} onChange={(e) => setStatus(e.target.value as '' | Status)} className="text-sm border border-slate-300 rounded-lg px-2 py-1.5">
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}
            </select>
            <select value={variant} onChange={(e) => setVariant(e.target.value)} className="text-sm border border-slate-300 rounded-lg px-2 py-1.5">
              <option value="">All variants</option>
              {VARIANTS.map((v) => <option key={v} value={v}>{v === 'all' ? 'Both variants' : v}</option>)}
            </select>
          </>
        )}
        <div className="flex gap-2 items-center ml-auto">
          {saveMsg && <span className={`text-xs max-w-[320px] whitespace-pre-line ${saveMsg.error ? 'text-red-600' : 'text-slate-500'}`}>{saveMsg.text}</span>}
          <button onClick={() => add(null)} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">+ Top-level requirement</button>
          <button onClick={exportCsv} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">Export CSV</button>
          <button onClick={save} disabled={!dirty}
            className={`text-xs px-3 py-1.5 rounded-lg ${dirty ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-400'}`}>
            {dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </div>

      {view === 'sources' ? (
        <SourcesView sources={sources} reqs={reqs} playing={playing} onPick={(id) => { setSelected(id); setView('requirements'); }} />
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-[42%] min-w-[340px] border-r border-slate-200 overflow-auto bg-white py-2">
            {(children.get(null) ?? []).map((r) => renderNode(r, 0))}
          </div>
          <div className="flex-1 overflow-auto bg-slate-50">
            {sel ? (
              <Detail
                r={sel}
                all={reqs}
                sources={sources}
                childCount={(children.get(sel.id) ?? []).length}
                onChange={(p) => update(sel.id, p)}
                onAddChild={() => add(sel)}
                onPlay={setPlaying}
                playing={playing}
              />
            ) : (
              <p className="p-6 text-sm text-slate-500">Select a requirement.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Notice({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return <div className={`p-8 text-sm ${error ? 'text-red-600' : 'text-slate-600'}`}>{children}</div>;
}

const field = 'w-full text-sm border border-slate-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none';
const label = 'block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1';

function Detail({ r, all, sources, childCount, onChange, onAddChild, onPlay, playing }: {
  r: Requirement; all: Requirement[]; sources: Source[]; childCount: number;
  onChange: (p: Partial<Requirement>) => void; onAddChild: () => void;
  onPlay: (p: { source: string; at: number }) => void; playing: { source: string; at: number } | null;
}) {
  // a parent must sit one or more levels above, and not be this requirement or anything below it
  const below = new Set<string>([r.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const x of all) if (x.parentId && below.has(x.parentId) && !below.has(x.id)) { below.add(x.id); grew = true; }
  }
  const parents = all.filter((x) => !below.has(x.id) && LEVELS.indexOf(x.level) < LEVELS.indexOf(r.level));
  return (
    <div className="p-6 max-w-3xl space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-mono">{r.id}</span>
            <span>· {r.level}</span>
            {r.driver && <span>· driver: {r.driver}</span>}
            <span>· {r.createdBy}, {r.createdDate}</span>
          </div>
          <input value={r.title} onChange={(e) => onChange({ title: e.target.value })}
            className="mt-1 w-full text-lg font-semibold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none" />
        </div>
        <select value={r.status} onChange={(e) => onChange({ status: e.target.value as Status })}
          className={`text-xs border rounded-lg px-2 py-1 ${STATUS_STYLE[r.status]}`}>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}
        </select>
      </div>

      <div>
        <span className={label}>Requirement ("shall")</span>
        <textarea rows={3} value={r.text} onChange={(e) => onChange({ text: e.target.value })} className={field} />
      </div>

      {r.sources.length > 0 && (
        <div>
          <span className={label}>Where it came from - what was said</span>
          <div className="space-y-2">
            {r.sources.map((q, i) => {
              const s = sources.find((x) => x.id === q.source);
              return (
                <div key={i} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                    <span className="font-mono">{q.source}</span>
                    <span>{s?.title}</span>
                    <span className="ml-auto">{mmss(q.at)}</span>
                    {s && (
                      <button onClick={() => onPlay({ source: s.id, at: q.at })}
                        className="px-2 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100">▶ Play from {mmss(q.at)}</button>
                    )}
                  </div>
                  <p className="text-sm text-slate-700 italic">“{q.quote}”</p>
                  {s && playing?.source === s.id && Math.abs(playing.at - q.at) < 0.01 && <Player src={audioUrl(s)} at={q.at} />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className={label}>Open questions</span>
          <button onClick={() => onChange({ openQuestions: [...r.openQuestions, ''] })} className="text-xs text-blue-600 hover:underline">+ Add</button>
        </div>
        {r.openQuestions.length === 0 && <p className="text-xs text-slate-400">None.</p>}
        <div className="space-y-1.5">
          {r.openQuestions.map((oq, i) => (
            <div key={i} className="flex gap-2">
              <input value={oq} onChange={(e) => onChange({ openQuestions: r.openQuestions.map((x, j) => (j === i ? e.target.value : x)) })}
                className={`${field} bg-orange-50/40`} placeholder="Question to answer before approval" />
              <button onClick={() => onChange({ openQuestions: r.openQuestions.filter((_, j) => j !== i) })}
                className="text-xs px-2 text-slate-500 hover:text-red-600" title="Answered - remove">✓</button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className={label}>Parent</span>
          <select value={r.parentId ?? ''} onChange={(e) => onChange({ parentId: e.target.value || null })} className={field} disabled={r.level === 'system'}>
            <option value="">— top level —</option>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.id} · {p.title}</option>)}
          </select>
        </div>
        <div>
          <span className={label}>Driver</span>
          <input value={r.driver} onChange={(e) => onChange({ driver: e.target.value })} className={field} />
        </div>
        <div>
          <span className={label}>Subsystem</span>
          <select value={r.subsystem} onChange={(e) => onChange({ subsystem: e.target.value })} className={field}>
            {SUBSYSTEMS.map((s) => <option key={s} value={s}>{s || 'system-wide'}</option>)}
          </select>
        </div>
        <div>
          <span className={label}>Variant</span>
          <select value={r.variant} onChange={(e) => onChange({ variant: e.target.value })} className={field}>
            {VARIANTS.map((v) => <option key={v} value={v}>{v === 'all' ? 'Both variants' : v}</option>)}
          </select>
        </div>
        <div>
          <span className={label}>Owner</span>
          <input value={r.owner} onChange={(e) => onChange({ owner: e.target.value })} className={field} />
        </div>
      </div>

      <div>
        <span className={label}>Rationale</span>
        <textarea rows={2} value={r.rationale} onChange={(e) => onChange({ rationale: e.target.value })} className={field} placeholder="Why this is needed" />
      </div>
      <div>
        <span className={label}>Notes</span>
        <textarea rows={2} value={r.notes} onChange={(e) => onChange({ notes: e.target.value })} className={field} />
      </div>

      <div className="flex gap-2 pt-2">
        {r.level !== 'component' && (
          <button onClick={onAddChild} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
            + Add {r.level === 'system' ? 'subsystem' : 'component'} requirement under it
          </button>
        )}
        {r.status !== 'obsolete' && (
          <button onClick={() => onChange({ status: 'obsolete' })} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:text-red-600">
            Mark obsolete{childCount ? ` (its ${childCount} below keep their parent)` : ''}
          </button>
        )}
      </div>
    </div>
  );
}

function Player({ src, at }: { src: string; at: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const go = () => { a.currentTime = at; void a.play().catch(() => {}); };
    if (a.readyState >= 1) go();
    else a.addEventListener('loadedmetadata', go, { once: true });
  }, [src, at]);
  return <audio ref={ref} src={src} controls preload="metadata" className="mt-2 w-full h-8" />;
}

function SourcesView({ sources, reqs, onPick }: { sources: Source[]; reqs: Requirement[]; playing: unknown; onPick: (id: string) => void }) {
  const refs = useRef<Record<string, HTMLAudioElement | null>>({});
  const [now, setNow] = useState<Record<string, number>>({});
  return (
    <div className="flex-1 overflow-auto bg-slate-50 p-6 space-y-6">
      {sources.map((s) => {
        const used = reqs.filter((r) => r.sources.some((q) => q.source === s.id));
        return (
          <div key={s.id} className="rounded-xl border border-slate-200 bg-white">
            <div className="p-4 border-b border-slate-100">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-mono">{s.id}</span><span>· {s.kind}</span><span>· {s.by}, {s.date}</span><span>· {mmss(s.duration)}</span>
                <span>· {s.file}</span>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mt-0.5">{s.title}</h3>
              <audio ref={(el) => { refs.current[s.id] = el; }} src={audioUrl(s)} controls preload="metadata" className="mt-2 w-full h-8"
                onTimeUpdate={(e) => setNow((n) => ({ ...n, [s.id]: (e.target as HTMLAudioElement).currentTime }))} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="text-xs text-slate-500">Requirements from it:</span>
                {used.map((r) => (
                  <button key={r.id} onClick={() => onPick(r.id)} className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-slate-200 hover:bg-blue-50 hover:border-blue-200">{r.id}</button>
                ))}
              </div>
            </div>
            <div className="p-2">
              {s.segments.map((g, i) => {
                const active = (now[s.id] ?? -1) >= g.start && (now[s.id] ?? -1) < g.end;
                return (
                  <button key={i} onClick={() => { const a = refs.current[s.id]; if (a) { a.currentTime = g.start; void a.play().catch(() => {}); } }}
                    className={`w-full text-left flex gap-3 px-2 py-1 rounded text-sm ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                    <span className="font-mono text-xs text-slate-400 pt-0.5 w-10 shrink-0">{mmss(g.start)}</span>
                    <span className="text-slate-700">{g.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="text-xs text-slate-400">Machine transcription (Whisper large-v3, run on this computer); click a line to play it.</p>
    </div>
  );
}
