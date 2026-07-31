/** @spike-features insert-delete-split-join-operations, stable-paragraph-ids */
import { isSpikeId } from '../contracts/ids';

export interface OperationEnvironment {
  readonly actorId: string;
  readonly nextCommitSeq: number;
  readonly nextLocalSeq: number;
  readonly reservedSemanticIds: ReadonlySet<string>;
}

export function createOperationEnvironment(actorId: string, existingSemanticIds: Iterable<string>): OperationEnvironment {
  if (!isSpikeId(actorId)) throw new TypeError('invalid operation environment actorId');
  return Object.freeze({
    actorId,
    nextCommitSeq: 1,
    nextLocalSeq: 1,
    reservedSemanticIds: new Set(existingSemanticIds),
  });
}

export function commitIdFor(actorId: string, revisionAfter: number): string {
  const shortActor = actorId.startsWith('actor-') ? actorId.slice('actor-'.length) : actorId;
  return compactDerivedId(`commit-${shortActor}-${revisionAfter}`, `${actorId}:${revisionAfter}`);
}

export function allocateMarkId(
  env: OperationEnvironment,
  paragraphId: string,
  kind: string
): { markId: string; env: OperationEnvironment } {
  const allocated = allocateSemanticId(env, `mark-${paragraphId}-${kind}`);
  return { markId: allocated.semanticId, env: allocated.env };
}

export function allocateSemanticId(
  env: OperationEnvironment,
  base: string
): { semanticId: string; env: OperationEnvironment } {
  let sequence = env.nextLocalSeq;
  let candidate = compactDerivedId(base, base);
  while (env.reservedSemanticIds.has(candidate)) {
    candidate = compactDerivedId(`${base}-${sequence}`, `${base}:${sequence}`);
    sequence += 1;
  }
  const reserved = new Set(env.reservedSemanticIds);
  reserved.add(candidate);
  return {
    semanticId: candidate,
    env: Object.freeze({
      ...env,
      nextLocalSeq: sequence + 1,
      reservedSemanticIds: reserved,
    }),
  };
}

export function compactDerivedId(preferred: string, provenance: string): string {
  if (isSpikeId(preferred)) return preferred;
  const hash = new Bun.CryptoHasher('sha256').update(provenance).digest('hex');
  return `derived-${hash.slice(0, 32)}`;
}

export function registerSemanticId(env: OperationEnvironment, semanticId: string): OperationEnvironment {
  if (env.reservedSemanticIds.has(semanticId)) return env;
  const reserved = new Set(env.reservedSemanticIds);
  reserved.add(semanticId);
  return Object.freeze({
    ...env,
    reservedSemanticIds: reserved,
  });
}

export function bumpCommitSeq(env: OperationEnvironment): OperationEnvironment {
  return Object.freeze({
    ...env,
    nextCommitSeq: env.nextCommitSeq + 1,
  });
}
