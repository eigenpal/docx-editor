/** @spike-features yjs-backend */
import { canonicalJson } from '../../canonical-json';
import type { DecodedYjsModel } from '../../comparators/yjs-schema-fingerprint';
import type {
  DirtyDependency,
  IdentityMapping,
  StructuralRange,
} from '../../contracts/model-change';
import type { AuthoredParagraph, DocumentModel } from '../../model/types';
import type { BackendCommitResult } from './types';

export function createRemoteCommitResult(input: {
  readonly commitId: string;
  readonly beforeModel: DocumentModel;
  readonly afterModel: DocumentModel;
  readonly beforeYjs: DecodedYjsModel;
  readonly afterYjs: DecodedYjsModel;
  readonly appliedRepair: boolean;
}): BackendCommitResult {
  const affectedBlocks = collectAffectedBlockIds(input.beforeModel, input.afterModel);
  for (const tombstone of input.afterYjs.tombstones) {
    if (tombstone.recordKind !== 'block') continue;
    const winner = input.afterYjs.blocks.find(
      (block) => block.proposedSemanticId === tombstone.proposedSemanticId
    );
    if (winner) affectedBlocks.add(winner.semanticId);
  }
  const structuralRangesBefore = structuralRanges(input.beforeModel, affectedBlocks);
  const structuralRangesAfter = structuralRanges(input.afterModel, affectedBlocks);
  const beforeRangeIds = new Set(structuralRangesBefore.map((range) => range.blockId));
  const afterRangeIds = new Set(structuralRangesAfter.map((range) => range.blockId));
  const identityMappings = identityMappingsFor(input).filter(
    (mapping) =>
      mapping.kind !== 'block' ||
      ((mapping.beforeId === null ||
        beforeRangeIds.has(mapping.beforeId) ||
        input.appliedRepair) &&
        (mapping.afterId === null || afterRangeIds.has(mapping.afterId)))
  );
  return Object.freeze({
    commitId: input.commitId,
    revisionBefore: input.beforeModel.revision,
    revisionAfter: input.afterModel.revision,
    identityMappings: Object.freeze(identityMappings.map((value) => Object.freeze(value))),
    structuralRangesBefore: Object.freeze(
      structuralRangesBefore.map((value) => Object.freeze(value))
    ),
    structuralRangesAfter: Object.freeze(
      structuralRangesAfter.map((value) => Object.freeze(value))
    ),
    dirtyDependencies: Object.freeze(
      dirtyDependencies(
        input.beforeModel,
        input.afterModel,
        affectedBlocks,
        identityMappings
      ).map((value) => Object.freeze(value))
    ),
    normalized: true,
    appliedRepair: input.appliedRepair,
    historyCommit: null,
  });
}

function collectAffectedBlockIds(
  before: DocumentModel,
  after: DocumentModel
): Set<string> {
  const ids = new Set([
    ...[...before.authored.body.paragraphs.values()].map(
      (paragraph) => paragraph.blockId
    ),
    ...[...after.authored.body.paragraphs.values()].map(
      (paragraph) => paragraph.blockId
    ),
  ]);
  const affected = new Set<string>();
  for (const blockId of ids) {
    const beforeParagraph = paragraphByBlockId(before, blockId);
    const afterParagraph = paragraphByBlockId(after, blockId);
    if (
      beforeParagraph === undefined ||
      afterParagraph === undefined ||
      canonicalJson(beforeParagraph) !== canonicalJson(afterParagraph)
    ) {
      affected.add(blockId);
    }
  }
  return affected;
}

function structuralRanges(
  model: DocumentModel,
  blockIds: ReadonlySet<string>
): StructuralRange[] {
  return [...blockIds]
    .map((blockId) => {
      const paragraph = paragraphByBlockId(model, blockId);
      return paragraph
        ? {
            storyId: model.authored.body.storyId,
            blockId,
            start: 0,
            end: paragraph.text.length,
          }
        : undefined;
    })
    .filter((value): value is StructuralRange => value !== undefined)
    .sort((left, right) => left.blockId.localeCompare(right.blockId));
}

