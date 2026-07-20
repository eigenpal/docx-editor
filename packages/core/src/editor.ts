/**
 * `@docx-editor.dev/core/editor` — the browser editor facade.
 *
 * CONTRACT ONLY.
 */

import type { ContentControlSummary, DocEdits, DocQueries, DocQueryResults } from './index';
import type {
  ColorValue,
  ContentControlFilter,
  DocAnchor,
  DocRange,
  DocxDocument,
  Revision,
  RunFormatting,
  ExecErrorCode,
  ExecResult,
  Extension,
  PageLayout,
  Unsubscribe,
  Watermark,
} from './types';

export type * from './types';

const NOT_IMPLEMENTED = 'contract-only stub: no implementation';

export interface EditorConfig {
  host: EditorHost;
  document?: DocxDocument;
  /** Defaults to `createStarterKit()` from `core/plugin`. */
  extensions?: readonly Extension[];
  /** Default author for the tracked-change commands. */
  author?: string;
  locale?: string;
  zoom?: number;
}

/**
 * The editor is N+1 ProseMirror views: one body plus one per header/footer
 * relationship. Commands must say which one they target, or they silently hit
 * the wrong surface when a header is focused.
 */
export type EditorScope =
  | { kind: 'body' }
  | { kind: 'headerFooter'; rId: string }
  /** Read-only aggregate across every view. Valid for queries, not for writes. */
  | { kind: 'all' };

/**
 * Everything a framework adapter must supply.
 *
 * DOM handles are getters, not values: all of them are null through first
 * render, and React's scroll container can change identity between renders.
 * `measureBlocks` is injected because core currently calls back into the
 * adapter to measure; that inverts in a later step and this member retires
 * with it.
 */
export interface EditorHost {
  getBodyHostEl(): HTMLElement | null;
  getHfHostEl(rId: string): HTMLElement | null;
  getPagesContainer(): HTMLElement | null;
  /** React returns the real scroller; Vue may return null. */
  getScrollContainer(): HTMLElement | null;

  /** Coalesces engine work. Returns a canceller. */
  scheduleFrame(callback: () => void): () => void;
  /**
   * Runs after the adapter has flushed its own render: `useLayoutEffect` in
   * React, `nextTick` in Vue. Two phases, because engine paint and adapter
   * commit are not the same moment. Optional; Vue may omit it.
   */
  afterCommit?(callback: () => void): void;

  measureBlocks: MeasureBlocksFn;

  onLayout?(pages: readonly PageLayout[]): void;
  onPainted?(kind: 'full' | 'incremental'): void;
  onScrollRestore?(pending: PendingScrollRestore): void;
  onSelectionChange?(snapshot: EditorSnapshot): void;
  onTotalPages?(total: number): void;
}

export type CanResult = { ok: true } | { ok: false; code: ExecErrorCode; reason: string };

export type MeasureBlocksFn = (
  nodes: readonly unknown[],
  contentWidth: number | number[]
) => unknown[];

export interface PendingScrollRestore {
  readonly top: number;
  readonly anchorParaId?: string;
}

export interface Editor {
  load(document: DocxDocument): void;
  save(): Promise<ArrayBuffer>;
  getDocument(): DocxDocument;

  exec(command: EditorCommand, options?: { scope?: EditorScope }): ExecResult;
  /** Dry run: reports whether `exec` would apply. Never reports `changed`. */
  can(command: EditorCommand, options?: { scope?: EditorScope }): CanResult;
  setActiveScope(scope: Exclude<EditorScope, { kind: 'all' }>): void;
  getActiveScope(): Exclude<EditorScope, { kind: 'all' }>;

  query<K extends keyof EditorQueries>(
    query: { type: K } & EditorQueries[K],
    options?: { scope?: EditorScope }
  ): EditorQueryResults[K];
  snapshot(options?: { scope?: EditorScope }): EditorSnapshot;

  getTotalPages(): number;
  getCurrentPage(mode?: 'viewport' | 'caret'): number;

  /** Replaces the module-scope cache-invalidation calls adapters make today. */
  relayout(options?: { sync?: boolean }): void;
  focus(scope?: EditorScope): void;
  destroy(): void;

  on<E extends keyof EditorEvents>(event: E, handler: EditorEvents[E]): Unsubscribe;
}

/**
 * Open by declaration merging: extensions contribute keys from `core/plugin`.
 * `exec` resolves `{ type, ... }` through the extension registry, which is
 * already the production dispatch path.
 */
