// Content-control boundary records over a laid-out document.
//
// Turns the tree's content controls plus the placed page geometry into per-control (and
// per-page) boundary rectangles for chrome. Everything here is incremental-friendly: parts
// and page records are immutable, so control collection memoizes per part and placed
// geometry memoizes per page object — a typing pass that reuses 675 of 677 pages walks the
// spans of the two pages it rebuilt, not the whole document.

import type { OoxmlElement, OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { storyRootsOf } from '../store/package/story-blocks.ts';
import {
  MAX_CONTENT_CONTROL_NESTING as MAX_SDT_NESTING,
  contentControlContentChildren,
  isContentControl,
} from '../store/package/content-control-walk.ts';
import {
  contentControlPropertiesOf,
  controlLevelOf,
  mapContentControlType,
  parseContentControlLock,
  propertyChild,
  propertyVal,
} from './content-control-properties.ts';
import {
  effectiveContentControlLock,
  unionLayoutBoxes,
  type BlockFragmentRecord,
  type ContentControlBoundaryRecord,
  type ContentControlGeometryFragment,
  type ContentControlLevel,
  type ContentControlLock,
  type LayoutBox,
  type PageRecord,
  type SemanticLayout,
} from './semantic-records.ts';

/**
 * Fingerprint of every control wrapper's chrome metadata — not its content.
 *
 * Changing alias/tag/lock/type/placeholder/binding without touching nested paragraphs still
 * changes this token, which is folded into the layout producer.
 */
export function contentControlContextToken(part: OoxmlPart): string {
  // Parts are immutable (edits publish a new part object), so the token is a pure function
  // of the part reference. Without the memo this whole-tree walk ran on EVERY layout pass —
  // including no-change passes that reuse every page.
  const cached = contentControlContextTokens.get(part);
  if (cached !== undefined) return cached;
  const token = computeContentControlContextToken(part);
  contentControlContextTokens.set(part, token);
  return token;
}

const contentControlContextTokens = new WeakMap<OoxmlPart, string>();
const contentControlSubtreeTokens = new WeakMap<OoxmlElement, string>();

function computeContentControlContextToken(part: OoxmlPart): string {
  const tokenOf = (node: OoxmlNode, depth: number): string => {
    if (node.kind === 'textValue') return '';
    // Paragraph/table nodes are immutable and structurally shared across text edits. Cache
    // their complete depth-zero result so a new part revision does not re-walk every run.
    if (depth === 0 && (node.kind === 'paragraph' || node.kind === 'table')) {
      const cached = contentControlSubtreeTokens.get(node);
      if (cached !== undefined) return cached;
    }
    let token: string;
    if (isContentControl(node)) {
      if (depth >= MAX_SDT_NESTING) return '';
      const properties = contentControlPropertiesOf(node);
      const own = [
        node.id,
        propertyVal(properties, 'alias') ?? '',
        propertyVal(properties, 'tag') ?? '',
        parseContentControlLock(propertyVal(properties, 'lock')),
        mapContentControlType(properties),
        propertyChild(properties, 'showingPlcHdr') ? '1' : '0',
        propertyChild(properties, 'dataBinding') ? '1' : '0',
      ].join(':');
      const nested = contentControlContentChildren(node)
        .map((inner) => tokenOf(inner, depth + 1))
        .filter((entry) => entry.length > 0);
      token = [own, ...nested].join('|');
    } else {
      token = node.children
        .map((child) => tokenOf(child, depth))
        .filter((entry) => entry.length > 0)
        .join('|');
    }
    if (depth === 0 && (node.kind === 'paragraph' || node.kind === 'table')) {
      contentControlSubtreeTokens.set(node, token);
    }
    return token;
  };
  return tokenOf(part.root, 0);
}

/** Addressable UTF-16 length of an inline node — mirrors the store / layout offset model. */
function addressableInlineLength(node: OoxmlNode): number {
  if (node.kind === 'textValue') return node.value.length;
  if (node.kind === 'tab' || node.kind === 'hardBreak') return 1;
  if (node.kind === 'runProperties' || node.kind === 'paragraphProperties') return 0;
  if (node.kind === 'generic') return 0;
  if (isContentControl(node)) {
    let total = 0;
    for (const inner of contentControlContentChildren(node))
      total += addressableInlineLength(inner);
    return total;
  }
  let total = 0;
  for (const child of node.children) total += addressableInlineLength(child);
  return total;
}

interface CollectedControl {
  readonly control: OoxmlElement;
  readonly nestingDepth: number;
  readonly lockStack: readonly ContentControlLock[];
  readonly level: ContentControlLevel;
  readonly paragraphId?: string;
  readonly range?: { readonly start: number; readonly end: number };
  readonly blockIds: readonly string[];
}

/** Collected controls plus the id sets their geometry needs, memoized per immutable part. */
interface CollectedControlIndex {
  readonly controls: readonly CollectedControl[];
  readonly neededBlockIds: ReadonlySet<string>;
  readonly neededParagraphIds: ReadonlySet<string>;
  /** Content identity of the needed sets, for the per-page geometry memo. */
  readonly neededToken: string;
}

const collectedControlIndexes = new WeakMap<OoxmlPart, CollectedControlIndex>();

function collectedControlIndexOf(part: OoxmlPart): CollectedControlIndex {
  const cached = collectedControlIndexes.get(part);
  if (cached !== undefined) return cached;
  const controls = collectControls(part);
  const neededBlockIds = new Set<string>();
  const neededParagraphIds = new Set<string>();
  for (const control of controls) {
    for (const blockId of control.blockIds) neededBlockIds.add(blockId);
    if (control.paragraphId !== undefined) neededParagraphIds.add(control.paragraphId);
  }
  const index: CollectedControlIndex = {
    controls,
    neededBlockIds,
    neededParagraphIds,
    neededToken: `${[...neededBlockIds].sort().join(',')};${[...neededParagraphIds].sort().join(',')}`,
  };
  collectedControlIndexes.set(part, index);
  return index;
}

function collectControls(part: OoxmlPart): CollectedControl[] {
  const out: CollectedControl[] = [];

  const collectBlocks = (nodes: readonly OoxmlNode[], into: string[]): void => {
    for (const child of nodes) {
      if (child.kind === 'paragraph' || child.kind === 'table') {
        into.push(child.id);
        continue;
      }
      if (isContentControl(child)) {
        collectBlocks(contentControlContentChildren(child), into);
        continue;
      }
      if (child.kind === 'tableRow' || child.kind === 'tableCell') {
        collectBlocks(child.children, into);
      }
    }
  };

  const walkInline = (
    nodes: readonly OoxmlNode[],
    paragraphId: string,
    offset: number,
    depth: number,
    lockStack: readonly ContentControlLock[]
  ): number => {
    let cursor = offset;
    for (const child of nodes) {
      if (child.kind === 'textValue' || child.kind === 'paragraphProperties') continue;
      if (isContentControl(child)) {
        if (depth >= MAX_SDT_NESTING) {
          cursor += addressableInlineLength(child);
          continue;
        }
        const properties = contentControlPropertiesOf(child);
        const lock = parseContentControlLock(propertyVal(properties, 'lock'));
        const nextStack = [...lockStack, lock];
        const start = cursor;
        const end = walkInline(
          contentControlContentChildren(child),
          paragraphId,
          cursor,
          depth + 1,
          nextStack
        );
        out.push({
          control: child,
          nestingDepth: depth,
          lockStack: nextStack,
          level: 'inline',
          paragraphId,
          range: { start, end },
          blockIds: [],
        });
        cursor = end;
        continue;
      }
      if (child.kind === 'hyperlink') {
        cursor = walkInline(child.children, paragraphId, cursor, depth, lockStack);
        continue;
      }
      cursor += addressableInlineLength(child);
    }
    return cursor;
  };

  const walkBlocks = (
    nodes: readonly OoxmlNode[],
    depth: number,
    lockStack: readonly ContentControlLock[]
  ): void => {
    for (const child of nodes) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'paragraph') {
        walkInline(child.children, child.id, 0, depth, lockStack);
        continue;
      }
      if (child.kind === 'table') {
        for (const row of child.children) {
          if (row.kind !== 'tableRow') continue;
          walkBlocks([row], depth, lockStack);
        }
        continue;
      }
      if (child.kind === 'tableRow') {
        for (const cell of child.children) {
          if (cell.kind === 'tableCell') walkBlocks(cell.children, depth, lockStack);
          else if (isContentControl(cell)) walkBlocks([cell], depth, lockStack);
        }
        continue;
      }
      if (!isContentControl(child)) continue;
      if (depth >= MAX_SDT_NESTING) continue;
      const properties = contentControlPropertiesOf(child);
      const lock = parseContentControlLock(propertyVal(properties, 'lock'));
      const nextStack = [...lockStack, lock];
      const level = controlLevelOf(child);
      const content = contentControlContentChildren(child);
      if (level === 'inline') {
        // Inline at body level is malformed; still walk content for nested discovery.
        walkBlocks(content, depth + 1, nextStack);
        continue;
      }
      const blockIds: string[] = [];
      collectBlocks(content, blockIds);
      out.push({
        control: child,
        nestingDepth: depth,
        lockStack: nextStack,
        level,
        blockIds,
      });
      walkBlocks(content, depth + 1, nextStack);
    }
  };

  // Per top-level block, memoized on the immutable node: at body level the depth is 0 and
  // the lock stack is empty, so a block's entries are a pure function of its subtree. A
  // keystroke publishes a new part whose body children are all shared but one — without
  // this the whole document re-walked per pass.
  // EVERY story the part holds, not a `w:body` child. A header's root is `w:hdr` and a note
  // part's stories hang off `w:footnote` elements, so looking for `body` collected nothing
  // from either — which is why a content control in a header had no record at all, and the
  // caret's geometry then matched whichever BODY control sat at the same page coordinates.
  for (const story of storyRootsOf(part)) {
    if (story.root.kind === 'textValue') continue;
    for (const child of story.root.children) {
      if (child.kind === 'textValue') continue;
      const cached = topLevelBlockControls.get(child);
      if (cached !== undefined) {
        for (const entry of cached) out.push(entry);
        continue;
      }
      const before = out.length;
      walkBlocks([child], 0, []);
      topLevelBlockControls.set(child, Object.freeze(out.slice(before)));
    }
  }
  return out;
}

