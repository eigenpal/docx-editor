// Section addressing helpers shared by validation and section property application.
//
// The store may not import the layout package (the dependency points the other way), so
// the few section reads validation needs — current dimensions and margins, to refuse a
// write that leaves no content area — are derived here with the same clamps the layout
// reader applies. Fields an op does not touch fall back to what the document effectively
// uses today, which is exactly what the merged write will leave in place.

import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { paragraphPropertiesNodeOf } from './tree-op-nodes.ts';
import type { TreeDocOp } from './tree-op-types.ts';

/** The `w:body` element of a part, or null when the root holds none. */
export function bodyNodeOf(
  part: OoxmlPart
): (OoxmlNode & { children: readonly OoxmlNode[] }) | null {
  const walk = (node: OoxmlNode): (OoxmlNode & { children: readonly OoxmlNode[] }) | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'body') return node;
    for (const child of node.children ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(part.root);
}

/** The body-level `w:sectPr` (a generic node), or null. */
export function bodySectionOf(part: OoxmlPart): OoxmlNode | null {
  const body = bodyNodeOf(part);
  if (!body) return null;
  for (const child of body.children) {
    if (child.kind !== 'textValue' && 'localName' in child && child.localName === 'sectPr') {
      return child;
    }
  }
  return null;
}

/**
 * EVERY `w:sectPr` in the part, in document order: the mid-body ones (inside a
 * paragraph's `w:pPr`, ending a section) and the body-level one last.
 *
 * A page-setup write is "apply to whole document" — Word's dialog default — so it must
 * reach all of them. Updating only the body-level section leaves a multi-section
 * document saying "portrait, portrait, …, landscape", which any per-section consumer
 * (Word itself) then renders as a mixed-orientation document.
 */
export function allSectionNodes(part: OoxmlPart): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    // A `sectPr` inside a table is not a section Word recognises and layout ignores it;
    // writing to one would make the dialog appear to do nothing.
    if (node.kind === 'table') return;
    if ('localName' in node && node.localName === 'sectPr') {
      found.push(node);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(part.root);
  return found;
}

/** Whether a node sits inside a `w:tbl` — where a section mark must not be minted. */
export function isTableNested(part: OoxmlPart, nodeId: string): boolean {
  let nested = false;
  let found = false;
  const walk = (node: OoxmlNode, inTable: boolean): void => {
    if (found || node.kind === 'textValue') return;
    if (node.id === nodeId) {
      nested = inTable;
      found = true;
      return;
    }
    const below = inTable || node.kind === 'table';
    for (const child of node.children ?? []) walk(child, below);
  };
  walk(part.root, false);
  return nested;
}

/** A `w:`-namespace attribute value by local name, off any element node. */
export function sectionAttribute(node: OoxmlNode | null, name: string): string | undefined {
  if (!node || node.kind === 'textValue' || !('attributes' in node)) return undefined;
  for (const entry of node.attributes ?? []) {
    if (entry.localName === name) return entry.value;
  }
  return undefined;
}

/** A named child element of a section container. */
export function sectionChild(node: OoxmlNode | null, localName: string): OoxmlNode | null {
  if (!node || node.kind === 'textValue') return null;
  for (const child of node.children ?? []) {
    if (child.kind !== 'textValue' && 'localName' in child && child.localName === localName) {
      return child;
    }
  }
  return null;
}

export interface SectionMetrics {
  readonly widthTwips: number;
  readonly heightTwips: number;
  readonly topTwips: number;
  readonly rightTwips: number;
  readonly bottomTwips: number;
  readonly leftTwips: number;
  readonly headerTwips: number;
  readonly footerTwips: number;
  readonly gutterTwips: number;
}

const clampedTwips = (raw: string | undefined, fallback: number, max: number): number => {
  if (raw === undefined || !/^-?\d{1,7}$/.test(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > max) return fallback;
  return value;
};

const clampedMargin = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || !/^-?\d{1,7}$/.test(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > 31680) return fallback;
  return value;
};

/** What the document EFFECTIVELY uses today — declared values under the read-side clamps,
 *  Word's defaults where it says nothing. */
