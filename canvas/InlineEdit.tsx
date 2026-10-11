import { useEffect, useRef, useState } from 'react';

/**
 * Text that turns into a text box when clicked (if `editable`).
 * Enter or clicking away saves; Esc cancels. An empty value is passed to
 * `onSave` too, so the caller can fall back to a default.
 */
export function InlineEdit({
  value,
  editable,
  onSave,
  className,
  label,
}: {
  value: string;
  editable: boolean;
  onSave: (v: string) => void;
  className?: string;
  /** What is being renamed, for the tooltip and screen readers. */
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set once this edit has been saved or cancelled, so a following blur is ignored.
  const finished = useRef(false);

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (save && draft.trim() !== value) onSave(draft);
  };

  // Ready to type straight away: focus the box with the whole name selected.
  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  if (!editing) {
    if (!editable) return <span className={className}>{value}</span>;
    return (
      <button
        type="button"
        className={`inline-edit ${className ?? ''}`}
        title={`Click to rename ${label}`}
        aria-label={`${value} — click to rename ${label}`}
        onClick={() => {
          setDraft(value);
          finished.current = false;
          setEditing(true);
        }}
      >
        {value}
        <span className="inline-edit-pencil" aria-hidden="true">
          ✎
        </span>
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      className={`inline-edit-input ${className ?? ''}`}
      aria-label={`Rename ${label}`}
      value={draft}
      size={Math.max(8, draft.length + 1)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}
