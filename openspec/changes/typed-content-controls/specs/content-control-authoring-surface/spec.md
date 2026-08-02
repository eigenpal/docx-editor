## ADDED Requirements

### Requirement: Typed controls offer an interactive widget

The painted surface SHALL offer a widget for each control type that has a value: a menu of `w:listItem` entries for a dropdown and a combo box, a date picker for a date control, and a toggle for a `w14:checkbox` control. Each widget SHALL commit through set-content-control-value, so it is an ordinary undoable edit.

#### Scenario: Dropdown opens its own items

- **WHEN** the user activates a dropdown control's widget
- **THEN** the menu lists exactly the control's `w:listItem` entries by display text

#### Scenario: Combo box allows a free value

- **WHEN** the user types a value not in a combo box's items
- **THEN** it is accepted and committed

#### Scenario: Date picker writes both value and display

- **WHEN** the user picks a date
- **THEN** `@w:fullDate` receives the ISO value and the visible text is formatted per the control's `w:dateFormat`

#### Scenario: Widget respects the lock

- **WHEN** a control declares `contentLocked` or `sdtContentLocked`
- **THEN** its widget renders disabled with the engine's own reason and the menu does not open

#### Scenario: Widget mousedown does not steal the caret

- **WHEN** the user presses a widget trigger
- **THEN** the mousedown is prevented so the caret does not move, per the chrome mousedown rule

#### Scenario: Toggling a checkbox rewrites state and glyph together

- **WHEN** the user toggles one of the comprehensive fixture's four `w14:checkbox` controls
- **THEN** `w14:checked` flips and the content glyph is rewritten from that control's own `w14:checkedState` / `w14:uncheckedState` value and font, in one transaction
- **AND** the glyph is never hardcoded — a control declaring states other than 2612 / 2610 uses its own

### Requirement: Form-fill navigation across controls

The surface SHALL offer a navigation mode in which Tab and Shift+Tab move between editable controls, ordered by `w:tabIndex` where declared and by document order otherwise. Locked controls SHALL be skipped.

#### Scenario: Tab moves between controls

- **WHEN** the caret is in a control and the user presses Tab in form-fill mode
- **THEN** focus moves to the next editable control and its content is selected for replacement

#### Scenario: tabIndex ordering

- **WHEN** controls declare `w:tabIndex`
- **THEN** navigation follows those values before falling back to document order

#### Scenario: Locked controls are skipped

- **WHEN** the next control in order declares `contentLocked`
- **THEN** navigation skips it rather than landing somewhere the user cannot type

#### Scenario: Tab in a table cell is unambiguous

- **WHEN** the caret is in a control inside a table cell and the user presses Tab
- **THEN** the resolved behaviour — next control or next cell — is defined and consistent, not decided by event ordering

#### Scenario: Mode is explicit

- **WHEN** form-fill navigation is not active
- **THEN** Tab keeps its ordinary meaning and controls do not capture it

### Requirement: Control boundaries are visible on demand, not always

Control chrome — a boundary indicator and the control's alias — SHALL be shown when the caret is inside the control or when a show-all-controls affordance is enabled, and SHALL NOT be painted permanently over every control.

#### Scenario: Chrome on caret entry

- **WHEN** the caret enters a control
- **THEN** its boundary and alias are shown

#### Scenario: Chrome is not document content

- **WHEN** boundary chrome is visible
- **THEN** it contributes no layout records, changes no page geometry, and is excluded from selection

#### Scenario: Show-all mode

- **WHEN** the user enables show-all-controls
- **THEN** every control's boundary is indicated, and disabling it removes them with no reflow

### Requirement: Control inspector and removal

The adapter SHALL expose an inspector reporting a control's tag, alias, type, lock state, and placeholder state, and a context-menu action removing the control while keeping its content.

#### Scenario: Inspector reports live state

- **WHEN** the caret is inside a control
- **THEN** the inspector shows that control's tag, alias, type, and lock, read from the boundary record

#### Scenario: Remove keeps content

- **WHEN** the user removes an unlocked control
- **THEN** its content stays in the document at the same position, the wrapper is gone, and page geometry is unchanged

#### Scenario: Remove is refused on a locked control

- **WHEN** the user attempts to remove a control declaring `sdtLocked` or `sdtContentLocked`
- **THEN** the action renders disabled with the engine's reason, and invoking it programmatically is refused with `locked`

#### Scenario: Bound control is reported as bound

- **WHEN** the caret is inside a control declaring `w:dataBinding`
- **THEN** the inspector states that the control is bound to external data and that editing is refused

### Requirement: The control surface is localized and accessible

Every user-facing string on the control surface SHALL resolve through the i18n layer, and each widget SHALL expose an accessible role, name, and value.

#### Scenario: No hardcoded English

- **WHEN** the inspector, widget labels, and context-menu entries render
- **THEN** every string resolves through the i18n layer and `bun run i18n:validate` passes

#### Scenario: Widget roles

- **WHEN** a screen reader reaches a dropdown control's widget
- **THEN** it exposes a listbox-equivalent role, the control's alias as its accessible name, and its current value

#### Scenario: Locked state is announced

- **WHEN** a screen reader reaches a locked control
- **THEN** its disabled or read-only state is exposed, not merely conveyed by styling

#### Scenario: Placeholder is announced as a prompt

- **WHEN** a screen reader reaches a control showing placeholder text
- **THEN** the text is exposed as a prompt rather than as the control's value
