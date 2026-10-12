import { useEffect, useMemo, useRef, useState } from 'react';
import { HARNESS_TYPE_COLORS } from './data/architecture';
import { Modal } from './EditDialogs';
import { ARCH_TYPES, type ArchType, type V4Connection, type V4Data, type V4Op, type V4TrackerPart } from './v4Source';

// Forms for V4 edits (PRD-v4 D9): each one sends an operation on the architecture data; the
// drawing is rebuilt from the data afterwards. A refusal (unknown part, duplicate name …) is
// shown in the form, which stays open.

const TYPE_COLOR: Record<ArchType, string> = {
  Power: HARNESS_TYPE_COLORS.power,
  Comm: HARNESS_TYPE_COLORS.communication,
  Safety: HARNESS_TYPE_COLORS.safety,
  Ground: HARNESS_TYPE_COLORS.ground,
};

type Submit = (op: V4Op) => Promise<void>;

function useSubmit(submit: Submit, onClose: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (op: V4Op) => {
    setBusy(true);
    setError(null);
    try {
      await submit(op);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, send };
}

const trackerLabel = (t: V4TrackerPart) => [t.ipn, t.mpn, t.description && t.description !== t.mpn ? t.description : ''].filter(Boolean).join(' · ');

/** Part chooser: a Design Tracker part (IPN/MPN), an existing catalog part, or a new part name. */
function PartPicker({ data, value, onChange }: { data: V4Data; value: string; onChange: (v: string) => void }) {
  const id = useMemo(() => `parts-${Math.random().toString(36).slice(2)}`, []);
  return (
    <label className="field">
      <span>Part (Design Tracker IPN / MPN, or a new part name)</span>
      <input list={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Type to search, e.g. OTS-000025 or Livox" />
      <datalist id={id}>
        {[...new Set(data.tracker.map(trackerLabel))].map((label) => (
          <option key={`t:${label}`} value={label} />
        ))}
        {data.catalog.map((c) => (
          <option key={`c:${c.partId}`} value={`catalog: ${c.partId}`} label={c.partName} />
        ))}
      </datalist>
      <small className="muted">A name that is not in the list becomes a new catalog part, flagged “IPN needed”.</small>
    </label>
  );
}

/** What the picker text means, as op fields. */
function partFields(data: V4Data, text: string): Pick<Extract<V4Op, { type: 'addPart' }>, 'catalogRef' | 'tracker' | 'newPartName'> {
  const t = text.trim();
  if (!t) return {};
  if (t.startsWith('catalog: ')) return { catalogRef: t.slice('catalog: '.length).trim() };
  const tr = data.tracker.find((x) => trackerLabel(x) === t);
  if (tr) return { tracker: { ipn: tr.ipn, mpn: tr.mpn, description: tr.description } };
  return { newPartName: t };
}

function NodeInput({ data, subsystem, label, value, onChange, autoFocus }: {
  data: V4Data; subsystem: string; label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean;
}) {
  const id = useMemo(() => `nodes-${Math.random().toString(36).slice(2)}`, []);
  const known = data.nodes[subsystem]?.some((n) => n.nodeId === value);
  return (
    <label className="field">
      <span>{label}</span>
      <input list={id} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} placeholder="Type to search the parts" />
      <datalist id={id}>
        {(data.nodes[subsystem] ?? []).map((n, i) => (
          <option key={`${i}:${n.nodeId}`} value={n.nodeId} label={n.catalogRef || 'no catalog part'} />
        ))}
      </datalist>
      {value && !known && <small className="muted">Not a part of {data.subsystemLabels[subsystem] ?? subsystem} yet.</small>}
    </label>
  );
}

function TypePicker({ value, onChange }: { value: ArchType; onChange: (t: ArchType) => void }) {
  return (
    <div className="field">
      <span>Type</span>
      <div className="type-picks" role="radiogroup" aria-label="Connection type">
        {ARCH_TYPES.map((t) => (
          <label key={t} className={`type-pick${value === t ? ' on' : ''}`} style={{ borderColor: TYPE_COLOR[t] }}>
            <input type="radio" name="arch-type" checked={value === t} onChange={() => onChange(t)} />
            <span className="type-dot" style={{ background: TYPE_COLOR[t] }} />
            {t}
          </label>
        ))}
      </div>
    </div>
  );
}

function suggestions(data: V4Data, subsystem: string, key: 'wireName' | 'functionalGroup' | 'wireSpec', type?: ArchType) {
  const all = (data.connections[subsystem] ?? []).filter((c) => !type || c.architectureType === type).map((c) => c[key]).filter(Boolean);
  return [...new Set(all)].sort();
}

/** Wire name, spec, group and harness: shared by "Connect" and "Add part". */
function WireFields({ data, subsystem, type, f, set }: {
  data: V4Data; subsystem: string; type: ArchType;
  f: { wireName: string; wireSpec: string; functionalGroup: string; harness: string };
  set: (k: 'wireName' | 'wireSpec' | 'functionalGroup' | 'harness', v: string) => void;
}) {
  const ids = useMemo(() => Math.random().toString(36).slice(2), []);
  const harnesses = data.harnesses?.subsystem === subsystem ? data.harnesses.list : null;
  return (
    <>
      <label className="field">
        <span>Wire / net name</span>
        <input list={`wn-${ids}`} value={f.wireName} onChange={(e) => set('wireName', e.target.value)} placeholder="e.g. 12V_PlannerLogic, Comm_Ethernet" />
        <datalist id={`wn-${ids}`}>{suggestions(data, subsystem, 'wireName', type).map((w) => <option key={w} value={w} />)}</datalist>
      </label>
      <label className="field">
        <span>Wire spec (optional)</span>
        <input list={`ws-${ids}`} value={f.wireSpec} onChange={(e) => set('wireSpec', e.target.value)} placeholder="e.g. 18AWG x 2, Cat6" />
        <datalist id={`ws-${ids}`}>{suggestions(data, subsystem, 'wireSpec').map((w) => <option key={w} value={w} />)}</datalist>
      </label>
      <label className="field">
        <span>Functional group (optional)</span>
        <input list={`fg-${ids}`} value={f.functionalGroup} onChange={(e) => set('functionalGroup', e.target.value)} />
        <datalist id={`fg-${ids}`}>{suggestions(data, subsystem, 'functionalGroup').map((w) => <option key={w} value={w} />)}</datalist>
      </label>
      {harnesses && (
        <label className="field">
          <span>Runs in harness</span>
          <select value={f.harness} onChange={(e) => set('harness', e.target.value)}>
            <option value="">— not in a harness yet —</option>
            {harnesses.map((h) => (
              <option key={h.key} value={h.key}>
                {h.key} · {h.name}
              </option>
            ))}
          </select>
          {f.harness && <small className="muted">{harnesses.find((h) => h.key === f.harness)?.what}</small>}
        </label>
      )}
    </>
  );
}

export function AddPartDialog({ data, subsystem: initialSub, connectTo, submit, onClose }: {
  data: V4Data; subsystem: string; connectTo?: string; submit: Submit; onClose: () => void;
}) {
  const { error, busy, send } = useSubmit(submit, onClose);
  const [subsystem, setSubsystem] = useState(data.subsystems.includes(initialSub) ? initialSub : data.subsystems[0]);
  const [nodeId, setNodeId] = useState('');
  const [part, setPart] = useState('');
  const [compartment, setCompartment] = useState('');
  const [other, setOther] = useState(connectTo ?? '');
  const [fedBy, setFedBy] = useState(true);
  const [type, setType] = useState<ArchType>('Power');
  const [wire, setWire] = useState({ wireName: '', wireSpec: '', functionalGroup: '', harness: '' });
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);
  const connect = other.trim() !== '';
  const valid = nodeId.trim() !== '' && (!connect || wire.wireName.trim() !== '');
  return (
    <Modal title="Add part" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          const id = nodeId.trim();
          const add: V4Op = { type: 'addPart', subsystem, nodeId: id, compartment: compartment.trim(), ...partFields(data, part) };
          if (!connect) return void send(add);
          const [source, destination] = fedBy ? [other.trim(), id] : [id, other.trim()];
          void send({ type: 'batch', ops: [add, { type: 'addConnection', subsystem, source, destination, architectureType: type,
            wireName: wire.wireName.trim(), wireSpec: wire.wireSpec.trim(), functionalGroup: wire.functionalGroup.trim(), harness: wire.harness || undefined }] });
        }}
      >
        {error && <p className="note error">{error}</p>}
        <label className="field">
          <span>Subsystem</span>
          <select value={subsystem} onChange={(e) => setSubsystem(e.target.value)}>
            {data.subsystems.map((s) => (
              <option key={s} value={s}>{data.subsystemLabels[s] ?? s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Name on the diagram (node id — cannot be changed later)</span>
          <input ref={nameRef} value={nodeId} onChange={(e) => setNodeId(e.target.value)} placeholder="e.g. RearLidar" />
        </label>
        <PartPicker data={data} value={part} onChange={setPart} />
        <label className="field">
          <span>Compartment (optional)</span>
          <input value={compartment} onChange={(e) => setCompartment(e.target.value)} placeholder="e.g. Main Enclosure" />
        </label>
        <p className="note">A part is drawn once it has a connection. Give its first one here, or connect it later.</p>
        <NodeInput data={data} subsystem={subsystem} label={fedBy ? 'Fed by / connected from' : 'Feeds / connects to'} value={other} onChange={setOther} />
        {connect && (
          <>
            <label className="field">
              <span>Direction</span>
              <select value={fedBy ? 'in' : 'out'} onChange={(e) => setFedBy(e.target.value === 'in')}>
                <option value="in">{other || 'that part'} → {nodeId || 'new part'}</option>
                <option value="out">{nodeId || 'new part'} → {other || 'that part'}</option>
              </select>
            </label>
            <TypePicker value={type} onChange={setType} />
            <WireFields data={data} subsystem={subsystem} type={type} f={wire} set={(k, v) => setWire((w) => ({ ...w, [k]: v }))} />
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!valid || busy}>{busy ? 'Adding…' : connect ? 'Add part + connection' : 'Add part'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ConnectionDialog({ data, subsystem, connection, source: initialSource, submit, onClose }: {
  data: V4Data; subsystem: string; connection?: V4Connection; source?: string; submit: Submit; onClose: () => void;
}) {
  const { error, busy, send } = useSubmit(submit, onClose);
  const [source, setSource] = useState(connection?.source ?? initialSource ?? '');
  const [destination, setDestination] = useState(connection?.destination ?? '');
  const [type, setType] = useState<ArchType>((connection?.architectureType || 'Power') as ArchType);
  const [wire, setWire] = useState({
    wireName: connection?.wireName ?? '', wireSpec: connection?.wireSpec ?? '', functionalGroup: connection?.functionalGroup ?? '',
    harness: (connection && data.harnesses?.byConnection[connection.id]) || '',
  });
  const [notes, setNotes] = useState(connection?.notes ?? '');
  const valid = source.trim() && destination.trim() && wire.wireName.trim();
  return (
    <Modal title={connection ? 'Edit connection' : `Connect — ${data.subsystemLabels[subsystem] ?? subsystem}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          const fields = { source: source.trim(), destination: destination.trim(), architectureType: type, wireName: wire.wireName.trim(),
            wireSpec: wire.wireSpec.trim(), functionalGroup: wire.functionalGroup.trim(), notes: notes.trim() };
          void send(connection
            ? { type: 'editConnection', subsystem, id: connection.id, ...fields, harness: data.harnesses?.subsystem === subsystem ? wire.harness : undefined }
            : { type: 'addConnection', subsystem, ...fields, harness: wire.harness || undefined });
        }}
      >
        {error && <p className="note error">{error}</p>}
        <NodeInput data={data} subsystem={subsystem} label="From (source)" value={source} onChange={setSource} autoFocus={!initialSource} />
        <NodeInput data={data} subsystem={subsystem} label="To (destination)" value={destination} onChange={setDestination} autoFocus={Boolean(initialSource)} />
        <TypePicker value={type} onChange={setType} />
        <WireFields data={data} subsystem={subsystem} type={type} f={wire} set={(k, v) => setWire((w) => ({ ...w, [k]: v }))} />
        <label className="field">
          <span>Notes (optional)</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="modal-actions">
          {connection && (
            <button type="button" className="btn danger" style={{ marginRight: 'auto' }} disabled={busy}
              onClick={() => window.confirm(`Remove ${connection.source} → ${connection.destination} (${connection.wireName})?`) &&
                void send({ type: 'removeConnection', subsystem, id: connection.id })}>
              Remove
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!valid || busy}>{busy ? 'Saving…' : connection ? 'Save' : 'Connect'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** One part: its catalog part and compartment, and every connection it has. */
export function PartDialog({ data, subsystem, nodeId, submit, onEditConnection, onClose }: {
  data: V4Data; subsystem: string; nodeId: string; submit: Submit; onEditConnection: (c: V4Connection) => void; onClose: () => void;
}) {
  const { error, busy, send } = useSubmit(submit, onClose);
  const node = data.nodes[subsystem]?.find((n) => n.nodeId === nodeId);
  const [part, setPart] = useState(node?.catalogRef ? `catalog: ${node.catalogRef}` : '');
  const [compartment, setCompartment] = useState(node?.compartment ?? '');
  const conns = (data.connections[subsystem] ?? []).filter((c) => c.source === nodeId || c.destination === nodeId);
  if (!node) return null;
  return (
    <Modal title={`Part — ${nodeId}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const pf = partFields(data, part);
          void send({ type: 'editPart', subsystem, nodeId, compartment: compartment.trim(), ...(part.trim() ? pf : { catalogRef: '' }) });
        }}
      >
        {error && <p className="note error">{error}</p>}
        <PartPicker data={data} value={part} onChange={setPart} />
        <label className="field">
          <span>Compartment</span>
          <input value={compartment} onChange={(e) => setCompartment(e.target.value)} />
        </label>
        <div className="field">
          <span>Connections ({conns.length})</span>
          <ConnectionList conns={conns} data={data} onEdit={onEditConnection} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn danger" style={{ marginRight: 'auto' }} disabled={busy}
            onClick={() => window.confirm(`Remove ${nodeId}${conns.length ? ` and its ${conns.length} connection(s)` : ''}?`) &&
              void send({ type: 'removePart', subsystem, nodeId })}>
            Remove part
          </button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ConnectionList({ conns, data, onEdit }: { conns: V4Connection[]; data: V4Data; onEdit: (c: V4Connection) => void }) {
  if (!conns.length) return <p className="muted">None yet.</p>;
  return (
    <div className="pick-list">
      {conns.map((c) => (
        <button key={c.id} type="button" className="pick-item" onClick={() => onEdit(c)} title="Edit this connection">
          <span className="pick-kind" style={{ color: TYPE_COLOR[c.architectureType as ArchType] ?? undefined }}>{c.architectureType || 'untyped'}</span>
          <span>
            {c.source} → {c.destination} · {c.wireName || '(no name)'}
            {data.harnesses?.byConnection[c.id] ? ` · ${data.harnesses.byConnection[c.id]}` : ''}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The architecture connections a drawn line stands for (all those between its end parts). */
export function LineDialog({ data, subsystem, conns, title, onEdit, onClose }: {
  data: V4Data; subsystem: string; conns: V4Connection[]; title: string; onEdit: (c: V4Connection) => void; onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted" style={{ marginBottom: 12 }}>{data.subsystemLabels[subsystem] ?? subsystem}: click a connection to edit or remove it.</p>
      <ConnectionList conns={conns} data={data} onEdit={onEdit} />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
