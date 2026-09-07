import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import { shiftInlineDrawingRecord } from './drawing-layout.ts';
import { framedTokenJoin } from './layout-cache.ts';
import type {
  BlockFragmentRecord,
  LayoutBox,
  ParagraphFragmentRecord,
} from './semantic-records.ts';

const MAX_FRAME_PT = 1584;
const MAX_FRAME_NODES = 10000;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Numeric, auto-height text frames. Other frame variants retain ordinary flow. */
export interface ParagraphFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly horizontalAnchor: 'page' | 'margin' | 'text';
  readonly verticalAnchor: 'page' | 'margin' | 'text';
  /** Equal authored frame properties group adjacent paragraphs into one frame. */
  readonly token: string;
  readonly wrap: 'around' | 'none' | 'notBeside';
  readonly hSpace: number;
  readonly vSpace: number;
}

function coordinate(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d{1,8}$/.test(value)) return null;
  const points = Number(value) / 20;
  return Math.abs(points) <= MAX_FRAME_PT ? points : null;
}

/** Reject content whose pagination or external anchors need a separate frame story. */
export function supportsParagraphFrameContent(paragraph: OoxmlElement): boolean {
  const pending = [paragraph];
  let count = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++count > MAX_FRAME_NODES || node.namespaceUri !== W) return false;
    if (
      [
        'drawing',
        'pict',
        'object',
        'sectPr',
        'footnoteReference',
        'endnoteReference',
        'pageBreakBefore',
        'ins',
        'del',
        'moveFrom',
        'moveTo',
        'pPrChange',
        'rPrChange',
      ].includes(node.localName)
    )
      return false;
    if (
      node.localName === 'br' &&
      node.attributes.some((attr) => attr.localName === 'type' && attr.value !== 'textWrapping')
    )
      return false;
    if (count + pending.length + node.children.length > MAX_FRAME_NODES) return false;
    for (const child of node.children) if (child.kind !== 'textValue') pending.push(child);
  }
  return true;
}

export function readParagraphFrame(properties: readonly OoxmlProperty[]): ParagraphFrame | null {
  let property: OoxmlProperty | undefined;
  for (const item of properties) if (item.localName === 'framePr') property = item;
  if (!property?.attributes) return null;
  const attributes = property.attributes;
  const allowed = new Set([
    'x',
    'y',
    'w',
    'hAnchor',
    'vAnchor',
    'wrap',
    'anchorLock',
    'hSpace',
    'vSpace',
  ]);
  if (Object.keys(attributes).some((name) => !allowed.has(name))) return null;
  const wrap = attributes.wrap ?? 'around';
  if (!['around', 'none', 'notBeside'].includes(wrap)) return null;
  const hSpace = coordinate(attributes.hSpace ?? '0'),
    vSpace = coordinate(attributes.vSpace ?? '0');
  if (hSpace === null || vSpace === null || hSpace < 0 || vSpace < 0) return null;
  if (
    attributes.anchorLock !== undefined &&
    !['0', '1', 'true', 'false', 'on', 'off'].includes(attributes.anchorLock)
  )
    return null;
  const x = coordinate(attributes.x),
    y = coordinate(attributes.y),
    width = coordinate(attributes.w);
  if (x === null || y === null || width === null || width <= 0) return null;
  // Word defaults both anchors to text (MS-OE376 2.1.48).
  const horizontalAnchor = attributes.hAnchor ?? 'text';
  const verticalAnchor = attributes.vAnchor ?? 'text';
  if (
    !['page', 'margin', 'text'].includes(horizontalAnchor) ||
    !['page', 'margin', 'text'].includes(verticalAnchor)
  )
    return null;
  // Earlier-text reflow is outside this lane; preserve upward text frames in ordinary flow.
  if (verticalAnchor === 'text' && y < 0) return null;
  const token = framedTokenJoin(
    Object.keys(attributes)
      .sort()
      .map((key) => framedTokenJoin([key, attributes[key]!]))
  );
  return {
    x,
    y,
    width,
    wrap: wrap as ParagraphFrame['wrap'],
    hSpace,
    vSpace,
    horizontalAnchor: horizontalAnchor as ParagraphFrame['horizontalAnchor'],
    verticalAnchor: verticalAnchor as ParagraphFrame['verticalAnchor'],
    token,
  };
}

/** Reference origins use page-content coordinates, including negative page origins. */
export interface ParagraphFrameOrigins {
  readonly page: { readonly x: number; readonly y: number };
  readonly margin: { readonly x: number; readonly y: number };
  readonly text: { readonly x: number; readonly y: number };
}

/** Translate all published geometry together; source ranges and paragraph alignment stay authored. */
export function positionParagraphFrame(
  fragment: ParagraphFragmentRecord,
  frame: ParagraphFrame,
  origins: ParagraphFrameOrigins
): ParagraphFragmentRecord {
  const dx = origins[frame.horizontalAnchor].x + frame.x;
  const dy = origins[frame.verticalAnchor].y + frame.y;
  const move = (box: LayoutBox): LayoutBox => ({ ...box, x: box.x + dx, y: box.y + dy });
  return {
    ...fragment,
    outOfFlow: true,
    box: move(fragment.box),
    ...(fragment.shadingBox ? { shadingBox: move(fragment.shadingBox) } : {}),
    ...(fragment.bottomBorder
      ? { bottomBorder: { ...fragment.bottomBorder, box: move(fragment.bottomBorder.box) } }
      : {}),
    ...(fragment.borders
      ? { borders: fragment.borders.map((border) => ({ ...border, box: move(border.box) })) }
      : {}),
    ...(fragment.marker ? { marker: { ...fragment.marker, box: move(fragment.marker.box) } } : {}),
    lines: fragment.lines.map((line) => ({
      ...line,
      box: move(line.box),
      contentX: line.contentX + dx,
      spans: line.spans.map((span) => ({ ...span, box: move(span.box) })),
      ...(line.drawings
        ? { drawings: line.drawings.map((drawing) => shiftInlineDrawingRecord(drawing, dx, dy)) }
        : {}),
    })),
  };
}

/** A continuous section starts below prior frame ink when exclusion zones cannot cross sections. */
export function positionedFrameBottom(blocks: readonly BlockFragmentRecord[]): number {
  let bottom = 0;
  for (const block of blocks) {
    if (block.kind !== 'paragraph' || !block.positionedFrame) continue;
    const { box, vSpace } = block.positionedFrame;
    bottom = Math.max(bottom, box.y + box.height + vSpace);
  }
  return bottom;
}
