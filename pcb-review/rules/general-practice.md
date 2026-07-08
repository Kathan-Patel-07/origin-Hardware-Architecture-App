# General Good-Practice Rules

Add new rules as bullets. Keep each rule one line of "what to check" plus optional detail — the reviewer reads this whole file every run.

## Decoupling & power integrity

- Every IC power pin has a 100 nF decoupling cap on its net; ICs with multiple supply pins get one per pin.
- Voltage regulators have input and output caps matching (or exceeding) their datasheet minimums; LDO output cap ESR range respected.
- Analog rails (VREF, AVDD) are filtered from digital rails (ferrite bead or RC).

## Resets, boots, and straps

- MCU reset line has a pull-up and a cap (or is driven by a supervisor) — never floating.
- Boot/strap pins (BOOT0, EN, config straps) are explicitly pulled to their intended state, not left floating.
- Programming/debug header present (SWD/JTAG/UART) with power and ground pins.

## Interfaces

- I2C buses have pull-ups, exactly one set per bus, sized for bus capacitance (typ. 2.2k–10k).
- UART TX/RX crossover verified (TX→RX) at each connector boundary.
- USB data lines: series resistors if required by PHY, correct 1.5k/15k pull scheme or handled by the PHY.
- Differential pairs identified for layout (USB, CAN, RS-485) — note them in the report for the layout review.

## Miscellaneous sanity

- No output-to-output conflicts: two push-pull outputs on the same net.
- LEDs have series resistors; resistor value sane for the rail (no sub-100Ω on 12 V, etc.).
- Unused inputs of logic gates / op-amps tied off, not floating.
- Test points on key rails and buses.
- Mounting holes present and connected per the grounding strategy (chassis GND or isolated — either is fine, but it should look deliberate).
- Connector pinouts: power and GND on expected pins; mating-connector orientation double-check flagged for human review.
