# HarfBuzz Text Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use subagent-driven development and
> execute each task test-first. Do not mark task 8.1 complete until every bake-off
> gate in `technology-selection.md` is evidenced.

**Goal:** Resolve authored DOCX fonts and sizes, shape text from explicit font bytes
with HarfBuzz, and make layout, caret/hit-testing, React/Vue paint, and output consume
one fixed-point shaped result without Helvetica or browser geometry constants.

**Architecture:** `engine-core` remains the canonical authored layer and resolves
OOXML formatting without materializing it into authored records. A bounded
`FontResourcePort` supplies immutable font bytes and declared substitutions.
`engine-layout` shapes style-homogeneous spans with HarfBuzz and publishes glyph,
cluster, caret-edge, font-identity, and vertical-metric data in its positioned IR.
Adapters install those exact bytes through `FontFace` and only paint the IR.

**Tech stack:** `harfbuzzjs` 1.x, `fontkit` 2.x, fixed-point integer geometry,
`Intl.Segmenter` only behind the existing explicit segmentation boundary.

## Global constraints

- No canvas, CSS font-stack, DOM `Range`, or browser hit-test result may be a layout
  or caret geometry authority.
- No hardcoded Helvetica family, width table, scalar bold adjustment, font size, or
  black color may remain in production display bridging.
- Font inputs are explicit bytes. Missing fonts use a declared substitution or a
  typed failure; external DOCX relationships are never fetched automatically.
- HarfBuzz shapes complete style-homogeneous spans, not one character at a time.
- Layout, caret edges, hit testing, DOM, print, and later PDF consume the same shaped
  clusters and fixed-point rounding.
- Browser, worker, and server produce exact glyph IDs, clusters, advances, and line
  breaks for equal model/font/configuration inputs.
- Authored omission remains omission; save/reopen preservation stays byte-faithful.
- React and Vue integrations land together.

## Task 1: Remove the competing DOM geometry authority

**Files:**
- Modify: `packages/react/src/components/DocxEditor.tsx`
- Modify: `packages/vue/src/DocxEditor.ts`
- Modify: `packages/engine-editor/src/create-editor.ts`
- Modify: `packages/engine-editor/test/rendered-text-geometry.test.ts`
- Test: `packages/engine-editor/test/interaction-planner-drag.test.ts`

**Pass gate:** pointer planning and overlays use only the published interaction frame.
The DOM realization port is not wired into either adapter or editor dispatch. Existing
engine-geometry interaction suites pass.

## Task 2: Model and parse authored font inputs

**Files:**
- Modify: `packages/engine-core/src/model/authored-model.ts`
- Modify: `packages/engine-core/src/package/wml-parse.ts`
- Modify: `packages/engine-core/src/package/wml-parts.ts`
- Modify: `packages/engine-core/src/resolve/style-resolver.ts`
- Test: `packages/engine-core/test/styles-numbering.test.ts`
- Test: `packages/engine-core/test/style-resolver.test.ts`
- Test: `packages/engine-core/test/docx-roundtrip.test.ts`

**Interfaces:**

```ts
interface RunFonts {
  ascii?: string;
  hAnsi?: string;
  eastAsia?: string;
  cs?: string;
  asciiTheme?: string;
  hAnsiTheme?: string;
  eastAsiaTheme?: string;
  csTheme?: string;
}

interface RunProps {
  fonts?: RunFonts;
  sizeHalfPoints?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

interface ThemeFonts {
  majorLatin?: string;
  minorLatin?: string;
  majorEastAsia?: string;
  minorEastAsia?: string;
  majorComplexScript?: string;
  minorComplexScript?: string;
}
```

**Pass gate:** direct formatting, `docDefaults`, paragraph/character style
inheritance, and theme font references resolve deterministically. Explicit false and
authored omission remain distinct. Saving and reopening leaves untouched source bytes
identical.

## Task 3: Freeze font-resource and shaping contracts

**Files:**
- Create: `packages/engine-layout/src/font-resource.ts`
- Create: `packages/engine-layout/src/shaped-run.ts`
- Modify: `packages/engine-layout/src/index.ts`
- Modify: `packages/engine-layout/src/resolved-cache.ts`
- Test: `packages/engine-layout/test/font-resource.test.ts`

