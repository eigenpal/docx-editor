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
import type {
  CaretGeometry,
  HitTestOptions,
  InteractionFrame,
  InteractionHostMetrics,
  InteractionOutcome,
  InteractionOutcomeCode,
  SelectionGeometry,
  SelectionGeometryOptions,
  SemanticHitTarget,
  SemanticPositionIndex,
  SemanticSelection,
  SemanticTarget,
  AccessibilityObservation,
} from '@docx-editor.dev/core-contract/interaction';
import {
  openDocxSession,
  mountEditSurface,
  type DocxEditorSession,
  type EditSurface,
  type InputHostViewport,
  markPaintedPagesPresentationOnly,
  clearPaintedPagesPresentationOnly,
  resolveAccessibilityNamePolicy,
  observeAccessibility,
} from '@docx-editor.dev/engine-binding';
import { createEmptyModel } from '@docx-editor.dev/engine-core';
import { layoutBody, HelveticaMetrics } from '@docx-editor.dev/engine-layout';
import { toDisplayPages } from './display-bridge.ts';
import { InteractionFrameStore, emptyInteractionFrame } from './interaction-frame.ts';
import { hitTestPointer, deriveCaretGeometry, deriveSelectionGeometry } from './interaction-geometry.ts';
import { contentToClient } from './coordinate-mapper.ts';
import { execErrorFromInteraction, invalidSetSelection, semanticSelectionFromCommand, unsupportedSetSelection } from './set-selection.ts';

// US Letter, 1in margins, in twips — the same geometry the read-only preview uses.
const LAYOUT = { pageWidth: 12240, pageHeight: 15840, margin: 1440 } as const;

// Maps a minted DocumentHandle to the SESSION it addresses, so load(handle) is a same-store hand-off
// (docx-editor-object-model: "attach ... to the same store without copying canonical state"), NOT a
// byte clone — edits in either editor are visible in the other. Weak, so a handle + its session are
// collectable once no caller holds the handle.
const handleSessions = new WeakMap<DocumentHandle, DocxEditorSession>();

const isArrayBuffer = (v: unknown): v is ArrayBuffer =>
  v instanceof ArrayBuffer || Object.prototype.toString.call(v) === '[object ArrayBuffer]';
// ArrayBuffer.isView catches Uint8Array cross-realm too (instanceof would miss another realm's).
const isBytesView = (v: unknown): v is ArrayBufferView => ArrayBuffer.isView(v);

