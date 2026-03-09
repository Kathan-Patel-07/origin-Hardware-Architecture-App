
import { useState, useEffect, useRef } from 'react';
import { AssemblyConnectionStatus, AssemblyDeviation, AssemblyStatusFile, AssemblyFile, ComponentPlacementStatus } from '../services/github';

export interface AssemblyStateReturn {
  statuses: Record<string, AssemblyConnectionStatus>;
  placements: Record<string, ComponentPlacementStatus>;
  isDirty: boolean;
  markAssembled: (connectionId: string) => void;
  unmark: (connectionId: string) => void;
  logDeviation: (connectionId: string, deviation: AssemblyDeviation) => void;
  clearDeviation: (connectionId: string) => void;
  markPlaced: (nodeId: string) => void;
  unmarkPlaced: (nodeId: string) => void;
  reset: (file?: AssemblyStatusFile | AssemblyFile) => void;
  toAssemblyFile: (assemblyId: string) => AssemblyFile;
  toStatusFile: (branch: string) => AssemblyStatusFile; // kept for backward compat
}

export function useAssemblyState(initial?: AssemblyStatusFile): AssemblyStateReturn {
  const [statuses, setStatuses] = useState<Record<string, AssemblyConnectionStatus>>(
    initial?.connections ?? {}
  );
  const [placements, setPlacements] = useState<Record<string, ComponentPlacementStatus>>({});
  const [isDirty, setIsDirty] = useState(false);

  const prevInitialRef = useRef(initial);
  useEffect(() => {
    if (prevInitialRef.current !== initial) {
      prevInitialRef.current = initial;
      setStatuses(initial?.connections ?? {});
      setPlacements({});
      setIsDirty(false);
    }
  }, [initial]);

  const markAssembled = (connectionId: string) => {
    setStatuses((prev) => {
      const existing = prev[connectionId];
      if (existing?.status === 'assembled_with_deviation') return prev;
      return { ...prev, [connectionId]: { status: 'assembled', assembledAt: new Date().toISOString() } };
    });
    setIsDirty(true);
  };

  const unmark = (connectionId: string) => {
    setStatuses((prev) => { const next = { ...prev }; delete next[connectionId]; return next; });
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

  const markPlaced = (nodeId: string) => {
    setPlacements((prev) => ({
      ...prev,
      [nodeId]: { placed: true, placedAt: new Date().toISOString() },
    }));
    setIsDirty(true);
  };

  const unmarkPlaced = (nodeId: string) => {
    setPlacements((prev) => ({
      ...prev,
      [nodeId]: { placed: false },
    }));
    setIsDirty(true);
  };

  const reset = (file?: AssemblyStatusFile | AssemblyFile) => {
    if (!file) {
      setStatuses({});
      setPlacements({});
    } else if ('assemblyId' in file) {
      // New AssemblyFile format
      setStatuses(file.connections ?? {});
      setPlacements(file.components ?? {});
    } else {
      // Legacy AssemblyStatusFile
      setStatuses(file.connections ?? {});
      setPlacements({});
    }
    setIsDirty(false);
  };

  const toAssemblyFile = (assemblyId: string): AssemblyFile => ({
    assemblyId,
    updatedAt: new Date().toISOString(),
    connections: statuses,
    components: placements,
  });

  const toStatusFile = (branch: string): AssemblyStatusFile => ({
    branch,
    updatedAt: new Date().toISOString(),
    connections: statuses,
  });

  return { statuses, placements, isDirty, markAssembled, unmark, logDeviation, clearDeviation, markPlaced, unmarkPlaced, reset, toAssemblyFile, toStatusFile };
}
