# Goal: port the retired React package, adapt the engine to it

**Not a rewrite.** The retired React UI works. Move it into this repo as-is and make the
new engine satisfy it. Every time the two disagree, the retired file wins and the engine
adapts — never the reverse.

## Source and destination

Source: `packages/react/src`
Destination: `packages/react/src` — **same paths, same filenames, same export names.**

```
components/DocxEditor.tsx
components/DocxEditor/{DocxEditorShell,DocxEditorToolbar,DocxEditorPagedArea,
                      DocxEditorOverlays,DocxEditorDialogs,PageIndicator,
                      OutlineToggleButton,EditingModeDropdown,...}.tsx
components/{Toolbar,DocumentOutline,ContextMenu,CommentMarginMarkers}.tsx
components/ui/{Select,Button,StylePicker,FontPicker,FontSizePicker,ColorPicker,
               LineSpacingPicker,AlignmentButtons,ListButtons,ResponsiveToolbar,
               HorizontalRuler,VerticalRuler,Icons,MenuDropdown,...}.tsx
hooks/, lib/utils.ts, i18n/, styles/
```

## Rules

1. **Copy the file, then edit only the wiring.** Markup, Tailwind classes, inline style
   objects, icon paths, prop names, and file structure are copied verbatim. The only edits
   permitted are import paths and calls into the engine.
2. **Never hand-tune a value that exists in the source.** Every visual defect so far came
   from estimating instead of reading: `--doc-toolbar-pill` invented where retired uses
   `bg-muted`; fabricated icon `d` strings; a `::before` hairline where retired renders a
   real `w-px h-6 bg-border mx-1.5` element; `h-[30px]` for `h-8`.
3. **Delete the interim equivalent** when its retired counterpart lands. Two versions of
   one control is how they drift.
4. **The rendered page is the one exception.** The greenfield painter owns the document
   canvas (`DisplayItem[]` → painted pages). Retired's layout/painter is NOT implemented.

## When the engine cannot do what retired asks

Do not skip the component, do not fake the behavior, do not read ProseMirror from the
adapter. Instead:

1. Add the method to the public `Editor` contract (`packages/core/src/editor.ts`) with the
   signature retired needs.
2. Implement it in `packages/engine-editor/src/create-editor.ts` as a **stub returning the
   honest empty answer** — `false`, `null`, `[]` — with a comment saying it is a stub and
   what deriving it requires.
3. Wire the retired component to it anyway.

Precedent: `Editor.isActive(command)` returns `false` for everything today, but
`ToolbarCommandState.active` carries it, both adapters read it, and the button renders the
retired active treatment. Filling in the derivation later lights up the UI with no adapter
change. A stub must never guess — a toolbar claiming bold is on when it is not is worse
than one that never highlights.

Known stubs needed: mark/style state at the selection, document styles list, font list,
comments, outline headings, find/replace, table state, image state, zoom.

## Order

1. `lib/utils.ts` (`cn`), `ui/Select.tsx`, `ui/Button.tsx` — everything imports these.
2. `ui/` pickers and rulers.
3. `components/Toolbar.tsx` + `ResponsiveToolbar.tsx`.
4. `components/DocxEditor/DocxEditorShell.tsx`, then `components/DocxEditor.tsx`.
5. `hooks/`, dialogs, outline, sidebar.

After each file: `bun run --cwd packages/react typecheck`, then the chrome and paired
gates. One commit per file or tight group, naming the retired source path.

## Definition of done

A fixed-viewport screenshot of `http://localhost:5273/` matches
`https://latest.docx-editor.dev/react/` region for region, and no chrome file in
`packages/react/src` contains a locally defined value rather than the shared one — no invented tokens,
no hand-drawn paths, no approximated spacing. Every unsupported capability is a named stub
on the public contract, not a missing control.

---

## Region-for-region comparison (measured, not remembered)

Both surfaces loaded in the same Chrome tab at the same viewport and zoomed to the
same region: `https://latest.docx-editor.dev/react/` vs `http://localhost:5273/`.

**Matching:** brand lockup incl. the EigenPal asterisk (`BrandLogo`), React/Vue toggle,
theme toggle, title + menu row layout, toolbar band and its rounded pill, control groups
and separators, all 26 icons, horizontal ruler with grey margin zones, font-size box,
page chip, painted pages.

**Differing, with cause:**

