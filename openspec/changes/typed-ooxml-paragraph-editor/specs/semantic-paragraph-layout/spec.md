## ADDED Requirements

### Requirement: Distributed paragraph final lines

The layout engine SHALL stretch the final line of a paragraph with `w:jc` set to `distribute`. It SHALL apply this rule in table cells and each passage beside a floating object. Ordinary justified paragraphs SHALL retain their existing final-line policy.

#### Scenario: Distributed paragraph ends beside a float

- **GIVEN** a distributed paragraph whose final line holds text in two passages beside a floating object
- **WHEN** layout aligns that line
- **THEN** text fills each passage without crossing the floating object
- **AND** the source text, formatting, and source positions remain unchanged

#### Scenario: Distributed line spreads its characters

- **GIVEN** a left-to-right distributed paragraph in a package with a legacy compatibility mode or no mode, or in a modern-mode package whose styles part has a `w:rPrDefault` element, even an empty one
- **WHEN** layout aligns any line of the paragraph
- **THEN** each space between the first and last character first takes a share of the slack: up to 45 percent of its own advance in a modern mode, and up to its face's average character width less its own advance in a legacy mode
- **AND** the rest of the slack goes in equal steps after every character, so a single word reaches both edges
- **AND** a line whose spaces can take all its slack sets as a justified line
- **AND** a single character, or a single right-to-left word, is centered
- **AND** in a modern mode, a run whose effective `w:kern` is not 0 and is at most its font size opens no gap inside its words or against the letters beside it, and still opens one after each space and at each East Asian character
- **AND** a single kerned word in a modern mode is centered, and a legacy mode spreads kerned runs too
- **AND** caret placement and hit testing follow the spread characters
- **AND** screen paint keeps underline, highlight, and revision marks continuous across the gaps, and the PDF joins a single underline across them

#### Scenario: East Asian line spreads every character gap

- **GIVEN** a justified line, or a distributed line that does not spread every character, that holds East Asian text
- **WHEN** layout aligns the line
- **THEN** each space first takes up to 45 percent of its own advance, and each automatic gap between East Asian and other text grows up to twice its size
- **AND** the rest of the slack goes in equal steps to every boundary between two East Asian characters, punctuation and brackets included, to every boundary with an automatic gap, and to every boundary after a space
- **AND** a character counts as East Asian by its code point or by its East Asian font slot
- **AND** a justified line opens no gap between two Korean syllables, and a distributed line does
- **AND** text in other scripts keeps its letters together, and a boundary between East Asian and other text with no automatic gap does not stretch

#### Scenario: Document defaults turn East Asian spacing off

- **GIVEN** a package whose styles part has a `w:rPrDefault` element that names no East Asian font in `w:rFonts` (`w:eastAsia` or `w:eastAsiaTheme`), in any compatibility mode
- **WHEN** layout breaks and aligns a paragraph that holds East Asian text
- **THEN** a justified line opens no gap between East Asian characters and stretches only its spaces
- **AND** no automatic spacing opens between East Asian and Latin text or digits
- **AND** a distributed paragraph spreads every character and keeps automatic spacing only beside East Asian text whose run, or one of its styles, names an East Asian font
- **AND** a styles part without `w:rPrDefault`, or one whose `w:rPrDefault` names an East Asian font, keeps both kinds of spacing

#### Scenario: Distributed line has nothing to stretch

- **GIVEN** a distributed paragraph in a modern-mode package with no `w:rPrDefault` element, or a right-to-left distributed paragraph
- **WHEN** layout aligns a line that holds a single word or a single character
- **THEN** the line is centered in its measure
- **AND** spaces before the line's first character are not stretched
- **AND** a justified paragraph with the same line keeps it at its start edge
- **AND** a distributed line with a float advance keeps its reserved positions

#### Scenario: Distributed line with a tab

- **GIVEN** a left-to-right distributed paragraph
- **WHEN** layout aligns a line that holds a tab
- **THEN** the text before the last tab and every tab position stay where the tabs put them
- **AND** when the last tab reaches a left stop, the text after it stretches from that stop to the line end as a distributed line does
- **AND** when the last tab reaches a right, center, or decimal stop, or the text after it has nothing to stretch, the whole line is centered in its measure

### Requirement: Keeps beside a row taller than a page

A `w:keepNext` paragraph, a chain of them, or a kept row before a `w:cantSplit` table row taller than a page SHALL move to the next page once, and the row SHALL start on the page after it. Content that already starts its page SHALL stay there. This rule SHALL apply in compatibility modes 14 and 15, for tables with one row or more.

#### Scenario: A caption before a one-row table with a tall row

- **GIVEN** a `w:keepNext` paragraph below other content, before a table whose only row has `w:cantSplit` and is taller than a page
- **WHEN** layout paginates the body
- **THEN** the paragraph starts the next page by itself
- **AND** the row starts on the page after the paragraph and splits there

#### Scenario: A caption at the top of a page before a tall row

- **GIVEN** a `w:keepNext` paragraph at the top of a page, before a `w:cantSplit` row taller than a page
- **WHEN** layout paginates the body
- **THEN** the paragraph stays on its page and the row starts on the next page

### Requirement: Header rows above a row taller than a page

Authored header rows SHALL NOT hold a `w:cantSplit` body row taller than a page on their page, even at the page top. Only repeated header rows SHALL hold it. In compatibility mode 15 and later, authored header rows below other content SHALL first move to the next page by themselves, together with a kept group that opens the body. A header row group taller than a page SHALL place and keep as body rows.

#### Scenario: Authored header rows above a tall row

- **GIVEN** a table whose authored header row opens a page, followed by a `w:cantSplit` body row taller than a page
- **WHEN** layout paginates the body
- **THEN** the header row stays alone on its page
- **AND** the body row starts on the next page, below a repeated header row in compatibility mode 14 and earlier
- **AND** in compatibility mode 15 and later, the body row takes that whole page and the header row repeats on the page after it

### Requirement: Right-to-left lines beside floating objects

The layout engine SHALL fill the passages that a floating object leaves a right-to-left line from right to left. Each part of a bidirectional line SHALL align inside its own passage, and bidirectional reordering SHALL stay inside that passage.

#### Scenario: Centered right-to-left text beside a float

- **GIVEN** a centered right-to-left paragraph beside a floating object in the middle of the line
- **WHEN** layout breaks and aligns its lines
- **THEN** the first words of each line fill the passage to the right of the object
- **AND** the text continues in the passage to the left of the object
- **AND** each part is centered in its own passage without crossing the object
- **AND** a single centered word is centered in the passage to the right of the object
- **AND** carets and hit testing resolve to positions inside the passages
- **AND** the source text, formatting, and source positions remain unchanged

#### Scenario: Wrap sides beside a right-to-left line

- **GIVEN** a right-to-left paragraph beside a floating object with a one-sided wrap or wrap distance
- **WHEN** layout breaks its lines
- **THEN** the wrap side and the wrap distance keep their physical sides
- **AND** square wrapping on the largest side with equal sides keeps text on the physical left in compatibility mode 15 and later, and on the physical right in earlier modes, in either paragraph direction

### Requirement: Native semantic layout records

The semantic layout engine SHALL produce revision-tagged page, paragraph-fragment, line, and style-span records directly from the committed canonical tree and derived style resources.

#### Scenario: Paragraph crosses a page

- **WHEN** a paragraph's measured lines exceed the remaining page content area
- **THEN** ordered paragraph fragments reference the same paragraph identity across the two resulting pages

### Requirement: Source-addressable lines and spans

Every line and style span SHALL retain stable story/paragraph identity and canonical UTF-16 source ranges sufficient for semantic navigation and selection.

#### Scenario: Mixed formatting is laid out

- **WHEN** a line contains adjacent text with different resolved run formatting
- **THEN** its style spans cover the line's source text in order without gaps or overlaps

### Requirement: Accepted paragraph layout boundary

Semantic layout SHALL implement the D8 paragraph property boundary and the section pagination rules in the acceptance scenario. Features outside that boundary SHALL require separate layout acceptance.

#### Scenario: Paragraph layout acceptance scope

