/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The `w:tag` codec for custom nodes: `<prefix>:<name>?<urlencoded attrs>`.
//
// The tag is the node's IDENTITY inside a run-level SDT — the one anchor that
// survives Word's open→edit→save cycle (verified against Word for the web,
// 2026-08-05: see e2e/fixtures/sdt-custom-tag-word-roundtrip.docx). Word caps
// `w:tag` at 64 characters, so encoding refuses anything longer rather than
// truncating an identity; the customXml data-part escape hatch for oversized
// payloads is the follow-up recorded in the change tasks.
//
// SECURITY: a decoded tag comes from a file an attacker fully controls. Attr
// names become object keys, so the decoder refuses the prototype-polluting
// names outright, and attrs are returned on a null-prototype object.

/** Word refuses to store more than 64 characters in `w:tag`. */
export const MAX_TAG_LENGTH = 64;

const FORBIDDEN_ATTR_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

export type EncodeTagResult =
  | { readonly ok: true; readonly tag: string }
  | { readonly ok: false; readonly reason: 'tag-overflow'; readonly length: number };

/** Encode a node identity into a `w:tag` value, refusing the Word length cap. */
export function encodeCustomNodeTag(
  prefix: string,
  name: string,
  attrs: Readonly<Record<string, string>>
): EncodeTagResult {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(attrs)) query.set(key, value);
  const encoded = query.toString();
  const tag = encoded.length > 0 ? `${prefix}:${name}?${encoded}` : `${prefix}:${name}`;
  if (tag.length > MAX_TAG_LENGTH) return { ok: false, reason: 'tag-overflow', length: tag.length };
  return { ok: true, tag };
}

export interface DecodedCustomNodeTag {
  readonly prefix: string;
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
}

/**
 * Decode a `w:tag` value, or null when it is not a custom-node tag.
 *
 * Null rather than throwing: every inline SDT in every opened document flows
 * through this, and most SDTs in the wild are ordinary Word content controls
 * whose tags mean something else entirely.
 */
export function decodeCustomNodeTag(tag: string): DecodedCustomNodeTag | null {
  const colon = tag.indexOf(':');
  if (colon <= 0) return null;
  const prefix = tag.slice(0, colon);
  const rest = tag.slice(colon + 1);
  const question = rest.indexOf('?');
  const name = question === -1 ? rest : rest.slice(0, question);
  if (name.length === 0) return null;
  const attrs: Record<string, string> = Object.create(null);
  if (question !== -1) {
    for (const [key, value] of new URLSearchParams(rest.slice(question + 1))) {
      // Attacker-controlled attr NAME becomes an object key: the polluting
      // names are refused, never assigned.
      if (FORBIDDEN_ATTR_NAMES.has(key)) return null;
      attrs[key] = value;
    }
  }
  return { prefix, name, attrs };
}