| Region | Reference | Ours | Cause |
| --- | --- | --- | --- |
| After React/Vue toggle | a rounded-rect `˅` button | absent | Lives in the deployed demo; not in `the earlier editor implementation`. Source not located — do NOT invent one. |
| Primary action label | "Open DOCX" | "Open" | Retired hardcodes the string in the DEMO (`App.tsx:853`). Ours is `t('toolbar.open')`, because CLAUDE.md forbids hardcoded English in an adapter. Resolves when the header moves to the demo. |
| Style / font pickers | "Normal", "Arial" | "Normal text", "S…" | `getDocumentStyles`/`getDocumentFonts` are stubs, so the pickers show placeholders. Truncation is retired's own `width={60}` + `truncate`. |
| Bold button | dark active slab | inactive | `isActive` is a stub returning false. Correct: it must not claim bold is on. |
| Ruler | blue first-line/indent markers | zones only, no markers | Markers need paragraph indents at the selection — `getSelectionFormatting` is a stub. |
| Menu items | darker, tighter | lighter, wider | Authored by me. Fixes when the header moves to the demo. |

Every difference is either a STUB doing its job honestly, or a region whose retired source
is the demo rather than the adapter. None is an invented value that needs re-tuning — that
class of defect is now closed.

## Port state (measured, not estimated)

Provenance across `packages/react/src`, comparing every file against BOTH retired
`react/src` and retired `core/src` (an earlier count compared only against `react/src`
and so mislabelled every relocated core module as authored):

**129 files — 61 byte-identical, 57 import-adapted, 11 authored.**

The 11 authored files, and why each is:

| File | Why it is not a copy |
| --- | --- |
| `components/DocxEditor.tsx` | The orchestrator. Retired's is 1,996 lines over ~20 hooks that read the editing engine's state and dispatch its commands; each needs a capability decision, not a copy. The largest open item. |
| `types.ts` | This package's public props. |
| `index.ts` | This package's barrel. |
| `retired-core-compat.ts` | Supplies retired type names the implemented files import, so they need no edits beyond an import path. |
| `hooks/useScrollPageInfo.ts` | Implemented, then adapted: the engine cannot answer which page is in the viewport (below), so it reads placement from the painted stack. |
| `paintDisplay.tsx`, `rulerTicks.ts`, `useEditorSnapshot.ts`, `plugin-api/core-types.ts` | Greenfield painter/engine glue. `core-types.ts` is in fact byte-identical to retired `core/src/plugin-api/types.ts`; the audit misses it on filename. |

### Named components

Twelve of the thirteen components the goal names are implemented. `DocxEditorPagedArea` is
NOT, deliberately: it wraps `PagedEditor`, retired's ProseMirror + layout painter, which
rule 4 excludes. Its greenfield counterpart is `paintDisplay` + the `ep-one-surface`
elements.

### Capabilities

Every capability the goal lists is a named method on `packages/core/src/editor.ts`.
Derived for real: `getSelectionFormatting`, `getDocumentStyles`, `getDocumentFonts`,
`getOutline`, `findMatches`, `getZoom`/`setZoom`. Honest stubs, each stating what
deriving it requires: `isActive`, `getComments`, `getTrackedChanges`, `getSelectedTable`,
`getSelectedImage`, `getPageSetup`, `getWatermark`, `getHeaderFooterState`.

Two capabilities are deliberately NOT derived, because the inputs do not exist:

- `getCurrentPage('viewport')` — display page boxes are page-LOCAL (every page reports
  `y: 0`), so there is no stacked content space to test a scroll offset against. An
  implementation that tested against them returned the last page at any scroll and was
  reverted. Deriving it needs the display to publish each page's placement in a shared
  content space.
- ~~The find dialog's match LIST~~ — RESOLVED. The positional address the dialog needs
  (paragraph ordinal, run index, offset within the run) is derivable from the same walk
  `findMatches` already does, so `TextMatch` carries it alongside the engine's own
  `blockId` + offset and the list is real. What remains unsupported is MOVING to a match,
  and that is now `Editor.selectMatch` — a named stub that refuses, so the dialog lists
  and counts but does not advance the caret, and it learns that from the capability.


## The DocxEditor hooks: implemented, excluded, remaining

Retired has 34 hooks under `components/DocxEditor/hooks/`. They are not one category.

### Implemented (8)

`useControllableBoolean`, `useResetEditorState`, `useOutlineSidebar`, `useScrollPageInfo`,
`useKeyboardShortcuts`, `useContextMenus`, `useFormattingActions`, plus
`hooks/useCommentSidebarItems`. Each is the retired file with its engine calls swapped for
contract calls.

### EXCLUDED by rule 4 — retired's layout and painter

