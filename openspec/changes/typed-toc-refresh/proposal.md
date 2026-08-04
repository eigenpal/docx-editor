## Why

Existing Word TOC fields round-trip as inert cached results. `EditorCommands.refreshToc` and `EditorQueries.isInsideToc` are honest stubs (`false` / unsupported). Heading page numbers already exist on the semantic layout (`pageFieldSource`), and the document outline already walks body headings — Tier 2 needs an explicit refresh path that regenerates cached TOC result paragraphs from those sources without a second document model and without live field projection.

## What Changes

**Detection**

- Bound discovery of body TOC complex fields: block-SDT-wrapped cross-paragraph TOC fields and bare cross-paragraph TOC fields.
- Preserve the field skeleton (`begin` / `instrText` / `separate` / `end`) and instruction markup; only the cached result paragraphs between `separate` and `end` are replaced or page-number-rewritten.
- Instruction parse is allowlisted: leading keyword must be `TOC`. Unknown switches are preserved on the instruction text and ignored for generation. Never evaluate DDE, INCLUDE\*, MACROBUTTON, or any non-TOC instruction.

**Two-step refresh pipeline**

- **A — entries:** generate/replace TOC entry paragraphs from `documentOutline`, filtered by `\o` level range (default 1–9). Preserve or create `_Toc…` bookmark targets on headings. Commit through `TreeDocumentStore` / `TreeDocOp` as one history entry; force/await a layout flush.
- **B — page numbers:** derive displayed page numbers from semantic layout (`pageFieldSource`, honouring section `w:pgNumType`), rewrite persisted page-number runs in TOC entries, flush again. Convergence retries are bounded to at most 3 page-number passes.
- Modes: `entire` (A then B) and `pageNumbers` (B only). Public `refreshToc` gains an additive optional `mode`; omitted defaults to `entire`.

**Authoring surface**

- Wire `refreshToc` and `isInsideToc` honestly.
- Wire `insert.toc` to insert an SDT-wrapped, hyperlink-enabled level 1–3 TOC before the caret paragraph and populate it through the same bounded pipeline.
- Engine-owned right-click menu on detected TOC rows with localized “Update entire table” and “Update page numbers”; no duplicate trigger over shared SDT boundary chrome, no focus theft, and never auto-refresh.
- TOC paragraphs are generated read-only navigation rows: clicking snaps to the corresponding outline heading, including cached TOCs without authored hyperlinks, while caret placement and document edits are refused.

**Locks and bounds**

- Store validation refuses refresh when the enclosing content control is content-locked or data-bound (`locked` / `bound`).
- Strict caps: instruction length, entry count, field recursion/nesting, bookmark allocation.

## Capabilities

### New Capabilities

- `toc-refresh-model`: bounded TOC field detection, instruction parse, bookmark ensure, entry generation shapes.
- `toc-refresh-pipeline`: two-step TreeDocOp refresh with layout flush and page-number convergence.
- `toc-refresh-authoring-surface`: command/query wiring and engine furniture chrome.

### Modified Capabilities

None. Deferred “fields” lane remains inert for live TOC projection; this change only refreshes persisted cached results on explicit user/API action.

## Impact

- `packages/core` — detection, ops, surface orchestration, paint chrome.
- `packages/i18n` — TOC update strings (no null fallbacks).
- `docs/site/data/word-features.ts` — TOC feature claim.
- API snapshots / changeset as needed.
- Tests: generation, pagination shift, page rewrite, undo, locks, persistence, security bounds, chrome.
