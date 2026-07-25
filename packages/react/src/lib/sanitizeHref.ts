/**
 * Allowlist URL schemes on hrefs that originate from untrusted input
 * (DOCX relationship targets, pasted HTML). Fragments and relative paths
 * pass through; anything with a scheme outside the allowlist is dropped.
 */

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ALLOWED_SCHEME = /^(https?|mailto|tel|ftp):/i;

export function sanitizeHref(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  // Mirror WHATWG URL preprocessing before matching the scheme: strip
  // tab/LF/CR everywhere, then leading C0-control/space. Browsers do this
  // before resolving the scheme, so `java\tscript:` would otherwise slip
  // past HAS_SCHEME as "schemeless".
  const probe = href.replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+/, '');
  if (!probe) return undefined;
  if (!HAS_SCHEME.test(probe)) return href;
  return ALLOWED_SCHEME.test(probe) ? href : undefined;
}
