/** @spike-features insert-delete-split-join-operations, origin-metadata */
import type { DocOpSingle } from '../../contracts/doc-op';
import { isSpikeId } from '../../contracts/ids';
import {
  findParagraphByBlockId,
  findParagraphIdByBlockId,
  type MutableDraft,
} from '../draft';
import type { MutationTrace } from '../mutate';
import {
  createVersionedDocOpPayload,
  type IdentityTombstone,
  type VersionedDocOpPayload,
} from './types';

export function computeInverseOps(
  beforeDraft: MutableDraft,
  forwardOps: readonly DocOpSingle[],
  tombstones: readonly IdentityTombstone[] = []
): readonly DocOpSingle[] {
  const inverses: DocOpSingle[] = [];
  for (let index = forwardOps.length - 1; index >= 0; index -= 1) {
    inverses.push(invertSingleOp(beforeDraft, forwardOps[index]!, tombstones));
  }
  return Object.freeze(inverses);
}

function invertSingleOp(
  beforeDraft: MutableDraft,
  op: DocOpSingle,
  tombstones: readonly IdentityTombstone[] = []
): DocOpSingle {
  switch (op.kind) {
    case 'insertText':
      return {
        kind: 'deleteRange',
        storyId: op.storyId,
        blockId: op.blockId,
        start: op.offset,
        end: op.offset + op.text.length,
      };
    case 'deleteRange': {
      const paragraph = findParagraphByBlockId(beforeDraft, op.blockId);
      if (!paragraph) throw new TypeError('inverse delete requires before paragraph');
      return {
        kind: 'insertText',
        storyId: op.storyId,
        blockId: op.blockId,
        offset: op.start,
        text: paragraph.text.slice(op.start, op.end),
      };
    }
    case 'splitParagraph': {
      const tailBlockId =
        tombstones.find(
          (tombstone) =>
            tombstone.role === 'split-tail' &&
            tombstone.kind === 'block' &&
            tombstone.headId === op.blockId
        )?.restoredId ?? `${op.blockId}-tail`;
      return {
        kind: 'joinParagraphs',
        storyId: op.storyId,
        firstBlockId: op.blockId,
        secondBlockId: tailBlockId,
      };
    }
    case 'joinParagraphs': {
      const first = findParagraphByBlockId(beforeDraft, op.firstBlockId);
      if (!first) throw new TypeError('inverse join requires before first paragraph');
      return {
        kind: 'splitParagraph',
        storyId: op.storyId,
        blockId: op.firstBlockId,
        offset: first.text.length,
      };
    }
    case 'setMark':
      return {
        kind: 'setMark',
        storyId: op.storyId,
        blockId: op.blockId,
        mark: op.mark,
        start: op.start,
        end: op.end,
        enabled: !op.enabled,
      };
    default:
      throw new TypeError('unknown op kind for inverse');
  }
}

export function extractIdentityTombstones(
  beforeDraft: MutableDraft,
  afterDraft: MutableDraft,
  forwardOps: readonly DocOpSingle[],
  trace: MutationTrace
): readonly IdentityTombstone[] {
  const tombstones: IdentityTombstone[] = [];
  for (const op of forwardOps) {
    if (op.kind === 'splitParagraph') {
      const paragraphId = findParagraphIdByBlockId(beforeDraft, op.blockId);
      if (!paragraphId) continue;
      const tailBlockId =
        [...trace.structuralProvenance.keys()].find(
          (id) => id !== op.blockId && trace.structuralProvenance.get(id)?.splitOffset === op.offset
        ) ??
        [...trace.affectedBlockIds].find(
          (id) => id !== op.blockId && !findParagraphByBlockId(beforeDraft, id)
        );
      if (!tailBlockId || !isSpikeId(tailBlockId)) continue;
      const tailParagraphId = findParagraphIdByBlockId(afterDraft, tailBlockId);
      if (!tailParagraphId || !isSpikeId(tailParagraphId)) continue;
      tombstones.push(
        Object.freeze({
          version: 'identity-tombstone/1',
          kind: 'block',
          restoredId: tailBlockId,
          role: 'split-tail',
          headId: op.blockId,
          splitOffset: op.offset,
        }),
        Object.freeze({
          version: 'identity-tombstone/1',
          kind: 'paragraph',
          restoredId: tailParagraphId,
          role: 'split-tail',
          headId: paragraphId,
          splitOffset: op.offset,
        })
      );
      for (const mapping of trace.identityMappings) {
        if (mapping.kind === 'mark' && mapping.afterId && mapping.beforeId !== mapping.afterId) {
          tombstones.push(
            Object.freeze({
              version: 'identity-tombstone/1',
              kind: 'mark',
              restoredId: mapping.afterId,
              role: 'remapped',
              headId: mapping.beforeId,
            })
          );
        }
      }
    }
    if (op.kind === 'joinParagraphs') {
      tombstones.push(
        Object.freeze({
          version: 'identity-tombstone/1',
          kind: 'block',
          restoredId: op.secondBlockId,
          role: 'deleted',
          headId: op.firstBlockId,
        }),
        Object.freeze({
          version: 'identity-tombstone/1',
          kind: 'paragraph',
          restoredId: findParagraphIdByBlockId(beforeDraft, op.secondBlockId) ?? op.secondBlockId,
          role: 'deleted',
          headId: findParagraphIdByBlockId(beforeDraft, op.firstBlockId) ?? op.firstBlockId,
        })
      );
    }
  }
  for (const blockId of trace.removedBlockIds) {
    if (!tombstones.some((t) => t.restoredId === blockId)) {
      tombstones.push(
        Object.freeze({
          version: 'identity-tombstone/1',
          kind: 'block',
          restoredId: blockId,
          role: 'deleted',
        })
      );
    }
  }
  if (forwardOps.some((op) => op.kind === 'setMark')) {
    for (const mapping of trace.identityMappings) {
      if (
        mapping.kind === 'mark' &&
        mapping.beforeId !== mapping.afterId &&
        isSpikeId(mapping.beforeId) &&
        isSpikeId(mapping.afterId)
      ) {
        tombstones.push(
          Object.freeze({
            version: 'identity-tombstone/1',
            kind: 'mark',
            restoredId: mapping.beforeId,
            role: 'remapped',
            headId: mapping.afterId,
          })
        );
      }
    }
  }
  return Object.freeze(tombstones);
}

export function buildVersionedInverse(
  beforeDraft: MutableDraft,
  forwardOps: readonly DocOpSingle[]
): VersionedDocOpPayload {
  return createVersionedDocOpPayload([...computeInverseOps(beforeDraft, forwardOps)]);
}

export function buildVersionedForward(forwardOps: readonly DocOpSingle[]): VersionedDocOpPayload {
  return createVersionedDocOpPayload([...forwardOps]);
}

export function tombstoneReservedIds(tombstones: readonly IdentityTombstone[]): readonly string[] {
  const ids = new Set<string>();
  for (const tombstone of tombstones) {
    ids.add(tombstone.restoredId);
    if (tombstone.headId) ids.add(tombstone.headId);
  }
  return Object.freeze([...ids].sort());
}
