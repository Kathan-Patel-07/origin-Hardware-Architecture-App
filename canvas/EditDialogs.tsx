import { useEffect, useMemo, useRef, useState } from 'react';
import {
  HARNESS_TYPE_COLORS,
  HARNESS_TYPES,
  LINK_COLORS,
  LINK_KINDS,
  NODE_KINDS,
  type ArchNode,
  type Harness,
  type HarnessType,
  type LinkKind,
  type NodeKind,
} from './data/architecture';
import { harnessDisplayName } from './harness';
import { BLOCK_SHAPES, type BlockShape } from './shapes';
import type { BlockFields, LinkFields } from './useArchitecture';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Small drawing of a block shape for the shape picker. */
function ShapeIcon({ shape }: { shape: BlockShape }) {
  return (
    <svg width="34" height="22" viewBox="0 0 34 22" aria-hidden="true" className="shape-icon">
      {shape === 'rectangle' && <rect x="2" y="3" width="30" height="16" rx="3" />}
      {shape === 'oval' && <ellipse cx="17" cy="11" rx="15" ry="8" />}
      {shape === 'diamond' && <polygon points="17,1.5 32.5,11 17,20.5 1.5,11" />}
      {shape === 'circle' && <circle cx="17" cy="11" r="9.5" />}
    </svg>
  );
}

/** Form for the block fields: system type, shape, heading and description. */
export function BlockEditor({
  title,
  initial,
  onSave,
  onClose,
}: {
  title: string;
  initial: BlockFields;
  onSave: (fields: BlockFields) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<NodeKind>(initial.kind);
  const [shape, setShape] = useState<BlockShape>(initial.shape);
  const [label, setLabel] = useState(initial.label);
  const [summary, setSummary] = useState(initial.summary);
  const headingRef = useRef<HTMLInputElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  const valid = label.trim().length > 0;
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave({ kind, shape, label: label.trim(), summary: summary.trim() });
        }}
      >
        <label className="field">
          <span>System type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as NodeKind)}>
            {NODE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Shape</span>
          <div className="shape-picks" role="radiogroup" aria-label="Block shape">
            {BLOCK_SHAPES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={shape === s}
                className={`shape-pick${shape === s ? ' on' : ''}`}
                onClick={() => setShape(s)}
              >
                <ShapeIcon shape={s} />
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Heading</span>
          <input ref={headingRef} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Battery Box" />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
            placeholder="What this block does — shown inside the box"
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!valid}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Pick a parent for `node` from every block that wouldn't create a loop. */
export function ParentPicker({
  node,
  candidates,
  onPick,
  onClose,
}: {
  node: ArchNode;
  candidates: ArchNode[];
  onPick: (parentId: string | undefined) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates.filter((c) => !q || c.label.toLowerCase().includes(q) || c.kind.includes(q));
  }, [candidates, query]);

  return (
    <Modal title={`Link “${node.label}” to a parent`} onClose={onClose}>
      <input
        className="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search blocks…"
      />
      <div className="pick-list">
        <button className={`pick-item${!node.parent ? ' current' : ''}`} onClick={() => onPick(undefined)}>
          <span className="pick-kind">none</span>
          <span>No parent — this block is a parent</span>
        </button>
        {shown.map((c) => (
          <button
            key={c.id}
            className={`pick-item${node.parent === c.id ? ' current' : ''}`}
            onClick={() => onPick(c.id)}
          >
            <span className="pick-kind">{c.kind}</span>
            <span>{c.label}</span>
          </button>
        ))}
        {shown.length === 0 && <p className="muted">No matching blocks.</p>}
      </div>
    </Modal>
  );
}

/**
 * Draw a connection between two blocks on the same sheet. With `fixedKind`
 * (e.g. the top-bar "Add mechanical") the type is fixed and only the name is asked.
 */
