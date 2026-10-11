# Studio 2.0 — Master Feature List

**Purpose:** one flat list to approve and prioritise. Mark each line `P0` / `P1` / `P2` / `drop`.
`P0` = must exist before V4 design starts (weeks away). `P1` = soon after. `P2` = later.

**Size key:** `S` ≈ days · `M` ≈ 1–2 weeks · `L` ≈ 3–6 weeks · `XL` ≈ needs its own design pass first.

---

## A. BOM core — the product structure

> Items 2–5 interact and must be designed **together**, not sequentially. They are the single
> biggest design task in 2.0, and every other feature sits on top of them.

| # | Feature | What it means | Size | Pri |
|---|---|---|---|---|
| 1 | **Unified part master** | **Scoped to EBOM only (decided 2026-10-11) — MBOM is out.** Merge the Design Tracker's **316 EBOM parts** with the `v3` catalog's 188 entries. Reconcile the 4-vs-5 subsystem taxonomies (split `Accessories` into handheld_mapper + operation_station). | M | |
| 2 | **Multi-level BOM** | True unlimited hierarchy: Robot → Subsystem → Sub-assembly → Part. Tracker has only 2 fixed levels today (`Sub-system`, `Subassembly`). Same tree as the canvas hierarchy sheets. | L | |
| 3 | **Multi-geography BOM** | US / EU / IN variants of the same product. **Recommended model: one base BOM + explicit regional overrides** (add / remove / substitute lines) rather than separate duplicate BOMs — the delta is what compliance actually cares about, and duplicates drift. | L | |
| 4 | **Per-line configuration & customization** | An OTS part is rarely used as-bought. Model the **as-used part** = source OTS part + modification spec (cut to length, connector swap, firmware flash, label, paint, drill). Gets its own Internal Part Number distinct from the Manufacturer Part Number. *Your tracker already has both IPN and MPN columns — the hook exists.* | L | |
| 5 | **BOM versioning** | Every BOM carries revisions (you already use Rev A/B/C/D). Diff any two revisions; list which ECNs landed in each. Per geography, so US Rev C and EU Rev B can coexist. | M | |
| 6 | **BOM export / reporting** | Generate a BOM for any (assembly × geography × revision) as CSV/XLSX. Replaces hand-built files like the existing `planner_logic_compartment_bom.md`. | S | |
| 7 | **Where-used / reverse lookup** | "Which assemblies and geographies use this part?" Essential before approving any change. | S | |

## B. Harness

| # | Feature | What it means | Size | Pri |
|---|---|---|---|---|
| 8 | **Harness as a part** | Import the existing `Custom Harness` parts (123 tracker rows → 114 distinct part numbers) (`CHS-000001`, `48V_ACT_PWR_HNS`…). Already structured data — import, not manual entry. | S | |
| 9 | **Wire specification library** | Import the Harness BOM wire stock (Lapp ÖLFLEX / Helu, AWG, mm², cores, colour). Turns `wireSpec` from free text (`"Cat6"`) into a real part reference. | S | |
| 10 | **Harness topology** | **A scaffold already exists**: untracked `wire_harness.xlsx` in the data repo — 351 rows (≈1 per connection), 19 columns. Linkage is 100% complete (`cable_id`, `conn_ref`→connection, `subsystem`, `source`, `destination`); `architecture_type`/`wire_name` 99%; `wire_spec` 31%. But **10 physical columns are 0% filled**: `cable_type`, `core_count`, `core_gauge`, `src_connector`, `dst_connector`, `length_mm`, `route_path`, `protection`, `max_current_A`, `cable_part_number`. So the schema is designed and wired to the architecture — only the physical data is missing, and that is the manual part. Also missing: a `harness_id` column to group cables into the named `CHS-xxxxx` harnesses (114 distinct part numbers). | L | |
| 11 | **Harness BOM auto-generation** | Once 8+9+10 exist, a harness BOM generates itself instead of being hand-built. | S | |

## C. Change control (ECO / ECN)

> Adopts the column vocabulary from your existing (empty) `V3 ECN PROCESS SHEET`.

| # | Feature | What it means | Size | Pri |
|---|---|---|---|---|
| 12 | **ECO — change request** | `ID`, `System`, `Part / Sub-assembly`, `Part Number`, `Change Description`, `Change Type`, `Priority`, `Owner`, `Status`, `Target Date`, `Technically Feasible?`, `Reason If Not Feasible`, `Notes / Blockers`. | M | |
| 13 | **ECN — change record** | What was actually done: `CAD Updated`, `Drawing / BOM Updated`, `Verified on Unit`, resulting PR/commit, which baseline it landed in. | M | |
| 14 | **Effectivity** | Which robots the change applies to — immediate / from serial / from date / **per geography**. Missing from your sheet; required for honest as-built tracking. | M | |
| 15 | **Impact analysis** | Before approving: what nodes, connections, harnesses, BOM lines and geographies does this ECO touch? Uses #7. | M | |
| 16 | **Per-object traceability** | Every part, node, connection, harness and BOM line links to the ECN that last changed it. This is what makes "know everything in my architecture" answerable. | M | |
| 17 | **Approval capture** | Who approved, what role, when. **Captured as data now, gates enforced later** (your decision). | S | |
| 18 | **ECO scope gate** | ECO required only to change a **released baseline**; draft branches stay frictionless (your decision). | S | |

