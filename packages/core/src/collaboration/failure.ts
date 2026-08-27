/**
 * Lifecycle state of one collaboration replica.
 *
 * One axis, because the only question a host has to answer is whether to tell the reader to
 * wait or to reload:
 *
 * - `initializing` — joining. Edits are refused. Recovers on its own.
 * - `ready` — replicating. The only state that accepts edits.
 * - `disconnected` — the transport dropped. The replica is intact and recovers on its own,
 *   so wait rather than reload. Edits are refused until reconnect by default; a session
 *   created with offline editing enabled keeps accepting them, and the buffered updates
 *   merge on reconnect.
 * - `error` — this replica no longer agrees with the room. It does not recover: only a
 *   reload rejoins. {@link CollaborationStatusSnapshot.reason} says why.
 * - `destroyed` — torn down. Terminal.
 *
 * @public
 */
export type CollaborationStatus = 'initializing' | 'ready' | 'disconnected' | 'error' | 'destroyed';

/**
 * Why a replica refused work, left `ready`, or failed a schema check.
 *
 * Free-form extras (a transport phrase, a blob key, a store refusal) travel in
 * {@link CollaborationFailure.detail}, not here. `invalid-shared-metadata` follows that rule:
 * it names one malformed field of the room's shared metadata, and which field is the detail.
 * Distinct from `invalid-document-id`, which rejects a document id this host passed in.
 * `concurrent-seed` reports two merged seed transactions in one room; the room cannot be
 * repaired client-side — create a new room from saved bytes.
 *
 * Two of these name a transport condition a host has to tell apart, because the answers are
 * opposite. `transport-disconnected` recovers on its own, so wait. `authentication-failed`
 * never does: the credential the provider re-sent was rejected, so refresh it and rejoin.
 * `transport` remains the catch-all for a provider that reported neither.
 *
 * @public
 */
export type CollaborationFailureCode =
  | 'already-initialized'
  | 'authentication-failed'
  | 'baseline-digest-mismatch'
  | 'baseline-too-large'
  | 'blob-digest-mismatch'
  | 'blob-read'
  | 'blob-store-full'
  | 'blob-too-large'
  | 'collaboration-session-destroyed'
  | 'collaboration-session-not-attached'
  | 'collaboration-session-not-ready'
  | 'collaboration-text-limit'
  | 'concurrent-seed'
  | 'document-id-mismatch'
  | 'duplicate-paragraph-id'
  | 'experimental-collaboration-body-text-only'
  | 'experimental-collaboration-existing-paragraphs-only'
  | 'experimental-collaboration-text-only'
  | 'experimental-collaboration-untracked-text-only'
  | 'immutable-baseline-changed'
  | 'immutable-metadata-changed'
  | 'initialization-aborted'
  | 'initialization-timeout'
  | 'invalid-baseline'
  | 'invalid-blob-descriptor'
  | 'invalid-bound'
  | 'invalid-document-id'
  | 'invalid-identity'
  | 'invalid-identity-color'
  | 'invalid-logical-id'
  | 'invalid-relationships'
  | 'invalid-session-id'
  | 'invalid-shared-metadata'
  | 'invalid-string'
  | 'local-mirror-failed'
  | 'materialize-dropped-content'
  | 'missing-blob'
  | 'missing-local-blob'
  | 'missing-root'
  | 'no-main-document-part'
  | 'not-initialized'
  | 'paragraph-set-mismatch'
  | 'port-already-attached'
  | 'protocol-version-mismatch'
  | 'prototype-key'
  | 'remote-apply-failed'
  | 'schema-version-mismatch'
  | 'shared-schema-invalid'
  | 'text-too-long'
  | 'too-many-attributes'
  | 'too-many-children'
  | 'too-many-nodes'
  | 'too-many-parts'
  | 'too-many-relationships'
  | 'transport'
  | 'transport-disconnected'
  | 'tree-too-deep'
  | 'unknown-logical-id'
  | 'unknown-paragraph-id'
  | 'unsafe-part-name'
  | 'unsupported-root-key';

