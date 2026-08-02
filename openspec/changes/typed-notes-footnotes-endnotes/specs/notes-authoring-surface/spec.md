## ADDED Requirements

### Requirement: Note insertion is a wired chrome slot

The chrome registry SHALL gain an `insert` group with `insert.footnote` and `insert.endnote`, and both SHALL be present in the slot→command table so `commandForSlot` answers a command rather than `null`. `ChromeSlotId` is public API forever, so these ids SHALL NOT be renamed after they ship.

#### Scenario: Both adapters light up from one row

- **WHEN** `insert.footnote` is added to the slot→command table
- **THEN** the React and Vue default toolbars derive the control from `CHROME_GROUPS` with no hand-listing in either adapter

#### Scenario: Disabled state carries the engine's reason

- **WHEN** the caret is somewhere a note cannot be inserted — inside a note body, or inside a locked content control
- **THEN** the control renders disabled and its tooltip is the engine's own `disabledReason`, never a string invented by the adapter

#### Scenario: Keyboard parity with Word

- **WHEN** the user presses `Ctrl+Alt+F` (`Cmd+Alt+F` on macOS)
- **THEN** a footnote is inserted, and `Ctrl+Alt+D` inserts an endnote

#### Scenario: Insert with a range selected

- **WHEN** a range is selected and insert-footnote runs
- **THEN** the reference is placed at the end of the selection and the selected text is unchanged

### Requirement: A note body is an editable scope on the painted surface

Clicking into a painted note body SHALL place a caret and accept input. Typing, formatting, and undo SHALL behave as in the body, and every mutation SHALL route through the store, not through browser DOM mutation.

#### Scenario: Click into a note

- **WHEN** the user clicks inside a painted footnote body
- **THEN** a caret appears at the clicked position and the toolbar's active state reflects the formatting there

#### Scenario: Browser mutation is re-expressed

- **WHEN** the browser attempts a native DOM mutation inside a note
- **THEN** it is prevented and re-expressed as a `TreeDocOp`, exactly as in the body — the painted DOM is a picture

#### Scenario: Formatting in a note re-flows the page

- **WHEN** the user bolds text in a note and the note's flow height changes
- **THEN** the referencing page re-paginates and the published layout equals a clean full layout

#### Scenario: Focus scope is unambiguous

- **WHEN** the caret is inside a note body
- **THEN** toolbar commands apply to the note, not to the last body selection

### Requirement: Navigation between a reference and its note

Clicking a reference mark SHALL scroll its note into view and focus it; clicking a note's own mark SHALL return to the reference. Hovering a reference SHALL preview the note's text without moving the caret.

#### Scenario: Jump to note

- **WHEN** the user clicks a reference mark
- **THEN** the view scrolls the note into view and places the caret in it

#### Scenario: Jump back

- **WHEN** the user clicks the mark at the start of a note body
- **THEN** the view scrolls to the referencing position and places the caret after the reference

#### Scenario: Hover preview

- **WHEN** the pointer rests on a reference mark
- **THEN** a popover shows the note's text after a short delay, dismissing on pointer-out, Escape, or scroll
- **AND** on touch input a tap navigates instead of showing a popover

#### Scenario: Preview does not steal the caret

- **WHEN** the preview popover appears
- **THEN** its mousedown is prevented so the caret does not move, per the chrome mousedown rule

### Requirement: Note properties dialog

The React adapter SHALL provide a dialog editing `numFmt`, `numStart`, `numRestart`, and `pos` for footnotes and endnotes, with an explicit scope choice of whole document or current section.

#### Scenario: Apply to the whole document

- **WHEN** the user sets footnote numbering to `lowerRoman` with document scope
- **THEN** the value is written to `w:settings` and every section without an override re-derives its marks

#### Scenario: Apply to one section

- **WHEN** the user sets `numRestart` to `eachSect` with section scope
- **THEN** the value is written to that section's `w:sectPr` and other sections are unchanged

#### Scenario: Inherited values are shown as inherited

- **WHEN** the dialog opens on a document with no authored note properties
- **THEN** it shows the resolved defaults and marks them inherited, so applying nothing writes nothing

#### Scenario: Endnote position choices are constrained

- **WHEN** the user opens the endnote position control
- **THEN** it offers only end-of-section and end-of-document

### Requirement: Note context menu

A note body SHALL offer a context menu with delete, convert to the other note kind, and convert all notes of its kind. Every entry SHALL commit through the store as one undoable transaction.

#### Scenario: Convert one note

- **WHEN** the user opens the context menu on a footnote body and chooses convert to endnote
- **THEN** the note converts, both sequences re-derive, and it is one undo step

#### Scenario: Convert all

- **WHEN** the user chooses convert all footnotes to endnotes
- **THEN** every footnote converts in document order, preserving relative order in the endnote sequence

#### Scenario: Delete

- **WHEN** the user chooses delete on a note body
- **THEN** the note and its reference are removed together

### Requirement: The note surface is localized and accessible

Every user-facing string on the note surface SHALL resolve through the i18n layer, and reference marks and note bodies SHALL be reachable by keyboard and exposed to assistive technology with an accessible name and a reference→note relationship.

#### Scenario: No hardcoded English

- **WHEN** any note control, dialog label, or context-menu entry renders
- **THEN** its string resolves through the i18n layer and `bun run i18n:validate` passes

#### Scenario: Reference marks are reachable and named

- **WHEN** a screen reader reaches a reference mark
- **THEN** it exposes an accessible name identifying kind and number, and an accessible relationship to its note body

#### Scenario: Keyboard-only navigation

- **WHEN** the user navigates without a pointer
- **THEN** reference marks and note bodies are reachable and the jump-to-note action is invocable from the keyboard
