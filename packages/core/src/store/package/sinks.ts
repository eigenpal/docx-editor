// Runtime-sink sanitization and inert executable content (document-engine task
// 2.8 / lossless-package-model "Safe relationships and inert executable content"
// + "DOM and CSS sinks are string-safe"). Raw relationship/citation targets stay
// authored (retained by the record layer, XML-escaped only into owned OOXML,
// which is NOT a runtime sink). DOM/CSS/navigation/fetch sinks receive only the
// allowlist-sanitized projection produced here. Nothing in this module fetches;
// it transforms strings. Executable content is classified inert by default; an
// explicit scrub can remove it but declares itself non-lossless.

// Hyperlink/navigation allowlist (design D14 / CLAUDE.md security contract).
const HREF_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'ftp']);
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/**
 * A hyperlink target projected for a RUNTIME sink, or the reason it was withheld.
 *
 * The authored target stays authored — the record layer keeps it verbatim and escapes it into
 * owned OOXML, which is not a runtime sink. Only this allowlist-sanitized projection reaches DOM,
 * CSS, navigation or fetch, so `javascript:`, `data:` and `vbscript:` never leave the boundary.
 */
export type HrefProjection =
  | { readonly ok: true; readonly href: string }
  | { readonly ok: false; readonly inert: true };

/**
 * Project a file-derived URL for a DOM/navigation sink. Strips embedded
 * tab/LF/CR (used to smuggle `java\nscript:`), allows relative URLs and the
 * scheme allowlist, and renders everything else inert. Never fetches.
 */
export function sanitizeHref(raw: string): HrefProjection {
  const cleaned = raw.replace(/[\t\n\r]/g, '').trim();
  const m = SCHEME_RE.exec(cleaned);
  if (m && !HREF_SCHEMES.has(m[1].toLowerCase())) return { ok: false, inert: true };
  return { ok: true, href: cleaned };
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** XML-escape a value for validated serialization back into owned OOXML. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

/** True for a UTF-16 code unit forbidden in XML 1.0 character data: a control char other than
 *  tab/LF/CR, or the non-characters U+FFFE/U+FFFF. (Surrogates are validated as pairs below.) */
function isForbiddenXmlUnit(cu: number): boolean {
  if (cu === 0x9 || cu === 0xa || cu === 0xd) return false;
  if (cu < 0x20) return true;
  return cu === 0xfffe || cu === 0xffff;
}

/**
 * Validate that a string contains only characters legal in XML 1.0 text/attributes. escapeXml
 * handles the markup-significant characters but leaves control chars, U+FFFE/U+FFFF, and unpaired
 * surrogates — which would emit malformed XML (or be silently mangled during UTF-8 encoding). Returns
 * false so a caller can reject fail-closed. Valid supplementary characters (correct surrogate pairs)
 * pass.
 */
export function isValidXmlText(value: string): boolean {
  // Objects/arrays must never reach serialization: `String({})` is "[object Object]".
  if (typeof value !== 'string') return false;
  for (let i = 0; i < value.length; i++) {
    const cu = value.charCodeAt(i);
    if (isForbiddenXmlUnit(cu)) return false;
    if (cu >= 0xd800 && cu <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false; // unpaired high surrogate
      i++; // consume the valid low surrogate
    } else if (cu >= 0xdc00 && cu <= 0xdfff) {
      return false; // unpaired low surrogate
    }
  }
  return true;
}

/** Validate (fail-closed) then XML-escape an authored value bound for an owned attribute/text node. */
export function escapeXmlChecked(value: string, what: string): string {
  if (typeof value !== 'string')
    throw new Error(`${what} must be a string scalar (got ${typeof value})`);
  if (!isValidXmlText(value)) throw new Error(`${what} contains a character not valid in XML 1.0`);
  return escapeXml(value);
}

/**
 * CSS string-escape a file-derived value (e.g. an `@font-face` family name or an
 * inline style value). Emits `\<hex> ` escapes for quotes, backslash, and
 * controls so the value cannot break out of its CSS string.
 */
export function escapeCssString(value: string): string {
  return value.replace(/[\x00-\x1f\x7f"'\\]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}

/** Whether a file-derived CSS fragment contains a `url()` or `@import` (must be rejected). */
export function containsCssFetch(value: string): boolean {
  return /url\s*\(|@import/i.test(value);
}

// Executable content classes that are preserved inertly by default and never
// evaluated, exposed, or fetched.
/**
 * Content that must never execute or auto-resolve: OLE objects, macros, DDE and `INCLUDE*` field
 * instructions.
 *
 * Rendered INERT by default rather than stripped — removing it would be a lossless-preservation
 * failure, so it is carried and never acted on.
 */
export const INERT_EXECUTABLE_KINDS = [
  'field-dde',
  'field-include',
  'macro',
  'activex',
  'ole',
  'embedded-object',
  'executable-relationship',
] as const;
/** One of {@link INERT_EXECUTABLE_KINDS}. */
/** One of {@link INERT_EXECUTABLE_KINDS} — content carried but never executed. */
export type InertExecutableKind = (typeof INERT_EXECUTABLE_KINDS)[number];
const INERT = new Set<string>(INERT_EXECUTABLE_KINDS);

/** Whether a content kind is one this engine refuses to execute or auto-resolve. */
export function isInertExecutable(kind: string): boolean {
  return INERT.has(kind);
}

// Allowlisted pure internal field instructions that MAY be evaluated (design
// D14); everything else — DDE, INCLUDETEXT, INCLUDEPICTURE, MACROBUTTON — is inert.
const EVALUABLE_FIELDS = new Set([
  'PAGE',
  'NUMPAGES',
  'PAGEREF',
  'REF',
  'SEQ',
  'TOC',
  'DATE',
  'TIME',
  'STYLEREF',
]);

/** Whether a field instruction's leading keyword is safe to evaluate. */
export function isEvaluableField(instruction: string): boolean {
  const keyword = instruction.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  return EVALUABLE_FIELDS.has(keyword);
}

/** One item a scrub pass considers: its kind, and where in the package it sits. */
export interface ContentItem {
  readonly id: string;
  readonly kind: string;
}

/**
 * What an explicit scrub removed.
 *
 * A scrub DECLARES ITSELF non-lossless: removing executable content changes the file, which is a
 * choice a caller makes deliberately rather than a default the engine applies.
 */
export interface ScrubResult {
  readonly kept: readonly ContentItem[];
  readonly removed: readonly ContentItem[];
  /** A scrub that removes anything is non-lossless by definition. */
  readonly nonLossless: boolean;
}

/** Explicit scrub export: remove inert executable classes, report removals. */
export function scrubExport(items: readonly ContentItem[]): ScrubResult {
  const kept: ContentItem[] = [];
  const removed: ContentItem[] = [];
  for (const item of items) (isInertExecutable(item.kind) ? removed : kept).push(item);
  return { kept, removed, nonLossless: removed.length > 0 };
}
