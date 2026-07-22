/** @spike-features insert-delete-split-join-operations, local-backend, origin-metadata */
import type { DirtyDependency, IdentityMapping, StructuralRange } from '../contracts/model-change';
import { compactDerivedId } from './operation-environment';
import {
  findParagraphByBlockId,
  type MutableDraft,
} from './draft';
import type { MutationTrace } from './mutate';

export function structuralRangesForAffectedDraft(
  draft: MutableDraft,
  trace: MutationTrace
): StructuralRange[] {
  const ranges: StructuralRange[] = [];
  const blockIds = new Set([
    ...trace.affectedBlockIds,
    ...trace.removedBlockIds,
  ]);
  for (const blockId of blockIds) {
    const paragraph = findParagraphByBlockId(draft, blockId);
    if (!paragraph) continue;
    ranges.push({
      storyId: draft.storyId,
      blockId,
      start: 0,
      end: paragraph.text.length,
    });
  }
  return ranges;
}

export function dedupeIdentityMappings(
  mappings: Array<{ kind: IdentityMapping['kind']; beforeId: string; afterId: string }>
): IdentityMapping[] {
  const seen = new Set<string>();
  const result: IdentityMapping[] = [];
  for (const mapping of mappings) {
    const key = `${mapping.kind}\u0000${mapping.beforeId}\u0000${mapping.afterId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(mapping);
  }
  return result;
}

export function dirtyDependenciesFor(
  trace: MutationTrace,
  beforeDraft: MutableDraft,
  afterDraft: MutableDraft
): DirtyDependency[] {
  const dependencies: DirtyDependency[] = [];
  const seen = new Set<string>();
  const blockIds = new Set([...trace.affectedBlockIds, ...trace.removedBlockIds]);
  for (const blockId of blockIds) {
    const paragraph =
      findParagraphByBlockId(afterDraft, blockId) ??
      findParagraphByBlockId(beforeDraft, blockId);
    if (!paragraph) continue;
    const blockKey = `block\u0000${blockId}`;
    if (!seen.has(blockKey)) {
      seen.add(blockKey);
      dependencies.push({ dependencyKind: 'block', targetId: blockId });
    }
    const styleKey = `style\u0000${paragraph.styleId}`;
    if (!seen.has(styleKey)) {
      seen.add(styleKey);
      dependencies.push({ dependencyKind: 'style', targetId: paragraph.styleId });
    }
  }
  for (const markId of trace.affectedMarkIds) {
    const markKey = `mark\u0000${markId}`;
    if (seen.has(markKey)) continue;
    seen.add(markKey);
    dependencies.push({ dependencyKind: 'mark', targetId: markId });
  }
  return dependencies;
}

export function repairConstituentId(
  constituentIds: readonly string[],
  commitId: string
): string {
  const source = constituentIds[0] ?? commitId;
  const semanticSource = source.startsWith('op-') ? source.slice(3) : source;
  return compactDerivedId(
    `repair-${semanticSource}`,
    `repair:${semanticSource}`
  );
}

export function normalizationOwnerId(
  actorId: string,
  constituentIds: readonly string[],
  commitId: string
): string {
  const normalized = constituentIds.find((id) =>
    /^op-normalized-[0-9]+$/.test(id)
  );
  if (!normalized) return commitId;
  const shortActor = actorId.startsWith('actor-')
    ? actorId.slice('actor-'.length)
    : actorId;
  let semantic = normalized.startsWith('op-')
    ? normalized.slice(3)
    : normalized;
  if (semantic.startsWith(`${shortActor}-`)) {
    semantic = semantic.slice(shortActor.length + 1);
  }
  return compactDerivedId(
    `commit-${shortActor}-${semantic}`,
    `normalization-owner:${actorId}:${normalized}`
  );
}
