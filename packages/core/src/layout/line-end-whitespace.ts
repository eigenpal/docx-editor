/** Spaces Word may hang/clip at a line end instead of wrapping onto a new line. */
export function isCollapsibleLineEndWhitespace(text: string): boolean {
  if (text.length === 0) return false;
  for (const char of text) {
    if (char !== ' ' && char !== '\u3000') return false;
  }
  return true;
}
