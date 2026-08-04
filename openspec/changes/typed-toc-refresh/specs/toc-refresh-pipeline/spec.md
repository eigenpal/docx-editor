## ADDED Requirements

### Requirement: Explicit two-step refresh

`refreshToc` SHALL run an explicit two-step pipeline for entire-table mode and page-numbers-only mode without live TOC field projection.

#### Scenario: Entire table updates entries then pages

- **WHEN** `refreshToc` runs with mode `entire` (or omitted)
- **THEN** the engine commits `replaceTocResult`, awaits a layout flush, then commits `rewriteTocPageNumbers` derived from semantic layout page numbering, flushing again

#### Scenario: Page numbers only skips entry generation

- **WHEN** `refreshToc` runs with mode `pageNumbers`
- **THEN** the engine does not replace entry paragraphs and only rewrites page-number runs after a layout flush

#### Scenario: Convergence is bounded

- **WHEN** rewriting page numbers shifts pagination
- **THEN** the engine retries page-number rewrite at most 3 times total and stops when numbers are stable or the bound is reached

#### Scenario: Two undo units for entire refresh

- **WHEN** entire-table refresh commits both phases
- **THEN** undo restores page numbers first, then a second undo restores the prior TOC entries

### Requirement: Store-enforced locks

TOC refresh ops SHALL refuse locked or data-bound content controls at validation.

#### Scenario: Content-locked TOC refuses refresh

- **WHEN** the TOC result region is inside a content control with effective content lock or data binding
- **THEN** the op is rejected with `locked` or `bound` and the tree is unchanged
