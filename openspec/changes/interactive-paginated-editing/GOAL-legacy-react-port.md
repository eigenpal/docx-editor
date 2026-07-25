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
- The find dialog's match LIST — it addresses a match by paragraph, run and character
  index; the engine addresses it by block id and offset. The COUNT is real; inventing
  the indices would send the dialog to the wrong place.
