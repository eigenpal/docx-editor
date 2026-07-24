// ProseMirror edit-surface mount (document-engine 4.2; interactive-paginated 4.1–4.2).

import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import type { InteractionFrameId, InteractionOutcome } from '@docx-editor.dev/core-contract/interaction';
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
import type { CompositionObservation } from '@docx-editor.dev/core-contract/interaction';
import { paragraphText } from '@docx-editor.dev/engine-core';

export interface PmSelectionSnapshot {
  readonly from: number;
  readonly to: number;
  readonly empty: boolean;
}

/** A PM-FREE handle to a mounted edit surface — no EditorView or PM type leaks out. */
export interface EditSurface {
  readonly editable: boolean;
  readonly inputHostState: InputHostAssistiveState;
  focus(options?: { sync?: SemanticSelectionSyncRequest; frameId?: InteractionFrameId }): InteractionOutcome<void>;
  blur(): void;
  destroy(): void;
  syncSemanticSelection(request: SemanticSelectionSyncRequest): InteractionOutcome<void>;
  updateInputHostPlacement(request: InputHostPlacementRequest): InputHostPlacement;
  retainSelectionForOwnedPopup(): void;
  releaseOwnedPopup(): void;
  getSelectionAnchor(): SelectionAnchor;
  getSelectionRange(): SelectionRangeAnchors;
  getPmSelection(): PmSelectionSnapshot;
  getCompositionObservation(): CompositionObservation;
}