- **WHEN** semantic paragraph layout processes the D8 acceptance fixture
- **THEN** Semantic layout SHALL resolve and represent the D8 run and paragraph property boundary, including authored whitespace, tabs, line hard breaks, and typed `w:br w:type="page"` and `w:br w:type="column"` breaks; `w:spacing` before/after with collapsed adjacent spacing; `w:contextualSpacing` in body flow; line spacing under all three `w:lineRule` values; and all six `w:pBdr` edges. Border resolution SHALL place `top` and `bottom` as flow height, publish `between` in place of `bottom` where a paragraph continues into an identically bordered neighbour, and publish `left`, `right`, and `bar` outside the text column without reflowing it. Section-aware pagination SHALL honour per-section page size and margins, equal- and unequal-width `w:cols` geometry with bounded gaps and separator rules, default/`nextPage` and `continuous` section breaks, `titlePage`, and per-section read-only header/footer furniture inheritance, including bounded allowlisted complex `PAGE`/`NUMPAGES` projection for page-furniture numbering. Content SHALL fill each section column before opening another physical sheet, and an explicit column break SHALL advance to the next column (or the next sheet after the final column). A multi-column section that ends in a continuous section break SHALL balance its final open sheet across its columns, while preserving earlier sheets. In compatibility modes before 15, an enabled `w:compat/w:noColumnBalance` setting SHALL instead preserve natural fill-first column flow; compatibility mode 15 and later SHALL ignore it. An absent or explicitly disabled setting SHALL retain balancing. A following continuous section SHALL begin below the tallest in-flow column on the final sheet in either mode. A `continuous` boundary SHALL share the preceding sheet only when the section's geometry and furniture are identical and the sheet is still open, and SHALL otherwise start a new sheet rather than publish a mixed one. Hyperlinks, body fields (including inert generic `w:fldSimple`), comments, tracked changes, images, content controls, header/footer editing, notes, paragraph-border authoring, `w:between` in table-cell and header/footer flow, border `w:shadow` and `themeColor`, and `evenPage`/`oddPage`/`nextColumn` section semantics SHALL remain outside this layout acceptance.

#### Scenario: Accepted properties affect layout and spans

- **WHEN** accepted run properties, paragraph spacing/indents/tabs/numbering, pagination controls, `w:spacing` before/after, `w:contextualSpacing`, any `w:pBdr` edge, inline page breaks, or per-section geometry occur in the paragraph fixture
- **THEN** page, fragment, line, and style-span output reflects each property with stable source ranges

#### Scenario: Consecutive paragraphs share an exact-height positioned frame

- **WHEN** consecutive body paragraphs declare identical bounded `w:framePr` values with numeric page, margin, or text anchors and `w:h` paired with `w:hRule="exact"`
- **THEN** layout stacks their content in one positioned frame, uses the authored width and height for wrapping exclusion, clips painted content to that frame, and preserves every paragraph identity and source range

#### Scenario: Invalid or unsupported frame data is encountered

- **WHEN** `w:framePr` contains an out-of-range value, an unknown enumeration value, unsupported nested content, or a frame group that cannot leave usable room on a fresh sheet
- **THEN** semantic layout refuses the positioned-frame projection and keeps the paragraph in ordinary flow without approximating the frame

#### Scenario: Wrapping defaults do not create positioned frames

- **WHEN** direct or inherited `w:framePr` supplies wrapping defaults without size, position, or anchor properties
- **THEN** paragraphs retain ordinary flow and their explicit page breaks

#### Scenario: Frame attributes inherit individually

- **WHEN** direct frame properties override part of a paragraph style's frame properties
- **THEN** unspecified attributes retain their inherited values and equivalent adjacent frames remain grouped

#### Scenario: Inline pictures remain in their frame

- **WHEN** a supported frame contains inline pictures
- **THEN** their line geometry, alignment, clipping, and following text use the shared frame

#### Scenario: A frame stays outside the body area

- **WHEN** a frame wrapping band stays entirely above or below the body area
- **THEN** it does not advance the text position of a following continuous section or create an extra empty page

#### Scenario: Frame height rules are resolved

- **WHEN** a bounded paragraph frame uses explicit `hRule="auto"`, `hRule="atLeast"`, or `hRule="exact"`
- **THEN** layout respectively uses content height, the greater of content and authored height, or the authored clipped height, and ignores `w:h` when the rule is `auto`

#### Scenario: The frame height rule is omitted

- **WHEN** a frame supplies positive `w:h` without `w:hRule`
- **THEN** layout uses that height as a minimum; zero or omitted height uses content height

#### Scenario: Frame width is automatic

- **WHEN** consecutive matching frame paragraphs omit `w:w`
- **THEN** layout uses the containing text column as their shared frame width and applies paragraph alignment inside that width

#### Scenario: Frame alignment supersedes offsets

- **WHEN** `xAlign` or a permitted `yAlign` is present
- **THEN** layout aligns the complete frame within its page, margin, or text anchor box and ignores the corresponding numeric offset

#### Scenario: Inside and outside alignment follows the sheet

- **WHEN** a frame uses horizontal `inside` or `outside`
- **THEN** layout selects the binding or outer edge from the physical page parity

#### Scenario: Every frame wrap value is resolved

- **WHEN** a frame uses `auto`, `around`, `tight`, `through`, `none`, or `notBeside`
- **THEN** layout applies deterministic rectangular scanline exclusion, with `auto` using `around` and `none`, `notBeside`, or vertical `inline` alignment preventing beside wrapping

#### Scenario: Margin drop cap is positioned outside the text column

- **WHEN** a bounded simple frame declares `dropCap="margin"` and a valid line count
- **THEN** layout sizes it from its content, aligns its baseline to the requested anchor-line band, and places it outside the text column in the paragraph direction

#### Scenario: Dropped cap respects the supported paragraph direction

- **WHEN** a bounded simple frame declares `dropCap="drop"`
- **THEN** layout places a left-to-right cap at the leading text edge and falls back to ordinary flow for a right-to-left cap

#### Scenario: Multiline drop caps retain ordinary flow

- **WHEN** a dropped or margin cap wraps into more than one line
- **THEN** layout retains ordinary flow so every cap line stays clear of the following body text

#### Scenario: Locked frame survives supported edits

- **WHEN** a frame declares `anchorLock` and supported text, property, split, or join operations edit its frame or anchor paragraphs
- **THEN** the canonical order and normalized save keep the frame directly before the same logical anchor, and unsupported frame movement is not approximated

#### Scenario: Negative frame position avoids earlier-text overlap

- **WHEN** a frame declares a bounded negative `w:y`
- **THEN** layout retains page-relative and margin-relative positions, but a negative text-relative position falls back to ordinary flow

#### Scenario: Inline page break splits a paragraph across pages

- **WHEN** a paragraph contains `w:br w:type="page"` between inline content
- **THEN** layout places content before the break on the current page and content after the break on the next page while preserving one paragraph identity

#### Scenario: Multi-column section flows across regions

- **WHEN** a section declares equal or explicit unequal `w:cols` geometry and contains natural overflow or `w:br w:type="column"`
- **THEN** layout uses each authored column width and gap, advances through columns before sheets, preserves paragraph identity across column fragments, and publishes separator geometry when `w:sep` is enabled

#### Scenario: Authored compatibility settings disable column balancing

- **WHEN** parsed settings contain an enabled `w:compat/w:noColumnBalance` option and the compatibility mode is before 15
- **THEN** a multi-column section fills columns in source order without balancing
- **AND** a following continuous section clears the tallest final-sheet column
- **AND** an absent or explicitly disabled option retains balancing, and settings and document trees remain unchanged
- **AND** warm layout matches a cold layout after the option changes
- **AND** in compatibility mode 15 and later the option has no effect and the section balances

#### Scenario: A continuous break balances the columns before it

- **WHEN** a multi-column section whose natural layout is one open sheet is followed by a `continuous` section break
- **THEN** layout divides the section's content across its columns at the shortest fitting column height, splitting tables at row boundaries where needed, and the following section resumes below the whole balanced region

#### Scenario: Paragraph spacing and borders affect fragment boxes

- **WHEN** adjacent paragraphs declare `w:spacing` before/after and/or a paragraph declares a `w:pBdr` box
- **THEN** fragment vertical placement applies collapsed before/after spacing, reserves top- and bottom-border extent as flow height, and publishes the side and bar rules beside the unchanged text column

#### Scenario: Consecutive identically bordered paragraphs form one box

- **WHEN** adjacent body paragraphs resolve the same border set and the set declares `w:between`
- **THEN** the group opens above its first member and closes below its last, interior boundaries carry the `between` rule rather than a bottom border, and a differing border set or an unbordered neighbour ends the group

#### Scenario: Continuous section shares the preceding sheet

- **WHEN** a section declares `w:type w:val="continuous"` and its geometry and furniture match the preceding section on a still-open sheet
- **THEN** its content continues down that sheet from the live flow cursor instead of starting a new page, and a differing geometry or a closed sheet starts a new page instead

#### Scenario: Multi-section document paginates per section

- **WHEN** a body story contains multiple sections ended by paragraph-level or body `w:sectPr` with distinct geometry and read-only header/footer references
- **THEN** layout paginates each section against its own page size/margins, starts non-continuous sections on a new page, and attaches the correct per-section furniture including `titlePage` inheritance

#### Scenario: Note numbering resolves from the section only

