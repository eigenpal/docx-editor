// Framework-agnostic DOCX editor mount for the demos (queue item 3). The PM-aware edit surface now
// lives in the production engine (@docx-editor.dev/engine-binding mountEditSurface); this file only
// composes it with the paginated PAINT (engine-layout/output via createPagePainter) and the DOM
// layout the demos want — a two-pane view: the ProseMirror EDIT surface (left) and the paginated
// DISPLAY the canonical model repaints into (right). A document with tables/SDTs opens READ-ONLY
// through the engine preview (real geometry, nothing flattened). Exposes an engine-neutral
// EditorDriver for browser smoke tests.

import { openDocxSession, mountEditSurface } from '@docx-editor.dev/core-contract/binding';
import { layoutBody, type LayoutShapingOptions } from '@docx-editor.dev/core-contract/layout';
import {
  installLayoutFonts,
  type BrowserFontFaceFactory,
  type BrowserFontSet,
  type InstalledDisplayFonts,
} from '../../packages/engine-editor/src/index.ts';
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

export interface MountFontRuntime {
  readonly fontSet: BrowserFontSet;
  readonly createFace?: BrowserFontFaceFactory;
}

/** Mount an editor (or read-only preview) for `bytes` into `container`. */
export async function mountDocxEditor(
  container: HTMLElement,
  bytes: Uint8Array,
  layoutShaping: LayoutShapingOptions,
  fontRuntime?: MountFontRuntime
): Promise<MountedEditor> {
  const session = openDocxSession(bytes);
  const driver: EditorDriver = {
    editable: session.editable,
    getBodyText: () => session.bodyText(),
    saveAndReopenText: () => openDocxSession(session.save()).bodyText(),
  };
  const ownerDocument = container.ownerDocument ?? document;
  const fontSet = fontRuntime?.fontSet ?? (ownerDocument.fonts as unknown as BrowserFontSet);
  let activeFonts: InstalledDisplayFonts | null = null;
  const installedFonts = {
    aliasFor: (font: Parameters<InstalledDisplayFonts['aliasFor']>[0]) => {
      if (!activeFonts) throw new Error('Preview fonts have not been installed');
      return activeFonts.aliasFor(font);
    },
  };
  const installForModel = async (
    model: ReturnType<typeof session.currentModel>
  ): Promise<InstalledDisplayFonts> => {
    const layout = layoutBody(model, {
      pageWidth: 12240,
      pageHeight: 15840,
      margin: 1440,
      shaping: layoutShaping,
    });
    return fontRuntime?.createFace
      ? installLayoutFonts(layout.pages, layoutShaping.fonts, fontSet, fontRuntime.createFace)
      : installLayoutFonts(layout.pages, layoutShaping.fonts, fontSet);
  };

  if (!session.editable) {
    // Read-only: render the whole document (paragraphs + real tables/SDTs) through the engine
    // preview. Nothing is editable; nothing is flattened.
    activeFonts = await installForModel(session.currentModel());
    renderDocxPreview(bytes, container, { shaping: layoutShaping, installedFonts });
    return {
      driver,
      destroy: () => {
        activeFonts?.release();
        activeFonts = null;
        container.replaceChildren();
      },
    };
  }

  // Two panes: the ProseMirror EDIT surface (left) and the paginated DISPLAY the canonical model
  // repaints into (right). Typing updates store.model through the edit surface, then the paginated
  // pane is re-laid-out from store.model — so the visible page reflects canonical state.
  const doc = ownerDocument;
  container.replaceChildren();
  container.classList.add('docx-editable');
  container.style.cssText = 'display:flex; gap:16px; height:100%; min-height:0';
  const editPane = doc.createElement('div');
  editPane.className = 'docx-edit-pane';
  editPane.style.cssText =
    'flex:0 0 42%; min-width:0; overflow:auto; padding:8px 12px; outline:none';
  const pagedPane = doc.createElement('div');
  pagedPane.className = 'docx-paged-pane';
  pagedPane.style.cssText = 'flex:1; min-width:0; overflow:auto; background:#eceff1; padding:12px';
  container.append(editPane, pagedPane);

  // The paginated pane re-lays-out the model, but an INCREMENTAL painter patches only the pages
  // whose display items changed (reusing unchanged pages' DOM). Typing commits one edit per
  // keystroke, so the paint is additionally coalesced with requestAnimationFrame: many commits
  // within a frame collapse to ONE patch from the latest canonical model. (No rAF — e.g. a headless
  // environment — paints inline.)
  const painter = createPagePainter(pagedPane, doc, { shaping: layoutShaping, installedFonts });
  const raf = (
    container.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : undefined)
  )?.requestAnimationFrame;
  let repaintQueued = false;
  let disposed = false; // guards deferred rAF repaint against a torn-down mount
  let paintGeneration = 0;
  const paintNow = async () => {
    const generation = ++paintGeneration;
    const model = session.currentModel();
    const nextFonts = await installForModel(model);
    if (disposed || generation !== paintGeneration) {
      nextFonts.release();
      return;
    }
    const previous = activeFonts;
    activeFonts = nextFonts;
    painter.paint(model);
    previous?.release();
  };
  const repaintPaged = () => {
    if (!raf) {
      void paintNow();
      return;
    }
    if (repaintQueued) return;
    repaintQueued = true;
    raf(() => {
      repaintQueued = false;
      if (!disposed) void paintNow();
    });
  };

  // The PM-aware edit surface (from the engine) drives the store; we only repaint on its changes.
  const surface = mountEditSurface(editPane, session, { onModelChanged: repaintPaged });
  await paintNow();
  return {
    driver,
    destroy: () => {
      disposed = true; // stop any queued rAF repaint from touching a torn-down pane
      paintGeneration += 1;
      activeFonts?.release();
      activeFonts = null;
      surface.destroy();
    },
  };
}
