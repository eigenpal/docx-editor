// The page the document actually asks for (task 11.1 follow-through).
//
// Layout had been paginating every document onto US Letter with one-inch margins, because
// the geometry was a constant and nothing read `w:sectPr`. That is not a chrome detail: a
// document authored A4, or landscape, or with narrow margins, broke its lines and its pages
// in the wrong places, so the page count was wrong before anything was painted.
//
// It is also what a ruler is: the tick marks and the indent handles are the section's
// margins, so the chrome cannot be assembled without this either.
//
// Twips throughout, because that is what the file stores — a twentieth of a point. Converting
// early would round twice, once here and once into layout units.

import type { OoxmlNode, OoxmlPart } from '@docx-editor.dev/core-contract/store';
import { DEFAULT_PAGE_GEOMETRY, type PageGeometry } from './semantic-records.ts';
import { storyBlocks } from './story-roots.ts';

export interface SectionMargins {
  readonly topTwips: number;
  readonly rightTwips: number;
  readonly bottomTwips: number;
  readonly leftTwips: number;
  readonly headerTwips: number;
  readonly footerTwips: number;
  readonly gutterTwips: number;
}

export interface SectionProperties {
  readonly pageSize: { readonly widthTwips: number; readonly heightTwips: number };
  readonly margins: SectionMargins;
  readonly columns: { readonly count: number; readonly gapTwips: number };
  readonly landscape: boolean;
  readonly titlePage: boolean;
}

const TWIPS_PER_POINT = 20;

/** US Letter, portrait, one-inch margins: Word's own default when a section says nothing. */
export const DEFAULT_SECTION_PROPERTIES: SectionProperties = Object.freeze({
  pageSize: Object.freeze({ widthTwips: 12240, heightTwips: 15840 }),
  margins: Object.freeze({
    topTwips: 1440,
    rightTwips: 1440,
    bottomTwips: 1440,
    leftTwips: 1440,
    headerTwips: 720,
    footerTwips: 720,
    gutterTwips: 0,
  }),
  columns: Object.freeze({ count: 1, gapTwips: 720 }),
  landscape: false,
  titlePage: false,
});

/**
 * A measurement from an attacker-controlled attribute.
 *
 * Bounded, not merely parsed: these become page dimensions, and a document is free to claim
 * a page a million inches tall. A page that large would paginate into a number of pages
 * bounded only by memory, so an out-of-range value falls back rather than being honoured.
 */
