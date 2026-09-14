import type { AnchoredDrawingRecord, InlineDrawingRecord } from '@docx-editor.dev/core/layout';
import type { MarkdownImageAsset, MarkdownImageOptions } from './media-types.ts';
import type { MarkdownWarning } from './markdown-types.ts';
import { escapeText } from './markdown-inline.ts';

type Drawing = InlineDrawingRecord | AnchoredDrawingRecord;

export function destination(url: string): string {
  return url.replace(
    /[\u0000-\u0020\u007f<>()\\]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  );
}

export function drawingKey(drawing: Drawing): string {
  return `${drawing.ownerPartName}\0${drawing.drawingNodeId}`;
}

export interface MediaRendering {
  readonly syntax: 'markdown' | 'html';
  readonly assets: readonly MarkdownImageAsset[];
  readonly byDrawing: ReadonlyMap<string, MarkdownImageAsset>;
  readonly represented: Set<string>;
  readonly warnings: MarkdownWarning[];
}

export function createMediaRendering(
  assets: readonly MarkdownImageAsset[],
  syntax: MarkdownImageOptions['syntax'] = 'markdown'
): MediaRendering {
  const byDrawing = new Map<string, MarkdownImageAsset>();
  for (const asset of assets)
    for (const occurrence of asset.occurrences) {
      byDrawing.set(`${occurrence.partName}\0${occurrence.drawingNodeId}`, asset);
    }
  return { syntax, assets, byDrawing, represented: new Set(), warnings: [] };
}

export function imageMarkdown(
  drawing: Drawing,
  media: MediaRendering | undefined,
  tableCell: boolean
): string {
  if (
    !media ||
    drawing.accessibility.hidden ||
    (drawing.kind === 'anchoredDrawing' && drawing.textboxStory)
  )
    return '';
  const key = drawingKey(drawing);
  const asset = media.byDrawing.get(key);
  if (!asset) return '';
  media.represented.add(key);
  const alt = drawing.accessibility.decorative ? '' : (drawing.accessibility.label ?? '');
  if (media.syntax === 'html') {
    const width = Math.round(drawing.width * (96 / 72));
    const height = Math.round(drawing.height * (96 / 72));
    return `<img src="${imageAttribute(asset.url)}" alt="${imageAttribute(alt)}" width="${width}" height="${height}">`;
  }
  // Markdown decodes character references in destinations, and GFM splits raw pipes
  // before parsing inline links. Preserve the URL while protecting both syntaxes.
  const url = destination(asset.url).replace(/&/g, '&amp;').replace(/\|/g, '%7C');
  return `![${escapeText(alt.replace(/[\r\n]+/g, ' '), tableCell)}](${url})`;
}

// Escape HTML attributes and GFM table delimiters. Encode line breaks so generated
// tags stay on one line and cannot terminate a Markdown paragraph or table cell.
function imageAttribute(value: string): string {
  return value.replace(/[&"<>|\r\n\\]/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** One projection's pending anchors. Shared by recursive table-cell renderers only. */
export interface AnchorProjection {
  readonly byParagraph: Map<string, AnchoredDrawingRecord[]>;
}

export function anchorProjection(
  drawings: readonly AnchoredDrawingRecord[],
  media?: MediaRendering
): AnchorProjection {
  const byParagraph = new Map<string, AnchoredDrawingRecord[]>();
  const seen = new Set<string>();
  if (media)
    for (const drawing of drawings) {
      const key = drawingKey(drawing);
      if (seen.has(key) || drawing.textboxStory || !media.byDrawing.has(key)) continue;
      seen.add(key);
      const values = byParagraph.get(drawing.paragraphId) ?? [];
      values.push(drawing);
      byParagraph.set(drawing.paragraphId, values);
    }
  for (const values of byParagraph.values())
    values.sort(
      (a, b) =>
        a.start - b.start ||
        (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0) ||
        a.drawingNodeId.localeCompare(b.drawingNodeId)
    );
  return { byParagraph };
}

export function takeAnchors(
  projection: AnchorProjection | undefined,
  paragraphId: string
): readonly AnchoredDrawingRecord[] {
  const values = projection?.byParagraph.get(paragraphId) ?? [];
  projection?.byParagraph.delete(paragraphId);
  return values;
}

export function remainingAnchors(
  projection: AnchorProjection | undefined,
  media?: MediaRendering,
  pageIndex?: number
): readonly AnchoredDrawingRecord[] {
  const values = Array.from(projection?.byParagraph.values() ?? []).flat();
  projection?.byParagraph.clear();
  for (const drawing of values)
    media?.warnings.push(
      Object.freeze({
        code: 'image-placement-fallback',
        message: `Image ${drawing.drawingNodeId} has no rendered anchor paragraph; it follows this story.`,
        partName: drawing.ownerPartName,
        ...(pageIndex === undefined ? {} : { pageNumber: pageIndex + 1 }),
      })
    );
  return values;
}
