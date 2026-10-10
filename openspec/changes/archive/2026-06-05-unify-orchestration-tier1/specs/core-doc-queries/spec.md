## ADDED Requirements

### Requirement: Pure document query functions in core

`@docx-editor.dev/core` SHALL expose `findInDocument(view, query, opts?)`, `getSelectionInfo(view)`, and `getPageContent(view, layout, pageNumber)` as pure functions taking the `EditorView` (and `Layout` where needed) as explicit parameters. Both adapters SHALL delegate their corresponding ref methods to these functions.

#### Scenario: Find matches across the document

- **WHEN** `findInDocument(view, query, { caseSensitive, limit })` is called
- **THEN** it returns an ordered, deduplicated match list (`paraId`, `match`, `before`, `after`), honoring `caseSensitive` and `limit`

#### Scenario: Selection info from current selection

- **WHEN** `getSelectionInfo(view)` is called with a non-empty selection
- **THEN** it returns `paraId`, `selectedText`, `paragraphText`, `before`, and `after` according to the documented operation contract, and returns `null` when there is no resolvable paragraph

#### Scenario: Page content lookup

- **WHEN** `getPageContent(view, layout, pageNumber)` is called for a valid page
- **THEN** it returns the page text and per-paragraph entries; an out-of-range page returns `null`
