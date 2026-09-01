// Record-only Markdown translation. No OOXML or package reads belong in this file.

import {
  forEachSemanticSpan,
  forEachSemanticStory,
  lineSegments,
  revisionsAreDeletion,
  type AnchoredDrawingRecord,
  type BlockFragmentRecord,
  type InlineDrawingRecord,
  type LineSegment,
  type PageRecord,
  type ParagraphFragmentRecord,
  type SemanticCommentArtifactRecord,
  type SemanticLayout,
  type SemanticReviewArtifactRecord,
  type SemanticTrackedChangeArtifactRecord,
  type StyleSpanRecord,
  type TableFragmentRecord,
} from '@docx-editor.dev/core/layout';
import type {
  ExportSemanticLayout,
  ExportSession,
  OpenDocumentForExportOptions,
} from '@docx-editor.dev/core/export';
import { escapeText, MarkdownInlineWriter, type MarkdownTextToken } from './markdown-inline.ts';

/** Markdown emitted for one physical layout page. @public */
export interface MarkdownPage {
  /** Snapshot-local layout page identity; it can change when the document repaginates. */
  readonly id: string;
  /** One-based physical page number. */
  readonly number: number;
  /** Body projection, plus local note definitions or labelled continuation blocks. */
  readonly markdown: string;
  /** Header story for this page, kept separate from logical document content. */
  readonly headerMarkdown: string;
  /** Footer story for this page, kept separate from logical document content. */
  readonly footerMarkdown: string;
  /** Comments anchored in any story physically rendered on this page. */
  readonly comments: readonly MarkdownComment[];
  /** Tracked changes anchored in any story physically rendered on this page. */
  readonly trackedChanges: readonly MarkdownTrackedChange[];
}

/** Page/story/source provenance for one exported review artifact. @public */
export type MarkdownReviewOccurrence = SemanticReviewArtifactRecord['occurrences'][number];

/** Normalized DOCX comment, independent of editor UI state. @public */
export type MarkdownComment = SemanticCommentArtifactRecord;

/** Normalized DOCX tracked change, independent of editor UI state. @public */
export type MarkdownTrackedChange = SemanticTrackedChangeArtifactRecord;

/** Comment or tracked change returned by Markdown export. @public */
export type MarkdownReviewArtifact = SemanticReviewArtifactRecord;

/** Machine-readable scope of the page numbers returned by this export. @public */
export interface MarkdownPaginationInfo {
  /** Pages come from the docx-editor semantic layout engine, not stale DOCX page-break hints. */
  readonly basis: 'docx-editor-layout';
  /** Page ids and numbers describe this export snapshot and can change after repagination. */
  readonly stability: 'snapshot';
  /** Desktop Word parity depends on equivalent fonts and renderer behavior. */
  readonly wordCompatibility: 'not-guaranteed';
  /** Core store revision from which this layout snapshot was produced. */
  readonly layoutRevision: number;
  /** Tracked-change projection used to paginate and translate this snapshot. */
  readonly displayMode: NonNullable<ExportSemanticLayout['displayMode']>;
}

/** Full logical document plus page-scoped projections. @public */
export interface MarkdownExportResult {
  /** Primary physical page projections, preserving Word layout boundaries and furniture. */
  readonly pages: readonly MarkdownPage[];
  /** Every normalized comment and tracked change, including artifacts with no page occurrence. */
  readonly reviewArtifacts: readonly MarkdownReviewArtifact[];
  /** Fidelity scope callers should retain alongside page citations. */
  readonly pagination: MarkdownPaginationInfo;
  /** Convenience logical Markdown with split records joined and repeated furniture excluded. */
  readonly markdown: string;
}

/** Caller decision for a laid-out image. @public */
export type MarkdownImageResult = { readonly url: string } | { readonly skip: true };

/** Translation-only controls over already-published layout records. @public */
export interface MarkdownTranslationOptions {
  /**
   * Map a laid-out drawing to a destination. Without a mapper (or when skipped), only its
   * escaped accessibility label is emitted. This callback is synchronous: perform uploads
   * first and return a precomputed URL. Validated bytes stay available from the session.
   */
  readonly image?: (drawing: InlineDrawingRecord | AnchoredDrawingRecord) => MarkdownImageResult;
}

/** One-shot options combine neutral layout provisioning with translation. @public */
export interface MarkdownExportOptions
  extends OpenDocumentForExportOptions, MarkdownTranslationOptions {}

