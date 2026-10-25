// Text frames in a header or footer story that are positioned against their anchor paragraph.
//
// A `w:framePr` paragraph with `w:vAnchor="text"` takes no room in the story: it sits at its
// authored offset from the top of the next ordinary paragraph or table, and horizontally against the
// page, the margins or the column, with `w:xAlign` superseding `w:x`. The story's own text keeps
// its flow, so the frame never changes the height the header or footer reserves.
import {
  WML_NAMESPACE_URI as W,
  type OoxmlElement,
  type OoxmlNode,
} from '../store/package/ooxml-tree.ts';
import {
  paragraphFrameOrigin,
  readParagraphFrame,
  translateParagraphFragment,
  type ParagraphFrame,
} from './paragraph-frame.ts';
import { meetsOrdinaryContent } from './header-positioned-frames.ts';
import type { BlockFragmentRecord, ParagraphFragmentRecord } from './semantic-records.ts';

const MAX_NODES = 4096;
const MAX_GROUPS = 16;
/** Elements a frame paragraph in this lane may not hold. */
const REFUSED = new Set([
  'drawing',
  'pict',
  'object',
  'sectPr',
  'tbl',
  'footnoteReference',
  'endnoteReference',
  'pageBreakBefore',
  'framePr',
  // Page-number frames belong to the fixed footer and header lanes.
  'fldChar',
  'fldSimple',
  'instrText',
]);

type Flow = { readonly blocks: BlockFragmentRecord[]; readonly bottom: number };
const key = (block: BlockFragmentRecord) =>
  block.kind === 'paragraph' ? block.paragraphId : block.tableId;

interface FrameGroup {
  readonly frame: ParagraphFrame;
  readonly paragraphs: readonly OoxmlElement[];
  readonly anchorId: string;
}

function directFrame(paragraph: OoxmlElement): ParagraphFrame | null | undefined {
  const nodes: readonly OoxmlNode[] = paragraph.children;
  const properties = nodes.find((child) => child.kind === 'paragraphProperties');
  const children: readonly OoxmlNode[] =
    properties?.kind === 'paragraphProperties' ? properties.children : [];
  const framed = children.filter(
    (child): child is OoxmlElement =>
      child.kind !== 'textValue' && child.namespaceUri === W && child.localName === 'framePr'
  );
  if (!framed.length) return undefined;
  if (framed.length > 1) return null;
  const attributes: Record<string, string> = {};
  for (const attribute of framed[0]!.attributes) {
    if (attribute.namespaceUri !== W || Object.hasOwn(attributes, attribute.localName)) return null;
    attributes[attribute.localName] = attribute.value;
  }
  return readParagraphFrame([{ localName: 'framePr', attributes }]);
}

/** Bounded text content, fields and revisions only, with at least one visible character. */
function plainContent(paragraph: OoxmlElement): boolean {
  const pending: OoxmlNode[] = [...paragraph.children];
  let count = 0;
  let visible = false;
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === 'textValue') {
      visible ||= node.value.trim().length > 0;
      continue;
    }
    if (++count > MAX_NODES || node.namespaceUri !== W) return false;
    if (node.kind !== 'paragraphProperties' && REFUSED.has(node.localName)) return false;
    if (
      node.localName === 'br' &&
      node.attributes.some((item) => item.localName === 'type' && item.value !== 'textWrapping')
    )
      return false;
    if (node.kind !== 'paragraphProperties') pending.push(...node.children);
  }
  return visible;
}

/** Groups of adjacent frame paragraphs with equal properties, each with its anchor paragraph. */
function textFrameGroups(blocks: readonly OoxmlElement[]): readonly FrameGroup[] | null {
  const groups: { frame: ParagraphFrame; paragraphs: OoxmlElement[] }[] = [];
  const anchored: FrameGroup[] = [];
  let open: { frame: ParagraphFrame; paragraphs: OoxmlElement[] } | undefined;
  for (const block of blocks) {
    const frame = block.kind === 'paragraph' ? directFrame(block) : undefined;
    if (frame === undefined) {
      // The next ordinary block, a paragraph or a table, anchors every group waiting for one.
      for (const group of groups.splice(0)) anchored.push({ ...group, anchorId: block.id });
      open = undefined;
      continue;
    }
    if (
      !frame ||
      frame.verticalAnchor !== 'text' ||
      frame.dropCap !== undefined ||
      frame.autoWidth ||
      frame.xAlign !== undefined ||
      !plainContent(block)
    )
      return null;
    if (open && open.frame.token === frame.token) open.paragraphs.push(block);
    else {
      open = { frame, paragraphs: [block] };
      groups.push(open);
      if (groups.length + anchored.length > MAX_GROUPS) return null;
    }
  }
  return groups.length ? null : anchored;
}

