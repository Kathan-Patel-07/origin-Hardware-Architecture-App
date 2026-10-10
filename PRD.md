# Origin Hardware Architecture Studio 2.0 — PRD

**Status:** DRAFT — not approved for implementation. Work happens only on `feat/app-2.0-prd` in this repo and in the data repo (`Origin-Hardware-Architecture`). `main` on both repos stays untouched until this is approved and a migration/cutover plan is executed.

## 1. Vision

A next-generation version of the Studio app and its data model that fixes the known data-quality/tech-debt issues in the current (v2-refactor) schema, removes the scaling ceiling of a pure client-side-app-talking-directly-to-GitHub architecture, and adds real collaboration workflow — without a risky big-bang rewrite.

## 2. Current State (what 2.0 replaces)

- **App:** React 19 + TypeScript + Vite + Tailwind(CDN) + Mermaid, 100% client-side SPA. No backend — the browser holds a GitHub PAT in memory and talks directly to the GitHub Contents API (base64 JSON blobs) for every read and write.
- **Data:** This data repo, `catalog/` + `nodes/` + `connections/` JSON files per subsystem, fetched/decoded per-file at runtime.
- **Existing app surface (already shipped, not being thrown away):** catalog viewer/editor, table editor, diagram viewer (Mermaid), diff viewer, assembly tracker, inventory tracker, deviation form, release history viewer, PCB review pipeline, analysis viewer, branch selector, auth gate.
- **Known data gaps** (documented in this data repo's `CLAUDE.md`): 12 nodes with no catalog entry, 28 nodes missing compartment, 335 connections missing wireSpec/wireName, 2 duplicate catalog entries for the same battery, 4 catalog entries with bad/local datasheet URLs, inconsistent partId casing (e.g. `TRI051S-C` vs the lowercase-slug convention).

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

1. Enforce data integrity at write time (schema validation + referential checks) instead of catching gaps via manual audit.
2. Fix the known data debt as part of migration (dedupe batteries, fix partId casing, backfill or explicitly flag the gaps above).
3. Redesign the app's data-access layer so it is storage-agnostic — reads/writes go through an interface, not direct GitHub API calls scattered through components — so a future swap to a real backend (DB + API) is a storage-layer change, not a rewrite.
4. Improve performance for large subsystems (lazy loading, caching, incremental diagram rendering).
5. Add real review/approval workflow and basic presence/conflict awareness, built on top of git (not requiring a database yet).
6. Carry forward all existing shipped features (catalog, assembly tracking, PCB review, etc.) — 2.0 is an evolution of the app, not a feature-parity reset.

## 5. Non-Goals (this phase)

- Standing up a database or backend API service. Phase 1 stays git-native (JSON + GitHub API) — see Architecture Decisions.
- True real-time multi-cursor collaborative editing (needs a backend; deferred to the future DB+API phase).
- Rewriting the UI framework/stack (staying on React + TypeScript + Vite unless the PRD review says otherwise — flagged as an open question below).
- Touching `main` on either repo before the migration plan (§8) is reviewed and approved.

## 6. Architecture Decisions

### 6.1 Data backend: git-native now, DB-ready later (DECIDED)
Phase 1 keeps JSON files in a git repo fetched via the GitHub API — same pattern as today, not a database. The requirement is that the app's data-access code be written behind a storage interface (e.g. a `DataSource` abstraction: `getNodes(subsystem)`, `getConnections(subsystem)`, `saveConnection(...)`, etc.) so that swapping the implementation from "GitHub API client" to "REST client against our own API" later is a localized change, not a rewrite. No new infra stood up now.

### 6.2 Schema validation
Add a validation layer (JSON Schema, checked both in a pre-commit/CI hook on the data repo and client-side before any save in the app) enforcing: `catalogRef` exists in catalog or is explicitly flagged `missing_catalog_entry`; `source`/`destination` exist in the subsystem's nodes file; `compartment` is non-empty or explicitly flagged; partId casing convention.

### 6.3 Migration, not rewrite
2.0's data model is the current catalog/nodes/connections model, evolved (not replaced) with the validation/integrity layer above. No new repos. See §8 for how current-branch data moves into the 2.0 schema.

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

### 7.5 UI/UX
- Specific pain points not yet itemized — see open questions (§9). Until specifics are given, treat this as "unify navigation and visual patterns across the existing components" rather than a ground-up redesign.

## 8. Migration Plan

1. Build and validate the schema/integrity layer (§7.1) against a **copy** of current `v3/ideal`-equivalent data on `feat/app-2.0-prd`, not against `main`.
2. Run the cleanup pass, producing a gap/fix report for human review before anything is considered authoritative.
3. Once the new app (data-access layer + validation) is working against that branch's data, define a cutover plan: either (a) merge `feat/app-2.0-prd` data-repo changes into existing ideal/robot branches via normal PR review, or (b) run 2.0 app and current app side by side against the same branches until confidence is high, then retire the old app code paths.
4. No cutover happens without explicit approval — this PRD covers build-out only.

## 9. Open Questions (need your answer before this PRD is "ready to implement")

1. **UI/UX specifics** — what concretely is wrong with the current UI? (e.g. navigation between subsystems, visual inconsistency, specific component that's painful to use, mobile/tablet use by technicians, something else?)
2. **Collaboration priority** — of "in-app PR/review visibility," "edit-conflict warning," and "deeper assembly tracking," which matters most for the first implementable slice?
3. **Stack** — confirm keep React + TypeScript + Vite, or do you want to reconsider the stack for 2.0?
4. **"Overnight" scope** — a full 2.0 (data integrity layer + data-access refactor + performance work + collaboration features + UI redesign) is too large to responsibly implement unattended in one night. Recommend Phase 1 for the first overnight run be: schema/integrity validation script + cleanup report (data repo) + the `DataSource` abstraction refactor (app repo), with UI/UX and collaboration features as later, reviewed phases. Confirm or adjust this scoping.
5. **Execution mechanism** — once approved, should I run Phase 1 as a single long background task that commits progress to `feat/app-2.0-prd` as it goes (so you can review commit-by-commit in the morning), or batch it into one final commit?

## 10. Success Criteria (Phase 1, tentative — refine once §9 is answered)

- Validation script runs clean (or with only explicitly-flagged, known gaps) against the target branch's data.
- Duplicate/miscased catalog entries resolved.
- App's data reads/writes go through the `DataSource` interface with zero direct `services/github.ts` calls left in components.
- All existing features (catalog, assembly tracker, diagrams, PCB review, etc.) still work unmodified in behavior.
- No changes landed on `main` in either repo.
