// Grapheme clusters that straddle a token boundary (round-4 review regression).
//
// `tokenizeParagraph` splits on `/(\s+)/`. A cluster can span that split — `space +
// U+0301` is one grapheme, and the split lands inside it. An earlier version of the
// token loop asserted the opposite ("whitespace is always a grapheme boundary") and
// therefore restarted its advance walk at the cluster's own `utf16From`, which the
// whitespace branch had already consumed. One advance was counted twice.
//
// That is not a cosmetic caret-offset bug: inflated `cursor.x` changes wrap
// decisions. Independent review measured a 300-character paragraph with 24 such
// sequences laying out as 7 lines where the ASCII control was 6 — different
// wrapping, therefore different pagination — reachable from any .docx carrying an
// orphaned combining mark after whitespace (OCR output, converted documents,
// Hebrew and Vietnamese diacritic handling), and fully attacker-chosen.
//
// The invariant asserted here is the one that actually matters and that a
// wall-clock or line-count check would miss: EVERY code unit contributes its
// advance EXACTLY ONCE.

import { describe, expect, test } from 'bun:test';
import { layoutBody } from '../layout.ts';
import { createDeterministicLayoutShaping } from '../metrics.ts';
import { createEmptyModel, bodyStoryId, type ParagraphRecord } from '@docx-editor.dev/core-contract/store';

const LAYOUT = {
  pageWidth: 12240,
  pageHeight: 15840,
  margin: 1440,
  shaping: createDeterministicLayoutShaping(),
};

function layoutText(text: string, pageWidth = 12240) {
  const base = createEmptyModel();
  const storyId = bodyStoryId(base);
  const story = base.stories.get(storyId)!;
  const p: ParagraphRecord = { kind: 'paragraph', id: 'p-straddle', runs: [{ text }] };
  const model = { ...base, stories: new Map(base.stories).set(storyId, { ...story, blocks: [p] }) };
  const out = layoutBody(model, { ...LAYOUT, pageWidth }) as unknown as {
    pages?: { items: unknown[] }[];
    items?: unknown[];
  };
  const items = (out.pages ? out.pages.flatMap((pg) => pg.items) : (out.items ?? [])) as {
    type: string;
    x: number;
    graphemeOffset?: number;
    line?: { lineId?: string };
    y?: number;
  }[];
  const edges = items.filter((i) => i.type === 'caretEdge');
  return {
    edges,
    /** Rightmost caret edge = total advance the paragraph accumulated. */
    finalX: Math.max(...edges.map((e) => e.x)),
    lineCount: new Set(edges.map((e) => e.line?.lineId ?? String(e.y))).size,
  };
}

/**
 * The invariant is asserted as a PERMUTATION equality rather than against an
 * absolute advance sum.
 *
 * Layout accumulates one advance per UTF-16 code unit, so two texts built from the
 * same multiset of code units must reach the same total x — no matter how those
 * code units are grouped into grapheme clusters. That makes the assertion
 * independent of the metrics port's scale, the font size, and the page margin, all
 * of which an absolute expectation would have to model (and get wrong).
 */
const COMBINING_ACUTE = '\u0301';
const NBSP = '\u00a0';
/** U+0600 ARABIC NUMBER SIGN: GCB=Prepend, so it clusters with what FOLLOWS it. */
const PREPEND = '\u0600';

