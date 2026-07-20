# Final Public API for `@docx-editor.dev/core`

## 1. Verdict

**RETHINK the cut, keep the shape.** The four-entry *organization* (document / editor / plugin / types) is correct and should be adopted. The specific cut proposed cannot ship: it is sized against a 5x undercount, deletes 86 symbols of live adapter coupling with no replacement, regresses an already-shipped open command registry into a closed union, and races the only in-flight work (#696 Tier 2) that would make the deleted layer retirable.

Panel split: **4 RETHINK** (ooxml-domain, agent-mcp, migration-risk, adversarial) / **2 SHIP_WITH_CHANGES** (api-design, adapter-integration). 28 objections survived independent adversarial verification, 14 of them blockers. No panel member endorsed the proposal as written.

The revision below is **6 entries, not 4**, and roughly **95 runtime symbols, not 30**. That is the honest number. The reduction is still large (65 entries to 6, 1,125 symbols to ~95 runtime + a type barrel), but the original scorecard was arithmetic on the wrong denominator.

---

## 2. The measured problem

Verified against `/Users/jedrzejblaszyk/docx-editor-old/packages/core/package.json` and `packages/{react,vue,agents,nuxt}/src`:

| Metric | Value |
|---|---|
| Declared export entries in core | **65** |
| Distinct public symbols | **1,125** (631 fn, 291 iface, 106 const, 77 type, 21 class) |
| Subpaths adapters actually import | **65** |
| Distinct symbols adapters import | **428** (independent reimplementation; reviewer got 429) |
| Import sites | **458** |
| Subpaths imported but **not exported** | **12** |
| Symbols on those private subpaths | **86** across **73** sites |

Top consumed subpaths: `core/utils` 52, `core/prosemirror` 52, `core/prosemirror/commands` 49, `core/flow-model` 42, `core/types/document` 30, `core/painter-model` 28, `core/headless` 28, root 23.

Three structural facts the original proposal missed:

1. **The private-subpath leak is a packaging bug, not an API-design problem.** `flow-model`, `pagination-model`, `painter-model`, `editor` resolve only through the monorepo `tsconfig.json:24-28` wildcard. `scripts/check-package-artifacts.mjs:44-56` already hard-fails published artifacts that import them. The build simultaneously depends on them and rejects them.
2. **There is no verification gate.** `bun run typecheck` in the consumers repo exits 2 with hundreds of TS2307. `packages/core` does not exist there, and the installed `@docx-editor.dev/core@0.0.1` is a 21-byte name-reservation stub (`module.exports = {}`, zero exports entries). CI's `test` job is red below lint. Neither the current API nor any proposed API can be validated today.
3. **Core calls back into the adapter to do layout.** `core/src/editor/computeLayout.ts:101` takes `measureBlocks: MeasureBlocksFn` as an input; both adapters pass their own measurement in (`react useLayoutPipeline.ts:256`, `vue useDocxEditor.ts:415`). A self-contained `Editor` object cannot exist until that inverts.

---

## 3. The final API

### Entry map

| Entry | Purpose | Runtime symbols | Status |
|---|---|---|---|
| `@docx-editor.dev/core` | Document model, parse/serialize, headless edits, agent addressing | ~40 | stable |
| `@docx-editor.dev/core/editor` | Browser editor facade | ~20 | stable |
| `@docx-editor.dev/core/geometry` | Layout, measurement, hit-testing, paint | ~35 | **`@experimental`, semver-exempt** |
| `@docx-editor.dev/core/plugin` | Extension + command authoring | ~8 | stable |
| `@docx-editor.dev/core/types` | Type-only barrel, zero runtime | 0 | stable |
| `@docx-editor.dev/core/mcp` | MCP tool registry + JSON Schema | ~6 | stable |

`./api`, `./core-plugins`, `./docx/serializer`, `./managers/AutoSaveManager`, `./plugin-api/types`, `./utils/textSelection` have external consumers outside the first-party adapters. They stay published as deprecated aliases for one major (see §5).

---

### 3.1 `@docx-editor.dev/core`

```ts
// ---------- Parse / serialize ----------
export function parseDocx(input: ArrayBuffer | Uint8Array): Promise<DocxDocument>;
export function serializeDocx(doc: DocxDocument): Promise<ArrayBuffer>;

// DocxDocument is NOT JSON-round-trippable (Map<string, HeaderFooter>, Map<string,
// MediaFile>, Date). Do not hand it to an LLM or push it over JSON-RPC.
export function toJSON(doc: DocxDocument): DocxDocumentJSON;
export function fromJSON(json: DocxDocumentJSON): DocxDocument;

// ---------- Addressing ----------
/**
 * Edit addressing. Stable across edits, JSON-safe, LLM-legible.
 * `search` must match EXACTLY ONCE inside the paragraph; ambiguous or missing
 * matches FAIL with code 'ambiguous' / 'notFound'. Never first-match-wins.
 */
export interface DocAnchor {
  paraId: string;              // 8-hex w14:paraId, matched case-insensitively
  search?: string;             // unique phrase within the paragraph
  occurrence?: number;         // opt-in disambiguation; omit to require uniqueness
}

/** Structural addressing for content the paraId map cannot reach yet. */
export interface DocLocation {
  container: ContainerRef;
  path: number[];              // block indices, descending into tables/SDTs
  offset?: number;             // character offset within the addressed paragraph
}

export type ContainerRef =
  | { part: 'body' }
  | { part: 'header' | 'footer'; rId: string }
  | { part: 'footnote' | 'endnote'; id: number }
  | { part: 'comment'; id: string }
  | { part: 'shapeText'; shapeId: string };

export type DocTarget = DocAnchor | DocLocation;

// ---------- Document-level edits ----------
/**
 * Renamed from the shipped `executeCommands`. Same semantics: immutable,
 * reduce-over-commands, plugin-handler-first dispatch.
 */
export function applyEdits(doc: DocxDocument, edits: DocEdit[]): ApplyResult;

export interface ApplyResult {
  doc: DocxDocument;
  results: ExecResult[];       // one per edit, positionally aligned
}

// ---------- Result taxonomy (replaces `boolean`) ----------
export type ExecResult =
  | { ok: true; changed: boolean }
  | { ok: false; code: ExecErrorCode; reason: string; target?: DocTarget };

export type ExecErrorCode =
  | 'notFound' | 'ambiguous' | 'locked' | 'bound' | 'typeMismatch'
  | 'kindMismatch' | 'outOfBounds' | 'unsupported' | 'invalidArgs';
// 'locked' / 'bound' / 'typeMismatch' / 'kindMismatch' preserve the 8 exported
// ContentControl*Error classes and the 11 editor-layer throw sites in
// prosemirror/contentControls.ts:211-376.

// ---------- Command vocabulary ----------
/**
 * Open by declaration merging. Third parties widen it from `core/plugin`.
 * `DocEdit` is the document-executable SUBSET of `EditorCommand`.
 */
export interface DocEdits {
  insertText:        { target: DocTarget; text: string };
  replaceText:       { target: DocTarget; text: string };
  deleteText:        { target: DocTarget };
  applyFormatting:   { target: DocTarget; marks: RunFormatting };
  setParagraphStyle: { target: DocTarget; styleId: string };
  insertTable:       { target: DocTarget; rows: number; columns: number };
  insertImage:       { target: DocTarget; data: Uint8Array; extent?: Extent };
  insertHyperlink:   { target: DocTarget; href: string; text?: string };
  removeHyperlink:   { target: DocTarget };
  insertBreak:       { target: DocTarget; kind: 'page' | 'column' | 'line' | 'section' };
  splitParagraph:    { target: DocTarget };
  mergeParagraphs:   { target: DocTarget };
  setVariable:       { name: string; value: string };
  applyVariables:    { values: Record<string, string> };

  // authored / tracked family. `author` is REQUIRED here; tracked-ness is verb
  // identity, not a boolean flag (there is no trackChanges toggle in the codebase).
  proposeReplacement: { target: DocTarget; replaceWith: string; author: string };
  proposeInsertion:   { target: DocTarget; text: string; author: string };
  proposeDeletion:    { target: DocTarget; author: string };
  addComment:         { target: DocTarget; text: string; author: string };
  replyComment:       { commentId: string; text: string; author: string };
  resolveComment:     { commentId: string };

  // revision ids are numeric and unique only WITHIN a part
  acceptRevision: { id: number; part?: 'body' | 'footnote' | 'endnote'; noteId?: number };
  rejectRevision: { id: number; part?: 'body' | 'footnote' | 'endnote'; noteId?: number };
  acceptAllRevisions: Record<string, never>;
  rejectAllRevisions: Record<string, never>;

  // content controls
  setContentControlValue:  { target: DocTarget; value: string };
  removeContentControl:    { target: DocTarget };
  addRepeatingSectionItem: { target: DocTarget; index?: number };
  removeRepeatingSectionItem: { target: DocTarget; index: number };
}

export type DocEdit = { [K in keyof DocEdits]:
  { type: K } & DocEdits[K] }[keyof DocEdits];

// ---------- Read channel ----------
export interface DocQueries {
  paragraphs:        { container?: ContainerRef };
  findText:          { text: string; container?: ContainerRef };
  contentControls:   { filter?: ContentControlFilter };
  revisions:         { part?: 'body' | 'footnote' | 'endnote' };
  comments:          { resolved?: boolean };
  styles:            Record<string, never>;
  variables:         Record<string, never>;
}
export type DocQuery = { [K in keyof DocQueries]:
  { type: K } & DocQueries[K] }[keyof DocQueries];
export type DocQueryResult<Q extends DocQuery> = /* mapped per variant */ unknown;

export function queryDoc<Q extends DocQuery>(doc: DocxDocument, q: Q): DocQueryResult<Q>;

// ---------- Runtime schema (required for MCP tools/list) ----------
export const docEditSchemas: Readonly<Record<keyof DocEdits, JSONSchema>>;
export const docQuerySchemas: Readonly<Record<keyof DocQueries, JSONSchema>>;

// ---------- OOXML semantic helpers that CANNOT move out ----------
export function resolveColor(c: ColorValue, theme?: Theme): ColorValue;
export function resolveColorToHex(c: ColorValue, theme?: Theme): string;
export function resolveHighlightColor(name: string): string;
export function generateThemeTintShadeMatrix(scheme: ThemeColorScheme): ThemeMatrixCell[][];
export function loadDocumentFonts(doc: DocxDocument): Promise<void>;
export function getEmbeddedFontFamilies(doc: DocxDocument): string[];
export function getRenderableDocumentFonts(doc: DocxDocument): FontDefinition[];
export function parseClipboardHtml(html: string, theme?: Theme): Run[];
export function runsToClipboardContent(runs: Run[], theme?: Theme): ClipboardContent;
export function copyRuns(runs: Run[]): Run[];
export const TWIPS_PER_INCH: number;
export const PIXELS_PER_INCH: number;
export function twipsToPixels(twips: number): number;
export function pixelsToTwips(px: number): number;
export function pixelsToEmu(px: number): number;
export function emuToPixels(emu: number): number;
```

**`DocxDocument` invariants that are part of the contract:**

```ts
// `sections` is DERIVED, not stored. Computed via buildSections +
// applySectionInheritance. Never a spreadable field on the public type.
export interface DocumentBody {
  content: BlockContent[];
  readonly sections: readonly Section[];   // getter, recomputed on read
}

// Verbatim-XML round-trip caches are NOT reachable as public spreadable fields.
// They live in a pristine side-table keyed by paraId / sdt id, so any structural
// rewrite drops its entry by construction.
export interface DocxDocument {
  /** @internal */ readonly [kPristine]: PristineXmlTable;
}
```

---

### 3.2 `@docx-editor.dev/core/editor`

```ts
export function createEditor(config: EditorConfig): Editor;

export interface EditorConfig {
  host: EditorHost;
  document?: DocxDocument;
  extensions?: Extension[];        // defaults to createStarterKit()
  author?: string;                 // default author for tracked commands
  locale?: string;
  zoom?: number;
}

// ---------- Scopes: the editor is N+1 ProseMirror views, not one ----------
export type EditorScope =
  | { kind: 'body' }
  | { kind: 'headerFooter'; rId: string }
  | { kind: 'all' };               // read-only aggregate (tracked changes, comments)

export interface Editor {
  load(doc: DocxDocument): void;
  save(): Promise<ArrayBuffer>;
  getDocument(): DocxDocument;

  // ---------- Write ----------
  exec(cmd: EditorCommand, opts?: { scope?: EditorScope }): ExecResult;
  can(cmd: EditorCommand, opts?: { scope?: EditorScope }): ExecResult;
  setActiveScope(scope: Exclude<EditorScope, { kind: 'all' }>): void;
  getActiveScope(): Exclude<EditorScope, { kind: 'all' }>;

  // ---------- Read ----------
  query<Q extends EditorQuery>(q: Q, opts?: { scope?: EditorScope }): EditorQueryResult<Q>;
  snapshot(opts?: { scope?: EditorScope }): EditorSnapshot;   // NOT `EditorState`

  // ---------- Pages (pull, not just push) ----------
  getTotalPages(): number;
  getCurrentPage(mode?: 'viewport' | 'caret'): number;
  getPage(n: number): PageContent | null;
  getPages(from: number, to: number): PageContent[];

  // ---------- Lifecycle ----------
  relayout(opts?: { sync?: boolean }): void;
  focus(scope?: EditorScope): void;
  destroy(): void;

  on<E extends keyof EditorEvents>(e: E, fn: EditorEvents[E]): Unsubscribe;
}
```

**Host: 12 members, not 3.** This restores the `EngineHost` contract already derived from four exploration maps plus a spike in `openspec/changes/engine-spine-tier2/design.md:34-52`, plus one addition (`afterCommit`).

```ts
export interface EditorHost {
  // DOM handles. Getters, not values: all are null through first render, and
  // React's scroll container can change identity across renders.
  getBodyHostEl(): HTMLElement | null;
  getHfHostEl(rId: string): HTMLElement | null;
  getPagesContainer(): HTMLElement | null;
  getScrollContainer(): HTMLElement | null;   // React returns real; Vue may return null

  // Scheduling. TWO phases, not one. scheduleFrame coalesces engine work;
  // afterCommit runs once the adapter has flushed ITS render
  // (useLayoutEffect in React, nextTick in Vue). Vue may omit afterCommit.
  scheduleFrame(cb: () => void): () => void;
  afterCommit?(cb: () => void): void;

  // Measurement injection. Required until Tier 2 step 5 inverts this.
  measureBlocks: MeasureBlocksFn;

  // Outputs
  onLayout?(pages: PageLayout[]): void;
  onPainted?(kind: 'full' | 'incremental'): void;
  onScrollRestore?(pending: PendingScrollRestore): void;
  onSelectionChange?(snapshot: EditorSnapshot): void;
  onTotalPages?(n: number): void;
}
```

**Commands stay open and registry-backed.**

```ts
/**
 * Widened by declaration merging. `core/plugin` extensions contribute keys.
 * exec() resolves {type, ...} through ExtensionManager's CommandMap, which is
 * ALREADY the production dispatch path in Vue (useMenuActions.ts:43
 * `getCommands()[name]`). This is a typing story over shipped runtime behavior.
 */
export interface EditorCommands extends DocEdits {
  toggleMark:       { mark: 'bold' | 'italic' | 'underline' | 'strike' | /* ... */ string };
  setMarkAttr:      { mark: string; attr: string; value: unknown };
  setAlignment:     { align: 'left' | 'center' | 'right' | 'justify' };
  setIndent:        { left?: number; right?: number; firstLine?: number; hanging?: number };
  toggleList:       { kind: 'bullet' | 'ordered' };
  // table
  insertRow: { where: 'above' | 'below' }; insertColumn: { where: 'left' | 'right' };
  deleteRow: {}; deleteColumn: {}; deleteTable: {};
  mergeCells: {}; splitCell: { rows: number; cols: number };
  setCellFill: { color: ColorValue }; toggleHeaderRow: {};
  // structure
  insertPageBreak: {}; insertSectionBreak: { kind: SectionBreakKind };
  setWatermark: { watermark: Watermark | null };
  refreshToc: { tocId?: string };
  // history / selection
  undo: {}; redo: {};
  setSelection: { anchor: DocAnchor } | { range: DocRange };
}

export type EditorCommand = { [K in keyof EditorCommands]:
  { type: K } & EditorCommands[K] }[keyof EditorCommands];
```

**Reads are parameterized. `snapshot()` is not a god-blob.**

```ts
export interface EditorQueries extends DocQueries {
  selection:          Record<string, never>;
  selectionFormatting: Record<string, never>;
  tableContext:       Record<string, never>;
  hyperlinkAt:        { pos?: number; fallbackHref?: string };
  selectedText:       Record<string, never>;
  watermark:          Record<string, never>;
  splitCellConfig:    Record<string, never>;
  contentControlAt:   { filter?: ContentControlFilter };
  isInsideToc:        { pos: number };
  trackedChanges:     Record<string, never>;   // honors scope 'all'
  pageContent:        { page: number };
}
export type EditorQuery = { [K in keyof EditorQueries]:
  { type: K } & EditorQueries[K] }[keyof EditorQueries];

/** Renamed from `EditorState`. Collides with prosemirror-state across 18 sites. */
export interface EditorSnapshot {
  scope: EditorScope;
  isLoading: boolean;
  parseError: string | null;
  zoom: number;
  selection: SelectionSnapshot | null;
  formatting: SelectionFormatting | null;
  table: TableContextInfo | null;
  image: ImageContextInfo | null;
  page: { current: number; total: number };
}
```

**Events:**

```ts
export interface EditorEvents {
  change:          (doc: DocxDocument) => void;
  selectionChange: (snap: EditorSnapshot) => void;
  layout:          (pages: PageLayout[]) => void;
  painted:         (kind: 'full' | 'incremental') => void;
  error:           (err: EditorError) => void;
}
```

---

### 3.3 `@docx-editor.dev/core/geometry` (`@experimental`)

This entry exists because 86 symbols across 73 sites are in live adapter use and the three-method geometry story covers roughly 8 of them. It is explicitly marked semver-exempt and is the retirement target for Tier 3.

```ts
// measurement
export function measureBlocksWithFloats(...): BlockMeasurement[];
export function measureTable(...): TableMeasurement;
export function paragraphLayout(...): ParagraphLayout;
export function getCachedParagraphMetrics(key: string): ParagraphMetrics | undefined;
export function setCachedParagraphMetrics(key: string, m: ParagraphMetrics): void;

// hit-testing / pointer
export function pointerToDocPos(...): DocPoint | null;
export function resolveDomPosition(...): DocPoint | null;
export function resolveHfDomPosition(...): DocPoint | null;
export function resolveFragmentTarget(t: PageTarget, nodes: ContentNode[], m: LayoutMetrics[], p: Point): FragmentTarget | null;
export function resolveTableCellTarget(...): TableCellTarget | null;
export function findWordBoundariesForPointer(...): Range | null;
export function findBodyPmAnchor(root: ParentNode): HTMLElement | null;
export function findBodyPmAnchors(root: ParentNode): HTMLElement[];
export function createCellDragTracker(...): CellDragTracker;

// selection geometry
export function readSelectionGeometry(...): SelectionBox[];
export function computeHfCaretRectFromView(...): Rect | null;
export function readHfSelectionGeometry(...): SelectionBox[];

// paint
export function paintPages(pages: PageLayout[], container: HTMLElement, opts: PaintOptions): 'full' | 'incremental';
export class LayoutPainter { /* ... */ }
export function applySdtFocus(...): void;
export function applyCellSelectionHighlight(...): void;   // stays in core: reads core-painted DOM
export function detectTableInsertHover(...): TableInsertHover | null; // stays: depends on unexported PAGE_CLASS_NAMES
export const PAGE_CLASS_NAMES: Readonly<Record<string, string>>;
export const TABLE_CLASS_NAMES: Readonly<Record<string, string>>;

// geometry position type. DISTINCT from DocAnchor. `{paraId, search}` is
// incoherent for posFromPoint.
export interface DocPoint { pmPos: number; scope: EditorScope; }
```

**Cache invalidation does not appear here.** `clearAllCaches`, `resetCanvasContext`, `invalidateHfDomCache`, `syncImeCaretAnchor`, `resetImeCaretAnchor` are removed from the public surface. They mutate three module-scope `MemoMap`s and a module-scope `measuringContext`, which defeats the facade and breaks multi-editor instances. Core internalizes the `document.fonts` `loadingdone` listener that currently drives them from `react/.../useLayoutTriggers.ts:52-54`. This incidentally fixes Vue, which does no font-load cache reset at all today. Adapters get `editor.relayout({ sync: true })` instead.

---

### 3.4 `@docx-editor.dev/core/plugin`

```ts
export function createExtension(spec: ExtensionSpec): Extension;
export function createNodeExtension(spec: NodeExtensionSpec): NodeExtension;
export function createMarkExtension(spec: MarkExtensionSpec): MarkExtension;
export function createStarterKit(options?: StarterKitOptions): Extension[];
export class ExtensionManager { /* buildSchema(), initializeRuntime(), getCommands() */ }
export type CommandMap = Record<string, (...args: any[]) => Command>;

export type { EditorPlugin, PluginPanelProps, RenderedDomContext };

// Extension authors widen the command union AND register a runtime schema:
//   declare module '@docx-editor.dev/core/editor' {
//     interface EditorCommands { myThing: { foo: string } }
//   }
export function registerCommandSchema(type: string, schema: JSONSchema): void;
```

---

### 3.5 `@docx-editor.dev/core/types` and `/mcp`

`core/types` is a pure type barrel re-exporting `DocxDocument`, `Section`, `Paragraph`, `Run`, `Table`, `Comment`, `Style`, `Theme`, `ColorValue`, `PageLayout`, `EditorSnapshot`, `DocEdit`, `EditorCommand`, and friends. Zero runtime.

`core/mcp` keeps the existing tool registry, because the runtime JSON Schema plus the LLM-facing prose is the product and a TypeScript union cannot produce either:

```ts
export interface McpToolDefinition {
  name: string;
  displayName?: string;
  description: string;        // 5-7 lines of LLM-facing prose per tool
  inputSchema: JSONSchema;
  handler: (args: unknown, ctx: McpContext) => Promise<unknown>;
}
export const coreTools: readonly McpToolDefinition[];
export function executeToolCall(name: string, args: unknown, ctx: McpContext): Promise<unknown>;
```

---

### 3.6 Per-symbol disposition (bucketed)

| Bucket | Count | Disposition |
|---|---|---|
| `types/document` + `types/content` + `types/*` | ~140 | → `core/types` (verbatim) |
| `prosemirror/commands` command fns | ~70 | → `EditorCommands` union members |
| `prosemirror/commands` + `prosemirror` queries | ~27 | → `EditorQueries` union members |
| `prosemirror` `*Tr` transaction builders | 6 | → `EditorCommands` (adapters only `view.dispatch(tr)` them) |
| `prosemirror` infra (schema, plugin factories) | 5 | → `core/plugin` |
| `flow-model` / `painter-model` / `pagination-model` | 82 | → `core/geometry` (`@experimental`) |
| `flow-model` mutable cache fns | 5 | **deleted**, internalized behind `relayout()` |
| `utils` OOXML-semantic (color, fonts, units, clipboard) | ~40 | → `core` root |
| `utils` presentational (cardStyles, sidebarConstants, reportIssue, stylePreview) | ~12 | **moves out** to consumers repo shared module |
| `agent` / `headless` model + text helpers | ~35 | → `core` root |
| `AgentCommand` + `executeCommand`/`executeCommands` | 3 | **renamed** to `DocEdit` / `applyEdits` |
| `ContentControl*Error` classes | 8 | → `ExecErrorCode` values, classes kept as deprecated aliases |
| `IMAGE_LAYOUT_OPTIONS`, TOC label maps, icon hints | ~14 | **moves out** (no painter/flow-model dependency) |
| Unmapped | **0** | any symbol without a row is an unplanned break |

---

## 4. What changed and why

Each change is tied to the confirmed objection that forced it.

| # | Change | Objection |
|---|---|---|
| 1 | Scorecard restated: 6 entries, ~95 runtime symbols, against a 428-symbol / 65-subpath denominator. Per-symbol disposition table added. | **#1 blocker** (5x undercount; the "12 subpaths / 86 symbols" figure was the private-internals subset promoted into the total) |
| 2 | Added `core/geometry` as an explicit `@experimental` fifth entry covering the 82 flow/painter/pagination symbols. The 3 geometry methods are dropped as a claimed replacement. | **#2, #22, #25 blockers** (3 methods cover ~8 of 42 flow-model symbols; Tier 2 has not built the lift) |
| 3 | `EditorCommand` is open via declaration merging on `interface EditorCommands`, resolved through `ExtensionManager`'s `CommandMap`. | **#3 blocker** (the string-dispatch registry is already the production path in Vue; a closed union makes `core/plugin` decorative). The tree-shaking argument in the original objection is **struck** as factually false. |
| 4 | Added `query<Q>(q)` / `queryDoc(doc, q)` symmetric read channels. | **#4, #24 major** (getSplitCellDialogConfig, findHyperlinkRangeAt(state, fallbackHref), findContentControlPos(doc, filter) are parameterized; a zero-arg `queryState()` cannot express them even in principle) |
| 5 | `EditorState` → **`EditorSnapshot`**. `EditorOptions` → `EditorConfig` **dropped** (no collision exists). `Editor` reconciled with the existing `EditorHandle`, not `EditorHost`. | **#5 major** (18 import sites, 3 aliases; `DocxEditor.tsx:537` already declares a colliding local `EditorState`) |
| 6 | One vocabulary, two executors. `DocEdit` is a strict subset of `EditorCommand`. Conformance test required: `applyEdits(doc, c)` must converge with `fromProseDoc(exec(pmState, c))`. | **#6 major, #27 blocker** (`insertTable` already has two independent implementations that nothing forces to agree; `bridge.ts` + `reviewerBridge.ts` are 1,057 lines of exactly the shim the proposal claimed to delete) |
| 7 | OOXML-semantic `core/utils` stays in core. Only ~12 presentational symbols move out. | **#7 major** (moving `embeddedFonts.ts` would force core to newly export its rels parser; `generateThemeTintShadeMatrix` cannot be absorbed into `queryState`) |
| 8 | `verbatimXml` / `rawPreserveXml` moved to a pristine side-table; not reachable as spreadable public fields. | **#8 blocker** (`headerFooterParser.ts:190,254` sets `verbatimXml` unconditionally on **every** parsed header/footer, and `headerFooterSerializer.ts:78` is an unconditional early return, so 100% of HF edits through a naive pure transform silently vanish on save) |
| 9 | `DocPosition` split into `DocAnchor` (paraId + unique search), `DocLocation` (container + path), `DocPoint` (geometry). | **#9, #17 blockers** (flat paragraph indices cannot reach table cells, block SDTs, HF, notes, comments, shape text; `agent/contentControls.ts:55` already proved container-kind + path works) |
| 10 | `exec`/`can` return `ExecResult`, not `boolean`. | **#10 major** (`can()` returning boolean cannot distinguish locked / notFound / bound; today's `executeCommand` returns a Document and throws 8 typed errors, so `boolean` is a strict regression) |
| 11 | `sections` becomes a computed accessor. `toJSON`/`fromJSON` added. | **#11 major** (`buildSections` has exactly one caller, the parser; `fromProseDoc.ts:52-53` already ships the desync today) |
| 12 | `EditorHost` grown from 3 to 12 members, including 4 DOM getters, `measureBlocks`, and `afterCommit`. | **#12, #15, #25 blockers** (design.md already derived a 13-member `EngineHost` for a *narrower* scope; React needs post-commit **then** rAF, Vue paints synchronously) |
| 13 | `EditorScope` discriminant on exec/can/query, plus `{kind:'all'}` for aggregate reads. | **#13 blocker** (one persistent PM view per HF rId; tracked changes and comments are inherently a union over N+1 views) |
| 14 | `relayout({sync})` restored; `invalidateMeasurements()` deliberately **not** exposed. | **#14 major** (`PagedEditorRef.relayout` is shipped public API with zero internal callers; font-load invalidation is core's own business and internalizing it fixes Vue's live divergence) |
| 15 | `applyEdits` documented as the rename of shipped `executeCommands`; `AgentCommand` **not** deleted (live consumers in `./mcp` and `./core-plugins`). | **#16, #27 blockers** |
| 16 | `author` required on tracked-command variants; `tracked?: boolean` **rejected**; propose\*/apply\* split adopted instead. | **#18 blocker** (grep for `trackChanges` returns zero; `EditorRefLike` makes `author` required on exactly three methods) |
| 17 | `acceptRevision` takes `id: number` plus `part`/`noteId`. | **#19 blocker** (`w:id` is unique only within its XML part; there is a dedicated regression test for the collision) |
| 18 | Page pull API added (`getPage`/`getPages`/`getTotalPages`/`getCurrentPage`). | **#20 major** (`getPageContent` needs both PageLayout and live `view.state.doc`; push-only `onLayout` supplies half. Note: React and Vue currently return **different answers** for `getCurrentPage`, hence the explicit `mode` parameter) |
| 19 | `docEditSchemas` / `docQuerySchemas` shipped as runtime JSON Schema; "no wrapper layer" claim **dropped**. | **#21 major** (MCP `tools/list` needs runtime schema; TS types are erased; the 7-line `read_document` description is the product) |
| 20 | Move-out list cut from 16 to ~12 symbols; `applyCellSelectionHighlight` and `detectTableInsertHover` stay. `IMAGE_LAYOUT_OPTIONS` still moves. | **#28 major** (`detectTableInsertHover` imports the unexported `PAGE_CLASS_NAMES`, so moving it would *grow* core's surface. Corrected rationale: painter class-name coupling, not PageLayout geometry, which it does not use) |

---

## 5. Migration and sequencing

The order in the original proposal is inverted. The API cut is bookkeeping that follows the engine work, not a substitute for it.

### Phase 0: build the verification gate (blocking, ~1 week)

Nothing else can be validated until this exists.

1. Publish real core prereleases (`0.x.y-next.N`) from `docx-editor-old`, replacing the 21-byte stub currently sitting at `@docx-editor.dev/core@0.0.1`.
2. Wire consumers CI to install the prerelease (npm dist-tag or `file:`), and **delete the `tsconfig.json:24-28` wildcard**. That wildcard is the only reason the 12 private subpaths ever resolved.
3. Add the four private subpaths to core's exports as `@internal`-tagged entries so `bun run typecheck` and the 152 Playwright specs run green against real published resolution.
4. Relax `scripts/check-package-artifacts.mjs` to warn rather than fail on those four, with a tracking issue and a removal date.

Exit criterion: `bun run typecheck` exits 0 in `/Users/jedrzejblaszyk/docx-editor` against an npm-installed core. Today it exits 2.

### Phase 1: land the non-controversial half (parallel with Phase 0 design)

These are correctness fixes that should ship regardless of the API decision:

- Computed `sections` accessor. The desync ships today in `fromProseDoc.ts:52-53`.
- Pristine side-table for `verbatimXml` / `rawPreserveXml`.
- Internalize the `document.fonts` `loadingdone` listener in core.
- Unify `getCurrentPage` semantics across React and Vue (pick viewport or caret, explicitly).

### Phase 2: finish #696 Tier 2 (steps 1-5)

Absorb layout, measure, paint, and view lifecycle into the engine. Critically, **invert `MeasureBlocksFn`** so core no longer calls back into the adapter to measure. Until that lands, `EditorHost.measureBlocks` is mandatory and `Editor` is not self-contained.

### Phase 3: Tier 3, pointer and selection geometry

Not currently scheduled. Note the correction: #696 does **not** declare geometry a Non-Goal (design.md:21-26 scopes out only the cell-drag to CellSelection promotion), so this is unbuilt rather than forbidden. This phase is what retires `core/geometry`.

### Phase 4: cut the API

Ship all 6 entries at once. Keep all 65 current entries published as deprecated aliases for one full major:

```jsonc
{
  "exports": {
    ".":                  "./dist/index.js",
    "./editor":           "./dist/editor/index.js",
    "./geometry":         "./dist/geometry/index.js",   // @experimental
    "./plugin":           "./dist/plugin/index.js",
    "./types":            "./dist/types/index.js",
    "./mcp":              "./dist/mcp/index.js",
    // deprecated aliases, one major, console.warn on first import in dev
    "./headless":         "./dist/compat/headless.js",
    "./prosemirror":      "./dist/compat/prosemirror.js",
    "./agent":            "./dist/compat/agent.js",
    "./utils":            "./dist/compat/utils.js",
    "./api":              "./dist/compat/api.js",
    "./core-plugins":     "./dist/compat/core-plugins.js"
    // ... remaining 53
  }
}
```

Ship a codemod (`npx @docx-editor.dev/core-codemod`) covering the mechanical majority: `types/*` to `core/types`, command function calls to `exec({type})`, query function calls to `query({type})`. The paraId addressing migration and the `EditorScope` threading are not mechanizable and need hand review.

### External consumers

The 7 entries with external-only consumers (`./api`, `./mcp`, `./core-plugins`, `./docx/serializer`, `./managers/AutoSaveManager`, `./plugin-api/types`, `./utils/textSelection`) get a longer runway than the first-party adapters. `./mcp` and `./core-plugins` survive as real entries because deleting `AgentCommand` would break both, and both have live in-core call sites (`mcp/core-tools.ts` at 5 sites, `core-plugins/types.ts:346`).

---

## 6. Open questions needing a human decision

1. **Does `core/geometry` ship publicly at all, or does the API cut wait for Tier 3?** Shipping it is honest about an 82-symbol coupling that exists today, but it also publishes DOM-contract internals that the team has twice declared private. Waiting means the four-entry headline holds but the cut slips by a quarter or more. **My recommendation: ship it `@experimental` and semver-exempt.** Adapters already import it; the only question is whether the coupling is documented or silent, and silent coupling is what produced the current bug.

2. **`getCurrentPage`: viewport or caret?** React answers viewport (`scrollPageInfo.currentPage`), Vue answers caret (`findPageIndexContainingPmPos`). The same agent tool returns different answers per adapter today. I have added a `mode` parameter, which dodges the decision. Someone should pick a default. I lean caret, since the agent use case is "where is the thing I just edited".

3. **Does `DocLocation` (container + path) ship in v1, or only `DocAnchor`?** `DocAnchor` covers everything the shipped agents package does. `DocLocation` is needed for table cells and block SDTs, which is the contracts-and-forms use case. But note the caveat: `contentControls.ts:441` documents that cell-level `w:sdt` is not surfaced by the table parser, so a path-based address alone does not close that gap without a parser fix. Do not sell v1 as fixing it.

4. **Where does `author` default live?** `DocxReviewer` uses constructor default plus per-call override. `EditorRefLike` makes it required per call. I have made it required on tracked variants with `EditorConfig.author` as a fallback, which matches `resolveAuthor()`. Confirm this is the intent rather than making it always explicit.

5. **Is `applyEdits` worth shipping at all, given `executeCommands` already exists?** The rename is free, but it implies a maintenance commitment to keep two executors in agreement across a growing union. The alternative is to leave the document layer as-is and make `EditorCommand` the only new vocabulary. **My recommendation: ship the rename with the conformance test.** Two executors already exist and already diverge; naming them consistently and testing convergence is cheaper than continuing to pretend they are one thing.

6. **Timeline reality check.** Phases 0 through 4 are realistically two to three quarters, not a refactor sprint. If the driver behind the original proposal is an external deadline (public launch, docs freeze, paid-tier packaging), say so now, because the honest answer may be to ship Phase 0 plus the deprecation aliases and defer the actual cut.