interface TranslationContext {
  readonly options: MarkdownTranslationOptions;
  readonly noteLabelByScope: Map<string, string>;
  readonly tableCell: boolean;
  readonly hardBreakHtml?: boolean;
  readonly displayMode: SemanticLayout['displayMode'];
  readonly listIndentByParagraphId: ReadonlyMap<string, number>;
  readonly listMarkerByParagraphId: ReadonlyMap<
    string,
    NonNullable<ParagraphFragmentRecord['marker']>
  >;
  readonly tablesById: ReadonlyMap<string, TableProjection>;
  /** A translator maps each published drawing object at most once across full/page views. */
  readonly imageResultByDrawing: WeakMap<object, MarkdownImageResult>;
  /** Labels emitted into the current page body, when page-local note visibility is tracked. */
  readonly emittedNoteLabels?: Set<string>;
  readonly pageIndex?: number;
}

interface LogicalParagraph {
  readonly kind: 'paragraph';
  readonly fragments: ParagraphFragmentRecord[];
}

interface LogicalTable {
  readonly kind: 'table';
  readonly fragments: TableFragmentRecord[];
}

type LogicalBlock = LogicalParagraph | LogicalTable;

interface LogicalCell {
  readonly blocks: BlockFragmentRecord[];
  readonly gridSpan: number;
  readonly vMergeContinue: boolean;
  readonly gridColumn: number;
}

interface LogicalRow {
  readonly id: string;
  readonly isHeaderRepeat: boolean;
  readonly cells: LogicalCell[];
}

interface TableProjection {
  readonly fragments: TableFragmentRecord[];
  readonly columnCount: number;
}

interface NoteProjection {
  readonly kind: 'footnote' | 'endnote';
  readonly blocks: BlockFragmentRecord[];
}

const EMPTY_NOTE_STORIES: ReadonlyMap<string, NoteProjection> = new Map();

function assertNever(value: never): never {
  throw new TypeError(`Unsupported semantic record: ${JSON.stringify(value)}`);
}

function destination(url: string): string {
  return url.replace(
    /[\u0000-\u0020\u007f<>()\\]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  );
}

function escapeTablePipes(value: string): string {
  let escaped = '';
  let precedingBackslashes = 0;
  for (const character of value) {
    if (character === '\\') {
      escaped += character;
      precedingBackslashes += 1;
      continue;
    }
    if (character === '|' && precedingBackslashes % 2 === 0) escaped += '\\';
    escaped += character;
    precedingBackslashes = 0;
  }
  return escaped;
}

function mappedImageResult(value: unknown): MarkdownImageResult {
  if (typeof value === 'object' && value !== null) {
    if ('then' in value && typeof value.then === 'function') {
      // Observe a mistaken async mapper's settlement before rejecting the synchronous contract.
      // This prevents an already-rejected Promise from becoming a process-level unhandled rejection.
      void Promise.resolve(value as PromiseLike<unknown>).catch(() => undefined);
      throw new TypeError(
        'Markdown image mapper must return synchronously; upload media and precompute URLs before translation'
      );
    }
    if ('skip' in value && value.skip === true) return { skip: true };
    if ('url' in value && typeof value.url === 'string') return { url: value.url };
  }
  throw new TypeError('Markdown image mapper must return { url: string } or { skip: true }');
}

function drawingContentMarkdown(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  context: TranslationContext
): string {
  const label = escapeText(
    drawing.accessibility.label ?? '',
    context.tableCell || context.hardBreakHtml === true
  );
  const mapper = context.options.image;
  let mapped = context.imageResultByDrawing.get(drawing);
  if (mapper && !context.imageResultByDrawing.has(drawing)) {
    mapped = mappedImageResult(mapper(drawing));
    context.imageResultByDrawing.set(drawing, mapped);
  }
  let markdown = !mapped || 'skip' in mapped ? label : `![${label}](${destination(mapped.url)})`;
  if (markdown.length === 0) return markdown;
  if (drawing.hyperlinkHref) markdown = `[${markdown}](${destination(drawing.hyperlinkHref)})`;
  return markdown;
}

function drawingIsDeleted(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  context: TranslationContext
): boolean {
  return (
    context.displayMode === 'all-markup' &&
    drawing.revisions !== undefined &&
    revisionsAreDeletion(drawing.revisions)
  );
}

