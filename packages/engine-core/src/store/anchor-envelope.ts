// Trusted versioned anchor envelopes (document-engine task 4.10 / design D4).
// Public APIs expose only opaque AnchorHandle values (never backend bytes); only
// trusted backend/awareness/persistence channels serialize an anchor, using a
// versioned envelope bound to document id, backend kind, anchor schema,
// checkpoint, and affinity. Restore validates all of those and returns
// `invalidAnchor` — never a guessed location — on any mismatch or staleness.

export const ANCHOR_ENVELOPE_VERSION = 1;

export interface AnchorEnvelope {
  readonly version: number;
  readonly documentId: string;
  /** Which backend produced the opaque bytes ('local', 'yjs', ...). */
  readonly backendKind: string;
  /** Backend anchor-schema version (for migration). */
  readonly schemaVersion: number;
  /** Checkpoint the anchor was captured at (staleness bound). */
  readonly checkpoint: number;
  readonly affinity: 'before' | 'after';
  /** Opaque backend-relative bytes (e.g. an encoded Y.RelativePosition). Private. */
  readonly bytesHex: string;
}

export interface AnchorContext {
  readonly documentId: string;
  readonly backendKind: string;
  readonly schemaVersion: number;
  readonly currentCheckpoint: number;
  /** How far back a checkpoint may lag and still be restorable. */
  readonly checkpointWindow?: number;
}

export type AnchorRestore =
  | { readonly ok: true; readonly bytesHex: string; readonly affinity: 'before' | 'after' }
  | {
      readonly ok: false;
      readonly reason:
        | 'wrong-document'
        | 'version-mismatch'
        | 'backend-mismatch'
        | 'schema-unmigratable'
        | 'stale-checkpoint'
        | 'malformed';
    };

/** Serialize an anchor for a trusted channel (never crosses a public JSON/RPC target). */
export function serializeAnchorEnvelope(params: {
  documentId: string;
  backendKind: string;
  schemaVersion: number;
  checkpoint: number;
  affinity: 'before' | 'after';
  bytesHex: string;
}): AnchorEnvelope {
  return { version: ANCHOR_ENVELOPE_VERSION, ...params };
}

/**
 * Restore an anchor envelope against the current document context. Returns the
 * opaque bytes for the backend to resolve, or a typed invalid-anchor reason.
 */
export function restoreAnchorEnvelope(env: unknown, ctx: AnchorContext): AnchorRestore {
  if (!isEnvelope(env)) return { ok: false, reason: 'malformed' };
  if (env.version !== ANCHOR_ENVELOPE_VERSION) return { ok: false, reason: 'version-mismatch' };
  if (env.documentId !== ctx.documentId) return { ok: false, reason: 'wrong-document' };
  if (env.backendKind !== ctx.backendKind) return { ok: false, reason: 'backend-mismatch' };
  // A different anchor schema is restorable only if it is not newer than ours
  // (forward migration is defined; reading a future schema is not).
  if (env.schemaVersion > ctx.schemaVersion) return { ok: false, reason: 'schema-unmigratable' };
  const window = ctx.checkpointWindow ?? Number.MAX_SAFE_INTEGER;
  if (env.checkpoint > ctx.currentCheckpoint || ctx.currentCheckpoint - env.checkpoint > window) {
    return { ok: false, reason: 'stale-checkpoint' };
  }
  return { ok: true, bytesHex: env.bytesHex, affinity: env.affinity };
}

function isEnvelope(v: unknown): v is AnchorEnvelope {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.version === 'number' &&
    typeof e.documentId === 'string' &&
    typeof e.backendKind === 'string' &&
    typeof e.schemaVersion === 'number' &&
    typeof e.checkpoint === 'number' &&
    (e.affinity === 'before' || e.affinity === 'after') &&
    typeof e.bytesHex === 'string'
  );
}
