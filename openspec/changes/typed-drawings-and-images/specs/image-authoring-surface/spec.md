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

### Requirement: The wrap menu is wired as a value-typed chrome slot

`image.wrap` SHALL be a `kind: 'value'` control in the chrome registry, so both adapters derive it from `CHROME_GROUPS` and neither hand-lists it. Wiring it requires three extensions that do not exist today, and all three SHALL land with it:

1. **The slot id.** `image.wrap` and `image.altText` SHALL be added to `ChromeSlotId`. That union is public API forever, so the ids are chosen once.
2. **A value command that is not a run mark.** `commandForSlotValue` resolves a value-typed slot through `VALUE_SLOT_MARKS` into a `setMarkAttr` command, and answers `null` for anything absent. A wrap choice is not a run-mark attribute, so the value path SHALL be widened to carry a slot-specific command. The command itself already exists: `setImageWrapType`, whose `target` is exactly the nine choices below.
3. **A current value on the state, and a snapshot that can express it.** `ToolbarCommandState` carries `{ id, enabled, disabledReason, active }`; a boolean cannot say *which* of nine choices applies. Worse, the read side is narrower than the write side: `setImageWrapType` accepts nine targets while `ImageContext.wrap` reports six — `squareLeft`, `squareRight`, and `through` are settable but not reportable. Both SHALL be widened so every choice a user can set is a choice the menu can show as selected.

The third extension is shared: `review.displayMode` and `review.editingMode` need the same current-value reporting. Whichever change lands first SHALL widen `ToolbarCommandState` once rather than adding a parallel mechanism.

#### Scenario: One registry entry lights up both adapters

- **WHEN** `image.wrap` is added to `CHROME_GROUPS` and wired
- **THEN** the React and Vue default toolbars derive the control from the registry, with no hand-listing in either adapter

#### Scenario: The menu renders its current selection

- **WHEN** a drawing with `wrapSquare` `@wrapText="left"` is selected
- **THEN** `image.wrap`'s reported value is Square Left and the menu renders that item selected
- **AND** the selection is read from the engine's reported value, not recomputed by the adapter from the document

#### Scenario: Disabled with the engine's reason

- **WHEN** no drawing is selected, or the selected drawing declares `@locked` or `a:graphicFrameLocks/@noMove`
- **THEN** `image.wrap` renders disabled and its tooltip is the engine's own `disabledReason`, never a string invented by the adapter

#### Scenario: Choosing a value commits one transaction

- **WHEN** the user picks a wrap choice from the menu
- **THEN** the engine command for that slot and value is executed once, producing one `ModelChange` and one history entry

#### Scenario: An unwired slot is honest

- **WHEN** a value-typed slot has no entry in the value-command table
- **THEN** it renders disabled with the engine's reason rather than appearing enabled and doing nothing on click

#### Scenario: The contextual image group reaches the bar

- **WHEN** the default toolbar is built and a drawing is selected
- **THEN** the `image` group's controls are reachable
- **AND** how a `contextual` group surfaces is settled once for the whole group rather than per control

### Requirement: The wrap menu presents Word's choices, each with one OOXML representation

`image.wrap` SHALL present the user-facing wrap choices Word offers, not the raw wrap-element vocabulary. A choice SHALL map to exactly one representation, and the mapping SHALL be total in both directions so a loaded document selects the right menu item:

The nine choices are `setImageWrapType`'s `target` values, unchanged:

| Menu choice (`target`) | Representation |
| --- | --- |
| In Line with Text | `wp:inline` |
| Square | `wp:anchor` + `wrapSquare` `@wrapText="bothSides"` |
| Square Left | `wp:anchor` + `wrapSquare` `@wrapText="left"` |
| Square Right | `wp:anchor` + `wrapSquare` `@wrapText="right"` |
| Tight | `wp:anchor` + `wrapTight` |
| Through | `wp:anchor` + `wrapThrough` |
| Top and Bottom | `wp:anchor` + `wrapTopAndBottom` |
| Behind Text | `wp:anchor` + `wrapNone` + `@behindDoc="1"` |
| In Front of Text | `wp:anchor` + `wrapNone` + `@behindDoc="0"` |

**Behind Text and In Front of Text are the same wrap element.** Both are `wrapNone`; only `@behindDoc` separates them. A menu derived from the wrap element alone collapses them into one entry and loses the distinction, so the menu's model SHALL be the choice above, not the wrap element.

Changing a choice SHALL commit through the store in one transaction and re-run layout.

#### Scenario: Every choice round-trips to its own menu item

- **WHEN** a document containing each of the nine representations is loaded and each drawing is selected in turn
- **THEN** the menu shows exactly the matching choice as active, with no two representations selecting the same item and no representation selecting none

#### Scenario: Behind Text and In Front of Text are distinguishable

- **WHEN** one drawing is `wrapNone` with `@behindDoc="1"` and another is `wrapNone` with `@behindDoc="0"`
- **THEN** the first shows Behind Text active and the second shows In Front of Text active
- **AND** selecting the other choice flips `@behindDoc` without changing the wrap element

#### Scenario: Behind Text paints under the text and does not displace it

- **WHEN** the user chooses Behind Text for an inline drawing
- **THEN** it becomes an anchored `wrapNone` drawing with `@behindDoc="1"`, positioned where it sat
- **AND** the surrounding text re-flows as if the drawing were absent, and the drawing paints beneath the text layer with the text legible over it

#### Scenario: In Front of Text paints over the text

- **WHEN** the user chooses In Front of Text
- **THEN** the drawing paints above the text layer, and the text still flows as if it were absent

#### Scenario: Square side is reflected, not flattened

- **WHEN** a drawing is `wrapSquare` with `@wrapText="left"`
- **THEN** the menu shows Square Left active, not a generic Square

#### Scenario: Which side `left` means is settled against Word

- **WHEN** the Square Left and Square Right items are implemented
- **THEN** the reading of `ST_WrapText` `left` and `right` — which side the text flows on — is confirmed against Word and recorded, rather than inferred from the attribute name

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