function drawingMarkdown(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  context: TranslationContext
): string {
  let markdown = drawingContentMarkdown(drawing, context);
  if (markdown.length === 0) return markdown;
  if (drawingIsDeleted(drawing, context)) {
    markdown = `~~${markdown}~~`;
  }
  return markdown;
}

function noteNavigationMarkdown(span: StyleSpanRecord, context: TranslationContext): string | null {
  if (!span.noteNav) return null;
  switch (span.noteNav.direction) {
    case 'to-note': {
      const label = context.noteLabelByScope.get(span.noteNav.scopeId);
      if (label) context.emittedNoteLabels?.add(label);
      return label ? `[^${label}]` : '';
    }
    case 'to-body':
      return '';
    default:
      return assertNever(span.noteNav.direction);
  }
}

function trimTokenWhitespace(tokens: readonly MarkdownTextToken[]): {
  readonly leading: string;
  readonly content: readonly MarkdownTextToken[];
  readonly trailing: string;
} {
  const content = tokens.map((token) => ({ ...token }));
  let leading = '';
  for (let index = 0; index < content.length; index += 1) {
    const token = content[index]!;
    if (token.sourceText.length === 0) continue;
    const match = /^\s+/.exec(token.sourceText);
    if (!match) break;
    leading += match[0];
    content[index] = { ...token, sourceText: token.sourceText.slice(match[0].length) };
    if (content[index]!.sourceText.length > 0) break;
  }
  let trailing = '';
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const token = content[index]!;
    if (token.sourceText.length === 0) continue;
    const match = /\s+$/.exec(token.sourceText);
    if (!match) break;
    trailing = match[0] + trailing;
    content[index] = { ...token, sourceText: token.sourceText.slice(0, -match[0].length) };
    if (content[index]!.sourceText.length > 0) break;
  }
  return { leading, content, trailing };
}

function linkedSpansMarkdown(
  tokens: readonly MarkdownTextToken[],
  href: string,
  context: TranslationContext
): string {
  const { leading, content, trailing } = trimTokenWhitespace(tokens);
  const writer = new MarkdownInlineWriter(context);
  for (const token of content) writer.writeText(token);
  const label = writer.finish();
  const breakAsHtml = context.tableCell || context.hardBreakHtml === true;
  if (label.length === 0 && leading.length + trailing.length > 0) {
    return `[${escapeText(leading + trailing, breakAsHtml)}](${destination(href)})`;
  }
  return (
    escapeText(leading, breakAsHtml) +
    (label.length > 0 ? `[${label}](${destination(href)})` : '') +
    escapeText(trailing, breakAsHtml)
  );
}

function sourceTextOf(span: StyleSpanRecord): string {
  return span.equation?.fallbackText ?? span.text;
}

function sameMarkdownLink(left: StyleSpanRecord['link'], right: StyleSpanRecord['link']): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.id === right.id &&
      left.kind === right.kind &&
      left.href === right.href &&
      left.anchor === right.anchor &&
      left.tooltip === right.tooltip)
  );
}

function writeSpanAtoms(
  atoms: readonly MarkdownAtom[],
  context: TranslationContext,
  writer: MarkdownInlineWriter
): void {
  for (let index = 0; index < atoms.length; index += 1) {
    const atom = atoms[index]!;
    if (atom.kind === 'drawing') {
      const drawing = drawingContentMarkdown(atom.drawing, context);
      writer.writeBoundary(
        drawing.length > 0 && drawingIsDeleted(atom.drawing, context)
          ? `<del>${drawing}</del>`
          : drawing
      );
      continue;
    }
    const navigation = noteNavigationMarkdown(atom.span, context);
    if (navigation !== null) {
      writer.writeBoundary(navigation);
      continue;
    }
    if (atom.span.link?.kind === 'external' && atom.span.link.href) {
      const linked: MarkdownTextToken[] = [
        { span: atom.span, sourceText: sourceTextOf(atom.span) },
      ];
      while (atoms[index + 1]?.kind === 'span') {
        const next = atoms[index + 1];
        if (
          next.kind !== 'span' ||
          next.span.noteNav ||
          !sameMarkdownLink(atom.span.link, next.span.link)
        ) {
          break;
        }
        linked.push({ span: next.span, sourceText: sourceTextOf(next.span) });
        index += 1;
      }
      writer.writeBoundary(linkedSpansMarkdown(linked, atom.span.link.href, context));
      continue;
    }
    writer.writeText({ span: atom.span, sourceText: sourceTextOf(atom.span) });
  }
}

