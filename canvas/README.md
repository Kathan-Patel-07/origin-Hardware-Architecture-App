# Canvas — architecture editor (Studio 2.0)

The block/harness diagram editor, merged from the `~/Robot-Hardware-Architecture` prototype.
It is the **Canvas** tab in the Studio and is code-split, so the other tabs don't load React Flow.

| File | What it is |
|---|---|
| `CanvasView.tsx` | Entry point used by `App.tsx`. Chooses the data source. |
| `CanvasApp.tsx` | The editor (the prototype's `App.tsx`). |
| `useArchitecture.ts` | Document state, undo/redo, and load/save through the data source. |
| `dataSource.ts` | `ArchitectureDataSource` — the **only** place storage is touched. |
| `validateDoc.ts` | Shape check of a canvas document, used on load and by the dev store before it writes. |
| `CanvasErrorBoundary.tsx` | Keeps a canvas failure (or a failed chunk load) inside the tab instead of blanking the Studio. |
| `data/architecture.json` | The canvas document (blocks, links, harnesses, hierarchy sheets). |
| `canvas.css` | Prototype stylesheet scoped under `.canvas-root` (generated, see below). |

## Storage

The editor only talks to an `ArchitectureDataSource` (`load` / `save` / `canSave`):

- **`npm run dev`** → `devFileDataSource`: the Vite middleware in `vite.config.ts` reads and
  writes `canvas/data/architecture.json` on disk. Edits auto-save (and a pending save is
  flushed when you leave the tab). The store answers **this machine only** — the dev server
  listens on `0.0.0.0`, so without that anyone on the LAN could overwrite the file — and it
  refuses to write a document `validateDoc.ts` rejects.
- **Static build** → `bundledDataSource`: the copy bundled at build time, **view only**.

If the stored document fails to load or validate, the canvas shows the bundled copy with
editing **off** (saving would overwrite the stored one).

**Saves are versioned.** Every save names the version it was based on (`If-Match` with the
store's `ETag`); if another window saved in between, the store answers 409 and the status
says so instead of silently overwriting. **Unsaved edits are mirrored to this browser's
`localStorage`** until the save lands, so a reload, a closed tab or a dev-server restart in
the save window loses nothing — the next load restores them as an undoable step. The browser
also warns before leaving with a save outstanding, and an unreachable server is retried.

The store reads request bodies as raw bytes (multi-byte characters are never split), caps
them at 20 MB while streaming, and rejects documents with parent cycles or junction ids that
collide with block ids (`validateDoc.ts`).

A GitHub-API or backend source is a new implementation of the interface passed to
`<CanvasView dataSource={...} />` — no editor changes. The canvas is **not yet wired to the
architecture data** (`catalog/`, `nodes/`, `connections/`, `harnesses/` in the data repo); that
waits on the data-model mapping in `PRD.md`.

## Styles

`canvas.css` is generated once from the prototype's global `index.css`:

```bash
node tools/scope_canvas_css.mjs <prototype>/src/index.css canvas/canvas.css
```

Every rule is prefixed with `.canvas-root` so nothing leaks into the rest of the Studio. The
prototype's dark-mode palette is dropped because the Studio shell is light-only. The block at
the end of `canvas.css` undoes the parts of the Studio's global Tailwind preflight that changed
the canvas (bold headings, list bullets, line-height). Edit `canvas.css` directly from now on;
the prototype is retired.

Keyboard shortcuts (Delete, Ctrl+Z…) listen on the window but ignore keys while focus is on
something outside the canvas, such as the Studio's tab bar.

## Checks

```bash
npx tsc -p canvas/tsconfig.json   # strict typecheck (the rest of the app is not strict yet)
npm run build
```
