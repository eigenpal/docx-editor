// Break analysis for a paragraph that holds dictionary-script text (Thai, Lao, Khmer,
// Myanmar) and no East Asian text.
//
// It is the ordinary analysis with the dictionary cuts added. A seam opens a line when
// `lineOpenDecisionAt` says so or when a cut falls on it, so fields, pictures, equations,
// punctuation, no-break spaces, and combining marks at seams keep the rules a Latin
// paragraph uses. Boundaries inside a piece come from `PieceDictionaryCuts.boundaries`,
// the same ones table AutoFit reads.

import { cjkChopCutAllowedAt, lineOpenDecisionAt } from './cjk-line-break.ts';
import type { CjkParagraphBreaks } from './cjk-paragraph-breaks.ts';
import type { PieceDictionaryCuts } from './dictionary-piece-cuts.ts';
import { breakAfterSignScript, isDictionaryWordBreakSupported } from './dictionary-word-breaks.ts';

function breaksAfterSign(lastEmitted: string, candidate: string): boolean {
  const before = lastEmitted.charCodeAt(lastEmitted.length - 1);
  const after = candidate.charCodeAt(0);
  return (
    breakAfterSignScript(before) !== null &&
    isDictionaryWordBreakSupported(breakAfterSignScript(before)!) &&
    after !== 0x20 &&
    after !== 0x200b &&
    breakAfterSignScript(after) === null
  );
}

export function dictionaryParagraphBreaks(cuts: PieceDictionaryCuts): CjkParagraphBreaks {
  return {
    boundaries: (piece) => cuts.boundaries(piece),
    decision(piece, offset, lastEmitted, candidate) {
      if (offset === 0 && cuts.startsAtCut(piece)) return 'opens';
      // A sentence mark that ends a field result breaks after itself, as a dash there does.
      if (offset === 0 && breaksAfterSign(lastEmitted, candidate)) return 'opens';
      return lineOpenDecisionAt(lastEmitted, candidate, offset > 0);
    },
    cutAllowed(piece, candidateStart, index) {
      // The chop asks about one candidate: from its start to the next boundary.
      const end = cuts.boundaries(piece).find((boundary) => boundary > candidateStart);
      return cjkChopCutAllowedAt(piece.text.slice(candidateStart, end), index);
    },
  };
}
