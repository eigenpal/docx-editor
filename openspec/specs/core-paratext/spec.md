# core-paratext Specification

## Purpose

TBD - created by archiving change unify-orchestration-tier1. Update Purpose after archive.

## Requirements

### Requirement: Shared ProseMirror paragraph/text helpers

`@eigenpal/docx-editor-core` SHALL expose `findParaIdRange`, `findTextInPmParagraph`, `getVanillaNodeText`, and `getVanillaTextBetween` from a single framework-agnostic module. Both the React and Vue adapters SHALL import these from core rather than maintaining private copies. The lifted behavior MUST be identical to the pre-lift adapter implementations.

#### Scenario: Resolve a paragraph range by paraId

- **WHEN** `findParaIdRange(doc, paraId)` is called with a paraId present in the document
- **THEN** it returns the same `{ from, to }` PM range the previous adapter-local copy returned

#### Scenario: Both adapters share one implementation

- **WHEN** the helpers are lifted to core
- **THEN** React's `internals/pmAnchors.ts` and `internals/vanillaText.ts` and Vue's `utils/paraTextHelpers.ts` re-export from core, and no adapter retains a second copy of the logic

#### Scenario: Vanilla text extraction is preserved

- **WHEN** `getVanillaTextBetween(doc, from, to)` is called over a range
- **THEN** the extracted plain text matches the prior per-adapter output for the same range
