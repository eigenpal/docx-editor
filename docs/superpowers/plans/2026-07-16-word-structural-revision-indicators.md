# Word-style Structural Revision Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Word-style green/red page-margin change bars and structural glyphs for revision-bearing paragraphs, tables, rows, cells, and images across React and Vue.

**Architecture:** Add a framework-neutral revision-bar collector to the core painter. Body/header/footer renderers register changed vertical spans in container coordinates, and the collector emits one fixed-X overlay after merging spans from the same revision. Existing semantic revision classes remain responsible for local cues such as paragraph marks, image outlines, and cell tinting; all visible styles and colors move to the shared core editor stylesheet.

**Tech Stack:** TypeScript, DOM painter model, Bun tests, Playwright, shared core CSS.

## Global Constraints

- Visible indicators must not affect measurement, pagination, selection mapping, table clipping, or image geometry.
- Green represents insertion; red represents deletion.
- Paragraph `¶` appears only on the final fragment and is struck through for deletion.
- Every page-margin bar uses one fixed X coordinate independent of block or image indentation.
- React and Vue consume the same painter logic and shared stylesheet.
- Treat DOCX-derived revision metadata as untrusted text; assign it only through datasets/text properties, never HTML strings.

---

## File structure

- Create `packages/core/src/painter-model/revisionIndicators.ts`: revision metadata application, span collection, merging, and overlay painting.
- Create `packages/core/src/painter-model/revisionIndicators.test.ts`: unit coverage for merge behavior, fixed positioning, classes, and metadata.
- Modify `packages/core/src/painter-model/paintPage.ts`: own the body collector, register body fragments/floating images, and append its overlay.
- Modify `packages/core/src/painter-model/paintPage/headerFooter.ts`: own header/footer collectors and preserve revision metadata for floating images.
- Modify `packages/core/src/painter-model/floatingImageLayer.ts`: carry/apply image revision metadata and register floating-image spans.
- Modify `packages/core/src/painter-model/renderImage.ts`: apply shared image revision attributes to block-level images.
- Modify `packages/core/src/painter-model/renderParagraph/runs.ts`: replace hard-coded image revision styles with shared classes/metadata.
- Modify `packages/core/src/painter-model/renderParagraph.ts`: retain paragraph mark classes/glyphs while delegating visible bars to the collector.
- Modify `packages/core/src/painter-model/renderTable.ts`: register whole-table and row spans without duplicate bars.
- Modify `packages/core/src/painter-model/index.ts`: export the new framework-neutral helpers.
- Modify `packages/core/src/styles/editor.css`: add shared revision tokens and visible painter styles.
- Modify `packages/core/src/prosemirror/editor.css`: retain hidden-PM rules and remove visible painter duplicates.
- Modify `e2e/tests/tracked-changes-structural.spec.ts`: paragraph/table visual assertions.
- Modify `e2e/tests/tracked-image.spec.ts`: inline/floating image visual and geometry assertions.
- Add `.changeset/<generated-name>.md`: patch release note for `@docx-editor.dev/core`.

### Task 1: Revision indicator primitives and shared styles

**Files:**

- Create: `packages/core/src/painter-model/revisionIndicators.ts`
- Create: `packages/core/src/painter-model/revisionIndicators.test.ts`
- Modify: `packages/core/src/painter-model/index.ts`
- Modify: `packages/core/src/styles/editor.css`
- Modify: `packages/core/src/prosemirror/editor.css`

**Interfaces:**

- Produces: `RevisionIndicatorKind`, `RevisionMetadata`, `RevisionBarSpan`, `RevisionBarCollector`, and `applyRevisionMetadata`.
- `RevisionBarCollector.register(span)` accepts coordinates relative to one content container.
- `RevisionBarCollector.paint(document)` returns a non-interactive overlay or `null`.

- [ ] **Step 1: Write failing collector tests**

Add tests covering:

```ts
const collector = new RevisionBarCollector();
collector.register({ top: 10, height: 20, kind: 'ins', revisionId: 7 });
collector.register({ top: 30, height: 10, kind: 'ins', revisionId: 7 });
collector.register({ top: 50, height: 5, kind: 'del', revisionId: 8 });

expect(collector.getMergedSpans()).toEqual([
  { top: 10, height: 30, kind: 'ins', revisionId: 7 },
  { top: 50, height: 5, kind: 'del', revisionId: 8 },
]);
```

Also assert that different kinds/revision IDs do not merge, zero-height spans are ignored, and painted bars all use the same left coordinate/class contract.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test packages/core/src/painter-model/revisionIndicators.test.ts
```

Expected: FAIL because `RevisionBarCollector` does not exist.

- [ ] **Step 3: Implement the collector and metadata helper**

Implement the public shape:

```ts
export type RevisionIndicatorKind = 'ins' | 'del';