function identityMappingsFor(input: {
  readonly beforeModel: DocumentModel;
  readonly afterModel: DocumentModel;
  readonly beforeYjs: DecodedYjsModel;
  readonly afterYjs: DecodedYjsModel;
}): IdentityMapping[] {
  const mappings: IdentityMapping[] = [];
  const beforeBlocks = new Map(input.beforeYjs.blocks.map((record) => [record.creationId, record]));
  const afterBlocks = new Map(input.afterYjs.blocks.map((record) => [record.creationId, record]));
  const changedAfterBlocks = collectAffectedBlockIds(input.beforeModel, input.afterModel);
  for (const creationId of new Set([...beforeBlocks.keys(), ...afterBlocks.keys()])) {
    const before = beforeBlocks.get(creationId);
    const after = afterBlocks.get(creationId);
    if (!before && after) {
      mappings.push(
        { kind: 'block', beforeId: null, afterId: after.semanticId },
        { kind: 'paragraph', beforeId: null, afterId: after.paragraphId }
      );
    } else if (before && !after) {
      const joinTarget = precedingChangedBlock(
        input.beforeModel,
        input.afterModel,
        before.semanticId,
        changedAfterBlocks
      );
      const targetParagraph = joinTarget
        ? paragraphByBlockId(input.afterModel, joinTarget)?.paragraphId ?? null
        : null;
      mappings.push(
        { kind: 'block', beforeId: before.semanticId, afterId: joinTarget },
        { kind: 'paragraph', beforeId: before.paragraphId, afterId: targetParagraph }
      );
    } else if (before && after) {
      if (before.semanticId !== after.semanticId) {
        mappings.push({
          kind: 'block',
          beforeId: before.semanticId,
          afterId: after.semanticId,
        });
      }
      if (before.paragraphId !== after.paragraphId) {
        mappings.push({
          kind: 'paragraph',
          beforeId: before.paragraphId,
          afterId: after.paragraphId,
        });
      }
    }
  }
  const beforeMarks = new Map(input.beforeYjs.marks.map((record) => [record.creationId, record]));
  const afterMarks = new Map(input.afterYjs.marks.map((record) => [record.creationId, record]));
  for (const creationId of new Set([...beforeMarks.keys(), ...afterMarks.keys()])) {
    const before = beforeMarks.get(creationId);
    const after = afterMarks.get(creationId);
    if (!before && after) {
      mappings.push({ kind: 'mark', beforeId: null, afterId: after.semanticId });
    } else if (before && !after) {
      mappings.push({ kind: 'mark', beforeId: before.semanticId, afterId: null });
    } else if (
      before &&
      after &&
      (before.semanticId !== after.semanticId ||
        canonicalJson(before) !== canonicalJson(after))
    ) {
      mappings.push({
        kind: 'mark',
        beforeId: before.semanticId,
        afterId: after.semanticId,
      });
    }
  }
  const beforeCandidates = new Map(
    input.beforeYjs.collisionCandidates.map((candidate) => [
      candidate.creationId,
      candidate,
    ])
  );
  for (const candidate of input.afterYjs.collisionCandidates) {
    if (candidate.semanticId === candidate.proposedSemanticId) continue;
    if (beforeCandidates.get(candidate.creationId)?.semanticId === candidate.semanticId) {
      continue;
    }
    const block = afterBlocks.get(candidate.creationId);
    if (block) {
      mappings.push(
        {
          kind: 'block',
          beforeId: candidate.proposedSemanticId,
          afterId: candidate.semanticId,
        },
        {
          kind: 'paragraph',
          beforeId: block.proposedParagraphId,
          afterId: block.paragraphId,
        }
      );
      continue;
    }
    if (afterMarks.has(candidate.creationId)) {
      mappings.push({
        kind: 'mark',
        beforeId: candidate.proposedSemanticId,
        afterId: candidate.semanticId,
      });
    }
  }
  for (const tombstone of input.afterYjs.tombstones) {
    if (tombstone.recordKind !== 'block') continue;
    const winner = input.afterYjs.blocks.find(
      (block) => block.proposedSemanticId === tombstone.proposedSemanticId
    );
    if (winner && winner.semanticId !== tombstone.semanticId) {
      mappings.push({
        kind: 'block',
        beforeId: tombstone.semanticId,
        afterId: winner.semanticId,
      });
    }
  }
  return dedupeMappings(mappings);
}

function precedingChangedBlock(
  before: DocumentModel,
  after: DocumentModel,
  removedBlockId: string,
  affectedAfter: ReadonlySet<string>
): string | null {
  const order = before.authored.body.paragraphOrder;
  const removedParagraph = paragraphByBlockId(before, removedBlockId);
  if (!removedParagraph) return null;
  const index = order.indexOf(removedParagraph.paragraphId);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const paragraphId = order[cursor]!;
    const paragraph = before.authored.body.paragraphs.get(paragraphId);
    if (
      paragraph &&
      paragraphByBlockId(after, paragraph.blockId) &&
      affectedAfter.has(paragraph.blockId)
    ) {
      return paragraph.blockId;
    }
  }
  return null;
}

function dirtyDependencies(
  before: DocumentModel,
  after: DocumentModel,
  blockIds: ReadonlySet<string>,
  mappings: readonly IdentityMapping[]
): DirtyDependency[] {
  const values = new Map<string, DirtyDependency>();
  for (const blockId of blockIds) {
    values.set(`block\u0000${blockId}`, { dependencyKind: 'block', targetId: blockId });
    for (const model of [before, after]) {
      const paragraph = paragraphByBlockId(model, blockId);
      if (paragraph) {
        values.set(`style\u0000${paragraph.styleId}`, {
          dependencyKind: 'style',
          targetId: paragraph.styleId,
        });
      }
    }
  }
  for (const mapping of mappings) {
    if (mapping.kind !== 'mark') continue;
    for (const markId of [mapping.beforeId, mapping.afterId]) {
      if (markId !== null) {
        values.set(`mark\u0000${markId}`, {
          dependencyKind: 'mark',
          targetId: markId,
        });
      }
    }
  }
  return [...values.values()];
}

function paragraphByBlockId(
  model: DocumentModel,
  blockId: string
): AuthoredParagraph | undefined {
  return [...model.authored.body.paragraphs.values()].find(
    (paragraph) => paragraph.blockId === blockId
  );
}

function dedupeMappings(mappings: readonly IdentityMapping[]): IdentityMapping[] {
  const seen = new Set<string>();
  return mappings.filter((mapping) => {
    const key = `${mapping.kind}\u0000${mapping.beforeId ?? ''}\u0000${mapping.afterId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
