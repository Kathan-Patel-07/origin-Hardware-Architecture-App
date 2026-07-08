# Company Schematic Capture Standards

Source: [Schematic Capture Checklist](https://10xconstruction.atlassian.net/wiki/spaces/ESD/pages/563019924) (Confluence, ESD space — synced 2026-07-09, page v2). If this file and Confluence disagree, Confluence wins; re-sync this file.

## Naming conventions (checkable from netlist names)

- **I/O signals:** `[SOURCE]_[FUNCTION]_[VOLTAGE]_IO` (bidirectional), `..._IN` (inputs), `[DESTINATION]_[FUNCTION]_[VOLTAGE]_OUT` (outputs). Examples: `ORIN_CAN_H_5V_IO`, `ESTOP_24V_IN`, `MOTOR_ENABLE_5V_OUT`.
- **Power rails:** `+[VOLTAGE]_[DOMAIN]` with matching `GND_[DOMAIN]`; isolated grounds as `GND_[VOLTAGE]_[DOMAIN]`. Examples: `+24V_LOGIC_IN`/`GND_LOGIC`, `+48V_MOTOR_OUT`/`GND_48V_MOTOR`.
- **Internal nodes:** `[DESTINATION]_[FUNCTION]_[VOLTAGE]`, e.g. `OPTO_LATCH_CTRL_3V3`.
- Flag any net that matches none of these patterns (auto-generated `Net-(R1-Pad1)` style names on anything other than trivial two-pin links are a smell).
- Ground domains must stay separated — flag if a single GND net spans what naming suggests are isolated domains.

## Component value fields (checkable from netlist values)

- Resistors: `[Resistance] [Power] [Tolerance] [Notes]` — e.g. `10k 0.25W 1%`. Flag bare values like `10k` with no power rating.
- Capacitors: `[Capacitance] [Voltage] [Type] [Notes]` — e.g. `100nF 50V X7R`. Flag caps with no voltage rating.
- Inductors: `[Inductance] [Current] [DCR] [Notes]`.
- TVS/Zener: `[Standoff V] [Max Clamping V] [Isolation] [Notes]` — e.g. `24V 32V 8kV isolation`.
- Same nominal value but different rating/tolerance ⇒ must have distinct value fields.
- Every component carries an LCSC part number in symbol properties (JLCPCB assembly).

## Protection architecture

- Each protected I/O line uses distinct `_IN`/`_OUT` nets with the protection components (TVS, R, C) between them and a **net-tie** bridging for the current return path. A connector pin net with no `_IN`→`_OUT` transition means the line is unprotected — verify that is intentional.
- Protection circuitry grouped in a dedicated "I/O Protections" text-box section on the schematic (human check).

## Status LEDs (IEC 60073 colors)

- Red = fault/error/E-stop, Yellow = warning/transitional, Green = power good/normal, Blue = action required, White = neutral/heartbeat.
- Required: one power-indicator LED per power rail, fault indicators per fault condition, a "Normal Op" indicator.
- Each LED labelled with purpose (and silkscreen label at layout).

## Design margin & derating

- Power components derated to ≤70% of max rating (current, voltage, power).
- Capacitor voltage rating ≥2× maximum expected voltage on that net.
- Derating assumptions documented in the high-level design doc.

## Testability

- Labeled test points on every power rail, each ground domain, and critical control signals.
- Programming/debug header (SWD/JTAG/UART) present.
- Enable/disable jumpers for major subsystems; unpopulated footprints for optional debug parts.

## Documentation (NEEDS-HUMAN items for the report)

- High-level design doc attached: design intent, functional block diagram (all I/O, protocols, voltage levels, expansion provisions, connector types), operating modes.
- Critical design decisions annotated in text boxes on the schematic (e.g. "TVS selected for IEC 61000-4-5 Level 4").
- Revision number + date on every sheet; changelog maintained; PCB layout revision referenced.
- Hierarchical sheets used for repeated blocks, >~50-component functions, and isolation boundaries; local/hierarchical/global labels used appropriately (global only for 3+ sheet signals).