export interface RevisionMetadata {
  revisionId?: number;
  author?: string;
  date?: string | null;
}

export interface RevisionBarSpan extends RevisionMetadata {
  top: number;
  height: number;
  kind: RevisionIndicatorKind;
}

export class RevisionBarCollector {
  register(span: RevisionBarSpan): void;
  getMergedSpans(): RevisionBarSpan[];
  paint(doc: Document): HTMLElement | null;
}

export function applyRevisionMetadata(
  element: HTMLElement,
  scopeClass: string,
  kind: RevisionIndicatorKind,
  metadata: RevisionMetadata
): void;
```

Merge only touching/overlapping spans with equal `kind` and `revisionId`. Paint `.layout-revision-bars` containing `.layout-revision-change-bar.layout-revision-{kind}` children at `left: -10px`, using `top`/`height` from merged spans and `pointer-events: none`.

- [ ] **Step 4: Move visible revision styles into shared core CSS**

Define tokens under `.ep-root`:

```css
--doc-revision-insertion: #2e7d32;
--doc-revision-deletion: #c62828;
--doc-revision-insertion-tint: rgba(46, 125, 50, 0.05);
--doc-revision-deletion-tint: rgba(198, 40, 40, 0.05);
```

Style overlay bars, paragraph glyphs, table/cell cues, and image outlines in `packages/core/src/styles/editor.css`. Remove visible `.layout-*` revision rules from `prosemirror/editor.css`; retain only `.ep-revision-*` rules needed by hidden ProseMirror.

- [ ] **Step 5: Run primitive tests and CSS parity gates**

Run:

```bash
bun test packages/core/src/painter-model/revisionIndicators.test.ts
bun run check:adapter-css-thin
```

Expected: PASS.

### Task 2: Paragraph and table page-margin bars

**Files:**

- Modify: `packages/core/src/painter-model/paintPage.ts`
- Modify: `packages/core/src/painter-model/paintPage/headerFooter.ts`
- Modify: `packages/core/src/painter-model/renderParagraph.ts`
- Modify: `packages/core/src/painter-model/renderTable.ts`
- Modify: `e2e/tests/tracked-changes-structural.spec.ts`

**Interfaces:**

- Consumes: `RevisionBarCollector.register`.
- Produces: body/header/footer overlays for paragraph, whole-table, and row structural revisions.

- [ ] **Step 1: Extend browser tests with failing visual assertions**

For inserted paragraph boundaries, assert:

```ts
await expect(insMark.locator('.layout-revision-pmark-glyph')).toHaveCSS(
  'color',
  'rgb(46, 125, 50)'
);
const insertionBars = page.locator(
  '.layout-page-content > .layout-revision-bars .layout-revision-change-bar.layout-revision-ins'
);
await expect(insertionBars).not.toHaveCount(0);
```

Create/reuse a deleted paragraph boundary and assert red glyph color plus `line-through`. For the existing single-row whole-table revision, assert a green overlay bar whose top/bottom match the painted table within one CSS pixel. Add a two-row partial revision case and assert row-height alignment without a duplicate whole-table bar.

- [ ] **Step 2: Run focused E2E to verify RED**

Run:

```bash
npx playwright test e2e/tests/tracked-changes-structural.spec.ts --grep "Painted paragraph|trIns|change bar" --timeout=30000 --workers=1
```

Expected: FAIL because React has no visible revision CSS/overlay.

- [ ] **Step 3: Register body paragraph and table spans**

Create one `RevisionBarCollector` per body page in `paintPage`. Register paragraph fragment bounds from `fragment.y - page.margins.top` and `fragment.height` when the source `ParagraphBlock` has `pPrIns` or `pPrDel`.

For table fragments, register:

- one visible fragment span when every row belongs to the same insertion/deletion burst;
- one span per changed visible row otherwise, intersected with fragment clipping;
- no cell-only page-margin span when the row/table itself is unchanged.

Append `collector.paint(doc)` as the final child of `.layout-page-content`.

- [ ] **Step 4: Register header/footer structural spans**

Use each header/footer renderer's synthetic fragment `y`/`height` and table row metrics to populate a collector owned by that container. Append the overlay after content so bars align to the container edge and remain above behind-text content.

- [ ] **Step 5: Remove paragraph/table object-relative pseudo bars**

Keep paragraph revision classes, datasets, and `¶` glyph generation in `renderParagraph.ts`. Keep table/row/cell classes for local cues and sidebar anchoring. Ensure only `.layout-revision-change-bar` paints the page-margin indicator.

- [ ] **Step 6: Run structural tests**

Run:

```bash
npx playwright test e2e/tests/tracked-changes-structural.spec.ts --timeout=30000 --workers=1
```

Expected: all structural tracked-change tests PASS.

### Task 3: Inline, block, and floating image indicators

**Files:**

- Modify: `packages/core/src/pagination-model/types.ts`
- Modify: `packages/core/src/painter-model/paintPage/pageFloatingImage.ts`
- Modify: `packages/core/src/painter-model/floatingImageLayer.ts`
- Modify: `packages/core/src/painter-model/paintPage.ts`
- Modify: `packages/core/src/painter-model/paintPage/headerFooter.ts`
- Modify: `packages/core/src/painter-model/renderImage.ts`
- Modify: `packages/core/src/painter-model/renderParagraph/runs.ts`
- Modify: `e2e/tests/tracked-image.spec.ts`

**Interfaces:**

- Extends `FloatingImagePaintRecord`/`PageFloatingImage` with `isInsertion`, `isDeletion`, `changeAuthor`, `changeDate`, and `changeRevisionId`.
- Consumes: `applyRevisionMetadata` and `RevisionBarCollector.register`.

- [ ] **Step 1: Add failing floating-image visual tests**

Extend the tracked-image E2E helpers to insert an anchored/floating image in suggestion mode. Assert:

```ts
const image = page.locator('.layout-page-floating-image.docx-insertion[data-revision-id] img');
await expect(image).toHaveCSS('outline-color', 'rgb(46, 125, 50)');
```

Assert the corresponding page-margin bar shares the paragraph/table bar X coordinate and spans the image's visible top/bottom within one CSS pixel. Repeat deletion in red and assert image width/height are unchanged before/after applying the revision cue.

- [ ] **Step 2: Run tracked image tests to verify RED**

Run:

```bash
npx playwright test e2e/tests/tracked-image.spec.ts --timeout=30000 --workers=1
```

Expected: existing inline tests pass; new floating-image assertions fail because floating records drop revision metadata.

- [ ] **Step 3: Preserve image revision metadata through every paint path**

Copy these fields from `ImageRun` when extracting page and header/footer floating images:

```ts
isInsertion: imgRun.isInsertion,
isDeletion: imgRun.isDeletion,
changeAuthor: imgRun.changeAuthor,
changeDate: imgRun.changeDate,
changeRevisionId: imgRun.changeRevisionId,
```

Add the same optional fields to `FloatingImagePaintRecord` and related page/header/footer record types. For block image nodes, map equivalent node attrs into `ImageBlock` when present.

- [ ] **Step 4: Apply shared image cues and register bars**

Replace inline hard-coded outlines with semantic revision classes and `applyRevisionMetadata`. Apply the same classes/datasets to floating/block image containers and images. Register their visible `y`/`height` with the containing collector; keep outlines CSS-only so box dimensions do not change.

- [ ] **Step 5: Run image and structural tests**

Run:

```bash
npx playwright test e2e/tests/tracked-image.spec.ts e2e/tests/tracked-changes-structural.spec.ts --timeout=30000 --workers=1
```

Expected: PASS.

### Task 4: Supplied-document verification and release hygiene

**Files:**

- Modify: focused tests only if browser verification exposes a missed structural path.
- Create: `.changeset/<generated-name>.md`

**Interfaces:**

- No new runtime interfaces.

- [ ] **Step 1: Load the supplied DOCX in the browser**

Use the local React demo and confirm:

- green inserted paragraph bars and green `¶`;
- red deleted paragraph bars and struck-through red `¶`;
- bars remain at one X coordinate regardless of list indentation;
- table/image indicators align to the same page-margin lane;
- no pagination or geometry change.

- [ ] **Step 2: Verify Vue parity**

Load the same document in the Vue demo and compare revision bar count, kind, X coordinate, and glyph colors against React.

- [ ] **Step 3: Add a patch changeset**

```md
---
'@docx-editor.dev/core': patch
---

Render Word-style page-margin indicators for tracked structural changes across paragraphs, tables, and images.
```

- [ ] **Step 4: Run final verification**

Run:

```bash
bun run format
bun run typecheck
bun run check:adapter-css-thin
bun test packages/core/src/painter-model/revisionIndicators.test.ts
npx playwright test e2e/tests/tracked-changes-structural.spec.ts e2e/tests/tracked-image.spec.ts --timeout=30000 --workers=4
```

Expected: all commands exit 0 with no failures.
