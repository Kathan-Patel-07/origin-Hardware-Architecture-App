import { useState } from 'react';
import type { ArchNode, HarnessWire } from './data/architecture';
import { formatAmps, type BlockCurrent } from './currents';
import { Modal } from './EditDialogs';

/** "16 AWG · 830 mm" for a power wire, "1 Gb/s · 1330 mm" for a communication cable. */
export const wireLabel = (w: HarnessWire) =>
  [w.awg !== undefined ? `${w.awg} AWG` : '', w.speed ?? '', w.lengthMm !== undefined ? `${w.lengthMm} mm` : ''].filter(Boolean).join(' · ');

/**
 * "Current drawn" in the side panel: a load's own current (with where it comes from), or the sum
 * of the loads below a block. In Edit mode a load's current can be typed in or cleared; a block
 * without one then adds up its children again.
 */
export function CurrentSection({
  node,
  current,
  editable,
  onSet,
}: {
  node: ArchNode;
  current?: BlockCurrent;
  editable: boolean;
  onSet: (amps: number | undefined) => void;
}) {
  const [text, setText] = useState(node.current !== undefined ? String(node.current) : '');
  if (!current && !editable) return null;
  const typed = text.trim() === '' ? undefined : Number(text);
  const bad = typed !== undefined && !(Number.isFinite(typed) && typed >= 0);
  const changed = typed !== node.current;
  const save = () => {
    if (!bad && changed) onSet(typed);
  };

  return (
    <section>
      <h3>Current drawn</h3>
      {current ? (
        <p>
          <strong>{formatAmps(current.amps)}</strong>{' '}
          <span className="muted">
            {current.own ? '- this load' : `- sum of ${current.loads} load${current.loads === 1 ? '' : 's'} below it`}
          </span>
        </p>
      ) : (
        <p className="muted">No current entered on this block or below it.</p>
      )}
      {current?.own && node.currentNote && (
        <p className="muted" style={{ whiteSpace: 'pre-line' }}>{node.currentNote}</p>
      )}
      {editable && (
        <div className="current-edit">
          <label>
            Current (A){' '}
            <input
              type="number"
              min={0}
              step={0.1}
              value={text}
              placeholder={current && !current.own ? 'sum of children' : 'amps'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </label>
          <button className="btn" disabled={bad || !changed} onClick={save}>
            Set
          </button>
          {node.current !== undefined && (
            <button
              className="btn"
              onClick={() => {
                setText('');
                onSet(undefined);
              }}
            >
              Clear
            </button>
          )}
          <p className="muted" style={{ marginTop: 4 }}>
            Leave empty for a block that should add up the loads below it.
          </p>
        </div>
      )}
    </section>
  );
}

/** Right-click → "Edit current…": type a load's current (empty = add up the loads below it). */
export function CurrentDialog({
  node,
  current,
  onSave,
  onClose,
}: {
  node: ArchNode;
  current?: BlockCurrent;
  onSave: (amps: number | undefined) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(node.current !== undefined ? String(node.current) : '');
  const typed = text.trim() === '' ? undefined : Number(text);
  const bad = typed !== undefined && !(Number.isFinite(typed) && typed >= 0);
  return (
    <Modal title={`Current - ${node.label}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!bad) onSave(typed);
        }}
      >
        <label className="field">
          <span>Current drawn (A)</span>
          <input
            autoFocus
            type="number"
            min={0}
            step={0.1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={current && !current.own ? `empty = sum of children (${formatAmps(current.amps)})` : 'amps'}
          />
        </label>
        {node.currentNote && <p className="note" style={{ whiteSpace: 'pre-line' }}>{node.currentNote}</p>}
        <p className="note">
          {bad ? 'Enter a number of amps, 0 or more.' : 'Leave empty for a block that should add up the loads below it. The blocks above update as soon as you save.'}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={bad}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Right-click an AWG / length tag → edit gauge (power) or speed (communication) and length. */
export function WireDialog({
  title,
  wire,
  onSave,
  onClose,
}: {
  title: string;
  wire?: HarnessWire;
  onSave: (wire: { awg?: number; speed?: string; lengthMm?: number } | undefined) => void;
  onClose: () => void;
}) {
  const [awg, setAwg] = useState(wire?.awg !== undefined ? String(wire.awg) : '');
  const [speed, setSpeed] = useState(wire?.speed ?? '');
  const [len, setLen] = useState(wire?.lengthMm !== undefined ? String(wire.lengthMm) : '');
  const empty = awg.trim() === '' && speed.trim() === '' && len.trim() === '';
  const a = Number(awg);
  const l = Number(len);
  const awgOk = awg.trim() === '' || (Number.isInteger(a) && a >= 0 && a <= 40);
  const lenOk = len.trim() === '' || (Number.isFinite(l) && l > 0);
  const bad = !empty && !(awgOk && lenOk && (awg.trim() !== '' || speed.trim() !== ''));
  return (
    <Modal title={`Wire / cable - ${title}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (bad) return;
          onSave(
            empty
              ? undefined
              : {
                  ...(awg.trim() !== '' ? { awg: a } : {}),
                  ...(speed.trim() !== '' ? { speed: speed.trim() } : {}),
                  ...(len.trim() !== '' ? { lengthMm: Math.round(l) } : {}),
                },
          );
        }}
      >
        <label className="field">
          <span>Gauge (AWG) - power wires</span>
          <input autoFocus type="number" min={0} max={40} step={1} value={awg} onChange={(e) => setAwg(e.target.value)} placeholder="e.g. 16" />
        </label>
        <label className="field">
          <span>Speed - communication cables</span>
          <input value={speed} onChange={(e) => setSpeed(e.target.value)} placeholder="e.g. 1 Gb/s" />
        </label>
        <label className="field">
          <span>Length (mm)</span>
          <input type="number" min={1} step={1} value={len} onChange={(e) => setLen(e.target.value)} placeholder="e.g. 830" />
        </label>
        {wire?.note && <p className="note" style={{ whiteSpace: 'pre-line' }}>{wire.note}</p>}
        <p className="note">
          {bad ? 'Enter a gauge (whole AWG 0-40) or a speed; the length (mm) is optional.' : 'Leave everything empty to remove the tag.'}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={bad}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