const topLevelBlockControls = new WeakMap<OoxmlNode, readonly CollectedControl[]>();

interface PlacedBlockBox {
  readonly pageIndex: number;
  readonly blockId: string;
  readonly box: LayoutBox;
}

interface PlacedSpanBox {
  readonly pageIndex: number;
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
  /**
   * Ordinal of the line this span sits on, so inline-control fragments can union per LINE.
   * Uniting per page gave a wrapped control one rectangle covering everything between its
   * first and last line, including neighbouring words. Composed as page index × 2^20 plus
   * the line's ordinal WITHIN its page, which keeps document order sortable while letting
   * an unchanged page's contribution be reused verbatim when other pages move.
   */
  readonly line: number;
  /**
   * The span's TEXT extent: the raw span box dropped by the line's leading. Span boxes sit
   * at the line-box top, but non-single `w:spacing` puts the whole leading ABOVE the glyphs,
   * so a boundary built from raw boxes tints the gap over the text and misses the text
   * itself.
   */
  readonly box: LayoutBox;
}

/**
 * Deterministic work accounting for boundary generation.
 *
 * This is intentionally local to the layout implementation (it is not re-exported by the
 * package entry point). Tests use it to pin resource growth without depending on wall time.
 */
export interface ContentControlBoundaryWork {
  geometryEntries: number;
  blockLookups: number;
  blockCandidates: number;
  paragraphLookups: number;
  spanCandidates: number;
  pageFragments: number;
}