- **WHEN** settings.xml declares `w:footnotePr` or `w:endnotePr` and a section's own `w:sectPr` declares none, or only some, of `w:numFmt`, `w:numStart`, `w:numRestart`, and footnote `w:pos`
- **THEN** that section's notes, the painted note marks, and refreshed NOTEREF results use the section's own values and the defaults (decimal footnotes, lowerRoman endnotes, start 1, continuous, footnotes at the page bottom) for the rest, never the settings.xml values
- **AND** the endnote position resolves from settings.xml `w:pos`, else `docEnd`, for every section, and a section's own endnote `w:pos` does not apply

#### Scenario: A note number adds the section start to the note index

- **WHEN** a section's resolved `numStart` is S and a numbered note is the note at index N (from 0) of its numbering domain, which is the whole document for `continuous`, the section for `eachSect`, and the page for `eachPage`
- **THEN** the painted mark and a refreshed NOTEREF result show S + N in the section's `numFmt`, so a section starting at 10 after two continuous notes shows 12 and 13

#### Scenario: A document-scope note properties write reaches every section

- **WHEN** `setNoteProperties` runs with `scope: 'document'`
- **THEN** the write merges the named fields into every section's `w:sectPr` and into settings.xml, in place and in schema order, keeping each field it does not name, adding no default value where nothing authors the field, and minting a body-level `w:sectPr` for an implicit final section only when it adds a value
- **AND** the endnote position goes to settings.xml only, in either scope
- **AND** a write collapses repeated `w:footnotePr`/`w:endnotePr` elements and fields in every container it visits into the first copy, and save writes only the first copy, so the one case in-place merging cannot prevent (two peers adding the element at once) lasts in shared state only until the next write
- **AND** a concurrent paragraph join keeps the write in the section it keeps
- **AND** one undo restores the sections and settings.xml together, and the write converges on every collaborating peer

#### Scenario: Page-furniture PAGE and NUMPAGES project per sheet

- **WHEN** a read-only header or footer story contains allowlisted complex `PAGE`/`NUMPAGES` field instructions
- **THEN** layout projects the physical page index and document page count into that furniture without evaluating other field instructions or claiming body-field support

#### Scenario: Directly formatted centered footer frame shares its anchor band

- **WHEN** a supported centered PAGE footer frame uses `auto` or `around` wrapping with direct line spacing, unused tab stops, and a nonnegative first-line indent
- **THEN** the frame and empty anchor share one footer band, the indent contributes to horizontal placement, and the footer does not reserve a second paragraph height
- **AND** page-field updates, paragraph identities, and save output remain stable
- **AND** unsupported indents, paragraph decorations, and before or after spacing retain ordinary flow

#### Scenario: Deferred content is encountered

- **WHEN** paragraph traversal encounters a deferred element
- **THEN** layout follows its declared preservation or rejection status without claiming semantic layout support

### Requirement: Semantic interaction authority

Caret stops, hit testing, selection, keyboard navigation, and composition anchors SHALL derive from semantic layout records and stable text positions rather than DOM ranges or element rectangles.

#### Scenario: Pointer selects a line position

- **WHEN** a pointer coordinate hits a painted paragraph line
- **THEN** semantic hit-test data resolves a stable paragraph text position independent of DOM node identity

### Requirement: Pointer resolution off the glyphs

Pointer resolution SHALL return a text position outside painted glyph boxes. It SHALL clamp to line and block boundaries and prefer vertical proximity when choosing a block.

#### Scenario: Pointer resolution boundary rules

- **WHEN** a pointer falls outside every painted glyph box
- **THEN** Resolving a pointer to a text position SHALL answer for coordinates that fall outside every painted glyph box, and SHALL NOT refuse. A coordinate left of a line's first glyph SHALL resolve to that line's start and one right of its last glyph to that line's end; a coordinate above or below a block's lines SHALL clamp into that block; a coordinate between two sheets SHALL resolve on the sheet above it; and the block a coordinate belongs to SHALL be chosen with vertical distance weighted above horizontal distance.

#### Scenario: Pointer lands in a paragraph indent

- **WHEN** a pointer coordinate falls left of an indented line's first glyph, outside every fragment box
- **THEN** the resolved position is the start of that line rather than a position in a neighbouring block

#### Scenario: Pointer lands past the end of a wrapped line

- **WHEN** a pointer coordinate falls right of the last glyph of a soft-wrapped line
- **THEN** the resolved position is that line's end excluding the space the wrap consumed

#### Scenario: Pointer lands in a table cell's padding

- **WHEN** a pointer coordinate falls inside a cell but outside every block painted in it
- **THEN** the resolved position is in the nearest block of that cell, and names the covering cell for a vertically merged region

### Requirement: Rectangular cell selection

A pointer drag that leaves the table cell it began in SHALL select the rectangle of cells between the two, not the text range spanning them. The rectangle SHALL grow until every column-spanning and vertically merged cell it touches is wholly contained, SHALL remain a rectangle for the rest of that gesture, and SHALL carry an equivalent text range so consumers that address text need no knowledge of it.

#### Scenario: Drag crosses into another cell

- **WHEN** a pointer drag beginning in one cell resolves into a different cell of the same table
- **THEN** the selection becomes the rectangle of cells between them and remains one until the gesture ends

#### Scenario: Drag reaches a merged cell

- **WHEN** the rectangle touches a cell spanning several grid columns or a vertical merge continuation
- **THEN** the rectangle grows to contain that cell's full extent rather than part of it

### Requirement: Output is a non-authoritative consumer

The browser output layer SHALL safely construct and update native DOM from semantic layout records and SHALL NOT remeasure text, repaginate content, or publish canonical geometry.

#### Scenario: Page is repainted

- **WHEN** output replaces a paragraph fragment after a new layout revision
- **THEN** semantic positions and geometry remain those published by layout

### Requirement: Deterministic revision publication

Layout and interaction publication SHALL reject stale or mixed revisions and SHALL expose either one complete committed revision or the last complete revision.

#### Scenario: Stale layout completes late

- **WHEN** layout for an older model revision finishes after a newer revision has been requested
- **THEN** the older result is not published to output or interaction consumers

### Requirement: Change-scoped incremental layout

Layout SHALL consume the committed `ModelChange` dirty identities, created/deleted/moved and split/join effects, dependency keys, and impact class. It SHALL retain the previous complete layout, resume from a safe checkpoint before the first affected block, and reuse an unchanged suffix only after complete flow-state convergence is proven.

#### Scenario: One paragraph changes without repagination

- **WHEN** a text-local edit changes one paragraph and the new layout converges with the previous flow state
- **THEN** layout reuses unaffected paragraph, page, and display records outside the resume-to-convergence interval

#### Scenario: Reuse cannot be proven

- **WHEN** a dependency is missing, a position-sensitive feature is unsupported, or checkpoint state does not match exactly
- **THEN** the engine falls back to a clean full layout and publishes no speculative mixed result

### Requirement: Fingerprinted paragraph layout cache

Paragraph shaping and line-layout reuse SHALL require matching stable paragraph identity, canonical content fingerprint, resolved dependency fingerprint, available width, resource fingerprints, shaping configuration, and producer version. Model revision SHALL be provenance rather than an automatic cache miss.

#### Scenario: Unrelated paragraph changes

- **WHEN** another paragraph commits at a newer revision without changing a cached paragraph's inputs or dependency closure
- **THEN** the unchanged paragraph's shaping and line-layout records remain reusable

### Requirement: Stable page and display identity

Unchanged pages and display items SHALL retain stable identities across complete published revisions so output adapters can update only the changed page interval.

#### Scenario: Middle page is relaid

- **WHEN** an edit changes one middle page and pagination converges before the following page
- **THEN** preceding and following unchanged page/display records retain identity and are not rebuilt by adapters

### Requirement: Viewport-bounded output materialization

Output SHALL preserve page shells and complete semantic scroll geometry for every page while materializing detailed page content only for the viewport, bounded overscan, and any page containing the logical caret or selection.

#### Scenario: Long document scrolls

- **WHEN** the viewport moves through a long document
- **THEN** mounted detailed page content remains bounded by the visible range plus configured overscan while semantic hit testing and scroll geometry remain valid

#### Scenario: Selection page leaves the viewport

- **WHEN** scrolling moves a page containing the logical caret or selection outside normal overscan
- **THEN** interaction state remains semantic and resolvable without making mounted DOM canonical

### Requirement: Cancellable atomic global layout

Global layout work SHALL be revision-tagged, cancellable, cooperatively scheduled, and published atomically. Superseded jobs SHALL not publish. Worker execution SHALL remain deferred until resource and font transfer contracts are specified.

#### Scenario: Edit supersedes global layout

- **WHEN** a newer model revision commits while a global layout job is yielding
- **THEN** the older job is cancelled or discarded and only a complete result for the latest requested revision may publish

### Requirement: Incremental/full differential conformance

