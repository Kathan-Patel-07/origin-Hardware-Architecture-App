# Component & Connector Selection Standards

Sources (Confluence ESD space, synced 2026-07-09):
- [Component Selection Checklist](https://10xconstruction.atlassian.net/wiki/spaces/ESD/pages/540147760) (page v10)
- [Connector Selection Checklist](https://10xconstruction.atlassian.net/wiki/spaces/ESD/pages/497975476) (page v15)

Most of these need BOM/datasheet data, so in a netlist-only review they land in NEEDS-HUMAN — but list them explicitly so the human pass is a tick-box exercise.

## Every component must meet

- Operating temperature range: **-10 °C to 50 °C** minimum
- Availability: **>500 in stock at JLCPCB** (sourcing is JLCPCB parts library)
- Isolation rating where applicable: **8 kV (Level 4)** — add protective diode if unavailable
- EOL status: not "Discontinued" or "Not for New Designs"
- MTCR 5 years, MTCM 6 months
- Package compatible with standard PCB assembly; footprint sized for power dissipation

## Approved connectors

| Connector | Purpose | Rating |
| --- | --- | --- |
| **JST XA series** | Low-current signal & power | 250 V, 3 A, 2–20 pins, plastic-tab lock, -40…+105 °C |
| **XT-30** | High-current power | 500 V DC, 15 A (30 A instantaneous), 2-pin, friction lock, 1000 cycles |

Review rule: any connector in the netlist that is not JST XA or XT-30 (or a header/terminal-block type from the approved-types table: pin headers for protoboards, screw/pluggable terminal blocks, board-to-board) gets a WARN with a note to justify or swap.

Connector current check: sum the expected current per connector pin against the rating (JST XA 3 A/pin, XT-30 15 A) — flag power connectors whose load class obviously exceeds the family rating.
