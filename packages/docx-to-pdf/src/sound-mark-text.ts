/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

// The logical text of a line's spans with each kana and the combining sound mark (U+3099 or
// U+309A) that its face joins with it composed into the precomposed character, `か` + U+3099
// into `が`. A joined pair is one glyph, so search and copy find the character a reader typed,
// and each ActualText region keeps one character per painted glyph. A pair the face draws as
// two glyphs, a base and a mark in a cell or a zero-width mark of its own, keeps its own
// characters.

const PAIR = /^[\u3041-\u30ff][\u3099\u309a]$/u;
const LEADING_MARK = /^[\u3099\u309a]/u;

/** The precomposed form of a kana and sound mark pair, or undefined when it has none. */
function composedPair(pair: string): string | undefined {
  if (!PAIR.test(pair)) return undefined;
  const composed = pair.normalize('NFC');
  return composed.length === 1 ? composed : undefined;
}

/** The precomposed form of `text` when it is a kana and sound mark pair that has one, else `text`. */
export function composedPairOr(text: string): string {
  return composedPair(text) ?? text;
}

/** The shaped clusters of a span, as the PDF text writer draws them. */
export interface ShapedClusters {
  readonly text: string;
  readonly clusters: readonly {
    readonly textStart: number;
    readonly textEnd: number;
    readonly glyphStart: number;
    readonly glyphEnd: number;
  }[];
}

/**
 * `text` with each kana and sound mark pair that `run` draws as one glyph composed. `text` is
 * returned as it is when it is not the text `run` shaped.
 */
export function composeJoinedPairs(text: string, run: ShapedClusters | undefined): string {
  if (!run || run.text !== text || !/[\u3099\u309a]/u.test(text)) return text;
  let out = '';
  let from = 0;
  for (const cluster of [...run.clusters].sort((a, b) => a.textStart - b.textStart)) {
    if (cluster.glyphEnd - cluster.glyphStart !== 1) continue;
    const composed = composedPair(text.slice(cluster.textStart, cluster.textEnd));
    if (composed === undefined || cluster.textStart < from) continue;
    out += text.slice(from, cluster.textStart) + composed;
    from = cluster.textEnd;
  }
  return out + text.slice(from);
}

/**
 * The logical text of each span of one line, in reading order. A span that opens with a sound
 * mark gives the mark to the kana that closes the previous span when `joinsPrevious(index)` says
 * the mark draws over that base, with no advance of its own. Only the ActualText changes: the
 * base glyph keeps the base kana as its own text, so a reader that ignores ActualText reads the
 * kana and the mark, never the mark twice. `absorbed` marks the spans whose whole text went to
 * their neighbor: their glyphs need a region with no text, or an extractor reads the mark a
 * second time from the glyph itself.
 */
export function composeSoundMarks(
  texts: readonly string[],
  joinsPrevious: (index: number) => boolean
): { readonly texts: readonly string[]; readonly absorbed: ReadonlySet<number> } {
  const out = [...texts];
  const absorbed = new Set<number>();
  for (let index = 1; index < out.length; index++) {
    const text = out[index]!;
    const previous = out[index - 1]!;
    if (!LEADING_MARK.test(text) || previous === '' || !joinsPrevious(index)) continue;
    const composed = composedPair(previous.slice(-1) + text[0]!);
    if (composed === undefined) continue;
    out[index - 1] = previous.slice(0, -1) + composed;
    out[index] = text.slice(1);
    if (out[index] === '') absorbed.add(index);
  }
  return { texts: out, absorbed };
}
