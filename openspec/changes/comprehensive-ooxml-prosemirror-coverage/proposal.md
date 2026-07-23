## Why

The production engine can preserve the comprehensive Word fixture byte-for-byte and
edit a deliberately plain paragraph subset, but it cannot yet render or edit most of
the fixture's authored OOXML. Feature support is also distributed across parser,
model, preservation, layout, ProseMirror, serializer, and adapter code without one
formal coverage contract, making parallel implementation prone to silent flattening,
central-switch growth, and unsupported claims.

## What Changes

- Establish registered OOXML feature lanes that contribute canonical modeling,
  preservation, serialization, semantic operations, ProseMirror projection and
  reconciliation, layout/display output, and fixture evidence without duplicating
  feature logic in React or Vue.
- Add a QName-plus-context support manifest derived from the repository's ECMA-376
  schemas. Report parse, model, preserve, render, ProseMirror-project, edit,
  serialize, and reopen support independently rather than as one percentage.
- Make `e2e/fixtures/comprehensive-word-element-test.docx` a versioned conformance
  corpus with explicit expectations for package safety, malformed-but-preserved
  constructs, styles and numbering, paragraphs and marks, tables, SDTs, sections and
  columns, related stories and notes, drawings, links, fields, comments, breaks,
  tabs, symbols, settings, and document properties.
- Require every unsupported construct to remain losslessly preserved and either
  render through a declared fallback or project read-only/fail closed in
  ProseMirror; absence of a mapper never permits silent flattening or deletion.
- Deliver rendering and editing as vertical slices. A feature is editable only when
  canonical operations, forward mapping, normalized reverse reconciliation,
  preservation ownership, save/reopen, and paired React/Vue evidence all pass.
- Replace fixture-specific and kind-switch dispatch with core, binding, layout, and
  output registries keyed by stable capability IDs.
- Promote the shared example editing session into the production `Editor`/`EditorHost`
  composition so installed React and Vue adapters exercise the same engine path as
  conformance tests.

## Capabilities

### New Capabilities

- `ooxml-feature-lane-contract`: Registered cross-package feature contributions,
  support manifest, evidence registry, ownership, and fail-closed rules.
- `comprehensive-wordprocessingml-rendering`: Structural modeling and deterministic
  rendering requirements for the comprehensive fixture's WordprocessingML,
  DrawingML, related stories, and package resources.
- `comprehensive-prosemirror-editing`: Editable and read-only ProseMirror projection,
  semantic transaction mapping, reconciliation, and lossless save/reopen behavior
  for supported fixture features.
- `paired-adapter-feature-conformance`: One production editor composition and shared
  driver-based feature matrix required to behave identically in React and Vue.

### Modified Capabilities

None. This change builds on the active `document-engine` and
`simplified-core-editor-contract` changes; their broad requirements remain the
completion authority until archived into baseline specs.

## Impact

- **Engine core:** capability registry, authored records, preservation capsules,
  semantic operations, serializer ownership, QName/context inventory, and fixture
  evidence.
- **Binding:** composable ProseMirror schema contributions, typed read-only
  projections, step-to-`DocOp` mapping, incremental reconciliation, selection, and
  IME behavior.
- **Layout/output:** feature-owned measurement and display contributions for styles,
  lists, sections, columns, tables, controls, drawings, annotations, fields, and
  related stories.
- **React/Vue:** migration from example-only mounting and contract stubs to one
  production `Editor`/`EditorHost` composition with shared `EditorDriver` tests.
- **Conformance:** generated schema inventory, support reports, fixture-specific
  authored/layout/display/save oracles, and paired browser tests.
- **Security:** no external resource fetching, inert fields and executable content,
  sanitized runtime links, bounded parsing, and lossless preservation of unsupported
  or schema-invalid source XML.
