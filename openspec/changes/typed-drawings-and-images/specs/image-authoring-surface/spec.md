## ADDED Requirements

### Requirement: The declared image chrome slots become wired

`image.insert` and `image.properties` already exist in the chrome registry and are absent from the slot→command table, so they render disabled with "not wired to an editor command". Both SHALL be wired, and the registry SHALL gain `image.wrap` and `image.altText`. `ChromeSlotId` is public API forever, so the new ids SHALL NOT be renamed after they ship.

#### Scenario: Both adapters light up from one row

- **WHEN** `image.insert` is added to the slot→command table
- **THEN** the React and Vue default toolbars derive the control from `CHROME_GROUPS` with no hand-listing in either adapter

#### Scenario: Properties is contextual

- **WHEN** no drawing is selected
- **THEN** `image.properties`, `image.wrap`, and `image.altText` render disabled with the engine's own reason

#### Scenario: Insert is refused where a drawing cannot go

- **WHEN** the caret is inside a `contentLocked` content control
- **THEN** `image.insert` renders disabled and invoking it programmatically is refused with `locked`

### Requirement: A selected drawing has resize handles that write extent

Selecting a drawing SHALL present resize handles. Dragging one SHALL commit a resize through the store; it SHALL NOT re-encode the media.

#### Scenario: Corner drag preserves aspect ratio

- **WHEN** the user drags a corner handle
- **THEN** the aspect ratio is preserved, and holding the modifier key releases the constraint

#### Scenario: Resize is one history entry

- **WHEN** a drag completes
- **THEN** one transaction commits with the final extent, so a drag is one undo rather than one per pointer move

#### Scenario: Live feedback is not a commit

- **WHEN** the user is mid-drag
- **THEN** the preview does not apply a `TreeDocOp` on each pointer move

#### Scenario: Media is untouched

- **WHEN** a resize commits and the document is saved
- **THEN** the media part is byte-identical to before the resize

#### Scenario: Handles come from layout records

- **WHEN** handle positions are computed
- **THEN** they derive from the drawing's semantic layout record, not from measuring painted DOM

### Requirement: An anchored drawing can be repositioned by dragging

Dragging an anchored drawing SHALL commit a new position through the store, expressed in its declared `ST_RelFromH` / `ST_RelFromV` frames.

#### Scenario: Drag writes a position offset

- **WHEN** the user drags a floating drawing
- **THEN** `wp:posOffset` is written against the existing frames rather than the frames being changed

#### Scenario: Inline drawings do not drag

- **WHEN** the user drags an inline drawing
- **THEN** it is not repositioned as a floating object; converting it requires an explicit wrap-mode change

#### Scenario: Auto-scroll near an edge

- **WHEN** a drag approaches the viewport edge
- **THEN** the view scrolls, and the committed position accounts for the scroll

### Requirement: Wrap mode is a menu, and changing it re-flows

`image.wrap` SHALL offer the wrap modes with their `ST_WrapText` sides. Changing it SHALL commit through the store and re-run layout.

#### Scenario: Menu reflects the current mode

- **WHEN** a drawing with `wrapSquare` is selected
- **THEN** the menu shows square as active

#### Scenario: Inline to floating

- **WHEN** the user changes an inline drawing to `wrapSquare`
- **THEN** `wp:inline` becomes `wp:anchor` with declared frames and a position derived from where the drawing currently sits, in one transaction

#### Scenario: Floating to inline

- **WHEN** the user changes a floating drawing to inline
- **THEN** `wp:anchor` becomes `wp:inline`, the anchor-only attributes are dropped, and the drawing takes a position in the run stream

#### Scenario: Text re-flows

- **WHEN** the wrap mode changes
- **THEN** the surrounding text re-flows and the published layout equals a clean full layout of the result

### Requirement: Image properties dialog covers size, crop, alt text, and position

The dialog SHALL edit width and height, the crop rectangle, alt text, and — for an anchored drawing — its position frames and offsets. Values SHALL be shown in the document's display unit and written in the file's units.

#### Scenario: Size is units-explicit

- **WHEN** the dialog shows an image's size
- **THEN** it is shown in the display unit and written as EMU to `wp:extent`

#### Scenario: Crop writes srcRect

- **WHEN** the user sets a crop
- **THEN** `a:srcRect` receives the percentage insets and the media bytes are unchanged

#### Scenario: Reset size

- **WHEN** the user resets an image to its natural size
- **THEN** the extent is recomputed from the decoded media's intrinsic dimensions and its DPI

#### Scenario: Alt text is authored, not generated

- **WHEN** the user edits alt text
- **THEN** `wp:docPr/@descr` receives exactly what was typed
- **AND** leaving it empty writes no attribute rather than a generated description

#### Scenario: Dialog is unavailable for an unsupported graphic

- **WHEN** a chart or diagram placeholder is selected
- **THEN** size and position are editable and picture-only fields — crop, reset-to-natural-size — are disabled with the engine's reason

### Requirement: The image surface is localized, accessible, and does not steal the caret

Every user-facing string SHALL resolve through the i18n layer, drawings SHALL be reachable and operable by keyboard, and image chrome SHALL NOT move the caret.

#### Scenario: No hardcoded English

- **WHEN** the wrap menu, properties dialog, and placeholder text render
- **THEN** every string resolves through the i18n layer and `bun run i18n:validate` passes

#### Scenario: Chrome mousedown does not steal the caret

- **WHEN** the user presses a handle or a menu trigger that is not an INPUT, SELECT, or TEXTAREA
- **THEN** the mousedown is prevented so the caret does not move

#### Scenario: Alt text reaches assistive technology

- **WHEN** a screen reader reaches a painted drawing
- **THEN** its accessible name is the authored `@descr`, falling back to `@name`
- **AND** a drawing with neither is exposed as decorative rather than announced as an unnamed image

#### Scenario: Keyboard resize

- **WHEN** a drawing is selected and the user presses an arrow key with the resize modifier
- **THEN** the extent changes by a defined step and commits as one history entry

#### Scenario: Placeholder text is never built from a string into DOM

- **WHEN** a placeholder shows a format name or a relationship target derived from the file
- **THEN** the value is set as text content, never assigned as markup, because every value in a package is attacker-controlled
