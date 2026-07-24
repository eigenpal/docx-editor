## Status

**Provisional and intentionally open-ended.** This explores the adapter-facing
shape of the editor; it is not a locked contract. The `DisplayItem` union,
`GlyphRun`, `EditorScope`, and position/geometry types are deliberately
non-exhaustive and carry explicit extension points (a `custom` render item, a
`props` bag, open scope kinds) so the surface can grow without a breaking
change. It does **not** supersede `document-engine`, which remains authoritative
for the public object model and namespace (`DocxEditor.*`); where the two differ
on how the browser facade is finally exposed, `document-engine` wins and this
change is expected to fold into it. Acceptance here is typecheck-only.

## Context

Adapters need to do everything a document editor does — load, edit, query,
select, paint, hit-test — through a contract that never exposes the editing
engine or the layout internals behind it. The facade already handles editing and
queries; this design adds the geometry surface and fixes the render boundary so
the engine can be replaced without touching an adapter.

## Goals

- One framework-facing contract: `Editor` (the facade) plus `EditorHost` (what
  the adapter supplies). Nothing else is adapter-facing.
- No editing-engine types on the public surface, ever.
- Core owns layout and measurement; the adapter paints a positioned list and
  forwards events.
- Selection maps to geometry through PM-free semantic positions and a coherent
  interaction frame, not editing-engine positions or browser DOM ranges.
- React and Vue consume the identical contract.

## Roles

Fixed meanings, so the terms stop drifting:

- **`Editor`** — the framework-facing browser facade. Adapters call this.
- **`EditorHost`** — what the adapter supplies to `Editor`: DOM handles, frame
  scheduling, and event callbacks.
- **`EditorBinding`** — internal only. Maps editing-engine transactions to store
  operations. Never adapter-facing, never exported.
- **`EditorDriver`** — a thin test/E2E transport over `Editor`. Used by the
  browser finish-line tests; exposes no engine types.
- **`DocxEditor.*`** — the headless object model for server and agent runtimes.
  Out of scope here.

Adapters bind to `Editor` + `EditorHost` only.

## Decisions

### The editor facade owns geometry

Selection and caret are derived from current state, so they are queries, not
render items:

- `getDisplay(): readonly DisplayPage[]`
- `getSelectionRects(range?): readonly Rect[]`
- `getCaretRect(pos?): Rect | null`
- `hitTest(point, frameId?): SemanticHitTarget | null`
- `getPageGeometry(): { index, box }[]`
- `getScrollGeometry(): { contentHeight, pageTops }`

`hitTest` takes a client-space point and optional interaction-frame identity and
returns a PM-free semantic target, so pointer handling never touches an editing-
engine or layout-internal coordinate.

### The positioned render IR

`getDisplay()` and the `display` event deliver `DisplayPage[]`. A page is a box
and an ordered `DisplayItem[]`:

- `text` — a box plus shaped `GlyphRun[]`; references its semantic range/cluster
  map, `blockId`, and `scope`.
- `image` — a box plus a resolved same-origin/embedded source; carries
  semantic/atomic hit ownership and `scope`.
- `fill` — a colored box.
- `tableBorder` — drawn segments, optionally a page-break cut edge.
- `decoration` — a comment or tracked-change range marker, by reference id.

All boxes are content pixels at 96 px/in before zoom, the same space as the page
box. The variant set is the paint projection of the pagination content model;
new content kinds add a variant and are surfaced by `rendering-engine`.

### The host is a renderer and event forwarder

`EditorHost` provides DOM handles (`getBodyHostEl`, `getHfHostEl`,
`getPagesContainer`, `getScrollContainer`), `scheduleFrame`, optional
`afterCommit`, and callbacks (`onDisplay`, `onScrollRestore`,
`onSelectionChange`, `onTotalPages`). It does not measure and receives no layout
primitive — core measures and lays out, then hands the host a `DisplayPage[]` to
paint.

### PM-free semantic positions are the only positions that cross the boundary

Public semantic points carry scope, stable semantic identity, position or atomic
target, affinity, and interaction-frame identity without exposing ProseMirror
or layout-internal types. Render items reference the same semantic position and
cluster index. This is the single mechanism that maps selection to geometry, so
the adapter never accumulates display lengths, reads DOM ranges, or interprets
an engine position. `EditorSnapshot` is named to avoid colliding with any engine
state type.

### Coverage

An adapter's editing calls resolve through `exec`; its state reads through
`query`; its schema, conversion, and extension wiring move inside the engine and
disappear from the adapter (extensions arrive via `createEditor({ extensions })`);
its geometry, hit-testing, and paint resolve through `getDisplay()` and the
geometry queries. There is no remaining adapter need that requires an
editing-engine or layout-internal import.

## Risks and trade-offs

- Font availability and browser glyph metrics can shift wrapping; the engine
  owns measurement so results stay deterministic for the same inputs.
- `getSelectionRects` returns boxes in content space; overlay code maps them
  through page geometry rather than reading them from painted DOM.
- Comment and tracked-change ranges are modeled as `decoration` render items; if
  overlay layering later needs them as a separate query, that is an additive
  change, not a redesign.

## Non-goals

- No engine implementation in this change.
- No adapter code change in this change; adapters are repointed in a later plan.
- The headless object model and server bindings are specified elsewhere.
