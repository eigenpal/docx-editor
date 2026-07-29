// ProseMirror edit-surface mount (document-engine 4.2; interactive-paginated 4.1–4.2).

import { releaseCapsuleRefs } from './schema.ts';
import { EditorView } from 'prosemirror-view';
import { EditorState, TextSelection } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import {
  baseKeymap,
  joinBackward,
  joinForward,
  splitBlock,
  deleteSelection,
  selectTextblockStart,
  selectTextblockEnd,
  toggleMark,
} from 'prosemirror-commands';
import type {
  InteractionFrameId,
  InteractionOutcome,
  InputObservation,
  AccessibilityObservation,
} from '@docx-editor.dev/core-contract/contracts/interaction';
import {
  captureSelection,
  captureSelectionRange,
  resolveSelection,
  resolveSelectionRange,
  resolveAtomicSelection,
  type SelectionAnchor,
  type SelectionRangeAnchors,
} from './selection.ts';
import {
  createInputHostController,
  type InputHostAssistiveState,
  type InputHostControllerOptions,
  type InputHostPlacement,
  type InputHostPlacementRequest,
} from './input-host.ts';
import { resolveSemanticSelection, type SemanticSelectionSyncRequest } from './semantic-sync.ts';
import type { DocxEditorSession } from './session.ts';
import {
  observeComposition,
  remoteChangePreservesCompositionAnchor,
  mapCompositionRangeAfterRemote,
  deriveCompositionOverlay,
  applyCompositionOverlay,
  type CompositionCancelOutcome,
  type CompositionSnapshot,
} from './composition.ts';
import type { CompositionObservation } from '@docx-editor.dev/core-contract/contracts/interaction';
import { paragraphText } from '@docx-editor.dev/engine-core';
import {
  observeAccessibilityFromSession,
  captureAccessibilityState,
  resolveAccessibilityNamePolicy,
  reapplyAccessibilityProjectionDom,
  type AccessibilityObservationRequest,
} from './accessibility-projection.ts';
import {
  boundClipboardHtml,
  boundClipboardText,
  isCompositionOwnedBeforeInput,
  observeInput,
  rejectClipboardDataTransfer,
  rejectDropDataTransfer,
  validatePastedSlice,
  REJECTED_PASTE_SLICE,
  type InputRejection,
} from './input-policy.ts';

export interface PmSelectionSnapshot {
  readonly from: number;
  readonly to: number;
  readonly empty: boolean;
}

/** A PM-FREE handle to a mounted edit surface — no EditorView or PM type leaks out. */
export interface EditSurface {
  readonly editable: boolean;
  readonly interactionAuthorized: boolean;
  readonly semanticProjectionAttached: boolean;
  readonly inputHostState: InputHostAssistiveState;
  focus(options?: {
    sync?: SemanticSelectionSyncRequest;
    frameId?: InteractionFrameId;
  }): InteractionOutcome<void>;
  blur(): void;
  destroy(): void;
  syncSemanticSelection(request: SemanticSelectionSyncRequest): InteractionOutcome<void>;
  updateInputHostPlacement(request: InputHostPlacementRequest): InputHostPlacement;
  retainSelectionForOwnedPopup(): void;
  releaseOwnedPopup(): void;
  /**
   * Re-tag the retained selection as current on `frameId`, without re-applying it
   * to the projection.
   *
   * The engine retains a selection while frame F is current and then publishes the
   * overlay, which mints F+1. That left the retained tag stale by construction, so
   * `focus({ frameId })` with the only frame id a caller can legitimately obtain —
   * the current one — always failed the stale-frame check. Independent review
   * measured `Editor.focus()` returning `staleFrame` after every dispatched
   * interaction in both adapters, making programmatic re-entry impossible.
   *
   * The fix belongs here rather than in `focus()`: the stale-frame check is a real
   * guard (a caller holding a superseded frame must not be granted input
   * authorization, and a test asserts it), so the answer is to keep the tag
   * truthful rather than to stop checking it. Content is untouched — this only
   * records that the same selection is current on the newer frame.
   */
  retainSelectionOnFrame(frameId: InteractionFrameId): void;
  getSelectionAnchor(): SelectionAnchor;
  getSelectionRange(): SelectionRangeAnchors;
  getPmSelection(): PmSelectionSnapshot;
  getCompositionObservation(): CompositionObservation;
  getInputObservation(): InputObservation;
  getAccessibilityObservation(request: AccessibilityObservationRequest): AccessibilityObservation;
  /**
   * Run one editing command, or report whether it would apply (`dryRun`).
   * The PM-free vocabulary the public `Editor.can`/`Editor.exec` route through
   * (interactive-paginated-editing M4.0) — adapters never see ProseMirror.
   */
  runEditCommand(
    command: EditSurfaceCommand,
    options?: { dryRun?: boolean }
  ): EditSurfaceCommandResult;
}

/** The editing commands the surface can run today. */
export type EditSurfaceCommand =
  | { readonly kind: 'toggleMark'; readonly mark: string }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' };

export type EditSurfaceCommandResult =
  | { readonly ok: true; readonly changed: boolean; readonly active?: boolean }
  | { readonly ok: false; readonly code: 'unsupported' | 'readOnly'; readonly reason: string };

/**
 * Marks the toolbar may toggle.
 *
 * `underline` was deliberately absent while `RunProps.underline` was a boolean: `w:u`
 * carries a variant (single / double / wave / …), so a toggle would have downgraded a
 * double underline to a single one on save, and `can()` reported that as the reason the
 * control was disabled. The model now carries the variant and colour, the mark carries
 * them through the projection, and the serializer re-emits the authored value — so the
 * command is honest, and the keymap and the toolbar give the same answer.
 */
const TOGGLEABLE_MARKS = new Set(['bold', 'italic', 'underline']);
/**
 * `beforeinput` types ProseMirror and the browser own, not this bridge (M6K.1).
 *
 * ProseMirror MUST own command execution for deletion by word and by line.
 * Approximating them here produced worse behavior than raw PM and left the platform
 * shortcuts dead. Each entry removes a RANGE and carries no external payload, so
 * admitting it does not widen the trust boundary. Line breaks are NOT here — see the
 * `insertLineBreak` note in the set below.
 */
