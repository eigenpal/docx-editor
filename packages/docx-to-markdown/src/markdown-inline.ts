import {
  revisionsAreDeletion,
  type SemanticLayout,
  type StyleSpanRecord,
} from '@docx-editor.dev/core/layout';
import {
  concatMarkdown,
  literalMarkdown,
  type MappedMarkdown,
  type MarkdownSourceSlice,
} from './markdown-source-map.ts';

type MarkdownInlineStyle = 'strike' | 'italic' | 'bold';

export interface MarkdownTextToken {
  readonly span: StyleSpanRecord;
  readonly paragraphId: string;
  readonly sourceText: string;
  readonly sourceOffset?: number;
  readonly exact?: boolean;
}

type MarkdownInlineChunk =
  | {
      readonly kind: 'text';
      readonly sourceText: string;
      readonly styles: readonly MarkdownInlineStyle[];
      readonly paragraphId: string;
      readonly sourceStart: number;
      readonly sourceEnd: number;
      readonly exact: boolean;
    }
  | { readonly kind: 'boundary'; readonly value: MappedMarkdown };

interface MarkdownInlineContext {
  readonly tableCell: boolean;
  readonly hardBreakHtml?: boolean;
  readonly displayMode: SemanticLayout['displayMode'];
  readonly sourceScope: string;
  readonly sourceCapture?: MarkdownSourceCapture;
}

export interface MarkdownSourceCapture {
  /** Scopes whose cross-paragraph occurrences require every paragraph's source slices. */
  readonly allSourceScopes: ReadonlySet<string>;
  /** Sorted source boundaries needed for each reviewed paragraph. */
  readonly offsetsBySource: ReadonlyMap<string, readonly number[]>;
}

export function markdownSourceCaptureKey(sourceScope: string, paragraphId: string): string {
  return `${sourceScope}\0${paragraphId}`;
}

const MARKDOWN_PUNCTUATION = new Set('\\`*{}[]()#+-.!_|~=');
const MARKDOWN_UNICODE_PUNCTUATION = /[\p{P}\p{S}]/u;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

