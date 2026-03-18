# Implementation Tasks: Fix Google Docs Paste (#181)

## Phase 1: Bold Fix (PasteStyleInlinerExtension + BoldExtension)

### Task 1.1: Add Google Docs `<b>` unwrapping to PasteStyleInlinerExtension

**File**: `packages/core/src/prosemirror/extensions/features/PasteStyleInlinerExtension.ts`

**Steps**:

1. Add the `unwrapGoogleDocsStructuralB(doc: Document)` function after `inlineStylesFromStyleBlocks`
2. Modify `transformPastedHTML` to:
   - Add `docs-internal-guid-` detection alongside the existing `<style` check
   - Call `unwrapGoogleDocsStructuralB` when Google Docs paste is detected
   - Process both checks (style inlining AND `<b>` unwrapping) in the same pass when both apply
3. Run typecheck

**Verify**:

```bash
bun run typecheck
```

**Test manually**: Copy content from Google Docs, paste into editor. Body text should NOT be bold. Only explicitly bold text should appear bold.

### Task 1.2: Add `getAttrs` to BoldExtension `<b>` tag rule

**File**: `packages/core/src/prosemirror/extensions/marks/BoldExtension.ts`

**Steps**:

1. Replace `{ tag: 'b' }` with `{ tag: 'b', getAttrs(dom) { ... } }`
2. In `getAttrs`: check `dom.style.fontWeight`; return `false` if `'normal'` or `'400'`
3. Run typecheck

**Verify**:

```bash
bun run typecheck
```

**Test**: This is a belt-and-suspenders fix. After Task 1.1, this shouldn't change behavior, but it provides defense-in-depth.

### Task 1.3: Verify bold fix end-to-end

**Manual test in browser**:

1. Open Google Docs, create a document with:
   - A Heading 1
   - Normal body text with one bold word
   - Some italic text
2. Select all, copy
3. Paste into the editor
4. Verify:
   - Body text is NOT bold
   - The bold word IS bold
   - Heading text renders with heading style (may or may not be bold depending on style definition)

---

## Phase 2: Table Border Fix (TableExtension)

### Task 2.1: Add CSS-to-BorderSpec helper functions

**File**: `packages/core/src/prosemirror/extensions/nodes/TableExtension.ts`

**Steps**:

1. Add import for `ColorValue` and `BorderSpec` from `../../../types/colors`
2. Add `cssBorderKindToOoxml(cssStyle)` function
3. Add `cssBorderWidthToEighths(cssWidth)` function
4. Add `parseCssColorToColorValue(cssColor)` function
5. Add `parseCssColorToHex(cssColor)` function (thin wrapper)
6. Add `mapCssVerticalAlign(cssValue)` function
7. Add `readBorderAttrsFromCSS(style)` function
8. Add `extractCellMarginsFromCSS(style)` function
9. Run typecheck

**Verify**:

```bash
bun run typecheck
```

### Task 2.2: Update `tableCellSpec.parseDOM` to extract CSS borders

**File**: `packages/core/src/prosemirror/extensions/nodes/TableExtension.ts`

**Steps**:

1. In `tableCellSpec.parseDOM[0].getAttrs()`:
   - Get `element.style` reference
   - Call `readBorderAttrsFromCSS(style)` to get borders
   - Call `mapCssVerticalAlign(style.verticalAlign)` as fallback for `verticalAlign`
   - Call `parseCssColorToHex(style.backgroundColor)` as fallback for `backgroundColor`
   - Call `extractCellMarginsFromCSS(style)` to get margins
   - Merge with existing data-attribute values (data-attributes take precedence)
2. Run typecheck

**Verify**:

```bash
bun run typecheck
```

### Task 2.3: Update `tableHeaderSpec.parseDOM` similarly

**File**: `packages/core/src/prosemirror/extensions/nodes/TableExtension.ts`

**Steps**:

1. Apply the same CSS extraction logic to `tableHeaderSpec.parseDOM[0].getAttrs()`
2. Run typecheck

**Verify**:

```bash
bun run typecheck
```

### Task 2.4: Verify table border fix end-to-end

