## ADDED Requirements

### Requirement: A symbol run renders its glyph without widening the model

A `w:sym` run child (§17.3.3.30) SHALL render its character as a rendering-only projected glyph over ZERO model width, because the canonical tree keeps `w:sym` generic and the store's offset authority gives a generic run child no offsets. The caret, selection, and `paragraphTextOf` SHALL be unaffected by whether the glyph resolved.

A symbol font's character SHALL normalize through the same 0xF000 PUA page mapping as list bullets, and the bare-byte spelling SHALL be accepted as well. Both attributes are attacker-controlled, so parsing SHALL fail closed to no glyph: strict bounded hex, no surrogates, no noncharacters, capped font-family length.

#### Scenario: A Wingdings symbol paints

- **WHEN** a run holds a `w:sym` with `@w:font="Wingdings"` and `@w:char="F0FC"`
- **THEN** the mapped glyph paints at the symbol's insertion point in the symbol font
- **AND** the paragraph's model text is no longer than it was when the glyph painted nothing

#### Scenario: A hostile symbol fails closed

- **WHEN** a `w:sym` carries a malformed code, a surrogate codepoint, or an oversized font name
- **THEN** no glyph paints and the run's own text is unaffected

### Requirement: A SYMBOL field renders from its instruction

A `SYMBOL` field (§17.16.5.60) SHALL render the character its instruction names, complex and `w:fldSimple` alike, because real files carry no cached result for it — Word always re-renders it from the instruction. The `\f` switch SHALL override the font, `\s` SHALL set the size in whole points, and `\u` SHALL read the code as a Unicode codepoint with no symbol-page normalization; without `\u`, glyph resolution SHALL reuse the same PUA mapping and validation as `w:sym`.

The instruction is attacker-controlled. Tokenization SHALL be one bounded pass over a length-capped string, numeric parses SHALL be length-capped before conversion, and every malformed or hostile instruction SHALL resolve to null so the field falls back to whatever it painted before. A synthesized glyph SHALL win over stale cached text, since the instruction is the authority Word itself re-renders from.

#### Scenario: The named character paints

- **WHEN** a complex field carries the instruction `SYMBOL 252 \f "Wingdings" \s 14`
- **THEN** the mapped glyph paints in Wingdings at 14 points over the field's single model unit

#### Scenario: A hostile instruction stays inert

- **WHEN** a `SYMBOL` instruction carries an out-of-range code, a surrogate, or an overflowing token
- **THEN** nothing is synthesized and the field paints what it painted before

### Requirement: MACROBUTTON and GOTOBUTTON render display text and nothing else

`MACROBUTTON` and `GOTOBUTTON` fields (§17.16.5.36, §17.16.5.31) SHALL render the display text after their first argument, complex and `w:fldSimple` alike, because real files carry no cached result for them. The macro name or jump target SHALL be consumed and discarded: the engine SHALL NOT execute a macro, resolve a target, navigate, or wire a click to the painted text. A non-empty cached display SHALL win over synthesis. A trailing formatting switch SHALL be stripped, and a backslash inside legitimate display text SHALL survive.

#### Scenario: The button text paints

- **WHEN** a field carries `MACROBUTTON AcceptAllChanges Double-click here`
- **THEN** `Double-click here` paints over the field's single model unit
- **AND** clicking it does nothing

#### Scenario: The macro name never leaks

- **WHEN** a `MACROBUTTON` or `GOTOBUTTON` field renders
- **THEN** no part of the macro name or jump target is painted, stored on the span, or reachable from a DOM sink

### Requirement: Legacy checkbox and dropdown fields render their w:ffData state

A `FORMCHECKBOX` field SHALL paint ☒ (U+2612) when its `w:ffData` state is checked and ☐ (U+2610) when it is not, resolving `w:checked` first and `w:default` in its absence. The state SHALL be the authority — a stale cached glyph SHALL NOT win. An explicit `w:size` SHALL set the glyph size; `w:sizeAuto` SHALL keep the run's own.

A `FORMDROPDOWN` field SHALL prefer its cached result and SHALL synthesize the selected `w:listEntry` (per `w:result`, defaulting to the first) only when the file cached no result at all — a cached result that exists but is hidden stays hidden.

The `w:ffData` reader SHALL be bounded and SHALL read state only: macro names (`w:entryMacro`, `w:exitMacro`), `w:name`, and help/status text SHALL never be read. Every malformed shape SHALL fail closed to the previous behaviour (cached text or nothing).

#### Scenario: A checked checkbox paints checked

- **WHEN** a `FORMCHECKBOX` field's `w:ffData` carries `w:checked` on
- **THEN** ☒ paints over the field's single model unit
- **AND** with no `w:checked` and no `w:default`, ☐ paints

#### Scenario: The dropdown shows its selection

- **WHEN** a `FORMDROPDOWN` field caches no result and its `w:ffData` selects the second `w:listEntry`
- **THEN** that entry's text paints
- **AND** with an empty entry list, nothing is synthesized

### Requirement: Nested page fields evaluate live inside complex fields

A `PAGE`, `NUMPAGES`, or `SECTIONPAGES` field nested inside another complex field's cached result SHALL evaluate per sheet, at any nesting level from 2 up to the field-nesting cap, exactly as the `w:fldSimple` lane already does — so a `STYLEREF` wrapping `PAGE` never stamps the producer's saved sheet number onto every page. The inner field's cached digits SHALL be skipped and the live value appended when the inner field's own `end` closes.

The tracker SHALL be level-aware: it records the nesting level whose `separate` armed it, and only that level's matching `end` appends and disarms. Everything at a deeper level while armed SHALL be treated as part of the replaced inner result. An inner cached result the file wholly suppresses SHALL stay suppressed — a live number never resurrects it. Detection and projection SHALL share one allowlist so they cannot drift, and nested field state SHALL survive a descent into an inline drawing.

#### Scenario: A PAGE under STYLEREF counts per sheet

- **WHEN** a footer holds a complex `STYLEREF` field whose cached result contains a complex `PAGE` field
- **THEN** each page paints its own number in place of the cached digits
- **AND** the rest of the `STYLEREF` cached result paints unchanged

#### Scenario: A deeper begin cannot clear tracking

- **WHEN** a tracked inner field's cached result itself contains a begin/end pair
- **THEN** the deeper pair is ignored and the tracked field's own end still appends the live value

### Requirement: A deleted field instruction is recognized

Live `w:instrText` and deleted `w:delInstrText` chunks SHALL buffer separately at every nesting level. The effective instruction SHALL be the live buffer whenever any live instruction element was seen — even an empty one — and the deleted buffer only when none was. The two SHALL never be merged into one string, because a merged instruction is neither field's code.

A field whose whole code is pending deletion therefore SHALL keep rendering from its deleted instruction, and its result SHALL carry the display-mode consequences its enclosing revision dictates. Synthesis SHALL be revision-aware: a result the display mode resolved away is free to be filled, and a result the file hides stays hidden. A field demoted from the typed lane SHALL still shade like any other field.

#### Scenario: A field with only a deleted code still renders

- **WHEN** a complex field's instruction is entirely `w:delInstrText`
- **THEN** the instruction is recognized and the field renders as that kind

#### Scenario: The live code wins beside a deleted one

- **WHEN** a tracked edit leaves `w:delInstrText PAGE` beside a live `w:instrText NUMPAGES` in one field
- **THEN** the field renders as `NUMPAGES` and the deleted chunks contribute nothing
