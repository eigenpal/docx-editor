/** @spike-features yjs-backend */
import { isSpikeId } from '../../contracts/ids';

const CREATION_ID_PATTERN =
  /^(?<actorId>[^:]+):(?<commitSeq>0|[1-9][0-9]*):(?<localSeq>0|[1-9][0-9]*)$/;
const COMMIT_ID_PATTERN = /^commit-(?<commitSeq>0|[1-9][0-9]*)$/;

export interface ParsedCreationId {
  readonly actorId: string;
  readonly commitSeq: number;
  readonly localSeq: number;
}

export function creationIdFor(actorId: string, commitSeq: number, localSeq: number): string {
  if (!isSpikeId(actorId)) throw new TypeError('invalid actorId');
  if (!Number.isInteger(commitSeq) || commitSeq < 0) throw new TypeError('invalid commitSeq');
  if (!Number.isInteger(localSeq) || localSeq < 0) throw new TypeError('invalid localSeq');
  return `${actorId}:${commitSeq}:${localSeq}`;
}

export function yjsCommitIdFor(commitSeq: number): string {
  if (!Number.isInteger(commitSeq) || commitSeq < 0) throw new TypeError('invalid commitSeq');
  return `commit-${commitSeq}`;
}

export function parseCreationId(value: string): ParsedCreationId | null {
  const match = CREATION_ID_PATTERN.exec(value);
  if (!match?.groups) return null;
  return {
    actorId: match.groups.actorId,
    commitSeq: Number(match.groups.commitSeq),
    localSeq: Number(match.groups.localSeq),
  };
}

export function parseCommitSeq(value: string): number | null {
  const match = COMMIT_ID_PATTERN.exec(value);
  if (!match?.groups) return null;
  return Number(match.groups.commitSeq);
}

export function paragraphIdFromBlockId(blockId: string): string {
  if (!blockId.startsWith('block-')) throw new TypeError('invalid blockId prefix');
  return blockId.slice('block-'.length);
}

export function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareCollisionCandidates(
  a: { actorId: string; commitId: string; creationId: string },
  b: { actorId: string; commitId: string; creationId: string }
): number {
  const actor = codeUnitCompare(a.actorId, b.actorId);
  if (actor !== 0) return actor;
  const commit = codeUnitCompare(a.commitId, b.commitId);
  if (commit !== 0) return commit;
  const leftSeq = parseCreationId(a.creationId)?.localSeq ?? 0;
  const rightSeq = parseCreationId(b.creationId)?.localSeq ?? 0;
  if (leftSeq !== rightSeq) return leftSeq - rightSeq;
  return codeUnitCompare(a.creationId, b.creationId);
}

export function repairedSemanticId(
  proposedSemanticId: string,
  actorId: string,
  commitId: string,
  creationId: string
): string {
  const localSeq = parseCreationId(creationId)?.localSeq ?? 0;
  const candidate = `${proposedSemanticId}-collision-${actorId}-${commitId}-${localSeq}`;
  if (isSpikeId(candidate)) return candidate;
  const hash = new Bun.CryptoHasher('sha256')
    .update(`${proposedSemanticId}\u0000${actorId}\u0000${commitId}\u0000${creationId}`)
    .digest('hex');
  return `derived-${hash.slice(0, 40)}`;
}