type MarkdownAtom =
  | {
      readonly kind: 'span';
      readonly start: number;
      readonly order: number;
      readonly span: StyleSpanRecord;
    }
  | {
      readonly kind: 'drawing';
      readonly start: number;
      readonly order: number;
      readonly drawing: InlineDrawingRecord | AnchoredDrawingRecord;
    };

function markdownAtoms(segment: LineSegment): MarkdownAtom[] {
  const atoms: MarkdownAtom[] = [];
  for (const [index, span] of segment.spans.entries()) {
    atoms.push({ kind: 'span', start: span.range.start, order: index * 2 + 1, span });
  }
  for (const [index, drawing] of segment.drawings.entries()) {
    atoms.push({ kind: 'drawing', start: drawing.start, order: index * 2, drawing });
  }
  return atoms.sort((left, right) => left.start - right.start || left.order - right.order);
}

function paragraphBody(
  fragments: readonly ParagraphFragmentRecord[],
  context: TranslationContext
): string {
  const writer = new MarkdownInlineWriter(context);
  for (const fragment of fragments) {
    for (const line of fragment.lines) {
      for (const segment of lineSegments(line))
        writeSpanAtoms(markdownAtoms(segment), context, writer);
    }
  }
  return writer.finish();
}

function paragraphMarkdown(
  fragments: readonly ParagraphFragmentRecord[],
  context: TranslationContext,
  logical = true
): string {
  const first = fragments[0];
  if (!first) return '';
  const headingLevel = first.outlineLevel === null ? null : first.outlineLevel + 1;
  const heading =
    !context.tableCell && headingLevel !== null && headingLevel >= 1 && headingLevel <= 9
      ? `${'#'.repeat(Math.min(headingLevel, 6))} `
      : '';
  // Leading preserved whitespace is visual OOXML spacing, not a Markdown code-block request.
  // Entities retain every authored space without creating a four-space code-block prefix. List
  // indentation is added structurally below, after this conversion.
  const body = paragraphBody(
    fragments,
    heading.length > 0 ? { ...context, hardBreakHtml: true } : context
  ).replace(/^[ \t]+/, (whitespace) => '&nbsp;'.repeat(whitespace.length));
  const marker = first.marker ?? context.listMarkerByParagraphId.get(first.paragraphId);
  const indent = ' '.repeat(
    context.listIndentByParagraphId.get(first.paragraphId) ?? (marker?.level ?? 0) * 4
  );
  if (!logical && first.fragmentIndex > 0) {
    if (!marker) return body;
    const bullet = marker.numFmt === 'bullet' ? '-' : `${marker.ordinal ?? 1}.`;
    return `${indent}${' '.repeat(bullet.length + 1)}${body}`;
  }
  if (marker) {
    const bullet = marker.numFmt === 'bullet' ? '-' : `${marker.ordinal ?? 1}.`;
    // CommonMark permits a heading as list-item content. Preserve both authored semantics so a
    // numbered Word heading remains navigable without losing its visible ordinal.
    return `${indent}${bullet} ${heading}${body}`;
  }
  return heading + body;
}

function logicalBlocks(blocks: readonly BlockFragmentRecord[]): LogicalBlock[] {
  const result: LogicalBlock[] = [];
  for (const block of blocks) {
    const previous = result[result.length - 1];
    switch (block.kind) {
      case 'paragraph':
        if (
          previous?.kind === 'paragraph' &&
          previous.fragments[0]?.paragraphId === block.paragraphId
        ) {
          previous.fragments.push(block);
        } else {
          result.push({ kind: 'paragraph', fragments: [block] });
        }
        break;
      case 'table':
        if (previous?.kind === 'table' && previous.fragments[0]?.tableId === block.tableId) {
          previous.fragments.push(block);
        } else {
          result.push({ kind: 'table', fragments: [block] });
        }
        break;
      default:
        assertNever(block);
    }
  }
  return result;
}

