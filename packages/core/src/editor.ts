/**
 * `@docx-editor.dev/core/editor` — the browser editor facade.
 *
 * CONTRACT ONLY. The implementation ships from a separate repository.
 */

import type { DocEdits, DocQueries } from './index';
import type {
  ColorValue,
  ContentControlFilter,
  DocAnchor,
  DocRange,
  DocxDocument,
  ExecResult,
  PageLayout,
  Unsubscribe,
  Watermark,
} from './types';

export type * from './types';

const NOT_IMPLEMENTED = 'contract-only stub: the implementation ships from the core repository';

export interface EditorConfig {
  host: EditorHost;
  document?: DocxDocument;
  /** Defaults to `createStarterKit()` from `core/plugin`. */
  extensions?: unknown[];
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
  can(command: EditorCommand, options?: { scope?: EditorScope }): ExecResult;
  setActiveScope(scope: Exclude<EditorScope, { kind: 'all' }>): void;
  getActiveScope(): Exclude<EditorScope, { kind: 'all' }>;

  query<Q extends EditorQuery>(query: Q, options?: { scope?: EditorScope }): unknown;
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
export interface EditorCommands extends DocEdits {
  toggleMark: { mark: string };
  setMarkAttr: { mark: string; attr: string; value: unknown };
  setAlignment: { align: 'left' | 'center' | 'right' | 'justify' };
  setIndent: { left?: number; right?: number; firstLine?: number; hanging?: number };
  toggleList: { kind: 'bullet' | 'ordered' };

  insertRow: { where: 'above' | 'below' };
  insertColumn: { where: 'left' | 'right' };
  deleteRow: Record<string, never>;
  deleteColumn: Record<string, never>;
  deleteTable: Record<string, never>;
  mergeCells: Record<string, never>;
  splitCell: { rows: number; cols: number };
  setCellFill: { color: ColorValue };
  toggleHeaderRow: Record<string, never>;

  insertPageBreak: Record<string, never>;
  insertSectionBreak: { kind: string };
  setWatermark: { watermark: Watermark | null };
  refreshToc: { tocId?: string };

  undo: Record<string, never>;
  redo: Record<string, never>;
  setSelection: { anchor: DocAnchor } | { range: DocRange };
}

export type EditorCommand = {
  [K in keyof EditorCommands]: { type: K } & EditorCommands[K];
}[keyof EditorCommands];

export interface EditorQueries extends DocQueries {
  selection: Record<string, never>;
  selectionFormatting: Record<string, never>;
  tableContext: Record<string, never>;
  hyperlinkAt: { pos?: number; fallbackHref?: string };
  selectedText: Record<string, never>;
  watermark: Record<string, never>;
  splitCellConfig: Record<string, never>;
  contentControlAt: { filter?: ContentControlFilter };
  isInsideToc: { pos: number };
  trackedChanges: Record<string, never>;
  pageContent: { page: number };
}

export type EditorQuery = {
  [K in keyof EditorQueries]: { type: K } & EditorQueries[K];
}[keyof EditorQueries];

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
  readonly formatting: unknown | null;
  readonly table: unknown | null;
  readonly image: unknown | null;
  readonly page: { readonly current: number; readonly total: number };
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
