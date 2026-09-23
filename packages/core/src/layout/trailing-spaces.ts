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