Every supported incremental-layout class SHALL be tested against a clean full layout of the same committed revision. Performance gates SHALL use structural work counters and identity/mount bounds rather than wall-clock thresholds.

#### Scenario: Incremental fixture completes

- **WHEN** text-local, paragraph-local, split/join, or flow-structural fixture edits run incrementally
- **THEN** semantic layout and display output equal clean full output while recorded work remains limited to the proven invalidation and convergence window

### Requirement: Table interaction geometry

Semantic layout SHALL publish canonical table, row, and cell identities with resolved column boundaries, outer-right table edges, authored versus repeated fragments, and nesting order sufficient for divider handles, hover insertion controls, and explicit resize targets. Each interaction record SHALL carry the canonical store revision it was derived from as `sourceRevision`. Repeated header copies SHALL appear in geometry but SHALL be marked non-editable.

#### Scenario: Column divider geometry is published

- **WHEN** a table with explicit grid columns is laid out
- **THEN** each authored internal divider and the outer-right edge expose stable page coordinates for interaction furniture

#### Scenario: Nested pointer targets the innermost table

- **WHEN** pointer hit testing resolves a coordinate over nested tables
- **THEN** the deepest nested table owns the interaction target

#### Scenario: Stale source revision is refused

- **WHEN** an explicit table target's `sourceRevision` does not equal the current canonical store revision at commit time, including while an older layout remains published for geometry
- **THEN** the editor refuses the gesture with a typed stale-target reason

### Requirement: Table structural edits invalidate flow

Row and column insertion, deletion, and column resize commits SHALL publish `flow-structural` impact and SHALL be covered by incremental/full differential layout tests with stable unaffected page identity outside the edited table interval.

#### Scenario: Unaffected pages keep identity after table resize

- **WHEN** a middle-table column resize converges without repagination before the following page
- **THEN** preceding and following unchanged pages retain stable identities

### Requirement: Passage-local justified space compression

For modern left-to-right justified text beside floating objects, the layout engine SHALL test complete words against the current passage. It SHALL apply the existing compression floor and compression-versus-expansion rule to that passage's eligible spaces. It SHALL NOT borrow space capacity across a floating object. A left-to-right paragraph that contains right-to-left runs SHALL compress in the same way. Right-to-left paragraphs SHALL retain their existing behavior.

#### Scenario: A narrow passage keeps one more word

- **GIVEN** a 66 pt passage beside a square-wrapped picture and words whose natural widths total 68 pt
- **AND** its two 4 pt spaces can each compress by 1 pt under the existing admission rule
- **WHEN** the layout engine breaks the justified paragraph in compatibility mode 15 or later
- **THEN** all three words remain in that passage
- **AND** their published span and caret geometry fits within the passage
- **AND** source text, formatting, and image parts remain unchanged

#### Scenario: Earlier passages cannot subsidize a later passage

- **GIVEN** a later passage whose words exceed its own eligible compression budget
- **AND** an earlier passage has spare compression capacity
- **WHEN** the layout engine tests the later passage's next word
- **THEN** that word wraps instead of borrowing capacity across the floating object

#### Scenario: A right-to-left run keeps compression in its left-to-right paragraph

- **GIVEN** a justified left-to-right paragraph beside a floating object in compatibility mode 15 or later
- **AND** the paragraph contains a right-to-left run
- **WHEN** a passage can keep one more word by compressing its spaces
- **THEN** the passage keeps that word, also when the right-to-left run is on that line
- **AND** a space after a right-to-left word that ends a passage stays at the end of that passage, so the next passage starts at the edge of the floating object

#### Scenario: A compressed passage ends at the floating object

- **GIVEN** a passage that ends at the near edge of a square- or tight-wrapped floating object
- **AND** a line in that passage keeps its last word by compressing its spaces
- **WHEN** the layout engine aligns the justified line
- **THEN** the line's last word ends at the passage edge
- **AND** no text of that line overlaps the floating object

### Requirement: Automatic inter-script spacing

Semantic layout SHALL resolve `w:autoSpaceDE` and `w:autoSpaceDN` through the paragraph cascade, with enabled defaults. It SHALL add bounded layout advances at supported East Asian and Latin-letter or ASCII-digit boundaries. It SHALL preserve source text and canonical UTF-16 offsets. Line fitting, paint, caret geometry, and anchor prediction SHALL use the same advances. Authored character spacing and unsupported run forms SHALL retain their existing behavior.

#### Scenario: An inherited false overrides the enabled default

- **WHEN** a paragraph inherits `w:autoSpaceDN` or `w:autoSpaceDE` with a false value
- **THEN** that boundary type retains its original advance unless a direct true overrides the inherited value

#### Scenario: A source run boundary separates scripts

- **WHEN** supported adjacent text changes between East Asian and Latin letters or ASCII digits across source runs
- **THEN** layout applies one boundary advance without adding a source character or changing source ranges

#### Scenario: A boundary moves to another line

- **WHEN** the additional advance prevents adjacent text from fitting on one line
- **THEN** layout wraps the text and removes the boundary advance at the new line start

#### Scenario: Shared edits remove a script boundary

- **WHEN** two editors converge after edits remove the only East Asian character from a warm paragraph
- **THEN** both editors remove the obsolete automatic advances and retain shared text, history, and saved source offsets

#### Scenario: Reverse gap uses the authored face metric

- **WHEN** Latin letters or ASCII digits precede supported East Asian text and the shaped measurer resolves the authored Latin face without substitution
- **THEN** the boundary advance equals half of that face's average character width per em, scaled to the run's font size
- **AND** glyph advances, source text, and canonical offsets remain unchanged

#### Scenario: Custom metric refuses a boundary

- **WHEN** the automatic-spacing hook returns an invalid metric, or an unavailable one for a family without a recorded value
- **THEN** the boundary receives no invented gap
- **AND** a measurer without the hook adds a reverse advance only from a recorded authored-family value

#### Scenario: Directional spacing uses the authored font

- **WHEN** supported East Asian text precedes Latin letters or ASCII digits
- **THEN** the boundary advance equals one quarter of the East Asian run's authored font size
- **AND** a substitute font's average width cannot change that advance

#### Scenario: Reverse spacing uses a recorded family metric

- **WHEN** Latin letters or ASCII digits precede East Asian text and a substitute font draws a common default family
- **THEN** the boundary advance equals half the authored family's recorded average character width at the run size
- **AND** the substitute font's own average width does not apply

#### Scenario: Reverse spacing has no authored metric

- **WHEN** Latin letters or ASCII digits precede East Asian text, the authored font metric is unavailable, and no recorded value exists for the authored family
- **THEN** the boundary adds no reverse advance
- **AND** layout does not use a substitute font's average width or change source text

#### Scenario: A group that cannot break keeps its advance

- **WHEN** East Asian text and a Latin letter or ASCII digit share one font and no line break is allowed between them
- **THEN** line layout draws the same boundary advance that table AutoFit counts
- **AND** the caret after the boundary sits after the advance

### Requirement: Kinsoku groups wider than their line

The layout engine SHALL move text that kinsoku keeps together to the next line as one unit. When the unit is wider than that whole line, the engine SHALL break it at its last fitting grapheme, also where kinsoku forbids the break. The automatic advance before each fragment SHALL count toward the fit; the advance at the break SHALL not. Grapheme clusters, combining marks, and no-break characters SHALL never break.

#### Scenario: A strict small kana group wider than the line

- **GIVEN** a strict ja-JP paragraph `前文123ヵ月` at 12 pt in Century and MS Mincho, left-aligned, with automatic spacing
- **WHEN** the measure is 24 to 34.5 pt, narrower than the 35 pt unit `123ヵ`
- **THEN** the lines are `前文`, `123`, and `ヵ月`
- **AND** from 35 pt the unit `123ヵ` stays whole on the second line

#### Scenario: A one-character measure

- **GIVEN** `天。地。人。` in a left-aligned paragraph
- **WHEN** the measure holds one ideograph
- **THEN** every character takes its own line, the full stops included
- **AND** with a justified paragraph that allows hanging, each full stop hangs after its ideograph

#### Scenario: A justified line gives back half of its automatic spacing

- **GIVEN** the same `前文123ヵ月` paragraph, justified
- **WHEN** the measure is 33.5 to 34.5 pt, where `123ヵ` fits only with its 3 pt advance at half width
- **THEN** `123ヵ` stays whole on the second line
- **AND** at 33 pt it breaks after `123`

### Requirement: East Asian punctuation fitting only on justified paragraphs

The layout engine SHALL fit a line by compressing East Asian punctuation against measured glyph bounds only when the paragraph alignment is justified (`w:jc` `both`, `distribute`, `thaiDistribute`, or a kashida value) and the document defaults (`w:rPrDefault`) name an East Asian face. Other paragraphs SHALL wrap instead of fitting. Adjacent full-width punctuation pairs compress at every alignment.

