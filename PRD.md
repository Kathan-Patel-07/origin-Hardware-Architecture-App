# Origin Hardware Architecture Studio 2.0 — PRD

**Status:** DRAFT — not approved for implementation. Work happens only on `feat/app-2.0-prd` in this repo and in the data repo (`Origin-Hardware-Architecture`). `main` on both repos stays untouched until this is approved and a migration/cutover plan is executed.

## 1. Vision

A next-generation version of the Studio app and its data model that fixes the known data-quality/tech-debt issues in the current (v2-refactor) schema, removes the scaling ceiling of a pure client-side-app-talking-directly-to-GitHub architecture, and adds real collaboration workflow — without a risky big-bang rewrite.

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
The `~/Robot-Hardware-Architecture` prototype merges into this app repo on `feat/app-2.0-prd`. It adds `@xyflow/react` and `@dagrejs/dagre` as dependencies alongside the current app's stack. Its own local-file-write persistence (`vite.config.ts` dev middleware) is removed and replaced by the same `DataSource` abstraction (§6.1), backed by the GitHub API like the rest of the app — this is what makes "hosting it for others" possible, since a static-hosted build would otherwise be view-only.

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
- Replace its dev-only local-file persistence with the `DataSource` abstraction (§6.1/§6.4).
- Implement the data mapping (§6.5) once reviewed, replacing its demo `architecture.json` with real data loaded from this data repo via `DataSource`.
- Reconnect the carried-forward features (§4 goal 6) into the same app shell/navigation as the new canvas (auth gate, branch selector, assembly tracker, inventory tracker, deviation form, release history, PCB review, analysis viewer).
- Keep all existing canvas functionality working unchanged post-merge: undo/redo, block shapes, harness drawing/branching/joining with type rules, mechanical/child-connect lines, right-click menus, harness-type filter, confirming Auto-arrange.

## 8. Migration Plan

1. Build and validate the schema/integrity layer (§7.1) against a **copy** of current `v3/ideal`-equivalent data on `feat/app-2.0-prd`, not against `main`.
2. Run the cleanup pass, producing a gap/fix report for human review before anything is considered authoritative.
3. Once the new app (data-access layer + validation) is working against that branch's data, define a cutover plan: either (a) merge `feat/app-2.0-prd` data-repo changes into existing ideal/robot branches via normal PR review, or (b) run 2.0 app and current app side by side against the same branches until confidence is high, then retire the old app code paths.
4. No cutover happens without explicit approval — this PRD covers build-out only.

## 9. Open Questions (need your answer before this PRD is "ready to implement")

1. **Data mapping (§6.5)** — confirm or correct the proposed subsystem→block, compartment→hierarchy-sheet, node→block, connection→harness mapping before it's implemented.
2. **Old UI components** — §2 proposes catalog viewer/table editor/Mermaid diagram viewer/diff viewer are superseded by the canvas, while assembly tracker/inventory tracker/deviation form/release history/PCB review/analysis viewer/branch selector/auth gate carry forward unchanged. Confirm, or call out any of the "superseded" ones you still need.
3. **Confluence import** — no information yet on what's in Confluence or what should come from it. What exists there, and what specifically needs to come from it into 2.0?
4. **Collaboration priority** — of "in-app PR/review visibility," "edit-conflict warning," and "deeper assembly tracking," which matters most for the first implementable slice?
5. **"Overnight" scope** — the full PRD (canvas merge + data mapping + GitHub-API persistence + data integrity layer + collaboration features) is too large to responsibly implement unattended in one night. Recommend Phase 1 for the first overnight run be: (a) merge the canvas editor's code into this repo per §6.4, with its persistence swapped to a `DataSource` stub, and (b) the data-repo schema/integrity validation script + cleanup report — **without** the real data mapping/import yet, since §6.5 needs your confirmation first. Confirm or adjust this scoping.
6. **Execution mechanism** — once approved, should I run Phase 1 as a single long background task that commits progress to `feat/app-2.0-prd` as it goes (so you can review commit-by-commit in the morning), or batch it into one final commit?

## 10. Success Criteria (Phase 1, tentative — refine once §9 is answered)

- Canvas editor runs from within this app repo on `feat/app-2.0-prd`, functionally identical to the standalone prototype, persisting through a `DataSource` interface (stubbed or GitHub-backed) instead of the local-file dev middleware.
- Validation script runs clean (or with only explicitly-flagged, known gaps) against the target branch's data.
- Duplicate/miscased catalog entries resolved.
- Carried-forward features (assembly tracker, inventory tracker, etc.) still work unmodified in behavior inside the merged app shell.
- No changes landed on `main` in either repo.
