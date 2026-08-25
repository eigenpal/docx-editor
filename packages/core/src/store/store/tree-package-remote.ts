// Remote canonical package publication for collaboration materialization.
//
// A replica installs one already-validated package as one revision. Collaborative undo
// lives in the replication layer, so this path records no legacy history and emits no
// primitive journal — the incoming package is the result of a remote journal, not new
// local intent.

import { runObservedStoreTransaction } from '../package/canonical-primitive-capture.ts';
import { validatePackageInvariants } from '../package/package-edit.ts';
import type { OoxmlExternalTarget, OoxmlPackage } from '../package/ooxml-package.ts';
import { ooxmlTreesEqual, validateOoxmlPart } from '../package/ooxml-tree.ts';
import type { RelationshipRecord } from '../package/relationships.ts';
import type { TreeOpRejection } from './tree-ops.ts';
import type { TreeModelChange } from './tree-store.ts';

/** Attribution stamped on one remote canonical publication. */
export interface RemotePackageAttribution {
  readonly origin: string;
  readonly actorId?: string;
  readonly operationId?: string;
}

/** Host surface required to install one remote package without private store access. */
export interface RemotePackagePublishHost {
  readonly packageRevision: number;
  currentPackage(): OoxmlPackage;
  installAuthoritativePackageSnapshot(snapshot: OoxmlPackage): void;
  publishStoryWrite(change: TreeModelChange | null): TreeModelChange | null;
  bodyStore(): { readonly part: { readonly name: string } };
}

type RemotePublishResult =
  | { readonly ok: true; readonly change: TreeModelChange | null }
  | { readonly ok: false; readonly reason: TreeOpRejection; readonly detail?: string };

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left === right) return true;
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function stringMapsEqual(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

function relationshipEqual(left: RelationshipRecord, right: RelationshipRecord): boolean {
  return (
    left === right ||
    (left.ownerPart === right.ownerPart &&
      left.id === right.id &&
      left.type === right.type &&
      left.rawTarget === right.rawTarget &&
      left.targetMode === right.targetMode &&
      left.order === right.order)
  );
}

function relationshipsEqual(
  left: ReadonlyMap<string, readonly RelationshipRecord[]>,
  right: ReadonlyMap<string, readonly RelationshipRecord[]>
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [owner, records] of left) {
    const other = right.get(owner);
    if (!other || other.length !== records.length) return false;
    if (
      other !== records &&
      records.some((record, index) => !relationshipEqual(record, other[index]!))
    ) {
      return false;
    }
  }
  return true;
}

function externalTargetsEqual(
  left: readonly OoxmlExternalTarget[],
  right: readonly OoxmlExternalTarget[]
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index]!;
    return (
      entry === other ||
      (entry.ownerPart === other.ownerPart &&
        entry.id === other.id &&
        entry.type === other.type &&
        entry.rawTarget === other.rawTarget &&
        entry.sinkSafe === other.sinkSafe)
    );
  });
}

function partBytesEqual(
  left: ReadonlyMap<string, Uint8Array>,
  right: ReadonlyMap<string, Uint8Array>
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [name, bytes] of left) {
    const other = right.get(name);
    if (!other || !bytesEqual(bytes, other)) return false;
  }
  return true;
}

/** True when identity or the canonical fingerprint oracle says the packages match. */
export function remotePackagesAreEquivalent(left: OoxmlPackage, right: OoxmlPackage): boolean {
  if (left === right) return true;
  if (left.mainDocumentPart !== right.mainDocumentPart) return false;
  if (left.parts.size !== right.parts.size) return false;
  if (!partBytesEqual(left.partBytes, right.partBytes)) return false;
  if (!relationshipsEqual(left.relationships, right.relationships)) return false;
  if (!externalTargetsEqual(left.externalTargets, right.externalTargets)) return false;
  if (
    left.contentTypes !== right.contentTypes &&
    (!stringMapsEqual(left.contentTypes.defaults, right.contentTypes.defaults) ||
      !stringMapsEqual(left.contentTypes.overrides, right.contentTypes.overrides))
  ) {
    return false;
  }
  for (const [name, part] of left.parts) {
    const other = right.parts.get(name);
    if (!other) return false;
    if (part !== other && !ooxmlTreesEqual(part, other)) return false;
  }
  return true;
}

function reject(detail: string): RemotePublishResult {
  return { ok: false, reason: 'package-invariant', detail };
}

/** Validate every modeled part and the package invariants. Does not install. */
export function validateRemoteCanonicalPackage(pkg: OoxmlPackage): RemotePublishResult | null {
  if (!pkg.parts.get(pkg.mainDocumentPart)) {
    return reject('no-main-document');
  }
  for (const [name, part] of pkg.parts) {
    const result = validateOoxmlPart(part);
    if (!result.ok) {
      return reject(`invalid-part:${name}:${result.issues[0]?.code ?? 'invalid'}`);
    }
  }
  const invariants = validatePackageInvariants(pkg);
  if (!invariants.ok) {
    return reject(invariants.issues[0]?.code ?? 'package-invariant');
  }
  return null;
}

/**
 * Install one remotely materialized package as one canonical revision.
 *
 * Duplicate identity or fingerprint matches publish nothing. Capture runs so nested
 * package hooks cannot leak a journal; the commit predicate stays false.
 */
export function publishRemoteCanonicalPackage(
  store: object & RemotePackagePublishHost,
  pkg: OoxmlPackage,
  attribution: RemotePackageAttribution
): RemotePublishResult {
  const current = store.currentPackage();
  if (remotePackagesAreEquivalent(pkg, current)) {
    return { ok: true, change: null };
  }
  const rejection = validateRemoteCanonicalPackage(pkg);
  if (rejection) return rejection;
  return runObservedStoreTransaction(
    store,
    () => {
      const fromRevision = store.packageRevision;
      store.installAuthoritativePackageSnapshot(pkg);
      const change = store.publishStoryWrite({
        change: 'model-change',
        fromRevision,
        toRevision: fromRevision + 1,
        commitId: `pkg-remote-${fromRevision + 1}`,
        origin: attribution.origin,
        ...(attribution.actorId ? { actorId: attribution.actorId } : {}),
        ...(attribution.operationId ? { operationId: attribution.operationId } : {}),
        dirty: [],
        created: [],
        deleted: [],
        splitJoin: [],
        dependencyKeys: [],
        impact: 'global',
        story: { kind: 'body', partName: store.bodyStore().part.name },
      });
      return { ok: true as const, change };
    },
    () => false
  );
}
