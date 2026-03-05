
import { useState, useEffect, useRef } from 'react';
import { AssemblyConnectionStatus, AssemblyDeviation, AssemblyStatusFile } from '../services/github';

export interface AssemblyStateReturn {
  statuses: Record<string, AssemblyConnectionStatus>;
  isDirty: boolean;
  markAssembled: (connectionId: string) => void;
  unmark: (connectionId: string) => void;
  logDeviation: (connectionId: string, deviation: AssemblyDeviation) => void;
  clearDeviation: (connectionId: string) => void;
  reset: (file?: AssemblyStatusFile) => void;
  toStatusFile: (branch: string) => AssemblyStatusFile;
}

export function useAssemblyState(initial?: AssemblyStatusFile): AssemblyStateReturn {
  const [statuses, setStatuses] = useState<Record<string, AssemblyConnectionStatus>>(
    initial?.connections ?? {}
  );
  const [isDirty, setIsDirty] = useState(false);

  const prevInitialRef = useRef(initial);
  useEffect(() => {
    if (prevInitialRef.current !== initial) {
      prevInitialRef.current = initial;
      setStatuses(initial?.connections ?? {});
      setIsDirty(false);
    }
  }, [initial]);

  const markAssembled = (connectionId: string) => {
    setStatuses((prev) => {
      const existing = prev[connectionId];
      // Preserve deviation if already set
      if (existing?.status === 'assembled_with_deviation') return prev;
      return {
        ...prev,
        [connectionId]: { status: 'assembled', assembledAt: new Date().toISOString() },
      };
    });
    setIsDirty(true);
  };

  const unmark = (connectionId: string) => {
    setStatuses((prev) => {
      const next = { ...prev };
      delete next[connectionId];
      return next;
    });
    setIsDirty(true);
  };

  const logDeviation = (connectionId: string, deviation: AssemblyDeviation) => {
    setStatuses((prev) => ({
      ...prev,
      [connectionId]: {
        status: 'assembled_with_deviation',
        assembledAt: prev[connectionId]?.assembledAt ?? new Date().toISOString(),
        deviation,
      },
    }));
    setIsDirty(true);
  };

  const clearDeviation = (connectionId: string) => {
    setStatuses((prev) => ({
      ...prev,
      [connectionId]: { status: 'assembled', assembledAt: prev[connectionId]?.assembledAt },
    }));
    setIsDirty(true);
  };

  const reset = (file?: AssemblyStatusFile) => {
    setStatuses(file?.connections ?? {});
    setIsDirty(false);
  };

  const toStatusFile = (branch: string): AssemblyStatusFile => ({
    branch,
    updatedAt: new Date().toISOString(),
    connections: statuses,
  });

  return { statuses, isDirty, markAssembled, unmark, logDeviation, clearDeviation, reset, toStatusFile };
}
