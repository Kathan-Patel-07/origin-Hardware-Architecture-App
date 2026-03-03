
# Origin Architecture - Data Schema

The application relies on a strict CSV structure to generate diagrams.

## Column Definitions

| Column | Required | Description | Example |
| :--- | :---: | :--- | :--- |
| **Source Component** | Yes | ID of the originating component. Spaces are auto-converted to underscores. | `Battery_Pack` |
| **Source Component Part Name** | No | Real-world part number or commercial name. | `Amphenol SurLok Plus` |
| **Source Component Datasheet Link** | No | URL to PDF or product page. Makes the node clickable. | `https://mouser.com/...` |
| **Destination Component** | Yes | ID of the receiving component. | `Inverter` |
| **Architecture Type** | Yes | System Layer. Must be one of: `Power`, `Comm`, `Safety`, `Ground`. | `Power` |
| **FunctionalWireName** | Yes | **Logical Signal Name**. What is the signal/voltage? | `48V`, `CAN High`, `12V Acc` |
| **WireSpecifications** | No | **Physical Construction**. Formal notation: `[Cores]x [Gauge]AWG`. | `2x 0AWG`, `1x 18AWG`, `Twisted Pair` |
| **FunctionalGroup** | Yes | **Logical Cluster**. Subsystem grouping for the diagram. | `Drive_System`, `ADAS_Compute` |
| **SourceComponentCompartment** | No | **Physical Zone**. Used only in Spatial View. | `Engine_Bay`, `Cabin_Floor` |
| **DestinationComponentCompartment** | No | **Physical Zone**. Used only in Spatial View. | `Engine_Bay`, `Cabin_Floor` |
| **Notes** | No | Engineering comments. | `Check voltage drop here` |

## Formal Notation for WireSpecifications
To enable future analysis features, adhere to the following format:
*   **Power**: `Nx [Gauge]AWG` (e.g., `1x 4AWG`, `2x 0AWG`).
*   **Comm**: `[Type] [Gauge]` (e.g., `Twisted Pair 22AWG`, `Coax RG58`).
*   **Ground**: `Strap` or `Nx [Gauge]AWG`.
