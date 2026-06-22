/**
 * Image clipboard + replace helpers. Pure DOM/PM operations — every
 * function takes the view as a parameter so they're testable and don't
 * close over Vue refs.
 *
 * `copyImageToClipboard` emits both `text/html` (so a subsequent paste
 * re-creates a PM image node via `pasteFromClipboard`) and a `text/plain`
 * fallback. `pasteFromClipboard` walks the clipboard items looking for
 * an image blob first, then an HTML payload carrying our custom data
 * attributes, then plain text.
 */

import type { EditorView } from 'prosemirror-view';
import { makeRevisionInfo } from '@eigenpal/docx-editor-core/prosemirror/plugins';
import type { Node as PMNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';

/**
 * Apply the `insertion` mark to the just-replaced image when suggesting
 * mode is active, so clipboard-pasted images round-trip as tracked
 * additions. Run after replaceSelectionWith on the SAME tr.
 */
function tagPastedImageAsInsertion(view: EditorView, tr: Transaction, imageNode: PMNode): void {
  const info = makeRevisionInfo(view.state);
  const insertionType = view.state.schema.marks.insertion;
  if (!info || !insertionType) return;
  // After replaceSelectionWith, the image lives at the prior selection's
  // start position (mapped). The cursor sits just after it.
  const to = tr.selection.from;
  const from = to - imageNode.nodeSize;
  if (from < 0) return;
  tr.addMark(
    from,
    to,
    insertionType.create({
      revisionId: info.revisionId,
      author: info.author,
      date: info.date,
    })
  );
}

/**
 * `ClipboardItem.getBlob(type)` is non-standard but ships in current
 * Chromium/WebKit; the standard alternative is `getType(type)` (also
 * Promise<Blob>). Cast inline so this module stays in lockstep with the
 * pre-extraction call sites.
 */
function getBlob(item: ClipboardItem, type: string): Promise<Blob> {
  return (item as unknown as { getBlob: (t: string) => Promise<Blob> }).getBlob(type);
}

export function copyImageToClipboard(view: EditorView, pmPos: number): void {
  const node = view.state.doc.nodeAt(pmPos);
  if (!node || node.type.name !== 'image') return;

  const src = node.attrs.src as string;
  const imgHtml = `<img src="${src}" data-pm-image="true" data-width="${node.attrs.width ?? ''}" data-height="${node.attrs.height ?? ''}" data-wrap-type="${node.attrs.wrapType ?? ''}" data-display-mode="${node.attrs.displayMode ?? ''}" data-rid="${node.attrs.rId ?? ''}" />`;

  const clipboardItem = new ClipboardItem({
    'text/html': new Blob([imgHtml], { type: 'text/html' }),
    'text/plain': new Blob(['[image]'], { type: 'text/plain' }),
  });
  navigator.clipboard.write([clipboardItem]).catch(() => {
    // Fallback: at least copy as HTML
    const ta = document.createElement('textarea');
    ta.value = imgHtml;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function loadImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 200, height: 200 });
    img.src = src;
  });
}

/**
 * HTML emitted by {@link copyImageToClipboard} is just a single tagged `<img>`
 * wrapper; it is handled by the manual image branch below so dimensions/rIds
 * round-trip. Everything else (Word, web pages) is real document content that
 * must go through the normal paste pipeline.
 */
function isOwnImageHtml(html: string): boolean {
  return html.includes('data-pm-image="true"');
}

