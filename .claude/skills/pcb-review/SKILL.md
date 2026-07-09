---
name: pcb-review
description: Sanity + good-practice schematic review for KiCad designs. Sits between the requirements review and low-level ERC/DRC. Use when the user asks to review a schematic, netlist, or PCB design, or invokes /pcb-review. Input is a KiCad netlist export (.net) and optionally the .kicad_sch files.
---

# PCB Schematic Sanity Review

You are performing the mid-level review layer: above ERC/DRC (electrical connectivity is assumed checkable by KiCad), below requirements review (assume requirements are already agreed). Your job is catching missing protection circuits, wrong topologies, and violated good practices.

## Inputs

The user provides a path to a KiCad netlist (`.net`, s-expression format, exported on their design machine with `kicad-cli sch export netlist -o board.net board.kicad_sch`). If they provide only `.kicad_sch` files, ask them to export the netlist — do not attempt to resolve connectivity from raw schematic wire coordinates. You may still *read* the `.kicad_sch` for context (component values, sheet names, comments) alongside the netlist.

## Locations

- `<repo>` below = the root of the app repo this skill ships in (the directory containing `pcb-review/` — it is two levels up from this SKILL.md).
- `<data-repo>` = a local clone of `Kathan-Patel-07/Origin-Hardware-Architecture` (the app's data repo). Find it with `ls -d ~/Origin-Hardware-Architecture 2>/dev/null || find ~ -maxdepth 3 -name Origin-Hardware-Architecture -type d 2>/dev/null | head -1`; if absent, offer to clone it.

## Procedure

1. **Run the deterministic checks first:**
   ```bash
   python3 <repo>/pcb-review/checks/netlist_checks.py <netlist> --json
   ```
   This returns component/net counts, supply-like and GND-like net lists, and PASS/WARN/FAIL findings for MOSFET topology and floating gates. Trust its graph facts; your job on these findings is only to judge whether a FAIL matches a known legitimate exception (listed in `rules/mosfet-topology.md`) — if so, downgrade to INFO with the reason.

2. **Read every rule file:** all of `<repo>/pcb-review/rules/*.md`. The user adds rules over time — never assume you know the list; glob and read them all fresh each run.

3. **Evaluate the judgment-call rules against the netlist.** Read the netlist yourself for this: identify external connectors (ref J*, description containing conn), power entry nets, fuses (F*, PTC), TVS/diodes (D* with TVS/ESD/transient in value or description), bulk caps, pull-ups, decoupling caps per IC. For each rule in each rules file, decide PASS / WARN / FAIL / N-A and cite the specific ref designators and net names that justify the verdict. If you cannot determine something from the netlist alone (e.g. cap placement, polarized connector keying), mark it NEEDS-HUMAN with a one-line question.

4. **Determine version and revision.** Two distinct identifiers:
   - **Version** (`V1.0`, `V1.1`, `V2.0`): from the checker's `design.version` (the KiCad title-block Rev field). Tied to **production**, not reviews: the minor number (after the point) bumps only when a PCB is actually fabricated (backward compatible); the major number bumps for a non-backward-compatible board. Version must NOT change between reviews of an unfabricated design — if the version changed since the last archived netlist but the user hasn't fabricated, flag it and ask. If empty, add a WARN ("no version set in KiCad page settings") and ask the user — never publish without one.
   - **Revision** (`0, 1, 2, …`): the only identifier that advances review-to-review. Maintained by this pipeline. Look in `<data-repo>` under `pcb-reviews/<board>/netlists/` for the highest existing `<version>-rev-N.net`. This review's revision = N+1; resets to 0 when the version bumps (i.e. after a production run).
   - **Rev-to-rev changelog**: if a previous revision's netlist exists for this version, run
     `python3 <repo>/pcb-review/checks/netlist_checks.py <netlist> --diff <prev-rev.net> --json`
     to get components added/removed, value changes, and pins that moved nets. Ask the user for a one-line intent per change group if not obvious (e.g. "added D5 TVS per rev-0 review finding").

5. **Write the report** to `<netlist-dir>/review-<netlist-name>.md`:
   - Header traceability table: **Board | Version | Rev | Design commit | Netlist exported | Reviewed**.
     Design commit: `git -C <netlist-dir> rev-parse --short HEAD`; append `(dirty)` if `git status --porcelain` shows uncommitted schematic changes; `untracked` if not a git repo (then ask the user for a source reference).
   - `## Changes since rev N-1` — the netlist diff (skip section for rev 0), each change annotated with intent and, where applicable, which prior review finding it addresses.
   - `## Revision history` — cumulative table: rev | date | version | commit | one-line summary. Carry forward previous rows from the last published report.
   - Then the findings sections as below.
   - `## Blocking (FAIL)` — must fix before layout.
   - `## Warnings (WARN)` — should fix or consciously accept.
   - `## Needs human check` — the NEEDS-HUMAN items as a checklist the user ticks during their manual pass.
   - `## Passed` — one line per passed rule, with the evidence ref (e.g. "Reverse-polarity: Q1 PMOS high-side on VIN").
   - Every finding cites refs/nets. No finding without evidence.

6. **Summarize in chat**: counts per category and the FAIL list, then link the report file.

7. **Publish to the app (ask once per review).** The Origin Hardware Architecture app has a "PCB Reviews" tab that displays reports from the `pcb-reviews/` folder of `<data-repo>`. If the user wants the review visible there, commit on a feature branch + PR (never directly to a version branch):
   - the report to `pcb-reviews/review-<board>.md` — stable filename per board; the tab derives the display title from it (`review-power-safety-board.md` → "power safety board");
   - the reviewed netlist to `pcb-reviews/<board>/netlists/<version>-rev-<N>.net` — this is what makes the next revision's diff possible. Never skip archiving the netlist.

## Style

- Be conservative with PASS: if protection *might* be there but you cannot confirm which net the TVS clamps, that is NEEDS-HUMAN, not PASS.
- Never invent components or nets — quote refs exactly as they appear in the netlist.
- Keep the report terse; the user is an experienced hardware engineer.
