// Grapheme-safe chopping for an unbroken word that is wider than the line measure.

import { segmentGraphemes } from './grapheme.ts';

export interface OversizedWordPrefix {
  readonly text: string;
  readonly modelStart: number;
  readonly width: number;
}

export interface OversizedWordRemainder extends OversizedWordPrefix {
  /** Whether chopping closed at least one line, so the caller can preserve word state. */
  readonly brokeLine: boolean;
}

/**
 * Fill and close lines with the longest grapheme-safe prefix of an oversized word.
 *
 * The callbacks keep paragraph-owned geometry and span construction outside this focused
 * algorithm. Their values are read again after every close because floats can change the next
 * line's measure. At least one grapheme remains for ordinary placement; if one grapheme alone
 * is wider than an empty line, it is the indivisible unit that is allowed to overflow.
 */
export function chopOversizedWord(
  text: string,
  modelStart: number,
  width: number,
  options: {
    readonly remainingLineWidth: () => number;
    readonly lineHasText: () => boolean;
    readonly measureText: (text: string) => number;
    readonly appendPrefix: (prefix: OversizedWordPrefix) => void;
    readonly closeLine: () => void;
    readonly overflowTolerancePt: number;
  }
): OversizedWordRemainder {
  if (width <= options.remainingLineWidth() + options.overflowTolerancePt) {
    return { text, modelStart, width, brokeLine: false };
  }
  const graphemes = segmentGraphemes(text);
  let graphemeFrom = 0;
  let utf16From = 0;
  let remainingWidth = width;
  let brokeLine = false;

  while (
    graphemeFrom < graphemes.length &&
    remainingWidth > options.remainingLineWidth() + options.overflowTolerancePt
  ) {
    const graphemesLeft = graphemes.length - graphemeFrom;
    if (graphemesLeft === 1) {
      if (options.lineHasText()) {
        options.closeLine();
        brokeLine = true;
        continue;
      }
      break;
    }

    const available = options.remainingLineWidth();
    let low = graphemeFrom + 1;
    // Leave at least one whole grapheme for ordinary placement after the final chopped line.
    let high = graphemes.length - 1;
    let fitTo = graphemeFrom;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const utf16To = graphemes[mid - 1]!.utf16To;
      const prefixWidth = options.measureText(text.slice(utf16From, utf16To));
      if (prefixWidth <= available + options.overflowTolerancePt) {
        fitTo = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (fitTo === graphemeFrom && options.lineHasText()) {
      options.closeLine();
      brokeLine = true;
      continue;
    }
    // An empty line that cannot fit one grapheme must overflow by that whole grapheme, never
    // by one UTF-16 code unit (which could split a surrogate pair or combining sequence).
    if (fitTo === graphemeFrom) fitTo += 1;

    const utf16To = graphemes[fitTo - 1]!.utf16To;
    const prefixText = text.slice(utf16From, utf16To);
    options.appendPrefix({
      text: prefixText,
      modelStart: modelStart + utf16From,
      width: options.measureText(prefixText),
    });
    options.closeLine();
    brokeLine = true;
    graphemeFrom = fitTo;
    utf16From = utf16To;
    remainingWidth = options.measureText(text.slice(utf16From));
  }

  return {
    text: text.slice(utf16From),
    modelStart: modelStart + utf16From,
    width: remainingWidth,
    brokeLine,
  };
}
