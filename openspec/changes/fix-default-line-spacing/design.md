## Context

The layout engine calculates line heights for paragraphs using a fallback multiplier when no explicit `w:line` spacing is specified. Currently, `DEFAULT_LINE_HEIGHT_MULTIPLIER = 1.15` (matching Word 2007+ new document defaults). However, the OOXML spec §17.3.1.33 defines the default as `line=240, lineRule=auto` — which is 1.0× (single spacing).

The 1.15 multiplier is Word's _convention for new documents_ (Normal style has `line=276`), not the spec default. Documents created by other tools that omit `w:line` entirely should render with single spacing.

**Current code path when `w:line` is absent:**

1. Parser finds no `w:line` → `lineSpacing` stays `null`
2. `toFlowBlocks.ts` skips spacing.line when `pmAttrs.lineSpacing == null`
3. `measureParagraph.ts` hits the else fallback → uses `singleLineBase × 1.15`
4. Every line is 15% taller than correct → ~60-80px extra per page

**When `w:line=276` IS present (most Word-created docs):**

1. Parser extracts `lineSpacing=276`
2. `toFlowBlocks.ts` converts to `spacing.line = 276/240 = 1.15, lineUnit = 'multiplier'`
3. `measureParagraph.ts` uses multiplier branch → `singleLineBase × 1.15`
4. Result is identical — these documents are unaffected by the fix

## Goals / Non-Goals

**Goals:**

- Correct the default line spacing to match OOXML spec (1.0× when unspecified)
- Ensure documents with explicit `w:line=276` continue to render at 1.15×
- Align all rendering paths (layout engine, layout-painter, PM hidden view)

**Non-Goals:**

- Fixing the paragraph spacing collapsing bug (`Math.max` vs additive) — separate change
- Changing `singleLineRatio` values — these are correct per OS/2 font tables
- Font substitution changes — Arimo/Carlito are metrically compatible

## Decisions

### 1. Change `DEFAULT_LINE_HEIGHT_MULTIPLIER` from 1.15 to 1.0

**Rationale:** The OOXML spec default for omitted `w:line` is 240 (single spacing = 1.0×). Documents that want 1.15 explicitly set `w:line=276`, which flows through the multiplier code path. The fallback only triggers when nothing is specified.

**Alternative considered:** Adding a heuristic to detect "Word-like" documents and apply 1.15. Rejected — too fragile, and properly-authored DOCX files always specify their line spacing in styles.

### 2. Update all rendering paths consistently

The `DEFAULT_LINE_HEIGHT_MULTIPLIER` constant is used in:

- `measureParagraph.ts` (layout engine — line breaking + height calculation)
- `measureContainer.ts` (font metrics — lineHeight field)
- `renderParagraph.ts` (visible page rendering)
- `formatToStyle.ts` / `ParagraphExtension.ts` (PM hidden view CSS)

All must use 1.0 for consistency between measurement and rendering.

### 3. Keep the constant name and location

Renaming `DEFAULT_LINE_HEIGHT_MULTIPLIER` to `OOXML_DEFAULT_LINE_SPACING_MULTIPLIER` would be more precise, but the current name is used across many files. Keep the existing name to minimize diff noise.

## Risks / Trade-offs

- **[Risk] Documents relying on implicit 1.15 spacing** → Mitigated: Any Word-created document has `line=276` in its Normal style, which goes through the explicit multiplier path. Only documents that truly omit line spacing (rare, non-Word tools) are affected — and for those, 1.0 is correct.
- **[Risk] Existing test expectations** → Mitigated: Tests using the default 1.15 may need updated height expectations. Run full test suite to identify.
- **[Risk] Visual regression for users** → Mitigated: The change makes rendering _more correct_ per spec. Documents that were rendering too tall will now render at the correct height.