#### Scenario: A left-aligned paragraph wraps instead of compressing

- **GIVEN** document punctuation compression and a line that fits only when its punctuation compresses
- **WHEN** the paragraph is left-aligned, centered, or right-aligned
- **THEN** the line wraps instead of fitting
- **AND** the same paragraph fits the line when it is justified

### Requirement: East Asian punctuation fitting capacity

Justified East Asian lines SHALL distribute punctuation compression across available blank sides. The layout SHALL compare required compression against available expansion before admitting the next ordinary glyph.

#### Scenario: Punctuation compression allocation and admission

- **WHEN** a justified line compresses East Asian punctuation to fit the next glyph
- **THEN** When a justified line compresses East Asian punctuation to fit the next glyph, each closing mark and colon SHALL give up to half its advance on its right side and each opening mark on its left side, next to any glyph on the line. A closing mark or colon before an opening mark SHALL give both sides, each up to half of the smaller glyph. The shrink SHALL go in equal shares to every blank side, and a side that runs out SHALL pass the rest to the others. The next ordinary glyph SHALL join the line only when the compression it needs, as a share of the line's capacity, is no larger than its room divided by 1/64 of the advances before the line's last glyph.

#### Scenario: Two blank sides fit more than half a glyph

- **GIVEN** a justified 12 pt line `甲。乙，丙` followed by more ideographs, with document punctuation compression
- **WHEN** the measure is 48.6 pt, 11.4 pt short of the natural width
- **THEN** the whole line fits by compressing both blank sides
- **AND** at 48.5 pt the last ideograph wraps

#### Scenario: A longer line leaves less compression

- **GIVEN** the same two blank sides on a 15-glyph line
- **WHEN** the measure leaves the last glyph 2.0 pt of room
- **THEN** the last glyph wraps
- **AND** with 2.05 pt of room it fits

#### Scenario: Adjacent punctuation gives both sides

- **GIVEN** a closing mark followed by an opening mark, two closing marks, or two opening marks
- **WHEN** the line needs compression to fit
- **THEN** both blank sides at that seam compress

### Requirement: Hanging punctuation by alignment

With `w:overflowPunct` on, in compatibility mode 15 and later, the layout engine SHALL let line-end punctuation hang past the margin only when the paragraph alignment is justified or distributed. This SHALL apply to full-width punctuation and to Latin punctuation in a run with an East Asian language. Left-aligned, centered, and right-aligned lines SHALL keep line-end punctuation inside the margin there.

#### Scenario: A closing quote stays inside a left-aligned line

- **GIVEN** a Japanese-language run that ends with a closing curly quote one character past the margin
- **WHEN** the paragraph is left-aligned, centered, or right-aligned
- **THEN** the quote wraps to the next line with the character before it
- **AND** the same quote hangs past the margin when the paragraph is justified

### Requirement: Hanging punctuation in legacy modes and distributed paragraphs

With no compatibility mode, or in mode 11, 12, or 14, line-end punctuation SHALL hang at every alignment, and the text before the mark SHALL fill the measure. A document whose defaults name no East Asian face SHALL hang punctuation only in distributed paragraphs.

#### Scenario: A legacy mode hangs a left-aligned line

- **GIVEN** a left-aligned, centered, or right-aligned line of nineteen 24 pt ideographs and a 24 pt `。` on a 468 pt measure
- **WHEN** the document declares compatibility mode 14
- **THEN** the mark hangs past the margin and starts at 468 pt
- **AND** in mode 15 the mark wraps with the ideograph before it

#### Scenario: A distributed paragraph hangs without East Asian defaults

- **GIVEN** a document whose `w:rPrDefault` names no East Asian face
- **WHEN** a distributed line ends with an overflowing `。`, `、`, or `）`
- **THEN** the mark hangs past the margin
- **AND** a justified line in the same document wraps the mark with the character before it

#### Scenario: A hanging mark and compression fit one line

- **GIVEN** a justified 12 pt line `甲乙。丙。` followed by more ideographs, with document punctuation compression
- **WHEN** the measure is 42.1 pt, too narrow for the final full stop to hang alone
- **THEN** the final full stop hangs past the margin and the middle full stop gives 5.9 pt
- **AND** at 41.85 pt the last ideograph and its full stop wrap

#### Scenario: A document without an East Asian default face neither fits nor hangs

- **GIVEN** document punctuation compression, a justified paragraph, and document defaults that name no East Asian face
- **WHEN** a line fits only when its punctuation compresses or hangs
- **THEN** the line wraps instead

### Requirement: Space shrinking before hanging punctuation

In compatibility mode 15 and later, a justified or distributed line SHALL shrink its inter-word spaces before a half-width line-end mark hangs. The mark SHALL stay inside the margin when the space-shrink rule admits the word with the mark inside the measure, also for a paragraph-final word. Full-width marks and legacy modes SHALL keep their hanging behavior.

#### Scenario: A comma stays inside a justified line

- **GIVEN** a justified mode 15 line of English words in a run whose East Asian language is Chinese or Japanese
- **WHEN** the line overflows by less than its spaces can give up, and the text before a final `,` fits at its natural width
- **THEN** the spaces shrink and the comma ends at the margin
- **AND** in mode 14 the comma hangs past the margin with natural spacing

### Requirement: Hanging a mark beside shrunk spaces

When the spaces reach their shrink floor before the mark fits, a justified or distributed line SHALL hang the mark if the space-shrink rule admits the word and the spaces make room for the text before the mark.

#### Scenario: A comma hangs beside spaces at their floor

- **GIVEN** the same line, where the spaces at their floor make room for the text before the comma but not for the comma
- **WHEN** the paragraph is justified, or distributed and the word passes the distributed test
- **THEN** the comma hangs past the margin and the text before it fills the measure

### Requirement: Distributed space shrinking

In compatibility mode 15 and later, a distributed line SHALL keep the word that overflows it by shrinking its spaces only when each space loses at most a third of what the line without the word would add to it. The test SHALL count half the advance of a final half-width mark that may hang, a measured fit. A justified line SHALL allow half instead, counting the whole mark.

#### Scenario: A distributed line ends one word earlier

- **GIVEN** a justified and a distributed mode 15 paragraph of English words with the same measure
- **WHEN** keeping the next word costs each space more than a third, but at most half, of the stretch the line without it would take
- **THEN** the justified line keeps the word and the distributed line moves it to the next line

### Requirement: Legacy space shrinking with punctuation compression

In compatibility mode 14 or earlier, or with no mode, when `w:characterSpacingControl` compresses punctuation and the document defaults name an East Asian face, a line at any alignment SHALL keep the word that overflows it when each space can shrink to fit it without going below half the average character width of its face. Only one word per line SHALL join this way. With `w:balanceSingleByteDoubleByteWidth`, each space SHALL shrink down to a quarter of its font size instead.

#### Scenario: A left-aligned line shrinks its spaces

- **GIVEN** a mode 14 left-aligned paragraph of English words with `compressPunctuation` and an East Asian default face
- **WHEN** a word fits only when each Times New Roman space gives up less than a fifth of its advance
- **THEN** the word stays on the line and the line ends at the margin
- **AND** without punctuation compression, or in Calibri, the word moves to the next line
- **AND** after that word joins, the next word that overflows opens the next line
- **AND** a space cut at the margin before the word counts at its natural advance

#### Scenario: Balanced widths shrink spaces to a quarter em

- **GIVEN** the same paragraph with `w:balanceSingleByteDoubleByteWidth` in `w:compat`
- **WHEN** a word fits only when each space shrinks to just above a quarter of its font size
- **THEN** the word stays on the line, in Courier New, Arial, or Century alike
- **AND** a Times New Roman or Calibri space, a quarter em or narrower, keeps its advance
- **AND** with `w:useWord97LineBreakRules` as well, spaces in proportional faces keep their advance
- **AND** a line in a proportional face that starts with spaces keeps natural spaces and hangs no final mark

### Requirement: Legacy space shrinking before a final mark

Under the legacy space shrinking rule, a final half-width mark SHALL stay inside when the spaces make room for it, and hang when they make room only for the text before it.

#### Scenario: A comma hangs beside spaces at their floor in a legacy mode

- **GIVEN** a mode 14 paragraph with `compressPunctuation`, an East Asian default face, and a final `,` that overflows
- **WHEN** the spaces at their floor make room for the text before the comma but not for the comma
- **THEN** the comma hangs past the margin and the text before it fills the measure

### Requirement: A chopped word keeps its final mark

When a word wider than its line breaks at its last fitting character, and that break would leave only the word's final mark for the next line, the mark SHALL hang past the margin if the paragraph lets it hang. A mark inside the word SHALL still open the next line.

#### Scenario: A final period hangs after a long unbroken word

