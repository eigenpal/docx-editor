## ADDED Requirements

### Requirement: Honest command and query

The public editor SHALL answer `refreshToc` and `isInsideToc` from real TOC detection rather than stubs.

#### Scenario: isInsideToc follows caret

- **WHEN** the caret is inside a detected TOC field (including SDT-wrapped)
- **THEN** `query({ type: 'isInsideToc', pos })` returns `true`

#### Scenario: refreshToc is supported when a TOC exists

- **WHEN** the document has a refreshable TOC and is editable
- **THEN** `can({ type: 'refreshToc' })` succeeds and `exec` runs the pipeline

### Requirement: Insert menu authors a generated TOC

The shared Insert chrome SHALL expose an enabled Table of contents action when the caret is in an editable body paragraph. Activating it SHALL insert an SDT-wrapped TOC field immediately before that paragraph, include heading levels 1–3 with hyperlinks, create bounded heading bookmarks, and derive page numbers through the normal layout pipeline.

#### Scenario: Insert a table of contents

- **WHEN** the user selects Table of contents from the Insert menu in an editable body paragraph
- **THEN** one generated TOC is inserted, populated from the current outline, painted through shared SDT chrome, and its result rows use the same read-only navigation behavior as refreshed TOCs

#### Scenario: Undo insertion phases

- **WHEN** the user undoes immediately after an insertion whose page-number convergence moved a digit
- **THEN** the first undo restores the pre-convergence digits and the next removes the inserted TOC and bookmarks

#### Scenario: Convergence that moves nothing is not a step

- **WHEN** page-number convergence finds every digit already correct
- **THEN** it writes nothing, reports no change, and the insertion or refresh remains a single undo step

### Requirement: Contextual update actions

A right-click on a detected TOC SHALL publish which table of contents it addressed, so the host's own context menu can offer Update entire table and Update page numbers rows for it. The engine SHALL NOT paint a menu of its own, and SHALL NOT paint a duplicate TOC-specific trigger over SDT boundary chrome.

#### Scenario: The right-click target is published, not consumed

- **WHEN** the user right-clicks a TOC row or an empty-TOC placeholder
- **THEN** the addressed TOC is reported as the editor's TOC context, the event is not suppressed, and the contenteditable caret is not moved

#### Scenario: Context is cleared by a right-click elsewhere

- **WHEN** the next right-click lands outside every detected TOC
- **THEN** the TOC context reports null, so the update rows do not appear in a menu opened over ordinary text

#### Scenario: Update rows are the host's context-menu rows

- **WHEN** the host's context menu opens with a TOC context
- **THEN** the update actions render as ordinary rows of that one menu primitive, with its icon, keyboard and disabled treatment, and their labels come from i18n keys present in every shipped locale without null fallbacks

### Requirement: TOC row navigation

Detected TOC field and result paragraphs SHALL paint as a generated, read-only navigation surface. They SHALL refuse caret placement, text selection, typing, deletion, and formatting while preserving right-click update actions. Clicking a cached TOC result row SHALL resolve that row's own heading and snap the editor viewport to it, placing the caret there.

#### Scenario: Generated result refuses editing

- **WHEN** pointer, keyboard, IME, or command input targets a detected TOC paragraph
- **THEN** no caret or range is placed inside it and no document edit is committed

#### Scenario: Caret navigation crosses the region

- **WHEN** a caret movement lands inside a detected TOC and the selection is not being extended
- **THEN** the caret continues past the whole region in the direction of travel and comes to rest on the first paragraph outside it, so no content is unreachable from the keyboard

#### Scenario: Row has no authored hyperlink

- **WHEN** the user clicks a TOC result row whose instruction omits the hyperlink switch
- **THEN** the surface resolves the row through its own title text and immediately reveals that heading without smooth scrolling

#### Scenario: Row names no current heading

- **WHEN** the user clicks a cached TOC result row whose anchor and title match no heading the document still has
- **THEN** the click is inert and the selection does not move