/** Whether the story holds a frame this lane positions; cheap enough for every layout. */
export function hasStoryTextFrames(blocks: readonly OoxmlElement[]): boolean {
  return blocks.some((block) => block.kind === 'paragraph' && directFrame(block) !== undefined);
}

/**
 * Lay out the story without its text-anchored frames, then place each frame against its anchor.
 * Null when any frame falls outside this lane, so the caller keeps ordinary flow for all.
 */
export function placeStoryTextFrames(
  blocks: readonly OoxmlElement[],
  layout: {
    readonly story: (source: readonly OoxmlElement[]) => Flow;
    readonly frame: (paragraphs: readonly OoxmlElement[], width: number) => Flow;
  },
  geometry: {
    readonly contentWidth: number;
    readonly pageWidth?: number;
    readonly marginLeft?: number;
  }
): Flow | null {
  const groups = textFrameGroups(blocks);
  if (!groups?.length) return null;
  const framed = new Set(groups.flatMap((group) => group.paragraphs.map((node) => node.id)));
  const ordinary = layout.story(blocks.filter((block) => !framed.has(block.id)));
  const width = Math.max(1, geometry.contentWidth);
  const marginLeft = geometry.marginLeft ?? 0;
  const pageWidth = geometry.pageWidth ?? width;
  const placed: ParagraphFragmentRecord[] = [];
  for (const group of groups) {
    const anchor = ordinary.blocks.find((block) => key(block) === group.anchorId);
    if (!anchor) return null;
    const frame = group.frame;
    // `textFrameGroups` refuses frames that size their own width, so every frame has one.
    const flow = layout.frame(group.paragraphs, frame.width);
    if (flow.blocks.length !== group.paragraphs.length) return null;
    const fragments = flow.blocks.filter(
      (block): block is ParagraphFragmentRecord => block.kind === 'paragraph'
    );
    if (fragments.length !== flow.blocks.length) return null;
    const contentHeight = flow.bottom;
    const height =
      frame.heightRule === 'exact'
        ? frame.height!
        : frame.heightRule === 'atLeast'
          ? Math.max(contentHeight, frame.height ?? 0)
          : contentHeight;
    const size = { width: frame.width, height };
    const column = { x: 0, y: 0, width, height: Number.MAX_SAFE_INTEGER };
    const origin = paragraphFrameOrigin(
      frame,
      {
        pageNumber: 1,
        page: { x: -marginLeft, y: Number.NEGATIVE_INFINITY, width: pageWidth, height: 0 },
        margin: column,
        text: { ...column, y: anchor.box.y },
      },
      size
    );
    const box = { ...origin, ...size };
    // A frame over the story's own paragraph text would wrap it; that stays in ordinary flow.
    const paragraphs = ordinary.blocks.filter((block) => block.kind === 'paragraph');
    if (meetsOrdinaryContent(box, paragraphs)) return null;
    for (const fragment of fragments) {
      const moved = translateParagraphFragment(fragment, origin.x, origin.y);
      placed.push(
        frame.heightRule === 'exact'
          ? { ...moved, outOfFlow: true, clipToBox: true, box }
          : { ...moved, outOfFlow: true }
      );
    }
  }
  const order = new Map(blocks.map((block, index) => [block.id, index]));
  const all = ordinary.blocks.concat(placed);
  if (all.some((block) => !order.has(key(block)))) return null;
  all.sort((a, b) => order.get(key(a))! - order.get(key(b))!);
  return { blocks: all, bottom: ordinary.bottom };
}

/** Re-lay a header or footer story with its text-anchored frames placed, when it has any. */
export function layoutStoryWithTextFrames(
  blocks: readonly OoxmlElement[],
  story: (source: readonly OoxmlElement[]) => Flow,
  frame: (paragraphs: readonly OoxmlElement[], width: number) => Flow,
  geometry: {
    readonly contentWidth: number;
    readonly pageWidth?: number;
    readonly marginLeft?: number;
  },
  publish: (flow: Flow) => void
): void {
  if (!hasStoryTextFrames(blocks)) return;
  // The trial lays the story out without its frames; a refusal lays all of it out again.
  publish(placeStoryTextFrames(blocks, { story, frame }, geometry) ?? story(blocks));
}
