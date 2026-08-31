import {
  revisionsAreDeletion,
  type SemanticLayout,
  type StyleSpanRecord,
} from '@docx-editor.dev/core/layout';

type MarkdownInlineStyle = 'strike' | 'italic' | 'bold';

export interface MarkdownTextToken {
  readonly span: StyleSpanRecord;
  readonly sourceText: string;
}

type MarkdownInlineChunk =
  | {
      readonly kind: 'text';
      readonly sourceText: string;
      readonly styles: readonly MarkdownInlineStyle[];
    }
  | { readonly kind: 'boundary'; readonly markdown: string };

interface MarkdownInlineContext {
  readonly tableCell: boolean;
  readonly hardBreakHtml?: boolean;
  readonly displayMode: SemanticLayout['displayMode'];
}

const MARKDOWN_PUNCTUATION = /([\\`*{}\[\]()#+\-.!_|~=])/g;
const MARKDOWN_UNICODE_PUNCTUATION = /[\p{P}\p{S}]/u;

function assertNever(value: never): never {
  throw new TypeError(`Unsupported Markdown inline style: ${String(value)}`);
}

/** Escape every file-derived character that can open Markdown or raw HTML. */
export function escapeText(value: string, tableCell = false): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\t/g, ' ')
    .replace(MARKDOWN_PUNCTUATION, '\\$1')
    .replace(/\r\n?|\n|\f/g, tableCell ? '<br>' : '  \n');
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
      ? sourceEdge(previous.kind === 'text' ? previous.sourceText : previous.markdown, 'last')
      : undefined;
    const after = next
      ? sourceEdge(next.kind === 'text' ? next.sourceText : next.markdown, 'first')
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
  tableCell: boolean
): string {
  let markdown = '';
  let openStyles: readonly MarkdownInlineStyle[] = [];
  for (let index = start; index < end; index += 1) {
    const chunk = chunks[index]!;
    if (chunk.kind !== 'text') continue;
    const retained = sharedStylePrefix(openStyles, chunk.styles);
    for (let styleIndex = openStyles.length - 1; styleIndex >= retained; styleIndex -= 1) {
      markdown += `</${markdownStyleTag(openStyles[styleIndex]!)}>`;
    }
    for (let styleIndex = retained; styleIndex < chunk.styles.length; styleIndex += 1) {
      markdown += `<${markdownStyleTag(chunk.styles[styleIndex]!)}>`;
    }
    markdown += escapeText(chunk.sourceText, tableCell);
    openStyles = chunk.styles;
  }
  for (let index = openStyles.length - 1; index >= 0; index -= 1) {
    markdown += `</${markdownStyleTag(openStyles[index]!)}>`;
  }
  return markdown;
}

/** Keep delimiter state across run, line, and page-fragment boundaries of one logical paragraph. */
export class MarkdownInlineWriter {
  readonly #context: MarkdownInlineContext;
  readonly #chunks: MarkdownInlineChunk[] = [];

  constructor(context: MarkdownInlineContext) {
    this.#context = context;
  }

  #writeSourceText(sourceText: string, styles: readonly MarkdownInlineStyle[]): void {
    if (sourceText.length > 0) this.#chunks.push({ kind: 'text', sourceText, styles });
  }

  writeText(token: MarkdownTextToken): void {
    const boundary = /^(\s*)([\s\S]*?)(\s*)$/.exec(token.sourceText);
    const leading = boundary?.[1] ?? '';
    const text = boundary?.[2] ?? token.sourceText;
    const trailing = boundary?.[3] ?? '';
    this.#writeSourceText(leading, []);
    this.#writeSourceText(text, markdownInlineStyles(token.span, this.#context));
    this.#writeSourceText(trailing, []);
  }

  writeBoundary(markdown: string): void {
    if (markdown.length === 0) return;
    this.#chunks.push({ kind: 'boundary', markdown });
  }

  finish(): string {
    let markdown = '';
    let openStyles: readonly MarkdownInlineStyle[] = [];
    const transition = (nextStyles: readonly MarkdownInlineStyle[]): void => {
      const retained = sharedStylePrefix(openStyles, nextStyles);
      for (let index = openStyles.length - 1; index >= retained; index -= 1) {
        markdown += markdownStyleDelimiter(openStyles[index]!);
      }
      for (let index = retained; index < nextStyles.length; index += 1) {
        markdown += markdownStyleDelimiter(nextStyles[index]!);
      }
      openStyles = nextStyles;
    };
    for (let index = 0; index < this.#chunks.length; index += 1) {
      const chunk = this.#chunks[index]!;
      if (chunk.kind === 'boundary') {
        transition([]);
        markdown += chunk.markdown;
        continue;
      }
      if (chunk.styles.length === 0) {
        transition([]);
        markdown += escapeText(
          chunk.sourceText,
          this.#context.tableCell || this.#context.hardBreakHtml === true
        );
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
        markdown += htmlInlineIsland(
          this.#chunks,
          index,
          end,
          this.#context.tableCell || this.#context.hardBreakHtml === true
        );
        index = end - 1;
        continue;
      }
      transition(chunk.styles);
      markdown += escapeText(
        chunk.sourceText,
        this.#context.tableCell || this.#context.hardBreakHtml === true
      );
    }
    transition([]);
    return markdown;
  }
}
