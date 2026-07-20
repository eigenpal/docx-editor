import { pixelsToEmu } from '@docx-editor.dev/core';
import { insertImageNode, setImageWrapType } from '@docx-editor.dev/core/prosemirror/commands';
import { TextSelection } from '@docx-editor.dev/core/prosemirror';
import type { EditorView } from 'prosemirror-view';

type LayoutTarget = 'inline' | 'squareLeft' | 'squareRight' | 'topAndBottom' | 'behind' | 'inFront';

/** Test-only mirror of painter-model `captureInlinePositionEmu` using public exports + DOM classes. */
function captureInlinePositionEmu(
  imageEl: HTMLElement,
  zoom = 1
): { horizontalEmu: number; verticalEmu: number } | undefined {
  const isDirectInlineImage = imageEl.classList.contains('layout-run-image');
  const isWrappedInlineImage = imageEl.classList.contains('layout-run-image-wrapper');
  if (!isDirectInlineImage && !isWrappedInlineImage) return undefined;
  const measuredEl = isWrappedInlineImage
    ? ((imageEl.querySelector('img.layout-run-image') as HTMLElement | null) ?? imageEl)
    : imageEl;
  const pageContent = imageEl.closest('.layout-page-content') as HTMLElement | null;
  const paragraph = imageEl.closest('.layout-paragraph') as HTMLElement | null;
  if (!pageContent || !paragraph) return undefined;
  const imgRect = measuredEl.getBoundingClientRect();
  const pageRect = pageContent.getBoundingClientRect();
  const paraRect = paragraph.getBoundingClientRect();
  const safeZoom = zoom > 0 ? zoom : 1;
  return {
    horizontalEmu: Math.round(pixelsToEmu((imgRect.left - pageRect.left) / safeZoom)),
    verticalEmu: Math.round(pixelsToEmu((imgRect.top - paraRect.top) / safeZoom)),
  };
}

/**
 * Test-only: insert an image via the same helper the UI uses, then optionally
 * promote it into an anchored layout through the real wrap-type command so
 * tracked-image tests exercise the production PM path.
 */
export async function e2eInsertImage(
  getView: () => EditorView | null | undefined,
  src: string,
  width: number,
  height: number,
  layoutTarget: LayoutTarget,
  autoZoom: number
): Promise<boolean> {
  const view = getView();
  if (!view) return false;
  const insertPos = view.state.selection.from;
  const imageNode = view.state.schema.nodes.image.create({
    src,
    alt: 'test image',
    width,
    height,
    wrapType: 'inline',
    displayMode: 'inline',
  });
  const inserted = insertImageNode(view.state, view.dispatch, imageNode, insertPos);
  if (!inserted || layoutTarget === 'inline') return inserted;

  let inlineEl: HTMLElement | null = null;
  for (let frame = 0; frame < 10 && !inlineEl; frame += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    inlineEl = window.document.querySelector(
      `.layout-run-image[data-doc-from="${insertPos}"], .layout-run-image-wrapper[data-doc-from="${insertPos}"]`
    ) as HTMLElement | null;
  }
  const initialPositionEmu = inlineEl ? captureInlinePositionEmu(inlineEl, autoZoom) : undefined;
  const nextView = getView();
  if (!nextView) return false;
  return setImageWrapType(
    insertPos,
    layoutTarget,
    initialPositionEmu ? { initialPositionEmu } : undefined
  )(nextView.state, nextView.dispatch);
}

/** Test-only: select the first image so Backspace/Delete exercises atom deletion. */
export function e2eSelectFirstImage(getView: () => EditorView | null | undefined): boolean {
  const view = getView();
  if (!view) return false;
  let imgPos: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (imgPos != null) return false;
    if (node.type.name === 'image') {
      imgPos = pos;
      return false;
    }
    return true;
  });
  if (imgPos == null) return false;
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, imgPos, imgPos + 1));
  view.dispatch(tr);
  view.focus();
  return true;
}
