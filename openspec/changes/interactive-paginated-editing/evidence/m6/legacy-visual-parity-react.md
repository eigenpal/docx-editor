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

## Visual parity: NOT met

Comparing the two screenshots directly, the current chrome differs materially from the
deployed reference. Recorded precisely rather than summarised, because "regions present"
was exactly the false pass that got the previous attempt rejected.

| Region | Reference | Current | Gap |
| --- | --- | --- | --- |
| Application header | Logo "DOCX Editor / by EigenPal", React\|Vue segmented toggle, overflow chevron; right side: light/dark toggle, black **Open DOCX**, **New**, **Save** | absent | whole row missing |
| Title placement | Title (`sample`) indented ~318px, menu row beneath it | title far left, menu beneath | horizontal placement wrong |
| Toolbar composition | Zoom stepper (− 100% +), style dropdown (`Normal`), font dropdown (`Arial`), size stepper (− 26 +), B I U S, font-colour **A** with swatch + caret, highlighter with swatch + caret, link, super/subscript, alignment **dropdown**, lists, indent −/+, line-spacing dropdown, clear format, comments toggle (dark pill), **Editing** mode dropdown | flat icon buttons plus four inert combobox stubs | control TYPES differ: steppers, split colour buttons, and mode dropdown are not modelled |
| Toolbar frame | Full-width pill inset ~10px, pale fill, one row | pill present, correct radius/overflow | close |
| Horizontal ruler | Indent markers (blue triangles), grey margin zones, spans page width only | plain tick scale, spans wider | markers and margin shading missing |
| Left gutter | Circular outline-toggle button | absent | missing |
| Sidebar | Not shown by default | 260px panel always shown | should be closed by default |
| Page | Centred with drop shadow | centred, flat | shadow missing |

## Assessment

The structural half of M6V.1 is done and the composition now lives in the right place.
The presentational half is not: the reference's toolbar is built from labelled dropdowns,
steppers, and split colour controls, and the current one is a row of uniform icon
buttons. Reaching parity means porting those retired control components themselves
(`ResponsiveToolbar`, `EditorToolbar`, the pickers and colour controls), not restyling
the generic ones.

**M6V.1 stays unchecked.** The gap table above is the remaining worklist.
