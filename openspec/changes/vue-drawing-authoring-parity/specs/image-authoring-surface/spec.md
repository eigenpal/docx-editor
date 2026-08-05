## ADDED Requirements

### Requirement: Vue image authoring mirrors React capabilities

The Vue adapter SHALL expose insert, properties, wrap, alt text, resize handles, anchored move, and keyboard resize for drawings, consuming the shared engine chrome slots and `SelectedImageState` published by `typed-drawings-and-images`.

#### Scenario: Wrap menu shows engine value

- **WHEN** a drawing with `wrapSquare` and `@wrapText="left"` is selected in Vue
- **THEN** the wrap menu shows Square Left as the current choice via `ToolbarCommandState.value`

#### Scenario: Insert is refused by engine reason

- **WHEN** the caret is inside a locked content control
- **THEN** Vue renders `image.insert` disabled with the same engine reason React shows

#### Scenario: One commit per drag

- **WHEN** the user completes a resize drag in Vue
- **THEN** one engine command commits with the final extent

### Requirement: Vue does not write package state directly

The Vue adapter SHALL submit engine commands only. It SHALL NOT mutate OOXML, relationships, content types, media parts, or painted DOM.

#### Scenario: Properties dialog submits one command

- **WHEN** the user saves alt text in the Vue properties panel
- **THEN** one `set-image-alt-text` command commits through the store

### Requirement: No paired-support claim before this change lands

Documentation and parity contract SHALL NOT describe drawings as adapter-supported until this capability is implemented and verified.

#### Scenario: Feature matrix honesty

- **WHEN** this change is not merged
- **THEN** the Vue adapter feature matrix does not claim image authoring parity
