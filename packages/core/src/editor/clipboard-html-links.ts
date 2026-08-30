import { sanitizeHref } from '../store/package/sinks.ts';

/**
 * A name Word can store in `w:bookmarkStart` and `w:anchor`. Web anchor names
 * ('section-2', 'user.content') MANGLE deterministically instead of dropping, so
 * an internal link and its target — mangled the same way in one paste — still pair.
 */
export function clipboardBookmarkName(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 256) return null;
  if (/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(trimmed)) return trimmed;
  const mangled = trimmed.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
  if (mangled.replace(/_/g, '').length === 0) return null;
  return /^[A-Za-z_]/.test(mangled) ? mangled : `_${mangled.slice(0, 39)}`;
}

/** Tell whether an HTML target can remain an active hyperlink. Fragment names Word
 *  cannot store as bookmarks still land as external-rel hyperlinks. */
export function isClipboardHyperlink(raw: string | null): boolean {
  if (raw === null) return false;
  if (raw.startsWith('#')) return raw.length > 1;
  const target = sanitizeHref(raw);
  return target?.ok === true && target.href.length > 0;
}

/** Resolve an external target, internal anchor, or their safe combination for HTML output. */
export function clipboardHyperlinkTarget(
  rawTarget: string | undefined,
  rawAnchor: string | undefined
): string | null {
  const href = rawTarget === undefined ? null : sanitizeHref(rawTarget);
  const anchor = clipboardBookmarkName(rawAnchor);
  if (href?.ok === true && href.href.length > 0) {
    if (anchor === null) return href.href;
    // Per ECMA-376 §17.16.22 the anchor names the location WITHIN the target, so
    // it replaces any fragment the target itself carries.
    return `${href.href.split('#')[0]}#${anchor}`;
  }
  return anchor === null ? null : `#${anchor}`;
}
