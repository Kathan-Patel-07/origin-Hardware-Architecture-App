import { useMemo } from 'react';
import CanvasApp from './CanvasApp';
import { INITIAL_DATA } from './data/architecture';
import { bundledDataSource, devFileDataSource, type ArchitectureDataSource } from './dataSource';

/**
 * The architecture canvas as a Studio tab. Storage is chosen here and nowhere else:
 * the dev server's file store while developing, the bundled copy (read-only) in a
 * static build. Swap in a GitHub-API or backend source by passing `dataSource`.
 */
export default function CanvasView({ dataSource }: { dataSource?: ArchitectureDataSource }) {
  const source = useMemo(
    () => dataSource ?? (import.meta.env.DEV ? devFileDataSource : bundledDataSource(INITIAL_DATA)),
    [dataSource],
  );
  // Keyed on the source: a different store starts a fresh editor (history, dirty flag and
  // save status all belong to one source) instead of saving one store's document into another.
  return <CanvasApp key={sourceKey(source)} dataSource={source} />;
}

const keys = new WeakMap<ArchitectureDataSource, number>();
let nextKey = 0;
function sourceKey(s: ArchitectureDataSource) {
  if (!keys.has(s)) keys.set(s, ++nextKey);
  return keys.get(s);
}
