// Record-only Markdown translation. No OOXML or package reads belong in this file.

import { forEachSemanticSpan } from '../layout/export-traversal.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  StyleSpanRecord,
  TableFragmentRecord,
} from '../layout/semantic-records.ts';
import type {
  ExportDocumentSource,
  ExportSession,
  OpenDocumentForExportOptions,
} from './export-session.ts';
import { openDocumentForExport } from './export-session.ts';

/** Markdown emitted for one physical layout page. @public */
export interface MarkdownPage {
  /** One-based physical page number. */
  readonly number: number;
  /** Body projection owned by this page, plus page-local note definitions. */
  readonly markdown: string;
  /** Header story for this page, kept separate from logical document content. */
  readonly headerMarkdown: string;
  /** Footer story for this page, kept separate from logical document content. */
  readonly footerMarkdown: string;
}

/** Full logical document plus page-scoped projections. @public */
export interface MarkdownExportResult {
  /** Logical document Markdown with split records joined and repeats deduplicated. */
  readonly markdown: string;
  /** Physical page projections for workflows that preserve page boundaries. */
  readonly pages: readonly MarkdownPage[];
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
  readonly displayMode: SemanticLayout['displayMode'];
  readonly listIndentByParagraphId: ReadonlyMap<string, number>;
  readonly listMarkerByParagraphId: ReadonlyMap<
    string,
    NonNullable<ParagraphFragmentRecord['marker']>
  >;
  readonly tablesById: ReadonlyMap<string, TableProjection>;
  readonly rowStartPage: ReadonlyMap<string, number>;
  /** A translator maps each published drawing object at most once across full/page views. */
  readonly imageResultByDrawing: WeakMap<object, MarkdownImageResult>;
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
  readonly isHeaderRow: boolean;
  readonly isHeaderRepeat: boolean;
  readonly cells: LogicalCell[];
}

interface TableProjection {
  readonly fragments: TableFragmentRecord[];
  readonly columnCount: number;
}

