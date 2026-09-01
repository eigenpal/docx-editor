// Record-only Markdown translation. No OOXML or package reads belong in this file.

import {
  forEachSemanticStory,
  lineSegments,
  revisionsAreDeletion,
  type AnchoredDrawingRecord,
  type BlockFragmentRecord,
  type InlineDrawingRecord,
  type LineSegment,
  type PageRecord,
  type ParagraphFragmentRecord,
  type SemanticLayout,
  type StyleSpanRecord,
  type TableFragmentRecord,
} from '@docx-editor.dev/core/layout';
import type { ExportSemanticLayout, ExportSession } from '@docx-editor.dev/core/export';
import {
  escapeText,
  markdownSourceCaptureKey,
  MarkdownInlineWriter,
  type MarkdownSourceCapture,
  type MarkdownTextToken,
} from './markdown-inline.ts';
import {
  concatMarkdown,
  EMPTY_MAPPED_MARKDOWN,
  escapeUnescapedTablePipes,
  indentContinuationLines,
  literalMarkdown,
  quoteMarkdownLines,
  replaceLeadingWhitespaceWithEntities,
  replaceNewlinesWithHtmlBreaks,
  wrapMarkdown,
  withSourceParagraphs,
  type MappedMarkdown,
} from './markdown-source-map.ts';
import { nestedTableHtml, tableWidth } from './markdown-nested-table.ts';
import {
  buildMarkdownReviewBindings,
  buildMarkdownSourceCapture,
  indexPageReviewArtifacts,
  markdownReviewSourceScope,
  type MarkdownPageProjectionValues,
} from './markdown-review-bindings.ts';
import {
  buildNoteLabels,
  buildNoteStoryIndexes,
  EMPTY_NOTE_STORIES,
  type NoteProjection,
} from './markdown-notes.ts';
import type {
  MarkdownExportResult,
  MarkdownImageResult,
  MarkdownPage,
  MarkdownTranslationOptions,
} from './markdown-types.ts';
export type {
  MarkdownExportOptions,
  MarkdownExportResult,
  MarkdownImageResult,
  MarkdownPage,
  MarkdownPaginationInfo,
  MarkdownTranslationOptions,
} from './markdown-types.ts';

interface TranslationContext {
  readonly options: MarkdownTranslationOptions;
  readonly noteLabelByScope: Map<string, string>;
  readonly tableCell: boolean;
  readonly hardBreakHtml?: boolean;
  readonly displayMode: SemanticLayout['displayMode'];
  /** Translator-local story/part scope disambiguating paragraph ids across DOCX parts. */
  readonly sourceScope: string;
  readonly listIndentByParagraphId: ReadonlyMap<string, number>;
  readonly listMarkerByParagraphId: ReadonlyMap<
    string,
    NonNullable<ParagraphFragmentRecord['marker']>
  >;
  readonly tablesById: ReadonlyMap<string, TableProjection>;
  /** A translator maps each published drawing object at most once across full/page views. */
  readonly imageResultByDrawing: WeakMap<object, MarkdownImageResult>;
  readonly sourceCapture?: MarkdownSourceCapture;
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
  readonly isHeaderRow: boolean;
  readonly isHeaderRepeat: boolean;
  readonly cells: LogicalCell[];
}