- **GIVEN** a justified mode 15 paragraph of Latin words joined by commas, with no spaces, in a Chinese East Asian language run, that ends with a period
- **WHEN** the period overflows the last full line
- **THEN** the period hangs past the margin instead of opening a line alone

### Requirement: Combining kana sound marks follow their face

The layout engine SHALL measure and paint the combining kana sound marks (U+3099, U+309A) by their face. A face that classes the mark glyph as a mark SHALL join it with the kana before it and add no width. A face that gives the unclassed glyph an advance SHALL draw the mark in its own cell beside an uncomposed base. The mark SHALL never start a line apart from its base.

#### Scenario: A face that spaces the mark

- **GIVEN** a face whose U+3099 glyph has no mark class and a full-cell advance
- **WHEN** a line ends with a kana and U+3099 that together overflow the measure, in one run or in two
- **THEN** the base and the mark move to the next line together
- **AND** the mark takes a full cell there

#### Scenario: A face that joins the mark

- **GIVEN** a face that classes the U+3099 glyph as a mark and draws a lone mark with no extra glyph
- **WHEN** the mark is in its own run after its base at the end of a full line
- **THEN** the mark adds no width and stays on that line
- **AND** it paints over its base, not past the margin

#### Scenario: Kana compression keeps a spaced mark with its base

- **GIVEN** a face that spaces the mark, `compressPunctuationAndJapaneseKana`, and a justified mode 15 line
- **WHEN** the line ends with a kana and U+3099 that overflow it by less than the kana on the line can give
- **THEN** the mark first gives a sixteenth of its em, and the kana share the rest
- **AND** the base keeps its advance and gives its share through the mark

#### Scenario: The PDF text of a kana and its mark

- **GIVEN** a kana followed by U+3099 or U+309A that the face draws as one glyph with it, or in a separate run over its base
- **WHEN** the paragraph is exported to PDF
- **THEN** the text of the pair is the precomposed character, such as `が` (U+304C)
- **AND** a mark that its face draws in a cell of its own keeps its own character

### Requirement: Language-specific hanging punctuation

When a justified paragraph enables hanging punctuation, the punctuation run's language SHALL select its hanging characters. Japanese `〕》〉！？：；・`, ASCII `! ? : ; ) ] }`, `％`, and `°`, Simplified Chinese `．`, and Korean punctuation SHALL NOT hang, except that a Korean paragraph-final mark other than `。` or `、` SHALL hang. Korean overflow punctuation SHALL start the next line.

#### Scenario: The punctuation run selects the hanging rule

- **GIVEN** a Japanese run followed by a Chinese run containing a full-width exclamation mark
- **WHEN** the mark overflows a justified line with hanging enabled
- **THEN** the Chinese mark can hang
- **AND** changing the mark's run language to Japanese makes it wrap with its preceding character

#### Scenario: Korean punctuation starts the next line

- **GIVEN** a Korean run ending a justified line with hanging enabled
- **WHEN** its next punctuation mark does not fit inside the measure
- **THEN** the mark starts the next line without moving the preceding character
- **AND** a paragraph-final `！` hangs instead, while a paragraph-final `。` starts the next line

#### Scenario: Traditional Chinese hangs a full-width full stop

- **GIVEN** a justified line of Traditional Chinese text with hanging enabled
- **WHEN** a full-width full stop `．` overflows the measure
- **THEN** the mark hangs
- **AND** the same mark in Simplified Chinese wraps with its preceding character

### Requirement: Line-start rules decide hanging

A mark SHALL hang only when the custom or default line-start list for its run language forbids it at a line start and the paragraph keeps kinsoku on; otherwise the mark SHALL start the next line. With kinsoku off, half-width marks SHALL still hang. A legacy compatibility mode SHALL hang a listed mark whatever the paragraph kinsoku switch.

#### Scenario: The effective line-start list decides hanging

- **GIVEN** a justified line that ends with an overflowing `。` in a Japanese run
- **WHEN** the paragraph sets `w:kinsoku w:val="0"`, or `settings.xml` sets a Japanese `w:noLineBreaksBefore` list without `。`
- **THEN** `。` starts the next line
- **AND** Simplified Chinese `・`, `｡`, and `､`, and Traditional Chinese `％` and `°`, start the next line too

### Requirement: Alignment before hanging punctuation

When line-end punctuation hangs, the preceding text SHALL fill the measure, including on the paragraph's final line. The mark SHALL retain its measured advance outside that measure. Source text and offsets SHALL remain unchanged.

#### Scenario: A final hanging mark follows a full-width prefix

- **GIVEN** a justified line of nineteen 24 pt ideographs and a hanging 24 pt full stop
- **WHEN** the line's measure is 468 pt and the paragraph ends after the mark
- **THEN** the full stop starts at 468 pt and ends at 492 pt relative to the line origin

#### Scenario: A Korean final line in an earlier compatibility mode

- **GIVEN** a justified Korean paragraph that ends with a hanging `！`
- **WHEN** the document declares compatibility mode 14
- **THEN** the final line keeps its natural width
- **AND** in mode 15 the text before the mark fills the measure

### Requirement: East Asian punctuation fitting on mixed lines

When document punctuation compression is on and the document defaults name an East Asian face, a line that also holds complete Latin words, digit groups, or ASCII symbol groups SHALL be able to fit by compressing adjacent East Asian punctuation against measured glyph ink. The Latin groups SHALL keep their natural advances and source ranges.

#### Scenario: A mixed line fits by compressing punctuation

- **WHEN** a qualified line holding East Asian punctuation and a complete Latin word overflows by less than the punctuation's measured spare ink
- **THEN** the line fits by reducing only the East Asian punctuation advances
- **AND** the Latin word keeps its natural width, and source text and offsets do not change

#### Scenario: An unqualified run keeps conservative fitting

- **WHEN** a run on a line that holds Latin groups has authored character spacing, horizontal scaling, complex shaping, or an unresolved face
- **THEN** that line does not use measured-ink fitting

### Requirement: Host font resource replacement

The editor SHALL replace host font resources without replacing its document session, content, selection, or undo history. Replacement SHALL invalidate font-dependent measurement, paragraph layout, and paint. Document protection and shared collaboration data SHALL remain unchanged.

#### Scenario: Resolved host fonts are removed

- **WHEN** the host calls `setFonts(undefined)` after a document uses resolved host fonts
- **THEN** the previous faces and shaping resources are removed and font-dependent caches are invalidated
- **AND** bounded fallback measurement applies unless the document supplies embedded faces
- **AND** unsaved edits and undo history remain available in the same session

#### Scenario: A retired resolution completes

- **WHEN** the host replaces fonts while a previous resolver is pending
- **THEN** the previous request is cancelled
- **AND** its late result or failure cannot replace the current font resources or publish a current error

#### Scenario: Replacement fails

- **WHEN** the current replacement resolver fails
- **THEN** the editor reports the failure with its cause and keeps bounded fallback measurement
- **AND** it does not restore fonts that the host removed

### Requirement: Terminal exact-row outer rule extent

Semantic layout SHALL place a supported terminal exact row's simple bottom rule outside its authored content height. Published boxes, painted borders, following flow, and page admission SHALL include that outer extent, with the exceptions that the scenarios state. Canonical source text and saved XML SHALL remain unchanged.

#### Scenario: Outer rule preserves authored exact row pitch

- **WHEN** supported exact rows have equal single outer rules
- **THEN** the distance between the outer rule centers equals the authored exact row pitch
- **AND** following text starts below the published terminal extent

#### Scenario: Border room is insufficient

- **WHEN** an authored exact row fits the remaining band but its complete outer rule does not
- **AND** the row starts below other content on the page
- **THEN** the row moves to the next page

#### Scenario: Border room is insufficient at the top of a page

- **WHEN** an authored exact row fits the page band but its complete outer rule does not
- **AND** the row starts at the top of the page, or directly below repeated header rows before compatibility mode 15
- **THEN** the row keeps its page and authored content height
- **AND** only its outer bottom rule extends past the bottom margin

#### Scenario: Outer rule ends exactly at the bottom margin

- **WHEN** an authored exact row and its complete outer rule end exactly at the bottom of the band
- **THEN** the row keeps its page

#### Scenario: Repeated headers yield to the outer rule

- **WHEN** compatibility mode is 15 or later
- **AND** a continuation page can hold the repeated header group and the authored exact row, but not also its complete outer rule
- **THEN** the repeated header group is omitted on that page
- **AND** the row starts at the top of the page

#### Scenario: An exact row that ends a page closes it with the table bottom rule

- **WHEN** a supported exact row that is not the table's last row ends a page fragment because the next row does not start below it
- **THEN** the table's bottom rule, not the inside rule, sits below its authored height
- **AND** page admission, repeated header omission, and the top-of-page exception treat it as a terminal exact row

#### Scenario: An exact row that opens a continuation page

