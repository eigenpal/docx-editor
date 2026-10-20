// A run font reference is one bounded name, never a CSS fallback list.
const FONT_FAMILY_NAME = /^[\p{L}\p{N}\p{M} \-.+_,;]{1,64}$/u;

/** Preserve the complete name while rejecting CSS-breaking characters. */
export function fontFamilyName(raw: string | undefined): string | null {
  return raw !== undefined && raw.trim().length > 0 && FONT_FAMILY_NAME.test(raw) ? raw : null;
}
