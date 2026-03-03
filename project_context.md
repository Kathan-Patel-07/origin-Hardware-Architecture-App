# Origin Architecture - Project Context

## Product Philosophy
**Origin Architecture** is a specialized visualization studio for electrical, systems, and harness engineers. Unlike generic diagramming tools (Visio, Lucidchart) which are purely graphical, Origin is **data-driven**. 

It enforces a strict separation between:
1.  **Logical Architecture**: The functional connections (e.g., "Inverter powers the Motor").
2.  **Physical Realization**: The wiring specifications (e.g., "2x 0AWG Shielded Cable").
3.  **Spatial Layout**: The physical location of components (e.g., "Battery Box", "Cabin").

## Core Engineering Goals
The tool allows an engineer to "code" their architecture in a spreadsheet format and instantly see the system topology. This enables:
*   **Rapid Iteration**: Change a wire gauge in the table, and the diagram updates. No redrawing lines.
*   **Layered Analysis**: Switch instantly between Power, Communication, and Safety views to ensure no subsystem is neglected.
*   **Formal Specification**: By enforcing columns like `Wire_Spec`, we ensure every connection is physically feasible.

## Terminology
*   **Type**: The domain layer (Power, Comm, Safety, Ground).
*   **Functional_Group**: A logical cluster of components that perform a unified task (e.g., `Drive_System`, `Compute_Stack`).
*   **Wire_Spec**: The formal physical definition of the conductor (e.g., `2x 18AWG`).
*   **Label**: The signal name or voltage level (e.g., `48V`, `CAN High`).

## Future Roadmap (Contextual)
Future versions will include automated load calculations (summing current based on `Wire_Spec`), voltage drop analysis, and harness weight estimation.