function mergeRows(
  fragments: readonly TableFragmentRecord[],
  includeHeaderRepeats: boolean
): LogicalRow[] {
  const rows: LogicalRow[] = [];
  const byId = new Map<string, LogicalRow>();
  for (const fragment of fragments) {
    for (const row of fragment.rows) {
      if (row.isHeaderRepeat && !includeHeaderRepeats) continue;
      let logical = byId.get(row.id);
      // A tall table can restart its repeating header inside another fragment on the same physical
      // page. That is a visual occurrence of the row already collected, not additional cell
      // content. Row continuations remain mergeable because they are not header repeats.
      if (logical && includeHeaderRepeats && row.isHeaderRepeat) continue;
      if (!logical) {
        logical = {
          id: row.id,
          isHeaderRepeat: row.isHeaderRepeat,
          cells: [],
        };
        byId.set(row.id, logical);
        rows.push(logical);
      }
      for (const [index, cell] of row.cells.entries()) {
        const gridColumn = cell.gridColumn ?? index;
        const existing = logical.cells.find((candidate) => candidate.gridColumn === gridColumn);
        if (existing) existing.blocks.push(...cell.blocks);
        else {
          logical.cells.push({
            blocks: [...cell.blocks],
            gridSpan: cell.gridSpan,
            vMergeContinue: cell.vMergeContinue,
            gridColumn,
          });
        }
      }
      logical.cells.sort((left, right) => left.gridColumn - right.gridColumn);
    }
  }
  return rows;
}

function cellAlignment(cell: LogicalCell): ParagraphFragmentRecord['alignment'] {
  for (const block of cell.blocks) {
    if (block.kind === 'paragraph') return block.alignment;
  }
  return 'left';
}

function cellValues(row: LogicalRow, context: TranslationContext, pageScoped: boolean): string[] {
  const values: string[] = [];
  const nestedContext = { ...context, tableCell: true };
  for (const cell of row.cells) {
    const value = cell.vMergeContinue
      ? ''
      : escapeTablePipes(
          renderLogicalBlocks(logicalBlocks(cell.blocks), nestedContext, true, pageScoped)
        ).replace(/\n+/g, '<br>');
    while (values.length < cell.gridColumn) values.push('');
    values[cell.gridColumn] = value;
    for (let span = 1; span < cell.gridSpan; span += 1) {
      values[cell.gridColumn + span] = '';
    }
  }
  return values;
}

function tableMarkdown(
  fragments: readonly TableFragmentRecord[],
  context: TranslationContext,
  pageScoped: boolean
): string {
  const tableId = fragments[0]?.tableId;
  const projection = tableId ? context.tablesById.get(tableId) : undefined;
  const completeFragments = projection?.fragments ?? fragments;
  const rows = pageScoped ? mergeRows(fragments, true) : mergeRows(completeFragments, false);
  if (rows.length === 0) return '';
  const width = Math.max(
    projection?.columnCount ??
      (fragments[0]?.columnEdges.length ? fragments[0].columnEdges.length - 1 : 0),
    1
  );
  const normalize = (values: string[], fallback = ''): string[] =>
    Array.from({ length: width }, (_, index) => values[index] ?? fallback);
  const line = (row: LogicalRow): string =>
    `| ${normalize(cellValues(row, context, pageScoped)).join(' | ')} |`;
  // GFM requires the first emitted row to be its header row. Preserve authored order: OOXML's
  // tblHeader flag is only an effective repeated header on the contiguous table prefix, and a
  // malformed/later flag must never pull that row ahead of preceding data.
  const header = rows[0]!;
  const alignments: string[] = [];
  for (const cell of header.cells) {
    const token = cellAlignment(cell);
    const rule = token === 'center' ? ':---:' : token === 'right' ? '---:' : '---';
    while (alignments.length < cell.gridColumn) alignments.push('---');
    alignments[cell.gridColumn] = rule;
    for (let span = 1; span < cell.gridSpan; span += 1) {
      alignments[cell.gridColumn + span] = '---';
    }
  }
  return [
    line(header),
    `| ${normalize(alignments, '---').join(' | ')} |`,
    ...rows.slice(1).map(line),
  ].join('\n');
}

function renderLogicalBlocks(
  blocks: readonly LogicalBlock[],
  context: TranslationContext,
  nested = false,
  pageScoped = false
): string {
  const rendered = blocks.map((block) => {
    switch (block.kind) {
      case 'paragraph':
        return paragraphMarkdown(block.fragments, context, !pageScoped);
      case 'table':
        return tableMarkdown(block.fragments, context, pageScoped);
      default:
        return assertNever(block);
    }
  });
  return rendered
    .filter((value, index) => value.length > 0 || index < rendered.length - 1)
    .join(nested ? '\n' : '\n\n');
}

function bodyBlocks(layout: SemanticLayout): LogicalBlock[] {
  return logicalBlocks(layout.pages.flatMap((page) => page.fragments));
}