**Manual test in browser**:

1. Open Google Docs, create a document with a 2x2 table (default borders)
2. Select all, copy, paste into editor
3. Verify:
   - Table borders are visible (solid black 1pt)
   - Cell padding is preserved (~5pt)
   - Table cells have vertical-align: top

---

## Phase 3: Testing

### Task 3.1: Add unit test for `unwrapGoogleDocsStructuralB`

**File**: `packages/core/src/prosemirror/extensions/features/PasteStyleInlinerExtension.test.ts` (new file)

**Test cases**:

1. HTML with `<b id="docs-internal-guid-...">` wrapper is unwrapped
2. Regular `<b>` tags (no `docs-internal-guid` id) are NOT unwrapped
3. Multiple structural `<b>` wrappers are all unwrapped
4. Content inside the wrapper (children) is preserved
5. HTML without any `<b>` tags is unchanged

### Task 3.2: Add Playwright E2E test for Google Docs paste

**File**: `e2e/tests/google-docs-paste.spec.ts` (new file)

**Strategy**: Instead of actually copying from Google Docs (which requires auth), simulate the paste event by dispatching a `ClipboardEvent` with `text/html` data that matches the Google Docs format.

**Test fixture**: Create a constant string with representative Google Docs HTML (the structural `<b>` wrapper, spans with font-weight, table with inline borders).

**Test cases**:

1. `paste from Google Docs: body text is not bold` -- Simulate paste of Google Docs HTML, verify body text paragraphs do NOT have bold formatting
2. `paste from Google Docs: explicitly bold text IS bold` -- Verify the span with `font-weight:700` results in bold text in the editor
3. `paste from Google Docs: heading is parsed as heading` -- Verify `<h1>` from Google Docs maps to a heading paragraph
4. `paste from Google Docs: table borders are preserved` -- Verify table cells have visible borders after paste
5. `paste from Google Docs: table cell padding is preserved` -- Verify margins/padding on table cells
6. `paste from Google Docs: regular bold tag still works` -- Paste normal `<b>bold</b>` HTML, verify it IS bold (regression check)

### Task 3.3: Run existing test suite

**Verify no regressions**:

```bash
bun run typecheck && npx playwright test tests/formatting.spec.ts tests/tables.spec.ts tests/text-editing.spec.ts --timeout=30000 --workers=4
```

### Task 3.4: Run full test suite (final validation)

```bash
bun run typecheck && npx playwright test --timeout=60000 --workers=4
```

---

## Phase 4: Cleanup and PR

### Task 4.1: Self-review against DRY/KISS/YAGNI

1. **DRY**: Check that CSS parsing helpers (color, border width) aren't duplicating logic in other files (e.g., `ParagraphExtension.ts` has `cssLengthToTwips` -- consider extracting shared utilities if there's significant overlap)
2. **KISS**: Ensure helper functions are minimal -- don't over-engineer the CSS parsing
3. **YAGNI**: Don't add support for CSS features that Google Docs doesn't actually use (e.g., `border-image`, `outline`)

### Task 4.2: Run formatter

```bash
bun run format
```

### Task 4.3: Create commit

```
fix: Google Docs paste -- strip structural bold, parse table borders (fixes #181)
```

### Task 4.4: Create PR

Title: `fix: Google Docs paste: bold applied to all text, table borders lost (#181)`

Body: Reference the three sub-fixes, include before/after screenshots.

---

## Task Dependency Graph

```
1.1 (PasteStyleInliner) ─┐
                          ├─> 1.3 (Verify bold fix)
1.2 (BoldExtension) ─────┘

2.1 (CSS helpers) ─> 2.2 (td parseDOM) ─> 2.3 (th parseDOM) ─> 2.4 (Verify table fix)

1.3 + 2.4 ─> 3.1 (Unit tests) ─> 3.2 (E2E tests) ─> 3.3 (Regression tests) ─> 3.4 (Full suite)

3.4 ─> 4.1 (Self-review) ─> 4.2 (Format) ─> 4.3 (Commit) ─> 4.4 (PR)
```

Phase 1 and Phase 2 can be done in parallel since they modify different files.
