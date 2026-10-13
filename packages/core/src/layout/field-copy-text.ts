// Field results for the plain-text clipboard flavour.
//
// A computed field paints its whole result over one model unit, and the paragraph text keeps
// that unit one character wide so offsets stay aligned with the model. A copy needs the
// painted result instead: the text marks each such unit with U+FFFC, and the selection's
// atom speller replaces the mark with the result after the text is sliced by model offsets.

import { lineSegmentFor } from './line-segments.ts';
import { paragraphLinesFor } from './paragraph-lines.ts';
import { paragraphFragmentsOfBlocks } from './semantic-records.ts';
import type { SemanticLayout } from './semantic-records.ts';

const ATOM = '\uFFFC';

/**
 * The painted result of each one-unit field in a paragraph, keyed by its model offset.
 *
 * A result that wraps paints as several spans over the same unit, one on each line, so the
 * spans of one unit join in line order. A result of one character needs no entry: the
 * paragraph text already spells it.
 */
export function fieldResultTexts(
  layout: SemanticLayout,
  paragraphId: string
): ReadonlyMap<number, string> {
  const results = new Map<number, string>();
  const lines = new Set<object>();
  const placed = paragraphLinesFor(layout, paragraphId);
  const first = placed[0];
  const page = first && layout.pages.find((page) => page.index === first.pageIndex);
  // Page fields give each occurrence of shared furniture its own line objects. Read the
  // first occurrence, as the base paragraph text does, rather than joining every page.
  const furniture =
    first &&
    [page?.header, page?.footer].some((story) =>
      story
        ? paragraphFragmentsOfBlocks(story.fragments).some((fragment) =>
            fragment.lines.includes(first.line)
          )
        : false
    );
  for (const { line, pageIndex } of placed) {
    if (furniture && pageIndex !== first.pageIndex) continue;
    if (lines.has(line)) continue;
    lines.add(line);
    for (const span of lineSegmentFor(line, paragraphId)?.spans ?? []) {
      if (!span.fieldAtom && !span.projected) continue;
      if (span.range.end - span.range.start !== 1) continue;
      results.set(span.range.start, (results.get(span.range.start) ?? '') + span.text);
    }
  }
  for (const [offset, text] of results) if (text.length <= 1) results.delete(offset);
  return results;
}

type ParagraphText = (layout: SemanticLayout, paragraphId: string) => string;

/** The readers one copy of `layout` needs to spell its field results. */
export interface FieldResultSpeller {
  /** The base text, with each spelled field unit marked as U+FFFC, to slice by model offsets. */
  readonly markedText: ParagraphText;
  /** The result at a marked unit, or null when no field sits there. */
  readonly resultAt: (paragraphId: string, offset: number) => string | null;
  /** The base text, with each field result spelled in full, for whole-paragraph reads. */
  readonly spelledText: ParagraphText;
}

export function fieldResultSpeller(
  layout: SemanticLayout,
  base: ParagraphText
): FieldResultSpeller {
  const known = new Map<string, ReadonlyMap<number, string>>();
  const resultsOf = (paragraphId: string) => {
    let results = known.get(paragraphId);
    if (!results) known.set(paragraphId, (results = fieldResultTexts(layout, paragraphId)));
    return results;
  };
  const marked = (paragraphId: string): string[] => {
    const units = base(layout, paragraphId).split('');
    for (const offset of resultsOf(paragraphId).keys())
      if (offset < units.length) units[offset] = ATOM;
    return units;
  };
  return {
    markedText: (_layout, paragraphId) => marked(paragraphId).join(''),
    resultAt: (paragraphId, offset) => resultsOf(paragraphId).get(offset) ?? null,
    spelledText: (_layout, paragraphId) => {
      const results = resultsOf(paragraphId);
      return marked(paragraphId)
        .map((unit, offset) => (unit === ATOM ? (results.get(offset) ?? unit) : unit))
        .join('');
    },
  };
}