function markerWidth(marker: NonNullable<ParagraphFragmentRecord['marker']>): number {
  return (marker.numFmt === 'bullet' ? '-' : `${marker.ordinal ?? 1}.`).length + 1;
}

function indexLists(
  blocks: readonly LogicalBlock[],
  indentation: Map<string, number>,
  markers: Map<string, NonNullable<ParagraphFragmentRecord['marker']>>
): void {
  const ancestorWidths = new Map<number, number>();
  let activeNumId: string | null = null;
  for (const block of blocks) {
    if (block.kind === 'table') {
      ancestorWidths.clear();
      activeNumId = null;
      for (const row of mergeRows(block.fragments, false)) {
        for (const cell of row.cells) {
          indexLists(logicalBlocks(cell.blocks), indentation, markers);
        }
      }
      continue;
    }
    const first = block.fragments[0];
    if (!first) continue;
    const marker = block.fragments.find((fragment) => fragment.marker)?.marker;
    if (!marker) {
      ancestorWidths.clear();
      activeNumId = null;
      continue;
    }
    if (activeNumId !== marker.numId) ancestorWidths.clear();
    activeNumId = marker.numId;
    let columns = 0;
    for (let level = 0; level < marker.level; level += 1) {
      columns += ancestorWidths.get(level) ?? 0;
    }
    indentation.set(first.paragraphId, columns);
    markers.set(first.paragraphId, marker);
    ancestorWidths.set(marker.level, markerWidth(marker));
    for (const level of ancestorWidths.keys()) {
      if (level > marker.level) ancestorWidths.delete(level);
    }
  }
}

function indexTableBlocks(
  blocks: readonly BlockFragmentRecord[],
  tables: Map<string, TableProjection>
): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph') continue;
    let projection = tables.get(block.tableId);
    if (!projection) {
      projection = {
        fragments: [],
        columnCount: Math.max(1, block.columnEdges.length - 1),
      };
      tables.set(block.tableId, projection);
    }
    projection.fragments.push(block);
    for (const row of block.rows) {
      if (row.isHeaderRepeat) continue;
      for (const cell of row.cells) indexTableBlocks(cell.blocks, tables);
    }
  }
}

function buildTranslationIndexes(
  layout: SemanticLayout
): Pick<TranslationContext, 'listIndentByParagraphId' | 'listMarkerByParagraphId' | 'tablesById'> {
  const listIndentByParagraphId = new Map<string, number>();
  const listMarkerByParagraphId = new Map<string, NonNullable<ParagraphFragmentRecord['marker']>>();
  const tablesById = new Map<string, TableProjection>();
  indexLists(bodyBlocks(layout), listIndentByParagraphId, listMarkerByParagraphId);
  forEachSemanticStory(layout, ({ story, host }) => {
    // Headers and footers are page occurrences, not one logical document stream. Their table ids
    // intentionally repeat across pages, so `storyMarkdown` indexes each occurrence. Note tables
    // do span pages and retain one document-wide projection; note list scopes are indexed later
    // from the exact logical or page-local blocks each definition emits.
    if (story === 'header' || story === 'footer' || story === 'note-separator') return;
    indexTableBlocks(host.fragments, tablesById);
  });
  return { listIndentByParagraphId, listMarkerByParagraphId, tablesById };
}

function documentAnchoredDrawings(layout: SemanticLayout, context: TranslationContext): string {
  return (
    layout.pages
      .flatMap((page) => page.anchoredDrawings ?? [])
      // Textbox stories are not linear body content. Their deliberate omission is documented;
      // non-textbox drawings retain deterministic page/record order here.
      .filter((drawing) => drawing.textboxStory === undefined)
      .map((drawing) => drawingMarkdown(drawing, context))
      .filter(Boolean)
      .join('\n\n')
  );
}

function pageBody(
  page: PageRecord,
  context: TranslationContext
): { readonly markdown: string; readonly noteLabels: ReadonlySet<string> } {
  const blocks = logicalBlocks(page.fragments);
  const listIndentByParagraphId = new Map<string, number>();
  const listMarkerByParagraphId = new Map<string, NonNullable<ParagraphFragmentRecord['marker']>>();
  const noteLabels = new Set<string>();
  indexLists(blocks, listIndentByParagraphId, listMarkerByParagraphId);
  const pageContext = {
    ...context,
    pageIndex: page.index,
    listIndentByParagraphId,
    listMarkerByParagraphId,
    emittedNoteLabels: noteLabels,
  };
  const markdown = renderLogicalBlocks(blocks, pageContext, false, true);
  const anchored = (page.anchoredDrawings ?? [])
    .filter((drawing) => drawing.textboxStory === undefined)
    .map((drawing) => drawingMarkdown(drawing, pageContext))
    .filter(Boolean);
  return {
    markdown: [markdown, ...anchored].filter(Boolean).join('\n\n'),
    noteLabels,
  };
}