function twips(raw: string | undefined, fallback: number, max = 31680 * 2): number {
  if (raw === undefined || !/^-?\d{1,7}$/.test(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > max) return fallback;
  return value;
}

/** Margins may legitimately be negative (content bleeding into the margin) but not absurd. */
function marginTwips(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^-?\d{1,7}$/.test(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > 31680) return fallback;
  return value;
}

const attribute = (node: OoxmlNode, name: string): string | undefined => {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  for (const entry of node.attributes ?? []) {
    if (entry.localName === name) return entry.value;
  }
  return undefined;
};

const childNamed = (node: OoxmlNode, localName: string): OoxmlNode | undefined => {
  if (node.kind === 'textValue') return undefined;
  for (const child of node.children ?? []) {
    if (child.kind !== 'textValue' && 'localName' in child && child.localName === localName) {
      return child;
    }
  }
  return undefined;
};

/** The body-level `w:sectPr`, which is the last child of `w:body`. */
function bodySectionNode(part: OoxmlPart): OoxmlNode | undefined {
  const find = (node: OoxmlNode): OoxmlNode | undefined => {
    if (node.kind === 'textValue') return undefined;
    if (node.kind === 'body') return childNamed(node, 'sectPr');
    for (const child of node.children ?? []) {
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  };
  return find(part.root);
}

/**
 * The BODY-LEVEL section properties a part declares, or Word's defaults where it says
 * nothing. A document with mid-body section breaks has several sections;
 * `readDocumentSections` reads them all, and this remains the document-wide answer —
 * the section that governs the tail, and the one a whole-document write targets.
 */
export function readSectionProperties(part: OoxmlPart): SectionProperties {
  return sectionPropertiesOf(bodySectionNode(part));
}

/** One section node's properties (null reads as Word's defaults). */
export function sectionPropertiesOf(sectPr: OoxmlNode | null | undefined): SectionProperties {
  if (!sectPr) return DEFAULT_SECTION_PROPERTIES;

  const pgSz = childNamed(sectPr, 'pgSz');
  const pgMar = childNamed(sectPr, 'pgMar');
  const cols = childNamed(sectPr, 'cols');
  const defaults = DEFAULT_SECTION_PROPERTIES;

  const orientation = pgSz ? attribute(pgSz, 'orient') : undefined;
  const width = pgSz
    ? twips(attribute(pgSz, 'w'), defaults.pageSize.widthTwips)
    : defaults.pageSize.widthTwips;
  const height = pgSz
    ? twips(attribute(pgSz, 'h'), defaults.pageSize.heightTwips)
    : defaults.pageSize.heightTwips;

  return {
    pageSize: { widthTwips: width, heightTwips: height },
    margins: {
      topTwips: pgMar ? marginTwips(attribute(pgMar, 'top'), 1440) : defaults.margins.topTwips,
      rightTwips: pgMar
        ? marginTwips(attribute(pgMar, 'right'), 1440)
        : defaults.margins.rightTwips,
      bottomTwips: pgMar
        ? marginTwips(attribute(pgMar, 'bottom'), 1440)
        : defaults.margins.bottomTwips,
      leftTwips: pgMar ? marginTwips(attribute(pgMar, 'left'), 1440) : defaults.margins.leftTwips,
      headerTwips: pgMar
        ? marginTwips(attribute(pgMar, 'header'), 720)
        : defaults.margins.headerTwips,
      footerTwips: pgMar
        ? marginTwips(attribute(pgMar, 'footer'), 720)
        : defaults.margins.footerTwips,
      gutterTwips: pgMar
        ? marginTwips(attribute(pgMar, 'gutter'), 0)
        : defaults.margins.gutterTwips,
    },
    columns: {
      // A column count of zero or a hostile number would divide the content width to nothing.
      count: cols ? Math.max(1, Math.min(12, Number(attribute(cols, 'num') ?? '1') || 1)) : 1,
      gapTwips: cols ? twips(attribute(cols, 'space'), 720, 31680) : defaults.columns.gapTwips,
    },
    // Render-truthful: Word writes swapped dimensions AND the attribute, but a file may
    // carry only one. Width exceeding height IS a landscape page whatever the attribute
    // says, because layout paginates against the dimensions.
    landscape: orientation === 'landscape' || width > height,
    titlePage: childNamed(sectPr, 'titlePg') !== undefined,
  };
}

/** How a section begins relative to the one before it (ECMA-376 §17.6.22, `w:type`). */
export type SectionBreakType = 'nextPage' | 'continuous' | 'evenPage' | 'oddPage' | 'nextColumn';

/** One section of the document, with the blocks it governs. */
export interface DocumentSection {
  readonly properties: SectionProperties;
  readonly geometry: PageGeometry;
  /** Index into `storyBlocks(part)` of the first block this section governs. */
  readonly firstBlock: number;
  /** How this section begins. The FIRST section's value is irrelevant to pagination. */
  readonly breakType: SectionBreakType;
  /** The `w:sectPr` node id, or null for the defaulted section of a sectPr-less document. */
  readonly sectPrId: string | null;
}

const BREAK_TYPES: ReadonlySet<string> = new Set([
  'nextPage',
  'continuous',
  'evenPage',
  'oddPage',
  'nextColumn',
]);

function breakTypeOf(sectPr: OoxmlNode | null): SectionBreakType {
  const type = sectPr ? childNamed(sectPr, 'type') : undefined;
  const value = type ? attribute(type, 'val') : undefined;
  return value !== undefined && BREAK_TYPES.has(value) ? (value as SectionBreakType) : 'nextPage';
}

/** The `w:sectPr` inside a paragraph's `w:pPr`, marking the end of a mid-body section. */
export function paragraphSectionNode(block: OoxmlNode): OoxmlNode | undefined {
  if (block.kind !== 'paragraph') return undefined;
  const pPr = block.children.find((child) => child.kind === 'paragraphProperties');
  return pPr ? childNamed(pPr, 'sectPr') : undefined;
}

/**
 * Every section of the document, in order, each knowing the first block it governs.
 *
 * A mid-body `w:sectPr` lives in the `w:pPr` of the LAST paragraph of its section
 * (§17.6.17); the body-level `w:sectPr` governs the tail. Always at least one section:
 * a document with no `sectPr` at all is one defaulted section over every block.
 */
export function readDocumentSections(part: OoxmlPart): readonly DocumentSection[] {
  const blocks = storyBlocks(part);
  const sections: DocumentSection[] = [];
  let firstBlock = 0;
  for (const [index, block] of blocks.entries()) {
    const sectPr = paragraphSectionNode(block);
    if (!sectPr) continue;
    const properties = sectionPropertiesOf(sectPr);
    sections.push({
      properties,
      geometry: geometryOfSection(properties),
      firstBlock,
      breakType: breakTypeOf(sectPr),
      sectPrId: sectPr.id,
    });
    firstBlock = index + 1;
  }
  const bodySect = bodySectionNode(part) ?? null;
  const properties = sectionPropertiesOf(bodySect);
  sections.push({
    properties,
    geometry: geometryOfSection(properties),
    firstBlock,
    breakType: breakTypeOf(bodySect),
    sectPrId: bodySect && bodySect.kind !== 'textValue' ? bodySect.id : null,
  });
  return sections;
}

/**
 * Section properties as the geometry layout paginates against.
 *
 * The gutter is added to the LEFT margin: it is binding allowance, extra space on the inner
 * edge, and folding it into the content width instead would silently narrow every line.
 */
export function geometryOfSection(section: SectionProperties): PageGeometry {
  const width = section.pageSize.widthTwips / TWIPS_PER_POINT;
  const height = section.pageSize.heightTwips / TWIPS_PER_POINT;
  const left = (section.margins.leftTwips + section.margins.gutterTwips) / TWIPS_PER_POINT;
  const right = section.margins.rightTwips / TWIPS_PER_POINT;
  const top = section.margins.topTwips / TWIPS_PER_POINT;
  const bottom = section.margins.bottomTwips / TWIPS_PER_POINT;

  // A page whose margins exceed it has no content area at all, and paginating into a
  // zero-height column never terminates. Fall back rather than hang.
  if (width - left - right <= 0 || height - top - bottom <= 0) return DEFAULT_PAGE_GEOMETRY;
  return {
    width,
    height,
    margin: { top, right, bottom, left },
    headerDistance: Math.max(0, section.margins.headerTwips) / TWIPS_PER_POINT,
    footerDistance: Math.max(0, section.margins.footerTwips) / TWIPS_PER_POINT,
  };
}