- **WHEN** a supported exact row other than the table's first row opens a later page fragment of its table
- **THEN** the row grows above its authored height by the width its top rule there exceeds the inside rule it reserved

#### Scenario: Repeated headers stay above a row that cannot split before mode 15

- **WHEN** compatibility mode is 14 or earlier, or absent
- **AND** a continuation page cannot hold the repeated header group and a row that cannot split, but a fresh page holds the row
- **THEN** the repeated header group stays on that page
- **AND** the row stays whole below it and runs past the bottom margin

#### Scenario: A text row that cannot split stays whole before mode 15

- **WHEN** compatibility mode is 14 or earlier, or absent
- **AND** a text-only row that cannot split, without a vertical merge, is taller than a page
- **AND** that page holds no wrapping picture, including one in the header or footer
- **THEN** the row starts on a fresh page and keeps all its lines there, past the bottom margin
- **AND** the next row or block starts on the following page

#### Scenario: A whole tall row keeps the first line of its first footnote

- **WHEN** compatibility mode is 14 or earlier, or absent
- **AND** a row taller than the page stays whole past the bottom margin and references footnotes
- **THEN** the page keeps the first line of the first referenced footnote at its bottom, over the row, wherever the reference sits in the row
- **AND** the rest of that footnote and every later footnote of the row continue on the next page, each later footnote with its own mark

#### Scenario: A carried footnote keeps the footnotes of a whole tall row behind it

- **WHEN** compatibility mode is 14 or earlier, or absent
- **AND** a footnote continued from an earlier page has no room on the page of a whole row taller than the page
- **THEN** that page keeps no line of the footnotes of the row and paints no footnote area
- **AND** the footnotes of the row start, each with its own mark, only on the page where the continued footnote ends

#### Scenario: A row kept whole below repeated header rows keeps none of its footnotes

- **WHEN** compatibility mode is 14 or earlier, or absent
- **AND** a row that cannot split fits a fresh page but stays whole below repeated header rows and runs past the bottom margin
- **THEN** the page of the row keeps no line of the footnotes that the row references
- **AND** each of those footnotes starts on the next page with its own mark

#### Scenario: A repeated header stays above a splittable row whose first line does not fit

- **WHEN** compatibility mode is 14 or earlier, or absent
- **AND** the next row on a continuation page can split and has no vertical merge
- **AND** the first line of one of its cells, or the first row of a nested table that opens a cell, does not fit below the repeated header rows
- **THEN** the header rows repeat, and the row stays whole below them and runs past the bottom margin, or past the bottom edge of the page
- **AND** this also holds when the row is taller than a page
- **AND** the content after the row starts on the next page
- **AND** in compatibility mode 15 and later the repeat is omitted, and the row starts the page with every cell

#### Scenario: A repeated header stays above a continued row whose next content does not fit

- **WHEN** compatibility mode is 14 or earlier, or absent
- **AND** a row that can split continues from the previous page and has no vertical merge
- **AND** the next line of one of its cells, or the first row of the next nested table in a cell, does not fit below the repeated header rows
- **THEN** the header rows repeat, and the rest of the row stays below them on that page and runs past the bottom margin
- **AND** the content after the row starts on the next page
- **AND** in compatibility mode 15 and later the repeat is omitted, and the rest of the row starts the page

#### Scenario: A tall row splits before mode 15 outside the text-only case

- **WHEN** compatibility mode is 14 or earlier, or absent
- **AND** a row that cannot split is taller than a page
- **AND** the row holds a vertical merge or a nested table, or its page holds a wrapping picture, including one in the header or footer
- **THEN** the row starts on a fresh page and splits there

#### Scenario: A body row below a repeated header reserves the boundary rule

- **WHEN** a complete body row of a collapsed table starts directly below its repeated header rows
- **THEN** before compatibility mode 15, or with no mode, the row reserves the wider of its own top rule and the bottom rule of the last header row
- **AND** in compatibility mode 15 and later, the row reserves the rule it shares with the row above it in the table
- **AND** the shared border plan and the ordinary repeat path reserve the same band

#### Scenario: Content after a table whose last page omits the repeat starts a page

- **WHEN** compatibility mode is 15 or later
- **AND** the last page of a table leaves out its repeated header rows
- **THEN** the content after the table starts on the next page, also when it fits below the last row
- **AND** a table whose last page keeps its repeated header rows leaves that content on the page

#### Scenario: Cell text uses the authored bottom

- **WHEN** a terminal exact-row cell has center or bottom alignment
- **THEN** text aligns within the authored height and cell margins
- **AND** the bottom rule reserves no space inside that content box

### Requirement: Terminal-rule table eligibility

Bounded, top-level, unpositioned, collapsed tables with text-only horizontal projections and complete grid coverage SHALL qualify. Terminal bottom-cell rules SHALL be equal single rules up to 12pt. Repeated headers, horizontal spans, and vertical merges in either column SHALL use the same terminal rule. Top and bottom widths MAY differ. Eighth-point widths SHALL NOT require integral-twip conversion for this outer extent.

#### Scenario: Unsupported shapes keep existing geometry

- **WHEN** a table has nested content, supported bottom-to-top cells, compound bottom rules, cell spacing, or unequal bottom-cell widths
- **THEN** it retains its existing geometry

### Requirement: Cached terminal-rule eligibility

Eligibility scanning SHALL preserve canonical rows and their merge state. Repeated placement of an immutable table SHALL reuse its cached eligibility decision, including a refused decision.

#### Scenario: Cached eligibility preserves source rows

- **WHEN** a supported immutable table has a two-row first-column prefix merge
- **THEN** eligibility scanning leaves the actual merge and canonical rows unchanged
- **AND** repeated placement reuses only the structure's cached eligibility decision

### Requirement: Qualified East Asian curly bearings in existing punctuation windows

The layout engine SHALL allow curly quotes in runs with the East Asian font hint (`w:hint="eastAsia"`) to contribute measured opening or closing bearings inside an existing qualified CJK punctuation fitting window. The face SHALL resolve, authored character spacing SHALL be zero, horizontal scale SHALL be 100%, and complex shaping SHALL be absent. The document SHALL qualify its East Asian default face and SHALL NOT disable punctuation kerning.

#### Scenario: Qualified curly bearings complete an existing CJK punctuation window

- **GIVEN** a plain source paragraph with supported CJK punctuation and curly quotes in a run with the East Asian font hint
- **WHEN** the measured line deficit fits within the supported punctuation bearings
- **THEN** layout fits the protected group without changing source text, authored font size, or UTF-16 source ranges

#### Scenario: Unsupported curly context keeps existing behavior

- **GIVEN** a curly-only punctuation window, unhinted Latin quotes, a curly quote's inner side, unresolved face, authored tracking, horizontal scaling, complex shaping, decorated text, or source punctuation-kerning refusal
- **WHEN** layout considers optical fitting
- **THEN** the new East Asian curly path leaves the unsupported geometry unchanged

### Requirement: Natural kana advances

Layout SHALL preserve natural kana advances and authored tracking when a line overflows. Paragraph overflow SHALL NOT apply a fixed kana reduction. Kana compression that fits a line-start-prohibited character on a full line follows its own requirement.

#### Scenario: Japanese kana overflow the measure

- **GIVEN** twenty kana with natural advances of 24 points and a 468-point measure
- **WHEN** character spacing control enables punctuation and Japanese kana compression
- **THEN** the first line contains nineteen kana and the next line contains one kana
- **AND** source text, run properties, and settings remain unchanged after save and reopen

### Requirement: Kana fit a line-start-prohibited character

When `w:characterSpacingControl` is `compressPunctuationAndJapaneseKana`, a full line SHALL pull a following line-start-prohibited character onto itself when compression can absorb the overflow. Punctuation blank sides SHALL compress first, then hiragana and katakana by at most one sixteenth of an em each, in equal shares. A final closing mark SHALL give its trailing half first when that half alone absorbs the overflow, and otherwise only when the kana cannot absorb the rest.

#### Scenario: Kana fit a full stop after a full line

- **GIVEN** a justified line of 39 kana of 24 pt on a 936 pt measure, followed by `。`
- **WHEN** kana compression is on
- **THEN** each kana advances 24 − 24/39 pt and `。` keeps its 24 pt advance inside the margin
- **AND** with eight kana among kanji, the kana give 1.5 pt each and `。` gives its trailing half

#### Scenario: A character that may start a line wraps

- **GIVEN** a full line of kana followed by a kana, or by `ー`, and then `。`
- **WHEN** kana compression is on
- **THEN** the line keeps natural kana advances and the next character starts the next line

### Requirement: Kana fit scope