interface PlacedGeometryIndex {
  readonly blocksById: ReadonlyMap<string, readonly PlacedBlockBox[]>;
  readonly spansByParagraph: ReadonlyMap<string, readonly PlacedSpanBox[]>;
}

/** More lines than one page can carry; keeps composite line keys ordered across pages. */
const PAGE_LINE_ORDINAL_SPAN = 1 << 20;

interface PageGeometryContribution {
  /** Version of the needed-id sets this contribution was filtered under. */
  readonly neededStamp: number;
  readonly blocks: readonly PlacedBlockBox[];
  readonly spans: readonly PlacedSpanBox[];
}

/**
 * Per-page geometry contributions, memoized on the immutable page record.
 *
 * A page object owns its fragments and its index, so its contribution is a pure function
 * of the page plus WHICH ids the controls need — versioned by `neededStamp`. Rebuilding
 * this for every page on every pass made boundary attachment, not layout, the cost of a
 * keystroke in a long document full of controls.
 */
const pageGeometryContributions = new WeakMap<PageRecord, PageGeometryContribution>();

let lastNeededToken: string | null = null;
let neededStamp = 0;

function neededStampOf(neededToken: string): number {
  if (neededToken !== lastNeededToken) {
    lastNeededToken = neededToken;
    neededStamp += 1;
  }
  return neededStamp;
}

