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

import type { CollaborationIdentity } from '@docx-editor.dev/core/collaboration';
import { safeParticipantColor } from '@docx-editor.dev/core/collaboration';
import { CollaborationSchemaError } from './schema.ts';

export const AWARENESS_FIELD = 'docxEditor';
export const MAX_IDENTITY_LENGTH = 256;
export const MAX_AWARENESS_STATES = 256;

export interface EncodedSelectionAddress {
  readonly paragraphId: string;
  readonly offset: number;
}

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
  return { paragraphId: record.paragraphId.toUpperCase(), offset: record.offset as number };
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