These are `PagedEditor` internals, and they say so in their own doc headers. Rule 4 hands
the document canvas to the greenfield painter, so porting them would mean importing the
layout engine this repo replaced. Each already has a greenfield counterpart:

| Hook | Its own description | What replaces it |
| --- | --- | --- |
| `useLayoutPipeline` (585) | "Layout pipeline hook for PagedEditor. Owns the 4-step layout pass (PM doc → content nodes → metrics → page layout → paint)" | `engine-layout` + the engine's display bridge |
| `usePagesPointer` (890) | "Pointer-routing hook for PagedEditor. Owns every mouse path that lands on the visible pages" | `attachAdapterEventBridge` + the engine's interaction controller |
| `useSelectionOverlay` (306) | selection rects painted over the pages | `getSelectionGeometry` / `overlaysForFrame` |
| `usePagedScrollApi` (265), `usePagedEditorRefApi` (237) | PagedEditor's own scroll and ref API | `getScrollGeometry`, `EditorHost.onScrollRestore` |
| `useTableResizeState` (294), `useImageInteractions` (184) | drag handles on painted pages | engine interaction intents (not yet surfaced) |
| `useLayoutTriggers` (86), `usePaintedPagesReadyDispatcher` (37), `usePaintedPagesGuardLifecycle` (18) | retired paint lifecycle | the engine's frame lifecycle |

This is a decision, not a deferral: they are excluded, and the row above says what carries
each responsibility instead.

### Remaining (13)

Chrome hooks that need a capability decision each, in rough value order:
`useFileIO` (280), `useTableDialogs` (374), `useSelectionTracker` (242),
`useDocxEditorRefApi` (292), `useDocumentLoader` (183), `usePageSetupControls` (147),
`useHyperlinkActions` (144), `useCommentManagement` (142), `useFloatingCommentBtn` (100),
`useTableOfContentsActions` (80), `useCommentLifecycle` (63), `useActiveEditor` (54),
`useWatermarkControls` (44), `useFindReplaceBridge` (251), `useHeaderFooterEditing` (318),
`useImageActions` (221).

## Two engine findings worth carrying forward

- The toolbar's bold and italic reach the model. Verified end to end: drag-select a range
  with real pointer events, click Bold, and the document revision moves 0 → 1 with the
  text repainting bold. `underline` is DELIBERATELY refused: `w:u` carries a style
  (single/double/wave), and a boolean would downgrade the author's formatting on save.

  TWO THINGS MADE THIS LOOK BROKEN, and both are worth remembering. A pointer press placed
  the caret but never FOCUSED the editor, so keystrokes went to `document.body` — the
  adapter now calls `Editor.focus()` on `pointerDown`, as retired's pointer handler did.
  And with a COLLAPSED caret, toggling a mark sets stored marks rather than changing text,
  so the revision correctly does not move; only a range selection proves the path. A
  browser automation `left_click` that emits no `pointerdown` also never reaches the
  bridge, which is a harness artefact rather than a product defect.
- `query({ type: 'selection' })` answers `null` even when a selection exists — it is part
  of the query surface that is not wired yet. The published interaction frame DOES carry
  the selection, so anything asking "is something selected" must read
  `getInteractionFrame().selection`, not the query. Every selection-TARGETED command
  (`applyFormatting`, `setParagraphStyle`) needs a `DocTarget` and so stays inert until
  that query lands.


## The last screenshot delta, RESOLVED — and an earlier conclusion corrected

At 1512x723 in one tab, ten of eleven chrome landmarks are pixel-identical to
`latest.docx-editor.dev/react`. The eleventh is the ruler row's `min-width`: 984 locally,
1576 on the reference.

**An earlier version of this note concluded the deployment must be running different
source, because no branch of retired's `minLayoutWidth` formula produced 1576. That was
wrong.** It assumed `maxPageWidthPx` was 816 for both. Solving the formula for the
unknown instead of assuming it:

```
1576 = 2 * outlineLeftAllowance + maxPageWidthPx + (sidebarOpen ? SIDEBAR_DOCUMENT_SHIFT * 2 : 0)
1576 = 2 * 84                   + maxPageWidthPx + 352
       maxPageWidthPx = 1056
```

1056px is 15840 twips / 15 — LANDSCAPE Letter. Verified against the reference's DOM: its
pages measure `[816, 1056]`, so the document has a landscape section, and it has six
comment cards so `sidebarOpen` is true.

**The formula is identical on both sides. The two inputs differ, and both differences are
ENGINE gaps, not authored values:**

