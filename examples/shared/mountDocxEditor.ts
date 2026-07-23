// Framework-agnostic DOCX editor mount for the demos (queue item 3). The PM-aware edit surface now
// lives in the production engine (@docx-editor.dev/engine-binding mountEditSurface); this file only
// composes it with the paginated PAINT (engine-layout/output via createPagePainter) and the DOM
// layout the demos want — a two-pane view: the ProseMirror EDIT surface (left) and the paginated
// DISPLAY the canonical model repaints into (right). A document with tables/SDTs opens READ-ONLY
// through the engine preview (real geometry, nothing flattened). Exposes an engine-neutral
// EditorDriver for browser smoke tests.

import { openDocxSession, mountEditSurface } from '@docx-editor.dev/engine-binding';
import { renderDocxPreview, createPagePainter } from './enginePreview.ts';

/** Engine-neutral test/automation boundary — identical shape in both adapters. */
export interface EditorDriver {
  readonly editable: boolean;
  /** Body text from the CANONICAL model (not the ProseMirror view). */
  getBodyText(): string;
  /** Prove the round-trip: save the canonical model to DOCX, reopen it, return its body
   *  text. A committed edit must survive this. */
  saveAndReopenText(): string;
}

export interface MountedEditor {
  /** The engine-neutral automation surface (body text, save+reopen, editable). */
  readonly driver: EditorDriver;
  destroy(): void;
}

/** Mount an editor (or read-only preview) for `bytes` into `container`. */
export function mountDocxEditor(container: HTMLElement, bytes: Uint8Array): MountedEditor {
  const session = openDocxSession(bytes);
  const driver: EditorDriver = {
    editable: session.editable,
    getBodyText: () => session.bodyText(),
    saveAndReopenText: () => openDocxSession(session.save()).bodyText(),
  };

  if (!session.editable) {
    // Read-only: render the whole document (paragraphs + real tables/SDTs) through the engine
    // preview. Nothing is editable; nothing is flattened.
    renderDocxPreview(bytes, container, {});
    return { driver, destroy: () => container.replaceChildren() };
  }

  // Two panes: the ProseMirror EDIT surface (left) and the paginated DISPLAY the canonical model
  // repaints into (right). Typing updates store.model through the edit surface, then the paginated
  // pane is re-laid-out from store.model — so the visible page reflects canonical state.
  const doc = container.ownerDocument ?? document;
  container.replaceChildren();
  container.classList.add('docx-editable');
  container.style.cssText = 'display:flex; gap:16px; height:100%; min-height:0';
  const editPane = doc.createElement('div');
  editPane.className = 'docx-edit-pane';
  editPane.style.cssText = 'flex:0 0 42%; min-width:0; overflow:auto; padding:8px 12px; outline:none';
  const pagedPane = doc.createElement('div');
  pagedPane.className = 'docx-paged-pane';
  pagedPane.style.cssText = 'flex:1; min-width:0; overflow:auto; background:#eceff1; padding:12px';
  container.append(editPane, pagedPane);

  // The paginated pane re-lays-out the model, but an INCREMENTAL painter patches only the pages
  // whose display items changed (reusing unchanged pages' DOM). Typing commits one edit per
  // keystroke, so the paint is additionally coalesced with requestAnimationFrame: many commits
  // within a frame collapse to ONE patch from the latest canonical model. (No rAF — e.g. a headless
  // environment — paints inline.)
  const painter = createPagePainter(pagedPane, doc, {});
  const raf = (container.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : undefined))
    ?.requestAnimationFrame;
  let repaintQueued = false;
  let disposed = false; // guards deferred rAF repaint against a torn-down mount
  const paintNow = () => painter.paint(session.currentModel());
  const repaintPaged = () => {
    if (!raf) return paintNow();
    if (repaintQueued) return;
    repaintQueued = true;
    raf(() => {
      repaintQueued = false;
      if (!disposed) paintNow();
    });
  };

  // The PM-aware edit surface (from the engine) drives the store; we only repaint on its changes.
  const surface = mountEditSurface(editPane, session, { onModelChanged: repaintPaged });
  paintNow(); // initial paginated render from the loaded model — synchronous so it's visible at once
  return {
    driver,
    destroy: () => {
      disposed = true; // stop any queued rAF repaint from touching a torn-down pane
      surface.destroy();
    },
  };
}
