# M6V.1 — retired chrome visual parity (React) — IN PROGRESS

Reference: `https://latest.docx-editor.dev/react/` and git ref
the recorded presentation baseline.
Screenshots, both 1440x900, committed beside this file:

- `screenshots/retired-reference-1440x900.png`
- `screenshots/react-current-1440x900.png`

## Structural requirement: met

The chrome is composed **inside `packages/react/src/DocxEditor.tsx`**, not in a second
shell under `examples/`. The demo harness no longer assembles chrome out of exported
pieces — it passes `t` and lets the production component render its own. That was the
mechanism by which the demo and the published component drifted apart.

Chrome is opt-in through `t`: a host that supplies no translator gets the bare surface,
so every existing consumer and selector is unaffected and the adapter still ships no
English of its own.

Rendered from the production component, measured in Chromium:
shell, title bar, 4 menu items, 29 toolbar controls in 11 groups, sticky horizontal
ruler, vertical ruler, scroll container, workspace, **9 pages**, sidebar, 7 dialog
launchers, status **"Editable (paragraphs)"**.

## Visual parity: met

Third pass closed the remaining rows. Measured from the production component in
Chromium at 1440x900 and compared side by side with
`https://latest.docx-editor.dev/react/`:

| Region | Reference | Current |
| --- | --- | --- |
| Brand | Logo, "DOCX Editor", "by EigenPal", React\|Vue segmented toggle | present |
| Header actions | Light/dark toggle, solid primary action, two secondary | present |
| Title / menu | Title indented to the page, menu row beneath | present |
| Toolbar frame | Tinted pill, inset, single row, scrolls horizontally | present |
| Toolbar controls | Steppers, labelled dropdowns, split colour controls, icon buttons, comments toggle, Editing mode | **31** controls in **12** groups |
| Rulers | Horizontal sticky above the page, vertical at the content's left edge | present |
| Outline toggle | Circular button in the left gutter | present |
| Workspace / page | Centred page with drop shadow on a tinted backdrop | present |
| Sidebar | Closed by default | closed |

Exactly **5** controls dispatch — undo, redo, bold, italic, save — each gating on
`Editor.can` before `Editor.exec`, with save through `Editor.save()`. Every other
control, all 4 menu items, and all 3 header actions are visible and permanently disabled
with a localized reason.

### Intentional differences, recorded rather than faked

- **Ruler indent markers and margin shading.** The reference draws paragraph indent
  handles on the horizontal ruler. Those reflect live document state, and M6V.1 keeps
  rulers display-only through `Editor.getPageGeometry()`. Drawing static handles would
  assert a paragraph indent the engine has not reported, so they are omitted rather than
  faked.
- **Framework and theme toggles are inert.** This build IS the React adapter (Vue chrome
  is task 10V.1), and the document canvas is deliberately unthemed so it stays
  Word-faithful — a working theme toggle would imply a capability the renderer does not
  have.

## Authority

No ProseMirror import, no retired layout or painter, no DOM-selection authority, no
adapter-owned geometry. `adapter-authority.test.ts` passes. The chrome is composed inside
`packages/react/src/DocxEditor.tsx`; the demo passes `t` and renders no chrome of its own.

## Gates

| Gate | Result |
| --- | --- |
| `test:e2e:react-retired-chrome-visual` | **3/3** |
| `test:e2e:react-one-surface-interaction` | **12/12** |
| `check:adapter-css-thin` | pass |
| `adapter-authority.test.ts` | pass |
| engine + react suites | 592 pass |

Two suite assumptions were corrected while landing this, both fixture-coincidences rather
than behavior: the undo/redo scenario asserted `'U' + original.slice(0, 4)`, which only
held for the 953-byte stub that used to be the default document, and the visual spec
asserted the sidebar was open when the reference keeps it closed.
