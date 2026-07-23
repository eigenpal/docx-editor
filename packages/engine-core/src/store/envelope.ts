// Replication-update / snapshot envelope validation (document-engine task 5.5 /
// design D10). Before any bytes touch a backend, the envelope is validated for
// protocol version, document identity, hex integrity (truncation), and declared
// byte size (oversized). A malformed, truncated, oversized, or wrong-document
// envelope is rejected BEFORE mutation — the coordinator never stages it.

export interface EnvelopeLimits {
  readonly maxBytes: number;
}
export const DEFAULT_ENVELOPE_LIMITS: EnvelopeLimits = { maxBytes: 64 * 1024 * 1024 };

export type EnvelopeRejection = 'wrong-protocol' | 'wrong-document' | 'malformed' | 'truncated' | 'oversized';
export type EnvelopeCheck = { readonly ok: true } | { readonly ok: false; readonly reason: EnvelopeRejection };

const HEX = /^[0-9a-f]*$/;

/** Validate an opaque replication/snapshot envelope before it is applied. */
export function validateEnvelope(
  env: { readonly protocolVersion?: unknown; readonly documentId?: unknown; readonly bytesHex?: unknown },
  ctx: { readonly documentId: string; readonly protocolVersion: number; readonly limits?: EnvelopeLimits },
): EnvelopeCheck {
  const limits = ctx.limits ?? DEFAULT_ENVELOPE_LIMITS;
  if (typeof env.protocolVersion !== 'number') return { ok: false, reason: 'malformed' };
  if (env.protocolVersion !== ctx.protocolVersion) return { ok: false, reason: 'wrong-protocol' };
  if (typeof env.documentId !== 'string') return { ok: false, reason: 'malformed' };
  if (env.documentId !== ctx.documentId) return { ok: false, reason: 'wrong-document' };
  if (typeof env.bytesHex !== 'string' || !HEX.test(env.bytesHex)) return { ok: false, reason: 'malformed' };
  if (env.bytesHex.length % 2 !== 0) return { ok: false, reason: 'truncated' };
  if (env.bytesHex.length / 2 > limits.maxBytes) return { ok: false, reason: 'oversized' };
  return { ok: true };
}