## D. Baselines & platform versions

| # | Feature | What it means | Size | Pri |
|---|---|---|---|---|
| 19 | **Baselines / releases** | "Rev B, frozen this date, containing these ECNs." The thing ECO scope is measured against. | M | |
| 20 | **V4 branch derived from V3** | Create V4 as a tracked **delta** from V3 (your decision), not a copy or a fresh start. | M | |
| 21 | **Multi-platform coexistence** | V2 / V3 / V4 live side by side; shared part catalog, separate product structures. | M | |
| 22 | **Robot instance / as-built tracking** | Per-serial actual state vs. the ideal architecture, incl. deviations. Partly exists today. | M | |

## E. Compliance

> **Geography and compliance are the same problem.** A US BOM differs from an EU BOM *because of*
> UL vs CE, 120V vs 230V, plug types. Design #3 and #23 together.

| # | Feature | What it means | Size | Pri |
|---|---|---|---|---|
| 23 | **Parts / materials compliance** | RoHS / REACH / UL status **per part per geography**, with certificate docs and expiry dates. Mostly additive fields. | M | |
| 24 | **Functional safety classification** | Safety rating on **connections and signal paths**, not just parts (IEC 61508 / ISO 13849). Needs its own design pass — what must a connection carry? SIL/PL rating, rationale, verification evidence? | XL | |
| 25 | **Compliance rollup dashboard** | "Are we compliant / what's expiring / what changed since last audit." Nearly free once 23+24 exist — it's a query, not a system. | S | |
| 26 | **Document management** | Datasheets, certificates, harness PDFs, CAD files attached to parts with versioning. | M | |

## F. Architecture / visual

| # | Feature | What it means | Size | Pri |
|---|---|---|---|---|
| 27 | **Canvas editor merged in** | Move the `~/Robot-Hardware-Architecture` prototype into the app repo. Blocks, shapes, harness drawing with branch/join rules, mechanical lines, hierarchy sheets, undo/redo, filter, auto-arrange. **Already built** — this is a merge, not a build. | M | |
| 28 | **Canvas wired to real data** | Replace its demo `architecture.json` with real data via `DataSource`. Needs the mapping decision (connection = wire *within* a harness, not a harness). | L | |
| 29 | **Diagram ↔ BOM are one object** | The harness you draw and the harness in the BOM are the same record — no parallel truths that drift. | M | |
| 30 | **Hierarchy sheets = BOM levels** | The canvas's nested sheets and the multi-level BOM (#2) are the same tree, viewed two ways. | M | |

## G. App & infrastructure

| # | Feature | What it means | Size | Pri |
|---|---|---|---|---|
| 31 | **`DataSource` abstraction** | All reads/writes behind one interface. Git-native now (JSON + GitHub API), swappable to a real DB+API later without a rewrite. Also what the Claude connector (#38) sits on. | M | |
| 32 | **Hosting for the team** | Replace the prototype's dev-only local-file write (a built copy is view-only today) with a real multi-user write path. **This is what "host it online for others" requires.** | M | |
| 33 | **Auth & roles** | Who can view / edit / approve. Prerequisite for #17 gates. | M | |
| 34 | **Schema validation & referential integrity** | Catch bad data at write time: dangling `catalogRef`, missing compartments, incomplete wire specs. Fixes the 12 / 28 / 335 known gaps and stops new ones. | M | |
| 35 | **Performance** | Lazy-load per subsystem, caching, virtualised rendering for large diagrams/tables (moma alone is ~280 connections). | M | |
| 36 | **Edit conflict detection** | Warn on stale-SHA save instead of silently overwriting. Cheap — the API already returns the SHA. | S | |

## H. Integrations

| # | Feature | What it means | Size | Pri |
|---|---|---|---|---|
| 37 | **Google Sheets import** | One-time or ongoing import from the V3 Project Tracker. **Open question: does the sheet stay live, or does 2.0 become the source of truth?** | M | |
| 38 | **Claude connector (MCP server)** | Ask Claude "what changed in the 48V harness since Rev B?", "which parts lack RoHS certs?". Thin layer on #31. **Sequence last** — building it over unclean data just exposes the gaps. | M | |
| 39 | **Confluence integration** | ESD space — design docs, test descriptions, readiness checklists. 15 links in the tracker, several already broken. Scope undefined. | M | |
| 40 | **CAD integration** | Link parts to CAD models; supports the `CAD Updated` ECN checkoff. Onshape connector available if that's your tool. | M | |

## I. Carried forward from the current app

| # | Feature | What it means | Size | Pri |
|---|---|---|---|---|
| 41 | **Assembly tracker** | Exists. Carry forward. | S | |
| 42 | **Inventory tracker** | Exists. Carry forward. | S | |
| 43 | **Deviation form** | Exists. Carry forward. | S | |
| 44 | **Release history viewer** | Exists. Overlaps #19 — may merge. | S | |
| 45 | **PCB review pipeline** | Exists. Carry forward. | S | |
| 46 | **Analysis viewer** | Exists. Carry forward. | S | |
| 47 | **Branch selector / auth gate** | Exists. Carry forward; auth likely replaced by #33. | S | |

---

## My recommended P0 (minimum to not block V4)

**1, 2, 3, 4, 5, 8, 9, 12, 13, 14, 16, 20, 31, 34** — unified part master, the four interlocking
BOM features, harness + wire import, ECO/ECN with effectivity and traceability, the V4 delta branch,
the data abstraction, and validation.

Rationale: #1–5 are the foundation everything else needs and are **expensive to retrofit** —
bolting multi-geography or per-line customization onto an already-migrated BOM means re-migrating.
#12–16 must exist before V4 changes start, or the first V4 changes go untracked, which is the exact
problem 2.0 is meant to solve.

**Deliberately not P0:** #10 harness topology (XL, manual, pilot it first), #24 functional safety
(XL, needs a design pass), #27–30 canvas (already works standalone — merging it doesn't block V4
design), #38 connector (sequence last).

