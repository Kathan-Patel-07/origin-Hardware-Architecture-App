import { useEffect, useRef, useState } from 'react';
import { HARNESS_TYPE_COLORS, HARNESS_TYPES, type HarnessType } from './data/architecture';
import type { FilterMode } from './harness';

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * "Harness type ▾" dropdown in the top bar: tick types to highlight the
 * harnesses carrying them (the rest are dimmed), with an Any/All switch.
 */
export function HarnessTypeFilter({
  types,
  mode,
  matched,
  total,
  onToggle,
  onMode,
  onClear,
}: {
  types: HarnessType[];
  mode: FilterMode;
  matched: number;
  total: number;
  onToggle: (t: HarnessType) => void;
  onMode: (m: FilterMode) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on a press outside the dropdown (capture phase: the diagram canvas
  // stops mouse-down events from bubbling) or on Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = types.length > 0;
  return (
    <div className="type-filter" ref={ref}>
      <button
        className={`btn type-filter-button${active ? ' active' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Highlight harnesses by type"
      >
        <span>Harness type</span>
        {active && (
          <span className="type-filter-summary">
            {types.map((t) => (
              <span key={t} className="type-dot" style={{ background: HARNESS_TYPE_COLORS[t] }} />
            ))}
            {types.length === 1 ? capitalize(types[0]) : `${types.length} types · ${capitalize(mode)}`}
          </span>
        )}
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="type-filter-panel" role="group" aria-label="Filter harnesses by type">
          {HARNESS_TYPES.map((t) => {
            const on = types.includes(t);
            return (
              <label key={t} className={`type-filter-option${on ? ' on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => onToggle(t)} />
                <span className="type-dot" style={{ background: HARNESS_TYPE_COLORS[t] }} />
                {capitalize(t)}
              </label>
            );
          })}

          {types.length > 1 && (
            <div className="type-filter-mode">
              <span className="muted">Match</span>
              <span className="filter-mode" role="radiogroup" aria-label="Match">
                {(['any', 'all'] as const).map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={mode === m}
                    className={mode === m ? 'on' : ''}
                    onClick={() => onMode(m)}
                    title={m === 'any' ? 'Harnesses carrying any of the ticked types' : 'Harnesses carrying all ticked types'}
                  >
                    {capitalize(m)}
                  </button>
                ))}
              </span>
            </div>
          )}

          <div className="type-filter-footer">
            <span className="muted">{active ? `${matched} of ${total} harnesses highlighted` : 'Tick types to highlight harnesses'}</span>
            {active && (
              <button className="link" onClick={onClear}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