Kanji, the prolonged sound mark, and half-width katakana SHALL keep their advances in a kana fit. Without punctuation overflow, the final trailing half SHALL compress before the kana. The line-start list SHALL decide the fit whatever the kinsoku switch. When compression cannot absorb the overflow, the line SHALL hang the mark or wrap as without kana compression. The fit SHALL apply where punctuation hangs, and SHALL NOT apply in Korean runs or in Traditional Chinese runs in mode 15 and later.

#### Scenario: Paragraphs that fit kana

- **GIVEN** a full line of kana followed by `。`, with kana compression on
- **WHEN** the paragraph is left-aligned in mode 15, or justified in a document without East Asian defaults
- **THEN** the kana keep their advances
- **AND** a left-aligned paragraph in mode 14 and a distributed paragraph without East Asian defaults fit the kana

### Requirement: East Asian text keeps its advances under pair kerning

A run with pair kerning on (`w:kern`) SHALL keep kana, ideographs, CJK punctuation, and full-width and half-width forms at their own advances in measurement, PDF glyph positions, and screen paint. Latin letters in the same run SHALL still kern. Adjacent East Asian punctuation SHALL compress by its own rule, not by the font's kerning pairs.

#### Scenario: Kerned katakana keep full-width steps

- **GIVEN** a katakana run in a face with katakana kerning pairs
- **WHEN** the run sets `w:kern`
- **THEN** every katakana keeps its full-width advance
- **AND** a Latin pair such as `AV` in the same run kerns

### Requirement: List counters belong to the abstract list

Every `w:num` that names one `w:abstractNum` SHALL count on one shared counter per level. A level that starts again after its parent level SHALL take the start of the `w:num` that counts it.

#### Scenario: A list without overrides continues the list it shares a definition with

- **GIVEN** two `w:num` entries that name one `w:abstractNum`, with no level overrides
- **WHEN** two items of the first `w:num` precede one item of the second, then one more item of the first
- **THEN** the items number `1.`, `2.`, `3.`, and `4.`

### Requirement: A deeper item counts the parent levels it skips

An item on a deeper level SHALL count each parent level that has no item since that level last started, once, at that level's start. The next item on such a parent level SHALL continue from that count. A count SHALL continue past 9999, and its marker SHALL show the whole number.

#### Scenario: A level 1 item before the first level 0 item

- **GIVEN** one list whose levels 0, 1, and 2 use `%1.`, `%2)`, and `%3]`
- **WHEN** its items are on levels 1, 0, 0, 2, 1, and 0
- **THEN** the items number `1)`, `2.`, `3.`, `1]`, `2)`, and `4.`

#### Scenario: A list counts past 9999

- **GIVEN** a decimal list level that starts at 9998
- **WHEN** it has four items
- **THEN** the items number `9998`, `9999`, `10000`, and `10001`

### Requirement: A start override restarts a shared list once

A `w:num` with a `w:startOverride` SHALL restart the shared counter once, at its first paragraph on an overridden level. The restart SHALL apply to that level alone and SHALL then be spent. When the same `w:lvlOverride` also replaces the level, the restart value SHALL be the replacement's `w:start`.

#### Scenario: A later item continues from a restart on another list

- **GIVEN** two `w:num` entries that name one `w:abstractNum`, and the second has `w:startOverride w:val="1"` on level 0
- **WHEN** two level-0 items of the first `w:num` precede one item of the second, then one more item of the first
- **THEN** the items number `1.`, `2.`, `1.`, and `2.`

### Requirement: A new list on a reused definition starts at its first number

A list that the editor starts on a reused `w:abstractNum` SHALL carry a `w:lvlOverride` with a `w:startOverride` for each numbered level of that definition.

#### Scenario: A second numbered list begins at one

- **GIVEN** a document with a two-item numbered list
- **WHEN** the user starts a numbered list on a later, separate paragraph
- **THEN** the new item numbers `1.`, also after save and reopen

### Requirement: CJK face line height

A single-spaced line drawn in a face that lists the Chinese, Japanese, or Korean code pages SHALL take 1.3 times the face box (ascent plus descent), with the face's own leading absorbed and the extra space split above and below the glyphs. A face with a one-em box SHALL take at least that line in every role. A taller face SHALL take it only when it draws as the family that the run names; a substitute for a missing family and a glyph fallback SHALL keep their own box.

#### Scenario: Taller CJK face drawn as itself

- **GIVEN** a run that names a CJK face with a 1.448 em box, and the face is available
- **WHEN** layout measures a single-spaced line of that run at 11 pt
- **THEN** the line is 1.882 em (20.71 pt) high
- **AND** Latin text in a run whose Latin slot names that face takes the same line
- **AND** a face with 0.5 em of its own leading over a 1.102 em box takes 1.433 em, not its box plus leading
- **AND** multiple, exact, and at-least spacing apply to that line as to any other single-spaced line
- **AND** ideographic spaces (U+3000) in that face, like ordinary spaces, do not set the line height

#### Scenario: Hinted character the East Asian face cannot draw

- **GIVEN** a run with `w:hint="eastAsia"` that holds a non-breaking hyphen (U+2011), and an East Asian face with no glyph for it
- **WHEN** layout measures the line, in any East Asian run language
- **THEN** the hyphen takes the Latin slot, with the Latin face's advance
- **AND** the East Asian face does not set the line height
- **AND** a hinted character that the East Asian face draws keeps that face and its line

#### Scenario: Stand-in keeps its own box

- **GIVEN** a run that names a missing CJK family that a packaged face answers, or CJK text that a glyph fallback draws
- **WHEN** layout measures the line
- **THEN** a taller stand-in or fallback face keeps its own box
- **AND** a one-em face takes 1.3 em in either role

#### Scenario: A localized name or a synthesized style draws as the family

- **GIVEN** a run that names `メイリオ`, and a host that supplies the `Meiryo` face
- **WHEN** layout measures the line
- **THEN** the run draws in `Meiryo` and takes its 1.3 times face box line
- **AND** a bold run in a family whose host supplies only the regular face draws in that face with a synthesized bold, not in the packaged CJK face

#### Scenario: A stand-in for the symbol fallback face keeps its line

- **GIVEN** a ballot box (U+2610) that neither the East Asian nor the Latin face of its run can draw
- **WHEN** a packaged symbol face stands in for the missing symbol fallback face
- **THEN** the glyph draws in the packaged face with its own advance
- **AND** the line is the 1.33 em line of the symbol fallback face, not the packaged face's 1.7 em

### Requirement: Fitted text takes its stated width

Consecutive runs whose `w:fitText` carries one `w:id` SHALL form one group that takes the `w:val` width of its first run. Narrower text SHALL give every character except the last the same extra advance. Wider text SHALL compress every character advance by one factor. The group SHALL NOT open a new line inside it.

#### Scenario: A fitted phrase keeps its paragraph on one line

- **GIVEN** a paragraph whose fitted run is wider at its natural width than its `w:fitText` value
- **WHEN** the paragraph lays out in a column that holds the stated width
- **THEN** the run takes exactly the stated width
- **AND** the paragraph takes one line

#### Scenario: A justified line leaves a fitted group alone

- **GIVEN** a justified paragraph whose first line holds a fitted group with spaces
- **WHEN** the line stretches to the margins, or would have to shrink the group's spaces to keep it
- **THEN** the spacing inside the group stays as the group states
- **AND** a group that does not fit without shrinking its own spaces moves to the next line

### Requirement: LISTNUM fields number from the list walk

A body `LISTNUM` field SHALL display the next number of its list, computed from the list definitions and never by running the instruction. A name that matches a `w:abstractNum` `w:name` SHALL count on the counters of that list, which its numbered paragraphs share. The built-in names and unknown names SHALL count on one built-in list. A field SHALL count after the number of its own paragraph, and its number SHALL replace a saved result.

#### Scenario: Headings number with a named list and no saved result

- **GIVEN** a list definition named `schedule numbering` whose level 5 text is `[%5]`
- **WHEN** three paragraphs each start with `LISTNUM "schedule numbering" \l 5` and no saved result
- **THEN** the fields display `[1]`, `[2]`, and `[3]`

#### Scenario: A field and a numbered paragraph continue each other

- **GIVEN** a numbered paragraph of a named list that shows `S1.`
- **WHEN** a `LISTNUM` field that names the list at level 1 follows it, and then another numbered paragraph of the list
- **THEN** the field displays `S2.` and the paragraph shows `S3.`

### Requirement: Header and footer lists share one count

Header and footer stories SHALL count list items on one shared count that the body and notes do not join. The count SHALL run over the sections in order and, within a section, over the parts that section references itself: even header, default header, even footer, default footer, first-page header, first-page footer. An inherited part SHALL keep the numbers of its referencing section.

#### Scenario: A footer list continues the header list

- **GIVEN** a section whose default header holds two items of a list and whose default footer holds two items of the same list
- **WHEN** the document lays out on several pages
- **THEN** every page shows `1.` and `2.` in the header and `3.` and `4.` in the footer
