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
      for (const occurrence of index.byParagraph.get(fragment.paragraphId) ?? []) {
        if (occurrence.end <= fragment.range.start || occurrence.start >= fragment.range.end)
          continue;
        const previous = locations.get(occurrence);
        if (previous) previous.last = page;
        else locations.set(occurrence, { first: page, last: page });
      }
    }
  }
  const result = layout.pages.map(() => new Map<string, string>());
  for (const query of queries) {
    const style = [...index.styles.styles.values()].find(
      (s) => s.type === 'character' && s.name?.toLowerCase() === query.name
    );
    if (!style) continue;
    const occurrences = [...locations]
      .filter(([o]) => o.style === style.styleId)
      .sort((a, b) => a[1].first - b[1].first);
    let cursor = 0;
    let previous: Occurrence | undefined;
    for (let page = 0; page < result.length; page += 1) {
      while (cursor < occurrences.length && occurrences[cursor]![1].last < page) {
        previous = occurrences[cursor]![0];
        cursor += 1;
      }
      let selected = occurrences[cursor];
      if (selected && selected[1].first <= page) {
        if (query.last) {
          let last = cursor;
          while (last + 1 < occurrences.length && occurrences[last + 1]![1].first <= page)
            last += 1;
          selected = occurrences[last];
        }
        if (selected![0].text !== null) result[page]!.set(query.key, selected![0].text);
      } else {
        const fallback = previous ?? selected?.[0];
        if (fallback?.text != null) result[page]!.set(query.key, fallback.text);
      }
    }
  }
  return result;
}
