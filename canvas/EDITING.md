# Canvas — editing guide

Carried over from the prototype's README. Paths are relative to `canvas/`.

## Editing in the app

While the Studio runs locally (`npm run dev`), **Edit mode** is on in the Canvas tab:

- **Undo / redo** like Microsoft Office: **Ctrl+Z** undoes, **Ctrl+Y** or **Ctrl+Shift+Z**
  redoes (⌘ on a Mac), or use the ↶ ↷ buttons in the top bar. Every change is one step (up to
  100 kept); a new change after undoing clears the redo steps. While typing in a text box,
  Ctrl+Z undoes the typing instead; while drawing a harness it removes the last bend.

- **Delete key** — select something and press **Delete** (or Backspace) to delete it: a block
  (its children move up; its hierarchy sheet goes too), a harness, a bend point (the line
  straightens), or a mechanical connection (click the line to select it). A message confirms
  it; **Ctrl+Z** brings it back. Ignored while typing, with a dialog open, or while drawing.
- **Rename the title or sheet** — click the title at the top (the project name) or the name
  under it (the current sheet; on a hierarchy sheet this renames its block). Enter or clicking
  away saves, Esc cancels; an empty name goes back to the default.
- **Block shapes** — the Add/Edit block form has a **Shape** choice: rectangle (default), oval,
  diamond or circle. The block is drawn in that shape and every line (child-connect, mechanical,
  harness) attaches to its actual outline.
- **+ Add block** — create a block with a system type, heading and description. A block
  with no parent is the parent of its own tree (e.g. `Accessories` sits beside `Robot`).
- **Right-click a block** — *Edit text*, *Link to parent / Change parent*, *Make it a parent
  (unlink)*, *Add child block*, *Delete block* (its children move up to its parent).
- **Right-click the empty canvas** — *Add block*, *Add harness*, *Add mechanical connection*, and *Auto-arrange this sheet* once blocks
  have been moved.
- **Reshape child-connect and mechanical lines** like harnesses: drag a line to add a bend where
  you grab it; bend dots appear on hover — drag one to move it (it snaps level/plumb with its
  neighbours), double-click one to remove it, or right-click the line → *Straighten line*.
  Auto-arrange also straightens them.
- **Drag a block** to move it; its hierarchy lines and connections follow it. The first move on
  a sheet pins every block where it is, and new blocks are placed beside their parent.
  **Auto-arrange** (far right of the top bar, or right-click on the canvas) goes back to the
  automatic layout after asking you to confirm (Yes / No).
- **+ Add mechanical** (top bar) — **click the first block, then the second** on the diagram;
  then give it a **name** (e.g. "Mounts on"), shown in the middle of the dashed orange line.
  Right-click the line to *Rename* or *Delete* it.
- **Connect to…** (right-click) — draw a power / data / signal / mechanical / other connection
  to another block on the same sheet, with a label such as `48V` or `CAN FD`. Remove it with
  the × next to it in the side panel.

### Harnesses

A harness is a named cable route between blocks. It carries one or more types — **power,
communication, safety, ground** — and has **one name for the whole harness**, branches included.

- **Draw it with the mouse**: click **+ Add harness** (top bar), **click the start**, then
  **click the end**. Each end can be a **block**, a spot **on a harness line**, or a **branch
  point**. A dashed line follows the mouse; **Esc** or right-click cancels.
  - **Turns:** after the start, **click empty space** to add a bend point (as many as you like;
    **Backspace** removes the last one), then click the end.
  - block → block starts a new harness; you're then asked for a name (optional — *Skip for now*);
  - block ↔ harness adds a branch at the exact spot you clicked; it takes that harness's name;
  - harness ↔ harness joins them (see below).
- **Right-click a harness** (its line, name or a branch point): *Rename harness*, tick its
  **types** (Power / Communication / Safety / Ground — tick several; the menu stays open),
  *Branch / connect from here*, *Show name above/below*, *Delete this segment*, *Delete whole
  harness*. A harness with no type yet shows a grey line and a “?” chip.
