// The production browser editor (document-engine 4.3 / 7.12; comprehensive 4.2/4.3). Composes the
// PM-free engine-binding edit surface, engine-layout pagination, and the display bridge into the
// PM-free `Editor`/`EditorHost` contract — the throwing `createEditor` stub in core-contract is
// replaced by THIS. It is byte-native: `load`/`save` traffic in DOCX bytes (never a lossy tree),
// and the `change` event carries revision metadata, not bytes. No ProseMirror type or EditorView
// leaks past this boundary (the surface handle is PM-free). The rich command/query surface is wired
// feature-by-feature in section 5; until then those calls degrade gracefully instead of throwing.

import type {
  Editor,
  EditorConfig,
  EditorCommand,
  EditorScope,
  ViewScope,
  EditorPosition,
  EditorSelection,
  EditorSnapshot,
  EditorEvents,
  EditorQueries,
  EditorQueryResults,
  CanResult,
  DocumentSource,
  DocumentHandle,
} from '@docx-editor.dev/core-contract/editor';
import type { DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import type { Point, Rect, Unsubscribe, ExecResult } from '@docx-editor.dev/core-contract/types';
import {
  openDocxSession,
  mountEditSurface,
  type DocxEditorSession,
  type EditSurface,
} from '@docx-editor.dev/engine-binding';
import { layoutBody, HelveticaMetrics } from '@docx-editor.dev/engine-layout';
import { toDisplayPages } from './display-bridge.ts';

// US Letter, 1in margins, in twips — the same geometry the read-only preview uses.
const LAYOUT = { pageWidth: 12240, pageHeight: 15840, margin: 1440 } as const;

function sourceToBytes(source: DocumentSource): Uint8Array {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  // A DocumentHandle source (hand-off of an existing in-memory document) needs a document registry
  // the browser facade does not own yet; bytes are the supported source today.
  throw new Error('createEditor: loading from a DocumentHandle is not yet supported (pass DOCX bytes)');
}

function bytesToArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

const UNSUPPORTED = (what: string): ExecResult => ({
  ok: false,
  code: 'unsupported',
  reason: `${what} is not wired yet (section 5)`,
});

/** Construct the production editor. `config.document` (DOCX bytes) is loaded at construction. */
export function createEditor(config: EditorConfig): Editor {
  const { host } = config;

  // Minimal typed event bus for the four EditorEvents.
  type Handlers = { [E in keyof EditorEvents]: Set<EditorEvents[E]> };
  const handlers: Handlers = {
    change: new Set(),
    selectionChange: new Set(),
    display: new Set(),
    error: new Set(),
  };
  function emit<E extends keyof EditorEvents>(event: E, ...args: Parameters<EditorEvents[E]>): void {
    for (const fn of handlers[event]) (fn as (...a: unknown[]) => void)(...args);
  }

  let session: DocxEditorSession | null = null;
  let surface: EditSurface | null = null;
  let displayPages: readonly DisplayPage[] = [];
  let activeScope: ViewScope = { kind: 'body' };
  let destroyed = false;

  function relayoutAndPaint(): void {
    if (!session || destroyed) return;
    const layout = layoutBody(session.currentModel(), { ...LAYOUT, metrics: new HelveticaMetrics() });
    displayPages = toDisplayPages(layout.pages);
    host.onDisplay?.(displayPages);
    host.onTotalPages?.(displayPages.length);
    emit('display', displayPages);
  }

  // Called by the edit surface after every committed edit / undo / redo.
  function onModelChanged(): void {
    if (!session) return;
    relayoutAndPaint();
    emit('change', { revision: session.revision() });
  }

  function loadSource(source: DocumentSource): void {
    if (destroyed) return;
    let bytes: Uint8Array;
    try {
      bytes = sourceToBytes(source);
      session = openDocxSession(bytes);
    } catch (err) {
      emit('error', Object.assign(new Error(String((err as Error).message ?? err)), { code: 'parse' }));
      return;
    }
    surface?.destroy();
    surface = null;
    const bodyEl = host.getBodyHostEl();
    // The edit surface mounts into the adapter's body host; it may be null through first render, in
    // which case the document still lays out + paints and the surface mounts on a later load/relayout.
    if (bodyEl) surface = mountEditSurface(bodyEl, session, { onModelChanged });
    relayoutAndPaint();
  }

  if (config.document !== undefined) loadSource(config.document);

  const editor: Editor = {
    load: loadSource,
    async save(): Promise<ArrayBuffer> {
      if (!session) throw new Error('createEditor: no document loaded');
      return bytesToArrayBuffer(session.save());
    },
    getDocumentHandle(): DocumentHandle {
      return { revision: session?.revision() ?? 0 };
    },

    // ─── Commands / queries: wired feature-by-feature in section 5. ───────────
    exec(_command: EditorCommand): ExecResult {
      return UNSUPPORTED('command execution');
    },
    can(_command: EditorCommand): CanResult {
      return { ok: false, code: 'unsupported', reason: 'command execution is not wired yet (section 5)' };
    },
    setActiveScope(scope: ViewScope): void {
      activeScope = scope;
    },
    getActiveScope(): ViewScope {
      return activeScope;
    },
    query<K extends keyof EditorQueries>(query: { type: K } & EditorQueries[K]): EditorQueryResults[K] {
      // Neutral defaults so a consumer degrades gracefully until the query lands (section 5).
      const neutral: Record<string, unknown> = {
        selectedText: '',
        isInsideToc: false,
        trackedChanges: [],
      };
      return (query.type in neutral ? neutral[query.type as string] : null) as EditorQueryResults[K];
    },
    snapshot(): EditorSnapshot {
      return {
        scope: activeScope,
        isLoading: false,
        parseError: null,
        zoom: config.zoom ?? 1,
        selection: null,
        formatting: null,
        table: null,
        image: null,
        page: { current: 0, total: displayPages.length },
      };
    },

    getTotalPages: () => displayPages.length,
    getCurrentPage: () => 0, // viewport/caret current-page tracking is a follow-up (needs scroll wiring)

    // ─── Geometry: core owns layout; the adapter only paints what onDisplay delivers. ───
    getDisplay: () => displayPages,
    getSelectionRects: (_range?: EditorSelection): readonly Rect[] => [], // selection geometry: follow-up
    getCaretRect: (_pos?: EditorPosition): Rect | null => null,
    hitTest: (_point: Point) => null, // pointer→position mapping: follow-up (contract flat-pos model)
    getPageGeometry: () => displayPages.map((p) => ({ index: p.index, box: p.box })),
    getScrollGeometry() {
      const pageTops: number[] = [];
      let top = 0;
      for (const p of displayPages) {
        pageTops.push(top);
        top += p.box.height;
      }
      return { contentHeight: top, pageTops };
    },

    relayout: (_options?: { sync?: boolean }) => relayoutAndPaint(),
    focus: (_scope?: EditorScope) => surface?.focus(),
    destroy() {
      destroyed = true;
      surface?.destroy();
      surface = null;
      session = null;
      for (const set of Object.values(handlers)) set.clear();
    },

    on<E extends keyof EditorEvents>(event: E, handler: EditorEvents[E]): Unsubscribe {
      handlers[event].add(handler);
      return () => handlers[event].delete(handler);
    },
  };
  return editor;
}