function pageContribution(
  page: PageRecord,
  index: CollectedControlIndex,
  stamp: number,
  work?: ContentControlBoundaryWork
): PageGeometryContribution {
  const cached = pageGeometryContributions.get(page);
  if (cached !== undefined && cached.neededStamp === stamp) return cached;
  const blocks: PlacedBlockBox[] = [];
  const spans: PlacedSpanBox[] = [];
  let lineOrdinal = page.index * PAGE_LINE_ORDINAL_SPAN;
  const visit = (pageIndex: number, fragment: BlockFragmentRecord): void => {
    if (fragment.kind === 'paragraph') {
      if (index.neededBlockIds.has(fragment.paragraphId)) {
        work && (work.geometryEntries += 1);
        blocks.push({ pageIndex, blockId: fragment.paragraphId, box: fragment.box });
      }
      const needSpans = index.neededParagraphIds.has(fragment.paragraphId);
      for (const line of fragment.lines) {
        const lineKey = lineOrdinal;
        // Clamped inside the page's key band: a hostile page with a million zero-height
        // lines must not spill ordinals into the next page's space (the tail lines then
        // share one union box, which degrades gracefully and stays page-local).
        lineOrdinal = Math.min(
          lineOrdinal + 1,
          page.index * PAGE_LINE_ORDINAL_SPAN + PAGE_LINE_ORDINAL_SPAN - 1
        );
        if (!needSpans) continue;
        // The glyph band: the box less the spacing on BOTH sides of it. Subtracting only
        // `leading` was right while every rule put its extra above the text; `auto`/`atLeast`
        // put it below and leave `leading` at zero, which handed a double-spaced line a
        // boundary chip covering the whole doubled box instead of the glyphs in it.
        const textHeight = Math.max(
          0,
          line.box.height - line.leading - (line.trailingSpacing ?? 0)
        );
        for (const span of line.spans) {
          work && (work.geometryEntries += 1);
          spans.push({
            pageIndex,
            paragraphId: span.range.paragraphId,
            start: span.range.start,
            end: span.range.end,
            line: lineKey,
            box: {
              x: span.box.x,
              y: span.box.y + line.leading,
              width: span.box.width,
              height: textHeight,
            },
          });
        }
      }
      return;
    }
    if (index.neededBlockIds.has(fragment.tableId)) {
      work && (work.geometryEntries += 1);
      blocks.push({ pageIndex, blockId: fragment.tableId, box: fragment.box });
    }
    for (const row of fragment.rows) {
      if (row.isHeaderRepeat) continue;
      for (const cell of row.cells) {
        for (const inner of cell.blocks) visit(pageIndex, inner);
      }
    }
  };
  for (const fragment of page.fragments) visit(page.index, fragment);
  const contribution: PageGeometryContribution = { neededStamp: stamp, blocks, spans };
  pageGeometryContributions.set(page, contribution);
  return contribution;
}

function placedGeometryOf(
  layout: SemanticLayout,
  index: CollectedControlIndex,
  work?: ContentControlBoundaryWork
): PlacedGeometryIndex {
  const stamp = neededStampOf(index.neededToken);
  const blocksById = new Map<string, PlacedBlockBox[]>();
  const spansByParagraph = new Map<string, PlacedSpanBox[]>();
  for (const page of layout.pages) {
    const contribution = pageContribution(page, index, stamp, work);
    for (const entry of contribution.blocks) {
      const entries = blocksById.get(entry.blockId);
      if (entries) entries.push(entry);
      else blocksById.set(entry.blockId, [entry]);
    }
    for (const entry of contribution.spans) {
      const entries = spansByParagraph.get(entry.paragraphId);
      if (entries) entries.push(entry);
      else spansByParagraph.set(entry.paragraphId, [entry]);
    }
  }
  return { blocksById, spansByParagraph };
}

