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
import { createEmptyModel } from '@docx-editor.dev/engine-core';
import { layoutBody, HelveticaMetrics } from '@docx-editor.dev/engine-layout';
import { toDisplayPages } from './display-bridge.ts';
import { InteractionFrameStore, emptyInteractionFrame } from './interaction-frame.ts';
import type { NavigationGeometry } from './navigation-geometry.ts';
import { hitTestPointer, deriveCaretGeometry, deriveSelectionGeometry } from './interaction-geometry.ts';
import { contentToClient } from './coordinate-mapper.ts';
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
    setActiveScope: (scope: ViewScope) => {
      activeScope = scope;
      navigationSession = null;
    },
    getActiveScope: () => activeScope,
    query<K extends keyof EditorQueries>(query: { type: K } & EditorQueries[K]): EditorQueryResults[K] {
      return queryDefault(query.type as string) as EditorQueryResults[K];
    },
    snapshot: (): EditorSnapshot => buildSnapshot(),

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