- **Joining harnesses**: only harnesses with the **same name** (or where one is unnamed) can be
  connected directly; the result is one harness with that name and all their types. Harnesses
  with different names can't be shorted together — put a block (connector, board…) between them.
- **No shorts at blocks:** harnesses leaving the same side of a block each get their own exit
  point (spread along the side, ordered by where they go) and turn at slightly different spots,
  so parallel harnesses keep a gap instead of being drawn on top of each other.
- **Drag a harness line** to reshape it: a bend point appears where you grab and follows the
  mouse. Bend and branch points (dots) can be dragged too; right-click a bend → *Remove bend
  point* straightens it again.
- **Clean routing:** between bend points a harness is a straight line; from a block to a bend it
  leaves the block straight and makes one rounded corner. A dragged bend **snaps** level or
  plumb with its neighbouring point (another bend, a branch point, or the harness's exit on a
  block) when within 10 px. Bend dots are only shown while the harness is selected or hovered.
- **Clear of other lines:** harness exits on a block's top/bottom avoid the centre (child-connect
  line) and the quarter points (mechanical connections), and block-to-block harnesses turn in
  the lower part of the gap between rows rather than along the child-connect connectors.
- The **name label** starts at the middle of the harness. **Drag it** to slide it anywhere along
  the harness (including its branches); which side of the line you drop it on puts it above or
  below.
- Deleting a block removes the harness segments ending at it; loose branch stubs are trimmed.

**Harness type ▾** filter (top bar, shown when the sheet has harnesses): tick Power /
Communication / Safety / Ground in the dropdown. Harnesses carrying the ticked types are
highlighted and the others dimmed; the button shows what's ticked. With several types ticked,
**Any** matches harnesses carrying at least one of them, **All** only those carrying every one.
*Clear* removes the filter. The filter is remembered in your browser and never changes the data.

Single-type harnesses use that type's colour; mixed harnesses are teal, with P / C / S / G
chips on the name label.

### Hierarchy sheets

Any block can have its own detailed diagram — e.g. MOMA's internal architecture.

- **Right-click → Add hierarchy sheet** gives the block an empty sheet; the block gets a
  `⧉ sheet` badge.
- **Double-click** a block with a sheet (or *Open sheet* in the side panel) to open it. Build it
  with the same tools; blocks inside a sheet can have their own sheets too.
- Use the **breadcrumb** (`Robot Architecture › MOMA › …`), **← Back** or the browser's back
  button to go up. Each sheet has its own link, e.g. `http://localhost:8080/#/sheet/moma` (the Studio's dev port); opening it goes straight to the Canvas tab.
- **Right-click → Remove hierarchy sheet** deletes the sheet, its blocks and any nested sheets.

Every change auto-saves to [`data/architecture.json`](data/architecture.json).
A built, hosted copy of the app is view-only.

## Editing the data file directly

The blocks and links live in [`data/architecture.json`](data/architecture.json)
(types and colours are in [`data/architecture.ts`](data/architecture.ts)). Refresh
the page after editing it by hand.

- **Interchangeable options** — give them `"kind": "variant"` under a common parent
  (e.g. Tool → Sander / Sprayer); they're drawn dashed and listed as alternatives.
- **Add a cross-connection** — append to `links`:
  ```json
  { "id": "moma-sander", "source": "moma", "target": "tool-sander", "kind": "power", "label": "48V" }
  ```

The layout is computed automatically; no positions to maintain.

## Using the viewer

- Click a node to see its parent, children and connections in the side panel.
- Use the `−` / `+N` button under a node to collapse or expand its branch.
- Scroll to zoom, drag to pan. The diagram fits itself to the screen when a sheet opens and on
  *Auto-arrange*; editing never moves your view. Use the fit-view button (bottom-left) to
  re-fit at any time.