function fragmentsForBlockControl(
  blockIds: readonly string[],
  geometry: PlacedGeometryIndex,
  work?: ContentControlBoundaryWork
): ContentControlGeometryFragment[] {
  const byPage = new Map<number, LayoutBox[]>();
  const seen = new Set<string>();
  for (const blockId of blockIds) {
    if (seen.has(blockId)) continue;
    seen.add(blockId);
    work && (work.blockLookups += 1);
    for (const entry of geometry.blocksById.get(blockId) ?? []) {
      work && (work.blockCandidates += 1);
      const list = byPage.get(entry.pageIndex);
      if (list) list.push(entry.box);
      else byPage.set(entry.pageIndex, [entry.box]);
    }
  }
  return [...byPage.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([pageIndex, boxes]) => {
      const box = unionLayoutBoxes(boxes);
      return box ? [{ pageIndex, box }] : [];
    });
}

function fragmentsForInlineControl(
  paragraphId: string,
  range: { readonly start: number; readonly end: number },
  geometry: PlacedGeometryIndex,
  work?: ContentControlBoundaryWork
): ContentControlGeometryFragment[] {
  work && (work.paragraphLookups += 1);
  const placed = geometry.spansByParagraph.get(paragraphId) ?? [];
  // Grouped per LINE, not per page: a wrapped control publishes one fragment per line it
  // touches, so chrome never paints a union rectangle over the words beside it.
  const byLine = new Map<number, { pageIndex: number; boxes: LayoutBox[] }>();
  // Paragraph spans are emitted in source-range order. Binary search skips all spans ending
  // before this control, so sibling controls do not repeatedly scan the paragraph prefix.
  let low = 0;
  let high = placed.length;
  while (low < high) {
    work && (work.spanCandidates += 1);
    const middle = low + ((high - low) >> 1);
    const beforeStart =
      range.start === range.end
        ? placed[middle]!.end < range.start
        : placed[middle]!.end <= range.start;
    if (beforeStart) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < placed.length; index += 1) {
    const span = placed[index]!;
    work && (work.spanCandidates += 1);
    if (span.end <= range.start) continue;
    if (span.start >= range.end) break;
    const group = byLine.get(span.line);
    if (group) group.boxes.push(span.box);
    else byLine.set(span.line, { pageIndex: span.pageIndex, boxes: [span.box] });
  }
  // Empty range (empty control): fall back to a zero-width box at the caret when a span
  // touches the insertion point, otherwise leave fragments empty.
  if (byLine.size === 0 && range.start === range.end) {
    for (let index = low; index < placed.length; index += 1) {
      const span = placed[index]!;
      work && (work.spanCandidates += 1);
      if (span.start > range.start) break;
      if (range.start > span.end) continue;
      const x =
        span.start === span.end
          ? span.box.x
          : span.box.x +
            (span.box.width * (range.start - span.start)) / Math.max(1, span.end - span.start);
      return [
        { pageIndex: span.pageIndex, box: { x, y: span.box.y, width: 0, height: span.box.height } },
      ];
    }
  }
  // Line keys are page-major document order, so sorting by line also sorts by page.
  return [...byLine.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, group]) => {
      const box = unionLayoutBoxes(group.boxes);
      return box ? [{ pageIndex: group.pageIndex, box }] : [];
    });
}

function boundaryRecordOf(
  collected: CollectedControl,
  geometry: PlacedGeometryIndex,
  work?: ContentControlBoundaryWork
): ContentControlBoundaryRecord {
  const properties = contentControlPropertiesOf(collected.control);
  const alias = propertyVal(properties, 'alias');
  const tag = propertyVal(properties, 'tag');
  const lock = collected.lockStack[collected.lockStack.length - 1] ?? 'unlocked';
  const fragments =
    collected.level === 'inline' && collected.paragraphId && collected.range
      ? fragmentsForInlineControl(collected.paragraphId, collected.range, geometry, work)
      : fragmentsForBlockControl(collected.blockIds, geometry, work);
  return {
    id: collected.control.id,
    ...(alias !== undefined ? { alias } : {}),
    ...(tag !== undefined ? { tag } : {}),
    controlType: mapContentControlType(properties),
    lock,
    effectiveLock: effectiveContentControlLock(collected.lockStack),
    placeholder: propertyChild(properties, 'showingPlcHdr') !== undefined,
    bound: propertyChild(properties, 'dataBinding') !== undefined,
    nestingDepth: collected.nestingDepth,
    level: collected.level,
    fragments,
  };
}

