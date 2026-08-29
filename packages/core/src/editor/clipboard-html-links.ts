import { sanitizeHref } from '../store/package/sinks.ts';

/** Admit only names Word can store in `w:bookmarkStart` and `w:anchor`. */
export function clipboardBookmarkName(raw: string | null | undefined): string | null {
  return raw !== null && raw !== undefined && /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(raw)
    ? raw
    : null;
}

/** Tell whether an HTML target can remain an active hyperlink. */
export function isClipboardHyperlink(raw: string | null): boolean {
  if (raw === null) return false;
  if (raw.startsWith('#')) return clipboardBookmarkName(raw.slice(1)) !== null;
  return sanitizeHref(raw)?.ok === true;
}

/** Resolve an external target, internal anchor, or their safe combination for HTML output. */
export function clipboardHyperlinkTarget(
  rawTarget: string | undefined,
  rawAnchor: string | undefined
): string | null {
  const href = rawTarget === undefined ? null : sanitizeHref(rawTarget);
  const anchor = clipboardBookmarkName(rawAnchor);
  if (href?.ok === true) {
    return `${href.href}${anchor !== null && !href.href.includes('#') ? `#${anchor}` : ''}`;
  }
  return anchor === null ? null : `#${anchor}`;
}
