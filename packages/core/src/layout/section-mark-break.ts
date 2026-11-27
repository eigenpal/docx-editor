// Where an empty section mark stays when a page break precedes it or it carries its own.

import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { paragraphMarkHidden } from './hidden-paragraph-mark.ts';
import { paragraphSectionNode, type DocumentSection } from './section-properties.ts';

/** Paragraph properties, a bookmark, or a run that holds only its properties. */
const isBareMarkChild = (child: OoxmlNode): boolean =>
  child.kind === 'paragraphProperties' ||
  child.kind === 'bookmarkStart' ||
  child.kind === 'bookmarkEnd' ||
  (child.kind === 'run' && child.children.every((part) => part.kind === 'runProperties'));

/**
 * Whether a paragraph holds nothing but its mark: no run text, tab, break, drawing, or field.
 * Hidden text counts as content. Paragraph properties (numbering, borders, shading) do not.
 */
function holdsOnlyItsMark(paragraph: OoxmlElement): boolean {
  return paragraph.children.every(isBareMarkChild);
}

/** Paragraph-level markers that take no width: proofing state, permission and comment ranges. */
const INERT_MARKERS: ReadonlySet<string> = new Set([
  'proofErr',
  'permStart',
  'permEnd',
  'commentRangeStart',
  'commentRangeEnd',
]);

const isInertMarker = (child: OoxmlNode): boolean =>
  child.kind !== 'textValue' &&
  child.namespaceUri === WML_NAMESPACE_URI &&
  INERT_MARKERS.has(child.localName) &&
  child.children.length === 0;

/**
 * Run content that takes no width: a zero-length `w:t` and the saved last-rendered page break,
 * which records an earlier layout and breaks nothing. A space is text.
 */
const isInertRunPart = (part: OoxmlNode): boolean => {
  if (part.kind === 'runProperties') return true;
  if (part.kind === 'textValue' || part.namespaceUri !== WML_NAMESPACE_URI) return false;
  if (part.localName === 't') {
    return part.children.every((text) => text.kind === 'textValue' && text.value === '');
  }
  return part.localName === 'lastRenderedPageBreak' && part.children.length === 0;
};

/**
 * `holdsOnlyItsMark`, and also inert markers and runs of inert content. Text, a space, a tab,
 * hidden text, a field, and unknown content still count. Only the page-break-before rule
 * uses it; the mark-only section test keeps `holdsOnlyItsMark`.
 */
function holdsOnlyInertContent(paragraph: OoxmlElement): boolean {
  return paragraph.children.every(
    (child) =>
      isBareMarkChild(child) ||
      isInertMarker(child) ||
      (child.kind === 'run' && child.children.every(isInertRunPart))
  );
}

/**
 * Whether a section is nothing but its own empty mark paragraph. Structural, so the section
 * loop can ask it before any section is laid out; the flow pass still makes the final call
 * with measured lines.
 */
function isMarkOnlySection(blocks: readonly OoxmlElement[], section: DocumentSection): boolean {
  if (section.blockEndExclusive - section.blockStart !== 1) return false;
  const block = blocks[section.blockStart];
  return (
    block?.kind === 'paragraph' &&
    paragraphSectionNode(block) !== undefined &&
    holdsOnlyItsMark(block)
  );
}

/**
 * Whether a section's block at `at` is an empty section mark after the section's content.
 * Such a mark ignores its own `w:pageBreakBefore`: it ends the section on the sheet that
 * content reached, and the next section's break type alone decides where that section
 * starts. A mark that is its section's only block is that section's content, so its page
 * break still applies.
 */
export function markIgnoresPageBreakBefore(
  block: OoxmlElement,
  at: number,
  sectionBlockCount: number
): boolean {
  return (
    at > 0 &&
    at === sectionBlockCount - 1 &&
    block.kind === 'paragraph' &&
    paragraphSectionNode(block) !== undefined &&
    holdsOnlyInertContent(block)
  );
}

/**
 * For each section, whether the empty mark that ends it may stay on the sheet a page break
 * just closed, instead of opening a sheet of its own.
 *
 * A page break followed by an empty section mark advances ONE sheet when the next section
 * opens a new sheet anyway. Mark-only sections that continue on the same sheet in between
 * change nothing, so the answer passes through them. A section with content that continues
 * the sheet stops it: that content starts after the break, and the mark goes with it. The
 * last section has nothing after it, so a trailing break there keeps its empty sheet.
 *
 * One backward sweep, so a run of mark-only sections costs one step each rather than one
 * walk each: the section count comes from the file.
 *
 * `sharesSheet(index)` says whether section `index` continues the sheet of section
 * `index - 1`.
 */
export function sectionMarksJoiningBreakSheet(
  sections: readonly DocumentSection[],
  blocks: readonly OoxmlElement[],
  sharesSheet: (index: number) => boolean
): boolean[] {
  const joins = new Array<boolean>(sections.length).fill(false);
  for (let index = sections.length - 2; index >= 0; index -= 1) {
    const next = index + 1;
    joins[index] =
      !sharesSheet(next) || (isMarkOnlySection(blocks, sections[next]!) && joins[next]!);
  }
  return joins;
}

/**
 * Whether a paragraph is a bare section mark: it carries a paragraph-level `w:sectPr` and holds
 * nothing but inert content. Such a mark paints neither its borders nor its shading.
 */
export function isBareSectionMark(paragraph: OoxmlElement): boolean {
  return paragraphSectionNode(paragraph) !== undefined && holdsOnlyInertContent(paragraph);
}

/**
 * Whether an empty section mark before a continuous section stays in the flow because a table
 * is directly before it (`w:sectPr`, `CT_SectPr`, ECMA-376 Part 1 §17.6.18; `w:type`,
 * `CT_SectType`, §17.6.22). The mark is then the paragraph that closes the table: it keeps its
 * line and its space after, and its space before is not applied. Compatibility mode 15 and
 * later only; in legacy modes the mark takes no room after a table either.
 *
 * `previous` is the block before the mark in document order. A positioned table (`w:tblpPr`,
 * `CT_TblPPr`, §17.4.57) counts wherever it stands on the page. A hidden mark
 * (`paragraphMarkHidden`) joins the next paragraph and keeps no line. The line still cannot
 * open a page: at the bottom of a page the mark stays there and the next section starts on the
 * next page.
 */
export function markStaysAfterTable(
  mark: OoxmlElement,
  previous: { readonly kind: string } | undefined,
  compatibilityMode: number | undefined
): boolean {
  return (
    previous?.kind === 'table' &&
    hasCompatibilityRule(compatibilityMode, 'sectionMarkAfterTableKeepsLine') &&
    !paragraphMarkHidden(mark)
  );
}

/**
 * The space after that the flow carries past an empty section mark that takes no room, for
 * the space before of the next section's first paragraph to collapse against (`w:spacing`,
 * `CT_Spacing`, ECMA-376 Part 1 §17.3.1.33).
 *
 * The mark is the paragraph directly before that paragraph, so its own space after is the one
 * that collapses: the next paragraph adds only the part of its space before that exceeds it.
 * The mark's space after itself takes no room, and the space after of the paragraph before
 * the mark stays in full. `own` and `previous` are the collapsing parts of the mark's space
 * after and of the space after before the mark. A hidden mark joins the next paragraph and
 * has no spacing of its own, so the earlier space after still collapses.
 */
export function markCarriedAfter(mark: OoxmlElement, own: number, previous: number): number {
  return paragraphMarkHidden(mark) ? previous : own;
}
