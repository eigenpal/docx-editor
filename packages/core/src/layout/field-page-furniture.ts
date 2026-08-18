// Page-number fields across the FINISHED document, rather than inside one paragraph.
//
// PAGE, NUMPAGES and SECTIONPAGES cannot be resolved while a paragraph is being measured: the
// values are properties of a pagination that has not happened yet. So header/footer stories are
// laid out once carrying a projector, pages carry a {@link PageFieldSource} describing what the
// section says their numbering is, and the substitution happens here — once, after the page
// count is known.
//
// Split from `field-projection.ts`, which owns the paragraph walk. Nothing in this module reads
// a run; nothing in that one knows how many pages the document has. The dependency runs one way
// (`field-projection` re-exports these so existing importers keep one import site), so the two
// shared types live here rather than there.

import type { AllowlistedPageField, StoryPageFieldNeeds } from './field-instruction.ts';
import { NO_STORY_PAGE_FIELDS } from './field-instruction.ts';
import { formatDecimal, formatNumFmt } from './numbering-format.ts';
import type {
  BlockFragmentRecord,
  HeaderFooterStoryRecord,
  LineRecord,
  PageRecord,
  SemanticLayout,
  StyleSpanRecord,
} from './semantic-records.ts';

/**
 * Placeholder a body PAGE/NUMPAGES/SECTIONPAGES atom paints during measurement.
 *
 * Body content flows once, before the page count is known, so the real value cannot be measured
 * in place. The paragraph walk reserves one model unit and paints this single digit; document
 * finalize substitutes the value the atom lands on ({@link substituteBodyPageFields}). A digit is
 * chosen so a one-digit page number lays out exactly and a multi-digit one shifts only its own
 * trailing content on the line — the same non-reflow Word shows.
 */
export const PAGE_FIELD_PLACEHOLDER = '0';

/**
 * Page-field evaluation context for furniture projection.
 *
 * `pageNumber` is the displayed PAGE value after section `w:pgNumType/@w:start` (1-based).
 * `pageCount` is document NUMPAGES. `sectionPageCount` is SECTIONPAGES for the attached
 * section. `format` is the authored `w:pgNumType/@w:fmt` applied only to PAGE.
 */
export interface FieldPageContext {
  readonly pageNumber: number;
  readonly pageCount: number;
  /** SECTIONPAGES; defaults to `pageCount` when omitted (single-section callers). */
  readonly sectionPageCount?: number;
  /** Authored ST_NumberFormat for PAGE; absent → decimal. */
  readonly format?: string;
}

/**
 * Format a displayed PAGE value through the shared ST_NumberFormat resolver.
 *
 * Unknown / script-specific formats fall back to decimal (same convention as list markers).
 * `none` / `bullet` are meaningless for page numbers and also fall back to decimal so a
 * hostile fmt cannot blank the furniture.
 */
export function formatPageNumber(value: number, format: string | undefined): string {
  if (!Number.isFinite(value) || value < 0) return '';
  const n = Math.floor(value);
  const fmt = format && format.length > 0 ? format : 'decimal';
  if (fmt === 'none' || fmt === 'bullet') return formatDecimal(n);
  const text = formatNumFmt(fmt, n);
  return text.length > 0 ? text : formatDecimal(n);
}

/** Digit / formatted string for an allowlisted page field under a page context. */
export function projectPageFieldValue(
  kind: AllowlistedPageField,
  context: FieldPageContext
): string {
  if (kind === 'PAGE') return formatPageNumber(context.pageNumber, context.format);
  const value =
    kind === 'NUMPAGES' ? context.pageCount : (context.sectionPageCount ?? context.pageCount);
  // Layout-derived counts are already bounded by pagination; still refuse non-finite junk.
  if (!Number.isFinite(value) || value < 0) return '';
  return formatDecimal(Math.floor(value));
}

