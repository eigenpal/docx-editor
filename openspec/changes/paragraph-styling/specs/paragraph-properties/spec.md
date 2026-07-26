# Paragraph properties

## ADDED Requirements

### Requirement: Authored paragraph properties are modelled, not capsuled

The authored model SHALL carry a `ParagraphProps` record on every paragraph,
holding the properties Word resolves for a paragraph: alignment, indentation,
spacing, keep-with-next, keep-lines, widow control, page-break-before, outline
level, tab stops, shading and borders. Absent means "not authored here", never
"zero" — the distinction is what makes the cascade resolvable, and the model
already relies on it for `bold` (explicit `false` is authored; `undefined` is
omitted).

Everything not modelled SHALL remain authoritative in the byte-range
preservation capsule, so a save is byte-identical for unowned bytes whether or
not the paragraph was edited.

#### Scenario: A directly formatted paragraph round-trips its modelled properties
- **WHEN** a paragraph authored with `w:jc="center"` and `w:spacing w:after="240"` is parsed
- **THEN** its `ParagraphProps` reports centre alignment and 240 twips of space after
- **AND** saving without editing it reproduces the original `w:pPr` bytes exactly

#### Scenario: An unmodelled property survives an edit to the same paragraph
- **WHEN** a paragraph carries a property this change does not model
- **AND** its text is edited
- **THEN** the saved `w:pPr` still contains that property

#### Scenario: Absent is distinguished from zero
- **WHEN** a paragraph authors `w:spacing w:before="0"`
- **THEN** `ParagraphProps` reports a before-spacing of 0, not absent
- **AND** a paragraph authoring no `w:spacing` reports absent, so its style's value applies

### Requirement: The resolver implements Word's paragraph cascade

Resolution SHALL apply, in order: `docDefaults`, the style chain resolved through
`w:basedOn`, numbering-derived properties, then direct formatting. Each level
SHALL override only the properties it authors.

Cycles in `w:basedOn` SHALL be detected and MUST NOT recurse without bound; a
cyclic chain resolves as if the cycle were absent rather than throwing, because
the chain is file-derived and an attacker controls it.

#### Scenario: A style chain contributes what direct formatting omits
- **WHEN** `Heading1` is `basedOn` `Normal`, `Normal` sets 8pt after-spacing, `Heading1` sets centre alignment, and the paragraph authors neither
- **THEN** the paragraph resolves to centre alignment and 8pt after-spacing

#### Scenario: Direct formatting wins over the style chain
- **WHEN** the paragraph authors left alignment and its style authors centre
- **THEN** the paragraph resolves to left alignment

#### Scenario: A cyclic basedOn chain terminates
- **WHEN** style A is `basedOn` B and B is `basedOn` A
- **THEN** resolution terminates and reports the properties reachable before the cycle closes

### Requirement: Layout reads resolved properties

`layoutBody` SHALL derive each line's content box from resolved indentation and
alignment, its vertical advance from resolved spacing, and its tab positions
from resolved tab stops rather than a fixed per-character advance. Wrapping
SHALL continue to be decided by flow tokens; run boundaries SHALL continue to
affect paint slices only.

#### Scenario: Indentation narrows the content box
- **WHEN** a paragraph resolves 720 twips of left indent
- **THEN** its lines start 720 twips inside the content box and wrap 720 twips earlier

#### Scenario: A first-line indent applies only to the first line
- **WHEN** a paragraph resolves a 360-twip first-line indent and wraps
- **THEN** the first line starts 360 twips inside the others

#### Scenario: A tab advances to the next stop
- **WHEN** a paragraph resolves a left tab stop at 1440 twips and its text contains a tab before that position
- **THEN** the glyph after the tab begins at 1440 twips, not at a fixed character advance past the tab

#### Scenario: Spacing changes vertical advance without changing wrapping
- **WHEN** a paragraph resolves 240 twips of space before
- **THEN** its first line's baseline moves down 240 twips
- **AND** the same words land on the same lines as with no spacing

### Requirement: The metrics port measures a resolved run style, and publishes font metrics

`MetricsPort.advance` SHALL take a resolved run style, not a `{ bold, italic }`
pair, so font family, size and the properties that affect advance participate in
measurement. The port SHALL additionally publish baseline, ascent and descent so
caret geometry derives from font metrics rather than the line box.

Measurement SHALL remain deterministic and SHALL remain linear in text length:
this signature widening lands in a loop called once per code unit, in which four
independent superlinear defects have already been found and fixed.

#### Scenario: Font size changes measured advance
- **WHEN** the same text resolves 11pt in one paragraph and 22pt in another
- **THEN** the 22pt paragraph measures approximately twice the advance and wraps earlier

#### Scenario: Caret height comes from font metrics
- **WHEN** a caret is derived on a line whose font ascent and descent are known
- **THEN** its rect height is the ascent plus descent, not the full line box height

#### Scenario: Measurement stays linear
- **WHEN** paragraph length doubles four times
- **THEN** `advance` call count grows approximately linearly, and the existing advance-call guard stays green

### Requirement: Painted runs carry resolved values, not literals

`GlyphRun` SHALL be emitted with the resolved font family, size, colour,
underline and strike for its run. The display bridge MUST NOT emit a hardcoded
family, a size derived from line height, or a hardcoded colour.

#### Scenario: A coloured, sized run paints its own values
- **WHEN** a run resolves Times New Roman, 14pt, red
- **THEN** its `GlyphRun` reports that family, that size in px, and that colour

#### Scenario: No literal font survives in the bridge
- **WHEN** the display bridge is inspected
- **THEN** it contains no hardcoded font family, and no `fontSizePx` derived from item height