function sourceToBytes(source: DocumentSource): Uint8Array {
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

// Neutral, correctly-typed defaults for the not-yet-wired query surface (matched to the contract
// result types): array queries return [] (a consumer may .map/.filter), object queries {}, text '',
// booleans false, else null. Keeps a consumer working until the real query lands (section 5) instead
// of returning a wrongly-typed value that crashes.
const ARRAY_QUERIES = new Set(['paragraphs', 'findText', 'contentControls', 'revisions', 'comments', 'trackedChanges']);
const STRING_QUERIES = new Set(['selectedText']);
const BOOLEAN_QUERIES = new Set(['isInsideToc']);
function queryDefault(type: string): unknown {
  if (ARRAY_QUERIES.has(type)) return [];
  if (STRING_QUERIES.has(type)) return '';
  if (BOOLEAN_QUERIES.has(type)) return false;
  if (type === 'styles') return { paragraph: new Map(), character: new Map(), table: new Map() }; // StyleDefinitions
  if (type === 'variables') return {}; // Record<string,string>
  return null;
}

/** Construct the production editor. `config.document` (DOCX bytes or a handle) is loaded now. */
export function createEditor(config: EditorConfig): Editor {
  // Destructure ONCE so no long-lived closure retains `config` (and thus config.document bytes).
  const host = config.host;
  const readOnly = config.mode === 'view';
  const zoom = config.zoom ?? 1; // the adapter applies zoom on paint; carried in snapshot()
  const accessibleNamePolicy = resolveAccessibilityNamePolicy(config.accessibleName);

  type Handlers = { [E in keyof EditorEvents]: Set<EditorEvents[E]> };
  const handlers: Handlers = { change: new Set(), selectionChange: new Set(), display: new Set(), error: new Set() };
  function emit<E extends keyof EditorEvents>(event: E, ...args: Parameters<EditorEvents[E]>): void {
    for (const fn of handlers[event]) (fn as (...a: unknown[]) => void)(...args);
  }

  let session: DocxEditorSession | null = null;
  let surface: EditSurface | null = null;
  let sharedUnsub: (() => void) | null = null; // store subscription for a live read-only shared view
  let mountedBodyEl: HTMLElement | null = null; // the element `surface` is bound to (host may swap it)
  let markedPagesContainer: HTMLElement | null = null;
  const frames = new InteractionFrameStore();
  let resourceEpoch = 0;
  const configurationEpoch = 0;
  let handle: DocumentHandle | null = null;
  // True when this editor adopted ANOTHER editor's store via a handle. Such an editor renders and
  // reads the shared store but does NOT mount its own edit surface: two independent PM surfaces on
  // one store would each hold a private snapshot and could overwrite each other's canonical
  // paragraphs. Cross-surface reconciliation is the deferred collaboration work; until then a
  // shared-handle editor is a read-only view (the originating editor keeps the single edit surface).
  let sharedView = false;
  let activeScope: ViewScope = { kind: 'body' };
  let destroyed = false;
  let layoutToken = 0;
  let cancelScheduledLayout: (() => void) | null = null;

  function currentFrame(): InteractionFrame {
    if (destroyed) return emptyInteractionFrame();
    return frames.getFrame() ?? emptyInteractionFrame();
  }

  function layoutInput(display: readonly DisplayPage[], semanticIndex: SemanticPositionIndex) {
    return {
      modelRevision: session!.revision(),
      resourceEpoch,
      configurationEpoch,
      display,
      semanticIndex,
      selection: null,
      caret: null,
      selectionGeometry: null,
      focus: { scope: activeScope, focused: false },
      composition: { active: false, scope: null },
      currentPage: { viewport: 0, caret: 0 },
    };
  }

  function caretClientRect(frame = currentFrame()): Rect | null {
    if (!frame.caret) return null;
    const metrics = host.getInteractionHostMetrics?.();
    if (!metrics) return null;
    const origin = contentToClient({ x: frame.caret.rect.x, y: frame.caret.rect.y }, metrics);
    if (!origin.ok) return null;
    return {
      x: origin.value.x,
      y: origin.value.y,
      width: frame.caret.rect.width,
      height: frame.caret.rect.height,
    };
  }

  function inputHostViewport(): InputHostViewport | undefined {
    const scroll = host.getScrollContainer?.();
    if (!scroll) return undefined;
    const rect = scroll.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  function updateInputHostFromFrame(): void {
    if (!surface?.semanticProjectionAttached || !surface.interactionAuthorized) return;
    const frame = currentFrame();
    surface.updateInputHostPlacement({
      frameId: frame.id,
      activeFrameId: frame.id,
      caretClientRect: caretClientRect(frame),
      pendingLayout: frame.completeness.kind === 'pending',
      readOnly: readOnly || !session?.editable,
      viewport: inputHostViewport(),
    });
  }

  function syncPaintedPagesAssistivePolicy(): void {
    const pagesContainer = host.getPagesContainer?.() ?? null;
    if (markedPagesContainer && markedPagesContainer !== pagesContainer) {
      clearPaintedPagesPresentationOnly(markedPagesContainer);
      markedPagesContainer = null;
    }
    if (!pagesContainer) return;
    if (surface?.semanticProjectionAttached) {
      markPaintedPagesPresentationOnly(pagesContainer);
      markedPagesContainer = pagesContainer;
      return;
    }
    if (markedPagesContainer === pagesContainer) {
      clearPaintedPagesPresentationOnly(pagesContainer);
      markedPagesContainer = null;
    }
  }

  function clearPaintedPagesAssistivePolicy(): void {
    if (!markedPagesContainer) return;
    clearPaintedPagesPresentationOnly(markedPagesContainer);
    markedPagesContainer = null;
  }

  function emitLayoutFrame(frame: InteractionFrame): void {
    host.onDisplay?.(frame.display);
    host.onTotalPages?.(frame.display.length);
    emit('display', frame.display);
    syncPaintedPagesAssistivePolicy();
    updateInputHostFromFrame();
  }

  function completeLayoutPublication(token: number, pendingTarget?: number): void {
    if (destroyed || token !== layoutToken || !session) return;
    const layout = layoutBody(session.currentModel(), { ...LAYOUT, metrics: new HelveticaMetrics() });
    const bridged = toDisplayPages(session.currentModel(), layout.pages);
    const input = layoutInput(bridged.display, bridged.semanticIndex);
    const frame =
      pendingTarget !== undefined
        ? frames.tryCompletePendingLayout(input) ?? null
        : frames.publishLayout(input);
    if (!frame) return;
    emitLayoutFrame(frame);
  }

  function cancelScheduledLayoutWork(): void {
    layoutToken += 1;
    cancelScheduledLayout?.();
    cancelScheduledLayout = null;
  }

  function relayoutAndPaint(sync = true): void {
    if (!session || destroyed) return;
    if (!sync) {
      const targetRevision = session.revision();
      frames.beginPendingLayout(targetRevision);
      cancelScheduledLayoutWork();
      const token = layoutToken;
      cancelScheduledLayout = host.scheduleFrame(() => {
        cancelScheduledLayout = null;
        completeLayoutPublication(token, targetRevision);
      });
      return;
    }
    cancelScheduledLayoutWork();
    completeLayoutPublication(layoutToken);
  }

  // Mount the semantic projection when the host body element is available. Editable documents
  // authorize input; read-only/view/shared-handle policies choose read-only or no projection.
  function ensureSurface(): void {
    if (destroyed || sharedView || !session) return;
    const bodyEl = host.getBodyHostEl();
    if (!bodyEl) return;
    if (surface && bodyEl === mountedBodyEl) return;
    if (surface) surface.destroy();
    surface = mountEditSurface(bodyEl, session, {
      onModelChanged,
      accessibleName: config.accessibleName,
      accessibilityAtomLabels: config.accessibilityAtomLabels,
      readOnlyProjection: readOnly || !session.editable,
    });
    mountedBodyEl = bodyEl;
    updateInputHostFromFrame();
    syncPaintedPagesAssistivePolicy();
  }

  function rejectPointer(
    code: InteractionOutcomeCode,
    reason: string,
    frameId?: InteractionFrame['id'],
  ): InteractionOutcome<SemanticHitTarget> {
    return frameId ? { ok: false, code, reason, frameId } : { ok: false, code, reason };
  }

  function resolveHostMetrics(options?: HitTestOptions): InteractionHostMetrics | undefined {
    if (options?.hostMetrics) return options.hostMetrics;
    return host.getInteractionHostMetrics?.() ?? undefined;
  }

  function resolvePointer(point: Point, options?: HitTestOptions): InteractionOutcome<SemanticHitTarget> {
    const frame = currentFrame();
    if (options?.frameId && options.frameId.value !== frame.id.value) {
      return rejectPointer('staleFrame', 'pointer request targets a superseded interaction frame', frame.id);
    }
    if (frame.completeness.kind === 'pending') {
      return rejectPointer('pendingLayout', 'layout for the current model revision is not yet published', frame.id);
    }
    return hitTestPointer(frame, point, resolveHostMetrics(options), { frameId: options?.frameId });
  }
  function onModelChanged(): void {
    if (!session || destroyed) return;
    relayoutAndPaint(true);
    emit('change', { revision: session.revision() });
  }

  function loadSource(source: DocumentSource): void {
    if (destroyed) return;
    let next: DocxEditorSession;
    const shared = handleSessions.get(source as DocumentHandle);
    if (shared) {
      next = shared; // same-store hand-off from another editor's handle (no re-parse, no clone)
      sharedView = true; // read-only view of the shared store (see `sharedView`)
    } else {
      try {
        next = openDocxSession(sourceToBytes(source));
      } catch (err) {
        // Transactional: a parse failure keeps the current document intact.
        emit('error', Object.assign(new Error(String((err as Error)?.message ?? err)), { code: 'parse' }));
        return;
      }
      sharedView = false;
    }
    surface?.destroy();
    surface = null;
    mountedBodyEl = null;
    sharedUnsub?.();
    sharedUnsub = null;
    session = next;
    // A read-only shared view has no surface of its own, so subscribe to the shared store to repaint
    // when the OWNING editor commits — a live view, not a stale snapshot.
    if (sharedView) {
      sharedUnsub = next.subscribe(() => {
        relayoutAndPaint();
        emit('change', { revision: next.revision() });
      });
    }
    // A stable handle for THIS document: live revision + the SESSION registered weakly, so another
    // editor loading the handle shares this exact store.
    const h: DocumentHandle = Object.defineProperty({} as DocumentHandle, 'revision', {
      enumerable: true,
      get: () => next.revision(),
    });
    handleSessions.set(h, next);
    handle = h;
    ensureSurface();
    relayoutAndPaint();
  }

  if (config.document !== undefined) loadSource(config.document);

  function execSetSelection(command: Extract<EditorCommand, { type: 'setSelection' }>): ExecResult {
    if (destroyed) return unsupportedSetSelection('editor is destroyed');
    if (readOnly || sharedView || !session?.editable) {
      return { ok: false, code: 'locked', reason: 'setSelection rejected because the editor is read-only' };
    }
    if (!surface?.semanticProjectionAttached) {
      return unsupportedSetSelection('edit surface is not mounted');
    }
    if (activeScope.kind !== 'body') {
      return unsupportedSetSelection('setSelection is supported for body scope only');
    }
    const frame = currentFrame();
    if (frame.completeness.kind === 'pending') {
      return { ok: false, code: 'unsupported', reason: 'layout for the current model revision is not yet published' };
    }
    const selection = semanticSelectionFromCommand(command, frame.id, activeScope);
    if (!selection) return invalidSetSelection('setSelection requires semantic targets in the active scope');
    const outcome = surface.syncSemanticSelection({ frameId: frame.id, selection });
    if (!outcome.ok) return { ok: false, code: execErrorFromInteraction(outcome.code), reason: outcome.reason };
    return { ok: true, changed: false };
  }

  function canSetSelection(command: Extract<EditorCommand, { type: 'setSelection' }>): CanResult {
    if (destroyed) return { ok: false, code: 'unsupported', reason: 'editor is destroyed' };
    if (readOnly || sharedView || !session?.editable) {
      return { ok: false, code: 'locked', reason: 'setSelection rejected because the editor is read-only' };
    }
    if (!surface?.semanticProjectionAttached) {
      return { ok: false, code: 'unsupported', reason: 'edit surface is not mounted' };
    }
    if (activeScope.kind !== 'body') {
      return { ok: false, code: 'unsupported', reason: 'setSelection is supported for body scope only' };
    }
    if (currentFrame().completeness.kind === 'pending') {
      return { ok: false, code: 'unsupported', reason: 'layout for the current model revision is not yet published' };
    }
    const selection = semanticSelectionFromCommand(command, currentFrame().id, activeScope);
    if (!selection) return { ok: false, code: 'invalidArgs', reason: 'setSelection requires semantic targets in the active scope' };
    return { ok: true };
  }

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
    exec(command: EditorCommand): ExecResult {
      if (command.type === 'setSelection') return execSetSelection(command);
      return UNSUPPORTED('command execution');
    },
    can(command: EditorCommand): CanResult {
      if (command.type === 'setSelection') return canSetSelection(command);
      return {
        ok: false,
        code: 'unsupported',
        reason: 'command execution is not wired yet (section 5)',
      };
    },
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
      editable: !readOnly && !sharedView && session?.editable === true,
      zoom,
      selection: null,
      formatting: null,
      table: null,
      image: null,
      page: { current: currentFrame().currentPage.viewport, total: currentFrame().display.length },
    }),

    getTotalPages: () => currentFrame().display.length,
    getCurrentPage: (mode = 'viewport') =>
      mode === 'caret' ? currentFrame().currentPage.caret : currentFrame().currentPage.viewport,

    getInteractionFrame: () => currentFrame(),

    getDisplay: () => currentFrame().display,
    getSelectionRects: (range?: EditorSelection, options?: SelectionGeometryOptions): readonly Rect[] => {
      const frame = currentFrame();
      const selection =
        range && typeof range === 'object' && 'anchor' in range && 'head' in range
          ? (range as SemanticSelection)
          : frame.selection;
      if (!selection) return [];
      const outcome = deriveSelectionGeometry(frame, selection, options);
      return outcome.ok ? outcome.value.rects : [];
    },
    getCaretRect: (pos?: EditorPosition): Rect | null => {
      const target = pos && typeof pos === 'object' && 'kind' in pos ? (pos as SemanticTarget) : undefined;
      return deriveCaretGeometry(currentFrame(), target)?.rect ?? null;
    },
    getCaretGeometry: (pos?: EditorPosition): CaretGeometry | null => {
      const target = pos && typeof pos === 'object' && 'kind' in pos ? (pos as SemanticTarget) : undefined;
      return deriveCaretGeometry(currentFrame(), target);
    },
    getSelectionGeometry: (range?: EditorSelection, options?: SelectionGeometryOptions): SelectionGeometry | null => {
      const frame = currentFrame();
      const selection =
        range && typeof range === 'object' && 'anchor' in range && 'head' in range
          ? (range as SemanticSelection)
          : frame.selection;
      if (!selection) return null;
      const outcome = deriveSelectionGeometry(frame, selection, options);
      return outcome.ok ? outcome.value : null;
    },
    hitTest: (_point: Point, options?: HitTestOptions): SemanticHitTarget | null => {
      const outcome = resolvePointer(_point, options);
      return outcome.ok ? outcome.value : null;
    },
    resolvePointer,
    getAccessibilityObservation: (): AccessibilityObservation => {
      const frame = currentFrame();
      const scope = activeScope;
      if (surface?.semanticProjectionAttached) {
        return surface.getAccessibilityObservation({ frameId: frame.id, scope });
      }
      return observeAccessibility({
        frameId: frame.id,
        scope,
        modelRevision: session?.revision() ?? 0,
        editable: !readOnly && !sharedView && session?.editable === true,
        name: accessibleNamePolicy,
        focus: { scope: null, focused: false },
        selectionRange: null,
        atomicObjectId: null,
        model: session?.currentModel() ?? createEmptyModel(),
        owner: 'none',
        paintedPagesAssistiveRole: null,
      });
    },
    getPageGeometry: () => currentFrame().pageGeometry,
    getScrollGeometry: () => currentFrame().scrollGeometry,

    relayout: (options?: { sync?: boolean }) => {
      ensureSurface();
      relayoutAndPaint(options?.sync !== false);
    },
    focus: (_scope?: EditorScope): InteractionOutcome<void> => {
      if (destroyed) {
        return { ok: false, code: 'unsupported', reason: 'editor is destroyed' };
      }
      if (readOnly || sharedView || !session?.editable) {
        return { ok: false, code: 'readOnly', reason: 'editor is read-only' };
      }
      if (!surface) {
        return { ok: false, code: 'unsupported', reason: 'edit surface is not mounted' };
      }
      return surface.focus({ frameId: currentFrame().id });
    },
    destroy() {
      // Detach THIS editor's projection/host resources; an externally owned (shared-handle) session
      // is NOT disposed here — the handle keeps the store alive for any other editor holding it.
      destroyed = true;
      cancelScheduledLayoutWork();
      frames.cancelPendingLayout();
      clearPaintedPagesAssistivePolicy();
      surface?.destroy();
      surface = null;
      mountedBodyEl = null;
      sharedUnsub?.();
      sharedUnsub = null;
      session = null;
      handle = null;
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