const DELEGATED_TO_PROSEMIRROR = new Set([
  'deleteWordBackward',
  'deleteWordForward',
  'deleteSoftLineBackward',
  'deleteSoftLineForward',
  'deleteHardLineBackward',
  'deleteHardLineForward',
  'deleteEntireSoftLine',
  // `insertLineBreak` (Shift+Enter) is deliberately ABSENT.
  //
  // It looks like it belongs here, and it was here: delegating it let the browser
  // insert a break that ProseMirror then reconciled — except the composed schema
  // registers no hard-break node, and while the PARSER maps `w:br`/`w:cr` into run text
  // as "\n", the serializer has no path back to `w:br` — so an inserted break cannot
  // round-trip. PM dropped it and the document revision never moved. The user pressed a key, saw nothing, and
  // got no diagnostic: a silent no-op, which is the one outcome worse than an honest
  // refusal. Delegation only works for a type the reverse lane can actually express.
  //
  // It falls through to the rejection below, so Shift+Enter reports
  // `unsupportedInputType` until a `w:br` run and its round-trip exist.
]);

export interface MountEditSurfaceOptions {
  onModelChanged?: () => void;
  /**
   * Called when an IME composition starts or ends.
   *
   * `frame.composition` — and the public `EditorDriver.compositionState()` — is
   * built from `getCompositionObservation()`, but nothing told the engine when to
   * re-read it, so a composition could start and end without any frame reflecting
   * it. Independent review measured the observable field as a constant
   * `{ active: false }` throughout a live composition.
   */
  onCompositionChange?: (active: boolean) => void;
  /**
   * Called when ProseMirror changes its selection WITHOUT changing the document.
   *
   * PM owns logical horizontal movement and Select All (task M6K.1), and those commit
   * nothing — so without this the engine's interaction frame would keep the selection
   * from the last commit and the painted caret would stop following the caret the user
   * is actually moving.
   */
  onSelectionChanged?: () => void;
  accessibleName?: string;
  accessibilityAtomLabels?: Readonly<Record<string, string>>;
  /** When true, mount a read-only semantic projection (contenteditable false, no input authorization). */
  readOnlyProjection?: boolean;
  /** Private browser-feedback checkpoint: show and interact with the PM projection directly. */
  visibleProjection?: boolean;
  inputHost?: InputHostControllerOptions;
  /** Test-only hook to observe PM-free selection and drive native composition DOM events. */
  testHooks?: {
    onReady?: (helpers: {
      pmSelection(): PmSelectionSnapshot;
      stripBlockEmbed(objectId: string): void;
      compose(options: {
        updates: readonly string[];
        final?: string;
        cancel?: boolean;
        during?: () => void;
        end?: boolean;
      }): Promise<void>;
      beginComposition(): void;
      pushCompositionUpdate(text: string): void;
      endComposition(finalText?: string): Promise<void>;
      readPmParagraph(paragraphId: string): string;
    }) => void;
  };
}

function applyAnchorsToView(
  view: EditorView,
  range: { anchor: SelectionAnchor; head: SelectionAnchor },
  atomicObjectId?: string
): boolean {
  const doc = view.state.doc;
  if (atomicObjectId) {
    const nodeSel = resolveAtomicSelection(atomicObjectId, doc);
    if (!nodeSel) return false;
    view.dispatch(view.state.tr.setSelection(nodeSel).scrollIntoView());
    return true;
  }
  try {
    const sel = resolveSelectionRange(range, doc);
    view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
    return true;
  } catch {
    return false;
  }
}

