// The picture content control's widget: select the control's drawing, then replace its image.
//
// Word draws a picture control as its image with a picker on the control; a pick swaps the
// image and keeps the drawing's size. The host may own the pick through a `picture` widget
// session; when nobody takes it, the engine opens its own file picker. Either way the bytes
// land through the surface's `replaceImage`, so the trust boundary, the undo unit and the
// mode rules are the ones every image write already has.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { findDrawingOverlayFrameInLayout } from '../layout/semantic-hit-test.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';
import { sniffImageMime, type SupportedImageMime } from '../store/package/image-resources.ts';
import type { ImageIntentResult } from '../store/store/tree-package-images.ts';

/** The `accept` list of the engine's picker: what `replaceImage` takes. */
export const CONTENT_CONTROL_PICTURE_ACCEPT = 'image/png,image/jpeg,image/gif,image/bmp,image/webp';

const SUPPORTED: ReadonlySet<string> = new Set(CONTENT_CONTROL_PICTURE_ACCEPT.split(','));

/** How deep the drawing may sit under `w:sdtContent` (a run, a hyperlink, a nested control). */
const MAX_CONTENT_DEPTH = 8;

export interface ContentControlPictureHost {
  readonly document: Document;
  /** The pages layer; the engine's hidden picker lives here while a pick is open. */
  readonly layer: HTMLElement;
  find(controlId: string): OoxmlElement | null;
  layout(): SemanticLayout;
  selectDrawing(drawingNodeId: string, paragraphId: string): boolean;
  replaceImage(
    drawingNodeId: string,
    bytes: Uint8Array,
    mime: SupportedImageMime
  ): Promise<ImageIntentResult>;
  setOpen(controlId: string, open: boolean): void;
  /** Publish a refusal the way every other widget write does. */
  reject(reason: string): void;
}

/** The drawing node inside a picture control's content, if it holds one. */
export function contentControlDrawingId(control: OoxmlNode | null): string | undefined {
  if (!control || control.kind === 'textValue') return undefined;
  const visit = (node: OoxmlNode, depth: number): string | undefined => {
    if (node.kind === 'textValue' || depth > MAX_CONTENT_DEPTH) return undefined;
    if (node.kind === 'drawing') return node.id;
    if (node.localName === 'sdtPr') return undefined;
    for (const child of node.children) {
      const found = visit(child, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return visit(control, 0);
}

export function createContentControlPictureWidget(host: ContentControlPictureHost) {
  let picker: HTMLInputElement | null = null;
  let pickerControlId: string | null = null;

  const closePicker = () => {
    const open = pickerControlId;
    picker?.remove();
    picker = null;
    pickerControlId = null;
    if (open) host.setOpen(open, false);
  };

  const drawingOf = (controlId: string): string | undefined =>
    contentControlDrawingId(host.find(controlId));

  const replace = async (controlId: string, bytes: Uint8Array): Promise<boolean> => {
    const drawingNodeId = drawingOf(controlId);
    if (!drawingNodeId) {
      host.reject('no-picture');
      return false;
    }
    const mime = sniffImageMime(bytes);
    if (!SUPPORTED.has(mime)) {
      host.reject('unsupported-image');
      return false;
    }
    const result = await host.replaceImage(drawingNodeId, bytes, mime as SupportedImageMime);
    if (!result.ok) {
      host.reject(result.detail ?? result.reason);
      return false;
    }
    return true;
  };

  return {
    drawingOf,
    replace,
    /** Select the control's drawing, as a press on the picture would. */
    select(controlId: string): boolean {
      const drawingNodeId = drawingOf(controlId);
      const frame = drawingNodeId
        ? findDrawingOverlayFrameInLayout(host.layout(), drawingNodeId)
        : null;
      return frame ? host.selectDrawing(drawingNodeId!, frame.record.paragraphId) : false;
    },
    /**
     * The engine's own pick: a file input the widget press opens. The `cancel` event (or
     * the next press, or teardown) closes it without a write; a chosen file replaces.
     */
    pick(controlId: string): void {
      closePicker();
      if (!drawingOf(controlId)) {
        host.reject('no-picture');
        return;
      }
      const input = host.document.createElement('input');
      input.type = 'file';
      input.accept = CONTENT_CONTROL_PICTURE_ACCEPT;
      input.className = 'docx-content-control-picture-picker';
      input.dataset.docxMarker = '';
      input.dataset.docxCcId = controlId;
      input.setAttribute('contenteditable', 'false');
      input.setAttribute('aria-hidden', 'true');
      input.tabIndex = -1;
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        closePicker();
        if (!file) return;
        void file.arrayBuffer().then((buffer) => replace(controlId, new Uint8Array(buffer)));
      });
      input.addEventListener('cancel', closePicker);
      host.layer.append(input);
      picker = input;
      pickerControlId = controlId;
      host.setOpen(controlId, true);
      input.click();
    },
    destroy: closePicker,
  };
}
