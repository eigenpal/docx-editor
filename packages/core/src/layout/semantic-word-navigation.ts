/** Word characters for motion purposes: letters, digits and the marks that join them. */
const WORD_CHARACTER = /[\p{L}\p{N}_'\u2019]/u;

/**
 * The next word boundary from `offset`, in `direction`.
 *
 * Word-LEFT skips any whitespace immediately behind the caret and then the word behind that,
 * which makes repeated presses walk words rather than alternate with the preceding space.
 */
export function wordBoundary(text: string, offset: number, direction: -1 | 1): number {
  const isWord = (index: number): boolean => {
    const character = text[index];
    return character !== undefined && WORD_CHARACTER.test(character);
  };
  let index = Math.max(0, Math.min(offset, text.length));
  if (direction === -1) {
    while (index > 0 && !isWord(index - 1)) index -= 1;
    while (index > 0 && isWord(index - 1)) index -= 1;
    return index;
  }
  while (index < text.length && !isWord(index)) index += 1;
  while (index < text.length && isWord(index)) index += 1;
  return index;
}
