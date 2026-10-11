# Origin Hardware Architecture Studio 2.0 — PRD

**Status:** DRAFT — not approved for implementation. Work happens only on `feat/app-2.0-prd` in this repo and in the data repo (`Origin-Hardware-Architecture`). `main` on both repos stays untouched until this is approved and a migration/cutover plan is executed.

## 1. Vision

**2.0 is the system of record for the electronic architecture — not a viewer over it.** Every element that makes up the architecture (parts, nodes, connections, harnesses) is captured as structured data; every change to a released architecture flows through a controlled ECO/ECN process; and compliance questions are answerable as queries against that data rather than as a separate manual exercise.

This is a deliberate scope shift from "nicer UI over the same data" to "lightweight PLM for the electronic architecture." It is driven by three stakeholder requirements (2026-10-11): ECO/ECN change control, functional-safety + parts/materials compliance, and bringing harness data in as first-class data rather than drawings on the side. The canvas editor (§2.1) is the primary interface to that system, not the product itself.

## 2. Current State

- **Current app (v1, being superseded as primary UI):** React 19 + TypeScript + Vite + Tailwind(CDN) + Mermaid, 100% client-side SPA. No backend — the browser holds a GitHub PAT in memory and talks directly to the GitHub Contents API (base64 JSON blobs) for every read and write.
- **Current data:** This data repo, `catalog/` + `nodes/` + `connections/` JSON files per subsystem, fetched/decoded per-file at runtime.
- **Existing app surface (non-diagramming features, carried forward — see §4 goal 6):** assembly tracker, inventory tracker, deviation form, release history viewer, PCB review pipeline, analysis viewer, branch selector, auth gate.
- **Existing app surface being superseded by the 2.0 diagram UI:** catalog viewer/editor, table editor, diagram viewer (Mermaid), diff viewer — their job is taken over by the new canvas editor (§2.1).
- **Known data gaps** (documented in this data repo's `CLAUDE.md`): 12 nodes with no catalog entry, 28 nodes missing compartment, 335 connections missing wireSpec/wireName, 2 duplicate catalog entries for the same battery, 4 catalog entries with bad/local datasheet URLs, inconsistent partId casing (e.g. `TRI051S-C` vs the lowercase-slug convention).

### 2.1 The 2.0 prototype (DECIDED: becomes the primary UI)

A working prototype already exists locally at `~/Robot-Hardware-Architecture` (not yet a git repo, not yet connected to real data). It is a visual, node-based hardware architecture editor:

- **Stack:** React 19 + TypeScript + Vite + **React Flow (`@xyflow/react`)** + **dagre** (auto-layout). A different stack from the current app's Mermaid/table approach — this resolves the "keep current stack?" question: 2.0's diagramming layer uses React Flow + dagre, everything else stays React/TS/Vite.
- **Model:** a tree of blocks (Robot → MoMa, Tool → Sander/Sprayer as variants, Accessories → OST/HHM) with **hierarchy sheets** — any block can have its own nested diagram, opened by double-click, with breadcrumb navigation.
- **Blocks:** add/edit/delete/drag, 4 shapes (rectangle/oval/diamond/circle), editable title and sheet name.
- **Harnesses:** mouse-drawn cable routes with bends, one name per harness, typed as Power/Communication/Safety/Ground (**matches the data repo's `architectureType` enum almost exactly** — strong signal this is the same underlying model with a new front end). Harnesses can branch and join (same name only — different-named harnesses can't be shorted together), route cleanly without overlapping each other or hierarchy lines.
- **Mechanical / child-connect lines:** separately drawn, named, bendable.
- **Tooling:** undo/redo (Ctrl+Z/Y, 100 steps), Delete key, right-click context menus, a harness-type filter (remembered per-browser), Auto-arrange (confirms Yes/No before resetting manual layout).
- **Current limitation — persistence is dev-only:** edits save via a Vite dev-server middleware (`vite.config.ts`) that does a raw `writeFile` to `src/data/architecture.json` on disk. A built/hosted static copy is **view-only** per its own README. This is exactly why "hosting it online for others" isn't done yet — there's no write path that works outside a local `npm run dev` session.
- **Not yet done (user-identified gaps, now goals of this PRD):** (a) importing real data — currently runs on its own small demo `architecture.json`, not connected to this data repo or Confluence; (b) hosting for others to use, which requires replacing the local-file-write middleware with a real multi-user write path.

## 2.2 PLM foundation — the core of 2.0

The data model below is the foundation everything else rests on. It must be settled before the canvas editor is wired to real data, because retrofitting change-control and traceability onto data that was already migrated is substantially harder than building it in.

### 2.2.1 Change control: ECO / ECN

**Scope (DECIDED): released baselines only.** Free editing on draft/working branches; an ECO is required only to change something already released/frozen. This keeps day-to-day design work frictionless while making every change to a released architecture auditable — the common PLM pattern, and the one that survives contact with a real engineering team.

**Enforcement (DECIDED): lightweight now, enforceable later.** Approvals are captured as structured data (who, what role, when, what they approved) but the app does not hard-block on missing signatures in Phase 1. The data model must support enforced gates so they can be switched on once the process settles — i.e. the approval record is structured from day one, even though the gate isn't.

**ECO (Engineering Change Order)** — the *request*. Proposed object:
```jsonc
{
  "ecoId": "ECO-2026-014",
  "title": "Move EOA cameras to EOA compartment",
  "reason": "...",                   // WHY — the thing a git diff cannot tell you
  "raisedBy": "kathan@origin.tech",
  "raisedDate": "2026-10-11",
  "status": "draft|in_review|approved|rejected|implemented",
  "affects": {                        // impact analysis — what this touches
    "nodes": ["EOACamera_Sander"], "connections": ["conn_041"],
    "catalog": [], "harnesses": ["HRN-EOA-01"]
  },
  "effectivity": {                    // WHEN it applies — critical for as-built tracking
    "type": "immediate|from_serial|from_date",
    "value": "robot-003"              // e.g. applies to robot-003 onward
  },
  "approvals": [                      // structured now, gate-enforced later
    { "role": "ee_lead", "user": "...", "date": "...", "decision": "approved" },
    { "role": "safety_reviewer", "user": null, "date": null, "decision": "pending" }
  ],
  "linkedPR": "https://github.com/.../pull/341"
}
```

**ECN (Engineering Change Notice)** — the *record of what was actually done* once an approved ECO is implemented and merged. Carries the resulting commit/PR, the before/after diff summary, and the release/baseline it landed in.

#### The ECN process already exists — and is unused

The V3 tracker contains a tab named **`V3 ECN PROCESS SHEET`** with a fully designed column set — **and zero data rows.** The process has been specified but never adopted. Its columns are the team's own vocabulary and **should be adopted as the ECO/ECN field set rather than the invented one above**:

`ID` · `System` · `Part / Sub-assembly` · `Part Number` · `Change Description` · `Change Type` · `Priority` · `Owner` · `Status` · `CAD Updated` · `Drawing / BOM Updated` · `Target Date` · `Verified on Unit` · `Technically Feasible?` · `Reason If Not Feasible` · `Notes / Blockers`

Notable: these columns already cover **implementation checkoffs** (`CAD Updated`, `Drawing / BOM Updated`), **verification** (`Verified on Unit`), and **feasibility triage** (`Technically Feasible?`, `Reason If Not Feasible`) — concerns the generic model above missed entirely. They map cleanly onto the ECO/ECN split: feasibility and priority are ECO-stage; CAD/drawing/verified checkoffs are ECN-stage.

**Why it stayed empty is the design lesson:** a spreadsheet row can't link to the thing it changes, can't block a merge, and can't tell you what else the change touches. The fields were right; the medium couldn't enforce them. 2.0's ECO/ECN must therefore be *attached to the data it changes* — not a parallel list someone has to remember to update. Missing from their column set and still needed: **`effectivity`** (which robots/serials the change applies to) and a **link to the affected node/connection/harness records**.

**Mechanism:** the GitHub PR remains the implementation mechanism (it already gives diff, review, and merge), but the ECO/ECN metadata above lives as structured JSON in the data repo. A PR alone cannot answer "why", "what else does this affect", or "effective from which robot" — that is precisely the gap this closes.

### 2.2.2 Traceability: every object knows its change history

Each node, connection, catalog part, and harness carries a `lastChangedBy` ECN reference. This is what makes *"I need to know each and everything which makes my electronic architecture"* actually answerable — not just what the architecture is today, but why each element is the way it is, and under whose authority it changed. Git history alone doesn't survive this question well: it tells you the line changed, not that it changed because of ECO-2026-014 for a safety reason, approved by the EE lead, effective from robot-003.

### 2.2.3 Baselines / releases

Formalize "this was Rev B, frozen on this date, containing these ECNs" as an explicit object, distinct from "whatever `main` happened to look like." A baseline pins a commit per subsystem, lists its ECNs, and is what ECO scope (§2.2.1) is measured against — you can only need an ECO to change something if there's a defined "released" state to change *from*.

### 2.2.4 Harness as first-class data

**Current gap (stakeholder-identified):** the catalog today holds only **OTS (off-the-shelf) parts** — its fields (`partName`, `purchaseLink`, `datasheetUrl`, `maxContinuousPower`) are all shaped for purchasable components. Custom harnesses, which are a large part of what physically makes up the robot, are not represented at all. Harness information exists today as **PDF/image drawings** (per stakeholder) — documents, not data.

**Target:** a harness becomes a real object with wires, each carrying gauge, length, color, and **connector part references that point into the catalog** (so connectors become catalog parts like anything else), plus pinouts and terminations. The drawing is **attached as a reference document, not the system of record.**

**Why this matters beyond tidiness:**
- A harness BOM auto-generates instead of being hand-built. (This repo already has a hand-built `planner_logic_compartment_bom.md` sitting untracked in a working tree — exactly the manual artifact this eliminates.)
- Harnesses become ECO-controllable and compliance-visible like any other part.
- It closes the loop with the canvas editor: the harnesses drawn on the diagram and the harnesses in the BOM become the same object, rather than two parallel truths that drift.

**Reality check:** since the source is PDF/image drawings, there is no automated import path. Getting harness data in is a **manual data-entry effort** per harness, and the PRD should size that honestly rather than assume a parser. Recommend: build the schema + entry UI first, pilot it on one subsystem's harnesses, measure the effort, then decide rollout order.

### 2.2.5 Compliance (functional safety + parts/materials)

Both targets confirmed by stakeholder: **functional/electrical safety** (IEC 61508 / ISO 13849 family) and **parts/materials compliance** (RoHS / REACH / UL).

- **Parts/materials** attaches to catalog entries: RoHS/REACH/UL status, certificate document references, expiry/review dates. Mostly additive fields — the easier half.
- **Functional safety** attaches to *connections and nodes*, not just parts: safety classification per signal path (the data model already has `architectureType: "Safety"` as a hook), plus the rationale behind a path being safety-rated. This is the harder half and needs a dedicated design pass — flagged as an open question below.
- **Compliance is a rollup, not a separate feature.** Once parts carry certification data and every change is traceable, "are we compliant / what's expiring / what changed since last audit" becomes a dashboard query over existing data. Design the underlying fields; the dashboard follows nearly free.

### 2.2.6 Recommended sequencing

The PLM foundation should land **before** the real-data migration, since retrofitting traceability is more expensive than building it in:

1. Schema design: ECO/ECN, baseline, harness, compliance fields (+ validation).
2. ECO/ECN capture and traceability links working against real data.
3. Harness schema + manual entry UI, piloted on one subsystem.
4. Compliance fields + rollup views.

The canvas editor merge (§6.4) can proceed in parallel, as it is largely independent of these schema decisions — but **wiring the canvas to real data should wait** until at least step 1 is settled.

## 2.3 V4 platform — the real deadline and the real scope

**Stakeholder direction (2026-10-11):** V4 architecture design starts **in a few weeks**, and the app must be ready to host those changes by then. The sequence requested is:

1. Merge the current app/data-repo data **with the V3 Design Tracker data** into one place.
2. Branch from V3 to create **V4**, tracked as a **delta from V3** (not a fresh start).
3. **Plan the changes first, then apply them** to the architecture — which is precisely the ECO workflow in §2.2.1, now with a concrete first use case.

This makes V4 the forcing function for 2.0 and sets a hard, short deadline. It also means the earlier "V4 born clean in 2.0" option is **rejected** — V3 data must be merged and complete first, because V4 is derived from it.

### 2.3.1 The V3 Design Tracker (major discovery)

Located at `~/Downloads/Origin V3 Project Tracker Documentation*` (Google Sheets exports; latest Design Tracker CSV dated 2026-08-04, plus a Harness BOM tab). **This is already a working PLM-lite system, and it is far richer than the data repo's catalog.**

| | Data repo `catalog/` | V3 Design Tracker |
|---|---|---|
| Entries | 138 | **990 parts** |
| Fields | ~8 | **86 columns** |
| Scope | electrical, OTS-shaped | EBOM (316) **+ MBOM (661)** |
| Lifecycle | none | Requirement → In Design → In Procurement → IQC → Inventory |
| Revisions | none | **A (291), B (37), C (7), D (3)** |
| Procurement | `purchaseLink` only | vendor, PO, lead time, pricing, GST, duty, logistics |
| Quality | none | full IQC: guidelines, reports, owner, dates, rework tracking |

**Part Category breakdown (990 rows)** — this confirms and quantifies the stakeholder's "current app has only OTS parts" point:

| Category | Count | In data repo catalog today? |
|---|---|---|
| Custom | 414 | ✗ |
| **OTS** | 271 | ~partially (the 138 catalog entries) |
| **Custom Harness** | **123** | ✗ |
| Fasteners | 94 | ✗ |
| Packing material | 44 | ✗ |
| Consumables | 27 | ✗ |
| OPS - Consumables | 17 | ✗ |

**Sub-systems in the tracker:** MOMA (390), Sprayer (270), Sander (223), Accessories (107) — only 4, vs. the data repo's 5. `handheld_mapper` and `operation_station` appear to both fall under "Accessories," so the subsystem taxonomies **do not line up 1:1** and need reconciling as part of the merge.

**Implication:** the Design Tracker, not the data repo, is closer to being the real system of record for *parts*. The data repo is stronger on *topology* (nodes and connections — which the tracker has no concept of). 2.0's job is to be the first system that holds **both**: the tracker's part/lifecycle/procurement depth **and** the data repo's connectivity model, under one change-control process.

### 2.3.2 Harness data — better news than §2.2.4 assumed

Two distinct harness sources exist, and neither is purely PDF:

- **123 `Custom Harness` parts in the Design Tracker**, already carrying internal part numbers (`CHS-000001`, `CHS-000002`, …), descriptive names (`48V_ACT_PWR_HNS`, `AMR_DriverIO_Harness`, `AMR AC power Harness`), quantities and lifecycle status. **The harness part list already exists as data** — it does not need manual creation.
- **A Harness BOM tab** which is *wire stock/procurement* data, not topology: cable series and manufacturer part numbers (Lapp ÖLFLEX / Helu HELUTHERM), AWG, mm², cores, colour, metres required **per subsystem** (MOMA / Sprayer / Sander / OStation), vendors and pricing.

**What this changes:** §2.2.4 assumed harness data entry would be fully manual from PDFs. In fact:
- Harness **parts** → import from the Design Tracker (123 rows).
- Wire **specifications** → import from the Harness BOM; this lets `wireSpec` on a connection become a real reference to a wire part (AWG, mm², colour, Lapp/Helu part no.) instead of free text like `"Cat6"`.
- Harness **topology** (which wire runs A→B, pinouts) → still only in the PDF drawings; **this remains the manual part**, and is the genuine gap.

### 2.3.3 Confluence (partial answer to open question Q3)

The Design Tracker contains **15 distinct Confluence URLs** on `10xconstruction.atlassian.net`, mostly in the **`ESD` space**, referenced from Revision-reason and IQC-guideline columns. Observed uses: design documents (e.g. "Tool Controller Design"), functional test descriptions, and component readiness checklists. **Several are already broken** ("Can't find link") — an argument for pulling the content that matters into the system of record rather than linking out to it. Scope of what must be imported is still undefined.

### 2.3.4 Revised sequencing for the V4 deadline

Given "a few weeks," the full PRD (canvas editor + complete PLM + compliance + harness topology) is **not achievable**. The minimum that must exist before V4 design starts:

1. **Design Tracker ↔ data repo merge** — reconcile subsystem taxonomies, join parts on UID / Internal Part Number, expand the catalog schema to carry category (Custom / OTS / Custom Harness / …), lifecycle status, and revision. *Largest single task; hardest part is the join, since the two sources were never designed to match.*
2. **Harness + wire-spec import** — 123 harness parts and the wire BOM, per §2.3.2.
3. **V4 branch derived from V3**, with delta tracking vs. V3.
4. **ECO capture** — enough to "plan the change, then do the change": an ECO object with reason, affected items, and status, linked to the resulting PR.

**Deferred past the V4 deadline:** canvas-editor data wiring, compliance rollups, harness topology capture, enforced approval gates. These are additive and do not block V4 design from starting.

## 2.4 Claude connector (MCP server) — recommended, but sequenced last

**Stakeholder question:** can the app be exposed as a connector in Claude?

**Answer: yes.** A "custom connector" in Claude is a **remote MCP server**. Once the architecture is structured data behind the `DataSource` interface (§6.1), an MCP server is a *second consumer of that same interface* — a thin layer, not a parallel system. This is the main reason §6.1's abstraction earns its keep: one interface serves the canvas UI, a future REST backend, and the connector.

**What it unlocks** — natural-language queries over the architecture, which is exactly the shape of compliance and change-control questions:
- *"What changed in the 48V actuation harness since Rev B?"*
- *"Which parts are missing RoHS certificates?"*
- *"Which nodes does ECO-2026-014 affect?"*
- *"Generate the BOM for the Planner Logic compartment."*

**Proposed tool surface:** `query_parts`, `get_connections`, `trace_path`, `get_bom`, `list_ecos`, `get_change_history`, `check_compliance`. Read-only first; writes (raising an ECO from Claude) only after the ECO flow is proven in the app.

**Deployment:** a remote MCP server (so the whole team can add it in Claude, not just one machine), authenticated per-user. Note Claude Code can already read the repo directly — the connector's real value is for **non-technical users and claude.ai/desktop**, and for structured queries that would otherwise mean reading many JSON files.

**Sequencing — deliberately last.** The connector is a thin layer over the data model; building it before the data is clean and the ECO flow exists would just expose the current gaps through a nicer interface. Garbage in, garbage out. **Do not build this before §2.3.4 steps 1–4.** The one thing to do *now* is make sure the `DataSource` interface is shaped so an MCP server can sit on it later — which costs nothing extra today.

## 3. Problem Statement

**Data layer:**
- No schema validation gate — bad/incomplete data accumulates silently (see gaps above) instead of being caught at write time.
- No enforced referential integrity — `catalogRef`, `source`, `destination` can point at nothing and nobody finds out until an audit.
- Every write is a raw GitHub Contents API PUT — no transactional safety, two people editing the same file race each other with no warning.

**App layer (per stakeholder input):**
- **UI/UX limitations** — accumulated across many independent feature branches without a unified design system or navigation model.
- **Performance/scale** — full per-subsystem JSON fetched and base64-decoded client-side on every load; client-side Mermaid rendering of large graphs; no caching layer. Gets worse as subsystems/connections/platforms grow.
- **Collaboration/workflow gaps** — no in-app review/approval flow (everything is implicit in git branches), no visibility into who's editing what, no conflict warning before an overwrite, assembly tracking doesn't capture enough state for technicians.

## 4. Goals

1. **Make the `~/Robot-Hardware-Architecture` canvas editor the primary architecture UI**, merged into this app repo on `feat/app-2.0-prd`, replacing the table/Mermaid-based editing surface.
2. **Connect it to real data**: define a mapping from this data repo's `catalog/nodes/connections` model to the prototype's blocks/harnesses/hierarchy-sheets model, and import it (replacing the prototype's demo `architecture.json`).
3. **Give it a real write path** so it can be hosted for others: replace the local-dev-only file-write middleware with a GitHub-API-backed `DataSource` (same git-native backend decision as the rest of this PRD), so edits persist the same way the current app's edits do.
4. Enforce data integrity at write time (schema validation + referential checks) instead of catching gaps via manual audit.
5. Fix the known data debt as part of migration (dedupe batteries, fix partId casing, backfill or explicitly flag the gaps above).
6. Carry forward the current app's non-diagramming features (assembly tracker, inventory tracker, deviation form, release history, PCB review, analysis viewer, branch selector, auth gate) inside the same app shell as the new canvas UI.
7. Add real review/approval workflow and basic presence/conflict awareness, built on top of git (not requiring a database yet).
8. Keep the data-access layer storage-agnostic (a `DataSource` interface, not direct GitHub API calls scattered through components) so a future swap to a real backend (DB + API) is a storage-layer change, not a rewrite.

## 5. Non-Goals (this phase)

- Standing up a database or backend API service. Phase 1 stays git-native (JSON + GitHub API) — see Architecture Decisions.
- True real-time multi-cursor collaborative editing (needs a backend; deferred to the future DB+API phase).
- Confluence import — scope not yet defined (see open questions), not assumed in Phase 1.
- Touching `main` on either repo before the migration plan (§8) is reviewed and approved.

## 6. Architecture Decisions

### 6.1 Data backend: git-native now, DB-ready later (DECIDED)
Phase 1 keeps JSON files in a git repo fetched via the GitHub API — same pattern as today, not a database. The requirement is that the app's data-access code be written behind a storage interface (e.g. a `DataSource` abstraction: `getNodes(subsystem)`, `getConnections(subsystem)`, `saveConnection(...)`, etc.) so that swapping the implementation from "GitHub API client" to "REST client against our own API" later is a localized change, not a rewrite. No new infra stood up now.

### 6.2 Schema validation
Add a validation layer (JSON Schema, checked both in a pre-commit/CI hook on the data repo and client-side before any save in the app) enforcing: `catalogRef` exists in catalog or is explicitly flagged `missing_catalog_entry`; `source`/`destination` exist in the subsystem's nodes file; `compartment` is non-empty or explicitly flagged; partId casing convention.

### 6.3 Migration, not rewrite
2.0's data model is the current catalog/nodes/connections model, evolved (not replaced) with the validation/integrity layer above. No new repos. See §8 for how current-branch data moves into the 2.0 schema.

### 6.4 Canvas editor becomes the primary UI (DECIDED)
The `~/Robot-Hardware-Architecture` prototype merges into this app repo on `feat/app-2.0-prd`. It adds `@xyflow/react` and `@dagrejs/dagre` as dependencies alongside the current app's stack. Persistence goes through a `DataSource` abstraction (§6.1). **As built (data repo DECISIONS D17):** the dev-only file store is *kept* as one `DataSource` implementation (`devFileDataSource`, loopback-only, versioned saves), and a static build is view-only (`bundledDataSource`). A GitHub-API source — what makes hosting it for others possible — is the next implementation of the same interface and is not built yet.

### 6.5 Data model mapping (OPEN — needs definition before implementation)
The prototype's model (blocks, variants, links, hierarchy sheets) must map onto this repo's model (catalog/nodes/connections, subsystems, compartments). Candidate mapping, **not yet confirmed**:
- subsystem → top-level block (moma, tools_sander/tools_sprayer as `variant` children of a Tool block, handheld_mapper/operation_station as Accessories children)
- compartment → a hierarchy sheet nested under that subsystem's block
- node → a block within its compartment's hierarchy sheet, `catalogRef` driving its description/metadata
- connection → a harness, `wireName` as the harness name, `architectureType` as its type(s)
- This mapping is a design task in its own right and should be reviewed with you before being implemented, not assumed.

## 7. Feature Requirements

### 7.1 Data integrity (data repo)
- Validation script + CI check: run against every subsystem on every branch, output a gap report (this already partially exists conceptually in the CLAUDE.md gap table — formalize it as a script, not a manually-maintained table).
- One-time cleanup pass: merge the two duplicate Newtipower catalog entries, fix the `TRI051S-C` casing, resolve or explicitly re-flag the 12 catalog-less nodes and 28 compartment-less nodes.
- `flagged`/`flagReason` becomes authoritative and script-generated, not hand-maintained.

### 7.2 Data access layer (app)
- Introduce the `DataSource` interface described in §6.1; migrate `services/github.ts` behind it.
- Add a caching layer (in-memory + optionally IndexedDB) so repeat navigation doesn't re-fetch/re-decode unchanged subsystem files.

### 7.3 Performance
- Lazy-load subsystem data (don't fetch all 5 subsystems on app load — fetch on navigation).
- Incremental/virtualized rendering for large Mermaid diagrams and large tables (moma alone has ~280 connections).

### 7.4 Collaboration/workflow
- Surface GitHub PR review state in-app (who approved, what's pending) instead of requiring a tab switch to GitHub.
- Basic "someone else is editing this file" warning: check the file's current SHA before save and warn on mismatch instead of silently overwriting (GitHub Contents API already returns SHA — just needs to be checked).
- Deeper assembly tracking: open question, see §9.

### 7.5 Canvas editor integration (app)
- Merge `~/Robot-Hardware-Architecture`'s `src/` into this repo on `feat/app-2.0-prd`.
- Put its persistence behind the `DataSource` abstraction (§6.1/§6.4) — done; the dev file store remains as one implementation (D17), a GitHub-API implementation is still to do.
- Implement the data mapping (§6.5) once reviewed, replacing its demo `architecture.json` with real data loaded from this data repo via `DataSource`.
- Reconnect the carried-forward features (§4 goal 6) into the same app shell/navigation as the new canvas (auth gate, branch selector, assembly tracker, inventory tracker, deviation form, release history, PCB review, analysis viewer).
- Keep all existing canvas functionality working unchanged post-merge: undo/redo, block shapes, harness drawing/branching/joining with type rules, mechanical/child-connect lines, right-click menus, harness-type filter, confirming Auto-arrange.

## 8. Migration Plan

1. Build and validate the schema/integrity layer (§7.1) against a **copy** of current `v3/ideal`-equivalent data on `feat/app-2.0-prd`, not against `main`.
2. Run the cleanup pass, producing a gap/fix report for human review before anything is considered authoritative.
3. Once the new app (data-access layer + validation) is working against that branch's data, define a cutover plan: either (a) merge `feat/app-2.0-prd` data-repo changes into existing ideal/robot branches via normal PR review, or (b) run 2.0 app and current app side by side against the same branches until confidence is high, then retire the old app code paths.
4. No cutover happens without explicit approval — this PRD covers build-out only.

## 9. Open Questions (need your answer before this PRD is "ready to implement")

0. **PLM foundation (§2.2)** — this is now the critical path. Specifically: (a) confirm the ECO/ECN field set, especially `effectivity` (does change control need to track "applies from robot-003 onward", or is immediate-only enough for now?); (b) confirm the approval **roles** that need capturing (EE lead / safety / quality / other?) even though gates aren't enforced yet; (c) functional-safety classification needs a dedicated design pass — what does a connection need to carry to satisfy your safety target (SIL/PL rating, rationale, verification evidence)? This one can't be guessed from the existing data model.
1. **Data mapping (§6.5)** — confirm or correct the proposed subsystem→block, compartment→hierarchy-sheet, node→block, connection→harness mapping before it's implemented. **Note:** §6.5 currently maps `connection → harness`, but §2.2.4 makes a harness a container of many wires. These two definitions conflict and must be reconciled — most likely a *connection* is a wire *within* a harness, not a harness itself.
2. **Old UI components** — §2 proposes catalog viewer/table editor/Mermaid diagram viewer/diff viewer are superseded by the canvas, while assembly tracker/inventory tracker/deviation form/release history/PCB review/analysis viewer/branch selector/auth gate carry forward unchanged. Confirm, or call out any of the "superseded" ones you still need.
3. **Confluence import** — no information yet on what's in Confluence or what should come from it. What exists there, and what specifically needs to come from it into 2.0?
4. **Collaboration priority** — of "in-app PR/review visibility," "edit-conflict warning," and "deeper assembly tracking," which matters most for the first implementable slice?
5. **"Overnight" scope** — the full PRD (PLM foundation + canvas merge + data mapping + GitHub-API persistence + data integrity layer + collaboration features) is far too large to responsibly implement unattended in one night. Recommend Phase 1 for the first overnight run be: (a) merge the canvas editor's code into this repo per §6.4, with its persistence swapped to a `DataSource` stub, and (b) the data-repo schema/integrity validation script + cleanup report. Both are independent of the open PLM schema decisions, so they can proceed while §2.2 is still being settled. **Explicitly deferred from overnight work:** ECO/ECN schema, harness schema, compliance fields, and the real data mapping/import — all of these need your input first (Q0, Q1) and shouldn't be guessed at unattended. Confirm or adjust.
6. **Execution mechanism** — once approved, should I run Phase 1 as a single long background task that commits progress to `feat/app-2.0-prd` as it goes (so you can review commit-by-commit in the morning), or batch it into one final commit?

## 10. Success Criteria (Phase 1, tentative — refine once §9 is answered)

- Canvas editor runs from within this app repo on `feat/app-2.0-prd`, functionally identical to the standalone prototype, persisting through a `DataSource` interface (the dev file store is one implementation; GitHub-backed is next).
- Validation script runs clean (or with only explicitly-flagged, known gaps) against the target branch's data.
- Duplicate/miscased catalog entries resolved.
- Carried-forward features (assembly tracker, inventory tracker, etc.) still work unmodified in behavior inside the merged app shell.
- No changes landed on `main` in either repo.
