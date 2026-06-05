# core-doc-queries Specification

## Purpose

TBD - created by archiving change unify-orchestration-tier1. Update Purpose after archive.

## Requirements

### Requirement: Pure document query functions in core

`@eigenpal/docx-editor-core` SHALL expose `findInDocument(view, query, opts?)`, `getSelectionInfo(view)`, and `getPageContent(view, layout, pageNumber)` as pure functions taking the `EditorView` (and `Layout` where needed) as explicit parameters. Both adapters SHALL delegate their corresponding ref methods to these functions.

#### Scenario: Find matches across the document

- **WHEN** `findInDocument(view, query, { caseSensitive, limit })` is called
- **THEN** it returns the same ordered, deduplicated match list (`paraId`, `match`, `before`, `after`) the adapters returned before the lift, honoring `caseSensitive` and `limit`

#### Scenario: Selection info from current selection

- **WHEN** `getSelectionInfo(view)` is called with a non-empty selection
- **THEN** it returns `paraId`, `selectedText`, `paragraphText`, `before`, and `after` matching prior behavior, and returns `null` when there is no resolvable paragraph

#### Scenario: Page content lookup

- **WHEN** `getPageContent(view, layout, pageNumber)` is called for a valid page
- **THEN** it returns the page text and per-paragraph entries; an out-of-range page returns `null`
