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
//
// Multi-section documents: a paragraph-level `w:pPr/w:sectPr` ends the section that contains
// that paragraph; the body-level `w:sectPr` ends the final section (ECMA-376 §17.6). Absent
// `w:type` defaults to `nextPage`.

import {
  readOnOffChild,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { DEFAULT_PAGE_GEOMETRY, type PageGeometry } from './semantic-records.ts';
import { storyBlocks } from './story-roots.ts';
import type { RevisionDisplayMode } from './revision-projection.ts';

/**
 * Hard ceiling on sections enumerated from a document (matches write-path
 * `MAX_SECTIONS` in note/hf lifecycle). Hostile packages with unbounded `w:sectPr`
 * marks fail closed here rather than amplifying layout props arrays.
 */
export const MAX_DOCUMENT_SECTIONS = 4_096;

export interface SectionMargins {
  readonly topTwips: number;
  readonly rightTwips: number;
  readonly bottomTwips: number;
  readonly leftTwips: number;
  readonly headerTwips: number;
  readonly footerTwips: number;
  readonly gutterTwips: number;
}

export interface SectionColumnDefinition {
  readonly widthTwips: number;
  /** Space after this column; zero on the final column. */
  readonly gapTwips: number;
}

export interface SectionColumns {
  readonly count: number;
  /** Shared gap for equal-width columns and fallback gap for incomplete explicit definitions. */
  readonly gapTwips: number;
  readonly equalWidth?: boolean;
  readonly separator?: boolean;
  /** Authored `w:col` geometry when `equalWidth` is false. */
  readonly definitions?: readonly SectionColumnDefinition[];
}

/**
 * How this section is placed relative to the previous one (ECMA-376 17.6.22,
 * `ST_SectionMark`).
 *
 * All five schema values are read. `nextColumn` paginates like `nextPage` for now: in a
 * single-column section that IS Word's behaviour, and multi-column flow is not modelled,
 * so collapsing it at the parse boundary would only hide the authored value from a
 * consumer that asks.
 */
export type SectionBreakType = 'nextPage' | 'continuous' | 'evenPage' | 'oddPage' | 'nextColumn';

/**
 * Authored `w:pgNumType` (ECMA-376 CT_PageNumber).
 *
 * Distinguishes three states via {@link SectionProperties.pageNumbering}:
 * - element absent → `undefined` (Word defaults; no empty element to re-emit)
 * - empty `<w:pgNumType/>` → `{}` (present, no authored attrs; must round-trip empty)
 * - attributes set → only those keys appear (never invent schema defaults like `fmt=decimal`)
 *
 * `chapStyle` / `chapSep` are preserved for consumers; PAGE projection does not yet compose
 * chapter numbers (heading outline resolution is out of this slice).
 */
export interface SectionPageNumbering {
  /** Authored `@w:start` when present and in range; otherwise omitted. */
  readonly start?: number;
  /** Authored `@w:fmt` (ST_NumberFormat) when present; otherwise omitted. */
  readonly fmt?: string;
  /** Authored `@w:chapStyle` outline level when present and in range. */
  readonly chapStyle?: number;
  /** Authored `@w:chapSep` when present (hyphen / period / colon / emDash / enDash). */
  readonly chapSep?: string;
}

export interface SectionProperties {
  readonly pageSize: { readonly widthTwips: number; readonly heightTwips: number };
  readonly margins: SectionMargins;
  readonly columns: SectionColumns;
  readonly landscape: boolean;
  readonly titlePage: boolean;
  /** Absent `w:type` defaults to `nextPage`. */
  readonly breakType: SectionBreakType;
  /**
   * Authored page-number type. Absent when `w:pgNumType` is missing; empty object when the
   * element is present with no attributes (comprehensive-fixture shape).
   */
  readonly pageNumbering?: SectionPageNumbering;
}

/**
 * One section of the body story: contiguous top-level blocks plus the properties that end it.
 *
 * `blockStart` / `blockEndExclusive` index into `storyBlocks(part)`.
 */
export interface DocumentSection {
  readonly index: number;
  readonly properties: SectionProperties;
  readonly blockStart: number;
  readonly blockEndExclusive: number;
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
  columns: Object.freeze({
    count: 1,
    gapTwips: 720,
    equalWidth: true,
    separator: false,
    definitions: Object.freeze([]),
  }),
  landscape: false,
  titlePage: false,
  breakType: 'nextPage',
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

/** Column gaps may be zero; unlike page dimensions they are not required to be positive. */
function nonNegativeTwips(raw: string | undefined, fallback: number, max = 31680): number {
  if (raw === undefined || !/^\d{1,7}$/.test(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > max) return fallback;
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

function onOffAttribute(node: OoxmlNode, name: string, fallback: boolean): boolean {
  const value = attribute(node, name);
  if (value === undefined) return fallback;
  if (value === '0' || value === 'false' || value === 'off' || value === 'no') return false;
  if (value === '1' || value === 'true' || value === 'on' || value === 'yes') return true;
  return fallback;
}

function columnCount(cols: OoxmlNode | undefined): number {
  if (!cols) return 1;
  const raw = attribute(cols, 'num');
  if (!raw || !/^\d{1,7}$/.test(raw)) return 1;
  return Math.max(1, Math.min(12, Number(raw)));
}

function columnDefinitions(
  cols: OoxmlNode | undefined,
  count: number,
  fallbackGapTwips: number
): readonly SectionColumnDefinition[] {
  if (!cols || cols.kind === 'textValue') return [];
  const definitions: SectionColumnDefinition[] = [];
  for (const child of cols.children ?? []) {
    if (
      definitions.length >= count ||
      child.kind === 'textValue' ||
      !('localName' in child) ||
      child.localName !== 'col'
    ) {
      continue;
    }
    const index = definitions.length;
    definitions.push({
      widthTwips: twips(attribute(child, 'w'), 1, 31680),
      gapTwips:
        index === count - 1 ? 0 : nonNegativeTwips(attribute(child, 'space'), fallbackGapTwips),
    });
  }
  return definitions;
}

function breakTypeOf(sectPr: OoxmlNode | undefined): SectionBreakType {
  const type = sectPr ? childNamed(sectPr, 'type') : undefined;
  const value = type ? attribute(type, 'val') : undefined;
  if (
    value === 'continuous' ||
    value === 'evenPage' ||
    value === 'oddPage' ||
    value === 'nextColumn'
  ) {
    return value;
  }
  // Absent or unknown → nextPage (ECMA-376 §17.6.22).
  return 'nextPage';
}

const CHAPTER_SEPS = new Set(['hyphen', 'period', 'colon', 'emDash', 'enDash']);

/**
 * Parse authored `w:pgNumType` without inventing schema defaults.
 *
 * Returns `undefined` when the element is absent. An empty element yields `{}` so callers
 * can tell "present but unauthored" from "missing" and serialization can re-emit empty.
 * Hostile / out-of-range attribute values are dropped rather than clamped into meaning.
 */
export function parsePageNumbering(sectPr: OoxmlNode): SectionPageNumbering | undefined {
  const pgNumType = childNamed(sectPr, 'pgNumType');
  if (!pgNumType || pgNumType.kind === 'textValue') return undefined;

  const numbering: {
    start?: number;
    fmt?: string;
    chapStyle?: number;
    chapSep?: string;
  } = {};

  const startRaw = attribute(pgNumType, 'start');
  if (startRaw !== undefined && /^-?\d{1,7}$/.test(startRaw)) {
    const start = Number(startRaw);
    // Page starts are positive; Word rejects 0 / negative in practice. Cap hostile sizes.
    if (Number.isFinite(start) && start >= 0 && start <= 9999) numbering.start = start;
  }

  const fmt = attribute(pgNumType, 'fmt');
  if (fmt !== undefined && fmt.length > 0 && fmt.length <= 64 && !/[<>&"']/.test(fmt)) {
    numbering.fmt = fmt;
  }

  const chapStyleRaw = attribute(pgNumType, 'chapStyle');
  if (chapStyleRaw !== undefined && /^\d{1,2}$/.test(chapStyleRaw)) {
    const chapStyle = Number(chapStyleRaw);
    // Outline levels are 0…9 in WordprocessingML heading practice.
    if (Number.isFinite(chapStyle) && chapStyle >= 0 && chapStyle <= 9) {
      numbering.chapStyle = chapStyle;
    }
  }

  const chapSep = attribute(pgNumType, 'chapSep');
  if (chapSep !== undefined && CHAPTER_SEPS.has(chapSep)) numbering.chapSep = chapSep;

  return numbering;
}

/** Parse one `w:sectPr` into geometry/break properties (null reads as Word's defaults). */
export function parseSectionProperties(sectPr: OoxmlNode | null | undefined): SectionProperties {
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

  const pageNumbering = parsePageNumbering(sectPr);
  const count = columnCount(cols);
  const gapTwips = cols
    ? nonNegativeTwips(attribute(cols, 'space'), defaults.columns.gapTwips)
    : defaults.columns.gapTwips;
  const equalWidth = cols ? onOffAttribute(cols, 'equalWidth', true) : true;

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
      count,
      gapTwips,
      equalWidth,
      separator: cols ? onOffAttribute(cols, 'sep', false) : false,
      definitions: equalWidth ? [] : columnDefinitions(cols, count, gapTwips),
    },
    // Render-truthful: Word writes swapped dimensions AND the attribute, but a file may
    // carry only one. Width exceeding height IS a landscape page whatever the attribute
    // says, because layout paginates against the dimensions.
    landscape: orientation === 'landscape' || width > height,
    titlePage: readOnOffChild(sectPr, 'titlePg'),
    breakType: breakTypeOf(sectPr),
    ...(pageNumbering !== undefined ? { pageNumbering } : {}),
  };
}

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

/** `w:sectPr` nested under a paragraph's `w:pPr`, if present. */
export function paragraphSectionNode(paragraph: OoxmlElement): OoxmlElement | undefined {
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  if (!pPr) return undefined;
  const sectPr = childNamed(pPr, 'sectPr');
  return sectPr && sectPr.kind !== 'textValue' ? (sectPr as OoxmlElement) : undefined;
}

/**
 * The section properties a part declares, or Word's defaults where it says nothing.
 *
 * Returns the FINAL section (body-level `w:sectPr`, else the last paragraph-level one).
 * Multi-section geometry belongs to `enumerateDocumentSections`; chrome that needs "the
 * document's page" still reads the last section, which is what Word's body-level sectPr is.
 */
export function readSectionProperties(part: OoxmlPart): SectionProperties {
  const sections = enumerateDocumentSections(part);
  return sections[sections.length - 1]?.properties ?? DEFAULT_SECTION_PROPERTIES;
}

/**
 * Split the body story into sections.
 *
 * A paragraph carrying `w:pPr/w:sectPr` ends the current section (that paragraph is IN the
 * section being ended). The body-level `w:sectPr` ends the final section. A document with
 * neither yields one section of Word defaults covering every block.
 *
 * Enumeration is capped at {@link MAX_DOCUMENT_SECTIONS}. Further paragraph-level section
 * breaks are ignored and remaining blocks fold into the last accepted section (fail closed).
 *
 * `displayMode` MUST match the one the caller passes to `storyBlocks`. `blockStart` /
 * `blockEndExclusive` are indices into that list, and the list changes shape with the mode:
 * the proposed view drops a paragraph whose mark and content a revision both removed. Slicing
 * a filtered list with indices counted over an unfiltered one puts body text under another
 * section's page geometry — the wrong paper size, the wrong margins, the wrong header.
 */
export function enumerateDocumentSections(
  part: OoxmlPart,
  displayMode: RevisionDisplayMode = 'all-markup'
): DocumentSection[] {
  return enumerateDocumentSectionsBounded(part, displayMode).sections;
}

export interface DocumentSectionsEnumeration {
  readonly sections: DocumentSection[];
  /** True when paragraph-level sectPr marks beyond {@link MAX_DOCUMENT_SECTIONS} were dropped. */
  readonly truncated: boolean;
}

/**
 * Like {@link enumerateDocumentSections}, but reports whether the section bound clipped
 * hostile input. Prefer the plain enumerator for normal layout; use this when a caller
 * needs a named fail-closed diagnostic.
 */
export function enumerateDocumentSectionsBounded(
  part: OoxmlPart,
  displayMode: RevisionDisplayMode = 'all-markup'
): DocumentSectionsEnumeration {
  const blocks = storyBlocks(part, displayMode);
  const sections: DocumentSection[] = [];
  let blockStart = 0;
  let truncated = false;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.kind !== 'paragraph') continue;
    const sectPr = paragraphSectionNode(block);
    if (!sectPr) continue;
    if (sections.length >= MAX_DOCUMENT_SECTIONS) {
      truncated = true;
      continue;
    }
    sections.push({
      index: sections.length,
      properties: parseSectionProperties(sectPr),
      blockStart,
      blockEndExclusive: index + 1,
    });
    blockStart = index + 1;
  }

  if (truncated) {
    // Hostile extra breaks ignored: extend the last accepted section over remaining blocks.
    if (sections.length > 0) {
      const last = sections[sections.length - 1]!;
      sections[sections.length - 1] = {
        ...last,
        blockEndExclusive: blocks.length,
      };
    }
    return { sections, truncated: true };
  }

  const bodySectPr = bodySectionNode(part);
  // Final section: remaining blocks governed by the body-level `w:sectPr`. When every block
  // already closed a paragraph-level section, still honour a trailing body-level `sectPr` as
  // an empty final section (common in multi-section packages). A document with neither yields
  // one default section covering every block.
  if (blockStart < blocks.length || sections.length === 0) {
    if (sections.length >= MAX_DOCUMENT_SECTIONS) {
      const last = sections[sections.length - 1]!;
      sections[sections.length - 1] = { ...last, blockEndExclusive: blocks.length };
      return { sections, truncated: true };
    }
    sections.push({
      index: sections.length,
      properties: parseSectionProperties(bodySectPr),
      blockStart,
      blockEndExclusive: blocks.length,
    });
  } else if (bodySectPr) {
    if (sections.length >= MAX_DOCUMENT_SECTIONS) {
      return { sections, truncated: true };
    }
    sections.push({
      index: sections.length,
      properties: parseSectionProperties(bodySectPr),
      blockStart,
      blockEndExclusive: blocks.length,
    });
  }

  return { sections, truncated };
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