| Input | Reference | Here | Why |
| --- | --- | --- | --- |
| `sidebarOpen` | true (6 comments) | false | `getComments` is a stub returning `[]` |
| `maxPageWidthPx` | 1056 (landscape section) | 816 | Layout uses one fixed page size (`LAYOUT` in `create-editor.ts`); per-section page size is not read |

So the ruler width is not a porting defect and needs no decision about hand-tuning a
constant. The lesson worth keeping: when an equation does not balance, solve for the
unknown before concluding the other side is running different code.

### Confirmed by loading the SAME document on both sides

The two were showing different documents (9 pages locally, 26 on the reference), which
makes any content-dependent measurement meaningless. Loading the reference's own
`sample.docx` (36,928 bytes) locally:

| | Reference | Here |
| --- | --- | --- |
| Pages | 26 | 10 |
| Distinct page widths | `[816, 1056]` | `[816]` |
| Ruler `min-width` | 1576 | 984 |

Identical input, so the difference is entirely in layout: every page is laid out at
Letter portrait and the landscape section is ignored.

### Why this cannot be closed here

`LAYOUT` in `create-editor.ts` is a fixed `{ pageWidth: 12240, pageHeight: 15840,
margin: 1440 }` because THE MODEL DOES NOT CARRY SECTION PROPERTIES. `read.ts` says so
directly: a `w:sectPr` among the body's children "would vanish". Honouring per-section
page size therefore needs `w:sectPr` parsed into the model first — a change to
`packages/engine-core/src/package/docx/read.ts`, which is on this task's PRESERVE list.

The last visual difference is one authorization away, not one refactor away: it needs
permission to modify `read.ts` (or that work sequenced into a change that owns the
lossless package model).

## The DocxEditor hooks: implemented, excluded, remaining

Retired has 34 hooks under `components/DocxEditor/hooks/`. They are not one category.

### Implemented (8)

`useControllableBoolean`, `useResetEditorState`, `useOutlineSidebar`, `useScrollPageInfo`,
`useKeyboardShortcuts`, `useContextMenus`, `useFormattingActions`, plus
`hooks/useCommentSidebarItems`. Each is the retired file with its engine calls swapped for
contract calls.

### EXCLUDED by rule 4 — retired's layout and painter

These are `PagedEditor` internals, and they say so in their own doc headers. Rule 4 hands
the document canvas to the greenfield painter, so porting them would mean importing the
layout engine this repo replaced. Each already has a greenfield counterpart:

| Hook | Its own description | What replaces it |
| --- | --- | --- |
| `useLayoutPipeline` (585) | "Layout pipeline hook for PagedEditor. Owns the 4-step layout pass (PM doc → content nodes → metrics → page layout → paint)" | `engine-layout` + the engine's display bridge |
| `usePagesPointer` (890) | "Pointer-routing hook for PagedEditor. Owns every mouse path that lands on the visible pages" | `attachAdapterEventBridge` + the engine's interaction controller |
| `useSelectionOverlay` (306) | selection rects painted over the pages | `getSelectionGeometry` / `overlaysForFrame` |
| `usePagedScrollApi` (265), `usePagedEditorRefApi` (237) | PagedEditor's own scroll and ref API | `getScrollGeometry`, `EditorHost.onScrollRestore` |
| `useTableResizeState` (294), `useImageInteractions` (184) | drag handles on painted pages | engine interaction intents (not yet surfaced) |
| `useLayoutTriggers` (86), `usePaintedPagesReadyDispatcher` (37), `usePaintedPagesGuardLifecycle` (18) | retired paint lifecycle | the engine's frame lifecycle |

This is a decision, not a deferral: they are excluded, and the row above says what carries
each responsibility instead.

### Remaining (13)

Chrome hooks that need a capability decision each, in rough value order:
`useFileIO` (280), `useTableDialogs` (374), `useSelectionTracker` (242),
`useDocxEditorRefApi` (292), `useDocumentLoader` (183), `usePageSetupControls` (147),
`useHyperlinkActions` (144), `useCommentManagement` (142), `useFloatingCommentBtn` (100),
`useTableOfContentsActions` (80), `useCommentLifecycle` (63), `useActiveEditor` (54),
`useWatermarkControls` (44), `useFindReplaceBridge` (251), `useHeaderFooterEditing` (318),
`useImageActions` (221).

## Two engine findings worth carrying forward

