## 0. Baseline before code

- [ ] 0.1 Load `comprehensive-word-element-test.docx` in the demo and confirm the current loss: 9.1 paints "Visit  or .", 9.2 paints "Jump to:  |  |", zero `<a>` elements inside painted pages
- [ ] 0.2 Record the current `bun test` baseline per the active change's convention
- [ ] 0.3 Run `e2e/hyperlinks.interaction.spec.ts` and record it red — it is this lane's acceptance gate and must only turn green through the tasks below

## 1. Typed nodes and save

- [ ] 1.1 Add `hyperlink` to the node-kind union in `ooxml-tree.ts`; type `@r:id`, `@w:anchor`, `@w:tooltip`, `@w:history`, `@w:docLocation`, `@w:tgtFrame`, with run children in the paragraph inline sequence
- [ ] 1.2 Type `w:bookmarkStart`/`w:bookmarkEnd` as zero-length point anchors; keep `tree-op-split-anchors.test.ts` green unchanged
- [ ] 1.3 Resolve `@r:id` through part relationships; classify `TargetMode="External"`; demote a dangling relationship to plain runs without losing text
- [ ] 1.4 Non-run hyperlink children (drawing, field, SDT) stay `generic` at their positions under the typed hyperlink
- [ ] 1.5 Compute `sanitizedHref` once at tree construction via `sanitizeHref`; keep the authored raw target for save through `escapeXml`
- [ ] 1.6 Canonical-fingerprint equality for all five fixture hyperlinks and all 22 bookmarks loaded and saved unedited
- [ ] 1.7 Unit test: `javascript:` target loads inert, saves byte-identical under escaping; no network request for any target at load or save

## 2. Layout and paint

- [ ] 2.1 `tokensOfParagraph` flattens hyperlink runs into the inline token stream (delete the `unknownLabel` placeholder path for `hyperlink`)
- [ ] 2.2 Resolve the `Hyperlink` character style through the run-style cascade (themed `hlink` color, underline), direct formatting winning
- [ ] 2.3 Paint per-line `a.docx-hyperlink` wrappers: external `href` = sanitized projection + `title` from tooltip; internal `href="#<anchor>"`; inert links get no `href`; run spans keep `data-paragraph-id`/`data-start`/`data-end`
- [ ] 2.4 Bookmarks measure zero and paint nothing; heading metrics unchanged
- [ ] 2.5 Selection and hit-testing across link runs resolve through run spans exactly as plain text (layout test + interaction check)
- [ ] 2.6 Header/footer furniture links paint styled but inert (`tabindex="-1"`, no `href`)
- [ ] 2.7 Layout tests: 9.1/9.2 full text present; link runs wrap across lines by normal break rules

## 3. Navigation

- [ ] 3.1 Prevent native anchor navigation for every anchor inside painted pages
- [ ] 3.2 Click classification: collapsed-selection click on external → popover; internal → jump; range-selection end → nothing
- [ ] 3.3 Bookmark index `name → { paragraphId, offset }` maintained from typed anchors; duplicates resolve to first in document order
- [ ] 3.4 Internal jump: resolve target through layout geometry, scroll the container to the target page/y (virtualized targets included), place the engine caret at the target position; dangling anchor is inert
- [ ] 3.5 Single external-activation call site: `window.open(sanitizedHref, '_blank', 'noopener,noreferrer')` from popover open and Ctrl/Cmd+Click only
- [ ] 3.6 Interaction tests for both jump directions and the no-popover-on-internal rule

## 4. Editor operations

- [ ] 4.1 `TreeDocOp`: insertHyperlink (adds relationship + node in one transaction), set-target, unlink (splice children in place, formatting and anchors preserved); each one `transact` = one undo step
- [ ] 4.2 Implement `hyperlinkAt` in `docx-editor.ts` returning `HyperlinkInfo` per the existing contract; remove it from the typed-empty list
- [ ] 4.3 Store tests: unlink keeps text/formatting; edit target does not leave a dangling authored relationship; undo restores in one step

## 5. React adapter — DocxEditor.HyperLink

- [ ] 5.1 `useHyperlinkPopup()` context hook: `{ state, open, close, copy, beginEdit, commitEdit, unlink }`, backed by click classification (3.2) and the ops (4.1)
- [ ] 5.2 `DocxEditorHyperLink.tsx` compound: `Root/Url/Copy/Edit/Unlink` parts on the toolbar customization ladder (`className`/`data-*`, `icon`, `asChild`, in-place override, `hidden`, `preset={false}`); static on `DocxEditor`; preset rendered by sugar, `hyperlinkPopup={false}` removes, child replaces
- [ ] 5.3 Mount inside the viewport (follows page on scroll); position under the link fragment, clamped horizontally; dismiss on Escape/outside mousedown/selection move; chrome mousedown `preventDefault()` except text inputs
- [ ] 5.4 Read-only renders URL + copy only; edit mode's inputs focus and type correctly
- [ ] 5.5 Stable testids (`hyperlink-popup`, `-copy`, `-edit`, `-unlink`); i18n keys for every string (localized copy confirmation); `--doc-*` tokens only; z-index from the stylesheet
- [ ] 5.6 Wire `text.link` in `SLOT_COMMANDS` + Ctrl/Cmd+K: plain text → insert flow, caret in link → edit mode seeded by `hyperlinkAt`
- [ ] 5.7 `bun run api:extract` and commit snapshots; parity contract untouched (Vue deferred with reason)

## 6. Acceptance

- [ ] 6.1 `e2e/hyperlinks.interaction.spec.ts` green: rendering, popover actions/dismissal, both jump directions
- [ ] 6.2 D9 oracles green on the comprehensive fixture; `bun test` matches or improves baseline
- [ ] 6.3 Security audit grep from CLAUDE.md on the diff; verify the single `window.open` call site and no new sinks
- [ ] 6.4 Update `docs/site/data/word-features.ts` hyperlink rows and the relevant docs page in the same PR
