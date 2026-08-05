// Authored content-type Default/Override records and resolution (document-engine
// task 2.6 / lossless-package-model "Relationship and content-type records are
// authored"). Records retain lexical form and significant order. Resolution:
// Override (by case-folded part name) beats Default (by ASCII case-insensitive
// extension). Conflicting Defaults on one extension, duplicate normalized
// Override names, and invalid MIME syntax fail closed. Identical duplicates are
// preserved inertly. Orphans never determine a part type.

import { partNameKey, asciiFold, type NameResult, normalizePartName } from './opc-names.ts';
import { BoundedCounter } from '../runtime/counter.ts';

/** One `<Default>`: a file extension mapped to a content type. */
export interface DefaultRecord {
  readonly extension: string; // authored lexical form
  readonly contentType: string;
  readonly order: number;
}
/** One `<Override>`: a specific part name mapped to a content type. Beats any Default. */
export interface OverrideRecord {
  readonly partName: string; // authored lexical form
  readonly contentType: string;
  readonly order: number;
}

/**
 * The authored `[Content_Types].xml` records, in significant order.
 *
 * Retained rather than collapsed into a lookup, because the file's lexical form and ordering are
 * part of what a lossless save re-emits.
 */
export interface ContentTypeRecords {
  readonly defaults: readonly DefaultRecord[];
  readonly overrides: readonly OverrideRecord[];
}

/**
 * Why content-type records could not be indexed.
 *
 * All fail CLOSED: conflicting Defaults on one extension, duplicate normalized Override names, or
 * invalid MIME syntax are refused rather than resolved by picking one.
 */
export type ContentTypeError =
  | { readonly code: 'invalid-mime'; readonly value: string }
  | { readonly code: 'conflicting-default'; readonly extension: string }
  | { readonly code: 'duplicate-override'; readonly partName: string }
  | { readonly code: 'invalid-override-name'; readonly partName: string }
  | { readonly code: 'too-many-records'; readonly limit: number };

// Media type per RFC 2045-ish: type "/" subtype, optional ";" parameters.
const MIME_RE =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*(\s*;\s*[^;]+)*$/;

/** Whether a string is syntactically a MIME type. Syntax only — no registry lookup. */
export function isValidMime(value: string): boolean {
  return MIME_RE.test(value);
}

/** ASCII-case-insensitive extension key (leading dot removed; ASCII-only fold). */
export function extensionKey(extension: string): string {
  return asciiFold(extension.replace(/^\./, ''));
}

/** The resolved lookup: Override by case-folded part name, Default by case-insensitive extension. */
export interface ContentTypeIndex {
  /** ext key -> single MIME (identical duplicates collapsed). */
  readonly defaults: ReadonlyMap<string, string>;
  /** case-folded part name -> MIME. */
  readonly overrides: ReadonlyMap<string, string>;
}

/** The built index, or the conflict that made it impossible. */
export type IndexResult =
  | { readonly ok: true; readonly index: ContentTypeIndex }
  | { readonly ok: false; readonly error: ContentTypeError };

/**
 * Build a resolved content-type index, failing closed on conflict/duplicate/MIME
 * errors. `maxRecords` bounds the combined record count (N/N+1 gate).
 */
export function buildContentTypeIndex(
  records: ContentTypeRecords,
  maxRecords = 100_000
): IndexResult {
  const counter = new BoundedCounter('content-type-records', maxRecords);
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();

  for (const d of records.defaults) {
    try {
      counter.add(1);
    } catch {
      return { ok: false, error: { code: 'too-many-records', limit: maxRecords } };
    }
    if (!isValidMime(d.contentType))
      return { ok: false, error: { code: 'invalid-mime', value: d.contentType } };
    const key = extensionKey(d.extension);
    const existing = defaults.get(key);
    if (existing !== undefined && existing !== d.contentType) {
      return { ok: false, error: { code: 'conflicting-default', extension: key } };
    }
    defaults.set(key, d.contentType); // identical duplicate is a no-op
  }

  for (const o of records.overrides) {
    try {
      counter.add(1);
    } catch {
      return { ok: false, error: { code: 'too-many-records', limit: maxRecords } };
    }
    if (!isValidMime(o.contentType))
      return { ok: false, error: { code: 'invalid-mime', value: o.contentType } };
    const norm: NameResult = normalizePartName(o.partName);
    if (!norm.ok)
      return { ok: false, error: { code: 'invalid-override-name', partName: o.partName } };
    const key = partNameKey(norm.partName);
    const existing = overrides.get(key);
    if (existing !== undefined && existing !== o.contentType) {
      return { ok: false, error: { code: 'duplicate-override', partName: key } };
    }
    overrides.set(key, o.contentType);
  }

  return { ok: true, index: { defaults, overrides } };
}

/**
 * A part's content type, or why it has none.
 *
 * An orphan record never determines a part's type — a Default with no matching part is preserved
 * inertly rather than applied.
 */
export type ResolveResult =
  | { readonly ok: true; readonly contentType: string; readonly source: 'override' | 'default' }
  | { readonly ok: false; readonly reason: 'unknown' };

/** Resolve a part's content type: Override wins over Default; else unknown. */
export function resolveContentType(index: ContentTypeIndex, partName: string): ResolveResult {
  const override = index.overrides.get(partNameKey(partName));
  if (override !== undefined) return { ok: true, contentType: override, source: 'override' };
  const dot = partName.lastIndexOf('.');
  if (dot >= 0) {
    const ext = extensionKey(partName.slice(dot + 1));
    const def = index.defaults.get(ext);
    if (def !== undefined) return { ok: true, contentType: def, source: 'default' };
  }
  return { ok: false, reason: 'unknown' };
}