const MARKDOWN_PUNCTUATION = /([\\`*{}\[\]()#+\-.!_|~])/g;

/** Escape every file-derived character that can open Markdown or raw HTML. */
function escapeText(value: string, tableCell = false): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\t/g, ' ')
    .replace(MARKDOWN_PUNCTUATION, '\\$1')
    .replace(/\r\n?|\n|\f/g, tableCell ? '<br>' : '  \n');
}

function destination(url: string): string {
  return encodeURI(url)
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
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

function drawingMarkdown(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  context: TranslationContext
): string {
  const label = escapeText(drawing.accessibility.label ?? '', context.tableCell);
  const mapper = context.options.image;
  let mapped = context.imageResultByDrawing.get(drawing);
  if (mapper && !context.imageResultByDrawing.has(drawing)) {
    mapped = mappedImageResult(mapper(drawing));
    context.imageResultByDrawing.set(drawing, mapped);
  }
  if (!mapped || 'skip' in mapped) return label;
  return `![${label}](${destination(mapped.url)})`;
}

function spanMarkdown(span: StyleSpanRecord, context: TranslationContext): string {
  if (span.noteNav?.direction === 'to-note') {
    const label = context.noteLabelByScope.get(span.noteNav.scopeId);
    return label ? `[^${label}]` : '';
  }
  if (span.noteNav?.direction === 'to-body') return '';
  const boundary = /^(\s*)([\s\S]*?)(\s*)$/.exec(span.text);
  const leading = escapeText(boundary?.[1] ?? '', context.tableCell);
  const trailing = escapeText(boundary?.[3] ?? '', context.tableCell);
  let text = escapeText(boundary?.[2] ?? span.text, context.tableCell);
  if (text.length === 0) return leading + trailing;
  const deleted =
    context.displayMode === 'all-markup' &&
    span.revisions?.some((revision) => revision.kind === 'delete' || revision.kind === 'moveFrom');
  if (span.style.bold) text = `**${text}**`;
  if (span.style.italic) text = `_${text}_`;
  if (span.style.strike || span.style.doubleStrike || deleted) text = `~~${text}~~`;
  if (span.link?.kind === 'external' && span.link.href) {
    text = `[${text}](${destination(span.link.href)})`;
  }
  return leading + text + trailing;
}

function lineMarkdown(line: LineRecord, context: TranslationContext): string {
  const atoms: Array<{
    readonly start: number;
    readonly order: number;
    readonly render: () => string;
  }> = [];
  for (const [index, span] of line.spans.entries()) {
    atoms.push({
      start: span.range.start,
      order: index * 2 + 1,
      render: () => spanMarkdown(span, context),
    });
  }
  for (const [index, drawing] of (line.drawings ?? []).entries()) {
    atoms.push({
      start: drawing.start,
      order: index * 2,
      render: () => drawingMarkdown(drawing, context),
    });
  }
  atoms.sort((left, right) => left.start - right.start || left.order - right.order);
  return atoms.map((atom) => atom.render()).join('');
}

function paragraphBody(
  fragments: readonly ParagraphFragmentRecord[],
  context: TranslationContext
): string {
  return fragments
    .flatMap((fragment) => fragment.lines.map((line) => lineMarkdown(line, context)))
    .join('');
}

function paragraphMarkdown(
  fragments: readonly ParagraphFragmentRecord[],
  context: TranslationContext,
  logical = true
): string {
  const first = fragments[0];
  if (!first) return '';
  const body = paragraphBody(fragments, context);
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
    return `${indent}${bullet} ${body}`;
  }
  const headingLevel = first.outlineLevel === null ? null : first.outlineLevel + 1;
  if (headingLevel !== null && headingLevel >= 1 && headingLevel <= 9) {
    return `${'#'.repeat(Math.min(headingLevel, 6))} ${body}`;
  }
  return body;
}

function logicalBlocks(blocks: readonly BlockFragmentRecord[]): LogicalBlock[] {
  const result: LogicalBlock[] = [];
  for (const block of blocks) {
    const previous = result[result.length - 1];
    if (block.kind === 'paragraph') {
      if (
        previous?.kind === 'paragraph' &&
        previous.fragments[0]?.paragraphId === block.paragraphId
      ) {
        previous.fragments.push(block);
      } else {
        result.push({ kind: 'paragraph', fragments: [block] });
      }
    } else if (previous?.kind === 'table' && previous.fragments[0]?.tableId === block.tableId) {
      previous.fragments.push(block);
    } else {
      result.push({ kind: 'table', fragments: [block] });
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
      if (!logical) {
        logical = {
          id: row.id,
          isHeaderRow: row.isHeaderRow,
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

function cellValues(row: LogicalRow, context: TranslationContext): string[] {
  const values: string[] = [];
  const nestedContext = { ...context, tableCell: true };
  for (const cell of row.cells) {
    const value = cell.vMergeContinue
      ? ''
      : renderLogicalBlocks(logicalBlocks(cell.blocks), nestedContext, true)
          .replace(/(^|[^\\])\|/g, '$1\\|')
          .replace(/\n+/g, '<br>');
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
  const repeatedHeaderLocal =
    pageScoped &&
    projection !== undefined &&
    !fragments.some((fragment) => projection.fragments.includes(fragment));
  const completeFragments = repeatedHeaderLocal ? fragments : (projection?.fragments ?? fragments);
  let rows = mergeRows(completeFragments, false);
  if (pageScoped && !repeatedHeaderLocal && context.pageIndex !== undefined && tableId) {
    const repeats = mergeRows(fragments, true).filter((row) => row.isHeaderRepeat);
    const owned = rows.filter(
      (row) => context.rowStartPage.get(`${tableId}\0${row.id}`) === context.pageIndex
    );
    const repeatedIds = new Set(repeats.map((row) => row.id));
    rows = [...repeats, ...owned.filter((row) => !repeatedIds.has(row.id))];
  }
  if (rows.length === 0) return '';
  const width = Math.max(
    projection?.columnCount ??
      (fragments[0]?.columnEdges.length ? fragments[0].columnEdges.length - 1 : 0),
    1
  );
  const normalize = (values: string[]): string[] =>
    Array.from({ length: width }, (_, index) => values[index] ?? '');
  const line = (row: LogicalRow): string =>
    `| ${normalize(cellValues(row, context)).join(' | ')} |`;
  const headerIndex = Math.max(
    rows.findIndex((row) => row.isHeaderRow),
    0
  );
  const header = rows[headerIndex]!;
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
  const ordered = [header, ...rows.filter((_, index) => index !== headerIndex)];
  return [
    line(ordered[0]!),
    `| ${normalize(alignments).join(' | ')} |`,
    ...ordered.slice(1).map(line),
  ].join('\n');
}

function renderLogicalBlocks(
  blocks: readonly LogicalBlock[],
  context: TranslationContext,
  nested = false,
  pageScoped = false
): string {
  const rendered = blocks.map((block) =>
    block.kind === 'paragraph'
      ? paragraphMarkdown(block.fragments, context, !pageScoped)
      : tableMarkdown(block.fragments, context, pageScoped)
  );
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
      columns += ancestorWidths.get(level) ?? 4;
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
  pageIndex: number,
  tables: Map<string, TableProjection>,
  rowStartPage: Map<string, number>
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
      const key = `${block.tableId}\0${row.id}`;
      if (!rowStartPage.has(key)) rowStartPage.set(key, pageIndex);
      for (const cell of row.cells) indexTableBlocks(cell.blocks, pageIndex, tables, rowStartPage);
    }
  }
}

function buildTranslationIndexes(
  layout: SemanticLayout
): Pick<
  TranslationContext,
  'listIndentByParagraphId' | 'listMarkerByParagraphId' | 'tablesById' | 'rowStartPage'
> {
  const listIndentByParagraphId = new Map<string, number>();
  const listMarkerByParagraphId = new Map<string, NonNullable<ParagraphFragmentRecord['marker']>>();
  const tablesById = new Map<string, TableProjection>();
  const rowStartPage = new Map<string, number>();
  indexLists(bodyBlocks(layout), listIndentByParagraphId, listMarkerByParagraphId);
  for (const page of layout.pages) {
    indexTableBlocks(page.fragments, page.index, tablesById, rowStartPage);
    for (const story of [page.header, page.footer]) {
      if (story)
        indexLists(
          logicalBlocks(story.fragments),
          listIndentByParagraphId,
          listMarkerByParagraphId
        );
    }
    for (const area of [page.footnotes, page.endnotes]) {
      for (const note of area?.notes ?? []) {
        indexLists(logicalBlocks(note.fragments), listIndentByParagraphId, listMarkerByParagraphId);
        indexTableBlocks(note.fragments, page.index, tablesById, rowStartPage);
      }
      if (area?.separator) {
        indexLists(
          logicalBlocks(area.separator.fragments),
          listIndentByParagraphId,
          listMarkerByParagraphId
        );
        indexTableBlocks(area.separator.fragments, page.index, tablesById, rowStartPage);
      }
    }
  }
  return { listIndentByParagraphId, listMarkerByParagraphId, tablesById, rowStartPage };
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

function pageBody(page: PageRecord, context: TranslationContext): string {
  const pageContext = { ...context, pageIndex: page.index };
  const markdown = renderLogicalBlocks(logicalBlocks(page.fragments), pageContext, false, true);
  const anchored = (page.anchoredDrawings ?? [])
    .filter((drawing) => drawing.textboxStory === undefined)
    .map((drawing) => drawingMarkdown(drawing, pageContext))
    .filter(Boolean);
  return [markdown, ...anchored].filter(Boolean).join('\n\n');
}

function storyMarkdown(
  story: {
    readonly fragments: readonly BlockFragmentRecord[];
    readonly anchoredDrawings?: readonly AnchoredDrawingRecord[];
  },
  context: TranslationContext
): string {
  const body = renderLogicalBlocks(logicalBlocks(story.fragments), context);
  const drawings = (story.anchoredDrawings ?? [])
    .filter((drawing) => drawing.textboxStory === undefined)
    .map((drawing) => drawingMarkdown(drawing, context));
  return [body, ...drawings].filter(Boolean).join('\n\n');
}

function noteStories(
  layout: SemanticLayout,
  page?: PageRecord
): Map<string, BlockFragmentRecord[]> {
  const result = new Map<string, BlockFragmentRecord[]>();
  for (const current of page ? [page] : layout.pages) {
    for (const area of [current.footnotes, current.endnotes]) {
      for (const note of area?.notes ?? []) {
        const entry = result.get(note.scopeId) ?? [];
        entry.push(...note.fragments);
        result.set(note.scopeId, entry);
      }
    }
  }
  return result;
}

function noteDefinitions(
  stories: ReadonlyMap<string, BlockFragmentRecord[]>,
  context: TranslationContext,
  pageScoped = false
): string {
  const definitions: string[] = [];
  for (const [scopeId, blocks] of stories) {
    const label = context.noteLabelByScope.get(scopeId);
    if (!label) continue;
    const body = renderLogicalBlocks(logicalBlocks(blocks), context, true, pageScoped);
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
  forEachSemanticSpan(layout, ({ span }) => {
    if (span.noteNav?.direction !== 'to-note' || labels.has(span.noteNav.scopeId)) return;
    labels.set(span.noteNav.scopeId, String(labels.size + 1));
  });
  for (const scopeId of noteStories(layout).keys()) {
    if (!labels.has(scopeId)) labels.set(scopeId, String(labels.size + 1));
  }
  return labels;
}

/** Translate one shared semantic layout session to Markdown. @public */
export async function exportMarkdownFrom(
  session: ExportSession,
  options: MarkdownTranslationOptions = {}
): Promise<MarkdownExportResult> {
  const layout = await session.layout();
  const indexes = buildTranslationIndexes(layout);
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
    noteDefinitions(noteStories(layout), context)
  );
  const pages = layout.pages.map((page): MarkdownPage => {
    const pageContext = { ...context, pageIndex: page.index };
    const definitions = noteDefinitions(noteStories(layout, page), pageContext, true);
    return Object.freeze({
      number: page.index + 1,
      markdown: withDefinitions(pageBody(page, context), definitions),
      headerMarkdown: page.header ? storyMarkdown(page.header, pageContext) : '',
      footerMarkdown: page.footer ? storyMarkdown(page.footer, pageContext) : '',
    });
  });
  return Object.freeze({ markdown, pages: Object.freeze(pages) });
}

/** Open, translate, and dispose a document through the same session path. @public */
export async function exportMarkdown(
  source: ExportDocumentSource,
  options: MarkdownExportOptions = {}
): Promise<MarkdownExportResult> {
  const opened = openDocumentForExport(source, options);
  if (!opened.ok) {
    throw new Error(
      `Unable to open DOCX for export: ${opened.reason}${opened.detail ? ` (${opened.detail})` : ''}`
    );
  }
  try {
    return await exportMarkdownFrom(opened.session, options.image ? { image: options.image } : {});
  } finally {
    opened.session.dispose();
  }
}