export interface MountEditSurfaceOptions {
  onModelChanged?: () => void;
  inputHost?: InputHostControllerOptions;
  /** Test-only hook to observe PM doc positions and drive DOM composition. */
  testHooks?: {
    onReady?: (helpers: {
      insertText(text: string): void;
      undo(): void;
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
  atomicObjectId?: string,
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

/** Mount a ProseMirror edit surface for `session`. When read-only, mounts nothing. */
export function mountEditSurface(
  mountParent: HTMLElement,
  session: DocxEditorSession,
  options: MountEditSurfaceOptions = {},
): EditSurface {
  const noopPlacement: InputHostPlacement = {
    clientRect: { x: 8, y: 8, width: 200, height: 24 },
    reason: 'fallback',
  };
  const noopState: InputHostAssistiveState = {
    policy: 'sole-editing-projection',
    paintedPagesAssistiveRole: 'presentation',
    hostAttached: false,
    placement: noopPlacement,
  };
  const readOnlyOutcome = (): InteractionOutcome<void> => ({
    ok: false,
    code: 'readOnly',
    reason: 'document is read-only',
  });

  if (!session.editable) {
    return {
      editable: false,
      inputHostState: noopState,
      focus: readOnlyOutcome,
      blur: () => {},
      destroy: () => {},
      syncSemanticSelection: readOnlyOutcome,
      updateInputHostPlacement: () => noopPlacement,
      retainSelectionForOwnedPopup: () => {},
      releaseOwnedPopup: () => {},
      getSelectionAnchor: () => ({ paragraphId: null, offset: 0, affinity: 'after' }),
      getSelectionRange: () => ({
        anchor: { paragraphId: null, offset: 0, affinity: 'after' },
        head: { paragraphId: null, offset: 0, affinity: 'after' },
      }),
      getPmSelection: () => ({ from: 0, to: 0, empty: true }),
      getCompositionObservation: () => observeComposition(false, null),
    };
  }

  const onModelChanged = options.onModelChanged ?? (() => {});
  const doc = mountParent.ownerDocument ?? document;
  const inputHost = createInputHostController(doc, options.inputHost);
  mountParent.append(inputHost.root);

  let ownedPopupDepth = 0;
  let retainedSemanticSelection: SemanticSelectionSyncRequest | null = null;
  let localCommitDepth = 0;
  let modelChangedCalls = 0;

  const plugins = [
    keymap({
      'Mod-z': () => doUndo(),
      'Mod-y': () => doRedo(),
      'Shift-Mod-z': () => doRedo(),
    }),
    keymap(baseKeymap),
  ];

  let reconciling = false;
  let pendingCompositionCommit = false;
  let destroyed = false;
  let imeComposing = false;
  let compositionSnapshot: CompositionSnapshot | undefined;
  let compositionRange: { from: number; to: number } | undefined;
  let pendingComposedText = '';
  let deferredRemote = false;
  let lastCompositionCancel: CompositionCancelOutcome | null = null;

  const view = new EditorView(inputHost.pmMount, {
    state: EditorState.create({ doc: session.projectDoc(), plugins }),
    editable: () => session.editable,
    handleDOMEvents: {
      compositionstart: () => {
        imeComposing = true;
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
        return;
      }
      if (!tr.docChanged) return;
      if (imeComposing) {
        pendingCompositionCommit = true;
        if (compositionSnapshot) {
          pendingComposedText = deriveCompositionOverlay(compositionSnapshot, pmParagraphText(compositionSnapshot.paragraphId));
        }
        return;
      }
      commitEdit(beforeSel);
    },
  });

  function pmParagraphText(paragraphId: string): string {
    let text = '';
    view.state.doc.forEach((node) => {
      if (node.type.name === 'paragraph' && node.attrs.semId === paragraphId) text = node.textContent;
    });
    return text;
  }

  function compositionHasNetPmChange(overlay: string, snapshot?: CompositionSnapshot): boolean {
    if (!snapshot) return pendingCompositionCommit;
    return overlay.length > 0;
  }

  function cancelComposition(code: CompositionCancelOutcome['code'], reason: string, anchor?: SelectionAnchor) {
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
    const merged = applyCompositionOverlay(canonical, mapped.selectionStart, mapped.selectionEnd, overlay);
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
    view.dispatch(view.state.tr.insertText(merged, innerStart, innerEnd).setMeta('addToHistory', false));
    reconciling = false;
  }

  function flushComposition() {
    imeComposing = false;
    const snapshot = compositionSnapshot;
    compositionSnapshot = undefined;
    compositionRange = undefined;
    const overlay = pendingComposedText;
    pendingComposedText = '';
    if (destroyed) return;

    const hadPending = pendingCompositionCommit;
    pendingCompositionCommit = false;
    const anchor = snapshot?.anchor;

    if (deferredRemote && snapshot && !remoteChangePreservesCompositionAnchor(
      snapshot,
      paragraphText(session.currentModel(), snapshot.paragraphId) ?? '',
      session.revision(),
    )) {
      cancelComposition('remoteInvalidation', 'remote canonical change intersected the composition anchor');
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
        cancelComposition('capabilityBoundary', 'composition crossed an unsupported capability boundary');
        applyDeferredRemote();
        return;
      }
      if (res.committed) lastCompositionCancel = null;
    } else if (hadPending && snapshot && overlay.length === 0) {
      lastCompositionCancel = { code: 'cancelled', reason: 'composition ended without committed text' };
      reprojectFromModel(anchor, false);
    }

    applyDeferredRemote();
  }

  const selectionAt = new Map<number, SelectionAnchor>();
  let undoDepth = 0;
  selectionAt.set(0, captureSelection(view.state));

  function notifyModelChanged(): void {
    modelChangedCalls += 1;
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
    return { ok: true, value: undefined, frameId: request.frameId };
  }

  const surface: EditSurface = {
    editable: true,
    get inputHostState() {
      return inputHost.assistiveState;
    },
    focus(options) {
      const frameId = options?.sync?.frameId ?? options?.frameId;
      if (options?.sync) {
        const synced = applySemanticSelection(options.sync);
        if (!synced.ok) return synced;
        view.focus();
        return synced;
      }
      if (retainedSemanticSelection) {
        if (!frameId) {
          return { ok: false, code: 'invalidTarget', reason: 'focus requires current interaction frame identity' };
        }
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
        view.focus();
        return synced;
      }
      if (!frameId) {
        return { ok: false, code: 'invalidTarget', reason: 'focus requires current interaction frame identity' };
      }
      view.focus();
      return { ok: true, value: undefined, frameId };
    },
    blur() {
      if (ownedPopupDepth > 0) return;
      view.dom.blur();
      inputHost.blur();
    },
    destroy() {
      destroyed = true;
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
      return inputHost.updatePlacement(request);
    },
    retainSelectionForOwnedPopup() {
      ownedPopupDepth += 1;
    },
    releaseOwnedPopup() {
      ownedPopupDepth = Math.max(0, ownedPopupDepth - 1);
    },
    getSelectionAnchor: () => captureSelection(view.state),
    getSelectionRange: () => captureSelectionRange(view.state),
    getPmSelection: () => ({
      from: view.state.selection.from,
      to: view.state.selection.to,
      empty: view.state.selection.empty,
    }),
    getCompositionObservation: () => observeComposition(imeComposing, lastCompositionCancel),
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
  };

  Object.defineProperty(surface, '__testModelChangedCalls', {
    enumerable: false,
    get: () => modelChangedCalls,
  });

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
      if (!compositionRange) compositionRange = { from: view.state.selection.from, to: view.state.selection.to };
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
      insertText(text: string) {
        const { from, to } = view.state.selection;
        view.dispatch(view.state.tr.insertText(text, from, to));
      },
      undo() {
        doUndo();
      },
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