**Interfaces:**

```ts
interface FontRequest {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
}

interface ResolvedFont {
  id: string;
  family: string;
  bytes: Uint8Array;
  hash: string;
  faceIndex: number;
}

interface FontResourceSnapshot {
  epoch: number;
  resolve(request: FontRequest): ResolvedFont | FontResolutionError;
}

interface TextShaper {
  shape(input: ShapeInput): ShapedRun;
}
```

**Pass gate:** byte/hash identity, substitution provenance, size limits, malformed
font rejection, and resource epoch invalidation are tested without network access.

## Task 4: Bake off and implement HarfBuzz shaping

**Files:**
- Modify: `packages/engine-layout/package.json`
- Create: `packages/engine-layout/src/harfbuzz-shaper.ts`
- Create: `packages/engine-layout/test/harfbuzz-shaper.test.ts`
- Add: a redistributable TTF fixture plus its license under
  `packages/engine-layout/test/fixtures/fonts/`
- Modify: `openspec/changes/document-engine/technology-selection.md`

**Pass gate:** regular and bold faces produce their actual distinct glyph IDs and
advances; kerning, ligatures, combining marks, RTL, malformed fonts, fixed-point
rounding, and browser/worker/server loading are evidenced. Repeated shaping is exact.
`fontkit` is retained only for the capabilities its bake-off proves.

## Task 5: Replace character metrics with shaped-span layout

**Files:**
- Modify: `packages/engine-layout/src/metrics.ts`
- Modify: `packages/engine-layout/src/paragraph-layout.ts`
- Modify: `packages/engine-layout/src/display-item.ts`
- Modify: `packages/engine-layout/src/layout.ts`
- Modify: `packages/engine-layout/src/horizontal-boundary.ts`
- Test: `packages/engine-layout/test/layout.test.ts`
- Test: `packages/engine-layout/test/paragraph-run-split.test.ts`
- Test: `packages/engine-editor/test/ligature-shaping.test.ts`

**Pass gate:** wrapping, `TextItem.width`, caret edges, and hit testing are derived
from HarfBuzz clusters. Mixed regular/bold text has no boundary jump. Ligature
interiors follow declared caret policy. No `advance(char, bold, italic)` production
path remains.

## Task 6: Carry resolved font and glyph data through the display list

**Files:**
- Modify: `packages/core/src/geometry.ts`
- Modify: `packages/engine-editor/src/display-bridge.ts`
- Modify: `packages/engine-editor/test/bridge-cache-keys.test.ts`
- Modify: `packages/engine-editor/test/bridge-invalidation.test.ts`

**Pass gate:** every `GlyphRun` carries resolved font identity, family, size, color,
glyph IDs, clusters, and fixed-point advances from layout. Cache keys include the
shaping environment and font hash. `display-bridge.ts` contains no font constants.

## Task 7: Paint with the exact shaped font bytes

**Files:**
- Modify: `packages/react/src/paintDisplay.tsx`
- Modify: `packages/vue/src/paintDisplay.ts`
- Modify: `packages/engine-output/src/dom.ts`
- Add focused React/Vue paint tests.

**Pass gate:** both adapters register the same `ResolvedFont` bytes through
`FontFace`, use the IR family/weight/style/size, and never substitute via a CSS stack
silently. DOM run boxes match layout advances at regular/bold boundaries.

## Task 8: End-to-end fidelity and preservation gate

**Files:**
- Add fixtures for direct mixed formatting and style/theme-derived headings.
- Add paired React/Vue Playwright coverage.
- Modify: `openspec/changes/document-engine/tasks.md` only after all evidence passes.

**Pass gate:** compare resolved properties, glyph IDs/clusters/advances, line breaks,
run boxes, caret positions, hit targets, and page count. Save/reopen preserves the
original formatting bytes. React and Vue results match. Task 8.1 remains open for any
unevidenced variable/color-font, fallback, licensing, bundle-size, or runtime gate.
