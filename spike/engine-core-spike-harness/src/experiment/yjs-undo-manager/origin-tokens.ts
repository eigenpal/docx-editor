/** @spike-features origin-metadata, yjs-backend */
const TRACKED_ORIGIN_PREFIX = 'spike-tracked-origin/1';

export function createStableTrackedOrigin(actorId: string, sessionId: string): string {
  if (!actorId || !sessionId) throw new TypeError('tracked origin requires actorId and sessionId');
  return `${TRACKED_ORIGIN_PREFIX}\u0000${actorId}\u0000${sessionId}`;
}

export function createRemoteUntrackedOrigin(input: {
  readonly actorId: string;
  readonly replicaId: string;
  readonly sessionId: string;
  readonly updateId: string;
}): { readonly kind: 'remote'; readonly updateId: string; readonly actorId: string } {
  return Object.freeze({
    kind: 'remote',
    updateId: input.updateId,
    actorId: input.actorId,
  });
}

export function actorSessionFromTrackedOrigin(origin: unknown): {
  readonly actorId: string;
  readonly sessionId: string;
} | null {
  if (typeof origin !== 'string' || !origin.startsWith(`${TRACKED_ORIGIN_PREFIX}\u0000`)) {
    return null;
  }
  const [, actorId, sessionId] = origin.split('\u0000');
  if (!actorId || !sessionId) return null;
  return Object.freeze({ actorId, sessionId });
}

export function createUndoControlOrigin(actorId: string, sessionId: string): string {
  return `${TRACKED_ORIGIN_PREFIX}\u0000undo\u0000${actorId}\u0000${sessionId}`;
}

export function createRedoControlOrigin(actorId: string, sessionId: string): string {
  return `${TRACKED_ORIGIN_PREFIX}\u0000redo\u0000${actorId}\u0000${sessionId}`;
}
