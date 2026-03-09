## 1. Change Default Constant

- [x] 1.1 Change `DEFAULT_LINE_HEIGHT_MULTIPLIER` from 1.15 to 1.0 in `packages/core/src/layout-bridge/measuring/measureParagraph.ts`
- [x] 1.2 Change `DEFAULT_LINE_HEIGHT_MULTIPLIER` from 1.15 to 1.0 in `packages/core/src/layout-bridge/measuring/measureContainer.ts`

## 2. Align Visible Rendering

- [x] 2.1 Update default line height fallback in `packages/core/src/layout-painter/renderParagraph.ts` to use 1.0× (N/A — uses line.lineHeight from measurement directly)
- [x] 2.2 Update default line height in `packages/core/src/prosemirror/extensions/core/ParagraphExtension.ts` toDOM for PM hidden view consistency (N/A — no lineHeight in toDOM)

## 3. Update formatToStyle

- [x] 3.1 Update default line height in `packages/core/src/utils/formatToStyle.ts` if it has a 1.15 fallback (N/A — only sets line-height when lineSpacing is explicitly defined)

## 4. Testing

- [x] 4.1 Run `bun run typecheck` to ensure no type errors
- [x] 4.2 Run targeted Playwright tests to identify failing expectations (`npx playwright test tests/line-spacing.spec.ts tests/formatting.spec.ts --timeout=30000 --workers=4`)
- [x] 4.3 Update any test line height expectations from 1.15× to 1.0× values (no failures to fix)
- [x] 4.4 Visually verify the test DOCX renders correctly (table fits on page 1) using Chrome

## 5. Regression Check

- [x] 5.1 Test a Word-created DOCX with explicit `w:line="276"` to confirm 1.15× still works
- [x] 5.2 Run broader test suite (`npx playwright test --timeout=30000 --workers=4`) to catch regressions (77 passed, 0 failures across 5 test files)
