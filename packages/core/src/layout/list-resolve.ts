// Resolve paragraph `numPr` against a numbering index and produce per-paragraph list
// layout inputs (marker text, effective indent, marker face) for one story walk.

import type { OoxmlElement, OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core-contract/store';
import { createListCounterState } from './list-counters.ts';
import {
  EMPTY_NUMBERING_INDEX,
  type ListMarkerAlign,
  type ListSuffix,
  type NumberingIndex,
  type NumberingLevelIndent,
} from './numbering-index.ts';
import {
  cascadeParagraphFormatting,
  cascadeRunProperties,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { resolveRunStyle, type ResolvedRunStyle } from './run-style.ts';
import { paragraphIndent, propertiesOf } from './paragraph-flow.ts';

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

function paragraphHasIndent(props: readonly OoxmlProperty[]): boolean {
  return props.some((property) => property.localName === 'ind');
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
    if (h && /^\d{1,9}$/.test(h)) hanging = Number(h) / 20;
    if (f && /^-?\d{1,9}$/.test(f)) firstLine = Math.max(0, Number(f) / 20);
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
  styleCascade: StyleCascadeTable | undefined
): ReadonlyMap<string, ResolvedListItem> {
  const map = new Map<string, ResolvedListItem>();
  if (index.nums.size === 0) return map;

  const counters = createListCounterState(index);
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
    ].join('|');

    map.set(paragraph.id, {
      numId: advanced.numId,
      ilvl: advanced.ilvl,
      abstractNumId: advanced.abstractNumId,
      numFmt: advanced.level.numFmt,
      markerText: advanced.markerText,
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
  },
>(
  options: T,
  blocks: readonly OoxmlElement[]
): T & {
  readonly numberingIndex: NumberingIndex;
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
} {
  const numberingIndex = options.numberingIndex ?? EMPTY_NUMBERING_INDEX;
  const listItems =
    options.listItems ??
    (numberingIndex.nums.size > 0
      ? resolveStoryListItems(blocks, numberingIndex, options.styleCascade)
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
  const slotLeft = Math.max(0, textLeft - hanging);
  const slotWidth = Math.max(hanging, markerWidth);
  let x = slotLeft;
  if (item.markerAlign === 'right') {
    x = textLeft - markerWidth;
  } else if (item.markerAlign === 'center') {
    x = slotLeft + (slotWidth - markerWidth) / 2;
  }
  // Keep markers from starting left of the content origin.
  if (x < 0) x = 0;
  return { x, y: lineY, width: Math.max(markerWidth, 0), height: lineHeight };
}
