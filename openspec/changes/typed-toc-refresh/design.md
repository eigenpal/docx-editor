## Context

Body TOC fields are multi-paragraph complex fields. Word wraps many in a block SDT (`docPartObj` / untyped gallery). The engine already:

- types `fldChar` / `instrText` and walks per-paragraph atomic fields;
- flattens block SDTs in layout;
- derives `documentOutline` from heading styles;
- projects PAGE numbers in furniture via `pageFieldSource` on each page.

TOC refresh must stay inside the one pipeline: tree → layout → paint. No DOM geometry, no second IR, no live TOC field evaluation.

## Decisions

### D1 — Detect across paragraphs, not via `atomicFieldSpansOf`

`atomicFieldSpansOf` is per-paragraph and demotes cross-paragraph fields. Detection walks body (and block-SDT content) in document order, matching `begin` → TOC instruction → `separate` → result blocks → `end`, with nesting/instruction bounds. Each discovered TOC has a stable id (begin `fldChar` node id, or enclosing content-control id when present and unique).

### D2 — Persist cached results; never execute instructions

Refresh rewrites OOXML result paragraphs only. Instruction text is parsed for `\o` / `\h` / `\n` and otherwise left intact. `isEvaluableField` listing TOC does not authorize arbitrary evaluation — only this allowlisted refresh path may materialize TOC results.

### D3 — Two TreeDocOps, two history entries

- `insertToc` — SDT-wrapped field, initial cached entries, and heading bookmarks (insertion phase A).
- `replaceTocResult` — bookmarks + entry paragraphs (phase A).
- `rewriteTocPageNumbers` — page-number run text only (phase B).

Surface orchestration flushes layout between phases. Page-number convergence retries ≤ 3 `rewriteTocPageNumbers` applications. Undo: first undo reverts the latest page rewrite; next undo reverts entry generation or the complete inserted TOC and its bookmarks.

### D4 — Page numbers from layout, not DOM

Displayed page for a heading = `page.pageFieldSource.pageNumber` of the page holding that paragraph’s first fragment (`fragmentsOfParagraph`), formatted with the page’s `format` when present. Missing layout → refuse or keep prior digits (fail closed per op).

### D5 — Shared boundary chrome and contextual actions

TOCs reuse the shared content-control boundary chrome when SDT-wrapped, with the same boundary fallback for bare fields. Update actions live in an engine-owned right-click menu on TOC rows rather than a duplicate painted trigger. The native context menu is suppressed only for detected TOCs; no action auto-runs. Primary row clicks use layout-based, immediate heading navigation.

### D6 — Locks at validation

`replaceTocResult` / `rewriteTocPageNumbers` refuse with `locked` / `bound` when any ancestor content control of the TOC result region enforces content lock or data binding — same axes as other content edits.

## Bounds

| Cap                             | Value                            |
| ------------------------------- | -------------------------------- |
| Instruction chars               | 256                              |
| Field nesting during detect     | 4                                |
| TOC entries generated           | 512                              |
| Bookmarks allocated per refresh | 512                              |
| Page-number convergence passes  | 3                                |
| Outline text / bookmark name    | existing outline + bookmark caps |

## Out of scope

- Live TOC projection during layout
- `\t` custom style maps, `\b` bookmark scope, `\u` paragraph outlineLvl, TC fields
- Vue chrome twin
