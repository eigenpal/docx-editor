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
import { formatNumericPicture } from './field-numeric-picture.ts';
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
 * finalize substitutes the value the atom lands on ({@link substituteBodyPageFields}). The field
 * is measured at this one-digit width. A one-digit value lays out exactly. A multi-digit value
 * that is NOT last on its line paints its extra digits over the following same-line content,
 * because that content was placed at the one-digit x; Word instead re-measures and reflows.
 * Last-on-line and label usage (the common cases) are unaffected.
 *
 * A field with a `\#` picture measures through {@link pageFieldPlaceholder} instead: the
 * picture states the width, so there is no reason to guess at one digit.
 */
export const PAGE_FIELD_PLACEHOLDER = '0';

/**
 * The placeholder a body page field with `picture` should be MEASURED at.
 *
 * A picture decides how wide the substituted value is, and finalize swaps the text in without
 * re-measuring. `PAGE \# "Page 0 of"` paints about ten characters, so measuring it at one
 * would overprint whatever follows it on the line. Rendering zero through the picture gives a
 * placeholder the same shape as every value it can be replaced by — `0#` measures `00`, the
 * width of `02` — while a pictureless field keeps the historical single digit.
 */
export function pageFieldPlaceholder(picture: string | undefined): string {
  if (picture === undefined) return PAGE_FIELD_PLACEHOLDER;
  return formatNumericPicture(0, picture) ?? PAGE_FIELD_PLACEHOLDER;
}

/**
 * Page-field evaluation context for furniture projection.
 *
 * `pageNumber` is the displayed PAGE value after section `w:pgNumType/@w:start` (1-based).
 * `pageCount` is document NUMPAGES. `sectionPageCount` is SECTIONPAGES for the attached
 * section. `format` is the authored `w:pgNumType/@w:fmt` applied only to PAGE.
 *
 * A new field here must also join `sameFieldPageContext` below, or finalize compares two
 * contexts that differ in it as equal and keeps a reused story's stale text.
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

/**
 * Digit / formatted string for an allowlisted page field under a page context.
 *
 * `picture` is the field's `\#` switch. It renders the computed value and outranks nothing
 * else: an unusable picture falls back to the plain number, never to the cached result. A
 * NON-DECIMAL `w:pgNumType/@w:fmt` on PAGE wins instead, because a roman or alphabetic page
 * number has no digits for a numeric picture to place. An authored `w:fmt="decimal"` — which
 * Word writes — is decimal, so the picture still applies.
 */
