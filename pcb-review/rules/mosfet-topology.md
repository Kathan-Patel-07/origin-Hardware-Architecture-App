# MOSFET Topology Rules

These rules are also enforced deterministically by `checks/netlist_checks.py`. The reviewer (Claude) should read the script's findings, then use this file to judge whether any flagged case is a legitimate exception.

## Rules

- **PMOS as high-side switch only.** A P-channel MOSFET's source must connect to a supply rail (or the upstream/protected side of a power path). A PMOS with its source on GND or a signal net is almost always a schematic error.
- **NMOS as low-side switch only.** An N-channel MOSFET's source must connect to GND (or the return path). An NMOS with source floating on a load or supply net needs justification.
- **Gate drive sanity.** Gate must not be left floating: every MOSFET gate needs a pull resistor to its off-state rail (pull-up to source for PMOS, pull-down to GND for NMOS) so the switch is defined during MCU reset/boot.
- **Gate-source voltage limit.** If the rail being switched exceeds ±20 V (typical Vgs(max)), check for a zener/divider protecting the gate.

## Known legitimate exceptions (do not FAIL these, note as INFO)

- NMOS used as high-side in a controller with bootstrap/charge-pump gate drive (buck converters, motor drivers, load switches like half-bridges).
- Back-to-back MOSFETs for bidirectional blocking (battery protection).
- PMOS reverse-polarity protection: source toward the load, drain toward the connector — source is not on the raw input, that is correct for this topology.
- MOSFETs used as pass elements in level shifters (e.g. BSS138 I2C shifter: source on the low-voltage bus).
