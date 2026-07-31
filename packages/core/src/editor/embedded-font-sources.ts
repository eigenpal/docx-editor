// Embedded document faces as shaping font sources (font-resolution-overhaul 2.1/2.2).
//
// `readEmbeddedFonts` hands back deobfuscated bytes and a CLAIMED family/style, asserting
// nothing about validity — admitting a face stays the font resource lane's job, behind its
// validator and caps. This module only reshapes that claim into the `FontSource` contract
// and applies the rules composition needs before the snapshot sees the bytes:
//
// - Request validity: the family is attacker-controlled, and a family the request
//   contract refuses (empty or whitespace-only) would THROW out of `fontRequestKey`
//   during composition — failing the whole resolution, explicit sources included, over
//   one crafted face. Such faces drop HERE, per-face, with a typed report.
// - Per-face bytes: a face larger than the configuration's `maxFontBytes` is dropped
//   HERE, because `createLayoutShaping` treats an oversized source as a configuration
//   error and fails the WHOLE configuration — right for app-supplied bytes, wrong for a
//   face an attacker put in a file.
// - Aggregate: embedded faces admit oldest-first until the shared aggregate budget is
//   exhausted; the rest drop. A file must not be able to spend the whole budget explicit
//   sources also draw on.
// - Shadowed faces: a face whose (family, weight, style) an explicit source already
//   covers can never win composition, so it is skipped BEFORE it spends budget or
//   hashing time — silently, because being overridden is precedence, not failure.
//
// Every drop is returned as a typed report, so the editor can say WHICH face fell and why
// rather than silently measuring it with the fallback.

import type { EmbeddedFont, FontStyleKey } from '@docx-editor.dev/core-contract/store';
import type { FontFaceRequest, FontSource } from '@docx-editor.dev/core-contract/contracts/editor';
import { fontRequestKey, sha256FontBytes } from '@docx-editor.dev/core-contract/layout';

/** Word's four embed slots, in the vocabulary the resolver requests faces in. */
const STYLE_REQUESTS: Record<FontStyleKey, { weight: number; style: 'normal' | 'italic' }> = {
  regular: { weight: 400, style: 'normal' },
  bold: { weight: 700, style: 'normal' },
  italic: { weight: 400, style: 'italic' },
  boldItalic: { weight: 700, style: 'italic' },
};

export interface DroppedEmbeddedFont {
  readonly request: FontFaceRequest;
  readonly partName: string;
  readonly reason: 'overLimit' | 'malformed';
}

export interface EmbeddedFontSources {
  readonly sources: readonly FontSource[];
  readonly dropped: readonly DroppedEmbeddedFont[];
}

/**
 * Map embedded faces to `FontSource`s under the given byte budgets.
 *
 * `aggregateBudget` is what remains AFTER explicit sources are counted, so a document
 * cannot starve the app's own fonts; `shadowedRequests` (request keys of explicit
 * sources) skips faces composition would discard anyway. Hashing happens here (the
 * contract requires it), which also means a face dropped or skipped is never hashed.
 */
export function embeddedFontSources(
  embedded: readonly EmbeddedFont[],
  budgets: {
    readonly maxFontBytes: number;
    readonly aggregateBudget: number;
    readonly shadowedRequests?: ReadonlySet<string>;
  }
): EmbeddedFontSources {
  const sources: FontSource[] = [];
  const dropped: DroppedEmbeddedFont[] = [];
  let remaining = budgets.aggregateBudget;
  // A file may name the SAME face twice (two `w:font` elements of one family, each with
  // the same style slot). Composition keeps the first per request key, so emitting the
  // rest would produce sources that never reach validation while still looking admitted
  // to a caller that iterates this list. First-wins here, once, matching composition.
  const seen = new Set<string>();
  for (const font of embedded) {
    const mapped = STYLE_REQUESTS[font.style];
    const request: FontFaceRequest = Object.freeze({
      family: font.family,
      weight: mapped.weight,
      style: mapped.style,
    });
    // The request contract refuses empty/whitespace families with a THROW; a file must
    // degrade this face, not detonate the composition that carries every other face.
    if (font.family.trim().length === 0) {
      dropped.push({ request, partName: font.partName, reason: 'malformed' });
      continue;
    }
    const key = fontRequestKey(request);
    if (budgets.shadowedRequests?.has(key) || seen.has(key)) continue;
    seen.add(key);
    if (font.bytes.byteLength > budgets.maxFontBytes || font.bytes.byteLength > remaining) {
      dropped.push({ request, partName: font.partName, reason: 'overLimit' });
      continue;
    }
    remaining -= font.bytes.byteLength;
    sources.push({
      request,
      id: `embedded:${font.partName}#${font.style}`,
      bytes: font.bytes,
      hash: sha256FontBytes(font.bytes),
      faceIndex: 0,
    });
  }
  return { sources, dropped };
}