function sameGeometryFragments(
  left: readonly ContentControlGeometryFragment[],
  right: readonly ContentControlGeometryFragment[]
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (a === b) continue;
    if (a.pageIndex !== b.pageIndex) return false;
    if (
      a.box.x !== b.box.x ||
      a.box.y !== b.box.y ||
      a.box.width !== b.box.width ||
      a.box.height !== b.box.height
    ) {
      return false;
    }
  }
  return true;
}

function sameBoundaryRecord(
  left: ContentControlBoundaryRecord,
  right: ContentControlBoundaryRecord
): boolean {
  return (
    left.id === right.id &&
    left.alias === right.alias &&
    left.tag === right.tag &&
    left.controlType === right.controlType &&
    left.lock === right.lock &&
    left.effectiveLock === right.effectiveLock &&
    left.placeholder === right.placeholder &&
    left.bound === right.bound &&
    left.nestingDepth === right.nestingDepth &&
    left.level === right.level &&
    sameGeometryFragments(left.fragments, right.fragments)
  );
}

function sameBoundaryList(
  left: readonly ContentControlBoundaryRecord[] | undefined,
  right: readonly ContentControlBoundaryRecord[]
): boolean {
  if (!left) return right.length === 0;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!sameBoundaryRecord(left[index]!, right[index]!)) return false;
  }
  return true;
}

/** Copy layout-level content-control metadata onto a pages/revision shell. */
export function withContentControlMetadata(
  layout: Pick<SemanticLayout, 'revision' | 'pages'>,
  source: SemanticLayout
): SemanticLayout {
  return {
    revision: layout.revision,
    pages: layout.pages,
    ...(source.contentControls !== undefined ? { contentControls: source.contentControls } : {}),
    ...(source.controlContextToken !== undefined
      ? { controlContextToken: source.controlContextToken }
      : {}),
  };
}

/**
 * The control-carrying wrapper built for one raw page, kept on the page it wraps.
 *
 * Weak on the raw page, so a page that falls out of the layout takes its wrapper with it.
 */
const wrappedPages = new WeakMap<
  PageRecord,
  { readonly controls: readonly ContentControlBoundaryRecord[]; readonly wrapped: PageRecord }
>();

/**
 * Publish content-control boundary records onto a laid-out document.
 *
 * Page fragment identity is preserved when a page's control list is unchanged; metadata-only
 * edits replace the page wrapper so consumers never read a stale `contentControls` array from
 * an identity-reused page. When no page wrapper needs rewriting, the prior `pages` array is
 * kept by reference so a no-change resume still satisfies `layout.pages` identity.
 */
export function attachContentControlBoundaries(
  layout: SemanticLayout,
  part: OoxmlPart,
  token = contentControlContextToken(part),
  work?: ContentControlBoundaryWork
): SemanticLayout {
  // The token includes every control id, so an empty token proves there are no controls.
  // Avoid both otherwise-unconditional full walks: collecting controls from the tree and
  // indexing every placed fragment/span across every page.
  if (token === '') {
    const pagesHaveControls = layout.pages.some(
      (page) => page.contentControls !== undefined && page.contentControls.length > 0
    );
    if (
      !pagesHaveControls &&
      layout.controlContextToken === token &&
      sameBoundaryList(layout.contentControls, [])
    ) {
      return layout;
    }
    const pages = pagesHaveControls
      ? layout.pages.map((page) =>
          page.contentControls !== undefined && page.contentControls.length > 0
            ? { ...page, contentControls: [] }
            : page
        )
      : layout.pages;
    return {
      revision: layout.revision,
      pages,
      contentControls: [],
      controlContextToken: token,
    };
  }

  const index = collectedControlIndexOf(part);
  const geometry = placedGeometryOf(layout, index, work);
  const contentControls = index.controls.map((entry) => boundaryRecordOf(entry, geometry, work));
  const byPage = new Map<number, ContentControlBoundaryRecord[]>();
  for (const record of contentControls) {
    for (const fragment of record.fragments) {
      work && (work.pageFragments += 1);
      const list = byPage.get(fragment.pageIndex);
      const pageRecord = { ...record, fragments: [fragment] };
      if (list) list.push(pageRecord);
      else byPage.set(fragment.pageIndex, [pageRecord]);
    }
  }

  if (
    layout.controlContextToken === token &&
    sameBoundaryList(layout.contentControls, contentControls) &&
    layout.pages.every((page) =>
      sameBoundaryList(page.contentControls, byPage.get(page.index) ?? [])
    )
  ) {
    return layout;
  }

  let pagesChanged = false;
  const mapped = layout.pages.map((page) => {
    const pageControls = byPage.get(page.index) ?? [];
    if (sameBoundaryList(page.contentControls, pageControls)) return page;
    if (pageControls.length === 0 && !page.contentControls) return page;
    pagesChanged = true;
    // The SAME wrapper as last time, when the page underneath it and the controls on it are
    // both unchanged. Pagination reuses a page it did not touch, but hands it back without
    // the control list, so this stage re-wraps it on every pass — and a new wrapper every
    // keystroke defeats every consumer keyed on page identity, from the per-page layout
    // indexes to paint's sheet reuse. On a contract with controls on a hundred pages, those
    // hundred sheets were rebuilt for an edit that touched none of them.
    const cached = wrappedPages.get(page);
    if (cached && sameBoundaryList(cached.controls, pageControls)) return cached.wrapped;
    const wrapped = { ...page, contentControls: pageControls };
    wrappedPages.set(page, { controls: pageControls, wrapped });
    return wrapped;
  });
  const pages = pagesChanged ? mapped : layout.pages;

  if (
    pages === layout.pages &&
    layout.controlContextToken === token &&
    sameBoundaryList(layout.contentControls, contentControls)
  ) {
    return layout;
  }

  return {
    revision: layout.revision,
    pages,
    contentControls,
    controlContextToken: token,
  };
}

