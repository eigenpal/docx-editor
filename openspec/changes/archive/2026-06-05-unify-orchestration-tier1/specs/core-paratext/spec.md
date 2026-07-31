## ADDED Requirements

### Requirement: Shared ProseMirror paragraph/text helpers

`@docx-editor.dev/core` SHALL expose `findParaIdRange`, `findTextInPmParagraph`, `getVanillaNodeText`, and `getVanillaTextBetween` from a single framework-agnostic module. Both the React and Vue adapters SHALL import these from core rather than maintaining private copies. The helpers MUST satisfy the observable range and text-extraction scenarios below for every supported adapter.

#### Scenario: Resolve a paragraph range by paraId

- **WHEN** `findParaIdRange(doc, paraId)` is called with a paraId present in the document
- **THEN** it returns the `{ from, to }` PM range spanning the matching paragraph node

#### Scenario: Both adapters share one implementation

- **WHEN** the helpers are centralized to core
- **THEN** each supported adapter delegates to the framework-neutral helper module and retains only adapter-specific wiring

#### Scenario: Vanilla text extraction is preserved

- **WHEN** `getVanillaTextBetween(doc, from, to)` is called over a range
- **THEN** the extracted plain text contains the range's textual content in document order and excludes non-textual wrapper metadata
