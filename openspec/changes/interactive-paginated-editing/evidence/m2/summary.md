# M2 summary (task M2-R2)

Recorded: 2026-07-24. Milestone **M2 — shared style, paint, event bridge,
deterministic targets**.

## Progress ledger

| Snapshot | Count |
| --- | --- |
| After **M1-R2** | **39 / 114** |
| After **6.1** (`checkpoint-bccf5b11`) | **40 / 114** |
| After **M2.1** (`checkpoint-23fe0087`) | **41 / 114** |
| After **M2.2** (`checkpoint-46e8cf6a`) | **42 / 114** |
| After **M2.3** (`checkpoint-78e23d6a`) | **43 / 114** |
| After **M2-R1** (`checkpoint-04a8e7a6`) | **44 / 114** |
| After **M2-R2** (this artifact) | **45 / 114** |

## What M2 landed

### 6.1 — one-surface CSS primitives

One layer model in the single-source core stylesheet: `.ep-one-surface`
positioning context, `__viewport` scroll container, `__pages` zoom-scaled stack,
`__page` sheet, `__content` painted items, `__overlay` pointer-transparent
caret/selection layer, plus `__overlay-control` as the deliberate opt-out for
handles that need their own pointer events.

Two boundaries the stylesheet keeps:

- **No geometry.** Pages and items are positioned by the engine in content
  pixels through inline styles. No rule here sets a page or item width, height,
  x, or y.
- **No fighting the input host.** `__input-host` is a marker and containment
  hint only. Position, size, clipping, and opacity stay owned by
  engine-binding's imperative caret-following policy that the 4.3 gate approved.

`--doc-caret` existed only in the dark block, so light mode had no caret token;
it is now defined in `:root` and re-pointed by the dark theme.

### M2.1 — shared adapter event bridge

`attachAdapterEventBridge` is the single place a native event becomes an
`InteractionIntent`, so React and Vue cannot drift on:

| Policy | Behavior |
| --- | --- |
| Key ownership | Geometry keys (arrows, Home/End, PageUp/PageDown) go to the engine planner. Text, Backspace, Delete, Enter, Tab, and every ctrl/meta/alt shortcut stay with the hidden ProseMirror host. |
| Rejected navigation | Does **not** `preventDefault`, so an unsupported key falls through to native handling instead of dead-ending. |
| Click counting | A fourth rapid click restarts the 1..3 cycle rather than clamping to triple-click. |
| Non-primary buttons | Never forwarded. |
| Host effects | Pointer capture and scroll are applied host-side; the engine only asks. |

Intents carry no DOM objects — asserted by round-tripping every dispatched
intent through `JSON.stringify`.

### M2.2 — overlay paint helpers

`overlaysForFrame` converts caret and selection rectangles from stacked content
space into page-local boxes once. Both adapters map the same result to elements
and paint into the pointer-transparent overlay layer.

Zoom is deliberately absent from overlay geometry. The host scales the page
stack with a CSS transform and reports the same zoom through
`InteractionHostMetrics`, so an overlay inside a page inherits the scale.
Baking zoom into these boxes would apply it twice.

### M2.3 — deterministic click target

`firstEditableGlyphTarget` picks the first editable body glyph carrying actual
ink — whitespace runs and read-only blocks are skipped, and an empty document
returns null rather than a fabricated target. React stamps
`data-testid="one-surface-click-target"` on that run; the engine-output DOM path
marks its equivalent span.

`e2e/oneSurfaceHelpers.ts` clicks that element's live bounding-box center.
**This is the mechanism that makes M3 falsifiable:** a click on whitespace or a
page margin is a declared no-op in the 5.6a subset, so a gate aimed at a
hardcoded coordinate would pass while proving nothing.

## Gate status

| M2 requirement | Status |
| --- | --- |
| Both adapters consume the same CSS primitives | Pass — import-only, gate green |
| Both adapters consume the same event bridge | Pass — shared module, framework-neutral |
| Both adapters consume the same overlay geometry | Pass — `overlaysForFrame` in React and Vue |
| Browser tests can locate a real glyph without hardcoded coordinates | Pass — attribute + live bounding box |
| `bun run typecheck` | **Fail — pre-existing nuxt TS5097, outside M2 scope** |

## Carried into M3

- Vue does not yet stamp the click-target attribute. M2.3's manifest is
  React-only by design, matching M3's React-first sequencing; Vue picks it up at
  6.3.
- `check:parity-contract` fails on the stale untracked Vue API snapshot. Not an
  M2 gate, but it **is** in M5-R1 and must be cleared before M5.
- The bridge and overlays are wired but nothing mounts them yet. There is still
  no manually editable surface — that is 6.2 and 6.4, proven by M3.1/M3.2.

## Claim allowed after M2

**None.** M2 is plumbing.
