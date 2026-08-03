// Resolve paragraph `numPr` against a numbering index and produce per-paragraph list
// layout inputs (marker text, effective indent, marker face) for one story walk.

import type { OoxmlElement, OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core-contract/store';
import { createListCounterState } from './list-counters.ts';
import {
  EMPTY_NUMBERING_INDEX,
  MAX_LEVEL_INDENT_PT,
  resolveNumberingStyleLinks,
  type ListMarkerAlign,
  type ListSuffix,
  type NumberingIndex,
  type NumberingLevelIndent,
} from './numbering-index.ts';
import {
  cascadeParagraphFormatting,
  cascadeRunProperties,
  MAX_STYLE_BASED_ON_DEPTH,
  type StyleCascadeTable,
  type StyleDefinition,
} from './style-cascade.ts';
import { EMPTY_TAB_STOPS, nextTabDestination, type ResolvedTabStops } from './paragraph-tabs.ts';
import { mapSymbolPuaText } from './symbol-encoding.ts';
import { resolveRunStyle, type ResolvedRunStyle } from './run-style.ts';
import { paragraphIndent, propertiesOf } from './paragraph-flow.ts';
import type { TextMeasurer } from './semantic-records.ts';

export interface ResolvedListItem {
  readonly numId: string;
  readonly ilvl: number;
  readonly abstractNumId: string;
  /** `w:numFmt` of the resolved level — `bullet` or a numbering format. */
  readonly numFmt: string;
  readonly markerText: string;
  readonly markerAlign: ListMarkerAlign;
  readonly suffix: ListSuffix;
  /** Effective indent after merging level + paragraph indents, in points. */
  readonly indent: NumberingLevelIndent;
  readonly markerStyle: ResolvedRunStyle;
  /** Fingerprint for layout cache keys (indent + level identity, not ordinal). */
  readonly cacheToken: string;
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function attrVal(node: OoxmlElement, localName: string): string | undefined {
  for (const a of node.attributes) {
    if (a.localName === localName) return a.value;
  }
  return undefined;
}

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (isElement(child) && child.localName === localName) return child;
  }
  return undefined;
}

/**
 * Read `w:numPr` from cascaded paragraph-property nodes (last wins).
 *
 * Flat `OoxmlProperty[]` bags drop nested `ilvl`/`numId`, so this walks the tree nodes
 * the same way borders and tabs do.
 */
export function readNumPr(
  paragraphPropertyNodes: readonly OoxmlNode[]
): { numId: string; ilvl: number } | null {
  let found: { numId: string; ilvl: number } | null = null;
  for (const node of paragraphPropertyNodes) {
    if (!isElement(node)) continue;
    const numPr = childNamed(node, 'numPr');
    if (!numPr) continue;
    const ilvlNode = childNamed(numPr, 'ilvl');
    const numIdNode = childNamed(numPr, 'numId');
    const numId = numIdNode ? attrVal(numIdNode, 'val') : undefined;
    const ilvlRaw = ilvlNode ? attrVal(ilvlNode, 'val') : '0';
    if (!numId || numId === '0') {
      found = null;
      continue;
    }
    if (numId.length > 64) {
      found = null;
      continue;
    }
    const ilvl = /^\d{1,2}$/.test(ilvlRaw ?? '') ? Number(ilvlRaw) : 0;
    if (ilvl < 0 || ilvl > 8) {
      found = null;
      continue;
    }
    found = { numId, ilvl };
  }
  return found;
}

/**
 * The `w:numId` a style numbers with, following `w:basedOn` (§17.9.21 link target).
 *
 * A `w:numStyleLink` names a style, not a number: Word's own List Bullet / List Number are
 * paragraph styles whose `w:numPr` points at the `w:num` that owns the real levels. The walk
 * is depth-capped with a visited set because the `basedOn` chain comes from the file.
 */
function numIdForStyle(styleCascade: StyleCascadeTable, styleId: string): string | undefined {
  const seen = new Set<string>();
  let current: StyleDefinition | undefined = styleCascade.styles.get(styleId);
  for (let depth = 0; current !== undefined && depth < MAX_STYLE_BASED_ON_DEPTH; depth += 1) {
    if (seen.has(current.styleId)) return undefined;
    seen.add(current.styleId);
    const node = current.paragraphPropertiesNode;
    const numPr = node ? readNumPr([node]) : null;
    if (numPr) return numPr.numId;
    current = current.basedOn === null ? undefined : styleCascade.styles.get(current.basedOn);
  }
  return undefined;
}