## Scope decision: EBOM only (2026-10-11)

MBOM components are **out of scope**. This cuts the part master from 990 to **316**:

| | Count | Note |
|---|---|---|
| **EBOM — in scope** | **316** | 174 OTS · **123 Custom Harness** rows (114 parts) · 19 Custom |
| MBOM — dropped | 661 | fasteners, packing, mechanical, consumables |
| Neither — dropped | 13 | consumables / packing material |

**Verified: all 123 Custom Harness parts are classified EBOM**, so the harness data survives the filter intact. Dropping MBOM loses no electrical content.

**EBOM by subsystem:** MOMA 155 · Accessories 55 · Sprayer 54 · Sander 52.

**The join is far easier than feared.** EBOM minus harnesses = **193 parts**; the `v3` catalog holds **188**. Those two sets are near 1:1 — the catalog is essentially "EBOM non-harness" already. So the merge is: reconcile ~190 records, then **add the 123 harness parts, which the catalog has never contained**.

**Consequences of this decision:**
- #1 drops `L` → `M`; #2 (multi-level BOM) shrinks — no mechanical assembly tree to model.
- **Accepted limitation:** the app cannot produce a *complete* robot BOM, only the electrical one. If a full BOM is wanted later, that is a re-scope, not an increment.
- Still required: split the tracker's `Accessories` (55 EBOM parts) into `handheld_mapper` + `operation_station` to match the architecture's 5 subsystems.

## Data inventory — what V3 data actually exists (verified 2026-10-11)

| Source | Contents | State |
|---|---|---|
| **`v3` branch**, data repo | 188 catalog · 272 nodes · 358 connections (moma 155/232, sander 42/38, sprayer 40/49, opstation 23/27, hmapper 12/12) | **The real V3 architecture.** Last commit 2026-08-03; 95 commits ahead of `main` |
| `main` branch, data repo | 159 catalog · 274 nodes · 362 connections | **Stale** (2026-06-15) and still labelled V2 |
| `wire_harness.xlsx` | 351 rows, harness topology scaffold | **Untracked — not in git.** Linkage complete, physical columns empty (see #10) |
| V3 Project Tracker (Google Sheet) | 990 parts · 123 harness parts · wire BOM · empty ECN tab | Live, 86 tabs |
| Harness PDF drawings | topology detail | **Location unknown** |

**Two data bugs found:**
1. **`robot.json` on the `v3` branch still reads `"platform": "v2"`, `"id": "v2-ideal"`.** The platform metadata was never updated when V3 branched. Anything keying off `robot.json` to tell V2 from V3 is reading the wrong value today. Fix before V4 branches, or V4 inherits it.
2. **`main` ≠ V3.** `main` is 10 commits ahead of a shared base but 95 behind `v3`, and is the stale V2-era line. **The `feat/app-2.0-prd` branch was created off `main`, so it does not contain V3 data** — it must be re-based onto `v3` before any V4 work. (No data has been written on it yet; it holds only `PRD.md` and `FEATURES.md`, so this is a cheap fix.)

## Open questions blocking a start

1. **Geographies** — which exactly? US + EU, or also IN / others? Changes #3's shape.
2. **Does the Google Sheet stay live** after import, or does 2.0 become the source of truth? Two sources of truth will drift.
3. **Customization types** — what modifications do you actually make to OTS parts? (cut to length, connector swap, firmware, labels, mechanical rework?) Determines #4's schema.
4. **CAD tool** — Onshape, SolidWorks, Fusion? Determines #40.
5. **Functional safety target** — what must a connection carry to satisfy your standard? Blocks #24.
6. **Harness PDFs** — where are they? Google Drive (I have access) or elsewhere?
