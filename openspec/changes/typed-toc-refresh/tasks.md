## 1. Model and detection

- [ ] 1.1 TOC instruction parser (`\o`, `\h`, `\n`) with bounds and preserve-unknown
- [ ] 1.2 Cross-paragraph TOC detection (SDT-wrapped + bare)
- [ ] 1.3 Bookmark ensure + entry paragraph builders
- [ ] 1.4 `replaceTocResult` / `rewriteTocPageNumbers` TreeDocOps + lock/bound validation
- [ ] 1.5 Unit tests: detect, generate, bounds, locks

## 2. Pipeline and surface

- [ ] 2.1 Surface `refreshToc` orchestration with layout flush and ≤3 page passes
- [ ] 2.2 Wire `EditorCommands.refreshToc` (+ additive `mode`) and `isInsideToc`
- [ ] 2.3 Undo: two history entries for entire mode
- [ ] 2.4 Tests: pagination shift, page rewrite, undo, persistence
- [x] 2.5 Wire `insert.toc` to an SDT-wrapped generated TOC with command, undo, and adapter tests

## 3. Chrome and docs

- [x] 3.1 Add TOC right-click update menu, shared boundary chrome, and snap navigation
- [ ] 3.2 i18n strings in all locales (no nulls)
- [ ] 3.3 word-features TOC claim + changeset
- [ ] 3.4 OpenSpec validate `--strict`; focused tests + typecheck
