// Bounded `data:`-URI image projection for the external-HTML read lane — split from
// clipboard-html-read.ts at the max-lines cap. Never fetches: the base64 decode is
// size-capped BEFORE any allocation and the bytes are magic-byte sniffed.

import { sniffImageMime, validateRasterHeader } from '../store/package/image-resources.ts';
import { imageDimensionPx, parseInlineStyle } from './clipboard-html-styles.ts';

const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/** Strict bounded base64 decode: the size cap applies BEFORE any allocation. */
function decodeBase64(data: string, maxBytes: number): Uint8Array | null {
  if (data.length === 0 || data.length % 4 !== 0) return null;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const byteLength = (data.length / 4) * 3 - padding;
  if (byteLength <= 0 || byteLength > maxBytes) return null;
  const out = new Uint8Array(byteLength);
  let at = 0;
  for (let i = 0; i < data.length; i += 4) {
    let chunk = 0;
    let bits = 0;
    for (let j = 0; j < 4; j += 1) {
      const code = data.charCodeAt(i + j);
      if (code === 0x3d) {
        // `=` only in the final positions.
        if (i + j < data.length - padding) return null;
        continue;
      }
      const value = code < 128 ? BASE64_LOOKUP[code]! : -1;
      if (value < 0) return null;
      chunk = (chunk << 6) | value;
      bits += 6;
    }
    chunk <<= 24 - bits;
    if (bits >= 12) out[at++] = (chunk >>> 16) & 0xff;
    if (bits >= 18) out[at++] = (chunk >>> 8) & 0xff;
    if (bits >= 24) out[at++] = chunk & 0xff;
  }
  return at === byteLength ? out : null;
}

const DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|jpg|gif|emf);base64,([A-Za-z0-9+/=]+)$/i;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The projection state slice the image lane reads and advances. */
export interface HtmlImageProjectionState {
  readonly maxImageBytes: number;
  readonly wordHtml: boolean;
  imageCount: number;
  docPrId: number;
  readonly media: Map<string, Uint8Array>;
  readonly mediaExtensions: Map<string, string>;
}

/** Project a `data:` image into a media part + rel + inline `w:drawing` run. */
export function projectHtmlImage(
  element: Element,
  runs: string[],
  p: HtmlImageProjectionState,
  allocateImageRel: (target: string) => string
): void {
  const src = element.getAttribute('src');
  if (src === null || src.length > p.maxImageBytes * 2) return;
  const match = DATA_IMAGE_RE.exec(src);
  if (!match) return; // External/blob/http sources drop with no fetch.
  const bytes = decodeBase64(match[1]!, p.maxImageBytes);
  if (bytes === null) return;
  const sniffed = sniffImageMime(bytes);
  if (sniffed !== 'image/png' && sniffed !== 'image/jpeg' && sniffed !== 'image/gif') return;
  const header = validateRasterHeader(bytes, sniffed);

  const style = parseInlineStyle(element);
  let widthPx = imageDimensionPx(element, style, 'width', p.wordHtml);
  let heightPx = imageDimensionPx(element, style, 'height', p.wordHtml);
  // A sniffed image whose header does not parse keeps its declared CSS extents.
  if (header !== null) {
    if (widthPx === null && heightPx === null) {
      widthPx = (header.pixelWidth * 96) / (header.dpiX ?? 96);
      heightPx = (header.pixelHeight * 96) / (header.dpiY ?? 96);
    } else if (widthPx !== null && heightPx === null) {
      heightPx = (widthPx * header.pixelHeight) / header.pixelWidth;
    } else if (widthPx === null && heightPx !== null) {
      widthPx = (heightPx * header.pixelWidth) / header.pixelHeight;
    }
  }
  // Unknown extent falls back to 300x200pt.
  const cx = widthPx === null ? 3_810_000 : clamp(Math.round(widthPx * 9525), 9525, 30_000_000);
  const cy = heightPx === null ? 2_540_000 : clamp(Math.round(heightPx * 9525), 9525, 30_000_000);

  const extension = sniffed === 'image/png' ? 'png' : sniffed === 'image/gif' ? 'gif' : 'jpeg';
  p.imageCount += 1;
  p.media.set(`word/media/image${p.imageCount}.${extension}`, bytes);
  if (!p.mediaExtensions.has(extension)) p.mediaExtensions.set(extension, sniffed);
  const relId = allocateImageRel(`media/image${p.imageCount}.${extension}`);
  p.docPrId += 1;
  runs.push(
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${p.docPrId}" name=""/>` +
      `<wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="${PIC_NS}"><pic:pic>` +
      '<pic:nvPicPr><pic:cNvPr id="0" name="" descr=""/><pic:cNvPicPr/></pic:nvPicPr>' +
      `<pic:blipFill><a:blip r:embed="${relId}"/>` +
      '<a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  );
}