export function projectPageFieldValue(
  kind: AllowlistedPageField,
  context: FieldPageContext,
  picture?: string
): string {
  if (kind === 'PAGE') {
    if (picture !== undefined && (!context.format || context.format === 'decimal')) {
      const painted = formatNumericPicture(context.pageNumber, picture);
      if (painted !== null) return painted;
    }
    return formatPageNumber(context.pageNumber, context.format);
  }
  const value =
    kind === 'NUMPAGES' ? context.pageCount : (context.sectionPageCount ?? context.pageCount);
  // Layout-derived counts are already bounded by pagination; still refuse non-finite junk.
  if (!Number.isFinite(value) || value < 0) return '';
  if (picture !== undefined) {
    const painted = formatNumericPicture(value, picture);
    if (painted !== null) return painted;
  }
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

/** True when any span on this line carries a body page-field marker. */
function lineHasBodyPageField(line: LineRecord): boolean {
  for (const span of line.spans) {
    if (span.fieldAtom?.pageField) return true;
  }
  return false;
}

/**
 * True when a paragraph or a nested-table cell in this block carries a body page field.
 *
 * Recurses table rows and cells, matching {@link substituteBodyPageFields}'s reach, so a page's
 * `hasBodyPageFields` flag agrees exactly with whether the substitution walk would change
 * anything. The marker is a property of the paragraph content, not of the page, so the answer is
 * the same across every sheet.
 */
function blockHasBodyPageField(block: BlockFragmentRecord): boolean {
  if (block.kind === 'paragraph') {
    for (const line of block.lines) {
      if (lineHasBodyPageField(line)) return true;
    }
    return false;
  }
  for (const row of block.rows) {
    for (const cell of row.cells) {
      for (const inner of cell.blocks) {
        if (blockHasBodyPageField(inner)) return true;
      }
    }
  }
  return false;
}

/**
 * Fold a flushed body page's fragments into the two facts pagination needs from them: the deepest
 * used bottom (column-separator sizing) and whether ANY body page field is present. Both fall out
 * of the one pass the page assembly already had to make, so the flag costs no extra traversal.
 *
 * The `hasBodyPageFields` result is stamped on the {@link PageRecord} and rides it through
 * incremental reuse. So a page rebuilt this pass is walked once here; a page reused by identity
 * keeps its fresh, content-derived answer without a second scan. When the flag is `false`,
 * {@link finalizePageFieldProjection} skips the substitution walk for that page entirely — the
 * common case, since page numbers usually live in footers, not the body flow.
 */
export function summarizeFlushedPage(
  fragments: readonly BlockFragmentRecord[],
  regionTop: number
): { readonly usedBottom: number; readonly hasBodyPageFields: boolean } {
  let usedBottom = regionTop;
  let hasBodyPageFields = false;
  for (const fragment of fragments) {
    usedBottom = Math.max(usedBottom, fragment.box.y + fragment.box.height);
    if (!hasBodyPageFields && blockHasBodyPageField(fragment)) hasBodyPageFields = true;
  }
  return { usedBottom, hasBodyPageFields };
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
    const marker = span.fieldAtom?.pageField;
    if (!marker) continue;
    const text = projectPageFieldValue(marker.kind, context, marker.picture);
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

/** Story projector retained past finalize, with the context its published text was projected under. */
interface RetainedStoryProjection {
  readonly context: FieldPageContext;
  readonly projector: (context: FieldPageContext) => HeaderFooterStoryRecord;
  /**
   * Cumulative sheet-stack Y offset between where the projector places the story and where
   * the published record sits. A NUMBER, not a composed closure: a sheet that survives many
   * tail shifts folds each shift into this one value, so re-projection stays one projector
   * call plus one translation however long the reuse lineage gets.
   */
  readonly dy: number;
}

/**
 * Projectors of PUBLISHED story records, keyed on the stripped record finalize minted.
 *
 * Finalize strips `pageFieldProjector` from what it publishes, but incremental layout reuses
 * published sheets whole: a later pass that changes the page count hands those stripped
 * records straight back to finalize, which then has nothing to re-project NUMPAGES through —
 * the reused footer kept the old `of Y` text. Retaining the projector on the side (with the
 * context it last ran under) lets finalize keep an unchanged-context story by identity and
 * re-project it when the pagination moved underneath it. Weak on the story record, so a story
 * that falls out of the layout takes its projector with it. The retained closure keeps its
 * minting pass's scope alive for as long as the sheet is reused — the same retention profile
 * the multi-section span cache already has for LIVE projectors on `previousRemapped` pages.
 *
 * INVARIANT: anything that CLONES a published field-bearing story record must carry this
 * entry onto the clone ({@link carryStrippedPageFieldProjection}) — a published story leaves
 * no data trace of its field needs, so an orphaned clone silently keeps stale text.
 * `remapPage` is the one cloner today.
 */
const strippedStoryProjections = new WeakMap<HeaderFooterStoryRecord, RetainedStoryProjection>();

/**
 * True when two projection contexts substitute identical values for every page field.
 *
 * Compares EVERY dimension of {@link FieldPageContext}, so it must grow in lockstep with
 * that interface: a context field this misses compares as "same context" and finalize keeps
 * a reused story's stale text. Needs-blind on purpose — finalize does not know which fields
 * a published story reads, so it re-projects on any moved dimension; the story layout's own
 * per-token cache absorbs the re-layout when the story's text did not actually change.
 */
function sameFieldPageContext(a: FieldPageContext, b: FieldPageContext): boolean {
  return (
    a.pageNumber === b.pageNumber &&
    a.pageCount === b.pageCount &&
    (a.sectionPageCount ?? a.pageCount) === (b.sectionPageCount ?? b.pageCount) &&
    a.format === b.format
  );
}

/**
 * Carry a published story's retained projection onto its Y-shifted twin, `dy` points away.
 *
 * `remapPage` moves a reused sheet's furniture by minting a shifted record, which would
 * orphan the retained projector — the shifted footer could never re-project at a new page
 * count. The shift folds into the retained OFFSET rather than wrapping the projector in
 * another closure, so repeated shifts cannot accumulate a call chain. The retained context
 * is the source's: the shifted text is still the text projected under it, and the first
 * finalize whose context differs re-projects.
 */
export function carryStrippedPageFieldProjection(
  source: HeaderFooterStoryRecord,
  shifted: HeaderFooterStoryRecord,
  dy: number
): void {
  const retained = strippedStoryProjections.get(source);
  if (!retained) return;
  strippedStoryProjections.set(shifted, {
    context: retained.context,
    projector: retained.projector,
    dy: retained.dy + dy,
  });
}

/**
 * Finalized projection of one page under one total page count, memoized on the immutable
 * page record.
 *
 * The whole per-page finalize is a pure function of the page record and `pageCount`: the
 * field context reads `pageFieldSource` and `index` off the record, and the story
 * projectors are deterministic closures the story layout minted. Without this memo an
 * incremental pass that reused 555 of 561 pages by identity still re-projected all 561 —
 * including a header/footer story RE-LAYOUT for every sheet whose furniture carries a PAGE
 * field — and then threw 555 of those fresh records away when the previous finalized
 * identities were restored. Same idiom as `publishedPageMemos` in `multi-section-layout.ts`.
 */
const finalizedPageMemos = new WeakMap<PageRecord, { pageCount: number; result: PageRecord }>();

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
    const memo = finalizedPageMemos.get(page);
    if (memo && memo.pageCount === pageCount) {
      if (memo.result !== page) changed = true;
      return memo.result;
    }
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
      if (!story) return story;
      let projector = story.pageFieldProjector;
      let dy = 0;
      if (!projector) {
        const retained = strippedStoryProjections.get(story);
        // Already-published story: keep it by identity while the context it was projected
        // under still holds; re-project through the retained projector when the pagination
        // moved under the reused sheet. No retained entry means the story never carried a
        // page field.
        if (!retained || sameFieldPageContext(retained.context, context)) return story;
        projector = retained.projector;
        dy = retained.dy;
      }
      changed = true;
      const projected = projector(context);
      // Strip the projector from the published record; retain it on the side so a reused
      // sheet can still re-finalize when the page count moves. The retained offset applies
      // here — the projector places at its minting pass's sheet Y.
      const { pageFieldProjector: _drop, box, ...rest } = projected;
      void _drop;
      const placed: HeaderFooterStoryRecord = {
        ...rest,
        box: dy === 0 ? box : { ...box, y: box.y + dy },
      };
      strippedStoryProjections.set(placed, { context, projector, dy });
      return placed;
    };
    const header = project(page.header);
    const footer = project(page.footer);
    // Fast-out: a page assembled with no body page field carries `hasBodyPageFields: false`, so
    // its whole fragment/table walk is skipped. An `undefined` flag (a page built by a path that
    // does not stamp it) still walks, which is safe — over-walking never drops a substitution.
    const fragments =
      page.hasBodyPageFields === false
        ? page.fragments
        : substituteBodyPageFields(page.fragments, context);
    // Reachable only for pages with NO live projector and NO body substitution: `project`
    // always mints a fresh record for a projector-bearing story (the rest-spread above), so
    // this identity entry can never publish — or memoize as final — a record that still
    // carries a `pageFieldProjector`. A story kept by identity because its RETAINED
    // projection context still holds is already published text under this exact context.
    if (header === page.header && footer === page.footer && fragments === page.fragments) {
      finalizedPageMemos.set(page, { pageCount, result: page });
      return page;
    }
    if (fragments !== page.fragments) changed = true;
    const result: PageRecord = {
      ...page,
      ...(header !== undefined ? { header } : {}),
      ...(footer !== undefined ? { footer } : {}),
      ...(fragments !== page.fragments ? { fragments } : {}),
    };
    finalizedPageMemos.set(page, { pageCount, result });
    return result;
  });

  return changed ? { revision: layout.revision, pages } : layout;
}