/**
 * Resolve `w:numStyleLink` delegation using the document's styles (§17.9.21).
 *
 * Without a style table there is nothing to follow, so the index is returned unchanged —
 * and so it is when nothing delegates, which keeps layout cache identity.
 */
export function withNumberingStyleLinks(
  index: NumberingIndex,
  styleCascade: StyleCascadeTable | undefined
): NumberingIndex {
  if (!styleCascade) return index;
  return resolveNumberingStyleLinks(index, (styleId) => numIdForStyle(styleCascade, styleId));
}

function paragraphHasIndent(props: readonly OoxmlProperty[]): boolean {
  return props.some((property) => property.localName === 'ind');
}

/** Bound a file-derived indent both ways — negative is legal, unbounded is not. */
function clampIndentPt(pt: number): number {
  if (!Number.isFinite(pt)) return 0;
  if (pt > MAX_LEVEL_INDENT_PT) return MAX_LEVEL_INDENT_PT;
  if (pt < -MAX_LEVEL_INDENT_PT) return -MAX_LEVEL_INDENT_PT;
  return pt;
}

/**
 * Merge level indent with paragraph indent.
 *
 * Level indent is the base for list paragraphs; an authored paragraph/style `w:ind`
 * replaces left/right (and hanging/firstLine when present on that `ind`).
 */
export function mergeListIndent(
  levelIndent: NumberingLevelIndent,
  paragraphProps: readonly OoxmlProperty[]
): NumberingLevelIndent {
  if (!paragraphHasIndent(paragraphProps)) return levelIndent;
  const para = paragraphIndent(paragraphProps);
  let hanging = levelIndent.hanging;
  let firstLine = levelIndent.firstLine;
  for (const property of paragraphProps) {
    if (property.localName !== 'ind') continue;
    const h = property.attributes?.hanging;
    const f = property.attributes?.firstLine;
    // Mutually exclusive (§17.3.1.10, §17.3.1.12): one signed first-line offset, two spellings,
    // so an `w:ind` stating either replaces both. `w:firstLine` is read SIGNED because Word
    // keeps a negative value as a hang. A bare `w:left` states neither and leaves them alone.
    if (h !== undefined || f !== undefined) {
      hanging = h !== undefined && /^\d{1,9}$/.test(h) ? clampIndentPt(Number(h) / 20) : 0;
      firstLine = f !== undefined && /^-?\d{1,9}$/.test(f) ? clampIndentPt(Number(f) / 20) : 0;
    }
  }
  return {
    left: para.left,
    right: para.right,
    hanging,
    firstLine,
  };
}

/**
 * Collect paragraphs of a block list in document order, descending into tables.
 *
 * Caps nesting so a hostile nested-table document cannot recurse without bound.
 */
export function walkStoryParagraphs(
  blocks: readonly OoxmlElement[],
  maxTableDepth = 8
): OoxmlElement[] {
  const out: OoxmlElement[] = [];
  const visit = (blockList: readonly OoxmlElement[], depth: number): void => {
    for (const block of blockList) {
      if (block.kind === 'paragraph') {
        out.push(block);
        continue;
      }
      if (block.kind !== 'table' || depth >= maxTableDepth) continue;
      for (const row of block.children) {
        if (row.kind !== 'tableRow') continue;
        for (const cell of row.children) {
          if (cell.kind !== 'tableCell') continue;
          const inner: OoxmlElement[] = [];
          for (const child of cell.children) {
            if (child.kind === 'paragraph' || child.kind === 'table') inner.push(child);
            if (child.kind === 'generic' && child.localName === 'sdt' && depth < maxTableDepth) {
              for (const sdtChild of child.children) {
                if (isElement(sdtChild) && sdtChild.localName === 'sdtContent') {
                  for (const content of sdtChild.children) {
                    if (content.kind === 'paragraph' || content.kind === 'table') {
                      inner.push(content);
                    }
                  }
                }
              }
            }
          }
          visit(inner, depth + 1);
        }
      }
    }
  };
  visit(blocks, 0);
  return out;
}