/**
 * Per-page source for {@link finalizePageFieldProjection}, attached before document-level
 * page count is known. `pageCount` (NUMPAGES) is filled at finalize from `layout.pages.length`.
 */
export interface PageFieldSource {
  readonly pageNumber: number;
  readonly sectionPageCount: number;
  readonly format?: string;
}

/** True when any allowlisted page field is present. */
export function storyNeedsPageFields(needs: StoryPageFieldNeeds): boolean {
  return needs.hasPage || needs.hasNumPages || needs.hasSectionPages;
}

/**
 * Cache-key token for a page context under known field needs.
 *
 * Absent context and field-free stories share the empty baseline key. Keys include only the
 * dimensions the story actually reads so NUMPAGES-only / SECTIONPAGES-only stories reuse one
 * layout across every sheet that shares that count, while PAGE (and format) still distinguish
 * sheets whose measured digit widths differ.
 */
export function fieldPageContextToken(
  context: FieldPageContext | undefined,
  needs: StoryPageFieldNeeds = NO_STORY_PAGE_FIELDS
): string {
  if (!context) return '';
  if (!storyNeedsPageFields(needs)) return '';
  const parts: string[] = [];
  if (needs.hasPage) {
    parts.push(`p${context.pageNumber}`);
    if (context.format) parts.push(`f${context.format}`);
  }
  if (needs.hasNumPages) parts.push(`n${context.pageCount}`);
  if (needs.hasSectionPages) parts.push(`s${context.sectionPageCount ?? context.pageCount}`);
  return `|fld:${parts.join('/')}`;
}

/**
 * Attach section-local PAGE/SECTIONPAGES sources to remapped sheet pages.
 *
 * `displayedStart` is the 1-based PAGE value of the first page in `pages` (after
 * `w:pgNumType/@w:start` and cross-section continuation). NUMPAGES is filled later at
 * document finalize.
 *
 * Pages whose existing {@link PageFieldSource} already matches are returned by identity so
 * incremental layout can keep sheet records stable across no-op re-annotation.
 */
export function withPageFieldSources(
  pages: readonly PageRecord[],
  displayedStart: number,
  sectionPageCount: number,
  format: string | undefined
): PageRecord[] {
  let changed = false;
  const next = pages.map((page, index) => {
    const pageNumber = displayedStart + index;
    const existing = page.pageFieldSource;
    if (
      existing &&
      existing.pageNumber === pageNumber &&
      existing.sectionPageCount === sectionPageCount &&
      existing.format === format
    ) {
      return page;
    }
    changed = true;
    return {
      ...page,
      pageFieldSource: {
        pageNumber,
        sectionPageCount,
        ...(format ? { format } : {}),
      },
    };
  });
  return changed ? next : (pages as PageRecord[]);
}

/**
 * Substitute a body page-field placeholder line, or return it by identity.
 *
 * Only a span carrying a {@link FieldAtomMarker.pageField} marker is touched, and only when the
 * value the atom lands on differs from what the span already paints. The span's model `range`
 * stays its reserved one-unit width whatever the substituted text length is — paint and the
 * offset accounting clamp to that width, so a multi-digit page number never lengthens the model.
 */
function substituteBodyPageFieldLine(line: LineRecord, context: FieldPageContext): LineRecord {
  let spans: StyleSpanRecord[] | null = null;
  for (let index = 0; index < line.spans.length; index += 1) {
    const span = line.spans[index]!;
    const kind = span.fieldAtom?.pageField?.kind;
    if (!kind) continue;
    const text = projectPageFieldValue(kind, context);
    if (text === span.text) continue;
    if (!spans) spans = line.spans.slice();
    spans[index] = { ...span, text };
  }
  return spans ? { ...line, spans } : line;
}

/**
 * Substitute every body page-field placeholder in one block list against a page's context, or
 * return the list by identity when nothing changed.
 *
 * Recurses through table rows and cells, so a PAGE field inside a body table cell resolves the
 * same way a top-level one does. New records are minted only along the path to a changed span,
 * mirroring {@link finalizePageFieldProjection}'s identity discipline so incremental layout keeps
 * reusing untouched pages.
 */