export function currentSectionMetrics(part: OoxmlPart): SectionMetrics {
  return metricsOfSection(bodySectionOf(part));
}

type SectionWriteOp = Extract<TreeDocOp, { op: 'setSectionProperties' }>;

/**
 * The dimensions ONE section ends up with under this op — the single source both
 * validation and application read, so a value the check approved is exactly the value
 * written. An orientation change WITHOUT explicit dimensions swaps the section's own
 * current dimensions, so distinct paper sizes survive a whole-document orientation flip.
 */
export function plannedSectionDimensions(
  metrics: SectionMetrics,
  op: SectionWriteOp
): { readonly widthTwips: number; readonly heightTwips: number } {
  let width = op.pageWidthTwips ?? metrics.widthTwips;
  let height = op.pageHeightTwips ?? metrics.heightTwips;
  if (
    op.orientation !== undefined &&
    op.pageWidthTwips === undefined &&
    op.pageHeightTwips === undefined
  ) {
    const long = Math.max(metrics.widthTwips, metrics.heightTwips);
    const short = Math.min(metrics.widthTwips, metrics.heightTwips);
    width = op.orientation === 'landscape' ? long : short;
    height = op.orientation === 'landscape' ? short : long;
  }
  return { widthTwips: width, heightTwips: height };
}

/**
 * The sections this op writes: the one governing the anchor paragraph, or all of them.
 * `null` entries mean "the body-level section, which must be minted".
 */
export function targetSectionNodes(
  part: OoxmlPart,
  anchorParagraphId: string | undefined
): readonly (OoxmlNode | null)[] {
  if (anchorParagraphId === undefined) {
    const all = allSectionNodes(part);
    // A body-level section governs the tail even when the document never wrote one; a
    // whole-document write must reach that implicit section too, so it is minted.
    return bodySectionOf(part) ? all : [...all, null];
  }
  // The governing section of a paragraph: the first paragraph AT or AFTER it (in
  // document order) carrying a `w:pPr/w:sectPr`, else the body-level section. The
  // anchor may sit inside a table (the table belongs to a section), but a table-nested
  // `sectPr` is never a boundary — Word does not recognise one.
  let seenAnchor = false;
  let governing: OoxmlNode | null | undefined;
  const walk = (node: OoxmlNode, inTable: boolean): void => {
    if (governing !== undefined || node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      if (node.id === anchorParagraphId) seenAnchor = true;
      if (seenAnchor && !inTable) {
        const pPr = paragraphPropertiesNodeOf(node);
        const sectPr = pPr ? sectionChild(pPr, 'sectPr') : null;
        if (sectPr) governing = sectPr;
      }
      return;
    }
    const below = inTable || node.kind === 'table';
    for (const child of node.children ?? []) walk(child, below);
  };
  walk(part.root, false);
  return [governing ?? bodySectionOf(part)];
}

/** The effective metrics of ONE section node (null reads as Word's defaults). */
export function metricsOfSection(sectPr: OoxmlNode | null): SectionMetrics {
  const pgSz = sectionChild(sectPr, 'pgSz');
  const pgMar = sectionChild(sectPr, 'pgMar');
  return {
    widthTwips: clampedTwips(sectionAttribute(pgSz, 'w'), 12240, 63360),
    heightTwips: clampedTwips(sectionAttribute(pgSz, 'h'), 15840, 63360),
    topTwips: clampedMargin(sectionAttribute(pgMar, 'top'), 1440),
    rightTwips: clampedMargin(sectionAttribute(pgMar, 'right'), 1440),
    bottomTwips: clampedMargin(sectionAttribute(pgMar, 'bottom'), 1440),
    leftTwips: clampedMargin(sectionAttribute(pgMar, 'left'), 1440),
    headerTwips: clampedMargin(sectionAttribute(pgMar, 'header'), 720),
    footerTwips: clampedMargin(sectionAttribute(pgMar, 'footer'), 720),
    gutterTwips: clampedMargin(sectionAttribute(pgMar, 'gutter'), 0),
  };
}
