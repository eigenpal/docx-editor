## ADDED Requirements

### Requirement: An open header or footer scope behaves exactly as the body editor

Inside an open scope, editing SHALL be the body editor's behaviour applied to the header or footer story. Every editing capability the body has SHALL work identically, with the story boundary as the **only** difference. There SHALL NOT be a reduced or special-cased editing path for page furniture.

This covers, without exception: text entry and replacement; IME composition; backward and forward deletion across run boundaries; paragraph split and join; click, drag, double-click-word, triple-click-paragraph, Shift-click, and select-all; arrow, word-wise, line-wise, Home/End, and page navigation; every mark and paragraph command the toolbar exposes; styles; lists and indentation; tables; find and replace; copy, cut, and paste; the context menu; and undo and redo.

Scope-boundary rules that follow from it: select-all selects the story, not the document; Home/End and line navigation resolve within the story; arrow navigation off the story's last position does not walk into the body; and paste of block content lands in the story.

#### Scenario: Every toolbar command applies in scope

- **WHEN** a header scope is open with a selection, and any enabled toolbar command is invoked
- **THEN** it applies to the header story with the same effect it would have on an equivalent body selection
- **AND** a command is disabled in the scope only where the engine gives a reason, never because the surface is a header

#### Scenario: Word-like keyboard behaviour is identical

- **WHEN** the user presses Enter, Backspace, Delete, Mod-B/I/U, or select-all in an open scope
- **THEN** the resulting document state matches what the same keys produce on equivalent body content

#### Scenario: IME composition is one entry

- **WHEN** the user composes text with an IME in an open scope
- **THEN** the composition commits as one semantic history entry, exactly as in the body

#### Scenario: Select-all is scoped

- **WHEN** the user presses select-all in an open header scope
- **THEN** the header story is selected and no body content is selected

#### Scenario: Navigation stops at the story boundary

- **WHEN** the caret is at the last position of an open header scope and the user presses the right arrow
- **THEN** the caret stays within the story rather than continuing into the body

#### Scenario: Undo is scoped to the edit, not to the surface

- **WHEN** the user edits a header, leaves the scope, and presses undo
- **THEN** the header edit is undone as one entry, through the same semantic history the body uses

#### Scenario: Tables and lists behave the same

- **WHEN** a header contains a table or a list and the user edits it in scope
- **THEN** cell navigation, row behaviour, and list continuation match the body's

#### Scenario: Find and replace reaches the open scope

- **WHEN** find is invoked with a header scope open
- **THEN** matches within that story are found and selectable

### Requirement: Header and footer stories become an editable scope

Entering a header or footer scope SHALL make that story's painted fragments selectable and editable; leaving SHALL restore the body scope. Outside the scope the story remains page furniture: `contenteditable=false`, carrying `[data-docx-hf]`, and excluded from selection. Every mutation SHALL route through the store, never through browser DOM mutation.

#### Scenario: Double-click enters

- **WHEN** the user double-clicks the painted header on page 5
- **THEN** the scope opens on the part page 5 resolves to, with the caret at the clicked position

#### Scenario: Escape leaves

- **WHEN** the user presses Escape while in a header scope
- **THEN** the scope closes, focus returns to the body, and the body selection active before entering is restored

#### Scenario: Furniture is inert outside the scope

- **WHEN** the user drags a selection through the body across a page boundary and no furniture scope is open
- **THEN** header and footer text is not selected, exactly as today

#### Scenario: Empty region is enterable

- **WHEN** the user double-clicks the header region of a page in a section with no header, as the comprehensive fixture's first section
- **THEN** the scope opens empty for that section, and a part is created only once content is committed

#### Scenario: Browser mutation is re-expressed

- **WHEN** the browser attempts a native DOM mutation inside an open furniture scope
- **THEN** it is prevented and re-expressed as a `TreeDocOp`

#### Scenario: One story, many pages

- **WHEN** a header applies to seven pages and the user edits it
- **THEN** all seven pages repaint from the single re-laid story, and the edit is one transaction

### Requirement: Chrome names the region, section, variant, and inheritance

The scope's chrome SHALL state the region kind, the section it belongs to, the variant in effect, and whether the part is inherited from the preceding section.

#### Scenario: Own part

- **WHEN** the user edits a header the section declares itself
- **THEN** the chrome reads "Header — Section 3" (localized)

#### Scenario: Inherited part warns before the edit

- **WHEN** the user edits a header the section inherits
- **THEN** the chrome shows "Same as previous" (localized) before any typing
- **AND** the user is told the edit will also change the preceding section's pages

**Depends on** the inherited-vs-declared resolution query (`section-page-furniture`); not available from today's `getHeaderFooterState()` stub.

#### Scenario: Variant is named

- **WHEN** the section sets `w:titlePg` and the user edits its first page's header
- **THEN** the chrome reads "First Page Header — Section 3"

#### Scenario: Chrome is UI only

- **WHEN** the chrome renders
- **THEN** it contributes no layout records and no canonical nodes, and hiding it changes nothing about the painted page geometry

### Requirement: Options menu exposing the furniture settings

The chrome SHALL expose different-first-page, different-odd-and-even, link-to-previous, header distance, footer distance, remove header, and remove footer. Every control SHALL reflect live document state and SHALL be disabled with the engine's own reason when unavailable.

#### Scenario: Toggles reflect the document

- **WHEN** the menu opens on a section with `w:titlePg` set
- **THEN** different-first-page renders checked

#### Scenario: Odd and even is shown as document-wide

- **WHEN** the user opens different-odd-and-even
- **THEN** the control states it applies to the whole document

#### Scenario: Link to previous disabled on the first section

- **WHEN** the menu opens while editing a part in the first section
- **THEN** link-to-previous renders disabled

#### Scenario: Unlink produces an independent copy

- **WHEN** the user turns off link-to-previous on an inherited header
- **THEN** the header becomes an independent copy and later edits stop affecting the preceding section
- **AND** the open scope rebinds to the clone at the equivalent caret position

#### Scenario: Remove header

- **WHEN** the user chooses remove header
- **THEN** the section's reference is removed, its pages resolve by inheritance, and an orphaned part is collected with its relationship and override

#### Scenario: Distances are units-explicit

- **WHEN** the user edits header distance from edge
- **THEN** the value is shown in the document's display unit and written as twips

### Requirement: The furniture surface is localized, keyboard-reachable, and caret-safe

The scope's chrome SHALL resolve every user-facing string through the i18n layer, SHALL be reachable and operable by keyboard, and SHALL NOT move the caret when a non-input control is pressed.

#### Scenario: Chrome mousedown does not steal the caret

- **WHEN** the user presses a chrome control that is not an INPUT, SELECT, or TEXTAREA
- **THEN** the mousedown is prevented so the caret does not move

#### Scenario: Keyboard entry

- **WHEN** the user navigates without a pointer
- **THEN** the furniture scope can be entered from the keyboard and the chrome's controls are in the tab order

#### Scenario: Tabbing past the last control

- **WHEN** a scope is open and the user tabs past the last chrome control
- **THEN** focus returns into the story content rather than escaping behind the dimming overlay

#### Scenario: No hardcoded English

- **WHEN** any chrome label, menu entry, or section indicator renders
- **THEN** its string resolves through the i18n layer and `bun run i18n:validate` passes