const COLLABORATION_FAILURE_CODE_PRESENT: { readonly [K in CollaborationFailureCode]: true } = {
  'already-initialized': true,
  'authentication-failed': true,
  'baseline-digest-mismatch': true,
  'baseline-too-large': true,
  'blob-digest-mismatch': true,
  'blob-read': true,
  'blob-store-full': true,
  'blob-too-large': true,
  'collaboration-session-destroyed': true,
  'collaboration-session-not-attached': true,
  'collaboration-session-not-ready': true,
  'collaboration-text-limit': true,
  'concurrent-seed': true,
  'document-id-mismatch': true,
  'duplicate-paragraph-id': true,
  'experimental-collaboration-body-text-only': true,
  'experimental-collaboration-existing-paragraphs-only': true,
  'experimental-collaboration-text-only': true,
  'experimental-collaboration-untracked-text-only': true,
  'immutable-baseline-changed': true,
  'immutable-metadata-changed': true,
  'initialization-aborted': true,
  'initialization-timeout': true,
  'invalid-baseline': true,
  'invalid-blob-descriptor': true,
  'invalid-bound': true,
  'invalid-document-id': true,
  'invalid-identity': true,
  'invalid-identity-color': true,
  'invalid-logical-id': true,
  'invalid-relationships': true,
  'invalid-session-id': true,
  'invalid-shared-metadata': true,
  'invalid-string': true,
  'local-mirror-failed': true,
  'materialize-dropped-content': true,
  'missing-blob': true,
  'missing-local-blob': true,
  'missing-root': true,
  'no-main-document-part': true,
  'not-initialized': true,
  'paragraph-set-mismatch': true,
  'port-already-attached': true,
  'protocol-version-mismatch': true,
  'prototype-key': true,
  'remote-apply-failed': true,
  'schema-version-mismatch': true,
  'shared-schema-invalid': true,
  'text-too-long': true,
  'too-many-attributes': true,
  'too-many-children': true,
  'too-many-nodes': true,
  'too-many-parts': true,
  'too-many-relationships': true,
  transport: true,
  'transport-disconnected': true,
  'tree-too-deep': true,
  'unknown-logical-id': true,
  'unknown-paragraph-id': true,
  'unsafe-part-name': true,
  'unsupported-root-key': true,
};

/** True when `value` is a {@link CollaborationFailureCode} member. @public */
export function isCollaborationFailureCode(value: string): value is CollaborationFailureCode {
  return Object.hasOwn(COLLABORATION_FAILURE_CODE_PRESENT, value);
}

/** One collaboration failure: a typed code plus optional free-form detail. @public */
export interface CollaborationFailure {
  readonly code: CollaborationFailureCode;
  readonly detail?: string;
}

/**
 * Cached status read. Same reference until status, reason, or last failure change.
 *
 * @public
 */
export interface CollaborationStatusSnapshot {
  readonly status: CollaborationStatus;
  readonly reason: CollaborationFailure | undefined;
  readonly lastFailure: CollaborationFailure | undefined;
}

function failuresEqual(
  left: CollaborationFailure | undefined,
  right: CollaborationFailure | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.code === right.code && left.detail === right.detail;
}

function failureOf(code: CollaborationFailureCode, detail?: string): CollaborationFailure {
  return Object.freeze(detail !== undefined && detail.length > 0 ? { code, detail } : { code });
}

/** @internal */
export interface CollaborationStatusTracker {
  status(): CollaborationStatus;
  snapshot(): CollaborationStatusSnapshot;
  set(status: CollaborationStatus, code?: CollaborationFailureCode, detail?: string): boolean;
}

/** @internal */
export function createCollaborationStatusTracker(
  initial: CollaborationStatus = 'initializing'
): CollaborationStatusTracker {
  let status = initial;
  let reason: CollaborationFailure | undefined;
  let lastFailure: CollaborationFailure | undefined;
  let snapshot: CollaborationStatusSnapshot = Object.freeze({
    status,
    reason,
    lastFailure,
  });
  return {
    status: () => status,
    snapshot: () => snapshot,
    set(next: CollaborationStatus, code?: CollaborationFailureCode, detail?: string): boolean {
      const nextReason = code === undefined ? undefined : failureOf(code, detail);
      if (status === next && failuresEqual(reason, nextReason)) return false;
      status = next;
      reason = nextReason;
      if (next === 'error' && nextReason) lastFailure = nextReason;
      snapshot = Object.freeze({ status, reason, lastFailure });
      return true;
    },
  };
}