export function ConnectDialog({
  blocks,
  initialFrom,
  fixedKind,
  onSave,
  onClose,
}: {
  blocks: ArchNode[];
  initialFrom?: string;
  fixedKind?: LinkKind;
  onSave: (from: string, fields: LinkFields) => void;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(initialFrom && blocks.some((b) => b.id === initialFrom) ? initialFrom : (blocks[0]?.id ?? ''));
  const targets = blocks.filter((b) => b.id !== from);
  const [targetState, setTarget] = useState(targets[0]?.id ?? '');
  // If the chosen "from" block was the target, fall back to the first valid target.
  const target = targetState && targetState !== from ? targetState : (targets[0]?.id ?? '');
  const [kind, setKind] = useState<LinkKind>(fixedKind ?? 'power');
  const [label, setLabel] = useState('');
  const fromBlock = blocks.find((b) => b.id === from);
  const title = fixedKind
    ? `Add ${fixedKind} connection`
    : initialFrom && fromBlock
      ? `Connect “${fromBlock.label}” to…`
      : 'Add connection';

  return (
    <Modal title={title} onClose={onClose}>
      {!from || targets.length === 0 ? (
        <>
          <p className="muted">A connection needs at least two blocks on this sheet.</p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (target) onSave(from, { target, kind, label: label.trim() });
          }}
        >
          <label className="field">
            <span>From block</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)} autoFocus={!initialFrom}>
              {blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>To block</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} autoFocus={!!initialFrom}>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {!fixedKind && (
            <label className="field">
              <span>Connection type</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as LinkKind)}
                style={{ borderLeft: `4px solid ${LINK_COLORS[kind]}` }}
              >
                {LINK_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>{fixedKind ? 'Name' : 'Label'}</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={fixedKind === 'mechanical' ? 'e.g. Mounts on, Bolted to, Docks into' : 'e.g. 48V, CAN FD, Ethernet'}
            />
            <small className="muted">Shown in the middle of the connection line.</small>
          </label>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              Connect
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Checkboxes for the signal types a harness carries (at least one). */
function HarnessTypePicker({
  value,
  onChange,
  disabled,
}: {
  value: HarnessType[];
  onChange?: (v: HarnessType[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="type-picks">
      {HARNESS_TYPES.map((t) => (
        <label key={t} className={`type-pick${value.includes(t) ? ' on' : ''}`} style={{ borderColor: HARNESS_TYPE_COLORS[t] }}>
          <input
            type="checkbox"
            checked={value.includes(t)}
            disabled={disabled}
            onChange={(e) => onChange?.(e.target.checked ? HARNESS_TYPES.filter((x) => x === t || value.includes(x)) : value.filter((x) => x !== t))}
          />
          <span className="type-dot" style={{ background: HARNESS_TYPE_COLORS[t] }} />
          {t}
        </label>
      ))}
    </div>
  );
}

/** Rename a harness and change the types it carries. */
export function HarnessEditDialog({
  harness,
  onSave,
  onClose,
}: {
  harness: Harness;
  onSave: (name: string, types: HarnessType[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(harness.name);
  const [types, setTypes] = useState<HarnessType[]>(harness.types);
  return (
    <Modal title={`Edit harness “${harnessDisplayName(harness)}”`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(name, types);
        }}
      >
        <label className="field">
          <span>Harness name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. H-MOMA-PWR-01" />
        </label>
        <div className="field">
          <span>Harness type</span>
          <HarnessTypePicker value={types} onChange={setTypes} />
        </div>
        <p className="note">The name applies to the whole harness, including all its branches.</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Yes / No confirmation. "No" has focus, so Enter or Esc cancels. */
export function ConfirmDialog({
  title,
  message,
  yesLabel = 'Yes',
  noLabel = 'No',
  onYes,
  onNo,
}: {
  title: string;
  message: React.ReactNode;
  yesLabel?: string;
  noLabel?: string;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <Modal title={title} onClose={onNo}>
      <div className="confirm-message">{message}</div>
      <div className="modal-actions">
        <button type="button" className="btn" autoFocus onClick={onNo}>
          {noLabel}
        </button>
        <button type="button" className="btn primary" onClick={onYes}>
          {yesLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Ask for a single name, e.g. right after drawing a harness or mechanical connection. */
export function NamePrompt({
  title,
  label,
  initial = '',
  placeholder,
  note,
  onSave,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  note?: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(name.trim());
        }}
      >
        <label className="field">
          <span>{label}</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} />
        </label>
        {note && <p className="note">{note}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {initial ? 'Cancel' : 'Skip for now'}
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** Shows a tick box; used for on/off options such as harness types. */
  checked?: boolean;
  /** Leave the menu open after clicking (to toggle several options). */
  keepOpen?: boolean;
  /** Colour dot shown before the label. */
  color?: string;
  /** Draw a divider above this item. */
  divider?: boolean;
}

/** Right-click menu, positioned at the cursor and kept inside the window. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
    // Close on any press outside the menu. Listen in the capture phase: the
    // diagram canvas stops mouse-down events from bubbling up to the window.
    const closeOutside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', closeOutside, true);
    window.addEventListener('wheel', closeOutside, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true);
      window.removeEventListener('wheel', closeOutside, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [x, y, onClose]);

  return (
    <div ref={ref} className="context-menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((it) => (
        <button
          key={it.label}
          className={`menu-item${it.danger ? ' danger' : ''}${it.divider ? ' divider' : ''}`}
          role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
          aria-checked={it.checked}
          onClick={() => {
            if (!it.keepOpen) onClose();
            it.onClick();
          }}
        >
          {it.checked !== undefined && <span className={`menu-check${it.checked ? ' on' : ''}`}>{it.checked ? '✓' : ''}</span>}
          {it.color && <span className="type-dot" style={{ background: it.color }} />}
          {it.label}
        </button>
      ))}
    </div>
  );
}
