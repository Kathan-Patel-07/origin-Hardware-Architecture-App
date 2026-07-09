# PCB Schematic Review Pipeline — Design Context

Running notes on research/decisions. Update this file as we go so future sessions don't re-derive things.

## Goal
Insert a lightweight "sanity + best-practice" review layer in between:
1. Requirements review (human-led, out of scope here)
2. **This layer** — sanity/best-practice checks
3. Low-level ERC/DRC (KiCad's built-in electrical/design rule checker)

## Checks wanted (v1 scope)
- Input power protection present (fusing/PTC)
- Surge/transient protection (TVS, MOV) on external-facing rails/connectors
- Reverse-polarity protection on power inputs
- MOSFET topology correctness:
  - PMOS used only as high-side switch
  - NMOS used only as low-side switch (source tied to GND/return)
- General good-practice checks — extensible list, not fixed

Rules must live in editable markdown files (a checklist library), not hardcoded in a prompt, so the user can keep adding rules over time.

## Input format
KiCad `.kicad_sch` — S-expression text format. Confirmed version in user's files: KiCad 9.0 (`generator_version "9.0"`, `version 20250114`).

Sample files found locally (this machine) under `~/Downloads/`:
- `Feedback.kicad_sch`, `ActuationSafety_V2.0.kicad_sch`, `LED_Carrier_Board/*.kicad_sch`, etc.

**Open issue:** `kicad-cli` is NOT installed on this Mac, and no KiCad.app was found via Spotlight/Homebrew either. This machine has stray schematic files but apparently isn't the design workstation. Need to confirm with user where they actually run KiCad, because that determines whether we can shell out to `kicad-cli sch export netlist` as part of the pipeline, or must parse `.kicad_sch` raw.

## Key design decision: hybrid, not pure-LLM
Two kinds of rules need two different engines:

| Rule type | Example | Engine |
|---|---|---|
| Deterministic graph fact | "PMOS source pin's net == a supply rail" | Small script over a **resolved netlist** |
| Judgment / pattern-match | "Is there adequate surge protection on this connector" | Claude, reading the markdown checklist + netlist summary |

Reason: MOSFET-topology-style rules are 100% mechanically checkable from netlist connectivity — an LLM can occasionally get these wrong reading raw S-expressions, so they should be code, not prompt. Protection-circuit-presence rules require holistic pattern recognition across a handful of parts and don't reduce to a simple graph query — that's where an LLM earns its keep.

## Netlist acquisition — two options considered
**A. `kicad-cli sch export netlist --format kicadsexpr`**
Authoritative — KiCad already solves the hard part (ratsnest / connectivity resolution across wires, junctions, labels, power symbols, hierarchical sheets, buses). Requires kicad-cli on the machine running the pipeline.

**B. Custom S-expression parser + connectivity resolver reading `.kicad_sch` directly**
No KiCad dependency, but reimplementing wire/junction/label/power-symbol connectivity resolution is real EDA engineering — the highest-risk, lowest-leverage part of this project to build ourselves.

**Leaning A** for v1 — don't reinvent ratsnest logic. Revisit B only if kicad-cli truly isn't available anywhere in the user's flow.

## Proposed architecture (draft, not yet built)
A Claude Code **Skill** (e.g. `pcb-review`), invoked like `/pcb-review <path to .kicad_sch or project dir>`:
1. Resolve/generate netlist (kicad-cli, or a netlist file the user already exported).
2. Run a small deterministic checker script over the structured netlist for objectively-provable rules (MOSFET topology, etc.) → structured findings.
3. Load every `.md` file under `rules/` as the checklist library.
4. Feed netlist summary + component/BOM list + deterministic findings + rules markdown to Claude to evaluate the judgment-call rules.
5. Emit one markdown report: PASS/WARN/FAIL per rule, each citing the specific ref designator / net.

### Proposed rules/ layout
```
rules/
  power-protection.md    # fusing, reverse-polarity, surge/TVS
  mosfet-topology.md     # PMOS high-side / NMOS low-side
  general-practice.md    # decoupling, pull-ups, test points, etc.
```
Plain markdown checklists — new rule = new bullet or new file, no code changes needed for judgment-call rules.

## Decisions made (2026-07-09)
- User designs on a **different machine** and will export netlists manually (`kicad-cli sch export netlist`) — pipeline input is the `.net` file, no kicad-cli dependency here.
- Built inside the `origin-Hardware-Architecture-App` repo (whose working tree is the home directory), branch `feat/pcb-review-pipeline` off `origin/main`. Placed at `pcb-review/` at repo root (not `Desktop/...`) so cloners don't get a Desktop folder.
- Prior WIP on `feat/pcb-tracker` (types.ts lifecycle stages) is stashed: "WIP feat/pcb-tracker: PCB lifecycle types in types.ts".
- Skill lives at `.claude/skills/pcb-review/SKILL.md` — repo root == home dir, so it doubles as a personal skill and is committable.

## What's built (v1)
- `checks/netlist_checks.py` — dependency-free s-expr parser + checks: PMOS high-side, NMOS low-side (via netlist `pinfunction` S/G/D), floating gate, polarity-unknown WARN for Q-refs with S/G/D pins. Net classification by name regex (GND-like / supply-like). Tested against a synthetic netlist; all cases correct.
- `rules/` — power-protection.md, mosfet-topology.md (incl. legitimate-exception list so LLM can downgrade deterministic FAILs to INFO), general-practice.md.
- SKILL.md — procedure: run checker → glob+read all rules → judge → write `review-<name>.md` next to netlist with FAIL/WARN/NEEDS-HUMAN/PASS, every finding citing refs/nets.

## Known limitations / future work
- Polarity detection relies on value/part/description text containing "P-Channel"/"N-Channel" etc. Symbols with bare part numbers and no description fall to the WARN bucket. Could add a part-number→polarity lookup table later.
- Gate-floating check only detects a truly unconnected gate net, not "no pull resistor".
- Not yet tested against a real exported netlist from the user's design machine — first real run may surface net-name-regex gaps (e.g. rail naming conventions like `3V3_MCU`).

## Confluence integration (2026-07-09)
- Atlassian MCP connector configured (user scope, Streamable HTTP endpoint `https://mcp.atlassian.com/v1/mcp` — the old `/v1/sse` endpoint is deprecated per Atlassian notice).
- OAuth gotcha hit twice: token was initially granted for the wrong site (`10xconstruction-team-xxb6fz48`); had to revoke at id.atlassian.com → Connected apps and re-auth picking **`10xconstruction`** in the site dropdown. CloudId: `7b6975c8-3b94-416f-8856-03f0f8a0bf5d`.
- ESD space root folder = the URL the user shared (`folder/562692274`). Folders are not "page" entities — use CQL `ancestor = 562692274`, not getConfluencePageDescendants.
- Checklists live in folder 561086844: **Schematic Capture Checklist** (563019924), **Component Selection Checklist** (540147760), **Connector Selection Checklist** (497975476). Also in the space: per-board HLD pages, PCB Development Dashboard (488407112), PCB Design Document (424935519).
- Distilled into `rules/company-schematic-standards.md` and `rules/component-and-connector-selection.md`, each header links its source page + version. Convention: Confluence is source of truth; re-sync the rule file when pages change.

## Deterministic-check candidates from company standards (future netlist_checks.py additions)
- Net-name convention lint: nets must match `+[V]_[DOMAIN]`, `GND_[DOMAIN]`, `*_IN/_OUT/_IO`, or internal-node pattern.
- Component value-field lint: resistors need power rating, caps need voltage rating in value string.
- Protection net-tie pattern: connector-pin nets should transition `X_IN` → `X_OUT` through protection parts.

## App integration decision (2026-07-09)
User asked whether the review should run inside the Origin Hardware Architecture app (the Vite SPA on port 8080) via .kicad_sch upload. Decision: **keep generation in Claude Code**. Reasons: (a) judgment layer needs an LLM — the app has no backend and no Claude API wiring; (b) raw .kicad_sch upload wouldn't work anyway since the pipeline needs kicad-cli's netlist export for resolved connectivity. Agreed middle ground for later: commit `review-*.md` reports to the app's data repo (`Origin-Hardware-Architecture`) so the app *displays* reviews alongside other hardware docs; generation stays in Claude Code. Full-blown in-app review (TS port of checker + API calls) explicitly deferred.

## App "PCB Reviews" tab (built 2026-07-09)
- `components/PcbReviewViewer.tsx` — lists `pcb-reviews/*.md` from the data repo on the selected branch (GitHub contents API via existing `listDirectory`/`getFile` in services/github.ts), renders selected report with `marked` (new npm dep), FAIL/WARN count badges, empty state pointing at the pipeline. Wired into App.tsx as MainTab 'pcbreviews'.
- Reports publish to data repo `Kathan-Patel-07/Origin-Hardware-Architecture` (cloned at `~/Origin-Hardware-Architecture`) under `pcb-reviews/`, feature branch + PR. SKILL.md step 6 covers this.
- Display title derives from filename: `review-power-safety-board.md` → "power safety board".
- Vite build passes with the new component.

## Traceability: version / revision / commit (2026-07-09)
User's identifier scheme (important, easy to confuse):
- **Version** = KiCad title-block "Rev" field (File > Page Settings > Revision), e.g. V1.0, V1.1, V2.0. Tied to PRODUCTION events, not reviews: minor number (after the point) bumps only when a PCB is fabricated (backward compatible); major bumps = NOT backward compatible. Version must not change between reviews of an unfabricated design — pipeline flags if it does.
- **Revision** = integer 0,1,2… — the ONLY identifier that advances review-to-review, within the same version. Maintained by the pipeline (NOT in the title block), derived from archived netlists in data repo `pcb-reviews/<board>/netlists/<version>-rev-N.net`; resets to 0 on version bump.
- **Design commit** = `git -C <netlist-dir> rev-parse --short HEAD`, `(dirty)` if uncommitted sch changes, `untracked` if no repo.

Mechanics:
- `netlist_checks.py` emits `design` block (title/**version**/company/dates — key renamed from "revision" to "version" to match scheme) and has `--diff prev.net` mode: components added/removed, value changes, pins moved between nets. Tested: correctly traced a Q3 source fix, R value change, part swap.
- SKILL.md: report header table Board|Version|Rev|Commit|Exported|Reviewed; `## Changes since rev N-1` (diff + intent annotations, linked to prior findings); cumulative `## Revision history` table carried forward; publishing archives the netlist per rev (required for next diff).

## First real test run — PlannerComputeGPIO_V1.1 (overnight 2026-07-09, autonomous)
- Source: user's zip of OriginAutonomy/embedded_systems_v2 @ aryamanghura/feature/pcbs (commit 1409ef5 per GitHub UI; zip has no .git). Design repo is an ORG repo, separate from the app repo.
- kicad-cli obtained WITHOUT install (disk was full, brew cask failed): mounted the cached KiCad 10.0.4 DMG from ~/Library/Caches/Homebrew read-only and ran kicad-cli from /Volumes/KiCad/.../MacOS/kicad-cli. Worked perfectly for netlist export (Fontconfig warning is cosmetic). DMG detached after. KiCad is still NOT installed on this Mac.
- Checker fixes needed by real data (made in working tree, NOT committed — commit in the morning):
  - SUPPLY_RE: allow `_DOMAIN` suffix on `+48V_ACTUATION`-style rails; GND_RE: allow underscores (`GND_LOGIC`, `/GND_FRONT_LED`).
  - Polarity: values like `PMOS_(G1,_S2,_D3)` defeated trailing `\b`; added KNOWN_NMOS/PMOS part-number tables (BSS138 etc.) and contradictory-text guard.
  - Result: 23/23 FETs identified, 21 deterministic PASS, 2 legit-exception INFO (BSS138 shifters).
- Review findings quality: caught 2 FAILs (no fusing anywhere; no TVS on 48V input), a likely-reversed BSS138 level shifter (Q5 asymmetric with Q6), and a J1 40-pin power-pin map that doesn't match Jetson/RPi standard. Report at Desktop/PCB_review_pipeline/review-PlannerComputeGPIO_V1.1.md (+ netlist copy).
- Not done (no-commit constraint): checker fixes uncommitted; report not published to data repo (pcb-reviews/ folder doesn't exist there yet); netlist not archived as V1.1-rev-0.net. All queued for morning.

## Status
v1 built on branch `feat/pcb-review-pipeline` (5 rule files + app tab + skill), not yet committed/PR'd. Next: user tests with a real netlist, then commit + PR.