function storyMarkdown(
  story: {
    readonly fragments: readonly BlockFragmentRecord[];
    readonly anchoredDrawings?: readonly AnchoredDrawingRecord[];
  },
  context: TranslationContext
): string {
  const listIndentByParagraphId = new Map<string, number>();
  const listMarkerByParagraphId = new Map<string, NonNullable<ParagraphFragmentRecord['marker']>>();
  const tablesById = new Map<string, TableProjection>();
  indexLists(logicalBlocks(story.fragments), listIndentByParagraphId, listMarkerByParagraphId);
  indexTableBlocks(story.fragments, tablesById);
  const storyContext: TranslationContext = {
    ...context,
    listIndentByParagraphId,
    listMarkerByParagraphId,
    tablesById,
  };
  const body = renderLogicalBlocks(logicalBlocks(story.fragments), storyContext);
  const drawings = (story.anchoredDrawings ?? [])
    .filter((drawing) => drawing.textboxStory === undefined)
    .map((drawing) => drawingMarkdown(drawing, storyContext));
  return [body, ...drawings].filter(Boolean).join('\n\n');
}

interface NoteStoryIndexes {
  readonly document: ReadonlyMap<string, NoteProjection>;
  readonly byPage: ReadonlyMap<PageRecord, ReadonlyMap<string, NoteProjection>>;
}

function noteStoryIndexes(layout: SemanticLayout): NoteStoryIndexes {
  const document = new Map<string, NoteProjection>();
  const byPage = new Map<PageRecord, Map<string, NoteProjection>>();
  const append = (
    target: Map<string, NoteProjection>,
    scopeId: string,
    story: 'footnote' | 'endnote',
    blocks: readonly BlockFragmentRecord[]
  ): void => {
    const entry = target.get(scopeId) ?? { kind: story, blocks: [] };
    entry.blocks.push(...blocks);
    target.set(scopeId, entry);
  };
  forEachSemanticStory(layout, ({ page, story, host, noteScopeId }) => {
    if (noteScopeId === null || (story !== 'footnote' && story !== 'endnote')) return;
    append(document, noteScopeId, story, host.fragments);
    let pageNotes = byPage.get(page);
    if (!pageNotes) {
      pageNotes = new Map();
      byPage.set(page, pageNotes);
    }
    append(pageNotes, noteScopeId, story, host.fragments);
  });
  return { document, byPage };
}

function visibleNoteContinuation(note: NoteProjection, label: string, body: string): string {
  const title = note.kind === 'footnote' ? 'Footnote' : 'Endnote';
  const heading = `> **${title} ${label} (continued):**`;
  if (body.length === 0) return heading;
  const quoted = body
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n');
  return `${heading}\n>\n${quoted}`;
}

function noteDefinitions(
  stories: ReadonlyMap<string, NoteProjection>,
  context: TranslationContext,
  pageScoped = false,
  localReferenceLabels: ReadonlySet<string> = new Set(),
  previouslyRenderedScopes: Set<string> = new Set()
): string {
  const definitions: string[] = [];
  for (const [scopeId, note] of stories) {
    const label = context.noteLabelByScope.get(scopeId);
    if (!label) continue;
    const logical = logicalBlocks(note.blocks);
    const listIndentByParagraphId = new Map<string, number>();
    const listMarkerByParagraphId = new Map<
      string,
      NonNullable<ParagraphFragmentRecord['marker']>
    >();
    // A full note definition joins every physical occurrence of one scope, so its list ancestry
    // must cross page boundaries. A page definition receives only that page's blocks and therefore
    // rebases an orphan child or continuation when its ancestor is not part of the projection.
    indexLists(logical, listIndentByParagraphId, listMarkerByParagraphId);
    const noteContext = {
      ...context,
      listIndentByParagraphId,
      listMarkerByParagraphId,
    };
    const body = renderLogicalBlocks(logical, noteContext, false, pageScoped);
    const isContinuation =
      pageScoped && previouslyRenderedScopes.has(scopeId) && !localReferenceLabels.has(label);
    if (pageScoped) previouslyRenderedScopes.add(scopeId);
    if (isContinuation) {
      definitions.push(visibleNoteContinuation(note, label, body));
      continue;
    }
    const indented = body.replace(/\n/g, '\n    ');
    definitions.push(`[^${label}]: ${indented}`);
  }
  return definitions.join('\n\n');
}

