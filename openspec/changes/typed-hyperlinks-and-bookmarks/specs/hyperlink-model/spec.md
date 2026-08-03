## ADDED Requirements

### Requirement: Hyperlinks are typed canonical nodes in both target forms

The canonical tree SHALL type `w:hyperlink` (`CT_Hyperlink`) with `@r:id`, `@w:anchor`, `@w:tooltip`, `@w:history`, `@w:docLocation`, and `@w:tgtFrame`, its `run` children joining the paragraph's inline sequence. An `@r:id` target SHALL resolve through the owning part's relationships; `TargetMode="External"` classifies the link as external. A `w:hyperlink` whose relationship is missing or dangling SHALL demote to its runs — the text stays modeled and editable, only the link identity is lost.

#### Scenario: External link types through its relationship

- **WHEN** paragraph 9.1 of the comprehensive fixture loads, holding `w:hyperlink r:id` runs for `https://example.com` and `https://www.anthropic.com`, both `TargetMode="External"`
- **THEN** each is a typed hyperlink with its resolved external target and its runs in the paragraph's inline sequence

#### Scenario: Internal link types by anchor

- **WHEN** paragraph 9.2 loads, holding `w:hyperlink w:anchor="section1|section6|section12"` runs
- **THEN** each is a typed internal hyperlink carrying its anchor name

#### Scenario: Non-run content stays generic without hiding the runs

- **WHEN** a `w:hyperlink` contains content other than runs and range markers (a drawing, a field, an SDT)
- **THEN** the hyperlink itself stays typed, its runs are modeled, and the unknown children remain `generic` at their positions

### Requirement: Bookmarks are zero-length point anchors

The canonical tree SHALL type `w:bookmarkStart` (`@w:id`, `@w:name`) and `w:bookmarkEnd` (`@w:id`) as zero-length anchors that occupy no text offsets, preserve across edits, and keep the split placement pinned by `tree-op-split-anchors.test.ts`.

#### Scenario: All fixture bookmarks type

- **WHEN** the comprehensive fixture loads
- **THEN** all 22 bookmarks (`section1`–`section22`, ids 10–31) are typed anchors on their `Heading1` paragraphs

#### Scenario: Splitting at a bookmark keeps it with its heading text

- **WHEN** a paragraph carrying a `w:bookmarkStart` is split by an edit
- **THEN** the anchor lands per the existing split-anchor placement rules and round-trips with its authored id and name

### Requirement: Runtime sinks receive only the sanitized projection; save receives only the authored value

Every hyperlink target SHALL be projected once through `sanitizeHref` at tree construction. Paint, navigation, clipboard, and the popover SHALL consume only the projection; a refused scheme (`javascript:`, `data:`, `vbscript:`, `file:`) yields an inert link with no runtime `href` and no activation path. Serialization SHALL re-emit the authored raw target through `escapeXml`, unchanged by sanitization. Loading a document SHALL perform no network request for any hyperlink target.

#### Scenario: javascript target is inert but preserved

- **WHEN** a document with `w:hyperlink` targeting `javascript:alert(1)` is loaded, activated, and saved
- **THEN** the painted link has no `href`, no activation occurs from any gesture
- **AND** the saved document re-emits the authored target byte-for-byte under XML escaping

#### Scenario: No zero-click fetch

- **WHEN** the comprehensive fixture loads with its two external targets
- **THEN** no request to either host is issued at any point before an explicit user activation

### Requirement: Hyperlink editing operations are single-transaction tree ops

`TreeDocOp` SHALL implement the declared `insertHyperlink` and `removeHyperlink` contract edits plus set-target (change URL or anchor, optionally replacing display runs). Unlink SHALL splice the hyperlink's children into the paragraph in place, preserving run formatting and contained anchors. Each operation SHALL be one `transact` call and therefore one undo step. The `hyperlinkAt` query SHALL return `HyperlinkInfo` for a position inside a typed hyperlink and `null` elsewhere, replacing the typed-empty read.

#### Scenario: Unlink keeps text and formatting

- **WHEN** unlink runs on the `Example.com` hyperlink in paragraph 9.1
- **THEN** the paragraph text is unchanged, the run keeps its character formatting, and no `w:hyperlink` remains around it after save

#### Scenario: Edit target rewrites the relationship

- **WHEN** set-target changes `https://example.com` to `https://example.org`
- **THEN** the relationship (or a new one) carries the new target, the old relationship is not left dangling as authored content, and undo restores the original in one step

#### Scenario: hyperlinkAt answers inside and outside

- **WHEN** `hyperlinkAt` is queried at a position inside the `Example.com` runs and at a position in plain text
- **THEN** it returns the link's `HyperlinkInfo` (href, range) for the first and `null` for the second
