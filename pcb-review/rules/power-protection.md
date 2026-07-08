# Power Input Protection Rules

Applies to every net that enters the board from a connector and carries power (VIN, VBUS, VBAT, 12V_IN, etc.).

## Rules

- **Overcurrent protection.** Every external power input must pass through a fuse or PTC/polyfuse before reaching downstream circuitry. Look for components with F/PTC ref designators or fuse-like values in series with the input net.
- **Reverse-polarity protection.** Every external power input must have one of:
  - Series diode (simple, but check the drop is acceptable at the load current)
  - PMOS in the high-side path (gate to GND via resistor, source toward load)
  - Ideal-diode controller IC
  - Shunt diode + fuse combination (crowbar)
  If none is present, FAIL unless the connector is polarized/keyed AND the requirements explicitly accept that risk.
- **Surge / transient protection.** External power inputs and any connector leaving the enclosure should have a TVS diode (or MOV for AC/high energy) clamping to GND, placed on the connector side of the fuse. Check the TVS standoff voltage is above the operating rail and below downstream component ratings.
- **Bulk capacitance at input.** Some bulk capacitance (≥10 µF typical) at the power entry to handle inrush/lead inductance. Check the cap's voltage rating ≥ 2× rail for electrolytics, with derating for MLCCs.
- **Input rail sequencing/inrush.** If the input feeds hot-pluggable circuitry or large bulk capacitance (>100 µF), look for inrush limiting (NTC, soft-start load switch).

## Signal-level protection (connector pins that are not power)

- ESD protection (TVS array) on any signal that leaves the board: USB data lines, UART headers, buttons, sensor connectors.
- Series resistance or filtering on MCU pins wired directly to connectors.
