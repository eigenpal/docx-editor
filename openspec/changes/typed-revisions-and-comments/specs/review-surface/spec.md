## ADDED Requirements

### Requirement: The declared review chrome slots become wired

`review.comments` and `review.editingMode` already exist in the chrome registry and are absent from the slot→command table, so they render disabled with "not wired to an editor command". Both SHALL be wired. The registry SHALL additionally gain `review.accept`, `review.reject`, `review.acceptAll`, `review.rejectAll`, and `review.displayMode`. `ChromeSlotId` is public API forever, so these ids SHALL NOT be renamed after they ship.

#### Scenario: Both adapters light up from one row

- **WHEN** `review.comments` is added to the slot→command table
- **THEN** the React and Vue default toolbars derive the control from `CHROME_GROUPS` with no hand-listing in either adapter

#### Scenario: Disabled reasons come from the engine

- **WHEN** `review.accept` is unavailable because the caret is not in a revision
- **THEN** the control renders disabled with the engine's own reason, never a string invented by the adapter

#### Scenario: Editing mode reflects live state

- **WHEN** suggesting mode is active
- **THEN** `review.editingMode` renders its current value as suggesting, not as a static label

#### Scenario: Display mode is a value slot

- **WHEN** the user selects a display mode
- **THEN** it changes what layout produces and applies no `TreeDocOp`

### Requirement: A review sidebar lists threads and revisions anchored to their positions

The adapter SHALL present comment threads and revisions in a sidebar, each anchored to the vertical position of its range, ordered by document position, and showing author, date, and content.

#### Scenario: Cards align to their anchors

- **WHEN** a document with four comments is displayed
- **THEN** each card sits at the vertical position of its anchored range and cards do not overlap

#### Scenario: Anchor positions come from layout records

- **WHEN** card positions are computed
- **THEN** they derive from semantic layout records, not from measuring painted DOM

#### Scenario: Selecting a card selects its range

- **WHEN** the user selects a comment card
- **THEN** the anchored range is highlighted and scrolled into view

#### Scenario: Selecting text shows its comments

- **WHEN** the caret enters a commented range
- **THEN** that comment's card is brought forward

#### Scenario: Threads render as threads only when the file says so

- **WHEN** the document has no `commentsExtended.xml`, as the comprehensive fixture
- **THEN** all four comments render as independent top-level cards, and reply and resolve are offered as actions that will create the missing part rather than shown as broken

#### Scenario: Orphaned comments are listed

- **WHEN** a comment's anchor is orphaned
- **THEN** the sidebar lists it, marked orphaned, rather than dropping it

#### Scenario: Comments outside the body are attributed

- **WHEN** a comment is anchored in a header, footer, or note
- **THEN** its card states which story it belongs to

### Requirement: Accept and reject are reachable per revision, per selection, and for all

The surface SHALL offer accept and reject for the revision at the caret, for every revision in a selection, and for the whole document, plus navigation to the next and previous revision. A document-wide action SHALL be confirmed before it is applied.

#### Scenario: Accept the revision at the caret

- **WHEN** the caret is inside a revision and the user invokes `review.accept`
- **THEN** that revision is accepted and the surrounding text re-flows

#### Scenario: Accept over a selection

- **WHEN** a range spanning three revisions is selected and accept is invoked
- **THEN** all three are accepted in one transaction and one undo restores all three

#### Scenario: Accept all is confirmed

- **WHEN** the user invokes `review.acceptAll`
- **THEN** a confirmation is required before a document-wide, single-undo change is applied

#### Scenario: Move pairs accept together from the surface

- **WHEN** the user accepts one half of a move from the sidebar
- **THEN** both halves resolve, and the surface does not offer accepting a `moveTo` alone

#### Scenario: Navigation between revisions

- **WHEN** the user invokes next-change or previous-change
- **THEN** the caret moves to the next revision in document order, across stories, and the sidebar follows

### Requirement: Suggesting mode is visible and requires an author

Suggesting mode SHALL be visible without opening a menu, and the adapter SHALL obtain an author before enabling it, because the engine refuses to enable it without one.

#### Scenario: Mode is unmistakable

- **WHEN** suggesting mode is active
- **THEN** the editing-mode control shows it, and it is discoverable without opening a menu

#### Scenario: Author prompt before enabling

- **WHEN** the user enables suggesting mode with no author configured
- **THEN** the adapter obtains an author before enabling, because enabling without one is refused by the engine

#### Scenario: Typing is visibly tracked

- **WHEN** the user types in suggesting mode
- **THEN** the text appears with insertion presentation immediately, in the same repaint as the keystroke's commit

### Requirement: The review surface is localized and accessible

Every user-facing string on the review surface SHALL resolve through the i18n layer, and comment cards and revision indicators SHALL be reachable by keyboard and exposed to assistive technology.

#### Scenario: No hardcoded English

- **WHEN** cards, actions, mode labels, and confirmations render
- **THEN** every string resolves through the i18n layer and `bun run i18n:validate` passes

#### Scenario: Dates are localized

- **WHEN** a comment's date renders
- **THEN** it is formatted for the active locale rather than printed as a raw ISO string

#### Scenario: Cards are keyboard-reachable

- **WHEN** the user navigates without a pointer
- **THEN** comment cards and their reply, resolve, accept, and reject actions are reachable and invocable

#### Scenario: Sidebar mousedown does not steal the caret

- **WHEN** the user presses a sidebar control that is not an INPUT, SELECT, or TEXTAREA
- **THEN** the mousedown is prevented so the caret does not move

#### Scenario: Comment text is never built from a string into DOM

- **WHEN** a comment's author, initials, or body text is rendered
- **THEN** it is set as text content, never assigned as markup, because every value in a comment part is attacker-controlled