/**
 * Every content control a part declares, in document order, WITHOUT geometry.
 *
 * For the stories that have no boundary records. `attachContentControlBoundaries` publishes
 * records for the body alone, and page-content coordinates mean nothing without knowing whose
 * box they belong to: a header caret hit-tested against body rectangles and answered with a
 * body control, which `setValue` and `remove` then edited.
 *
 * `fragments` comes back empty. There are no page rectangles for a furniture control yet, and
 * an invented one is a rectangle a hit test would match. Chrome that paints from `fragments`
 * draws nothing, which is what it does today.
 */
export function contentControlRecordsInPart(
  part: OoxmlPart,
  /**
   * Keep only controls holding one of these paragraphs.
   *
   * For a notes PART, which holds every note in the document rather than one story. Rostered
   * whole, Tab walked out of the open footnote and into the next one, and the keystrokes after
   * it landed in a note the reader was not in.
   */
  withinParagraphs?: ReadonlySet<string>
): readonly ContentControlBoundaryRecord[] {
  const controls = collectedControlIndexOf(part).controls.filter((collected) => {
    if (!withinParagraphs) return true;
    if (collected.paragraphId !== undefined) return withinParagraphs.has(collected.paragraphId);
    return collected.blockIds.some((id) => withinParagraphs.has(id));
  });
  return controls.map(recordWithoutGeometry);
}

/**
 * The innermost content control holding `paragraphId`, in `part`.
 *
 * Deepest wins, matching the geometry path's innermost-by-nesting rule: a control inside a
 * control is the one the caret is actually in.
 */
export function contentControlHoldingParagraph(
  part: OoxmlPart,
  paragraphId: string
): ContentControlBoundaryRecord | null {
  let found: CollectedControl | null = null;
  for (const collected of collectedControlIndexOf(part).controls) {
    const holds = collected.paragraphId === paragraphId || collected.blockIds.includes(paragraphId);
    if (!holds) continue;
    if (!found || collected.nestingDepth >= found.nestingDepth) found = collected;
  }
  return found ? recordWithoutGeometry(found) : null;
}

function recordWithoutGeometry(collected: CollectedControl): ContentControlBoundaryRecord {
  const properties = contentControlPropertiesOf(collected.control);
  const alias = propertyVal(properties, 'alias');
  const tag = propertyVal(properties, 'tag');
  return {
    id: collected.control.id,
    ...(alias !== undefined ? { alias } : {}),
    ...(tag !== undefined ? { tag } : {}),
    controlType: mapContentControlType(properties),
    lock: collected.lockStack[collected.lockStack.length - 1] ?? 'unlocked',
    effectiveLock: effectiveContentControlLock(collected.lockStack),
    placeholder: propertyChild(properties, 'showingPlcHdr') !== undefined,
    bound: propertyChild(properties, 'dataBinding') !== undefined,
    nestingDepth: collected.nestingDepth,
    level: collected.level,
    fragments: [],
  };
}
