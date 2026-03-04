
import { useState, useEffect, useRef } from 'react';
import { ConnectionRowExtended } from '../utils/jsonToConnectionRows';

export interface ChangeLogEntry {
  subsystem: string;
  connectionId: string;
  field: string;
  oldValue: string;
  newValue: string;
  timestamp: Date;
}

export interface EditorStateReturn {
  currentData: ConnectionRowExtended[];
  isDirty: boolean;
  changedSubsystems: Set<string>;
  changeLog: ChangeLogEntry[];
  applyChange: (id: string, field: string, oldValue: string, newValue: string, subsystem: string) => void;
  deleteRow: (id: string, subsystem: string) => void;
  addRow: (subsystem: string, subsystemLabel?: string) => void;
  reset: (newData?: ConnectionRowExtended[]) => void;
}

export function useEditorState(initialData: ConnectionRowExtended[]): EditorStateReturn {
  const [currentData, setCurrentData] = useState<ConnectionRowExtended[]>(initialData);
  const [changeLog, setChangeLog] = useState<ChangeLogEntry[]>([]);

  // Reset everything when the initial data changes (new branch loaded)
  const prevInitialRef = useRef(initialData);
  useEffect(() => {
    if (prevInitialRef.current !== initialData) {
      prevInitialRef.current = initialData;
      setCurrentData(initialData);
      setChangeLog([]);
    }
  }, [initialData]);

  const isDirty = changeLog.length > 0;

  const changedSubsystems = new Set(
    changeLog.map((c) => c.subsystem).filter(Boolean)
  );

  const applyChange = (
    id: string,
    field: string,
    oldValue: string,
    newValue: string,
    subsystem: string
  ) => {
    if (oldValue === newValue) return;
    setCurrentData((prev) =>
      prev.map((row) =>
        row._connectionId === id ? { ...row, [field]: newValue } : row
      )
    );
    setChangeLog((prev) => [
      ...prev,
      { subsystem, connectionId: id, field, oldValue, newValue, timestamp: new Date() },
    ]);
  };

  const deleteRow = (id: string, subsystem: string) => {
    setCurrentData((prev) => prev.filter((row) => row._connectionId !== id));
    setChangeLog((prev) => [
      ...prev,
      {
        subsystem,
        connectionId: id,
        field: '__deleted__',
        oldValue: 'exists',
        newValue: 'deleted',
        timestamp: new Date(),
      },
    ]);
  };

  const addRow = (subsystem: string, subsystemLabel?: string) => {
    const newId = `${subsystem}-new-${Date.now()}`;
    const newRow: ConnectionRowExtended = {
      SourceComponent: '',
      DestinationComponent: '',
      ArchitectureType: 'Power',
      FunctionalWireName: '',
      WireSpecifications: '',
      FunctionalGroup: '',
      SourceComponentCompartment: '',
      DestinationComponentCompartment: '',
      Notes: '',
      _connectionId: newId,
      _subsystem: subsystem,
      _subsystemLabel: subsystemLabel,
      _flagged: true, // new rows start flagged (no datasheet/purchase link)
    };
    setCurrentData((prev) => [...prev, newRow]);
    setChangeLog((prev) => [
      ...prev,
      {
        subsystem,
        connectionId: newId,
        field: '__added__',
        oldValue: '',
        newValue: 'added',
        timestamp: new Date(),
      },
    ]);
  };

  const reset = (newData?: ConnectionRowExtended[]) => {
    const data = newData ?? initialData;
    prevInitialRef.current = data;
    setCurrentData(data);
    setChangeLog([]);
  };

  return {
    currentData,
    isDirty,
    changedSubsystems,
    changeLog,
    applyChange,
    deleteRow,
    addRow,
    reset,
  };
}
