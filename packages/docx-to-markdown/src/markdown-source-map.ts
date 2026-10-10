/** One source-backed substring inside a generated Markdown projection. */
export interface MarkdownSourceSlice {
  readonly sourceScope: string;
  readonly paragraphId: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly markdownStart: number;
  readonly markdownEnd: number;
  /** Sparse absolute offsets for review boundaries that fall inside this source substring. */
  readonly markdownBoundaries?: readonly MarkdownSourceBoundary[];
  /** False when a generated fallback does not have one-to-one source character boundaries. */
  readonly exact: boolean;
}

/** Ordered full source extent of one paragraph, including paragraphs that emitted no Markdown. */
export interface MarkdownSourceParagraph {
  readonly sourceScope: string;
  readonly paragraphId: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

export interface MarkdownSourceBoundary {
  readonly sourceOffset: number;
  readonly markdownOffset: number;
}

/** Markdown plus the source-backed substrings needed to bind review artifacts. */
export interface MappedMarkdown {
  readonly markdown: string;
  readonly sources: readonly MarkdownSourceSlice[];
  readonly paragraphs?: readonly MarkdownSourceParagraph[];
}

export const EMPTY_MAPPED_MARKDOWN: MappedMarkdown = Object.freeze({
  markdown: '',
  sources: Object.freeze([]),
});

export function literalMarkdown(markdown: string): MappedMarkdown {
  return markdown.length === 0 ? EMPTY_MAPPED_MARKDOWN : { markdown, sources: [] };
}

function shiftedSources(
  sources: readonly MarkdownSourceSlice[],
  offset: number
): MarkdownSourceSlice[] {
  if (offset === 0) return [...sources];
  return sources.map((source) => ({
    ...source,
    markdownStart: source.markdownStart + offset,
    markdownEnd: source.markdownEnd + offset,
    markdownBoundaries: source.markdownBoundaries?.map((boundary) => ({
      ...boundary,
      markdownOffset: boundary.markdownOffset + offset,
    })),
  }));
}

export function concatMarkdown(values: readonly MappedMarkdown[], separator = ''): MappedMarkdown {
  let markdown = '';
  const sources: MarkdownSourceSlice[] = [];
  const paragraphs: MarkdownSourceParagraph[] = [];
  for (const [index, value] of values.entries()) {
    if (index > 0) markdown += separator;
    for (const source of shiftedSources(value.sources, markdown.length)) sources.push(source);
    paragraphs.push(...(value.paragraphs ?? []));
    markdown += value.markdown;
  }
  return { markdown, sources, ...(paragraphs.length > 0 ? { paragraphs } : {}) };
}

export function wrapMarkdown(value: MappedMarkdown, prefix: string, suffix = ''): MappedMarkdown {
  return {
    markdown: prefix + value.markdown + suffix,
    sources: shiftedSources(value.sources, prefix.length),
    ...(value.paragraphs ? { paragraphs: value.paragraphs } : {}),
  };
}

/**
 * Apply a text transformation while retaining a map for every boundary in the input string.
 * `boundaryMap[n]` is the output offset immediately after consuming `n` input code units.
 */
export function transformMarkdown(
  value: MappedMarkdown,
  transform: (input: string) => {
    readonly markdown: string;
    readonly boundaryMap: readonly number[];
  }
): MappedMarkdown {
  const transformed = transform(value.markdown);
  if (transformed.boundaryMap.length !== value.markdown.length + 1) {
    throw new TypeError('Markdown transform returned an invalid boundary map');
  }
  return {
    markdown: transformed.markdown,
    sources: value.sources.map((source) => ({
      ...source,
      markdownStart: transformed.boundaryMap[source.markdownStart]!,
      markdownEnd: transformed.boundaryMap[source.markdownEnd]!,
      markdownBoundaries: source.markdownBoundaries?.map((boundary) => ({
        ...boundary,
        markdownOffset: transformed.boundaryMap[boundary.markdownOffset]!,
      })),
    })),
    ...(value.paragraphs ? { paragraphs: value.paragraphs } : {}),
  };
}

export function withSourceParagraphs(
  value: MappedMarkdown,
  paragraphs: readonly MarkdownSourceParagraph[]
): MappedMarkdown {
  if (paragraphs.length === 0) return value;
  return { ...value, paragraphs: Object.freeze([...paragraphs]) };
}

export function preserveLeadingWhitespace(value: MappedMarkdown): MappedMarkdown {
  const leadingLength = /^[ \t]+/.exec(value.markdown)?.[0].length ?? 0;
  if (leadingLength === 0) return value;
  return transformMarkdown(value, (input) => {
    let markdown = '';
    const boundaryMap = [0];
    for (let index = 0; index < input.length; index += 1) {
      markdown += index < leadingLength ? '\u00a0' : input[index]!;
      boundaryMap.push(markdown.length);
    }
    return { markdown, boundaryMap };
  });
}

export function escapeUnescapedTablePipes(value: MappedMarkdown): MappedMarkdown {
  return transformMarkdown(value, (input) => {
    let markdown = '';
    let precedingBackslashes = 0;
    const boundaryMap = [0];
    for (let index = 0; index < input.length; index += 1) {
      const character = input[index]!;
      if (character === '\\') {
        markdown += character;
        precedingBackslashes += 1;
      } else {
        if (character === '|' && precedingBackslashes % 2 === 0) markdown += '\\';
        markdown += character;
        precedingBackslashes = 0;
      }
      boundaryMap[index + 1] = markdown.length;
    }
    return { markdown, boundaryMap };
  });
}

export function replaceNewlinesWithHtmlBreaks(value: MappedMarkdown): MappedMarkdown {
  return transformMarkdown(value, (input) => {
    let markdown = '';
    const boundaryMap = [0];
    let index = 0;
    while (index < input.length) {
      if (input[index] !== '\n') {
        markdown += input[index]!;
        index += 1;
        boundaryMap[index] = markdown.length;
        continue;
      }
      const start = index;
      while (index < input.length && input[index] === '\n') index += 1;
      markdown += '<br>';
      for (let consumed = start + 1; consumed <= index; consumed += 1) {
        boundaryMap[consumed] = markdown.length;
      }
    }
    return { markdown, boundaryMap };
  });
}

export function indentContinuationLines(
  value: MappedMarkdown,
  indentation: string
): MappedMarkdown {
  return transformMarkdown(value, (input) => {
    let markdown = '';
    const boundaryMap = [0];
    for (let index = 0; index < input.length; index += 1) {
      const character = input[index]!;
      markdown += character;
      if (character === '\n') markdown += indentation;
      boundaryMap.push(markdown.length);
    }
    return { markdown, boundaryMap };
  });
}

export function quoteMarkdownLines(value: MappedMarkdown): MappedMarkdown {
  return transformMarkdown(value, (input) => {
    const prefixAt = (index: number): string =>
      index === input.length || input[index] === '\n' ? '>' : '> ';
    let markdown = prefixAt(0);
    const boundaryMap = [markdown.length];
    for (let index = 0; index < input.length; index += 1) {
      const character = input[index]!;
      markdown += character;
      if (character === '\n') markdown += prefixAt(index + 1);
      boundaryMap.push(markdown.length);
    }
    return { markdown, boundaryMap };
  });
}
