const WORD_REGEX = /^[\p{L}][\p{L}'\-]*$/u;

export function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

export function isCheckableWord(word: string): boolean {
  const normalized = normalizeWord(word);
  if (!normalized) return false;
  if (/\d/.test(normalized)) return false;
  return WORD_REGEX.test(normalized);
}