/**
 * Resolve every list paragraph in a story to a {@link ResolvedListItem}, keyed by node id.
 *
 * Non-list paragraphs are absent from the map. Hostile / missing numbering resolves inertly
 * (paragraph omitted — laid out as ordinary text).
 */
export function resolveStoryListItems(
  blocks: readonly OoxmlElement[],
  index: NumberingIndex,
  styleCascade: StyleCascadeTable | undefined,
  isFontAvailable?: (family: string) => boolean
): ReadonlyMap<string, ResolvedListItem> {
  const map = new Map<string, ResolvedListItem>();
  if (index.nums.size === 0) return map;

  // A definition that delegates through `w:numStyleLink` has no levels of its own; resolving
  // the link here is what keeps those paragraphs from losing their markers entirely.
  const linked = withNumberingStyleLinks(index, styleCascade);
  const counters = createListCounterState(linked);
  for (const paragraph of walkStoryParagraphs(blocks)) {
    const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
    const cascaded = styleCascade ? cascadeParagraphFormatting(styleCascade, pPr) : null;
    const nodes: readonly OoxmlNode[] = cascaded
      ? cascaded.paragraphPropertyNodes
      : pPr
        ? [pPr]
        : [];
    const numPr = readNumPr(nodes);
    if (!numPr) continue;

    const advanced = counters.advance(numPr.numId, numPr.ilvl);
    if (!advanced) continue;

    const indentProps = cascaded ? cascaded.paragraphProperties : propertiesOf(pPr);
    const indent = mergeListIndent(advanced.level.indent, indentProps);
    const markerProps = cascadeRunProperties(
      cascaded?.runProperties ?? [],
      advanced.level.runProperties,
      styleCascade
    );
    const markerStyle = resolveRunStyle(markerProps);
    // Word writes a Symbol/Wingdings bullet as font-byte + 0xF000 (`` = U+F0B7 in
    // Symbol), which is a private-use codepoint no other font can draw. Mapping it here —
    // where the marker's FAMILY is finally known — keeps measurement and paint on the same
    // string; doing it in the painter would size the marker box for a glyph nobody draws.
    const markerText = mapSymbolPuaText(
      advanced.markerText,
      markerStyle.fontFamily,
      isFontAvailable
    );
    const cacheToken = [
      advanced.numId,
      advanced.ilvl,
      advanced.level.numFmt,
      advanced.level.lvlText,
      indent.left,
      indent.right,
      indent.hanging,
      indent.firstLine,
      advanced.level.lvlJc,
      advanced.level.suff,
      advanced.level.vanish ? 1 : 0,
      // Not the ordinal — its LENGTH. The first line starts where the marker ends whenever
      // the marker overflows its hanging slot, so `9.` and `10.` can break differently.
      markerText.length,
    ].join('|');

    map.set(paragraph.id, {
      numId: advanced.numId,
      ilvl: advanced.ilvl,
      abstractNumId: advanced.abstractNumId,
      numFmt: advanced.level.numFmt,
      markerText,
      markerAlign: advanced.level.lvlJc,
      suffix: advanced.level.suff,
      indent,
      markerStyle,
      cacheToken,
    });
  }
  return map;
}

/**
 * Attach a full-story list-item map to layout options.
 *
 * Resolves once over `blocks` (body story including table cells) so counters continue across
 * section boundaries. No-ops when numbering is absent.
 */
export function withResolvedListItems<
  T extends {
    readonly numberingIndex?: NumberingIndex;
    readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
    readonly styleCascade?: StyleCascadeTable;
    /**
     * Host oracle for "is this font family really loaded". Supplied, a Symbol/Wingdings
     * bullet keeps the file's own private-use codepoint so the authored typeface draws it;
     * absent, it falls back to the Unicode equivalent rather than a tofu box.
     */
    readonly isFontAvailable?: (family: string) => boolean;
  },
