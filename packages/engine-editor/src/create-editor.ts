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

// Maps a minted DocumentHandle to a producer of its current bytes. Weak so a handle (and the bytes
// it can regenerate) is collectable once no caller holds it — no global document leak.
const handleBytes = new WeakMap<DocumentHandle, () => Uint8Array>();

const isArrayBuffer = (v: unknown): v is ArrayBuffer =>
  v instanceof ArrayBuffer || Object.prototype.toString.call(v) === '[object ArrayBuffer]';
// ArrayBuffer.isView catches Uint8Array cross-realm too (instanceof would miss another realm's).
const isBytesView = (v: unknown): v is ArrayBufferView => ArrayBuffer.isView(v);

function sourceToBytes(source: DocumentSource): Uint8Array {
  const producer = handleBytes.get(source as DocumentHandle);
  if (producer) return producer();
  if (isBytesView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  if (isArrayBuffer(source)) return new Uint8Array(source);
  throw new Error('createEditor: unrecognized DocumentSource (expected DOCX bytes or a handle from getDocumentHandle)');
}

function bytesToArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

const UNSUPPORTED = (what: string): ExecResult => ({
  ok: false,
  code: 'unsupported',
  reason: `${what} is not wired yet (section 5)`,
});

// Neutral, correctly-typed defaults for the not-yet-wired query surface: array queries must return
// [] (a consumer may .map/.filter), text '', booleans false, else null. Keeps a consumer working
// until the real query lands (section 5) instead of returning a wrongly-typed value that crashes.
const ARRAY_QUERIES = new Set(['trackedChanges', 'paragraphs', 'findText', 'contentControls', 'comments', 'styles', 'variables']);
const STRING_QUERIES = new Set(['selectedText']);
const BOOLEAN_QUERIES = new Set(['isInsideToc']);
function queryDefault(type: string): unknown {
  if (ARRAY_QUERIES.has(type)) return [];
  if (STRING_QUERIES.has(type)) return '';
  if (BOOLEAN_QUERIES.has(type)) return false;
  return null;
}

/** Construct the production editor. `config.document` (DOCX bytes or a handle) is loaded now. */
export function createEditor(config: EditorConfig): Editor {
  // Destructure ONCE so no long-lived closure retains `config` (and thus config.document bytes).
  const host = config.host;
  const readOnly = config.mode === 'view';
  const zoom = config.zoom ?? 1; // the adapter applies zoom on paint; carried in snapshot()

  type Handlers = { [E in keyof EditorEvents]: Set<EditorEvents[E]> };
  const handlers: Handlers = { change: new Set(), selectionChange: new Set(), display: new Set(), error: new Set() };
  function emit<E extends keyof EditorEvents>(event: E, ...args: Parameters<EditorEvents[E]>): void {
    for (const fn of handlers[event]) (fn as (...a: unknown[]) => void)(...args);
  }

  let session: DocxEditorSession | null = null;
  let surface: EditSurface | null = null;
  let displayPages: readonly DisplayPage[] = [];
  let handle: DocumentHandle | null = null;
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

  // Mount the edit surface if it is wanted (editable + not view-mode) and the host body element is
  // now available — the host may return null through first render, so this is retried on relayout.
  function ensureSurface(): void {
    if (destroyed || surface || readOnly || !session || !session.editable) return;
    const bodyEl = host.getBodyHostEl();
    if (bodyEl) surface = mountEditSurface(bodyEl, session, { onModelChanged });
  }

  // Called by the edit surface after every committed edit / undo / redo.
  function onModelChanged(): void {
    if (!session || destroyed) return;
    relayoutAndPaint();
    emit('change', { revision: session.revision() });
  }

  function loadSource(source: DocumentSource): void {
    if (destroyed) return;
    let next: DocxEditorSession;
    try {
      next = openDocxSession(sourceToBytes(source));
    } catch (err) {
      // Transactional: a parse failure keeps the current document intact.
      emit('error', Object.assign(new Error(String((err as Error)?.message ?? err)), { code: 'parse' }));
      return;
    }
    surface?.destroy();
    surface = null;
    session = next;
    // A stable handle for THIS document: live revision + a bytes producer registered weakly.
    const h: DocumentHandle = Object.defineProperty({} as DocumentHandle, 'revision', {
      enumerable: true,
      get: () => next.revision(),
    });
    handleBytes.set(h, () => next.save());
    handle = h;
    ensureSurface();
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
      return handle ?? { revision: 0 };
    },

    // ─── Commands / queries: wired feature-by-feature in section 5. ───────────
    exec: (_command: EditorCommand): ExecResult => UNSUPPORTED('command execution'),
    can: (_command: EditorCommand): CanResult => ({
      ok: false,
      code: 'unsupported',
      reason: 'command execution is not wired yet (section 5)',
    }),
    setActiveScope: (scope: ViewScope) => {
      activeScope = scope;
    },
    getActiveScope: () => activeScope,
    query<K extends keyof EditorQueries>(query: { type: K } & EditorQueries[K]): EditorQueryResults[K] {
      return queryDefault(query.type as string) as EditorQueryResults[K];
    },
    snapshot: (): EditorSnapshot => ({
      scope: activeScope,
      isLoading: false,
      parseError: null,
      zoom,
      selection: null,
      formatting: null,
      table: null,
      image: null,
      page: { current: 0, total: displayPages.length },
    }),

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

    relayout: (_options?: { sync?: boolean }) => {
      ensureSurface(); // a late-available host body element mounts here
      relayoutAndPaint();
    },
    focus: (_scope?: EditorScope) => surface?.focus(),
    destroy() {
      destroyed = true;
      surface?.destroy();
      surface = null;
      session = null;
      handle = null;
      displayPages = [];
      for (const set of Object.values(handlers)) set.clear();
    },

    on<E extends keyof EditorEvents>(event: E, handler: EditorEvents[E]): Unsubscribe {
      if (destroyed) return () => {}; // never repopulate handlers after teardown
      handlers[event].add(handler);
      return () => handlers[event].delete(handler);
    },
  };
  return editor;
}
