## MODIFIED Requirements

### Requirement: A simple field paints its cached result

`w:fldSimple` (§17.16.19) SHALL paint its cached result — the child runs it carries — as one projected piece. It SHALL continue to occupy exactly one UTF-16 model unit however long that result is, so `paragraphTextOf`, selection and the caret keep agreeing that the field is one thing.

This supersedes the exclusion of "body fields (including inert generic `w:fldSimple`)" in `semantic-paragraph-layout`, for rendering only. The instruction in `@w:instr` SHALL NOT be displayed and SHALL NOT be executed or resolved, and a nested field's markers and instruction inside the result SHALL contribute no text.

An empty result SHALL paint nothing UNLESS the instruction names one of the synthesizing kinds — `SYMBOL`, `MACROBUTTON`, `GOTOBUTTON`, `FORMCHECKBOX`, `FORMDROPDOWN`, and the live page fields — whose display the engine derives from the instruction, `w:ffData` state, or the sheet, because those are exactly the fields real files cache no result for. Synthesis SHALL fill only a result that is genuinely absent or that the display mode resolved away, never one the file carries but hides.

#### Scenario: The result is visible

- **WHEN** a paragraph holds text, a `w:fldSimple` whose result is a cross-reference, and more text
- **THEN** all three paint, in order
- **AND** the text after the field keeps the offsets it had when the field painted nothing

#### Scenario: An empty non-synthesizing result still holds its place

- **WHEN** a `w:fldSimple` carrying a `REF` instruction has no result content
- **THEN** nothing paints for it and it still occupies its single model unit

#### Scenario: An empty synthesizing result renders

- **WHEN** a `w:fldSimple` carrying a `SYMBOL` or `MACROBUTTON` instruction has no result content
- **THEN** the instruction-derived display paints over that same single model unit

#### Scenario: A hidden result is not resurrected

- **WHEN** a synthesizing field's cached result exists but the file hides it
- **THEN** nothing is synthesized over it

#### Scenario: The instruction never reaches the page

- **WHEN** a `w:fldSimple` carries an instruction in `@w:instr`
- **THEN** no part of that instruction is painted
