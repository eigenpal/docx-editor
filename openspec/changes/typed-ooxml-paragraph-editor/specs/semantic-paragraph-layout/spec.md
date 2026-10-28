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

### Requirement: Hanging punctuation only on justified paragraphs

With `w:overflowPunct` on, the layout engine SHALL let line-end punctuation hang past the margin only when the paragraph alignment is justified. This SHALL apply to full-width punctuation and to Latin punctuation in a run with an East Asian language. Left-aligned, centered, and right-aligned lines SHALL keep line-end punctuation inside the margin. A document whose defaults name no East Asian face SHALL hang no punctuation.

#### Scenario: A closing quote stays inside a left-aligned line

- **GIVEN** a Japanese-language run that ends with a closing curly quote one character past the margin
- **WHEN** the paragraph is left-aligned, centered, or right-aligned
- **THEN** the quote wraps to the next line with the character before it
- **AND** the same quote hangs past the margin when the paragraph is justified

#### Scenario: A hanging mark and compression fit one line

- **GIVEN** a justified 12 pt line `甲乙。丙。` followed by more ideographs, with document punctuation compression
- **WHEN** the measure is 42.1 pt, too narrow for the final full stop to hang alone
- **THEN** the final full stop hangs past the margin and the middle full stop gives 5.9 pt
- **AND** at 41.85 pt the last ideograph and its full stop wrap

#### Scenario: A document without an East Asian default face neither fits nor hangs

- **GIVEN** document punctuation compression, a justified paragraph, and document defaults that name no East Asian face
- **WHEN** a line fits only when its punctuation compresses or hangs
- **THEN** the line wraps instead

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