export function substituteBodyPageFields(
  blocks: readonly BlockFragmentRecord[],
  context: FieldPageContext
): readonly BlockFragmentRecord[] {
  let next: BlockFragmentRecord[] | null = null;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    let replacement: BlockFragmentRecord = block;
    if (block.kind === 'paragraph') {
      let mutatedLines: LineRecord[] | null = null;
      for (let lineIndex = 0; lineIndex < block.lines.length; lineIndex += 1) {
        const line = block.lines[lineIndex]!;
        const nextLine = substituteBodyPageFieldLine(line, context);
        if (nextLine === line) continue;
        if (!mutatedLines) mutatedLines = block.lines.slice();
        mutatedLines[lineIndex] = nextLine;
      }
      if (mutatedLines) replacement = { ...block, lines: mutatedLines };
    } else {
      let mutatedRows: (typeof block.rows)[number][] | null = null;
      for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
        const row = block.rows[rowIndex]!;
        let mutatedCells: (typeof row.cells)[number][] | null = null;
        for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
          const cell = row.cells[cellIndex]!;
          const cellBlocks = substituteBodyPageFields(cell.blocks, context);
          if (cellBlocks === cell.blocks) continue;
          if (!mutatedCells) mutatedCells = row.cells.slice();
          mutatedCells[cellIndex] = { ...cell, blocks: cellBlocks };
        }
        if (!mutatedCells) continue;
        if (!mutatedRows) mutatedRows = block.rows.slice();
        mutatedRows[rowIndex] = { ...row, cells: mutatedCells };
      }
      if (mutatedRows) replacement = { ...block, rows: mutatedRows };
    }
    if (replacement === block) continue;
    if (!next) next = blocks.slice();
    next[index] = replacement;
  }
  return next ?? blocks;
}

/**
 * Project allowlisted PAGE/NUMPAGES/SECTIONPAGES once the document page count is known.
 *
 * Header/footer furniture substitutes through each story's transient projector. Body flow (and
 * body tables) substitutes the placeholders the paragraph walk reserved, using the SAME per-page
 * context — {@link PageFieldSource} when present (section restart + SECTIONPAGES + fmt), else the
 * physical 1-based index and the whole document as one section (empty-`pgNumType` behaviour).
 * Pages and stories with no page field are returned by identity.
 */
export function finalizePageFieldProjection(layout: SemanticLayout): SemanticLayout {
  const pageCount = layout.pages.length;
  if (pageCount === 0) return layout;

  let changed = false;
  const pages = layout.pages.map((page) => {
    const source = page.pageFieldSource;
    const context: FieldPageContext = {
      pageNumber: source?.pageNumber ?? page.index + 1,
      pageCount,
      sectionPageCount: source?.sectionPageCount ?? pageCount,
      ...(source?.format ? { format: source.format } : {}),
    };
    const project = (
      story: HeaderFooterStoryRecord | undefined
    ): HeaderFooterStoryRecord | undefined => {
      if (!story?.pageFieldProjector) return story;
      changed = true;
      const projected = story.pageFieldProjector(context);
      // Strip the projector from the published record.
      const { pageFieldProjector: _drop, ...rest } = projected;
      void _drop;
      return rest;
    };
    const header = project(page.header);
    const footer = project(page.footer);
    const fragments = substituteBodyPageFields(page.fragments, context);
    if (header === page.header && footer === page.footer && fragments === page.fragments) {
      return page;
    }
    if (fragments !== page.fragments) changed = true;
    return {
      ...page,
      ...(header !== undefined ? { header } : {}),
      ...(footer !== undefined ? { footer } : {}),
      ...(fragments !== page.fragments ? { fragments } : {}),
    };
  });

  return changed ? { revision: layout.revision, pages } : layout;
}
