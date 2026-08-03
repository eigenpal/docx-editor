## ADDED Requirements

### Requirement: Document search derives matches from the canonical tree

The engine SHALL derive text matches from the canonical main-part tree — never the DOM, never the layout — over BODY-STORY paragraphs, in document order. Each match SHALL carry the engine's own address (`blockId`, `start`, `length`) and the positional one a find UI needs (`paragraphIndex`, `runIndex`, `runOffset`), both derived from the same walk. Offsets SHALL be in `paragraphTextOf`'s vocabulary — UTF-16, with a tab and a hard break counted as one character each — so a match is directly acceptable to `setSelection`.

#### Scenario: Matches are found in document order with paragraph offsets

- **WHEN** a document whose first paragraph is "Exhibit A is attached." and whose second is "See Exhibit B." is searched for "Exhibit"
- **THEN** two matches are returned, the first at paragraph 0 offset 0 and the second at paragraph 1 offset 4, each carrying its own paragraph's block id

#### Scenario: Run addressing follows the same walk as the offsets

- **WHEN** a paragraph is "Go to " followed by a hyperlink containing the runs "Example" and ".com", followed by " now."
- **THEN** a match on "com" reports `start` 14, `runIndex` 2 and `runOffset` 1 — runs inside the hyperlink counted in place

#### Scenario: A tab counts as one character

- **WHEN** a paragraph begins with a tab followed by "Exhibit"
- **THEN** the match reports `start` 1, matching the offset the tree ops use

#### Scenario: Table-cell text is not searched

- **WHEN** a document has "Body Exhibit." as a body paragraph and "Cell Exhibit." inside a table cell, and is searched for "Exhibit"
- **THEN** exactly one match is returned, at paragraph index 0

### Requirement: Matching is non-overlapping, case-foldable, and word-boundable

Matching SHALL count NON-OVERLAPPING occurrences, which is what a find dialog counts. It SHALL be case-insensitive unless `matchCase` is set, and SHALL require a non-word character (or a paragraph edge) on both sides when `wholeWord` is set, where a word character is any Unicode letter or number or the underscore.

#### Scenario: Overlapping occurrences are counted once

- **WHEN** "aaaa" is searched for "aa"
- **THEN** two matches are returned, at offsets 0 and 2

#### Scenario: Case sensitivity is opt-in

- **WHEN** "Exhibit and exhibit and EXHIBIT." is searched for "exhibit"
- **THEN** three matches are returned by default, and one with `matchCase`

#### Scenario: Whole-word rejects glued matches

- **WHEN** "cat cats concat cat_ 9cat cat." is searched for "cat" with `wholeWord`
- **THEN** only the standalone occurrences are returned

### Requirement: Case folding preserves offsets

Case folding for an insensitive search SHALL NOT change the length of the text it folds. Where a character's lower case occupies a different number of UTF-16 code units, that character SHALL be compared case-sensitively instead. A missed case-insensitive match is the acceptable degradation; a match reported at a slid offset is not, because the editor would then select the wrong text.

#### Scenario: An expanding character does not slide later offsets

- **WHEN** a paragraph reading "İstanbul Exhibit" (U+0130, whose lower case is two code units) is searched for "exhibit"
- **THEN** one match is returned at offset 9, the offset the paragraph's own text has

### Requirement: Search is bounded against hostile input

Both the query (host input) and the document text (file content) are untrusted. Search SHALL NOT compile a pattern from either — a regex built from either is a catastrophic-backtracking hazard — and SHALL scan by literal substring only. A query longer than 256 characters SHALL be refused. An empty query SHALL match nothing rather than everything. The scan SHALL stop at 2000 matches and report that it stopped early, so a caller can show an honest "2000+" instead of an exact total it does not have.

#### Scenario: A regex-shaped query is literal text

- **WHEN** a document containing "a literal .* stays literal" is searched for `.*`
- **THEN** one match is returned, at the literal ".*", and searching a 64-character run for `(a+)+$` returns none

#### Scenario: An empty or over-long query matches nothing

- **WHEN** the query is empty, or longer than 256 characters
- **THEN** no matches are returned

#### Scenario: A one-character query against a long document is capped

- **WHEN** a paragraph of 3000 identical characters is searched for that character
- **THEN** 2000 matches are returned and the result reports that it was truncated

### Requirement: Match context is bounded at the derivation boundary

Each match SHALL carry the paragraph text immediately before and after it, so a results list can show the match in its sentence without re-reading the document. That text is authored file content, so it SHALL be length-bounded and have its control characters flattened here, at the derivation boundary — not at the point of render.

#### Scenario: Context accompanies the match

- **WHEN** a paragraph reading "the Walter SaaS Services as described in this Exhibit A ("Support Services")." is searched for "Exhibit"
- **THEN** the match carries the preceding and following text, bounded, with no control characters

### Requirement: Selecting a match moves the caret and reveals its page

`Editor.selectMatch` SHALL select exactly the matched span and bring its page into view. Revealing SHALL be separate from selecting and SHALL resolve through layout rather than the DOM, so it works for a page that has not been materialised. A match without a block id or with non-integer offsets SHALL be refused with `invalidArgs` rather than selecting somewhere else. `Editor.findMatches` SHALL remain a pure read that never moves the caret.

#### Scenario: The selection covers the match

- **WHEN** the second match of "exhibit" in a document whose second paragraph is "See Exhibit B" is selected
- **THEN** the selection runs from offset 4 to offset 11 of that paragraph, and the match's page is revealed

#### Scenario: A malformed match is refused

- **WHEN** `selectMatch` is called with an empty block id
- **THEN** it returns `{ ok: false, code: 'invalidArgs' }` and the selection does not move
