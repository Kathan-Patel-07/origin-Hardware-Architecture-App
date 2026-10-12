# Origin Hardware Architecture Studio — V4 PRD

**Status:** DRAFT. P0 in progress. Done 2026-10-13: `v3-baseline` tag, data branch `v4`, and D9 (the Canvas edits the V4 architecture data, app branch `feat/v4-data-edit`). Next: the Requirements tab, once the requirements arrive.
**Started:** 2026-10-12
**Builds on:** the V3 BOM + Canvas work (`feat/v3-bom-canvas` in both repos). This PRD replaces the 2.0 PRD (`PRD.md`) as the place new scope is added. Nothing from the 2.0 build carries over unless it is listed here.

## 1. Goal

Let the team design the **V4 architecture** in the app, driven by **requirements** written and managed in the app itself (idea taken from Flow Engineering's requirements module, flowengineering.com).

**The formula: V3 architecture + requirements → changes → V4 architecture.** Every difference between V4 and V3 must trace back to a requirement through a change. The platform covers the whole lifecycle, from requirement to release (§7), so anyone can answer:
- "Why is this part or wire in V4?" → the change that added it → the requirement that drove it.
- "Is this requirement done?" → its changes are implemented and verification passed.
- "What is in V4 Rev A?" → generated release notes, BOM delta and harness revisions.

## 2. Decisions so far

| # | Decision | Date |
|---|---|---|
| D1 | Requirement management is added to **our app**; we are not adopting Flow Engineering. | 2026-10-12 |
| D2 | V4 starts as a **copy of V3**: nodes, connections, harnesses and BOM, built by `tools/build_v3.py`. V4 is then changed against its requirements. | 2026-10-12 |
| D3 | In the first version, a requirement links only to its **parent requirement**, which gives a tree. Links to nodes, connections and tests come later (see §6). | 2026-10-12 |
| D4 | V4 = V3 baseline + requirements. Kathan will provide the full set of V4 requirements; they are imported, not typed in one by one. | 2026-10-13 |
| D5 | *(proposed)* Requirements never link straight to nodes. They link to **changes**, and each change records exactly which nodes, connections, harnesses and parts it touches. Trace is requirement → change → architecture diff. This keeps D3 (the requirement tree stays simple) and still gives full traceability. | 2026-10-13 |
| D6 | *(proposed)* **No V4 edit without a change.** Edit mode on `v4` asks for an active change; every save is recorded against it. A change is one git branch + PR into `v4`. | 2026-10-13 |
| D7 | *(proposed)* The V3 architecture is frozen as the **baseline** (git tag `v3-baseline`); every V4 diff, impact and BOM delta is computed against it. | 2026-10-13 |

## 3. V4 branch

- New data branch `v4` created from the V3 data (`v3/canvas.json`, `v3/bom.json` and the V3 nodes and connections).
- The V3 starting point is tagged `v3-baseline` (D7) and never edited again.
- The app's branch selector shows V4 next to V3.
- V4 is edited only through changes (D6). V3 stays frozen as the reference.

## 4. Requirements management (first version)

### 4.1 Requirement object

```json
{
  "id": "REQ-SYS-001",
  "title": "Robot runs a full shift on one battery",
  "text": "The MoMa shall operate for 8 h on a single 48V battery charge under the standard sanding duty cycle.",
  "rationale": "Customer site shifts are 8 h; no mid-shift swap.",
  "parentId": null,
  "level": "system",
  "subsystem": "moma",
  "owner": "",
  "status": "draft",
  "createdBy": "",
  "createdDate": "2026-10-12",
  "notes": ""
}
```

- `id` is stable and never reused. The prefix comes from the level: `REQ-SYS-`, `REQ-SUB-`, `REQ-CMP-`.
- `parentId` holds the `id` of the parent requirement, or `null` for a top-level system requirement.
- `level` is one of `system`, `subsystem` or `component`.
- `subsystem` uses the V3 subsystem keys, or `""` when the requirement is system-wide.
- `status` is one of `draft`, `in_review`, `approved` or `obsolete`. Requirements are never deleted, only marked `obsolete`, so children never lose their parent.
- Lifecycle fields added for §7: `verificationMethod` (`test` | `analysis` | `inspection` | `demonstration`), `verificationStatus` (`not_started` | `passed` | `failed`), `verificationEvidence` (link), `release` (e.g. `V4 Rev A`). Change links are not stored on the requirement; they are read from the changes (§7.2), so there is only one source of truth.

### 4.1a Import

- Kathan supplies the requirements (D4). Import from CSV or spreadsheet with columns `id, title, text, rationale, parentId, level, subsystem, owner, verificationMethod`.
- Missing `id`s are assigned on import; the import shows a preview with the §4.2 checks (unique ids, parents exist, no cycles) before anything is written.

### 4.2 Storage

- One file per branch: `requirements/requirements.json` on `v4`.
- Edits go through the same GitHub branch/PR path as all other data.
- Checked on save: every `id` is unique, every `parentId` exists, there are no cycles, and a child's level is below its parent's.

### 4.3 App: Requirements tab

- A **tree view**: system → subsystem → component, which can be expanded or collapsed and shows a count of children per node.
- A **table view** with filters by level, subsystem, status and owner, plus text search.
- A **detail panel** to edit every field, including picking a parent from a searchable list.
- Add a child, move under another parent, and mark obsolete.
- An **orphan check** that lists requirements with no parent other than top-level ones, plus subsystems that have no requirements.
- Export to CSV for review in a spreadsheet.

### 4.4 Out of scope for the first version

- Direct links from a requirement to nodes, parts, connections, buses or harnesses (traceability comes through changes instead, see D5 and §7).
- Verification and test tracking.
- Automatic checks against architecture data, such as power budgets.
- AI agents and impact analysis.
- Approval sign-off workflow (status is just a field for now).

## 5. Open questions

1. Who owns and approves requirements: one person, or one owner per subsystem?
2. Should existing requirements (from Confluence or the Design Tracker "Requirement" lifecycle stage) be imported, or written fresh?
3. Should requirements be versioned per release (V4 Rev A or B), or does git history cover it?
4. In what form will the requirements come (spreadsheet, Confluence, doc)? This decides the import in §4.1a.
5. Who approves a change: the requirement owner, the subsystem owner, or a change board?
6. Should ECNs be written back to the Design Tracker automatically, or exported for someone to paste in?
7. Should harness drawing revisions be tracked in the app, or only flagged for the harness owner?
8. One release (`V4 Rev A`) for everything, or releases per subsystem?

## 6. Later candidates (added as they come up)

- Link requirements to nodes, parts, connections and harnesses, and show them on the Canvas.
- Verification method (test, analysis, inspection) and pass/fail status per requirement.
- Power budget rollup per bus, checked against power requirements.
- Impact view: changing a part or wire shows the affected requirements, harnesses, sheets and BOM lines.
- V4-vs-V3 diff view (what changed and which requirement drove it).

## 7. Requirement → release lifecycle (planned)

### 7.1 The flow

```
 REQUIREMENT        CHANGE (CHG)              ARCHITECTURE           VERIFY            RELEASE
 draft → approved → proposed → approved → in_work → implemented → verified → released (V4 Rev A)
      │                 │            │              │                 │              │
   imported          impact      branch v4/chg-NNN   PR merged      requirement's   tag v4-revA,
   + reviewed        preview     edits in app       into v4         evidence +      release notes,
                     (7.3)       (D6)                                pass/fail      BOM, robot branches
```

### 7.2 Change object — `changes/CHG-NNN.json` on `v4`

```json
{
  "id": "CHG-001",
  "title": "Move lift driver to 48V switched bus",
  "requirementIds": ["REQ-SUB-014"],
  "reason": "",
  "owner": "",
  "status": "proposed",
  "branch": "v4/chg-001",
  "pr": null,
  "diff": { "nodes": {"added": [], "removed": [], "modified": []},
            "connections": {"added": [], "removed": [], "modified": []},
            "parts": {"added": [], "removed": []},
            "harnesses": {"affected": []} },
  "ecn": null,
  "history": [{ "status": "proposed", "by": "", "date": "2026-10-13" }]
}
```

- `status`: `proposed` → `approved` → `in_work` → `implemented` (PR merged) → `verified` → `released`, or `rejected`.
- A change must name at least one approved requirement. A requirement can have many changes; a change can serve several requirements.
- `diff` is filled in by the app from the branch versus `v4`, not typed by hand.
- Small fixes with no requirement behind them (typos, a wrong wire name copied from V3) use a standing requirement `REQ-SYS-000 "Correct V3 data errors"`, so nothing is untraced.

### 7.3 Impact preview (before a change is approved, and again on its PR)

Computed from the diff against `v4` and against `v3-baseline`:
- Canvas sheets that change (opens them with the changes highlighted: green added, red removed, amber modified).
- Harnesses touched → which harness drawing needs a new revision (e.g. `AMR_IO_HNS_05_V1 → V2`) and which assembly-instruction sheets.
- BOM delta: parts added or removed, quantity and cost change, new IPNs needed in the Design Tracker, long-lead parts.
- Other open changes touching the same nodes or harnesses (conflict warning).

### 7.4 Verification

- Each requirement has a verification method (§4.1). Once all its changes are `implemented`, it shows up in a **Verify** queue.
- Recording pass/fail + evidence link sets its changes to `verified`. A failure reopens the requirement with a note.

### 7.5 Release

- A release (e.g. `V4 Rev A`) is a set of requirements. The release gate passes when every requirement in it is `approved`, all its changes are `verified`, and no change is still `in_work` on `v4`.
- Releasing tags `v4-revA` and generates:
  - release notes (requirements → changes → what changed), the V3→V4 BOM delta, the harness revision list;
  - an **ECN** per change, exported to the Design Tracker's (currently empty) ECN tab;
  - the starting point for robot branches (`v4/robot-001`, …) where assembly is tracked as today.

### 7.6 App views

- **Requirements tab** (§4.3) plus a column for linked changes and verification status.
- **Changes tab**: board by status (proposed / approved / in work / implemented / verified), with the impact preview per change.
- **Traceability matrix**: requirements × changes, filters for gaps: approved requirements with no change, changes with no requirement (should be none), implemented but not verified.
- **Compare V3 ↔ V4** on the Canvas: any sheet in diff mode; click an item → its change → its requirement.
- **Release dashboard**: counts per lifecycle stage for the selected release, and what blocks the gate.

### 7.7 Phases

| Phase | Delivers | Exit check |
|---|---|---|
| P0 | `v3-baseline` tag, `v4` branch, requirement import + tree/table (§4) | All supplied requirements imported with no check errors |
| P1 | Change objects, change-scoped edit mode (D6), branch + PR per change, V3↔V4 diff on the Canvas | A real change goes requirement → PR → merged, and the diff shows it |
| P2 | Impact preview: harness revisions, BOM delta, conflicts; traceability matrix | Impact of a change matches a manual check |
| P3 | Verification queue, release gate, release notes, ECN export, robot branches | `V4 Rev A` released end to end |
| Later | §6 candidates (power budget checks, agents) | — |

## 8. Flow Engineering parity (target)

Goal: our app covers what Flow (flowengineering.com) does for hardware teams, on top of what Flow lacks (wire- and harness-level detail, BOM fused with the Design Tracker, per-robot assembly tracking).

| Flow capability | Our equivalent | Status / phase |
|---|---|---|
| Requirements: tree, owners, statuses, import | Requirements tab + import (§4) | P0 |
| Systems graph: requirements ↔ architecture ↔ tests | Requirement → change → diff (D5) + verification (§7.4); graph view over that data | P1–P3; graph view in P2 |
| Architecture blocks and interfaces | Canvas: Power/Comm/Safety/Ground sheets, harnesses (already built, V3) | Done (V3), deeper than Flow |
| Values and budgets (mass, power, cost) tracked on parts and rolled up | `values` on catalog parts (power from datasheets, mass, cost from Design Tracker) with rollups per bus, subsystem and robot, checked against requirements that carry a target (e.g. "≤ 1.2 kW on 48V_Switched") | P2 (power, cost), later (mass) |
| Impact analysis on change | Impact preview (§7.3): sheets, harness revisions, BOM delta, affected requirements and budgets | P2 |
| Branch, diff, review, merge into baseline | GitHub branch + PR per change, V3↔V4 diff on the Canvas (D6, D7) | P1 |
| Verification and test tracking | Verify queue, evidence links, release gate (§7.4–7.5) | P3 |
| AI agents (budget, safety, compliance, requirement quality) | Claude in the app: check a requirement's wording, propose a change from a requirement, explain a change's impact, flag budget or safety-chain breaks (e.g. an E-stop path broken by a change) | Later, after P2 (agents need the graph and budgets first) |
| Integrations (Jira, CAD, Slack, GitHub, Jama, DOORS) | GitHub (native), Design Tracker sheet (ECN write-back), Slack notifications on change status; others not planned | P3 (Tracker, Slack) |
| Enterprise (SSO, ITAR, SOC 2) | Not needed internally | Out of scope |

Proposed **D8**: build Flow's core loop (requirements → architecture → impact → verification → release) inside our app rather than buying Flow. Integrations and enterprise compliance are out of scope.

## 9. Usability walkthrough (2026-10-13) and what it changes

Scenario: an engineer implements *"REQ-SUB-021: the planner shall see behind the robot"* by adding a rear lidar on the Planner network.

| Step | What the engineer does | Problem with the plan as written | Fix |
|---|---|---|---|
| 1 | Opens Requirements, finds REQ-SUB-021 (approved) | Fine, if the imported requirements are measurable | Import flags vague wording ("shall be robust") for rewrite |
| 2 | Starts a change from it | "Branch + PR per change" means nothing to most hardware engineers | App hides git: **Start change** creates the branch, **Submit for review** opens the PR. Git words never appear in the UI |
| 3 | Adds the lidar, a PlannerSwitch link and a 12V feed on the Canvas | **Blocker:** today Edit mode changes only the drawing (`architecture.json`); nodes/connections are untouched and a regenerate (`build_v3.py` + `apply_harness_map.mjs`) overwrites the edit, so the change has no real diff | **D9:** on `v4`, nodes/connections/harness map are the source of truth and are edited from the Canvas; sheets are re-laid out from them automatically after each edit |
| 4 | Adds the part | Part picker must search the Design Tracker (IPN/MPN), else a new catalog entry with no IPN | Picker searches the tracker first; "new part" flags *IPN needed* for the change |
| 5 | Checks impact | Only as good as the data: 90/272 nodes not matched to the tracker, 40 MOMA connections not in a harness, other subsystems not mapped, most parts have no power value → budget and BOM delta silently incomplete | Impact preview shows its own coverage ("power known for 6 of 9 loads on 12V_PL") instead of a confident number; P0 includes a data-completion pass |
| 6 | Sees "PlannerSwitch: no free port" and "12V_PL budget 92%" | Port counts are not in the data yet (only Aman's per-cable port numbers) | Add `ports` to switch/hub catalog parts in P2 |
| 7 | Submits for review | Reviewer must not read JSON | Review screen = Canvas in diff mode + impact summary + approve / request changes, on the PR |
| 8 | Two engineers edit `connections/moma.json` on different changes | One big file per subsystem → merge conflicts on almost every pair of changes | Split storage to one file per node/connection on `v4`, or merge semantically in the app |
| 9 | Merged; then verification, release | Seven change statuses + four requirement statuses + verification = form fatigue | Statuses move by themselves: *in work* when the change starts, *implemented* when merged, *verified* when evidence is attached. People only approve, reject and attach evidence |

Decisions from this walkthrough (**accepted by Kathan 2026-10-13**; D9 is the first item of P0):
- **D9** *(accepted)* — On `v4`, the data (nodes, connections, harness map, catalog) is the source of truth and the Canvas edits it; the drawing is derived. No hand edits are lost on regenerate.
- **D10** *(accepted)* — The UI never shows git concepts; changes, reviews and releases map to branches, PRs and tags behind the scenes.
- **D11** *(accepted)* — Lifecycle statuses advance automatically from events; manual actions are limited to approve / reject / attach evidence.
- **D12** *(accepted)* — Every computed number (budget, BOM delta, impact) shows its data coverage.

Verdict: usable for engineers only with D9–D12; without D9 the whole lifecycle tracks drawings, not architecture.
