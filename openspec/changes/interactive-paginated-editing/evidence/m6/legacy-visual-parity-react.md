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

## Visual parity: closer, still NOT met

Second pass implemented the retired control SHAPES, which was the largest delta: the reference
toolbar is not a row of uniform icon buttons.

Now rendered from the production component, measured in Chromium at 1440x900:
application header with brand and 3 disabled actions, **2 steppers** (`− 100% +`,
`− 11 +`), **4 dropdowns** (`Normal text`, `Sans Serif`, alignment, line spacing),
**2 split colour controls** (glyph over swatch with caret), 21 icon buttons, sidebar
closed by default, page carrying the reference's drop shadow, 9 pages, status
**"Editable (paragraphs)"**.

### Remaining gaps

| Region | Reference | Current |
| --- | --- | --- |
| Brand block | Logo + "DOCX Editor" + "by EigenPal" subtitle, React\|Vue segmented toggle, overflow chevron | logo + name only |
| Header right | Light/dark theme toggle before the action buttons | absent |
| Title placement | Title indented to align with the page (~318px) | flush left |
| Toolbar frame | Clearly tinted pill, inset from both edges | pill geometry correct, fill too faint to read as a pill |
| Toolbar tail | Comments toggle (dark pill) and **Editing** mode dropdown at the right end | absent |
| Horizontal ruler | Indent markers (blue triangles) and shaded margin zones | plain tick scale |
| Left gutter | Circular outline-toggle button | absent |

These are additive: each is a control or affordance to port, not a structural change.
The composition, control shapes, spacing, workspace, page shadow, and sidebar behavior
now match.

**M6V.1 stays unchecked.** The table above is the remaining worklist.