function isInWordHyphen(
  value: string,
  index: number,
  adjacent: { readonly before?: string; readonly after?: string }
): boolean {
  if (value[index] !== '-') return false;
  const before = index > 0 ? sourceEdge(value.slice(0, index), 'last') : adjacent.before;
  const after =
    index + 1 < value.length ? sourceEdge(value.slice(index + 1), 'first') : adjacent.after;
  return (
    before !== undefined &&
    after !== undefined &&
    WORD_CHARACTER.test(before) &&
    WORD_CHARACTER.test(after)
  );
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported Markdown inline style: ${String(value)}`);
}

/** Escape every file-derived character that can open Markdown or raw HTML. */
export function escapeText(value: string, tableCell = false): string {
  return escapedText(value, tableCell).markdown;
}

function escapedText(
  value: string,
  tableCell: boolean,
  requestedBoundaries: ReadonlySet<number> = new Set(),
  adjacent: { readonly before?: string; readonly after?: string } = {}
): { readonly markdown: string; readonly boundaries: ReadonlyMap<number, number> } {
  let markdown = '';
  const boundaries = new Map<number, number>();
  const record = (offset: number): void => {
    if (requestedBoundaries.has(offset)) boundaries.set(offset, markdown.length);
  };
  record(0);
  let index = 0;
  while (index < value.length) {
    const character = value[index]!;
    if (character === '\r' && value[index + 1] === '\n') {
      markdown += tableCell ? '<br>' : '  \n';
      index += 1;
      record(index);
      index += 1;
      record(index);
      continue;
    }
    if (character === '\r' || character === '\n' || character === '\f') {
      markdown += tableCell ? '<br>' : '  \n';
    } else if (character === '&') {
      markdown += '&amp;';
    } else if (character === '<') {
      markdown += '&lt;';
    } else if (character === '>') {
      markdown += '&gt;';
    } else if (character === '\t') {
      markdown += ' ';
    } else {
      if (MARKDOWN_PUNCTUATION.has(character) && !isInWordHyphen(value, index, adjacent)) {
        markdown += '\\';
      }
      markdown += character;
    }
    index += 1;
    record(index);
  }
  return { markdown, boundaries };
}

function mappedTextChunk(
  chunk: Extract<MarkdownInlineChunk, { kind: 'text' }>,
  tableCell: boolean,
  capture: MarkdownSourceCapture | undefined,
  sourceScope: string,
  adjacent: { readonly before?: string; readonly after?: string } = {}
): MappedMarkdown {
  const requested = capture?.offsetsBySource.get(
    markdownSourceCaptureKey(sourceScope, chunk.paragraphId)
  );
  if (!capture || (!capture.allSourceScopes.has(sourceScope) && !requested)) {
    return literalMarkdown(escapedText(chunk.sourceText, tableCell, new Set(), adjacent).markdown);
  }
  const relativeBoundaries = new Set<number>([0, chunk.sourceText.length]);
  if (chunk.exact) {
    const offsets = requested ?? [];
    let low = 0;
    let high = offsets.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (offsets[middle]! < chunk.sourceStart) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < offsets.length; index += 1) {
      const offset = offsets[index]!;
      if (offset > chunk.sourceEnd) break;
      relativeBoundaries.add(offset - chunk.sourceStart);
    }
  }
  const escaped = escapedText(chunk.sourceText, tableCell, relativeBoundaries, adjacent);
  const markdownBoundaries = chunk.exact
    ? [...escaped.boundaries].map(([sourceOffset, markdownOffset]) => ({
        sourceOffset: chunk.sourceStart + sourceOffset,
        markdownOffset,
      }))
    : undefined;
  const source: MarkdownSourceSlice = {
    sourceScope,
    paragraphId: chunk.paragraphId,
    sourceStart: chunk.sourceStart,
    sourceEnd: chunk.sourceEnd,
    markdownStart: 0,
    markdownEnd: escaped.markdown.length,
    ...(markdownBoundaries ? { markdownBoundaries } : {}),
    exact: chunk.exact,
  };
  return { markdown: escaped.markdown, sources: [source] };
}

function markdownInlineStyles(
  span: StyleSpanRecord,
  context: MarkdownInlineContext
): readonly MarkdownInlineStyle[] {
  const deleted =
    context.displayMode === 'all-markup' &&
    span.revisions !== undefined &&
    revisionsAreDeletion(span.revisions);
  // Strike stays innermost. GFM refuses an intraword `~~` opener immediately before another
  // delimiter, while `*~~text~~*` and `**~~text~~**` remain valid in every transition direction.
  return [
    ...(span.style.italic ? (['italic'] as const) : []),
    ...(span.style.bold ? (['bold'] as const) : []),
    ...(span.style.strike || span.style.doubleStrike || deleted ? (['strike'] as const) : []),
  ];
}

function markdownStyleDelimiter(style: MarkdownInlineStyle): string {
  switch (style) {
    case 'strike':
      return '~~';
    case 'italic':
      return '*';
    case 'bold':
      return '**';
    default:
      return assertNever(style);
  }
}

function markdownStyleTag(style: MarkdownInlineStyle): string {
  switch (style) {
    case 'strike':
      return 'del';
    case 'italic':
      return 'em';
    case 'bold':
      return 'strong';
    default:
      return assertNever(style);
  }
}

function sharedStylePrefix(
  left: readonly MarkdownInlineStyle[],
  right: readonly MarkdownInlineStyle[]
): number {
  let retained = 0;
  while (retained < left.length && retained < right.length && left[retained] === right[retained]) {
    retained += 1;
  }
  return retained;
}

function sourceEdge(value: string, edge: 'first' | 'last'): string | undefined {
  if (value.length === 0) return undefined;
  if (edge === 'first') return String.fromCodePoint(value.codePointAt(0)!);
  const last = value.length - 1;
  const lastCodeUnit = value.charCodeAt(last);
  const previousCodeUnit = last > 0 ? value.charCodeAt(last - 1) : 0;
  const startsSurrogatePair =
    lastCodeUnit >= 0xdc00 &&
    lastCodeUnit <= 0xdfff &&
    previousCodeUnit >= 0xd800 &&
    previousCodeUnit <= 0xdbff;
  return value.slice(startsSurrogatePair ? last - 1 : last);
}

function chunkAdjacency(
  chunks: readonly MarkdownInlineChunk[],
  index: number
): { readonly before?: string; readonly after?: string } {
  const current = chunks[index];
  if (current?.kind !== 'text') return {};
  const previous = chunks[index - 1];
  const next = chunks[index + 1];
  return {
    ...(previous?.kind === 'text' && previous.paragraphId === current.paragraphId
      ? { before: sourceEdge(previous.sourceText, 'last') }
      : {}),
    ...(next?.kind === 'text' && next.paragraphId === current.paragraphId
      ? { after: sourceEdge(next.sourceText, 'first') }
      : {}),
  };
}

function inlineIslandNeedsHtml(
  chunks: readonly MarkdownInlineChunk[],
  start: number,
  end: number
): boolean {
  for (let index = start; index < end; index += 1) {
    const chunk = chunks[index]!;
    if (chunk.kind !== 'text') continue;
    const previous = chunks[index - 1];
    const next = chunks[index + 1];
    const previousStyles =
      index > start && previous?.kind === 'text' ? previous.styles : ([] as const);
    const nextStyles = index + 1 < end && next?.kind === 'text' ? next.styles : ([] as const);
    const opensStyle = sharedStylePrefix(previousStyles, chunk.styles) < chunk.styles.length;
    const closesStyle = sharedStylePrefix(chunk.styles, nextStyles) < chunk.styles.length;
    const first = sourceEdge(chunk.sourceText, 'first');
    const last = sourceEdge(chunk.sourceText, 'last');
    const before = previous
      ? sourceEdge(previous.kind === 'text' ? previous.sourceText : previous.value.markdown, 'last')
      : undefined;
    const after = next
      ? sourceEdge(next.kind === 'text' ? next.sourceText : next.value.markdown, 'first')
      : undefined;
    // Backslash escaping punctuation does not change CommonMark delimiter flanking. Use fixed
    // semantic tags for this island when a delimiter would open or close against that boundary.
    if (
      opensStyle &&
      first &&
      before &&
      MARKDOWN_UNICODE_PUNCTUATION.test(first) &&
      !/\s/u.test(before)
    ) {
      return true;
    }
    if (
      closesStyle &&
      last &&
      after &&
      MARKDOWN_UNICODE_PUNCTUATION.test(last) &&
      !/\s/u.test(after)
    ) {
      return true;
    }
  }
  return false;
}

function htmlInlineIsland(
  chunks: readonly MarkdownInlineChunk[],
  start: number,
  end: number,
  tableCell: boolean,
  capture: MarkdownSourceCapture | undefined,
  sourceScope: string
): MappedMarkdown {
  const parts: MappedMarkdown[] = [];
  let openStyles: readonly MarkdownInlineStyle[] = [];
  for (let index = start; index < end; index += 1) {
    const chunk = chunks[index]!;
    if (chunk.kind !== 'text') continue;
    const retained = sharedStylePrefix(openStyles, chunk.styles);
    for (let styleIndex = openStyles.length - 1; styleIndex >= retained; styleIndex -= 1) {
      parts.push(literalMarkdown(`</${markdownStyleTag(openStyles[styleIndex]!)}>`));
    }
    for (let styleIndex = retained; styleIndex < chunk.styles.length; styleIndex += 1) {
      parts.push(literalMarkdown(`<${markdownStyleTag(chunk.styles[styleIndex]!)}>`));
    }
    parts.push(
      mappedTextChunk(chunk, tableCell, capture, sourceScope, chunkAdjacency(chunks, index))
    );
    openStyles = chunk.styles;
  }
  for (let index = openStyles.length - 1; index >= 0; index -= 1) {
    parts.push(literalMarkdown(`</${markdownStyleTag(openStyles[index]!)}>`));
  }
  return concatMarkdown(parts);
}

/** Keep delimiter state across run, line, and page-fragment boundaries of one logical paragraph. */
export class MarkdownInlineWriter {
  readonly #context: MarkdownInlineContext;
  readonly #chunks: MarkdownInlineChunk[] = [];

  constructor(context: MarkdownInlineContext) {
    this.#context = context;
  }

  #writeSourceText(
    token: MarkdownTextToken,
    sourceText: string,
    relativeStart: number,
    styles: readonly MarkdownInlineStyle[],
    exact: boolean
  ): void {
    if (sourceText.length === 0) return;
    this.#chunks.push({
      kind: 'text',
      sourceText,
      styles,
      paragraphId: token.paragraphId,
      sourceStart: exact
        ? token.span.range.start + (token.sourceOffset ?? 0) + relativeStart
        : token.span.range.start,
      sourceEnd: exact
        ? token.span.range.start + (token.sourceOffset ?? 0) + relativeStart + sourceText.length
        : token.span.range.end,
      exact,
    });
  }

  writeText(token: MarkdownTextToken): void {
    const boundary = /^(\s*)([\s\S]*?)(\s*)$/.exec(token.sourceText);
    const leading = boundary?.[1] ?? '';
    const text = boundary?.[2] ?? token.sourceText;
    const trailing = boundary?.[3] ?? '';
    const exact =
      token.exact ??
      (token.span.projected !== true &&
        token.span.equation === undefined &&
        token.sourceText.length === token.span.range.end - token.span.range.start);
    this.#writeSourceText(token, leading, 0, [], exact);
    this.#writeSourceText(
      token,
      text,
      leading.length,
      markdownInlineStyles(token.span, this.#context),
      exact
    );
    this.#writeSourceText(token, trailing, leading.length + text.length, [], exact);
  }

  writeBoundary(markdown: string): void {
    this.writeMappedBoundary(literalMarkdown(markdown));
  }

  writeMappedBoundary(value: MappedMarkdown): void {
    if (value.markdown.length === 0 && value.sources.length === 0) return;
    this.#chunks.push({ kind: 'boundary', value });
  }

  finishMapped(): MappedMarkdown {
    const parts: MappedMarkdown[] = [];
    let openStyles: readonly MarkdownInlineStyle[] = [];
    const transition = (nextStyles: readonly MarkdownInlineStyle[]): void => {
      const retained = sharedStylePrefix(openStyles, nextStyles);
      for (let index = openStyles.length - 1; index >= retained; index -= 1) {
        parts.push(literalMarkdown(markdownStyleDelimiter(openStyles[index]!)));
      }
      for (let index = retained; index < nextStyles.length; index += 1) {
        parts.push(literalMarkdown(markdownStyleDelimiter(nextStyles[index]!)));
      }
      openStyles = nextStyles;
    };
    for (let index = 0; index < this.#chunks.length; index += 1) {
      const chunk = this.#chunks[index]!;
      if (chunk.kind === 'boundary') {
        transition([]);
        parts.push(chunk.value);
        continue;
      }
      if (chunk.styles.length === 0) {
        transition([]);
        parts.push(this.#mappedSourceChunk(chunk, index));
        continue;
      }
      let end = index + 1;
      while (end < this.#chunks.length) {
        const candidate = this.#chunks[end];
        if (candidate?.kind !== 'text' || candidate.styles.length === 0) break;
        end += 1;
      }
      if (inlineIslandNeedsHtml(this.#chunks, index, end)) {
        transition([]);
        parts.push(
          htmlInlineIsland(
            this.#chunks,
            index,
            end,
            this.#context.tableCell || this.#context.hardBreakHtml === true,
            this.#context.sourceCapture,
            this.#context.sourceScope
          )
        );
        index = end - 1;
        continue;
      }
      transition(chunk.styles);
      parts.push(this.#mappedSourceChunk(chunk, index));
    }
    transition([]);
    return concatMarkdown(parts);
  }

  #mappedSourceChunk(
    chunk: Extract<MarkdownInlineChunk, { kind: 'text' }>,
    index: number
  ): MappedMarkdown {
    const tableCell = this.#context.tableCell || this.#context.hardBreakHtml === true;
    return mappedTextChunk(
      chunk,
      tableCell,
      this.#context.sourceCapture,
      this.#context.sourceScope,
      chunkAdjacency(this.#chunks, index)
    );
  }

  finish(): string {
    return this.finishMapped().markdown;
  }
}