function withDefinitions(markdown: string, definitions: string): string {
  return [markdown, definitions].filter(Boolean).join('\n\n');
}

function noteLabels(layout: SemanticLayout): Map<string, string> {
  const labels = new Map<string, string>();
  forEachSemanticSpan(layout, ({ span, story }) => {
    // Textbox stories have no linear Markdown position and are deliberately omitted, so their
    // citations cannot consume labels or shift references in represented stories.
    if (story === 'textbox') return;
    if (span.noteNav?.direction !== 'to-note' || labels.has(span.noteNav.scopeId)) return;
    labels.set(span.noteNav.scopeId, String(labels.size + 1));
  });
  return labels;
}

interface PageReviewArtifacts {
  readonly comments: SemanticCommentArtifactRecord[];
  readonly trackedChanges: SemanticTrackedChangeArtifactRecord[];
  readonly keys: Set<string>;
}

function pageReviewArtifacts(
  artifacts: readonly SemanticReviewArtifactRecord[]
): ReadonlyMap<number, PageReviewArtifacts> {
  const byPage = new Map<number, PageReviewArtifacts>();
  for (const artifact of artifacts) {
    for (const occurrence of artifact.occurrences) {
      const page = byPage.get(occurrence.pageIndex) ?? {
        comments: [],
        trackedChanges: [],
        keys: new Set<string>(),
      };
      byPage.set(occurrence.pageIndex, page);
      const key = `${artifact.kind}\0${artifact.id}`;
      if (page.keys.has(key)) continue;
      page.keys.add(key);
      if (artifact.kind === 'comment') {
        page.comments.push(artifact);
      } else {
        page.trackedChanges.push(artifact);
      }
    }
  }
  return byPage;
}

/** Translate one shared semantic layout session to Markdown. @public */
export async function exportMarkdownFrom(
  session: ExportSession,
  options: MarkdownTranslationOptions = {}
): Promise<MarkdownExportResult> {
  const layout = await session.layout();
  const indexes = buildTranslationIndexes(layout);
  const notes = noteStoryIndexes(layout);
  const context: TranslationContext = {
    options,
    noteLabelByScope: noteLabels(layout),
    tableCell: false,
    displayMode: layout.displayMode,
    imageResultByDrawing: new WeakMap(),
    ...indexes,
  };
  const markdown = withDefinitions(
    [renderLogicalBlocks(bodyBlocks(layout), context), documentAnchoredDrawings(layout, context)]
      .filter(Boolean)
      .join('\n\n'),
    noteDefinitions(notes.document, context)
  );
  const reviewArtifacts = layout.reviewArtifacts;
  const artifactsByPage = pageReviewArtifacts(reviewArtifacts);
  const renderedNoteScopes = new Set<string>();
  const pages = layout.pages.map((page): MarkdownPage => {
    const pageContext = { ...context, pageIndex: page.index };
    const body = pageBody(page, context);
    const definitions = noteDefinitions(
      notes.byPage.get(page) ?? EMPTY_NOTE_STORIES,
      pageContext,
      true,
      body.noteLabels,
      renderedNoteScopes
    );
    const pageArtifacts = artifactsByPage.get(page.index);
    return Object.freeze({
      id: page.id,
      number: page.index + 1,
      markdown: withDefinitions(body.markdown, definitions),
      headerMarkdown: page.header ? storyMarkdown(page.header, pageContext) : '',
      footerMarkdown: page.footer ? storyMarkdown(page.footer, pageContext) : '',
      comments: Object.freeze(pageArtifacts?.comments ?? []),
      trackedChanges: Object.freeze(pageArtifacts?.trackedChanges ?? []),
    });
  });
  return Object.freeze({
    pages: Object.freeze(pages),
    reviewArtifacts,
    pagination: Object.freeze({
      basis: 'docx-editor-layout',
      stability: 'snapshot',
      wordCompatibility: 'not-guaranteed',
      layoutRevision: layout.revision,
      displayMode: layout.displayMode ?? 'all-markup',
    }),
    markdown,
  });
}
