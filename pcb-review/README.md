# pcb-review — schematic sanity review pipeline

Mid-level review layer for KiCad designs, sitting between:

1. Requirements review (human)
2. **→ this: sanity + good-practice checks ←**
3. KiCad ERC/DRC (low-level electrical rules)

## Process

**Step 1 — Export the netlist (on the KiCad design machine).** The review consumes KiCad's netlist export, not the raw `.kicad_sch` — the netlist is where resolved connectivity (which pin is on which net) lives:

```bash
kicad-cli sch export netlist -o board.net board.kicad_sch
```

**Step 2 — Run the review (in Claude Code):**

```
/pcb-review path/to/board.net
```

This runs the deterministic checker first (MOSFET topology, floating gates — hard graph facts), then reads every rule file under `rules/` and evaluates the judgment-call rules (protection presence, naming conventions, decoupling, approved parts), and writes `review-board.md` next to the netlist.

**Step 3 — Act on the report.** Findings are grouped as:
- `FAIL` — blocking, fix before layout
- `WARN` — fix or consciously accept
- `NEEDS-HUMAN` — things a netlist can't prove (connector keying, stock levels, cap placement); tick these off manually
- `PASS` — with the evidence ref for each

Fix, re-export, re-run until clean, then proceed to KiCad ERC/DRC.

## Version / revision / commit traceability

Every report header records **Board | Version | Rev | Design commit | Exported | Reviewed**:

- **Version** (`V1.0`, `V1.1`, `V2.0`) — set in KiCad under File → Page Settings → Revision. Tied to **production**: the number after the point bumps each time a PCB is fabricated (backward compatible); the major number bumps for a non-backward-compatible board. Version never changes between reviews of an unfabricated design.
- **Rev** (`0, 1, 2…`) — the only identifier that advances review-to-review, assigned by the pipeline; resets to 0 when the version bumps after a production run. Each published review archives its netlist (`pcb-reviews/<board>/netlists/<version>-rev-N.net` in the data repo); the next run diffs against it and the report gets a `Changes since rev N-1` section (components added/removed, value changes, pins moved between nets) plus a cumulative revision-history table.
- **Design commit** — the schematic repo's HEAD at review time, marked `(dirty)` if there were uncommitted changes. Commit your schematic before exporting the netlist.

## Rule sources

Company standards are synced from Confluence (ESD space → Checklists folder) into `rules/company-schematic-standards.md` and `rules/component-and-connector-selection.md`. **Confluence is the source of truth** — when a checklist page changes, ask Claude to re-sync (each rule file header records the page version it was synced from). The other rule files (`power-protection.md`, `mosfet-topology.md`, `general-practice.md`) are maintained directly in this repo.

## Viewing reviews in the Origin Hardware Architecture app

The app has a **PCB Reviews** tab that lists and renders every `pcb-reviews/*.md` file from the data repo (`Kathan-Patel-07/Origin-Hardware-Architecture`) on the selected branch, with FAIL/WARN badges. To publish a review there, commit the generated `review-<board>.md` into the data repo's `pcb-reviews/` folder (the `/pcb-review` skill offers this as its final step, via feature branch + PR).

**Generation stays in Claude Code** — the judgment half of the review is an LLM reading the rulebook against the netlist; the app is a static SPA with no backend for Claude API calls, and it couldn't accept raw `.kicad_sch` uploads anyway (netlist export requires kicad-cli on the design machine). The app is the team-facing display layer only.

The deterministic checker also runs standalone:

```bash
python3 checks/netlist_checks.py board.net          # human-readable
python3 checks/netlist_checks.py board.net --json   # for tooling
```

## Adding rules

Drop a bullet into an existing file under `rules/`, or add a new `rules/*.md` file — the skill globs and reads all of them on every run. No code changes needed for judgment-call rules. Rules that are pure netlist-graph facts (like the MOSFET topology ones) belong in `checks/netlist_checks.py` instead, so they're enforced mechanically.

## Layout

```
pcb-review/
  rules/                  # editable markdown rulebook (read fresh every review)
    power-protection.md
    mosfet-topology.md
    general-practice.md
  checks/
    netlist_checks.py     # deterministic graph checks (MOSFET topology, floating gates)
  context.md              # design notes / decision log
.claude/skills/pcb-review/SKILL.md   # the /pcb-review skill (repo root)
```
