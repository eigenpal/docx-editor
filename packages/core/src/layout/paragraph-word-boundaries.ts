// Break points inside a paragraph piece (DOM-free).
//
// Spaces, tabs, and dashes always wrap. Template marks `.[]{}='` wrap only when
// document auto-hyphenation is on. U+2011 never wraps. Model text stays unchanged.

const LETTER = /^\p{L}$/u;

/**
 * Dashes a line may break AFTER, the way Word wraps "ALPHA-PRIME" as "ALPHA-" / "PRIME":
 * hyphen-minus, hyphen, en dash, em dash. U+2011 is absent — it means "no wrap here".
 */
const BREAK_AFTER_DASH = new Set(['-', '‐', '–', '—']);

/** Template tokens may wrap after these marks when an interior letter hyphen does not. */
const BREAK_AFTER_PUNCT = new Set(['.', '[', ']', '{', '}', '=', "'"]);

function isLetter(char: string | undefined): boolean {
  return char !== undefined && LETTER.test(char);
}

function isDashBreak(text: string, index: number): boolean {
  const ch = text[index]!;
  return (
    BREAK_AFTER_DASH.has(ch) &&
    index > 0 &&
    text[index - 1] !== ' ' &&
    index + 1 < text.length &&
    text[index + 1] !== ' ' &&
    !BREAK_AFTER_DASH.has(text[index + 1]!)
  );
}

function isPunctBreak(text: string, index: number, enabled: boolean): boolean {
  if (!enabled) return false;
  const ch = text[index]!;
  if (!BREAK_AFTER_PUNCT.has(ch)) return false;
  if (index + 1 < text.length && text[index + 1] === ' ') return false;
  if (ch === "'" && isLetter(text[index - 1]) && isLetter(text[index + 1])) return false;
  return true;
}

/**
 * Break offsets after each space run, after a dash between non-space text, and with each
 * tab as its own atom so tab-stop geometry can size `\t`.
 *
 * When `templatePunct` is true, a line may also wrap after `.`, `[`, `]`, `{`, `}`, `=`,
 * and `'` that is not between letters. A dash run breaks only after its LAST dash.
 */
export function wordBoundaries(text: string, templatePunct = false): number[] {
  const boundaries: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]!;
    if (ch === '\t') {
      if (index > 0 && boundaries[boundaries.length - 1] !== index) boundaries.push(index);
      boundaries.push(index + 1);
    } else if (ch === ' ') {
      boundaries.push(index + 1);
    } else if (isDashBreak(text, index) || isPunctBreak(text, index, templatePunct)) {
      boundaries.push(index + 1);
    }
  }
  if (boundaries[boundaries.length - 1] !== text.length) boundaries.push(text.length);
  return boundaries;
}

/**
 * Whether the first candidate of a piece may open a line after `lastEmitted`.
 *
 * A dash always stays a break across run boundaries. A template mark does so only when
 * `templatePunct` is true. An ASCII apostrophe between letters does not.
 */
export function opensWordAfter(
  lastEmitted: string,
  candidate: string,
  templatePunct = false
): boolean {
  if (lastEmitted.length === 0) return true;
  if (/[\s\u00a0]$/.test(lastEmitted) || /^[\s\u00a0]/.test(candidate)) return true;
  const last = lastEmitted[lastEmitted.length - 1]!;
  const first = candidate[0];
  if (first !== undefined && BREAK_AFTER_DASH.has(last) && !BREAK_AFTER_DASH.has(first)) {
    return true;
  }
  if (!templatePunct || !BREAK_AFTER_PUNCT.has(last)) return false;
  if (first === ' ') return false;
  if (last === "'") {
    const prev = lastEmitted.length >= 2 ? lastEmitted[lastEmitted.length - 2] : undefined;
    if (isLetter(prev) && isLetter(first)) return false;
  }
  return true;
}
