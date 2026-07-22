/**
 * `@docx-editor.dev/core/editor` — the browser editor facade.
 *
 * CONTRACT ONLY.
 */

import type { ContentControlSummary, DocEdits, DocQueries, DocQueryResults } from './index';
import type { DisplayPage, DocPoint } from './geometry';
import type {
  ColorValue,
  ContentControlFilter,
  DocAnchor,
  DocLocation,
  DocRange,
  DocxDocument,
  Point,
  Rect,
  Revision,
  RunFormatting,
  ExecErrorCode,
  ExecResult,
  Extension,
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
 * The editor is N+1 editing views: one body plus one per header/footer
 * relationship, plus footnotes, text boxes, and other addressable regions.
 * Commands must say which one they target, or they silently hit the wrong
 * surface when a header is focused.
 *
 * Intentionally open-ended: this set is expected to grow (notes, frames, and
 * whatever regions later prove addressable), so treat it as non-exhaustive
 * rather than a closed enum.
 */
export type EditorScope =
  | { kind: 'body' }
  | { kind: 'headerFooter'; rId: string }
  /** A footnote/endnote region, addressed by note id. */
  | { kind: 'note'; id: string }
  /** A text box or floating frame with its own content, addressed by id. */
  | { kind: 'frame'; id: string }
  /** Read-only aggregate across every view. Valid for queries, not for writes. */
  | { kind: 'all' };

/** A concrete editing view — every scope except the read-only `all` aggregate. */
export type ViewScope = Exclude<EditorScope, { kind: 'all' }>;

/**
 * A position the engine can resolve. Kept deliberately open: any accepted
 * address form, including a `hitTest` result. New forms may be added without
 * breaking callers, so do not treat this as a closed set.
 */
export type EditorPosition = DocAnchor | DocLocation | DocPoint;

/** A selection expressed with any accepted position form. */
export type EditorSelection = DocRange | { from: EditorPosition; to: EditorPosition } | DocPoint;

/**
 * Everything a framework adapter must supply. The adapter is a renderer and an
 * event forwarder: it hands core DOM to paint into, schedules frames, and
 * receives a positioned `DisplayPage[]` to render. It does not measure, lay
 * out, or interpret the document — core owns all of that.
 *
 * DOM handles are getters, not values: all of them are null through first
 * render, and React's scroll container can change identity between renders.
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

  /** Core emitted a fresh positioned render list; paint it. */
  onDisplay?(pages: readonly DisplayPage[]): void;
  onScrollRestore?(pending: PendingScrollRestore): void;
  onSelectionChange?(snapshot: EditorSnapshot): void;
  onTotalPages?(total: number): void;
}

export type CanResult = { ok: true } | { ok: false; code: ExecErrorCode; reason: string };

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
  setActiveScope(scope: ViewScope): void;
  getActiveScope(): ViewScope;

  query<K extends keyof EditorQueries>(
    query: { type: K } & EditorQueries[K],
    options?: { scope?: EditorScope }
  ): EditorQueryResults[K];
  snapshot(options?: { scope?: EditorScope }): EditorSnapshot;

  getTotalPages(): number;
  getCurrentPage(mode?: 'viewport' | 'caret'): number;

  // ─── Geometry (core owns layout; the adapter only paints and forwards) ─────
  /** The current positioned render list. Also delivered via the `display`
   * event and `EditorHost.onDisplay`. */
  getDisplay(): readonly DisplayPage[];
  /** Selection rectangles in content-pixel space; defaults to the current
   * selection. Accepts any position form (including a `hitTest` result).
   * Empty when the selection is collapsed. */
  getSelectionRects(range?: EditorSelection): readonly Rect[];
  /** Caret rectangle for a position; defaults to the current caret. Accepts
   * any position form, including a `hitTest` result. */
  getCaretRect(pos?: EditorPosition): Rect | null;
  /** Resolve a client-space point to a document position for pointer handling.
   * The returned `DocPoint` is accepted directly by `setSelection`,
   * `getCaretRect`, and `getSelectionRects`. */
  hitTest(point: Point): DocPoint | null;
  getPageGeometry(): readonly { index: number; box: Rect }[];
  getScrollGeometry(): { contentHeight: number; pageTops: readonly number[] };

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
  setSelection: { anchor: EditorPosition } | { range: EditorSelection };
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
  pageContent: DisplayPage | null;
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
 * A read model of the current editor state, safe to hand to framework
 * rendering. Named `EditorSnapshot` rather than `EditorState` so it never
 * collides with an editing engine's own state type.
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
  display: (pages: readonly DisplayPage[]) => void;
  error: (error: EditorError) => void;
}

export function createEditor(_config: EditorConfig): Editor {
  throw new Error(NOT_IMPLEMENTED);
}