interface TableProjection {
  readonly fragments: TableFragmentRecord[];
  readonly columnCount: number;
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported semantic record: ${JSON.stringify(value)}`);
}

function destination(url: string): string {
  return url.replace(
    /[\u0000-\u0020\u007f<>()\\]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  );
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

function capturesParagraph(context: TranslationContext, paragraphId: string): boolean {
  const capture = context.sourceCapture;
  return Boolean(
    capture &&
    (capture.allSourceScopes.has(context.sourceScope) ||
      capture.offsetsBySource.has(markdownSourceCaptureKey(context.sourceScope, paragraphId)))
  );
}

function mappedDrawingMarkdown(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  context: TranslationContext,
  markdown: string
): MappedMarkdown {
  if (markdown.length === 0) return EMPTY_MAPPED_MARKDOWN;
  if (!capturesParagraph(context, drawing.paragraphId)) return literalMarkdown(markdown);
  return {
    markdown,
    sources: [
      {
        sourceScope: context.sourceScope,
        paragraphId: drawing.paragraphId,
        sourceStart: drawing.start,
        sourceEnd: drawing.start + 1,
        markdownStart: 0,
        markdownEnd: markdown.length,
        exact: false,
      },
    ],
  };
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
  readonly leading: readonly MarkdownTextToken[];
  readonly content: readonly MarkdownTextToken[];
  readonly trailing: readonly MarkdownTextToken[];
} {
  const content = tokens.map((token) => ({ ...token }));
  const leading: MarkdownTextToken[] = [];
  for (let index = 0; index < content.length; index += 1) {
    const token = content[index]!;
    if (token.sourceText.length === 0) continue;
    const match = /^\s+/.exec(token.sourceText);
    if (!match) break;
    leading.push({ ...token, sourceText: match[0] });
    content[index] = {
      ...token,
      sourceText: token.sourceText.slice(match[0].length),
      sourceOffset: (token.sourceOffset ?? 0) + match[0].length,
    };
    if (content[index]!.sourceText.length > 0) break;
  }
  const trailing: MarkdownTextToken[] = [];
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const token = content[index]!;
    if (token.sourceText.length === 0) continue;
    const match = /\s+$/.exec(token.sourceText);
    if (!match) break;
    trailing.unshift({
      ...token,
      sourceText: match[0],
      sourceOffset: (token.sourceOffset ?? 0) + token.sourceText.length - match[0].length,
    });
    content[index] = { ...token, sourceText: token.sourceText.slice(0, -match[0].length) };
    if (content[index]!.sourceText.length > 0) break;
  }
  return { leading, content, trailing };
}

function textTokensMarkdown(
  tokens: readonly MarkdownTextToken[],
  context: TranslationContext
): MappedMarkdown {
  const writer = new MarkdownInlineWriter(context);
  for (const token of tokens) writer.writeText(token);
  return writer.finishMapped();
}

function linkedSpansMarkdown(
  tokens: readonly MarkdownTextToken[],
  href: string,
  context: TranslationContext
): MappedMarkdown {
  const { leading, content, trailing } = trimTokenWhitespace(tokens);
  const before = textTokensMarkdown(leading, context);
  const label = textTokensMarkdown(content, context);
  const after = textTokensMarkdown(trailing, context);
  if (label.markdown.length === 0 && before.markdown.length + after.markdown.length > 0) {
    return wrapMarkdown(concatMarkdown([before, after]), '[', `](${destination(href)})`);
  }
  return concatMarkdown([
    before,
    label.markdown.length > 0
      ? concatMarkdown([literalMarkdown('['), label, literalMarkdown(`](${destination(href)})`)])
      : EMPTY_MAPPED_MARKDOWN,
    after,
  ]);
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
      const markdown =
        drawing.length > 0 && drawingIsDeleted(atom.drawing, context)
          ? `<del>${drawing}</del>`
          : drawing;
      writer.writeMappedBoundary(mappedDrawingMarkdown(atom.drawing, context, markdown));
      continue;
    }
    const paragraphId = atom.span.range.paragraphId;
    const navigation = noteNavigationMarkdown(atom.span, context);
    if (navigation !== null) {
      if (navigation.length > 0 && capturesParagraph(context, paragraphId)) {
        writer.writeMappedBoundary({
          markdown: navigation,
          sources: [
            {
              sourceScope: context.sourceScope,
              paragraphId,
              sourceStart: atom.span.range.start,
              sourceEnd: atom.span.range.end,
              markdownStart: 0,
              markdownEnd: navigation.length,
              exact: false,
            },
          ],
        });
      } else writer.writeBoundary(navigation);
      continue;
    }
    if (atom.span.link?.kind === 'external' && atom.span.link.href) {
      const linked: MarkdownTextToken[] = [
        {
          span: atom.span,
          paragraphId,
          sourceText: sourceTextOf(atom.span),
        },
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
        linked.push({
          span: next.span,
          paragraphId: next.span.range.paragraphId,
          sourceText: sourceTextOf(next.span),
        });
        index += 1;
      }
      writer.writeMappedBoundary(linkedSpansMarkdown(linked, atom.span.link.href, context));
      continue;
    }
    writer.writeText({
      span: atom.span,
      paragraphId,
      sourceText: sourceTextOf(atom.span),
    });
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
): MappedMarkdown {
  const writer = new MarkdownInlineWriter(context);
  for (const fragment of fragments) {
    for (const line of fragment.lines) {
      for (const segment of lineSegments(line))
        writeSpanAtoms(markdownAtoms(segment), context, writer);
    }
  }
  return writer.finishMapped();
}

function paragraphMarkdown(
  fragments: readonly ParagraphFragmentRecord[],
  context: TranslationContext,
  logical = true
): MappedMarkdown {
  const first = fragments[0];
  if (!first) return EMPTY_MAPPED_MARKDOWN;
  const headingLevel = first.outlineLevel === null ? null : first.outlineLevel + 1;
  const heading =
    !context.tableCell && headingLevel !== null && headingLevel >= 1 && headingLevel <= 9
      ? `${'#'.repeat(Math.min(headingLevel, 6))} `
      : '';
  // Leading preserved whitespace is visual OOXML spacing, not a Markdown code-block request.
  // Entities retain every authored space without creating a four-space code-block prefix. List
  // indentation is added structurally below, after this conversion.
  const body = replaceLeadingWhitespaceWithEntities(
    paragraphBody(fragments, heading.length > 0 ? { ...context, hardBreakHtml: true } : context)
  );
  const marker = first.marker ?? context.listMarkerByParagraphId.get(first.paragraphId);
  const indent = ' '.repeat(
    context.listIndentByParagraphId.get(first.paragraphId) ?? (marker?.level ?? 0) * 4
  );
  let projected: MappedMarkdown;
  if (!logical && first.fragmentIndex > 0) {
    if (!marker) projected = body;
    else {
      const bullet = marker.numFmt === 'bullet' ? '-' : `${marker.ordinal ?? 1}.`;
      projected = wrapMarkdown(body, `${indent}${' '.repeat(bullet.length + 1)}`);
    }
  } else if (marker) {
    const bullet = marker.numFmt === 'bullet' ? '-' : `${marker.ordinal ?? 1}.`;
    // CommonMark permits a heading as list-item content. Preserve both authored semantics so a
    // numbered Word heading remains navigable without losing its visible ordinal.
    projected = wrapMarkdown(body, `${indent}${bullet} ${heading}`);
  } else projected = wrapMarkdown(body, heading);
  if (!context.sourceCapture?.allSourceScopes.has(context.sourceScope)) return projected;
  const extentOf = (fragment: ParagraphFragmentRecord): { start: number; end: number } => {
    if (fragment.range) return fragment.range;
    const ranges = fragment.lines.map((line) => line.range);
    return {
      start: Math.min(...ranges.map((range) => range.start)),
      end: Math.max(...ranges.map((range) => range.end)),
    };
  };
  const extents = fragments.map(extentOf);
  return withSourceParagraphs(projected, [
    {
      sourceScope: context.sourceScope,
      paragraphId: first.paragraphId,
      sourceStart: Math.min(...extents.map((extent) => extent.start)),
      sourceEnd: Math.max(...extents.map((extent) => extent.end)),
    },
  ]);
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

/** GFM's unsupported nested-table shape uses mapped inline HTML wrappers. */
function nestedTableMarkdown(
  fragments: readonly TableFragmentRecord[],
  context: TranslationContext,
  pageScoped: boolean
): MappedMarkdown {
  const tableId = fragments[0]?.tableId;
  const projection = tableId ? context.tablesById.get(tableId) : undefined;
  const completeFragments = projection?.fragments ?? fragments;
  const rows = pageScoped ? mergeRows(fragments, true) : mergeRows(completeFragments, false);
  if (rows.length === 0) return EMPTY_MAPPED_MARKDOWN;
  const width = tableWidth(projection?.columnCount, fragments[0]?.columnEdges.length);
  const nestedContext = { ...context, tableCell: true };
  return nestedTableHtml(rows, width, (row, columnIndex) => {
    const cell = row.cells.find((candidate) => candidate.gridColumn === columnIndex);
    return !cell || cell.vMergeContinue
      ? EMPTY_MAPPED_MARKDOWN
      : renderLogicalBlocks(logicalBlocks(cell.blocks), nestedContext, true, pageScoped);
  });
}

function cellValues(
  row: LogicalRow,
  context: TranslationContext,
  pageScoped: boolean
): MappedMarkdown[] {
  const values: MappedMarkdown[] = [];
  const nestedContext = { ...context, tableCell: true };
  for (const cell of row.cells) {
    const value = cell.vMergeContinue
      ? EMPTY_MAPPED_MARKDOWN
      : replaceNewlinesWithHtmlBreaks(
          escapeUnescapedTablePipes(
            renderLogicalBlocks(logicalBlocks(cell.blocks), nestedContext, true, pageScoped)
          )
        );
    while (values.length < cell.gridColumn) values.push(EMPTY_MAPPED_MARKDOWN);
    values[cell.gridColumn] = value;
    for (let span = 1; span < cell.gridSpan; span += 1) {
      values[cell.gridColumn + span] = EMPTY_MAPPED_MARKDOWN;
    }
  }
  return values;
}

function tableMarkdown(
  fragments: readonly TableFragmentRecord[],
  context: TranslationContext,
  pageScoped: boolean
): MappedMarkdown {
  const tableId = fragments[0]?.tableId;
  const projection = tableId ? context.tablesById.get(tableId) : undefined;
  const completeFragments = projection?.fragments ?? fragments;
  const rows = pageScoped ? mergeRows(fragments, true) : mergeRows(completeFragments, false);
  if (rows.length === 0) return EMPTY_MAPPED_MARKDOWN;
  const width = tableWidth(projection?.columnCount, fragments[0]?.columnEdges.length);
  const normalize = (
    values: MappedMarkdown[],
    fallback: MappedMarkdown = EMPTY_MAPPED_MARKDOWN
  ): MappedMarkdown[] => Array.from({ length: width }, (_, index) => values[index] ?? fallback);
  const line = (row: LogicalRow): MappedMarkdown =>
    concatMarkdown(
      [
        literalMarkdown('| '),
        concatMarkdown(normalize(cellValues(row, context, pageScoped)), ' | '),
        literalMarkdown(' |'),
      ],
      ''
    );
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
  return concatMarkdown(
    [
      line(header),
      literalMarkdown(
        `| ${Array.from({ length: width }, (_, index) => alignments[index] ?? '---').join(' | ')} |`
      ),
      ...rows.slice(1).map(line),
    ],
    '\n'
  );
}

function renderLogicalBlocks(
  blocks: readonly LogicalBlock[],
  context: TranslationContext,
  nested = false,
  pageScoped = false
): MappedMarkdown {
  const rendered = blocks.map((block) => {
    switch (block.kind) {
      case 'paragraph':
        return paragraphMarkdown(block.fragments, context, !pageScoped);
      case 'table':
        return context.tableCell
          ? nestedTableMarkdown(block.fragments, context, pageScoped)
          : tableMarkdown(block.fragments, context, pageScoped);
      default:
        return assertNever(block);
    }
  });
  const visible = concatMarkdown(
    rendered.filter((value, index) => value.markdown.length > 0 || index < rendered.length - 1),
    nested ? '\n' : '\n\n'
  );
  return withSourceParagraphs(
    visible,
    rendered.flatMap((value) => value.paragraphs ?? [])
  );
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

function documentAnchoredDrawings(
  layout: SemanticLayout,
  context: TranslationContext
): MappedMarkdown {
  return concatMarkdown(
    layout.pages
      .flatMap((page) => page.anchoredDrawings ?? [])
      // Textbox stories are not linear body content. Their deliberate omission is documented;
      // non-textbox drawings retain deterministic page/record order here.
      .filter((drawing) => drawing.textboxStory === undefined)
      .map((drawing) => mappedDrawingMarkdown(drawing, context, drawingMarkdown(drawing, context)))
      .filter((value) => value.markdown.length > 0),
    '\n\n'
  );
}

function pageBody(
  page: PageRecord,
  context: TranslationContext
): { readonly value: MappedMarkdown; readonly noteLabels: ReadonlySet<string> } {
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
    .map((drawing) =>
      mappedDrawingMarkdown(drawing, pageContext, drawingMarkdown(drawing, pageContext))
    )
    .filter((value) => value.markdown.length > 0);
  return {
    value: concatMarkdown(
      [markdown, ...anchored].filter((value) => value.markdown.length > 0),
      '\n\n'
    ),
    noteLabels,
  };
}

function storyMarkdown(
  story: {
    readonly kind: 'header' | 'footer';
    readonly partName: string;
    readonly fragments: readonly BlockFragmentRecord[];
    readonly anchoredDrawings?: readonly AnchoredDrawingRecord[];
  },
  context: TranslationContext
): MappedMarkdown {
  const listIndentByParagraphId = new Map<string, number>();
  const listMarkerByParagraphId = new Map<string, NonNullable<ParagraphFragmentRecord['marker']>>();
  const tablesById = new Map<string, TableProjection>();
  indexLists(logicalBlocks(story.fragments), listIndentByParagraphId, listMarkerByParagraphId);
  indexTableBlocks(story.fragments, tablesById);
  const storyContext: TranslationContext = {
    ...context,
    sourceScope: markdownReviewSourceScope(story.kind, story.partName, null),
    listIndentByParagraphId,
    listMarkerByParagraphId,
    tablesById,
  };
  const body = renderLogicalBlocks(logicalBlocks(story.fragments), storyContext);
  const drawings = (story.anchoredDrawings ?? [])
    .filter((drawing) => drawing.textboxStory === undefined)
    .map((drawing) =>
      mappedDrawingMarkdown(drawing, storyContext, drawingMarkdown(drawing, storyContext))
    )
    .filter((value) => value.markdown.length > 0);
  return concatMarkdown(
    [body, ...drawings].filter((value) => value.markdown.length > 0),
    '\n\n'
  );
}

function visibleNoteContinuation(
  note: NoteProjection,
  label: string,
  body: MappedMarkdown
): MappedMarkdown {
  const title = note.kind === 'footnote' ? 'Footnote' : 'Endnote';
  const heading = `> **${title} ${label} (continued):**`;
  if (body.markdown.length === 0) return literalMarkdown(heading);
  return concatMarkdown([literalMarkdown(`${heading}\n>\n`), quoteMarkdownLines(body)]);
}

function noteDefinitions(
  stories: ReadonlyMap<string, NoteProjection>,
  context: TranslationContext,
  pageScoped = false,
  localReferenceLabels: ReadonlySet<string> = new Set(),
  previouslyRenderedScopes: Set<string> = new Set()
): MappedMarkdown {
  const definitions: MappedMarkdown[] = [];
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
      sourceScope: markdownReviewSourceScope(note.kind, '', scopeId),
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
    const indented = indentContinuationLines(body, '    ');
    definitions.push(wrapMarkdown(indented, `[^${label}]: `));
  }
  return concatMarkdown(definitions, '\n\n');
}

function withDefinitions(markdown: MappedMarkdown, definitions: MappedMarkdown): MappedMarkdown {
  return concatMarkdown(
    [markdown, definitions].filter((value) => value.markdown.length > 0),
    '\n\n'
  );
}

/** Translate an immutable exporter-neutral layout snapshot without retaining its producer. @public */
export function exportMarkdownLayout(
  layout: ExportSemanticLayout,
  options: MarkdownTranslationOptions = {}
): MarkdownExportResult {
  const reviewArtifacts = layout.reviewArtifacts;
  const indexes = buildTranslationIndexes(layout);
  const notes = buildNoteStoryIndexes(layout);
  const context: TranslationContext = {
    options,
    noteLabelByScope: buildNoteLabels(layout),
    tableCell: false,
    displayMode: layout.displayMode,
    sourceScope: markdownReviewSourceScope('body', '', null),
    imageResultByDrawing: new WeakMap(),
    sourceCapture: buildMarkdownSourceCapture(reviewArtifacts),
    ...indexes,
  };
  const markdown = withDefinitions(
    concatMarkdown(
      [
        renderLogicalBlocks(bodyBlocks(layout), context),
        documentAnchoredDrawings(layout, context),
      ].filter((value) => value.markdown.length > 0),
      '\n\n'
    ),
    noteDefinitions(notes.document, context)
  );
  const artifactsByPage = indexPageReviewArtifacts(reviewArtifacts);
  const renderedNoteScopes = new Set<string>();
  const pageProjectionValues = new Map<number, MarkdownPageProjectionValues>();
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
    const values: MarkdownPageProjectionValues = {
      markdown: withDefinitions(body.value, definitions),
      headerMarkdown: page.header ? storyMarkdown(page.header, pageContext) : EMPTY_MAPPED_MARKDOWN,
      footerMarkdown: page.footer ? storyMarkdown(page.footer, pageContext) : EMPTY_MAPPED_MARKDOWN,
    };
    pageProjectionValues.set(page.index, values);
    return Object.freeze({
      id: page.id,
      number: page.index + 1,
      markdown: values.markdown.markdown,
      headerMarkdown: values.headerMarkdown.markdown,
      footerMarkdown: values.footerMarkdown.markdown,
      comments: Object.freeze(pageArtifacts?.comments ?? []),
      trackedChanges: Object.freeze(pageArtifacts?.trackedChanges ?? []),
    });
  });
  return Object.freeze({
    pages: Object.freeze(pages),
    reviewArtifacts,
    reviewBindings: buildMarkdownReviewBindings(reviewArtifacts, markdown, pageProjectionValues),
    pagination: Object.freeze({
      source: 'layout-engine',
      scope: 'export-snapshot',
      layoutRevision: layout.revision,
      revisionView: layout.displayMode ?? 'all-markup',
    }),
    markdown: markdown.markdown,
  });
}

/** Translate one shared semantic layout session to Markdown. @public */
export async function exportMarkdownFrom(
  session: ExportSession,
  options: MarkdownTranslationOptions = {}
): Promise<MarkdownExportResult> {
  return exportMarkdownLayout(await session.layout(), options);
}
