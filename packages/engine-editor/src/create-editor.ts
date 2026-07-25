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
  TextMatch,
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
  InteractionIntent,
  InteractionDispatchResult,
  SelectionGeometry,
  SelectionGeometryOptions,
  SemanticHitTarget,
  SemanticPositionIndex,
  SemanticSelection,
  SemanticTarget,
  AccessibilityObservation,
  InputHostObservation,
  FocusObservation,
  CompositionObservation,
} from '@docx-editor.dev/core-contract/interaction';
import {
  openDocxSession,
  mountEditSurface,
  type DocxEditorSession,
  type EditSurface,
  type EditSurfaceCommand,
  type InputHostViewport,
  markPaintedPagesPresentationOnly,
  clearPaintedPagesPresentationOnly,
  resolveAccessibilityNamePolicy,
  observeAccessibility,
} from '@docx-editor.dev/engine-binding';
import { createEmptyModel, bodyStoryId } from '@docx-editor.dev/engine-core';
import { layoutBody, HelveticaMetrics } from '@docx-editor.dev/engine-layout';
import { toDisplayPages } from './display-bridge.ts';
import { InteractionFrameStore, emptyInteractionFrame } from './interaction-frame.ts';
import type { NavigationGeometry } from './navigation-geometry.ts';
import { hitTestPointer, deriveCaretGeometry, deriveSelectionGeometry } from './interaction-geometry.ts';
import { clientToContent, contentToClient } from './coordinate-mapper.ts';
import { execErrorFromInteraction, invalidSetSelection, semanticSelectionFromCommand, unsupportedSetSelection } from './set-selection.ts';
import {
  planInteraction,
  resolveSelectionAgainstCanonicalState,
  type PlannedInteraction,
} from './interaction-planner.ts';
import { executeInteractionPlan } from './interaction-executor.ts';
import { planPointerDragInteraction, type PointerDragSession } from './drag-session.ts';
import { commitDragSessionAfterExecution } from './drag-dispatch.ts';
import { commitNavigationSessionAfterExecution, type NavigationSession } from './navigation-session.ts';
import { paragraphTextById, withCanonicalAffinity } from './semantic-index.ts';
import { scopesEqual, type ParagraphTextResolver } from './bidi-policy.ts';

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
  // Engine-owned so the paint scale and the factor hit testing divides by are the same
  // number. A host reads it back through `getZoom()` rather than holding its own copy.
  let zoom = config.zoom ?? 1;
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
  let dragSession: PointerDragSession | null = null;
  let scrollTrackingAttached = false;
  let detachScrollTracking: (() => void) | null = null;
  let navigationSession: NavigationSession | null = null;
  let documentGeneration = 0;

  function currentFrame(): InteractionFrame {
    if (destroyed) return emptyInteractionFrame();
    return frames.getFrame() ?? emptyInteractionFrame();
  }

  function layoutInput(
    display: readonly DisplayPage[],
    semanticIndex: SemanticPositionIndex,
    navigationGeometry: NavigationGeometry,
  ) {
    return {
      modelRevision: session!.revision(),
      resourceEpoch,
      configurationEpoch,
      display,
      semanticIndex,
      navigationGeometry,
      selection: null,
      caret: null,
      selectionGeometry: null,
      focus: { scope: activeScope, focused: false },
      composition: compositionObservation(),
      currentPage: { viewport: 0, caret: 0 },
    };
  }

  /**
   * Live IME composition state from the surface.
   *
   * This was hardcoded to `{ active: false, scope: null }` and
   * `surface.getCompositionObservation()` was never called, so `frame.composition`
   * — and therefore the public `EditorDriver.compositionState()` — was a constant
   * lie. Independent review measured the consequence: with a composition live in
   * one paragraph, ArrowDown was accepted, returned `ok: true`, and moved the
   * painted caret to a DIFFERENT paragraph while the IME kept composing in the
   * original one. Nothing could refuse it, because no layer could see that a
   * composition was active.
   */
  function compositionObservation(): CompositionObservation {
    return surface?.getCompositionObservation() ?? { active: false, scope: null };
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

  /** See `getCurrentPage`. Derived on demand rather than published per scroll frame. */
  function viewportPage(): number {
    const frame = currentFrame();
    const pages = frame.pageGeometry;
    if (pages.length === 0) return frame.currentPage.viewport;
    const scroll = host.getScrollContainer?.();
    const metrics = host.getInteractionHostMetrics?.();
    if (!scroll || !metrics) return frame.currentPage.viewport;
    const rect = scroll.getBoundingClientRect();
    const midpoint = clientToContent({ x: rect.x, y: rect.y + rect.height / 2 }, metrics);
    if (!midpoint.ok) return frame.currentPage.viewport;
    const y = midpoint.value.y;
    for (let i = 0; i < pages.length; i += 1) {
      // Past this page's bottom means the midpoint is either inside it or in the gap
      // above it; both read as this page.
      if (y < pages[i]!.box.y + pages[i]!.box.height) return i;
    }
    return pages.length - 1;
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

  /**
   * Build a public snapshot. Hoisted out of the `Editor` literal so the
   * `selectionChange` event can carry one.
   */
  function buildSnapshot(): EditorSnapshot {
    return {
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
    };
  }

  function publishSelectionOverlay(selection: SemanticSelection, focus: FocusObservation): void {
    if (!session) return;
    const base = currentFrame();
    // Normalize affinity HERE, at the single point where a selection becomes part of
    // a published frame, rather than at each producer.
    //
    // The first attempt normalized at two call sites and missed the rest: round-4
    // review measured a plain click in inter-word whitespace still publishing a
    // non-canonical affinity, which left the caret painted but Home, End, PageUp,
    // PageDown, ArrowUp and ArrowDown all refused. Every producer — click,
    // shift-click, double and triple click, drag, keyboard navigation, the
    // executor's own publish callback, `exec({setSelection})` — funnels through this
    // function, so normalizing once here cannot be bypassed by a new producer, and
    // no future caller has to remember.
    const selectionForFrame: SemanticSelection = {
      ...selection,
      frameId: base.id,
      anchor: canonicalAffinityFor(base, selection.anchor),
      head: canonicalAffinityFor(base, selection.head),
    };
    const caret = deriveCaretGeometry(base, selectionForFrame.head);
    const selectionGeometryOutcome = deriveSelectionGeometry(base, selectionForFrame);
    const selectionGeometry = selectionGeometryOutcome.ok ? selectionGeometryOutcome.value : null;
    const caretPage = caret?.pageIndex ?? base.currentPage.caret;
    frames.publishSelection({
      modelRevision: session.revision(),
      layoutRevision: base.revisions.layoutRevision,
      selection: selectionForFrame,
      caret,
      selectionGeometry,
      focus,
      composition: compositionObservation(),
      currentPage: { viewport: base.currentPage.viewport, caret: caretPage },
    });
    // Emit `selectionChange`.
    //
    // Round-5 review found this event had FOUR subscribers and ZERO emitters, and
    // the consequence was severe: `layoutInput` seeds a frame with
    // `selection: null, caret: null, focus: { focused: false }` and `emitLayoutFrame`
    // fires `display` from THAT frame, so an adapter repaints with no caret. This
    // function then restores selection, focus, and caret — but emitted nothing, so
    // nothing told the adapter to repaint the overlay layer. Measured: click a glyph
    // (caret painted), `relayout()` or any zoom change, and the painted caret is
    // gone permanently while `frame.caret` is non-null and `focus.focused` is true.
    // Both adapters. `verify:real-adapter-gate`'s zoom scenario stayed green because
    // it inspects `getInputHostObservation()` and never the painted caret.
    emit('selectionChange', buildSnapshot());
    // Tell the surface its retained selection is current on the frame we just
    // published. Without this the retained tag is stale the instant we publish, and
    // `focus({ frameId: currentFrame().id })` — the only frame id a caller can
    // legitimately hold — always fails the surface's stale-frame check.
    surface?.retainSelectionOnFrame(currentFrame().id);
    updateInputHostFromFrame();
  }

  /**
   * Re-stamp an observed endpoint with the affinity the caret-stop index publishes
   * for its offset. The edit surface cannot know affinity (no line geometry), so it
   * reports a constant; the index is the authority.
   */
  function canonicalAffinityFor(frame: InteractionFrame, target: SemanticTarget): SemanticTarget {
    return withCanonicalAffinity(target, (blockId) => {
      for (const story of frame.semanticIndex.stories) {
        const block = story.blocks.find((b) => b.identity.blockId === blockId);
        if (block) return block.graphemeCount;
      }
      return undefined;
    });
  }

  function reconcileSelectionOverlayAfterLayout(): void {
    if (!surface?.semanticProjectionAttached || !session) {
      updateInputHostFromFrame();
      return;
    }
    const frame = currentFrame();
    const obs = surface.getAccessibilityObservation({ frameId: frame.id, scope: activeScope });
    if (!obs.selection) {
      updateInputHostFromFrame();
      return;
    }
    const selection: SemanticSelection = {
      frameId: frame.id,
      scope: obs.scope,
      anchor: canonicalAffinityFor(frame, obs.selection.anchor),
      head: canonicalAffinityFor(frame, obs.selection.head),
    };
    // Publish even when caret geometry is unavailable.
    //
    // This used to bail here, and the consequence was severe: after a single
    // keystroke `deriveCaretGeometry` can fail at the position adjacent to the
    // freshly split run, so nothing was published and the frame kept the layout
    // seed's `selection: null, focus: { focused: false }`. The authority was fine
    // throughout — the accessibility observation still reported focused with a
    // live head — but every subsequent geometry key was refused with "requires a
    // focused interaction frame", and once refused keys stopped falling through
    // to ProseMirror the caret became immovable until the user clicked again.
    //
    // A missing caret RECTANGLE means "paint no caret", never "discard the
    // selection and focus". `publishSelectionOverlay` already tolerates a null
    // caret, and `overlaysForFrame` paints one only for a focused frame, so the
    // worst case is an unpainted caret rather than a dead keyboard.
    publishSelectionOverlay(selection, obs.focus);
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
    reconcileSelectionOverlayAfterLayout();
  }

  function completeLayoutPublication(token: number, pendingTarget?: number): void {
    if (destroyed || token !== layoutToken || !session) return;
    const metrics = new HelveticaMetrics();
    const layout = layoutBody(session.currentModel(), { ...LAYOUT, metrics });
    const bridged = toDisplayPages(session.currentModel(), layout.pages, metrics);
    const input = layoutInput(bridged.display, bridged.semanticIndex, bridged.navigationGeometry);
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
      // Republish so `frame.composition` and the public
      // `EditorDriver.compositionState()` reflect a live composition instead of a
      // constant `{ active: false }`. Selection and focus are carried through
      // unchanged; only the composition field differs.
      // PM moved its own selection (arrows, Select All, word jumps). Re-read the
      // observation and republish, so the painted caret follows the real insertion
      // point rather than the last committed one.
      onSelectionChanged: () => {
        reconcileSelectionOverlayAfterLayout();
      },
      onCompositionChange: () => {
        const frame = currentFrame();
        if (frame.selection) publishSelectionOverlay(frame.selection, frame.focus);
      },
      accessibleName: config.accessibleName,
      accessibilityAtomLabels: config.accessibilityAtomLabels,
      readOnlyProjection: readOnly || !session.editable,
    });
    mountedBodyEl = bodyEl;
    updateInputHostFromFrame();
    trackScrollForInputHost();
    syncPaintedPagesAssistivePolicy();
  }

  // Scrolling moves the caret in CLIENT space without changing the selection or
  // the layout, so nothing else re-places the input host and it drifts away from
  // the caret — taking the browser's IME and autofill UI with it. The engine
  // owns input-host policy, so it watches the scroll container itself rather
  // than making every adapter remember to.
  /**
   * Re-place the input host whenever the caret moves in CLIENT space.
   *
   * This used to attach a `scroll` listener to `host.getScrollContainer()` alone,
   * which covered exactly one of the ways a viewport moves. Independent review
   * measured the gap: `window.scrollTo(0, 300)` left the clip shell 300px from the
   * caret in React and 400px in Vue, while `getInputHostObservation()` still
   * reported `placementReason: 'applied'` — so the public observation asserted a
   * correct placement that was hundreds of pixels wrong, taking the browser's IME
   * candidate window, autofill, and virtual keyboard with it.
   *
   * A single capture-phase listener on the document replaces per-element tracking:
   * `scroll` does not bubble, but it does propagate along the CAPTURE path, so this
   * sees every scrollable ancestor including the document scrolling element,
   * without the engine having to know which element scrolls. `resize` and the
   * `visualViewport` events cover window resize and mobile pinch-zoom / on-screen
   * keyboard, which move the caret in client space without any scroll at all.
   */
  function trackScrollForInputHost(): void {
    if (scrollTrackingAttached) return;
    const doc = host.getBodyHostEl?.()?.ownerDocument ?? globalThis.document;
    if (!doc) return;
    const win = doc.defaultView;
    const onViewportChange = (): void => updateInputHostFromFrame();
    doc.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
    win?.addEventListener('resize', onViewportChange, { passive: true });
    const visual = win?.visualViewport ?? null;
    visual?.addEventListener('scroll', onViewportChange, { passive: true });
    visual?.addEventListener('resize', onViewportChange, { passive: true });
    scrollTrackingAttached = true;
    detachScrollTracking = () => {
      doc.removeEventListener('scroll', onViewportChange, { capture: true } as EventListenerOptions);
      win?.removeEventListener('resize', onViewportChange);
      visual?.removeEventListener('scroll', onViewportChange);
      visual?.removeEventListener('resize', onViewportChange);
      scrollTrackingAttached = false;
      detachScrollTracking = null;
    };
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
    navigationSession = null;
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
    documentGeneration += 1;
    dragSession = null;
    navigationSession = null;
    cancelScheduledLayoutWork();
    frames.cancelPendingLayout();
    frames.clearNavigationSidecar();
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

  /**
   * Map a public editor command onto the PM-free edit-surface command
   * vocabulary (interactive-paginated-editing M4.0). Returns null for commands
   * the surface does not speak, which stay `unsupported`.
   */
  function editSurfaceCommandFor(command: EditorCommand): EditSurfaceCommand | null {
    if (command.type === 'undo') return { kind: 'undo' };
    if (command.type === 'redo') return { kind: 'redo' };
    if (command.type === 'toggleMark') return { kind: 'toggleMark', mark: command.mark };
    return null;
  }

  function runSurfaceCommand(command: EditSurfaceCommand, dryRun: boolean): ExecResult {
    if (destroyed) return { ok: false, code: 'unsupported', reason: 'editor is destroyed' };
    if (!surface) {
      return { ok: false, code: 'unsupported', reason: 'edit surface is not mounted' };
    }
    const result = surface.runEditCommand(command, { dryRun });
    if (!result.ok) {
      return { ok: false, code: result.code === 'readOnly' ? 'locked' : 'unsupported', reason: result.reason };
    }
    return { ok: true, changed: result.changed };
  }

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
    // The public setSelection surface must re-resolve against canonical state
    // like every other path to the store's selection. Without this it reached
    // `graphemeOffsetToUtf16`, which CLAMPS: offset 9999 on a 13-grapheme
    // paragraph returned ok:true with the head silently relocated to 13, so the
    // next keystroke edited text the caller never pointed at. Refuse, never
    // clamp (task 5.7a).
    const staleOrInvalid = resolveSelectionAgainstCanonicalState(frame, selection);
    if (staleOrInvalid && staleOrInvalid.kind === 'reject') {
      return { ok: false, code: execErrorFromInteraction(staleOrInvalid.code), reason: staleOrInvalid.reason };
    }
    // A partially editable document locks INDIVIDUAL blocks, and the canonical selection
    // must not move into one. The `session.editable` check above is document-wide, so on a
    // partial document this returned ok for a locked paragraph: the frame's selection
    // moved in, while the accessibility observation reported no selection and the reverse
    // mapper refused every keystroke that followed. Refusing here keeps the two public
    // observations telling the same story.
    for (const end of [selection.anchor, selection.head]) {
      const blockId = (end as { identity?: { blockId?: string } }).identity?.blockId;
      if (blockId && session.readOnlyBlockIds.has(blockId)) {
        return { ok: false, code: 'locked', reason: `setSelection rejected: block ${blockId} is read-only` };
      }
    }
    const outcome = surface.syncSemanticSelection({ frameId: frame.id, selection });
    if (!outcome.ok) return { ok: false, code: execErrorFromInteraction(outcome.code), reason: outcome.reason };
    // Publish the frame too.
    //
    // This moved the REAL insertion point and returned ok while publishing nothing,
    // so the painted caret stayed where it was. Round-6 review measured
    // `frame.selection` and `caret.rect.x` unchanged with zero emissions while the
    // surface correctly reported the new range — and then one keystroke turned
    // "primera linea" into "pZra linea": the caret was painted at offset 2 while Z
    // replaced graphemes 1-5.
    //
    // It also falsified the comment on `publishSelectionOverlay` claiming every
    // producer funnels through it, `exec({setSelection})` included. Now it does.
    //
    // The existing test masked it by calling `editor.focus()` between `exec` and its
    // assertions — the one operation that repairs the frame — and then asserting only
    // on `getAccessibilityObservation()`, never on `getInteractionFrame()`.
    publishSelectionOverlay(selection, { scope: activeScope, focused: currentFrame().focus.focused });
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
    const frame = currentFrame();
    const selection = semanticSelectionFromCommand(command, frame.id, activeScope);
    if (!selection) return { ok: false, code: 'invalidArgs', reason: 'setSelection requires semantic targets in the active scope' };
    // `can` must answer the same question `exec` will. Re-review measured this
    // returning ok:true for the four inputs exec refuses — offset 9999, -5, 1.5,
    // and a superseded frameId — so a caller that gates on `can` was told yes and
    // then refused. A `can` that lies is worse than no `can`.
    const staleOrInvalid = resolveSelectionAgainstCanonicalState(frame, selection);
    if (staleOrInvalid && staleOrInvalid.kind === 'reject') {
      return { ok: false, code: execErrorFromInteraction(staleOrInvalid.code), reason: staleOrInvalid.reason };
    }
    return { ok: true };
  }

  function dispatchInteraction(
    intent: InteractionIntent,
    options?: { hostMetrics?: InteractionHostMetrics },
  ): InteractionDispatchResult {
    if (destroyed) {
      return {
        outcome: { ok: false, code: 'unsupported', reason: 'editor is destroyed' },
        hostEffects: [],
      };
    }
    const frame = currentFrame();
    const hostMetrics = options?.hostMetrics ?? host.getInteractionHostMetrics?.() ?? undefined;
    const plannerBase = {
      frame,
      editable: !readOnly && !sharedView && session?.editable === true,
      readOnly: readOnly || sharedView || !session?.editable,
      hostMetrics,
      modelRevision: session?.revision() ?? frame.revisions.modelRevision,
      activeScope,
      navigationSession,
      documentGeneration,
      resolveParagraphText: ((identity, scope) =>
        session && scopesEqual(scope, activeScope)
          ? paragraphTextById(session.currentModel(), identity.blockId, identity.storyId)
          : '') satisfies ParagraphTextResolver,
      navigationGeometry: frames.getNavigationGeometry(frame.id),
      // Live, not `frame.composition`: the frame was published before the
      // composition started, so its snapshot is stale exactly when it matters.
      compositionActive: compositionObservation().active,
    };
    const dragKinds = new Set(['pointerDown', 'pointerMove', 'pointerUp', 'pointerCancel']);
    let planned: PlannedInteraction;
    let dragPlanResult;
    if (dragKinds.has(intent.kind)) {
      dragPlanResult = planPointerDragInteraction(
        { ...plannerBase, modelRevision: session?.revision() ?? frame.revisions.modelRevision },
        intent as Parameters<typeof planPointerDragInteraction>[1],
        dragSession,
      );
      planned = dragPlanResult.plan;
    } else {
      planned = planInteraction(plannerBase, intent);
    }
    const execution = executeInteractionPlan(
      {
        syncSemanticSelection: (request) => {
          if (!surface?.semanticProjectionAttached) {
            return {
              ok: false,
              code: 'unsupported',
              reason: 'edit surface is not mounted',
              frameId: request.frameId,
            };
          }
          if (activeScope.kind !== 'body') {
            return {
              ok: false,
              code: 'unsupported',
              reason: 'semantic selection sync is supported for body scope only',
              frameId: request.frameId,
            };
          }
          return surface.syncSemanticSelection(request);
        },
        focus: (request) => {
          if (!surface) {
            return { ok: false, code: 'unsupported', reason: 'edit surface is not mounted', frameId: request.frameId };
          }
          return surface.focus({ frameId: request.frameId });
        },
        blur: () => {
          surface?.blur();
          // Republish focus so the frame stops asserting focus.
          //
          // This used to call `surface.blur()` and nothing else, so `frame.focus`
          // kept its last value. Independent review measured the result: click a
          // glyph, then click the shell's document-title input, and the frame still
          // reported `focused: true` with a blinking caret painted on the page while
          // every keystroke went to the title field — the visible caret disagreeing
          // with the real insertion point, which is the exact state the interaction
          // frame exists to make impossible.
          //
          // The selection is retained, not discarded: blur moves input focus away,
          // it does not unmake the selection, and `overlaysForFrame` paints a caret
          // only for a focused frame.
          const frame = currentFrame();
          if (frame.selection) {
            publishSelectionOverlay(frame.selection, { scope: activeScope, focused: false });
          }
        },
        execCommand: (command) => {
          if (command.type === 'setSelection') return execSetSelection(command);
          return UNSUPPORTED('command execution');
        },
        delegateNativeInput: (request) => {
          if (!surface) {
            return { ok: false, code: 'unsupported', reason: 'edit surface is not mounted', frameId: request.frameId };
          }
          return surface.focus({ frameId: request.frameId });
        },
        publishSelectionOverlay: (selection) => {
          const focus = currentFrame().focus;
          publishSelectionOverlay(selection, focus.focused ? focus : { scope: activeScope, focused: true });
        },
        currentFrameId: () => currentFrame().id,
      },
      planned,
    );
    if (dragPlanResult) {
      const finalized = commitDragSessionAfterExecution(dragPlanResult, execution);
      dragSession = finalized.session;
      if (dragPlanResult.navigation !== undefined) {
        navigationSession = commitNavigationSessionAfterExecution(dragPlanResult.navigation, execution).session ?? null;
      } else if (planned.navigation !== undefined) {
        navigationSession = commitNavigationSessionAfterExecution(planned.navigation, execution).session ?? null;
      }
      if (finalized.supplementalHostEffects.length === 0) return execution;
      return {
        outcome: execution.outcome,
        hostEffects: [...execution.hostEffects, ...finalized.supplementalHostEffects],
      };
    }
    if (planned.navigation !== undefined) {
      navigationSession = commitNavigationSessionAfterExecution(planned.navigation, execution).session ?? null;
    }
    return execution;
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
      const surfaceCommand = editSurfaceCommandFor(command);
      if (surfaceCommand) return runSurfaceCommand(surfaceCommand, false);
      return UNSUPPORTED('command execution');
    },
    can(command: EditorCommand): CanResult {
      if (command.type === 'setSelection') return canSetSelection(command);
      const surfaceCommand = editSurfaceCommandFor(command);
      if (surfaceCommand) {
        const result = runSurfaceCommand(surfaceCommand, true);
        return result.ok ? { ok: true } : { ok: false, code: result.code, reason: result.reason };
      }
      return {
        ok: false,
        code: 'unsupported',
        reason: 'command execution is not wired yet (section 5)',
      };
    },
    // Whether a formatting command is currently APPLIED (vs `can`, "may it run?").
    //
    // PLACEHOLDER by design: always `false`. Deriving it needs mark state at the
    // selection read from canonical model state, which does not exist yet. The value of
    // landing it now is the WIRING — both adapters read active state through this one
    // public method, so filling it in lights up their toolbars with no adapter change.
    // It must never guess: `false` is the honest answer until the derivation is real, and
    // a toolbar that renders "bold is on" when it is not is worse than one that never
    // highlights.
    isActive: (_command: EditorCommand): boolean => false,

    // Capabilities the ported legacy UI asks for. All STUBS, all returning the honest
    // empty answer, each naming what deriving it needs. See `isActive` above for why a
    // stub must never guess.

    /**
     * Styles the document defines, for the style picker.
     *
     * Derived: the model already carries a parsed style table, so this reports it
     * directly rather than re-reading the styles part. Filtered to paragraph styles,
     * which is what the picker offers — a character or table style there would apply
     * something the control cannot express.
     *
     * `name` falls back to the id when a style declares none, so the picker never renders
     * a blank row.
     */
    getDocumentStyles: () => {
      if (!session) return [];
      return session
        .currentModel()
        .styles.filter((style) => style.type === 'paragraph')
        .map((style) => ({ styleId: style.id, name: style.name || style.id, type: style.type }));
    },

    /**
     * Fonts the document actually uses, for the font picker.
     *
     * Derived, not stubbed: every run that carries unmodeled formatting keeps its
     * verbatim `<w:rPr>`, and `w:rFonts w:ascii` is where the family lives. Walking the
     * body's runs yields the real inventory in document order, de-duplicated.
     *
     * DELIBERATE SUBSET of the legacy definition, which is
     * `utils/fontExtractor.ts:extractFonts` in the earlier editor implementation. That one scans SIX
     * sources: the theme, `styles.xml`, document content, headers, footers, and the font
     * table. This scans body run capsules only, because the rest need parts the
     * greenfield model does not surface here yet.
     *
     * It cannot be ported directly — it takes a legacy `DocxPackage`, the model this
     * engine replaced. Widening it means surfacing the styles/theme/font-table parts and
     * reading those, in that order; the legacy file is the specification for what to
     * cover.
     *
     * Returns `[]` for a document whose runs carry no explicit font. True, not a
     * placeholder — those fonts come from styles and the theme, which this does not yet
     * reach.
     */
    getDocumentFonts: () => {
      if (!session) return [];
      const model = session.currentModel();
      const blocks = model.stories.get(bodyStoryId(model))?.blocks ?? [];
      const seen = new Set<string>();
      for (const block of blocks) {
        if (block.kind !== 'paragraph') continue;
        for (const run of (block as { runs: readonly { rPrCapsule?: string }[] }).runs) {
          const family = /<w:rFonts[^>]*w:ascii="([^"]{0,64})"/.exec(run.rPrCapsule ?? '')?.[1];
          if (family) seen.add(family);
        }
      }
      return [...seen];
    },

    /**
     * Heading outline for the navigation panel, in document order.
     *
     * Follows the legacy rule exactly: a paragraph is a heading when its style id matches
     * `Heading<n>`, giving level `n - 1`, bounded to 0..8. Text is the concatenated run
     * text, trimmed; a heading whose text is empty is skipped, because an outline row
     * with no label is worse than a shorter outline.
     *
     * The legacy version also honoured an explicit `outlineLevel` attribute, which the
     * greenfield paragraph props do not carry — a paragraph that sets `w:outlineLvl`
     * without a heading style is therefore missed. `blockId` replaces the legacy
     * `pmPos`, since the caller resolves position through the engine, not a PM document.
     */
    getOutline: () => {
      if (!session) return [];
      const model = session.currentModel();
      const blocks = model.stories.get(bodyStoryId(model))?.blocks ?? [];
      const out: { text: string; level: number; blockId: string }[] = [];
      for (const block of blocks) {
        if (block.kind !== 'paragraph') continue;
        const paragraph = block as { id: string; props?: { styleId?: string }; runs: readonly { text: string }[] };
        const match = /^[Hh]eading(\d)$/.exec(paragraph.props?.styleId ?? '');
        if (!match) continue;
        const level = Number(match[1]) - 1;
        if (level < 0 || level > 8) continue;
        const text = paragraph.runs.map((r) => r.text).join('').trim();
        if (!text) continue;
        out.push({ text, level, blockId: paragraph.id });
      }
      return out;
    },

    /**
     * STUB — the comments part IS read, but not in a shape a comment list can be built
     * from: every `w:comment` entry's paragraphs are concatenated into a single
     * `kind: 'comment'` story, so per-comment boundaries are lost, and `w:id`,
     * `w:author`, `w:date` and `w:initials` are never captured. Deriving this needs the
     * story reader to keep one story per `w:comment` and carry those four attributes,
     * plus `w:commentRangeStart`/`End` mapped onto block ids for the anchors.
     * Returning a merged, author-less blob instead would be a guess.
     */
    getComments: () => [],

    /** STUB — needs resolved run/paragraph properties at the selection, which is the
     *  same derivation `isActive` waits on. */
    /**
     * Run properties at the selection head, derived from CANONICAL state.
     *
     * No longer a stub. The model carries what the toolbar needs: `RunProps` holds
     * bold/italic/underline, and a run whose formatting the model does not represent
     * carries its verbatim `<w:rPr>` in `rPrCapsule` — which is where font family and
     * size live for most real documents. Reading the capsule is read-only and bounded:
     * a fixed attribute match on bytes this engine itself preserved, never a parse of
     * anything new.
     *
     * Returns `null` when there is no selection or the block is not a paragraph, rather
     * than a default — an empty toolbar is honest, a fabricated "Calibri 11" is not.
     */
    getSelectionFormatting: () => {
      const head = currentFrame().selection?.head;
      if (!head || head.kind !== 'text' || !session) return null;
      const blockId = head.identity?.blockId;
      if (!blockId) return null;
      const model = session.currentModel();
      const blocks = model.stories.get(bodyStoryId(model))?.blocks ?? [];
      const block = blocks.find((b) => b.id === blockId);
      if (!block || block.kind !== 'paragraph') return null;

      // The run containing the head offset. Offsets are grapheme-based; run text is
      // UTF-16, so this walks by run length and clamps — an offset past the end belongs
      // to the last run, which is where a caret at paragraph end sits.
      const runs = (block as { runs: readonly { text: string; props?: { bold?: boolean; italic?: boolean; underline?: boolean; styleId?: string }; rPrCapsule?: string }[] }).runs;
      let remaining = head.graphemeOffset ?? 0;
      let run = runs[0];
      for (const r of runs) {
        run = r;
        if (remaining < r.text.length) break;
        remaining -= r.text.length;
      }
      if (!run) return null;

      const capsule = run.rPrCapsule ?? '';
      // Bounded attribute reads on our own preserved bytes. No backtracking construct.
      const font = /<w:rFonts[^>]*w:ascii="([^"]{0,64})"/.exec(capsule)?.[1];
      const sizeHalfPoints = Number(/<w:sz\b[^>]*w:val="(\d{1,4})"/.exec(capsule)?.[1] ?? NaN);

      return {
        ...(font ? { fontFamily: font } : {}),
        ...(Number.isFinite(sizeHalfPoints) ? { fontSizeHalfPoints: sizeHalfPoints } : {}),
        ...(run.props?.styleId ? { styleId: run.props.styleId } : {}),
        // Marks the toolbar reflects. Authored explicitly on the run, so `undefined`
        // means "not set here" and is left out rather than reported as false — the run
        // may inherit it from its style, which this does not resolve.
        ...(run.props?.bold !== undefined ? { bold: run.props.bold } : {}),
        ...(run.props?.italic !== undefined ? { italic: run.props.italic } : {}),
        ...(run.props?.underline !== undefined ? { underline: run.props.underline } : {}),
      };
    },

    /**
     * Text matches across the body, for find/replace.
     *
     * Search semantics follow the legacy definition: the query is regex-escaped (this
     * surface takes literal text only — a raw-regex mode would need its own flag and its
     * own catastrophic-backtracking guard), `matchWholeWord` wraps it in `\b`, and
     * `matchCase` selects the `g`/`gi` flag.
     *
     * Offsets are UTF-16 into the paragraph's concatenated run text, which is the same
     * space the selection uses, so a caller can turn a match straight into a selection.
     * An empty query returns nothing rather than every position.
     */
    findMatches: (query: string, options?: { matchCase?: boolean; wholeWord?: boolean }) => {
      if (!session || !query) return [];
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = options?.wholeWord ? `\\b${escaped}\\b` : escaped;
      let re: RegExp;
      try {
        re = new RegExp(pattern, options?.matchCase ? 'g' : 'gi');
      } catch {
        return [];
      }
      const model = session.currentModel();
      const blocks = model.stories.get(bodyStoryId(model))?.blocks ?? [];
      const out: TextMatch[] = [];
      // `paragraphIndex` counts PARAGRAPHS, not blocks: a caller enumerating paragraphs
      // (which is what every consumer of this does) would not see a table in the middle
      // and would be off by one for everything after it.
      let paragraphIndex = -1;
      for (const block of blocks) {
        if (block.kind !== 'paragraph') continue;
        paragraphIndex += 1;
        const paragraph = block as { id: string; runs: readonly { text: string }[] };
        const text = paragraph.runs.map((r) => r.text).join('');
        re.lastIndex = 0;
        for (let m = re.exec(text); m !== null; m = re.exec(text)) {
          // Resolve the paragraph offset to the run that contains it. A match can span
          // runs (formatting changes mid-word); `runIndex`/`runOffset` address where it
          // STARTS, which is what a caller needs to place a selection there.
          let runIndex = 0;
          let runOffset = m.index;
          for (let r = 0; r < paragraph.runs.length; r += 1) {
            const len = paragraph.runs[r]!.text.length;
            if (runOffset < len || r === paragraph.runs.length - 1) {
              runIndex = r;
              break;
            }
            runOffset -= len;
          }
          out.push({
            blockId: paragraph.id,
            start: m.index,
            length: m[0].length,
            paragraphIndex,
            runIndex,
            runOffset,
            text: m[0],
          });
          // A zero-length match (possible with \b on an empty escape) would loop forever.
          if (m[0].length === 0) re.lastIndex += 1;
        }
      }
      return out;
    },

    /**
     * STUB — `findMatches` resolves WHERE a match is, but moving the selection there
     * needs a semantic position built from `blockId` + `start`, and that mapping (offset
     * within a paragraph's concatenated run text to a canonical position with affinity)
     * is the same derivation `setSelection` waits on for offset-addressed input.
     * Refusing is the honest answer: a find dialog learns navigation is unavailable
     * rather than silently leaving the caret where it was and reporting success.
     */
    selectMatch: (_match: TextMatch): ExecResult => ({
      ok: false,
      code: 'unsupported',
      reason: 'selectMatch needs offset-addressed selection, which is not wired yet',
    }),

    /** STUB — needs the drawing/image parts resolved and mapped to the selection. */
    getSelectedImage: () => null,

    /** STUB — needs table geometry and the selection's cell address. This change owns no
     *  table editing surface, so it stays empty rather than implying one exists. */
    getSelectedTable: () => null,

    /** STUB — needs section properties surfaced; layout uses a single uniform margin
     *  today, so reporting four independent sides would overstate what the engine has. */
    getPageSetup: () => null,

    /** STUB — needs the watermark drawing resolved from the header parts. */
    getWatermark: () => null,

    /** STUB — header/footer editing has no engine surface yet; `null` means "not
     *  editing", which is always true right now. */
    getHeaderFooterState: () => null,

    /**
     * STUB — `w:ins` and `w:del` are treated as plain run wrappers: their runs are
     * unwrapped into the paragraph and the revision's `w:id`, `w:author` and `w:date`
     * are dropped, while `w:delText` is dropped outright. Nothing in the model says a
     * run was inserted or deleted, so there is no revision list to return. Deriving
     * this needs those wrappers to survive parsing as marked spans carrying their
     * author/date, and `w:delText` retained as deleted text.
     */
    getTrackedChanges: () => [],
    setActiveScope: (scope: ViewScope) => {
      activeScope = scope;
      navigationSession = null;
    },
    getActiveScope: () => activeScope,
    query<K extends keyof EditorQueries>(query: { type: K } & EditorQueries[K]): EditorQueryResults[K] {
      return queryDefault(query.type as string) as EditorQueryResults[K];
    },
    snapshot: (): EditorSnapshot => buildSnapshot(),

    /**
     * STUB — needs the host's scroll container driven from the stacked page geometry the
     * frame already publishes (`scrollGeometry.pageTops`), plus a block-to-page mapping
     * for `scrollToBlock`. Returning false rather than silently doing nothing lets a
     * caller distinguish "no such page" from "scrolled there".
     */
    scrollToPage: (_pageNumber: number) => false,
    scrollToBlock: (_blockId: string) => false,

    getZoom: () => zoom,
    setZoom: (next: number): ExecResult => {
      // Refused rather than clamped: a caller that asked for 0 or NaN has a bug, and
      // silently substituting 1 hides it. The bounds match what the zoom control offers.
      if (!Number.isFinite(next) || next < 0.1 || next > 5) {
        return { ok: false, code: 'invalidArgs', reason: `zoom must be between 0.1 and 5, got ${next}` };
      }
      if (next === zoom) return { ok: true, changed: false };
      zoom = next;
      // Relayout, not just repaint: line breaking is measured in content coordinates, so
      // the display itself does not change with scale — but the host needs a frame to
      // repaint at the new scale, and host metrics must be re-read.
      relayoutAndPaint();
      return { ok: true, changed: true };
    },

    getTotalPages: () => currentFrame().display.length,
    /**
     * Which page the reader is looking at (`'viewport'`), or the one holding the caret.
     *
     * `frame.currentPage.viewport` is seeded to 0 and carried forward, so reading it
     * answered "page 1" at every scroll position. This derives the answer instead, from
     * `frame.pageGeometry` — the STACKED page boxes, where each page's `y` is its top in
     * one shared content space, gaps included. (The `display` boxes are page-LOCAL, every
     * page reporting `y: 0`; testing a scroll offset against those returns the last page
     * at any scroll, which is a mistake this comment exists to prevent repeating.)
     *
     * The page under the scroll container's vertical MIDPOINT is the one being read —
     * what a reader would call the current page when two pages straddle the viewport. A
     * midpoint in the gap between pages resolves to the page below it.
     *
     * Falls back to the carried frame value when there is no scroll container or no host
     * metrics to map with, which is the honest answer for a host that mounted neither.
     */
    getCurrentPage: (mode = 'viewport') =>
      mode === 'caret' ? currentFrame().currentPage.caret : viewportPage(),

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
    dispatchInteraction,
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
        // The per-block policy. Omitting it here silently reverted this path to
        // document-wide editability: on the painted-pages-only configuration (no mounted
        // surface) all 70 locked paragraphs of the flagship fixture came back
        // `editableParagraph, readOnly: false` — the exact defect the observation fix was
        // supposed to close, still live on the path that has no ProseMirror to disagree
        // with. `ObserveAccessibilityInput.readOnlyBlockIds` is now REQUIRED so a future
        // caller cannot omit it by accident.
        readOnlyBlockIds: session?.readOnlyBlockIds ?? new Set<string>(),
        model: session?.currentModel() ?? createEmptyModel(),
        owner: 'none',
        paintedPagesAssistiveRole: null,
      });
    },
    getInputHostObservation: (): InputHostObservation | null => {
      if (!surface?.semanticProjectionAttached) return null;
      const state = surface.inputHostState;
      return {
        attached: state.hostAttached,
        placementReason: state.placement.reason,
        clientRect: state.placement.clientRect,
        paintedPagesAssistiveRole: state.paintedPagesAssistiveRole,
      };
    },
    getCaretClientRect: (): Rect | null => caretClientRect(),
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
      const frameId = currentFrame().id;
      const obs = surface.getAccessibilityObservation({ frameId, scope: activeScope });
      const frame = currentFrame();
      const observed = obs.selection
        ? {
            frameId,
            scope: obs.scope,
            anchor: canonicalAffinityFor(frame, obs.selection.anchor),
            head: canonicalAffinityFor(frame, obs.selection.head),
          }
        : null;

      // Focus through the SYNC path whenever a selection is observable.
      //
      // `surface.focus({ frameId })` alone authorizes input only if the surface still
      // holds a retained semantic selection. `load()` remounts the surface, which
      // discards it, so after a reload `focus()` returned ok, the frame reported
      // `focused: true`, a caret painted — and every keystroke was silently dropped.
      // Round-5 review measured exactly that in both adapters: `modelRevision` stayed
      // 0 and the typed text appeared nowhere, while a real click recovered instantly.
      // An earlier attempt gated authorization on a per-surface
      // `semanticSelectionEverApplied` flag, which moved the hole here rather than
      // closing it.
      //
      // The sync path establishes the semantic selection AND authorizes input in one
      // step, and re-applying the surface's own observed selection is idempotent, so
      // this is correct on a fresh mount and on a warm one alike.
      const outcome = observed
        ? surface.focus({ sync: { frameId, selection: observed } })
        : surface.focus({ frameId });
      if (!outcome.ok) return outcome;
      if (observed) publishSelectionOverlay(observed, { scope: activeScope, focused: true });
      return { ok: true, value: undefined, frameId: currentFrame().id };
    },
    destroy() {
      // Detach THIS editor's projection/host resources; an externally owned (shared-handle) session
      // is NOT disposed here — the handle keeps the store alive for any other editor holding it.
      destroyed = true;
      dragSession = null;
      navigationSession = null;
      detachScrollTracking?.();
      cancelScheduledLayoutWork();
      frames.cancelPendingLayout();
      frames.clearNavigationSidecar();
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
