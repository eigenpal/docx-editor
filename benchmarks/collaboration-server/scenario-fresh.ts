// Builds of a replica's shared state, for oracles that compare them with what its editor shows.
//
// A fresh build reads the shared state alone: a new registry whose indexes come from the
// whole shared state, not from events, and a materializer with no caches. A session build
// reads through the session's own registry, with its indexes as events left them.

import type * as Y from 'yjs';
import type { DocumentCollaborationHandle } from '../../packages/pro/src/collaboration/document-session.ts';
import {
  DocumentRegistry,
  PackageMaterializer,
  type BlobBytesStore,
  type LogicalId,
} from '../../packages/pro/src/collaboration/document/index.ts';
import type { MaterializeResult } from '../../packages/pro/src/collaboration/document/materialize.ts';
import type { PlacedText } from '../../packages/pro/src/collaboration/document/paragraph-text-follow.ts';
import type { TextIdentities } from '../../packages/pro/src/collaboration/document/paragraph-text-identity.ts';

type Session = DocumentCollaborationHandle['session'];

/** What the follow index of a registry keeps, its private maps included. */
export interface FollowInternals {
  holdersOf(identity: string): LogicalId[];
  shownCopy(identity: string): LogicalId | null;
  /** Paragraphs whose text can follow a move. */
  readonly sources: ReadonlySet<LogicalId>;
  /** For each live source, the characters of its text that show in another paragraph. */
  readonly outgoingOf: ReadonlyMap<LogicalId, PlacedText>;
  /** Identities as the last read left them. */
  readonly identities: ReadonlyMap<LogicalId, { readonly identities: TextIdentities }>;
}

/** The private parts of a session the oracles read. */
export interface SessionInternals {
  readonly registry: DocumentRegistry;
  readonly blobs: BlobBytesStore;
  readonly identityMap: { resolve(id: string): string };
  /** The session keeps its last complete view while it waits for a held-back update. */
  readonly viewWaiting: boolean;
  /** The follow index of the session's registry. */
  readonly follow: FollowInternals;
}

/** A session's private parts, read live: `viewWaiting` is read when asked for. */
export function sessionInternals(session: Session): SessionInternals {
  const raw = session as unknown as Omit<SessionInternals, 'follow'>;
  return {
    registry: raw.registry,
    blobs: raw.blobs,
    identityMap: raw.identityMap,
    get viewWaiting() {
      return raw.viewWaiting;
    },
    follow: followInternals(raw.registry),
  };
}

/** A registry's follow index, its private maps included. */
export function followInternals(registry: DocumentRegistry): FollowInternals {
  return registry.inline.follow as unknown as FollowInternals;
}

/** A new registry over `ydoc` with the session's limits, its indexes read from shared state. */
export function freshRegistry(ydoc: Y.Doc, session: Session): DocumentRegistry {
  const registry = new DocumentRegistry(ydoc, sessionInternals(session).registry.limits);
  registry.rebuildDerivedIndexes();
  return registry;
}

/** Build the package from shared state alone, with no index or cache the session holds. */
export function freshBuild(ydoc: Y.Doc, session: Session): MaterializeResult {
  const registry = freshRegistry(ydoc, session);
  const fresh = new PackageMaterializer(registry, sessionInternals(session).blobs);
  try {
    return fresh.rebuildFull();
  } finally {
    fresh.destroy();
    registry.destroy();
  }
}

/**
 * Use a fresh registry over `ydoc` and the package built from it, then release both. The
 * registry stays open during `inspect`, so an oracle can compare its indexes with the session's.
 */
export function withFreshBuild<T>(
  ydoc: Y.Doc,
  session: Session,
  inspect: (built: MaterializeResult, registry: DocumentRegistry) => T
): T {
  const registry = freshRegistry(ydoc, session);
  const fresh = new PackageMaterializer(registry, sessionInternals(session).blobs);
  try {
    return inspect(fresh.rebuildFull(), registry);
  } finally {
    fresh.destroy();
    registry.destroy();
  }
}

/**
 * The first node the session's registry places under another parent than `fresh` does, or
 * null. Reads the indexes only: a materializer over the session's registry would take the
 * dirty sets its own materializer has yet to read, and change what the next check sees.
 */
export function parentDifference(session: Session, fresh: DocumentRegistry): string | null {
  const live = sessionInternals(session).registry;
  for (const id of fresh.allLogicalIds()) {
    const expected = fresh.parentOf(id);
    const actual = live.parentOf(id);
    if (expected !== actual) return `${id} under ${actual}, not ${expected}`;
  }
  return null;
}

/**
 * Build the package in full through the session's own registry indexes. It takes the dirty
 * sets the session's materializer has yet to read, so only a diagnosis after a failure uses it.
 */
export function sessionBuild(session: Session): MaterializeResult {
  const { registry, blobs } = sessionInternals(session);
  const own = new PackageMaterializer(registry, blobs);
  try {
    return own.rebuildFull();
  } finally {
    own.destroy();
  }
}