/**
 * In the editor a command targets the current selection unless told otherwise,
 * so the document layer's required `target` becomes optional here.
 */
type SelectionTargeted<T> = {
  [K in keyof T]: T[K] extends { target: infer G } ? Omit<T[K], 'target'> & { target?: G } : T[K];
};

export interface EditorCommands extends SelectionTargeted<DocEdits> {
  toggleMark: { mark: string };
  setMarkAttr: { mark: string; attr: string; value: unknown };
  setAlignment: { align: 'left' | 'center' | 'right' | 'justify' };
  setIndent: { left?: number; right?: number; firstLine?: number; hanging?: number };
  toggleList: { kind: 'bullet' | 'ordered' };

  insertRow: { where: 'above' | 'below' };
  insertColumn: { where: 'left' | 'right' };
  deleteRow: Record<never, never>;
  deleteColumn: Record<never, never>;
  deleteTable: Record<never, never>;
  mergeCells: Record<never, never>;
  splitCell: { rows: number; cols: number };
  setCellFill: { color: ColorValue };
  toggleHeaderRow: Record<never, never>;

  insertPageBreak: Record<never, never>;
  insertSectionBreak: { kind: string };
  setWatermark: { watermark: Watermark | null };
  refreshToc: { tocId?: string };

  undo: Record<never, never>;
  redo: Record<never, never>;
  setSelection: { anchor: DocAnchor } | { range: DocRange };
}

export type EditorCommand = {
  [K in keyof EditorCommands]: { type: K } & EditorCommands[K];
}[keyof EditorCommands];

export interface EditorQueries extends DocQueries {
  selection: Record<never, never>;
  selectionFormatting: Record<never, never>;
  tableContext: Record<never, never>;
  hyperlinkAt: { pos?: number; fallbackHref?: string };
  selectedText: Record<never, never>;
  watermark: Record<never, never>;
  splitCellConfig: Record<never, never>;
  contentControlAt: { filter?: ContentControlFilter };
  isInsideToc: { pos: number };
  trackedChanges: Record<never, never>;
  pageContent: { page: number };
}

export type EditorQuery = {
  [K in keyof EditorQueries]: { type: K } & EditorQueries[K];
}[keyof EditorQueries];

/** What each editor query returns. Keyed identically to `EditorQueries`. */
export interface EditorQueryResults extends DocQueryResults {
  selection: DocRange | null;
  selectionFormatting: RunFormatting | null;
  tableContext: TableContext | null;
  hyperlinkAt: HyperlinkInfo | null;
  selectedText: string;
  watermark: Watermark | null;
  splitCellConfig: { maxRows: number; maxCols: number } | null;
  contentControlAt: ContentControlSummary | null;
  isInsideToc: boolean;
  trackedChanges: readonly Revision[];
  pageContent: readonly PageLayout[];
}

export interface TableContext {
  readonly rows: number;
  readonly columns: number;
  readonly rowIndex: number;
  readonly columnIndex: number;
}

export interface HyperlinkInfo {
  readonly href: string;
  readonly range: DocRange;
}

/**
 * Named `EditorSnapshot`, not `EditorState`: the latter collides with
 * `prosemirror-state`'s export across 18 adapter import sites, several of which
 * already alias around it.
 */
export interface EditorSnapshot {
  readonly scope: EditorScope;
  readonly isLoading: boolean;
  readonly parseError: string | null;
  readonly zoom: number;
  readonly selection: DocRange | null;
  readonly formatting: RunFormatting | null;
  readonly table: TableContext | null;
  readonly image: ImageContext | null;
  readonly page: { readonly current: number; readonly total: number };
}

export interface ImageContext {
  readonly widthEmu: number;
  readonly heightEmu: number;
  readonly wrap: 'inline' | 'square' | 'tight' | 'topAndBottom' | 'behind' | 'inFront';
}

export interface EditorError extends Error {
  readonly code?: string;
}

export interface EditorEvents {
  change: (document: DocxDocument) => void;
  selectionChange: (snapshot: EditorSnapshot) => void;
  layout: (pages: readonly PageLayout[]) => void;
  painted: (kind: 'full' | 'incremental') => void;
  error: (error: EditorError) => void;
}

export function createEditor(_config: EditorConfig): Editor {
  throw new Error(NOT_IMPLEMENTED);
}
