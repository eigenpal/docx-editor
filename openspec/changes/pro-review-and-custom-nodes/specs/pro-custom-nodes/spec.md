# pro-custom-nodes Specification (delta)

## ADDED Requirements

### Requirement: defineCustomNode anchors on run-level SDTs with w:tag identity

`@docx-editor.dev/pro` SHALL export `defineCustomNode(definition)` producing a custom node type anchored on a run-level SDT. Node identity and attrs SHALL be carried in `w:tag` as `<prefix>:<name>?<urlencoded attrs>`; payloads exceeding the 64-character tag limit SHALL be stored in a customXml data part referenced from the tag. Inline `w:customXml` markup SHALL NOT be used (Word 2010+ strips it). Serialized SDTs SHALL default to `w:lock val="sdtLocked"` unless the definition opts out.

#### Scenario: Custom node survives Word round-trip

- **WHEN** a document containing a custom node is edited and saved in Word, then reopened in the editor
- **THEN** the SDT wrapper and tag survive and `fromDocx` re-recognizes the node with its attrs

#### Scenario: Oversized attrs use a data part

- **WHEN** a node's encoded attrs exceed the tag limit
- **THEN** attrs are written to a customXml data part and the tag carries the reference; recognition round-trips

### Requirement: Tag-prefix recognition and sanitized serialization

`fromDocx` SHALL be invoked for inline SDTs whose tag matches the registered prefix, receiving parsed attrs and the literal SDT content (so integrators can detect label drift from Word edits); returning null SHALL leave the SDT rendered as literal content. `toDocx` SHALL build SDT content through a ctx whose builders route every URL through `sanitizeHref` and escape all attacker-derived strings on serialize. Attrs parsed from documents SHALL be documented as untrusted input.

#### Scenario: Unrecognized SDT renders literally

- **WHEN** a document contains an inline SDT with no matching registered prefix
- **THEN** its literal run content renders and round-trips losslessly

#### Scenario: Malicious URL in crafted tag

- **WHEN** a crafted document carries a `javascript:` URL in custom-node attrs and the definition emits it via `ctx.hyperlink`
- **THEN** the URL is dropped by `sanitizeHref` and no unsanitized value reaches a DOM or XML sink

### Requirement: Framework-neutral render with measured extent

The core-facing render contract SHALL return a plain DOM element plus a measurable extent (fixed width/height or a text equivalent for `TextMeasurer`) before paint; layout SHALL use the extent for pagination. The painted host element SHALL be `contenteditable=false` furniture built via `createElement` (never HTML-from-strings). Extent changes SHALL require an explicit invalidation call; observed reflow SHALL NOT resize a node. The pro React sugar SHALL portal integrator JSX into the host element so definitions may use `render: (node) => <Component/>` in React hosts.

#### Scenario: Chip participates in pagination

- **WHEN** a custom node with a fixed extent falls near a page boundary
- **THEN** line breaking and pagination account for its extent exactly as for equivalent-width text

#### Scenario: React JSX render

- **WHEN** a definition supplies a JSX render in a React host with the pro sugar
- **THEN** the component mounts into the painted host element sized to the measured extent

### Requirement: Atomic offset semantics

A custom node SHALL occupy the UTF-16 offsets of its underlying SDT run text under the single paragraph offset authority. Caret movement SHALL treat it as one unit, backspace/delete SHALL remove the entire SDT, and copy/paste SHALL carry the underlying OOXML. Hover and click SHALL dispatch through the interaction layer via the host element's data attributes.

#### Scenario: Atomic deletion

- **WHEN** the caret sits after a custom node and backspace is pressed
- **THEN** the whole SDT is removed in one transaction and surrounding offsets remain consistent

#### Scenario: Hover hook

- **WHEN** the pointer hovers a painted custom node with an `onHover` handler
- **THEN** the handler receives the node with its attrs

### Requirement: Custom nodes can contribute review sidebar cards

`defineCustomNode` SHALL accept an optional `reviewCard` hook. When the review module's pane is mounted, each recognized node whose definition supplies the hook SHALL appear in the review queue as a `kind: 'custom'` item anchored at the node's range, sharing the pane's geometry, ordering, and active-card machinery. The pro React pane SHALL expose a card-renderer slot so hosts render custom cards with their own component. Without the review module registered, custom nodes SHALL function normally with no sidebar presence.

#### Scenario: Citation card in the sidebar

- **WHEN** a document contains a recognized custom node whose definition supplies `reviewCard` and the review pane is mounted
- **THEN** the pane shows a card anchored beside the node's page position, rendered by the host-supplied card renderer

#### Scenario: No review module, no sidebar

- **WHEN** the same document opens with only the custom-nodes module registered
- **THEN** the nodes render and interact normally and no review queue is derived
