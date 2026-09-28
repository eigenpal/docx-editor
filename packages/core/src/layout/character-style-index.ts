// One bounded body walk per immutable revision; page resolution reuses these occurrences.
import type { OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { piecesOfParagraph } from './field-projection.ts';
import { MAX_STORY_FIELD_SCAN_DEPTH } from './field-instruction.ts';
import {
  cascadeRunProperties,
  cascadeParagraphFormatting,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { styleIdFromProps } from './style-chain.ts';
import { paragraphFragmentsOf } from './semantic-record-queries.ts';
import { lineSegments } from './line-segments.ts';
import type { SemanticLayout } from './semantic-records.ts';
import type { SemanticLayoutOptions } from './semantic-layout-options.ts';
import type { CharacterStyleField } from './field-character-style.ts';

const MAX_CHARACTER_STYLE_SCAN_NODES = 200_000;

interface Occurrence {
  readonly paragraphId: string;
  readonly start: number;
  end: number;
  text: string | null;
  readonly style: string;
}
export interface CharacterStyleIndex {
  readonly byParagraph: ReadonlyMap<string, readonly Occurrence[]>;
  readonly styles: StyleCascadeTable;
}
const indexes = new WeakMap<
  OoxmlPart,
  { styles: StyleCascadeTable; mode: unknown; author: unknown; index: CharacterStyleIndex }
>();
export function characterStyleIndex(
  part: OoxmlPart,
  options: SemanticLayoutOptions
): CharacterStyleIndex | undefined {
  const styles = options.styleCascade;
  if (!styles) return undefined;
  const cached = indexes.get(part);
  if (
    cached?.styles === styles &&
    cached.mode === options.displayMode &&
    cached.author === options.revisionAuthorFilter
  )
    return cached.index;
  const byParagraph = new Map<string, Occurrence[]>();
  let count = 0;
  const visit = (node: OoxmlNode, depth: number): void => {
    if (++count > MAX_CHARACTER_STYLE_SCAN_NODES || depth > MAX_STORY_FIELD_SCAN_DEPTH)
      throw new Error('character-style body index exceeds its scan bound');
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      const inherited = cascadeParagraphFormatting(
        styles,
        node.children.find((child) => child.kind === 'paragraphProperties')
      ).runProperties;
      const pieces = piecesOfParagraph(
        node,
        inherited,
        undefined,
        (base, direct) => cascadeRunProperties(base, direct, styles),
        undefined,
        undefined,
        options.displayMode,
        undefined,
        undefined,
        styles.themeFonts,
        undefined,
        undefined,
        false,
        undefined,
        options.revisionAuthorFilter
      );
      const found: Occurrence[] = [];
      let previous: Occurrence | undefined;
      for (const piece of pieces) {
        const style = styleIdFromProps(piece.props, 'rStyle');
        if (
          !style ||
          styles.styles.get(style)?.type !== 'character' ||
          piece.projected ||
          piece.inlineDrawing ||
          piece.equation ||
          !piece.text
        ) {
          previous = undefined;
          continue;
        }
        if (previous?.style === style && previous.end === piece.start) {
          previous.text =
            previous.text !== null && previous.text.length + piece.text.length <= 4096
              ? previous.text + piece.text
              : null;
          previous.end = piece.end;
        } else {
          previous = {
            paragraphId: node.id,
            start: piece.start,
            end: piece.end,
            text: piece.text.length <= 4096 ? piece.text : null,
            style,
          };
          found.push(previous);
        }
      }
      if (found.length) byParagraph.set(node.id, found);
      return;
    }
    for (const child of node.children) {
      visit(child, depth + 1);
    }
  };
  visit(part.root, 0);
  const index = { byParagraph, styles };
  indexes.set(part, {
    styles,
    mode: options.displayMode,
    author: options.revisionAuthorFilter,
    index,
  });
  return index;
}

/** Page arrays retain document order. Lookup costs depend on occurrences, not body node count. */
export function characterStylePageValues(
  index: CharacterStyleIndex,
  layout: SemanticLayout,
  queries: readonly CharacterStyleField[]
): readonly ReadonlyMap<string, string>[] {
  const locations = new Map<Occurrence, { first: number; last: number }>();
  for (const [page, record] of layout.pages.entries()) {
    for (const fragment of paragraphFragmentsOf(record)) {
      if (fragment.positionedFrame || fragment.outOfFlow) continue;
      // Joined display fragments retain several source paragraphs. Aggregate their
      // page-local ranges before testing occurrences, so wrapping adds no repeated scan.
      const ranges = new Map<string, { start: number; end: number }>();
      for (const line of fragment.lines) {
        for (const segment of lineSegments(line)) {
          const range = ranges.get(segment.paragraphId);
          if (range) {
            range.start = Math.min(range.start, segment.start);
            range.end = Math.max(range.end, segment.end);
          } else ranges.set(segment.paragraphId, { start: segment.start, end: segment.end });
        }
      }
      for (const [paragraphId, range] of ranges) {
        for (const occurrence of index.byParagraph.get(paragraphId) ?? []) {
          if (occurrence.end <= range.start || occurrence.start >= range.end) continue;
          const previous = locations.get(occurrence);
          if (previous) previous.last = page;
          else locations.set(occurrence, { first: page, last: page });
        }
      }
    }
  }
  const result = layout.pages.map(() => new Map<string, string>());
  for (const query of queries) {
    const style = [...index.styles.styles.values()].find(
      (s) => s.type === 'character' && s.name?.toLowerCase() === query.name
    );
    if (!style) continue;
    // Equal-page occurrences follow canonical source order, not visual bidi order.
    const occurrences: [Occurrence, { first: number; last: number }][] = [];
    for (const paragraph of index.byParagraph.values()) {
      for (const occurrence of paragraph) {
        const location = locations.get(occurrence);
        if (location && occurrence.style === style.styleId)
          occurrences.push([occurrence, location]);
      }
    }
    const starts = occurrences
      .map((_, order) => order)
      .sort((a, b) => occurrences[a]![1].first - occurrences[b]![1].first || a - b);
    const ends = starts
      .slice()
      .sort((a, b) => occurrences[a]![1].last - occurrences[b]![1].last || a - b);
    const active: number[] = [];
    const before = query.last ? (a: number, b: number) => a > b : (a: number, b: number) => a < b;
    let start = 0,
      end = 0,
      previous = -1;
    for (let page = 0; page < result.length; page += 1) {
      while (start < starts.length && occurrences[starts[start]!]![1].first <= page)
        pushOccurrence(active, starts[start++]!, before);
      while (end < ends.length && occurrences[ends[end]!]![1].last < page)
        previous = Math.max(previous, ends[end++]!);
      while (active.length && occurrences[active[0]!]![1].last < page)
        popOccurrence(active, before);
      const selected = active[0] ?? (previous >= 0 ? previous : starts[start]);
      const text = selected === undefined ? undefined : occurrences[selected]![0].text;
      if (text != null) result[page]!.set(query.key, text);
    }
  }
  return result;
}

/** Source-order priority with lazy expiry keeps page lookup bounded by occurrence count. */
function pushOccurrence(
  heap: number[],
  value: number,
  before: (a: number, b: number) => boolean
): void {
  let at = heap.length;
  heap.push(value);
  while (at > 0) {
    const parent = Math.floor((at - 1) / 2);
    if (!before(value, heap[parent]!)) break;
    heap[at] = heap[parent]!;
    at = parent;
  }
  heap[at] = value;
}
function popOccurrence(heap: number[], before: (a: number, b: number) => boolean): void {
  const last = heap.pop()!;
  if (!heap.length) return;
  let at = 0;
  while (at * 2 + 1 < heap.length) {
    let child = at * 2 + 1;
    if (child + 1 < heap.length && before(heap[child + 1]!, heap[child]!)) child++;
    if (!before(heap[child]!, last)) break;
    heap[at] = heap[child]!;
    at = child;
  }
  heap[at] = last;
}
