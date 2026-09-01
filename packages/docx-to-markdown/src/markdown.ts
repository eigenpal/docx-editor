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
} from '@docx-editor.dev/core/layout';
import type { ExportSemanticLayout, ExportSession } from '@docx-editor.dev/core/export';
import {
  escapeText,
  markdownSourceCaptureKey,
  MarkdownInlineWriter,
  type MarkdownTextToken,
} from './markdown-inline.ts';
import {
  concatMarkdown,
  EMPTY_MAPPED_MARKDOWN,
  indentContinuationLines,
  literalMarkdown,
  quoteMarkdownLines,
  preserveLeadingWhitespace,
  wrapMarkdown,
  withSourceParagraphs,
  type MappedMarkdown,
} from './markdown-source-map.ts';
import {
  assertNever,
  indexTableBlocks,
  logicalBlocks,
  mergeRows,
  nestedTableMarkdown,
  tableMarkdown,
  type LogicalBlock,
  type TableProjection,
  type TranslationContext,
} from './markdown-logical.ts';
import {
  buildMarkdownReviewBindings,
  buildMarkdownSourceCapture,
  indexPageReviewArtifacts,
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

const EMPTY_REVIEW_ARTIFACTS = Object.freeze([]);

function destination(url: string): string {
  return url.replace(
    /[\u0000-\u0020\u007f<>()\\]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  );
}

/** Stable identity for one translated story, keyed the way capture consumers expect. */
function markdownSourceScope(
  rootStory: 'body' | 'header' | 'footer' | 'footnote' | 'endnote' | 'note-separator',
  partName: string,
  noteScopeId: string | null
): string {
  switch (rootStory) {
    case 'body':
      return 'body';
    case 'header':
    case 'footer':
      return `${rootStory}:${partName}`;
    case 'footnote':
    case 'endnote':
      return `${rootStory}:${noteScopeId ?? partName}`;
    case 'note-separator':
      return `note-separator:${partName}`;
  }
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

function paragraphIsUniformlyBold(fragments: readonly ParagraphFragmentRecord[]): boolean {
  let hasText = false;
  for (const fragment of fragments) {
    for (const line of fragment.lines) {
      for (const segment of lineSegments(line)) {
        for (const span of segment.spans) {
          if (sourceTextOf(span).trim().length === 0) continue;
          hasText = true;
          if (!span.style.bold) return false;
        }
      }
    }
  }
  return hasText;
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
  // Literal non-breaking spaces preserve authored leading whitespace without HTML entities or a
  // four-space Markdown code block. List indentation is added structurally below. A heading
  // already carries uniform bold semantics of its own.
  const body = preserveLeadingWhitespace(
    paragraphBody(
      fragments,
      heading.length > 0
        ? {
            ...context,
            hardBreakHtml: true,
            suppressBold: paragraphIsUniformlyBold(fragments),
          }
        : context
    )
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
          ? nestedTableMarkdown(block.fragments, context, pageScoped, renderLogicalBlocks)
          : tableMarkdown(block.fragments, context, pageScoped, renderLogicalBlocks);
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
    sourceScope: markdownSourceScope(story.kind, story.partName, null),
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
      sourceScope: markdownSourceScope(note.kind, '', scopeId),
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
  // Core export sessions always publish the array. The fallback keeps detached layouts produced
  // by older/custom hosts translatable while preserving the same empty immutable contract.
  const reviewArtifacts = layout.reviewArtifacts ?? EMPTY_REVIEW_ARTIFACTS;
  const displayMode = layout.displayMode ?? 'all-markup';
  const indexes = buildTranslationIndexes(layout);
  const notes = buildNoteStoryIndexes(layout);
  const context: TranslationContext = {
    options,
    noteLabelByScope: buildNoteLabels(layout),
    tableCell: false,
    displayMode,
    sourceScope: markdownSourceScope('body', '', null),
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
  // A baseline furniture story shares ONE fragments array across its section's pages when it
  // carries no page fields and no anchored drawings; translate each such story once. A story
  // with per-page projections gets a fresh record and fragments per page and misses the memo.
  // Nothing on the furniture path reads `pageIndex`, so the shared translation is exact.
  const furnitureMemo = new WeakMap<
    object,
    { readonly scope: string; readonly value: MappedMarkdown }
  >();
  const furnitureMarkdown = (
    story: NonNullable<PageRecord['header']> | undefined
  ): MappedMarkdown => {
    if (!story) return EMPTY_MAPPED_MARKDOWN;
    const scope = `${story.kind}:${story.partName}`;
    const cached = furnitureMemo.get(story.fragments);
    if (cached && cached.scope === scope) return cached.value;
    const value = storyMarkdown(story, context);
    furnitureMemo.set(story.fragments, { scope, value });
    return value;
  };
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
      headerMarkdown: furnitureMarkdown(page.header),
      footerMarkdown: furnitureMarkdown(page.footer),
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
    fontResolution: null,
    pagination: Object.freeze({
      source: 'layout-engine',
      scope: 'export-snapshot',
      layoutRevision: layout.revision,
      displayMode,
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
