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
