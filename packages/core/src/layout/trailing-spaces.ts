/**
 * `text` without its trailing U+0020 spaces.
 *
 * A backward scan, not `/ +$/`: a backtracking engine retries that pattern from every
 * space of a run that does not reach the end, so run text with a long inner space run
 * costs quadratic time on every layout pass.
 */
export function withoutTrailingSpaces(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 0x20) end -= 1;
  return text.slice(0, end);
}

/**
 * `text` without the whitespace that hangs at a line end: the trailing run of U+0020 spaces
 * and zero-width spaces, from its first U+0020 on. A zero-width space glues to the space
 * before it (no break between them), so `word` + space + U+200B hangs as one space would;
 * zero-width spaces with no space before them stay. One backward scan, linear in the run.
 */
export function withoutLineEndWhitespace(text: string): string {
  let start = text.length;
  while (start > 0) {
    const unit = text.charCodeAt(start - 1);
    if (unit !== 0x20 && unit !== 0x200b) break;
    start -= 1;
  }
  const firstSpace = text.indexOf(' ', start);
  return firstSpace < 0 ? text : text.slice(0, firstSpace);
}