export async function pasteFromClipboard(view: EditorView): Promise<void> {
  try {
    const items = await navigator.clipboard.read();

    // Word (and many rich editors) place a bitmap snapshot of the selection on the
    // clipboard alongside the real text/html. Route that rich text through the normal
    // paste pipeline — a synthetic paste event into the PM view, mirroring the React
    // context-menu paste and the keyboard-paste guard in core's ImagePasteExtension —
    // so text and formatting survive instead of inserting the snapshot as an image.
    let richHtml = '';
    let richText = '';
    for (const item of items) {
      if (!richHtml && item.types.includes('text/html')) {
        richHtml = await (await getBlob(item, 'text/html')).text();
      }
      if (!richText && item.types.includes('text/plain')) {
        richText = await (await getBlob(item, 'text/plain')).text();
      }
    }
    if (richHtml.trim().length > 0 && !isOwnImageHtml(richHtml)) {
      const dt = new DataTransfer();
      dt.items.add(richHtml, 'text/html');
      if (richText) dt.items.add(richText, 'text/plain');
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      view.dom.dispatchEvent(pasteEvent);
      return;
    }

    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith('image/'));
      if (imageType) {
        const blob = await getBlob(item, imageType);
        const dataUrl = await blobToDataUrl(blob);
        const dims = await loadImageDimensions(dataUrl);
        const maxW = 612;
        let w = dims.width,
          h = dims.height;
        if (w > maxW) {
          h = Math.round(h * (maxW / w));
          w = maxW;
        }
        const imageNode = view.state.schema.nodes.image.create({
          src: dataUrl,
          width: w,
          height: h,
          rId: `rId_img_${Date.now()}`,
          wrapType: 'inline',
          displayMode: 'inline',
        });
        const tr = view.state.tr.replaceSelectionWith(imageNode);
        tagPastedImageAsInsertion(view, tr, imageNode);
        view.dispatch(tr);
        return;
      }

      if (item.types.includes('text/html')) {
        const htmlBlob = await getBlob(item, 'text/html');
        const html = await htmlBlob.text();
        const match = html.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
        if (match && match[1]) {
          const src = match[1];
          const widthMatch = html.match(/data-width="(\d+)"/);
          const heightMatch = html.match(/data-height="(\d+)"/);
          const w = widthMatch ? Number(widthMatch[1]) : 200;
          const h = heightMatch ? Number(heightMatch[1]) : 200;
          const imageNode = view.state.schema.nodes.image.create({
            src,
            width: w || 200,
            height: h || 200,
            rId: `rId_img_${Date.now()}`,
            wrapType: 'inline',
            displayMode: 'inline',
          });
          const tr = view.state.tr.replaceSelectionWith(imageNode);
          tagPastedImageAsInsertion(view, tr, imageNode);
          view.dispatch(tr);
          return;
        }
      }

      if (item.types.includes('text/plain')) {
        const textBlob = await getBlob(item, 'text/plain');
        const text = await textBlob.text();
        if (text && text !== '[image]') {
          const { from } = view.state.selection;
          view.dispatch(view.state.tr.insertText(text, from));
        }
        return;
      }
    }
  } catch {
    // Fallback for browsers without clipboard API
    const text = await navigator.clipboard?.readText();
    if (text) {
      const { from } = view.state.selection;
      view.dispatch(view.state.tr.insertText(text, from));
    }
  }
}

export function triggerReplaceImage(view: EditorView, pmPos: number): void {
  const node = view.state.doc.nodeAt(pmPos);
  if (!node || node.type.name !== 'image') return;

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const dataUrl = await blobToDataUrl(file);
    const dims = await loadImageDimensions(dataUrl);

    // Keep existing dimensions unless the aspect ratio is wildly different;
    // scale the new image to fit within the old bounding box.
    const oldW = (node.attrs.width as number) || dims.width;
    const oldH = (node.attrs.height as number) || dims.height;
    const scale = Math.min(oldW / dims.width, oldH / dims.height);
    const newW = Math.round(dims.width * scale);
    const newH = Math.round(dims.height * scale);

    try {
      const tr = view.state.tr.setNodeMarkup(pmPos, undefined, {
        ...node.attrs,
        src: dataUrl,
        width: newW,
        height: newH,
        rId: `rId_img_${Date.now()}`,
      });
      view.dispatch(tr);
    } catch {
      // position may have changed
    }
  };
  input.click();
}
