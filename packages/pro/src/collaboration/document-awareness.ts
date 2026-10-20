/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Identity validation and the awareness-payload codec for the full-document session.
 *
 * Everything here sits on a trust boundary: identity fields come from the host, and an
 * awareness record comes from a PEER, so a claim is checked rather than believed.
 */

import type {
  CollaborationIdentity,
  CollaborationLocalSelection,
} from '@docx-editor.dev/core/collaboration';
import { safeParticipantColor } from '@docx-editor.dev/core/collaboration';
import { CollaborationSchemaError } from './errors.ts';

export const AWARENESS_FIELD = 'docxEditor';
export const MAX_IDENTITY_LENGTH = 256;
export const MAX_AWARENESS_STATES = 256;

export interface EncodedSelectionAddress {
  readonly paragraphId: string;
  readonly offset: number;
  /**
   * `textDigest` of the paragraph text the offset counts in, as its author saw it. A receiver
   * whose text differs has not caught up with that author yet, so it holds the offset instead
   * of mapping it across text the author never saw. Absent from older peers.
   */
  readonly digest?: string;
  /**
   * The shared character the endpoint stands beside, so a peer finds the endpoint wherever
   * that character shows, whatever else changed. Absent from older peers, and when the author
   * had no such character; the offset then stands.
   */
  readonly character?: EncodedCharacter;
}

/** A shared character, as a published endpoint names it. */
export interface EncodedCharacter {
  /** Its shared item, as `client:clock`. */
  readonly item: string;
  /** The character it is a copy of, as `client:clock`, if any. */
  readonly identity?: string;
  /** True when the endpoint stands right after it, false when right before it. */
  readonly after: boolean;
}

const ITEM_PATTERN = /^\d{1,16}:\d{1,16}$/;

/**
 * A selection as this participant publishes it. Each endpoint names the text its offset counts
 * in, so a peer that has not received that text yet holds the offset instead of carrying it
 * across an edit twice, and the shared character beside it. `texts` holds the texts read.
 */
export function encodeSelection(
  selection: CollaborationLocalSelection,
  textOf: (paragraphId: string) => string | undefined,
  characterOf: (point: CollaborationLocalSelection['anchor']) => EncodedCharacter | undefined
): { readonly encoded: EncodedSelection; readonly texts: Map<string, string> } {
  const texts = new Map<string, string>();
  const address = (point: CollaborationLocalSelection['anchor']): EncodedSelectionAddress => {
    const paragraphId = point.paragraphId.toUpperCase();
    let text = texts.get(paragraphId);
    if (text === undefined) {
      text = textOf(paragraphId);
      if (text !== undefined) texts.set(paragraphId, text);
    }
    const offset = Math.max(0, point.offset);
    const character = characterOf({ paragraphId, offset });
    return {
      paragraphId,
      offset,
      ...(text !== undefined ? { digest: textDigest(text) } : {}),
      ...(character ? { character } : {}),
    };
  };
  const encoded: EncodedSelection = {
    anchor: address(selection.anchor),
    head: address(selection.head),
    ...(selection.kind === 'cells' ? { kind: 'cells' as const } : {}),
  };
  return { encoded, texts };
}

function encodedCharacter(value: unknown): EncodedCharacter | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.item !== 'string' ||
    !ITEM_PATTERN.test(record.item) ||
    typeof record.after !== 'boolean'
  ) {
    return null;
  }
  const identity =
    typeof record.identity === 'string' && ITEM_PATTERN.test(record.identity)
      ? record.identity
      : undefined;
  return { item: record.item, ...(identity ? { identity } : {}), after: record.after };
}

/** A short fingerprint of a paragraph's text (FNV-1a, 32 bits, eight hex digits). */
export function textDigest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const DIGEST_PATTERN = /^[0-9a-f]{8}$/;

export interface EncodedSelection {
  readonly anchor: EncodedSelectionAddress;
  readonly head: EncodedSelectionAddress;
  readonly kind?: 'cells';
}

