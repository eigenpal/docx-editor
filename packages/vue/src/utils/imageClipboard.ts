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

export async function pasteFromClipboard(view: EditorView): Promise<void> {
  try {
    const items = await navigator.clipboard.read();
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
        view.dispatch(view.state.tr.replaceSelectionWith(imageNode));
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
          view.dispatch(view.state.tr.replaceSelectionWith(imageNode));
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
