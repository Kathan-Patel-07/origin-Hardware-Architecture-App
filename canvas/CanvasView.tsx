import { useCallback, useEffect, useMemo, useState } from 'react';
import CanvasApp, { type V4Editing } from './CanvasApp';
import { INITIAL_DATA } from './data/architecture';
import { bundledDataSource, devFileDataSource, type ArchitectureDataSource } from './dataSource';
import { loadV4Data, runOp, undoOp, v4Available, v4DataSource, v4Status, type V4Data, type V4Op } from './v4Source';

type Platform = 'v3' | 'v4';
const PLATFORM_KEY = 'canvas-platform';
const readPlatform = (): Platform => {
  try {
    return localStorage.getItem(PLATFORM_KEY) === 'v4' ? 'v4' : 'v3';
  } catch {
    return 'v3';
  }
};

/**
 * The architecture canvas as a Studio tab. Storage is chosen here and nowhere else:
 * the dev server's file store while developing, the bundled copy (read-only) in a
 * static build. Swap in a GitHub-API or backend source by passing `dataSource`.
 *
 * While developing with a checkout of the data repo's `v4` branch next to the app, a V3 / V4
 * switch appears: V3 is the frozen baseline drawing; on V4 the Canvas edits the architecture
 * data itself (PRD-v4 D9) and the drawing is rebuilt from it after every edit.
 */
export default function CanvasView({ dataSource }: { dataSource?: ArchitectureDataSource }) {
  // null until known: when V4 was the last platform, nothing is shown until then, so the V3
  // editor never mounts first (it would take the sheet link in the address with it).
  const [hasV4, setHasV4] = useState<boolean | null>(dataSource ? false : null);
  const [platform, setPlatformState] = useState<Platform>(readPlatform);
  const [v4Data, setV4Data] = useState<V4Data | null>(null);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  // Bumped after each V4 edit: the editor reloads the rebuilt drawing (sheet and edit mode kept).
  const [rev, setRev] = useState(0);
  const [focusPart, setFocusPart] = useState<{ subsystem: string; nodeId: string } | null>(null);

  useEffect(() => {
    if (!dataSource) void v4Available().then(setHasV4);
  }, [dataSource]);
  const onV4 = hasV4 === true && platform === 'v4';

  const refreshV4 = useCallback(async () => {
    const [d, st] = await Promise.all([loadV4Data(), v4Status()]);
    setV4Data(d);
    setUndoLabel(st.undo[st.undo.length - 1] ?? null);
  }, []);
  useEffect(() => {
    if (onV4) void refreshV4();
  }, [onV4, refreshV4]);

  const setPlatform = (p: Platform) => {
    try {
      localStorage.setItem(PLATFORM_KEY, p);
    } catch {
      /* remembered for this visit only */
    }
    setPlatformState(p);
  };

  const v4Source = useMemo(() => v4DataSource(), []);
  const source = useMemo(
    () => dataSource ?? (onV4 ? v4Source : import.meta.env.DEV ? devFileDataSource : bundledDataSource(INITIAL_DATA)),
    [dataSource, onV4, v4Source],
  );

  const v4: V4Editing | undefined = useMemo(() => {
    if (!onV4 || !v4Data) return undefined;
    const after = async () => {
      await refreshV4();
      setRev((r) => r + 1);
    };
    return {
      data: v4Data,
      run: async (op: V4Op) => {
        await runOp(op);
        setFocusPart(partOf(op));
        await after();
      },
      undo: undoLabel
        ? async () => {
            await undoOp();
            setFocusPart(null);
            await after();
          }
        : null,
      undoLabel,
    };
  }, [onV4, v4Data, undoLabel, refreshV4]);

  const platformSwitch = hasV4 ? (
    <span className="platform-switch" role="group" aria-label="Platform">
      {(['v3', 'v4'] as const).map((p) => (
        <button
          key={p}
          type="button"
          className={`btn${platform === p ? ' primary' : ''}`}
          aria-pressed={platform === p}
          title={p === 'v3' ? 'V3 — the frozen baseline' : 'V4 — edit the architecture (parts and connections)'}
          onClick={() => setPlatform(p)}
        >
          {p.toUpperCase()}
        </button>
      ))}
    </span>
  ) : undefined;

  if ((onV4 && !v4) || (hasV4 === null && platform === 'v4'))
    return (
      <div className="canvas-root app">
        <p className="muted" style={{ padding: 24 }}>Loading the V4 architecture…</p>
      </div>
    );
  // Keyed on the source: a different store starts a fresh editor (history, dirty flag and
  // save status all belong to one source) instead of saving one store's document into another.
  // On V4 also keyed on `rev`, so the editor reloads the drawing rebuilt by an edit.
  return (
    <CanvasApp
      key={`${sourceKey(source)}:${onV4 ? rev : 0}`}
      dataSource={source}
      v4={v4}
      platformSwitch={platformSwitch}
      initialEditMode={onV4 && rev > 0}
      focusPart={onV4 ? focusPart : null}
    />
  );
}

/** The part an edit was about, to show it afterwards; none for removals. */
function partOf(op: V4Op): { subsystem: string; nodeId: string } | null {
  switch (op.type) {
    case 'addPart':
    case 'editPart':
      return { subsystem: op.subsystem, nodeId: op.nodeId };
    case 'addConnection':
      return { subsystem: op.subsystem, nodeId: op.destination };
    case 'editConnection':
      return op.destination ? { subsystem: op.subsystem, nodeId: op.destination } : null;
    case 'batch':
      return op.ops.map(partOf).find(Boolean) ?? null;
    default:
      return null;
  }
}

const keys = new WeakMap<ArchitectureDataSource, number>();
let nextKey = 0;
function sourceKey(s: ArchitectureDataSource) {
  if (!keys.has(s)) keys.set(s, ++nextKey);
  return keys.get(s);
}