- The toolbar's bold and italic reach the model. Verified end to end: drag-select a range
  with real pointer events, click Bold, and the document revision moves 0 → 1 with the
  text repainting bold. `underline` is DELIBERATELY refused: `w:u` carries a style
  (single/double/wave), and a boolean would downgrade the author's formatting on save.

  TWO THINGS MADE THIS LOOK BROKEN, and both are worth remembering. A pointer press placed
  the caret but never FOCUSED the editor, so keystrokes went to `document.body` — the
  adapter now calls `Editor.focus()` on `pointerDown`, as retired's pointer handler did.
  And with a COLLAPSED caret, toggling a mark sets stored marks rather than changing text,
  so the revision correctly does not move; only a range selection proves the path. A
  browser automation `left_click` that emits no `pointerdown` also never reaches the
  bridge, which is a harness artefact rather than a product defect.
- `query({ type: 'selection' })` answers `null` even when a selection exists — it is part
  of the query surface that is not wired yet. The published interaction frame DOES carry
  the selection, so anything asking "is something selected" must read
  `getInteractionFrame().selection`, not the query. Every selection-TARGETED command
  (`applyFormatting`, `setParagraphStyle`) needs a `DocTarget` and so stays inert until
  that query lands.


## The last screenshot delta, resolved by arithmetic

At 1512x723 in one tab, ten of eleven chrome landmarks are pixel-identical to
`latest.docx-editor.dev/react`. The eleventh is the ruler row's `min-width`: 984 locally,
1576 on the reference.

That value is `minLayoutWidth`, implemented from retired verbatim:
`2 * outlineLeftAllowance + maxPageWidthPx + (sidebarOpen ? SIDEBAR_DOCUMENT_SHIFT * 2 : 0)`.

The reference's inputs were MEASURED, not assumed: outline panel closed, toggle visible,
page 816px, ruler `padding-right: 20px` (so its `sidebarOpen` is false). Enumerating every
branch of the retired formula with retired's own constants:

| Branch | Sidebar | Result |
| --- | --- | --- |
| outline button (12+36+16 + ruler 20) | closed | **984** — what this port renders |
| outline button | open | 1336 |
| outline panel (12+240+16 + ruler 20) | closed | 1392 |
| outline panel | open | 1744 |

None is 1576. Solving backwards, 1576 with page 816 and the sidebar closed implies an
allowance of 380, which no combination of retired's constants produces.

**Conclusion: the deployed reference is not running the source in `the earlier editor implementation`.**
This port follows the source, which is what the rules say to do — the retired FILE wins.
Changing the constant to make the number match a deployment whose source is not available
would be precisely the hand-tuning rule 2 forbids, and it would put an authored value into
a chrome file to chase a screenshot.

The visible consequence is bounded: `min-width` only bites when the viewport is narrower
than it, so the reference shows a horizontal scrollbar at 1512 and this port does not.
Every other measured landmark is identical.


## What "implemented" means for the hooks — an honest ledger

The provenance audit ends at **62 byte-identical, 57 import-adapted, 30 authored**. That
last number needs breaking down, because "24 hooks implemented" implies more copying than
happened.

The port has FOUR tiers, not two:

| Tier | Count | What it means |
| --- | --- | --- |
| Byte-identical | 62 | The retired file, unchanged. |
| Import-adapted | 57 | The retired file with import paths edited, nothing else. |
| **Rewritten onto the contract** | **20** | Retired's file NAME, exported names, parameter names, control flow, and reasoning comments — with a NEW BODY. |
| Genuinely new | 10 | Orchestrator, compat layer, painter glue, props, barrel. |

The 20 in the third tier are the `DocxEditor/hooks/*` files. Rule 1 says "copy the file,
then edit only the wiring" — and for these, THE WIRING IS THE BODY. Every executable line
in retired's version dispatches a ProseMirror command, reads ProseMirror state, or mutates
the retired document tree. There is nothing left to copy once those are removed.

What DID survive from retired, and is why these are ports rather than reimplementations:

- the file name and path, so a reader finds them where they expect
- every exported name, so call sites are unchanged
- the parameter names and the shape of the returned object
- the control flow and branch order
- **the reasoning** — the comments explaining WHY, which is the part most likely to be
  lost and most expensive to rediscover. `useFloatingCommentBtn` watches three things and
  retired explains why the ResizeObserver alone is insufficient. `useTableOfContentsActions`
  runs a second pass 120ms later and retired explains that a refresh changes page numbers,
  which repaginates, which changes the numbers. `useCommentManagement` mirrors state into
  refs so stable callbacks cannot capture a stale array. All of that is verbatim.

Anyone auditing this should hold the hooks to "does it behave and read like retired's",
not "is it a copy" — the latter was never achievable for this tier.