/** Mount a ProseMirror semantic projection for `session` (editable or read-only). */
export function mountEditSurface(
  mountParent: HTMLElement,
  session: DocxEditorSession,
  options: MountEditSurfaceOptions = {}
): EditSurface {
  const readOnlyProjection = options.readOnlyProjection ?? !session.editable;
  const visibleProjection = options.visibleProjection === true;
  const interactionAuthorized = !readOnlyProjection && session.editable;
  const onModelChanged = options.onModelChanged ?? (() => {});
  const onCompositionChange = options.onCompositionChange ?? (() => {});
  const onSelectionChanged = options.onSelectionChanged ?? (() => {});
  const doc = mountParent.ownerDocument ?? document;
  const accessibleNamePolicy = resolveAccessibilityNamePolicy(options.accessibleName);
  const atomLabels = options.accessibilityAtomLabels;
  const inputHost = createInputHostController(doc, {
    ...options.inputHost,
    accessibleName: options.accessibleName,
    visibleProjection,
  });
  mountParent.append(inputHost.root);

  let ownedPopupDepth = 0;
  let retainedSemanticSelection: SemanticSelectionSyncRequest | null = null;
  /**
   * Whether a semantic selection was EVER applied to this surface.
   *
   * `retainedSemanticSelection` is not enough to answer that: `commitEdit` nulls it
   * on every commit, so it cannot distinguish "the engine never established a
   * selection here" from "it did, and then the user typed". Those two need opposite
   * answers on `focus()`, and conflating them broke one or the other:
   *
   * - Never synced: focus MUST NOT authorize input. A caller must not be able to
   *   obtain input authorization just by presenting a frame id, and
   *   `input-events.test.ts` asserts exactly that.
   * - Synced, then committed: focus MUST authorize, or `focus()` returns ok while
   *   silently dropping every following keystroke — measured by round-4 review.
   */
  let semanticSelectionEverApplied = false;
  let localCommitDepth = 0;
  let layoutPending = false;

  function isUtf16HighSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
  }

  function isUtf16LowSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff;
  }

  /** Step one UTF-16 code unit without landing inside a surrogate pair. */
  function safeHorizontalPos(
    doc: EditorState['doc'],
    pos: number,
    dir: -1 | 1,
    innerStart: number,
    innerEnd: number
  ): number | null {
    let next = pos + dir;
    if (next < innerStart || next > innerEnd) return null;
    if (dir > 0 && pos < doc.content.size) {
      const ch = doc.textBetween(pos, pos + 1);
      if (ch.length === 1 && isUtf16HighSurrogate(ch.charCodeAt(0))) {
        next = pos + 2;
        if (next > innerEnd) return null;
      }
    } else if (dir < 0 && pos > 0) {
      const ch = doc.textBetween(pos - 1, pos);
      if (ch.length === 1 && isUtf16LowSurrogate(ch.charCodeAt(0))) {
        next = pos - 2;
        if (next < innerStart) return null;
      }
    }
    return next;
  }

  /**
   * Provisional PM keymap navigation (happy-dom lacks native contenteditable caret moves).
   * Engine-aware visual navigation is task 5; real browser native behavior is task 4.8.
   */
  function moveSelectionHorizontally(
    state: EditorState,
    dispatch: NonNullable<Parameters<typeof selectTextblockStart>[1]>,
    dir: -1 | 1
  ): boolean {
    const { selection } = state;
    if (!selection.empty) {
      const pos =
        dir < 0 ? Math.min(selection.from, selection.to) : Math.max(selection.from, selection.to);
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)).scrollIntoView());
      return true;
    }
    const $head = selection.$head;
    if (!$head.parent.isTextblock) return false;
    const innerStart = $head.start();
    const innerEnd = innerStart + $head.parent.content.size;
    const next = safeHorizontalPos(state.doc, $head.pos, dir, innerStart, innerEnd);
    if (next === null) return false;
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, next)).scrollIntoView());
    return true;
  }

  function extendSelectionHorizontally(
    state: EditorState,
    dispatch: NonNullable<Parameters<typeof selectTextblockStart>[1]>,
    dir: -1 | 1
  ): boolean {
    const { selection } = state;
    const $head = selection.$head;
    if (!$head.parent.isTextblock) return false;
    const innerStart = $head.start();
    const innerEnd = innerStart + $head.parent.content.size;
    const next = safeHorizontalPos(state.doc, $head.pos, dir, innerStart, innerEnd);
    if (next === null) return false;
    dispatch(
      state.tr
        .setSelection(TextSelection.create(state.doc, selection.anchor, next))
        .scrollIntoView()
    );
    return true;
  }

  function selectAllText(
    state: EditorState,
    dispatch: NonNullable<Parameters<typeof selectTextblockStart>[1]> | undefined
  ): boolean {
    let from: number | undefined;
    let to: number | undefined;
    state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return;
      from ??= pos + 1;
      to = pos + 1 + node.content.size;
    });
    if (from === undefined || to === undefined) return false;
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, from, to)).scrollIntoView());
    return true;
  }

  const plugins = interactionAuthorized
    ? [
        keymap({
          ...baseKeymap,
          'Mod-a': selectAllText,
          'Mod-b': (state, dispatch) => {
            const mark = state.schema.marks.bold;
            return mark ? toggleMark(mark)(state, dispatch) : false;
          },
          'Mod-i': (state, dispatch) => {
            const mark = state.schema.marks.italic;
            return mark ? toggleMark(mark)(state, dispatch) : false;
          },
          'Mod-u': (state, dispatch) => {
            const mark = state.schema.marks.underline;
            return mark ? toggleMark(mark)(state, dispatch) : false;
          },
          'Mod-z': () => doUndo(),
          'Mod-y': () => doRedo(),
          'Shift-Mod-z': () => doRedo(),
          ArrowLeft: (state, dispatch) =>
            dispatch ? moveSelectionHorizontally(state, dispatch, -1) : false,
          ArrowRight: (state, dispatch) =>
            dispatch ? moveSelectionHorizontally(state, dispatch, 1) : false,
          'Shift-ArrowLeft': (state, dispatch) =>
            dispatch ? extendSelectionHorizontally(state, dispatch, -1) : false,
          'Shift-ArrowRight': (state, dispatch) =>
            dispatch ? extendSelectionHorizontally(state, dispatch, 1) : false,
          Home: selectTextblockStart,
          End: selectTextblockEnd,
        }),
      ]
    : [];

  let reconciling = false;
  let pendingCompositionCommit = false;
  let destroyed = false;
  let imeComposing = false;
  let compositionSnapshot: CompositionSnapshot | undefined;
  let compositionRange: { from: number; to: number } | undefined;
  let pendingComposedText = '';
  let deferredRemote = false;
  let lastCompositionCancel: CompositionCancelOutcome | null = null;
  let lastInputRejection: InputRejection | null = null;
  let inputAuthorized = false;
  let currentPasteRejected = false;

  function recordInputRejection(rejection: InputRejection) {
    lastInputRejection = rejection;
  }

  function clearInputState() {
    inputAuthorized = false;
    lastInputRejection = null;
  }

  function rejectUnauthorizedInput(reason: string): InputRejection {
    const rejection: InputRejection = {
      code: 'inputNotAuthorized',
      reason,
    };
    recordInputRejection(rejection);
    return rejection;
  }

  function requireInputAuthorized(): InputRejection | null {
    if (!interactionAuthorized) {
      return rejectUnauthorizedInput('input rejected because the semantic projection is read-only');
    }
    if (destroyed) {
      return rejectUnauthorizedInput('input rejected because the edit surface was destroyed');
    }
    if (layoutPending && !visibleProjection) {
      return rejectUnauthorizedInput(
        'input rejected because layout for the current interaction frame is pending'
      );
    }
    if (!inputAuthorized) {
      return rejectUnauthorizedInput(
        'input rejected because focus did not authorize semantic sync'
      );
    }
    return null;
  }

  function pendingLayoutOutcome(frameId: InteractionFrameId): InteractionOutcome<void> {
    return {
      ok: false,
      code: 'pendingLayout',
      reason: 'layout for the current interaction frame is not yet published',
      frameId,
    };
  }

  /**
   * Adopt the browser's live DOM selection before an intercepted edit reads it.
   *
   * ProseMirror learns about a pointer- or browser-made selection ASYNCHRONOUSLY, from
   * the document's `selectionchange` task. The `beforeinput` interception below runs
   * SYNCHRONOUSLY inside the input event and reads `view.state.selection`, so a
   * keystroke that arrives before that task has run edits at the PREVIOUS insertion
   * point: click into paragraph 3, type, and the character lands wherever the caret was
   * before the click. Measured in Chrome — the DOM selection was correct at
   * `beforeinput` time while ProseMirror still held the stale one.
   *
   * ProseMirror's own `keydown` calls `domObserver.forceFlush()`, but that only runs a
   * flush that was ALREADY scheduled — with no `selectionchange` task yet there is
   * nothing scheduled and it is a no-op, so `End`, `Home`, `Mod-A` and the arrow keys
   * raced the same way and split or extended from the previous paragraph. `posAtDOM` is
   * the public equivalent of the flush.
   *
   * Scoped to the visible projection, where browser-native selection is the interaction
   * authority (D11). In the clipped input host the semantic layer owns selection and
   * must not be overridden by the projection's DOM.
   */
  function adoptDomSelection(view: EditorView): void {
    if (!visibleProjection || imeComposing || reconciling) return;
    const domSelection = view.dom.ownerDocument.getSelection();
    const anchorNode = domSelection?.anchorNode;
    const focusNode = domSelection?.focusNode;
    if (!domSelection || !anchorNode || !focusNode) return;
    if (!view.dom.contains(anchorNode) || !view.dom.contains(focusNode)) return;
    let selection: TextSelection;
    try {
      const anchor = view.posAtDOM(anchorNode, domSelection.anchorOffset);
      const head = view.posAtDOM(focusNode, domSelection.focusOffset);
      const current = view.state.selection;
      if (current.anchor === anchor && current.head === head) return;
      selection = TextSelection.create(view.state.doc, anchor, head);
    } catch {
      // A DOM position with no stable model position (mid-reconciliation, or a node
      // ProseMirror does not describe) leaves the committed selection in place.
      return;
    }
    view.dispatch(view.state.tr.setSelection(selection).setMeta('addToHistory', false));
  }

  function deleteBackward(view: EditorView) {
    const { from, empty } = view.state.selection;
    if (!empty) {
      deleteSelection(view.state, view.dispatch);
      return;
    }
    if (from > 0) view.dispatch(view.state.tr.delete(from - 1, from));
    else joinBackward(view.state, view.dispatch);
  }

  function deleteForward(view: EditorView) {
    const { from, to, empty } = view.state.selection;
    if (!empty) {
      deleteSelection(view.state, view.dispatch);
      return;
    }
    if (to < view.state.doc.content.size) view.dispatch(view.state.tr.delete(from, from + 1));
    else joinForward(view.state, view.dispatch);
  }

  function clearInputRejectionOnCommit() {
    lastInputRejection = null;
  }

  function rejectPastePipeline(rejection: InputRejection): true {
    recordInputRejection(rejection);
    return true;
  }

  const view = new EditorView(inputHost.pmMount, {
    state: EditorState.create({ doc: session.projectDoc(), plugins }),
    editable: () => interactionAuthorized,
    transformPastedHTML(html) {
      currentPasteRejected = false;
      const bounded = boundClipboardHtml(html);
      if (!bounded.ok) {
        currentPasteRejected = true;
        recordInputRejection(bounded.rejection);
        return '';
      }
      return bounded.html;
    },
    transformPastedText(text) {
      if (currentPasteRejected) return '';
      const bounded = boundClipboardText(text);
      if (!bounded.ok) {
        currentPasteRejected = true;
        recordInputRejection(bounded.rejection);
        return '';
      }
      return bounded.text;
    },
    transformPasted(slice, pastedView) {
      if (currentPasteRejected) return REJECTED_PASTE_SLICE;
      const rejection = validatePastedSlice(slice, pastedView.state.schema);
      if (rejection) {
        currentPasteRejected = true;
        recordInputRejection(rejection);
        return REJECTED_PASTE_SLICE;
      }
      return slice;
    },
    handlePaste(_view, event, slice) {
      const authRejection = requireInputAuthorized();
      if (authRejection) return rejectPastePipeline(authRejection);
      if (currentPasteRejected) return true;
      const transferRejection = rejectClipboardDataTransfer(event.clipboardData);
      if (transferRejection) return rejectPastePipeline(transferRejection);
      const html = event.clipboardData?.getData('text/html') ?? '';
      if (html) {
        const bounded = boundClipboardHtml(html);
        if (!bounded.ok) return rejectPastePipeline(bounded.rejection);
      }
      const plain = event.clipboardData?.getData('text/plain') ?? '';
      if (plain) {
        const bounded = boundClipboardText(plain);
        if (!bounded.ok) return rejectPastePipeline(bounded.rejection);
      }
      const rejection = validatePastedSlice(slice, _view.state.schema);
      if (rejection) return rejectPastePipeline(rejection);
      if (slice.size === 0) return true;
      return false;
    },
    handleDrop(_view, event, slice) {
      const authRejection = requireInputAuthorized();
      if (authRejection) return rejectPastePipeline(authRejection);
      const transferRejection = rejectDropDataTransfer(event.dataTransfer);
      if (transferRejection) return rejectPastePipeline(transferRejection);
      const rejection = validatePastedSlice(slice, _view.state.schema);
      if (rejection) return rejectPastePipeline(rejection);
      if (slice.size === 0) return true;
      return false;
    },
    handleDOMEvents: {
      focus() {
        if (visibleProjection && interactionAuthorized) {
          semanticSelectionEverApplied = true;
          inputAuthorized = true;
          lastInputRejection = null;
        }
        return false;
      },
      mousedown() {
        if (visibleProjection && interactionAuthorized) {
          semanticSelectionEverApplied = true;
          inputAuthorized = true;
          lastInputRejection = null;
        }
        return false;
      },
      // Runs BEFORE ProseMirror's own keydown (and therefore before the keymap), so
      // every command below reads the caret the user can actually see.
      keydown(keydownView) {
        adoptDomSelection(keydownView);
        return false;
      },
      drop(_view, event) {
        const authRejection = requireInputAuthorized();
        if (authRejection) {
          event.preventDefault();
          return rejectPastePipeline(authRejection);
        }
        const transferRejection = rejectDropDataTransfer(event.dataTransfer);
        if (transferRejection) {
          event.preventDefault();
          return rejectPastePipeline(transferRejection);
        }
        return false;
      },
      beforeinput(_view, event) {
        const inputEvent = event as InputEvent;
        const authRejection = requireInputAuthorized();
        if (authRejection) {
          inputEvent.preventDefault();
          return true;
        }
        if (imeComposing || isCompositionOwnedBeforeInput(inputEvent.inputType)) return false;

        // Every branch below reads `view.state.selection`; adopt the DOM's first.
        adoptDomSelection(_view);

        const inputType = inputEvent.inputType;
        if (inputType === 'insertText' && inputEvent.data != null) {
          const bounded = boundClipboardText(inputEvent.data);
          if (!bounded.ok) {
            recordInputRejection(bounded.rejection);
            inputEvent.preventDefault();
            return true;
          }
          inputEvent.preventDefault();
          const { from, to } = _view.state.selection;
          _view.dispatch(_view.state.tr.insertText(bounded.text, from, to));
          return true;
        }
        if (inputType === 'deleteContentBackward') {
          inputEvent.preventDefault();
          deleteBackward(_view);
          return true;
        }
        if (inputType === 'deleteContentForward') {
          inputEvent.preventDefault();
          deleteForward(_view);
          return true;
        }
        if (inputType === 'insertParagraph') {
          inputEvent.preventDefault();
          splitBlock(_view.state, _view.dispatch);
          return true;
        }
        if (inputType === 'historyUndo') {
          inputEvent.preventDefault();
          doUndo();
          return true;
        }
        if (inputType === 'historyRedo') {
          inputEvent.preventDefault();
          doRedo();
          return true;
        }
        if (inputType === 'insertFromPaste' || inputType === 'insertFromDrop') {
          return false;
        }
        // DELEGATED to ProseMirror and the browser (task M6K.1).
        //
        // These were falling through to the catch-all below, which `preventDefault`s
        // and records `unsupportedInputType` — so Cmd/Ctrl+Backspace, Alt/Option+
        // Backspace, and their forward variants were all silently dead.
        // The bridge had reduced editing to basic character deletion and then
        // rejected everything else, which is strictly worse than raw ProseMirror.
        //
        // Returning false lets the contenteditable perform the edit and PM's own DOM
        // observer reconcile it into a transaction, which is how raw PM behaves — so
        // word and line deletion match the platform exactly instead of being
        // approximated here. The store still updates through `dispatchTransaction`,
        // so the model stays canonical.
        //
        // Safe at the trust boundary: every type here removes a RANGE. None inserts
        // content or carries external data, unlike paste and drop, which keep their
        // bounded handling above.
        if (DELEGATED_TO_PROSEMIRROR.has(inputType)) return false;
        recordInputRejection({
          code: 'unsupportedInputType',
          reason: `beforeinput type ${inputType} is not supported`,
        });
        inputEvent.preventDefault();
        return true;
      },
      compositionstart: () => {
        imeComposing = true;
        onCompositionChange(true);
        lastCompositionCancel = null;
        const range = captureSelectionRange(view.state);
        const anchor = range.anchor;
        const paragraphId = anchor.paragraphId;
        compositionRange = { from: view.state.selection.from, to: view.state.selection.to };
        pendingComposedText = '';
        const selectionStart = Math.min(range.anchor.offset, range.head.offset);
        const selectionEnd = Math.max(range.anchor.offset, range.head.offset);
        compositionSnapshot =
          paragraphId === null
            ? undefined
            : {
                anchor,
                paragraphId,
                paragraphText: paragraphText(session.currentModel(), paragraphId) ?? '',
                selectionStart,
                selectionEnd,
                startRevision: session.revision(),
              };
        return false;
      },
      compositionend: () => {
        const win = inputHost.pmMount.ownerDocument?.defaultView;
        if (win?.requestAnimationFrame) win.requestAnimationFrame(flushComposition);
        else flushComposition();
        return false;
      },
      blur: () => {
        if (imeComposing) flushComposition();
        clearInputState();
        if (ownedPopupDepth === 0) inputHost.blur();
        return false;
      },
    },
    dispatchTransaction(tr) {
      const beforeSel = captureSelection(view.state);
      const next = view.state.apply(tr);
      view.updateState(next);
      if (reconciling) return;
      if (tr.selectionSet && !tr.docChanged) {
        retainedSemanticSelection = null;
        // Tell the engine that ProseMirror moved its own selection (task M6K.1).
        //
        // PM now owns logical Left/Right, Select All, and every word/line jump, and
        // those produce a selection-only transaction that commits nothing. Without
        // this the interaction frame kept the selection from the last COMMIT, so the
        // painted caret stopped tracking the real insertion point the moment the user
        // pressed an arrow — the exact divergence the frame exists to prevent.
        onSelectionChanged();
        return;
      }
      if (!tr.docChanged) return;
      if (imeComposing) {
        pendingCompositionCommit = true;
        if (compositionSnapshot) {
          pendingComposedText = deriveCompositionOverlay(
            compositionSnapshot,
            pmParagraphText(compositionSnapshot.paragraphId)
          );
        }
        return;
      }
      commitEdit(beforeSel);
    },
  });

  function applyAccessibilityDom(): void {
    view.dom.contentEditable = interactionAuthorized ? 'true' : 'false';
    view.dom.setAttribute('contenteditable', interactionAuthorized ? 'true' : 'false');
    reapplyAccessibilityProjectionDom(view.dom, accessibleNamePolicy, atomLabels);
  }
  applyAccessibilityDom();

  function pmParagraphText(paragraphId: string): string {
    let text = '';
    view.state.doc.forEach((node) => {
      if (node.type.name === 'paragraph' && node.attrs.semId === paragraphId)
        text = node.textContent;
    });
    return text;
  }

  function compositionHasNetPmChange(overlay: string, snapshot?: CompositionSnapshot): boolean {
    if (!snapshot) return pendingCompositionCommit;
    return overlay.length > 0;
  }

  function cancelComposition(
    code: CompositionCancelOutcome['code'],
    reason: string,
    anchor?: SelectionAnchor
  ) {
    lastCompositionCancel = { code, reason };
    pendingCompositionCommit = false;
    reprojectFromModel(anchor ?? compositionSnapshot?.anchor ?? captureSelection(view.state), true);
  }

  function applyDeferredRemote() {
    if (!deferredRemote) return;
    deferredRemote = false;
    reprojectFromModel(captureSelection(view.state), true);
    notifyModelChanged();
  }

  function applyPendingCompositionToReprojectedDoc(snapshot: CompositionSnapshot, overlay: string) {
    if (!overlay) return;
    const canonical = paragraphText(session.currentModel(), snapshot.paragraphId) ?? '';
    const mapped = mapCompositionRangeAfterRemote(snapshot, canonical);
    if (!mapped) return;
    const merged = applyCompositionOverlay(
      canonical,
      mapped.selectionStart,
      mapped.selectionEnd,
      overlay
    );
    let innerStart: number | null = null;
    let innerEnd = 0;
    view.state.doc.forEach((node, offset) => {
      if (node.type.name === 'paragraph' && node.attrs.semId === snapshot.paragraphId) {
        innerStart = offset + 1;
        innerEnd = innerStart + node.content.size;
      }
    });
    if (innerStart === null) return;
    reconciling = true;
    view.dispatch(
      view.state.tr.insertText(merged, innerStart, innerEnd).setMeta('addToHistory', false)
    );
    reconciling = false;
  }

  function flushComposition() {
    imeComposing = false;
    onCompositionChange(false);
    const snapshot = compositionSnapshot;
    compositionSnapshot = undefined;
    compositionRange = undefined;
    const overlay = pendingComposedText;
    pendingComposedText = '';
    if (destroyed) return;

    const hadPending = pendingCompositionCommit;
    pendingCompositionCommit = false;
    const anchor = snapshot?.anchor;

    if (
      deferredRemote &&
      snapshot &&
      !remoteChangePreservesCompositionAnchor(
        snapshot,
        paragraphText(session.currentModel(), snapshot.paragraphId) ?? '',
        session.revision()
      )
    ) {
      cancelComposition(
        'remoteInvalidation',
        'remote canonical change intersected the composition anchor'
      );
      applyDeferredRemote();
      return;
    }

    if (deferredRemote && snapshot) {
      reprojectFromModel(snapshot.anchor, false);
      applyPendingCompositionToReprojectedDoc(snapshot, overlay);
    }

    if (hadPending && compositionHasNetPmChange(overlay, snapshot)) {
      const res = commitEdit(anchor);
      if (res.rejected) {
        cancelComposition(
          'capabilityBoundary',
          'composition crossed an unsupported capability boundary'
        );
        applyDeferredRemote();
        return;
      }
      if (res.committed) lastCompositionCancel = null;
    } else if (hadPending && snapshot && overlay.length === 0) {
      lastCompositionCancel = {
        code: 'cancelled',
        reason: 'composition ended without committed text',
      };
      reprojectFromModel(anchor, false);
    }

    applyDeferredRemote();
  }

  const selectionAt = new Map<number, SelectionAnchor>();
  let undoDepth = 0;
  selectionAt.set(0, captureSelection(view.state));

  function notifyModelChanged(): void {
    onModelChanged();
  }

  function reapplyRetainedSelection(): void {
    if (!retainedSemanticSelection || destroyed) return;
    const resolved = resolveSemanticSelection(session, retainedSemanticSelection);
    if (!resolved.ok) return;
    const anchorTarget = retainedSemanticSelection.selection.anchor;
    const atomicId = anchorTarget.kind === 'atomic' ? anchorTarget.objectId : undefined;
    applyAnchorsToView(view, resolved.value, atomicId);
  }

  function commitEdit(beforeSel?: SelectionAnchor): { committed: boolean; rejected: boolean } {
    localCommitDepth += 1;
    try {
      const res = session.applyPmDoc(view.state.doc);
      if (res.rejected) {
        reprojectFromModel(undefined, false);
        return { committed: false, rejected: true };
      }
      if (res.committed) {
        retainedSemanticSelection = null;
        clearInputRejectionOnCommit();
        if (beforeSel) selectionAt.set(undoDepth, beforeSel);
        undoDepth += 1;
        syncSemIds();
        selectionAt.set(undoDepth, captureSelection(view.state));
        notifyModelChanged();
        return { committed: true, rejected: false };
      }
      return { committed: false, rejected: false };
    } finally {
      localCommitDepth -= 1;
    }
  }

  function reprojectFromModel(anchor?: SelectionAnchor, reapplySemantic = false) {
    reconciling = true;
    const a = anchor ?? captureSelection(view.state);
    const canonical = session.projectDoc();
    const tr = view.state.tr
      .replaceWith(0, view.state.doc.content.size, canonical.content)
      .setMeta('addToHistory', false);
    try {
      tr.setSelection(resolveSelection(a, tr.doc));
    } catch {
      // Fall back to default mapped selection.
    }
    view.dispatch(tr);
    reconciling = false;
    applyAccessibilityDom();
    if (reapplySemantic) reapplyRetainedSelection();
  }

  function doUndo(): boolean {
    if (session.undo()) {
      undoDepth = Math.max(0, undoDepth - 1);
      reprojectFromModel(selectionAt.get(undoDepth), false);
      notifyModelChanged();
    }
    return true;
  }

  function doRedo(): boolean {
    if (session.redo()) {
      undoDepth += 1;
      reprojectFromModel(selectionAt.get(undoDepth), false);
      notifyModelChanged();
    }
    return true;
  }

  function syncSemIds() {
    const ids = session.bodyBlockIds();
    let tr = view.state.tr;
    let changed = false;
    let idx = 0;
    view.state.doc.forEach((node, offset) => {
      const id = ids[idx];
      if (node.type.name === 'paragraph' && id && node.attrs.semId !== id) {
        tr = tr.setNodeMarkup(offset, undefined, { ...node.attrs, semId: id });
        changed = true;
      }
      idx += 1;
    });
    if (!changed) return;
    reconciling = true;
    view.dispatch(tr.setMeta('addToHistory', false));
    reconciling = false;
    applyAccessibilityDom();
  }

  function applySemanticSelection(request: SemanticSelectionSyncRequest): InteractionOutcome<void> {
    const resolved = resolveSemanticSelection(session, request);
    if (!resolved.ok) return resolved;
    const anchorTarget = request.selection.anchor;
    const atomicId = anchorTarget.kind === 'atomic' ? anchorTarget.objectId : undefined;
    if (!applyAnchorsToView(view, resolved.value, atomicId)) {
      return {
        ok: false,
        code: 'invalidTarget',
        reason: 'semantic selection did not resolve in the ProseMirror projection',
        frameId: request.frameId,
      };
    }
    retainedSemanticSelection = request;
    semanticSelectionEverApplied = true;
    return { ok: true, value: undefined, frameId: request.frameId };
  }

  const surface: EditSurface = {
    editable: interactionAuthorized,
    interactionAuthorized,
    semanticProjectionAttached: true,
    get inputHostState() {
      return inputHost.assistiveState;
    },
    focus(options) {
      inputAuthorized = false;
      const frameId = options?.sync?.frameId ?? options?.frameId;
      if (visibleProjection) {
        if (!frameId) {
          return {
            ok: false,
            code: 'invalidTarget',
            reason: 'focus requires current interaction frame identity',
          };
        }
        view.focus();
        if (interactionAuthorized) {
          semanticSelectionEverApplied = true;
          inputAuthorized = true;
        }
        return { ok: true, value: undefined, frameId };
      }
      if (layoutPending && frameId) return pendingLayoutOutcome(frameId);
      if (options?.sync) {
        const synced = applySemanticSelection(options.sync);
        if (!synced.ok) return synced;
        if (layoutPending) return pendingLayoutOutcome(options.sync.frameId);
        view.focus();
        if (interactionAuthorized) inputAuthorized = true;
        return synced;
      }
      if (retainedSemanticSelection) {
        if (!frameId) {
          return {
            ok: false,
            code: 'invalidTarget',
            reason: 'focus requires current interaction frame identity',
          };
        }
        // The stale-frame guard stays: a caller that does not hold the frame the
        // retained selection belongs to must not be granted input authorization.
        // What changed is that the ENGINE now keeps the retained tag current via
        // `retainSelectionOnFrame`, so this check tests the caller rather than
        // failing on an unavoidable race. See that method for the history.
        if (retainedSemanticSelection.frameId.value !== frameId.value) {
          return {
            ok: false,
            code: 'staleFrame',
            reason: 'retained semantic selection belongs to a superseded interaction frame',
            frameId,
          };
        }
        const synced = applySemanticSelection(retainedSemanticSelection);
        if (!synced.ok) return synced;
        if (layoutPending) return pendingLayoutOutcome(frameId);
        view.focus();
        if (interactionAuthorized) inputAuthorized = true;
        return synced;
      }
      if (!frameId) {
        return {
          ok: false,
          code: 'invalidTarget',
          reason: 'focus requires current interaction frame identity',
        };
      }
      view.focus();
      // Re-authorize input on this branch too.
      //
      // `focus()` clears `inputAuthorized` at the top and only the two branches
      // above restored it. `commitEdit` nulls the retained selection on every
      // commit, so after any typed edit `focus()` fell through to here, returned
      // `ok: true`, and left input UNAUTHORIZED — round-4 review measured the next
      // keystrokes being dropped entirely while the call reported success. A
      // successful focus that cannot accept a keystroke is worse than the
      // `staleFrame` refusal it replaced, because nothing signals the failure.
      //
      // Reaching here means the caller supplied the current frame id and there is
      // no retained selection to re-apply, which is a legitimate focus: the same
      // condition the two branches above authorize under — PROVIDED a semantic
      // selection was established at some point. Without that proviso this would
      // hand input authorization to any caller holding a frame id, which is a
      // separate asserted property.
      if (interactionAuthorized && semanticSelectionEverApplied) inputAuthorized = true;
      return { ok: true, value: undefined, frameId };
    },
    blur() {
      if (ownedPopupDepth > 0) return;
      view.dom.blur();
      clearInputState();
      inputHost.blur();
    },
    destroy() {
      destroyed = true;
      clearInputState();
      imeComposing = false;
      pendingCompositionCommit = false;
      pendingComposedText = '';
      compositionSnapshot = undefined;
      compositionRange = undefined;
      unsub();
      view.destroy();
      inputHost.destroy();
    },
    syncSemanticSelection: applySemanticSelection,
    updateInputHostPlacement(request) {
      const placement = inputHost.updatePlacement(request);
      if (visibleProjection) {
        layoutPending = false;
      } else if (placement.reason === 'pendingLayout') {
        layoutPending = true;
        clearInputState();
      } else if (placement.reason === 'applied') {
        layoutPending = false;
      }
      return placement;
    },
    retainSelectionForOwnedPopup() {
      ownedPopupDepth += 1;
    },
    releaseOwnedPopup() {
      ownedPopupDepth = Math.max(0, ownedPopupDepth - 1);
    },
    retainSelectionOnFrame(frameId) {
      if (!retainedSemanticSelection) return;
      // Both ids: `SemanticSelection` carries its own, and
      // `resolveSemanticSelection` rejects a request whose two ids disagree.
      retainedSemanticSelection = {
        ...retainedSemanticSelection,
        frameId,
        selection: { ...retainedSemanticSelection.selection, frameId },
      };
    },
    getSelectionAnchor: () => captureSelection(view.state),
    getSelectionRange: () => captureSelectionRange(view.state),
    getPmSelection: () => ({
      from: view.state.selection.from,
      to: view.state.selection.to,
      empty: view.state.selection.empty,
    }),
    getCompositionObservation: () => observeComposition(imeComposing, lastCompositionCancel),
    getInputObservation: () => observeInput(lastInputRejection),
    runEditCommand: (command, options): EditSurfaceCommandResult => {
      const dryRun = options?.dryRun === true;
      if (!interactionAuthorized) {
        return { ok: false, code: 'readOnly', reason: 'the semantic projection is read-only' };
      }
      if (destroyed) {
        return { ok: false, code: 'readOnly', reason: 'the edit surface was destroyed' };
      }
      if (command.kind === 'undo' || command.kind === 'redo') {
        // History is always available on an editable surface; an undo at the
        // bottom of the stack still reports ok with changed:false.
        if (dryRun) return { ok: true, changed: false };
        const before = undoDepth;
        if (command.kind === 'undo') doUndo();
        else doRedo();
        return { ok: true, changed: undoDepth !== before };
      }
      if (!TOGGLEABLE_MARKS.has(command.mark)) {
        return { ok: false, code: 'unsupported', reason: `mark ${command.mark} is not toggleable` };
      }
      const markType = view.state.schema.marks[command.mark];
      if (!markType) {
        return {
          ok: false,
          code: 'unsupported',
          reason: `mark ${command.mark} is not in the schema`,
        };
      }
      const toggle = toggleMark(markType);
      if (dryRun) return { ok: true, changed: toggle(view.state) };
      const changed = toggle(view.state, view.dispatch);
      return { ok: true, changed };
    },
    getAccessibilityObservation: (request) =>
      observeAccessibilityFromSession(
        session,
        request,
        captureAccessibilityState({
          view,
          scope: request.scope,
          editable: interactionAuthorized,
          name: accessibleNamePolicy,
          frameId: request.frameId,
          owner: 'proseMirrorInputHost',
          paintedPagesAssistiveRole: 'presentation',
        })
      ),
  };

  const unsub = session.subscribe(() => {
    if (destroyed || reconciling || localCommitDepth > 0) return;
    if (imeComposing) {
      deferredRemote = true;
      return;
    }
    reprojectFromModel(captureSelection(view.state), true);
    notifyModelChanged();
  });

  const priorDestroy = surface.destroy.bind(surface);
  surface.destroy = () => {
    priorDestroy();
    // Drop this document's capsule refs. Without it a ref minted while an attacker's
    // document was open still resolved after the victim's document replaced it, and the
    // attacker's verbatim `w:rPr` bytes could be written into the victim's package.
    releaseCapsuleRefs();
  };

  if (options.testHooks?.onReady) {
    const flushFrames = (): Promise<void> =>
      new Promise((resolve) => {
        const raf = inputHost.pmMount.ownerDocument?.defaultView?.requestAnimationFrame;
        if (typeof raf === 'function') raf(() => raf(() => resolve()));
        else resolve();
      });
    const dispatchCompositionEvent = (type: string, data = '') => {
      view.dom.dispatchEvent(new CompositionEvent(type, { bubbles: true, cancelable: true, data }));
    };
    const replaceComposedText = (text: string) => {
      if (!compositionRange)
        compositionRange = { from: view.state.selection.from, to: view.state.selection.to };
      const { from, to } = compositionRange;
      if (text.length === 0) {
        if (to > from) view.dispatch(view.state.tr.delete(from, to));
        compositionRange = { from, to: from };
        return;
      }
      view.dispatch(view.state.tr.insertText(text, from, to));
      compositionRange = { from, to: from + text.length };
    };
    const pushCompositionUpdate = (text: string) => {
      replaceComposedText(text);
      dispatchCompositionEvent('compositionupdate', text);
    };
    options.testHooks.onReady({
      pmSelection: () => ({
        from: view.state.selection.from,
        to: view.state.selection.to,
        empty: view.state.selection.empty,
      }),
      stripBlockEmbed(objectId: string) {
        let pos: number | null = null;
        view.state.doc.forEach((node, offset) => {
          if (pos !== null) return;
          if (node.type.name === 'blockEmbed' && node.attrs.semId === objectId) pos = offset;
        });
        if (pos === null) return;
        reconciling = true;
        view.dispatch(view.state.tr.delete(pos, pos + 1).setMeta('addToHistory', false));
        reconciling = false;
      },
      readPmParagraph(paragraphId: string) {
        return pmParagraphText(paragraphId);
      },
      beginComposition() {
        view.focus();
        dispatchCompositionEvent('compositionstart');
      },
      pushCompositionUpdate,
      async endComposition(finalText?: string) {
        if (finalText !== undefined) pushCompositionUpdate(finalText);
        dispatchCompositionEvent('compositionend', finalText ?? '');
        await flushFrames();
      },
      async compose(opts) {
        view.focus();
        dispatchCompositionEvent('compositionstart');
        for (let i = 0; i < opts.updates.length; i += 1) {
          pushCompositionUpdate(opts.updates[i]!);
          if (i === 0 && opts.during) opts.during();
        }
        if (opts.end === false) return;
        if (opts.cancel) {
          pushCompositionUpdate('');
          dispatchCompositionEvent('compositionend', '');
        } else {
          const finalText = opts.final ?? opts.updates[opts.updates.length - 1] ?? '';
          const lastUpdate = opts.updates[opts.updates.length - 1] ?? '';
          if (finalText !== lastUpdate) pushCompositionUpdate(finalText);
          dispatchCompositionEvent('compositionend', finalText);
        }
        await flushFrames();
      },
    });
  }

  return surface;
}
