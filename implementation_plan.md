# Implementation Plan - Origin Architecture

## Phase 1: Foundation (Completed)
- [x] **Core Engine**: React + Vite + Mermaid.js for rendering.
- [x] **Data Ingestion**: CSV Parsing with error handling.
- [x] **Interactive Canvas**: Pan/Zoom/Export functionality.

## Phase 2: Engineering UX (Completed)
- [x] **Rebranding**: Transition to "Origin Architecture".
- [x] **Formal Schema**: Split `Wire_Definition` into `Wire_Spec` (Physical) and `Label` (Logical).
- [x] **Wire Visualization**: Toggle to overlay physical wire specs on the logical diagram.
- [x] **Sorting**: Table sort capabilities for managing large netlists.
- [x] **Documentation**: Engineering-grade manuals and context.

## Phase 3: Analysis & Validation (Completed)
- [x] **Load Summation**: Parse `Wire_Spec` to estimate max current capacity vs load requirements (Basic BOM implementation).
- [x] **Continuity Check**: Algorithm to detect disconnected nodes or floating grounds (Island detection).
- [x] **Harness Bill of Materials**: Generate a BOM of wire lengths and types based on the graph.

## Phase 4: Advanced Visuals (Completed)
- [x] **Dark Mode**: High contrast mode for CAD environments.
- [x] **Schematic Symbols**: Replace blocks with IEC/ISO standard symbols (Batteries as cylinders, Fuses as stadiums, etc).
- [ ] **Connector View**: (Deferred) - Requires expanded schema.

## Future Roadmap
- [ ] **Voltage Drop Calculator**: Requires `Length_mm` column.
- [ ] **Connector Pin Mapping**: Explicit Pin ID tracking.