>(
  options: T,
  blocks: readonly OoxmlElement[]
): T & {
  readonly numberingIndex: NumberingIndex;
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
} {
  // Published already linked (§17.9.21), so every reader of the index — not just the item
  // map built here — sees the levels a `w:numStyleLink` delegates to.
  const numberingIndex = withNumberingStyleLinks(
    options.numberingIndex ?? EMPTY_NUMBERING_INDEX,
    options.styleCascade
  );
  const listItems =
    options.listItems ??
    (numberingIndex.nums.size > 0
      ? resolveStoryListItems(blocks, numberingIndex, options.styleCascade, options.isFontAvailable)
      : undefined);
  return {
    ...options,
    numberingIndex,
    ...(listItems ? { listItems } : {}),
  };
}

/**
 * Horizontal marker box inside the hanging indent slot.
 *
 * Coordinates are relative to the same origin as paragraph content (`indent.left` is the
 * text start). Returns null when there is nothing to paint.
 */
export function listMarkerBox(
  item: ResolvedListItem,
  markerWidth: number,
  lineY: number,
  lineHeight: number
): { x: number; y: number; width: number; height: number } | null {
  if (!item.markerText || (item.indent.hanging <= 0 && markerWidth <= 0)) {
    if (!item.markerText) return null;
  }
  if (!item.markerText) return null;

  const textLeft = item.indent.left;
  const hanging = item.indent.hanging;
  // Markers stop at the content origin — except for a paragraph the author pulled INTO the
  // margin with a negative `w:ind` (§17.3.1.12), where pinning the marker at zero would put
  // the number to the RIGHT of the text it numbers.
  const floor = Math.min(0, textLeft);
  const slotLeft = Math.max(floor, textLeft - hanging);
  const slotWidth = Math.max(hanging, markerWidth);
  let x = slotLeft;
  if (item.markerAlign === 'right') {
    x = textLeft - markerWidth;
  } else if (item.markerAlign === 'center') {
    x = slotLeft + (slotWidth - markerWidth) / 2;
  }
  if (x < floor) x = floor;
  return { x, y: lineY, width: Math.max(markerWidth, 0), height: lineHeight };
}

/**
 * Where the FIRST line of a list paragraph starts, relative to `indent.left` (§17.9.30).
 *
 * A list paragraph's hanging indent is the marker's slot, so ordinarily the text starts at
 * `indent.left` and this is 0 — `w:suff="tab"` with a marker that fits is exactly that case.
 * The other three cases are where Word and a forced zero part company:
 *
 * - `w:suff="space"` — one space after the marker, then the text. Not a tab, not the indent.
 * - `w:suff="nothing"` — the text begins immediately after the marker.
 * - `w:suff="tab"` with a marker WIDER than its slot (`viii.`, `%1.%2.%3.`) — the suffix tab
 *   advances to the next tab stop past the marker, so the first line moves right instead of
 *   the marker being painted over its own first word.
 */
export function listFirstLineOffset(
  item: ResolvedListItem,
  measurer: TextMeasurer,
  tabStops: ResolvedTabStops = EMPTY_TAB_STOPS,
  rightEdge = Number.POSITIVE_INFINITY
): number {
  if (!item.markerText) return 0;
  const markerWidth = measurer.measure(item.markerText, item.markerStyle);
  const box = listMarkerBox(item, markerWidth, 0, 0);
  if (!box) return 0;
  const textLeft = item.indent.left;
  const markerEnd = box.x + box.width;
  if (item.suffix === 'nothing') return markerEnd - textLeft;
  if (item.suffix === 'space') {
    return markerEnd + measurer.measure(' ', item.markerStyle) - textLeft;
  }
  // `tab`: the implied stop is the paragraph indent itself; only an overflowing marker has
  // to look further along the paragraph's own stops.
  if (markerEnd <= textLeft) return 0;
  return nextTabDestination(tabStops, markerEnd, rightEdge).positionPt - textLeft;
}

/**
 * First-line offset for ANY paragraph: `w:firstLine` right, `w:hanging` left — except a list
 * item, whose first line is placed by its marker and `w:suff` ({@link listFirstLineOffset}).
 */
export function firstLineShift(
  item: ResolvedListItem | undefined,
  indent: { readonly left: number; readonly hanging: number; readonly firstLine: number },
  measurer: TextMeasurer,
  tabStops?: ResolvedTabStops,
  available?: number
): number {
  if (item) {
    return listFirstLineOffset(
      item,
      measurer,
      tabStops,
      available === undefined ? undefined : indent.left + available
    );
  }
  return indent.hanging > 0 ? -indent.hanging : indent.firstLine;
}