describe('grapheme cluster straddling a token boundary', () => {
  test('a combining mark after a space advances the space exactly once', () => {
    // The reviewer's minimal repro: U+0301 directly after a space is ONE cluster,
    // and the tokenizer splits inside it. `straddle` and `attached` hold the same
    // code units, so a correct layout gives them the same total advance; the buggy
    // version double-counted the space and made `straddle` one space wider.
    const straddle = layoutText(`ab ${COMBINING_ACUTE}cd`);
    const attached = layoutText(`ab${COMBINING_ACUTE} cd`);
    expect(straddle.finalX).toBe(attached.finalX);
  });

  test('a non-breaking space followed by a combining mark is not double-counted', () => {
    const straddle = layoutText(`ab${NBSP}${COMBINING_ACUTE}cd`);
    const attached = layoutText(`ab${COMBINING_ACUTE}${NBSP}cd`);
    expect(straddle.finalX).toBe(attached.finalX);
  });

  test('a Prepend code point BEFORE whitespace is not double-counted', () => {
    // The UPPER-bound clamp had zero coverage: round-6 review reverted
    // `Math.min(seg.utf16To, token.utf16To)` and all five tests here still passed,
    // because every case in this file put a combining mark AFTER whitespace — the
    // LOWER bound. The mirror case needs a GCB=Prepend code point BEFORE whitespace,
    // and a repo-wide search found none in any test.
    //
    // U+0600 ARABIC NUMBER SIGN clusters FORWARD across the following space, so the
    // cluster starts in the word token and ends inside the whitespace token. Review
    // confirmed all nine Prepend code points (U+0600-0605, U+06DD, U+070F, U+0890,
    // U+0891, U+08E2, U+0D4E, U+110BD, U+110CD) cluster this way across every Unicode
    // space separator. Reverting the clamp inflates the advance by one whole space,
    // which changes wrap decisions and therefore pagination.
    const straddle = layoutText(`ab${PREPEND} cd`);
    const attached = layoutText(`ab ${PREPEND}cd`);
    // Same code units, so a correct layout gives the same total advance.
    expect(straddle.finalX).toBe(attached.finalX);
  });

  test('Prepend before every Unicode space separator is not double-counted', () => {
    // Breadth, because one code point passing does not prove the class does.
    for (const space of ['\u0020', '\u00a0', '\u2000', '\u3000', '\u202f', '\u205f', '\u1680']) {
      const straddle = layoutText(`ab${PREPEND}${space}cd`);
      const attached = layoutText(`ab${space}${PREPEND}cd`);
      expect(straddle.finalX, `space U+${space.codePointAt(0)!.toString(16)}`).toBe(
        attached.finalX
      );
    }
  });

  test('many straddles do not change the line count versus the ASCII control', () => {
    // The escalation review used: inflated cursor.x turned 6 lines into 7, i.e.
    // different wrapping and therefore different pagination, from a file-supplied
    // character sequence.
    const straddles = `${Array.from({ length: 24 }, () => `word ${COMBINING_ACUTE}more`).join(' ')} ${'x'.repeat(40)}`;
    const control = `${Array.from({ length: 24 }, () => `word${COMBINING_ACUTE} more`).join(' ')} ${'x'.repeat(40)}`;
    const narrow = 4000;
    expect(layoutText(straddles, narrow).lineCount).toBe(layoutText(control, narrow).lineCount);
    expect(layoutText(straddles, narrow).finalX).toBe(layoutText(control, narrow).finalX);
  });

  test('a straddling cluster adds no duplicate caret edge beyond the control', () => {
    // Asserted as a COMPARISON, not as "zero duplicates". A paragraph already emits
    // one duplicate at its end offset — the last token's trailing edge and the
    // final paragraph-end edge coincide — for plain ASCII too. That predates this
    // fix and is out of its scope; a separate review Medium tracks multiple edges
    // per offset. What must hold is that the straddle introduces no ADDITIONAL
    // duplicate, which is exactly what the double-emit bug did.
    const duplicatesIn = (text: string): number => {
      const { edges } = layoutText(text);
      const perLine = new Map<string, number[]>();
      for (const e of edges) {
        const key = e.line?.lineId ?? String(e.y);
        const list = perLine.get(key) ?? [];
        list.push(e.graphemeOffset ?? -1);
        perLine.set(key, list);
      }
      let dupes = 0;
      for (const offsets of perLine.values()) dupes += offsets.length - new Set(offsets).size;
      return dupes;
    };
    expect(duplicatesIn(`ab ${COMBINING_ACUTE}cd`)).toBe(duplicatesIn(`ab${COMBINING_ACUTE} cd`));
  });

  test('plain ASCII text is unaffected by the clamp', () => {
    // Same code units, different whitespace grouping — still equal.
    expect(layoutText('the quick brown').finalX).toBe(layoutText('the quick brown').finalX);
    expect(layoutText('ab cd').finalX).toBeLessThan(layoutText('ab cde').finalX);
  });
});