export interface AwarenessPayload {
  readonly actorId: string;
  readonly name: string;
  readonly color?: string;
  readonly role: 'human' | 'agent';
  readonly selection?: EncodedSelection;
}

export function validateIdentity(identity: CollaborationIdentity): CollaborationIdentity {
  const actorId = identity.actorId.trim();
  const name = identity.name.trim();
  if (
    actorId.length === 0 ||
    actorId.length > MAX_IDENTITY_LENGTH ||
    name.length === 0 ||
    name.length > MAX_IDENTITY_LENGTH
  ) {
    throw new CollaborationSchemaError('invalid-identity');
  }
  if (identity.color !== undefined && identity.color.length > 64) {
    throw new CollaborationSchemaError('invalid-identity-color');
  }
  return Object.freeze({
    actorId,
    name,
    ...(identity.color ? { color: identity.color } : {}),
    role: identity.role ?? 'human',
  });
}

export function validateDocumentId(value: string): string {
  const documentId = value.trim();
  if (documentId.length === 0 || documentId.length > MAX_IDENTITY_LENGTH) {
    throw new CollaborationSchemaError('invalid-document-id');
  }
  return documentId;
}

export function sessionIdentity(value: string | undefined): string {
  const sessionId = value?.trim() || globalThis.crypto.randomUUID();
  if (sessionId.length > MAX_IDENTITY_LENGTH) {
    throw new CollaborationSchemaError('invalid-session-id');
  }
  return sessionId;
}

function encodedSelectionAddress(value: unknown): EncodedSelectionAddress | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.paragraphId !== 'string' ||
    record.paragraphId.length !== 8 ||
    !Number.isSafeInteger(record.offset) ||
    (record.offset as number) < 0
  ) {
    return null;
  }
  const character = encodedCharacter(record.character);
  return {
    paragraphId: record.paragraphId.toUpperCase(),
    offset: record.offset as number,
    ...(typeof record.digest === 'string' && DIGEST_PATTERN.test(record.digest)
      ? { digest: record.digest }
      : {}),
    ...(character ? { character } : {}),
  };
}

export function encodedSelection(value: unknown): EncodedSelection | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const selected = value as Record<string, unknown>;
  const anchor = encodedSelectionAddress(selected.anchor);
  const head = encodedSelectionAddress(selected.head);
  if (anchor && head) {
    return selected.kind === 'cells' ? { anchor, head, kind: 'cells' } : { anchor, head };
  }
  if (
    typeof selected.paragraphId === 'string' &&
    selected.paragraphId.length === 8 &&
    Number.isSafeInteger(selected.start) &&
    Number.isSafeInteger(selected.end) &&
    (selected.start as number) >= 0 &&
    (selected.end as number) >= 0
  ) {
    const paragraphId = selected.paragraphId.toUpperCase();
    return {
      anchor: { paragraphId, offset: selected.start as number },
      head: { paragraphId, offset: selected.end as number },
    };
  }
  return undefined;
}

export function awarenessPayload(value: unknown): AwarenessPayload | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.actorId !== 'string' ||
    record.actorId.length === 0 ||
    record.actorId.length > MAX_IDENTITY_LENGTH ||
    typeof record.name !== 'string' ||
    record.name.length === 0 ||
    record.name.length > MAX_IDENTITY_LENGTH
  ) {
    return null;
  }
  // Trust boundary for a peer's presence record. The color flows into `participants()` and
  // `remoteSelections()`, and hosts paint it into CSS (`background:` via a custom property),
  // where `url(//host/t)` is a zero-click GET. Only the shapes this engine itself produces
  // pass; anything else drops so every consumer falls back to the accent color.
  const color = safeParticipantColor(typeof record.color === 'string' ? record.color : undefined);
  const role: 'human' | 'agent' = record.role === 'agent' ? 'agent' : 'human';
  const base = { actorId: record.actorId, name: record.name, ...(color ? { color } : {}), role };
  const selection = encodedSelection(record.selection);
  return selection ? { ...base, selection } : base;
}
