/** @spike-features insert-delete-split-join-operations, bold-mark, italic-mark */
import bindingOracle from '../../oracles/binding-oracle.v1.json';
import type { DocOpMarkKind, DocOpSingle } from '../contracts/doc-op';
import type { AuthoredMark } from '../model/types';
import {
  allocateMarkId,
  allocateSemanticId,
  registerSemanticId,
  type OperationEnvironment,
} from './operation-environment';
import {
  areAdjacentParagraphs,
  findParagraphByBlockId,
  findParagraphIdByBlockId,
  type MutableDraft,
  type MutableParagraph,
} from './draft';
import { isValidUtf16Boundary, isValidUtf16Range, isValidUtf16String } from './utf16';

export interface MutationTrace {
  readonly affectedBlockIds: Set<string>;
  readonly identityMappings: Array<{
    kind: 'block' | 'paragraph' | 'mark';
    beforeId: string;
    afterId: string;
  }>;
  readonly removedBlockIds: Set<string>;
  readonly removedParagraphIds: Set<string>;
  readonly removedMarkIds: Set<string>;
  readonly addedMarkIds: Set<string>;
  readonly affectedMarkIds: Set<string>;
  readonly structuralProvenance: Map<
    string,
    {
      splitOffset?: number;
      originalTail?: string;
      editEvents: Array<{
        kind: 'insert' | 'delete';
        offset: number;
        text?: string;
        length?: number;
      }>;
    }
  >;
}

export function createMutationTrace(): MutationTrace {
  return {
    affectedBlockIds: new Set(),
    identityMappings: [],
    removedBlockIds: new Set(),
    removedParagraphIds: new Set(),
    removedMarkIds: new Set(),
    addedMarkIds: new Set(),
    affectedMarkIds: new Set(),
    structuralProvenance: new Map(),
  };
}

export class BatchValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function validateAndStageBatch(
  draft: MutableDraft,
  ops: readonly DocOpSingle[],
  env: OperationEnvironment,
  trace: MutationTrace,
  identityRestoration: readonly import('./history/types').IdentityTombstone[] = []
): OperationEnvironment {
  let currentEnv = env;
  for (const op of ops) {
    currentEnv = validateAndApplySingle(draft, op, currentEnv, trace, identityRestoration);
  }
  return currentEnv;
}

function validateAndApplySingle(
  draft: MutableDraft,
  op: DocOpSingle,
  env: OperationEnvironment,
  trace: MutationTrace,
  identityRestoration: readonly import('./history/types').IdentityTombstone[] = []
): OperationEnvironment {
  if (op.storyId !== draft.storyId) {
    throw new BatchValidationError('invalid-story', 'storyId does not match body story');
  }
  switch (op.kind) {
    case 'insertText':
      applyInsertText(draft, op.blockId, op.offset, op.text, trace);
      return env;
    case 'deleteRange':
      applyDeleteRange(draft, op.blockId, op.start, op.end, trace);
      return env;
    case 'splitParagraph':
      return applySplitParagraph(draft, op.blockId, op.offset, env, trace, identityRestoration);
    case 'joinParagraphs':
      applyJoinParagraphs(draft, op.firstBlockId, op.secondBlockId, trace);
      return env;
    case 'setMark':
      return applySetMark(
        draft,
        op.blockId,
        op.mark,
        op.start,
        op.end,
        op.enabled,
        env,
        trace,
        identityRestoration
      );
    default:
      throw new BatchValidationError('unknown-op', 'unknown DocOp kind');
  }
}

function requireParagraph(draft: MutableDraft, blockId: string): MutableParagraph {
  const paragraph = findParagraphByBlockId(draft, blockId);
  if (!paragraph) throw new BatchValidationError('missing-block', `block ${blockId} not found`);
  return paragraph;
}

function touchBlock(trace: MutationTrace, blockId: string): void {
  trace.affectedBlockIds.add(blockId);
}

function applyInsertText(
  draft: MutableDraft,
  blockId: string,
  offset: number,
  text: string,
  trace: MutationTrace
): void {
  if (text.length === 0) return;
  if (!isValidUtf16String(text)) {
    throw new BatchValidationError('invalid-text', 'insert text contains unpaired surrogates');
  }
  const paragraph = requireParagraph(draft, blockId);
  if (!isValidUtf16Boundary(paragraph.text, offset)) {
    throw new BatchValidationError('invalid-offset', 'insert offset splits a surrogate pair');
  }
  touchBlock(trace, blockId);
  const beforeMarks = paragraph.marks.map((mark) => ({ ...mark }));
  paragraph.text = paragraph.text.slice(0, offset) + text + paragraph.text.slice(offset);
  paragraph.marks = shiftMarksForInsert(paragraph.marks, offset, text.length);
  recordStableMarkChanges(beforeMarks, paragraph.marks, trace);
  if (isSplitTailCandidate(trace, blockId)) {
    touchStructuralProvenance(trace, blockId).editEvents.push({
      kind: 'insert',
      offset,
      text,
    });
  }
}

function shiftMarksForInsert(marks: AuthoredMark[], offset: number, length: number): AuthoredMark[] {
  return marks.map((mark) => {
    if (mark.end <= offset) return mark;
    if (mark.start >= offset) {
      return { ...mark, start: mark.start + length, end: mark.end + length };
    }
    return { ...mark, end: mark.end + length };
  });
}

function applyDeleteRange(
  draft: MutableDraft,
  blockId: string,
  start: number,
  end: number,
  trace: MutationTrace
): void {
  const paragraph = requireParagraph(draft, blockId);
  if (!isValidUtf16Range(paragraph.text, start, end)) {
    throw new BatchValidationError('invalid-range', 'delete range is invalid');
  }
  if (start === end) return;
  touchBlock(trace, blockId);
  const beforeMarks = paragraph.marks.map((mark) => ({ ...mark }));
  const deletedLength = end - start;
  paragraph.text = paragraph.text.slice(0, start) + paragraph.text.slice(end);
  paragraph.marks = transformMarksForDelete(paragraph.marks, start, end, deletedLength);
  recordStableMarkChanges(beforeMarks, paragraph.marks, trace);
  if (isSplitTailCandidate(trace, blockId)) {
    touchStructuralProvenance(trace, blockId).editEvents.push({
      kind: 'delete',
      offset: start,
      length: deletedLength,
    });
  }
}

function transformMarksForDelete(
  marks: AuthoredMark[],
  start: number,
  end: number,
  deletedLength: number
): AuthoredMark[] {
  return marks
    .flatMap((mark) => {
      if (mark.end <= start || mark.start >= end) {
        if (mark.start >= end) {
          return [{ ...mark, start: mark.start - deletedLength, end: mark.end - deletedLength }];
        }
        return [mark];
      }
      if (mark.start < start && mark.end > end) {
        return [{ ...mark, end: mark.end - deletedLength }];
      }
      if (mark.start < start) return [{ ...mark, end: start }];
      if (mark.end > end) return [{ ...mark, start, end: mark.end - deletedLength }];
      return [];
    })
    .filter((mark) => mark.end > mark.start);
}

function applySplitParagraph(
  draft: MutableDraft,
  blockId: string,
  offset: number,
  env: OperationEnvironment,
  trace: MutationTrace,
  identityRestoration: readonly import('./history/types').IdentityTombstone[] = []
): OperationEnvironment {
  const paragraph = requireParagraph(draft, blockId);
  if (!isValidUtf16Boundary(paragraph.text, offset)) {
    throw new BatchValidationError('invalid-offset', 'split offset splits a surrogate pair');
  }
  if (offset <= 0 || offset >= paragraph.text.length) {
    throw new BatchValidationError('invalid-split', 'split offset must split non-empty fragments');
  }
  const paragraphId = findParagraphIdByBlockId(draft, blockId);
  if (!paragraphId) throw new BatchValidationError('missing-block', `block ${blockId} not found`);

  const paragraphAllocation = allocateSemanticId(env, `${paragraphId}-tail`);
  const blockTombstone = identityRestoration.find(
    (tombstone) =>
      (tombstone.role === 'split-tail' || tombstone.role === 'deleted') &&
      tombstone.kind === 'block' &&
      tombstone.headId === blockId
  );
  const paragraphTombstone = identityRestoration.find(
    (tombstone) =>
      (tombstone.role === 'split-tail' || tombstone.role === 'deleted') &&
      tombstone.kind === 'paragraph' &&
      tombstone.headId === paragraphId
  );
  const nextParagraphId = paragraphTombstone?.restoredId ?? paragraphAllocation.semanticId;
  const blockAllocation = allocateSemanticId(
    paragraphTombstone ? registerSemanticId(paragraphAllocation.env, nextParagraphId) : paragraphAllocation.env,
    `${blockId}-tail`
  );
  const nextBlockId = blockTombstone?.restoredId ?? blockAllocation.semanticId;
  let currentEnv = blockTombstone
    ? registerSemanticId(blockAllocation.env, nextBlockId)
    : blockAllocation.env;
  currentEnv = registerSemanticId(currentEnv, nextParagraphId);

  touchBlock(trace, blockId);
  touchBlock(trace, nextBlockId);

  const firstText = paragraph.text.slice(0, offset);
  const secondText = paragraph.text.slice(offset);
  const { firstMarks, secondMarks, env: markEnv } = splitMarks(
    paragraph.marks,
    offset,
    nextParagraphId,
    currentEnv,
    trace
  );

  paragraph.text = firstText;
  paragraph.marks = firstMarks;

  draft.paragraphs.set(nextParagraphId, {
    blockId: nextBlockId,
    paragraphId: nextParagraphId,
    text: secondText,
    styleId: paragraph.styleId,
    marks: secondMarks,
    authoredProperties: { ...paragraph.authoredProperties },
  });
  const index = draft.paragraphOrder.indexOf(paragraphId);
  draft.paragraphOrder.splice(index + 1, 0, nextParagraphId);

  const structural = touchStructuralProvenance(trace, nextBlockId);
  structural.splitOffset = offset;
  structural.originalTail = secondText;

  trace.identityMappings.push(
    { kind: 'block', beforeId: blockId, afterId: blockId },
    { kind: 'paragraph', beforeId: paragraphId, afterId: paragraphId }
  );

  currentEnv = registerSemanticId(markEnv, nextBlockId);
  currentEnv = registerSemanticId(currentEnv, nextParagraphId);
  for (const mark of secondMarks) currentEnv = registerSemanticId(currentEnv, mark.markId);
  return currentEnv;
}

function splitMarks(
  marks: AuthoredMark[],
  offset: number,
  tailParagraphId: string,
  env: OperationEnvironment,
  trace: MutationTrace
): { firstMarks: AuthoredMark[]; secondMarks: AuthoredMark[]; env: OperationEnvironment } {
  const firstMarks: AuthoredMark[] = [];
  const secondMarks: AuthoredMark[] = [];
  let currentEnv = env;
  for (const mark of marks) {
    if (mark.end <= offset) {
      firstMarks.push({ ...mark });
      continue;
    }
    if (mark.start >= offset) {
      const allocated = allocateMarkId(currentEnv, tailParagraphId, mark.kind);
      currentEnv = allocated.env;
      secondMarks.push({
        markId: allocated.markId,
        kind: mark.kind,
        start: mark.start - offset,
        end: mark.end - offset,
      });
      trace.addedMarkIds.add(allocated.markId);
      trace.affectedMarkIds.add(allocated.markId);
      trace.removedMarkIds.add(mark.markId);
      trace.affectedMarkIds.add(mark.markId);
      trace.identityMappings.push({
        kind: 'mark',
        beforeId: mark.markId,
        afterId: allocated.markId,
      });
      continue;
    }
    firstMarks.push({ ...mark, end: offset });
    trace.affectedMarkIds.add(mark.markId);
    trace.identityMappings.push({ kind: 'mark', beforeId: mark.markId, afterId: mark.markId });
    const allocated = allocateMarkId(currentEnv, tailParagraphId, mark.kind);
    currentEnv = allocated.env;
    secondMarks.push({
      markId: allocated.markId,
      kind: mark.kind,
      start: 0,
      end: mark.end - offset,
    });
    trace.addedMarkIds.add(allocated.markId);
    trace.affectedMarkIds.add(allocated.markId);
    trace.identityMappings.push({
      kind: 'mark',
      beforeId: mark.markId,
      afterId: allocated.markId,
    });
  }
  return { firstMarks, secondMarks, env: currentEnv };
}

function applyJoinParagraphs(
  draft: MutableDraft,
  firstBlockId: string,
  secondBlockId: string,
  trace: MutationTrace
): void {
  if (firstBlockId === secondBlockId) {
    throw new BatchValidationError('invalid-join', 'join targets must differ');
  }
  const first = requireParagraph(draft, firstBlockId);
  requireParagraph(draft, secondBlockId);
  const firstParagraphId = findParagraphIdByBlockId(draft, firstBlockId);
  const secondParagraphId = findParagraphIdByBlockId(draft, secondBlockId);
  if (!firstParagraphId || !secondParagraphId) {
    throw new BatchValidationError('missing-block', 'join target paragraph missing');
  }
  if (!areAdjacentParagraphs(draft, firstParagraphId, secondParagraphId)) {
    throw new BatchValidationError('non-adjacent', 'join targets must be adjacent paragraphs');
  }
  if (
    draft.capsules.some(
      (capsule) => capsule.ownerStoryId === draft.storyId && capsule.ownerBlockId === secondBlockId
    )
  ) {
    throw new BatchValidationError(
      'capsule-owner',
      'join cannot delete the frozen capsule owner block'
    );
  }

  const second = draft.paragraphs.get(secondParagraphId)!;
  touchBlock(trace, firstBlockId);
  trace.removedBlockIds.add(secondBlockId);
  trace.removedParagraphIds.add(secondParagraphId);

  const offset = first.text.length;
  const beforeMarks = [...first.marks, ...second.marks].map((mark) => ({ ...mark }));
  first.text = first.text + second.text;
  first.marks = [
    ...first.marks,
    ...second.marks.map((mark) => ({
      ...mark,
      start: mark.start + offset,
      end: mark.end + offset,
    })),
  ];
  recordStableMarkChanges(beforeMarks, first.marks, trace);

  draft.paragraphs.delete(secondParagraphId);
  draft.paragraphOrder = draft.paragraphOrder.filter((id) => id !== secondParagraphId);

  trace.identityMappings.push(
    { kind: 'block', beforeId: secondBlockId, afterId: firstBlockId },
    { kind: 'paragraph', beforeId: secondParagraphId, afterId: firstParagraphId }
  );
}

function applySetMark(
  draft: MutableDraft,
  blockId: string,
  markKind: DocOpMarkKind,
  start: number,
  end: number,
  enabled: boolean,
  env: OperationEnvironment,
  trace: MutationTrace,
  identityRestoration: readonly import('./history/types').IdentityTombstone[] = []
): OperationEnvironment {
  const paragraph = requireParagraph(draft, blockId);
  if (!isValidUtf16Range(paragraph.text, start, end) || end <= start) {
    throw new BatchValidationError('invalid-range', 'mark range is invalid');
  }
  const paragraphId = findParagraphIdByBlockId(draft, blockId) ?? paragraph.paragraphId;
  if (!enabled) {
    const removed = subtractMarkKindInRange(
      paragraph.marks,
      paragraphId,
      markKind,
      start,
      end,
      env,
      trace
    );
    if (removed.changed) {
      touchBlock(trace, blockId);
      paragraph.marks = removed.marks.map((mark) => {
        const tombstone = identityRestoration.find(
          (candidate) =>
            candidate.kind === 'mark' &&
            candidate.role === 'remapped' &&
            candidate.headId === mark.markId
        );
        if (!tombstone) return mark;
        trace.identityMappings.push({
          kind: 'mark',
          beforeId: mark.markId,
          afterId: tombstone.restoredId,
        });
        return { ...mark, markId: tombstone.restoredId };
      });
    }
    return removed.env;
  }
  if (
    paragraph.marks.some(
      (mark) => mark.kind === markKind && mark.start <= start && mark.end >= end
    )
  ) {
    return env;
  }
  touchBlock(trace, blockId);
  const sameKind = paragraph.marks.filter((mark) => mark.kind === markKind);
  let rangeStart = start;
  let rangeEnd = end;
  const consumed = new Set<string>();
  for (const mark of sameKind) {
    if (mark.end >= rangeStart && mark.start <= rangeEnd) {
      rangeStart = Math.min(rangeStart, mark.start);
      rangeEnd = Math.max(rangeEnd, mark.end);
      consumed.add(mark.markId);
    }
  }
  const kept = paragraph.marks.filter((mark) => !consumed.has(mark.markId));
  const allocated = allocateMarkId(env, paragraphId, markKind);
  const newMark: AuthoredMark = {
    markId: allocated.markId,
    kind: markKind,
    start: rangeStart,
    end: rangeEnd,
  };
  kept.push(newMark);
  paragraph.marks = kept;
  trace.addedMarkIds.add(newMark.markId);
  trace.affectedMarkIds.add(newMark.markId);
  for (const markId of consumed) {
    trace.removedMarkIds.add(markId);
    trace.affectedMarkIds.add(markId);
    trace.identityMappings.push({
      kind: 'mark',
      beforeId: markId,
      afterId: newMark.markId,
    });
  }
  return allocated.env;
}

function subtractMarkKindInRange(
  marks: AuthoredMark[],
  paragraphId: string,
  kind: DocOpMarkKind,
  start: number,
  end: number,
  env: OperationEnvironment,
  trace: MutationTrace
): {
  marks: AuthoredMark[];
  env: OperationEnvironment;
  changed: boolean;
} {
  const result: AuthoredMark[] = [];
  let currentEnv = env;
  let changed = false;
  for (const mark of marks) {
    if (mark.kind !== kind) {
      result.push({ ...mark });
      continue;
    }
    if (mark.end <= start || mark.start >= end) {
      result.push({ ...mark });
      continue;
    }
    changed = true;
    const hasLeft = mark.start < start;
    const hasRight = mark.end > end;
    if (hasLeft) {
      result.push({ ...mark, end: start });
      trace.identityMappings.push({
        kind: 'mark',
        beforeId: mark.markId,
        afterId: mark.markId,
      });
      trace.affectedMarkIds.add(mark.markId);
    }
    if (hasRight) {
      if (hasLeft) {
        const allocated = allocateMarkId(currentEnv, paragraphId, kind);
        currentEnv = allocated.env;
        result.push({ ...mark, markId: allocated.markId, start: end });
        trace.addedMarkIds.add(allocated.markId);
        trace.affectedMarkIds.add(allocated.markId);
        trace.identityMappings.push({
          kind: 'mark',
          beforeId: mark.markId,
          afterId: allocated.markId,
        });
      } else {
        result.push({ ...mark, start: end });
        trace.identityMappings.push({
          kind: 'mark',
          beforeId: mark.markId,
          afterId: mark.markId,
        });
        trace.affectedMarkIds.add(mark.markId);
      }
    }
    trace.removedMarkIds.add(mark.markId);
  }
  return { marks: result, env: currentEnv, changed };
}

export const NORMALIZATION_PRECEDENCE = bindingOracle.normalizationPrecedence;

export interface NormalizationResult {
  readonly draft: MutableDraft;
  readonly appliedRepair: boolean;
  readonly repairSteps: readonly string[];
}

export function normalizeDraft(draft: MutableDraft, trace: MutationTrace): NormalizationResult {
  let current = draft;
  const repairSteps: string[] = [];
  const touchedBlockIds = new Set(trace.affectedBlockIds);
  const beforeMarks = new Map<string, AuthoredMark[]>();
  for (const blockId of touchedBlockIds) {
    const paragraph = findParagraphByBlockId(draft, blockId);
    if (paragraph) beforeMarks.set(blockId, paragraph.marks.map((mark) => ({ ...mark })));
  }
  for (const step of NORMALIZATION_PRECEDENCE) {
    const next = applyNormalizationStep(current, step, touchedBlockIds);
    if (!draftsEqual(current, next)) repairSteps.push(step);
    current = next;
  }
  for (const [blockId, marks] of beforeMarks) {
    const paragraph = findParagraphByBlockId(current, blockId);
    if (paragraph) recordNormalizationChanges(marks, paragraph.marks, trace);
  }
  return { draft: current, appliedRepair: repairSteps.length > 0, repairSteps };
}

function applyNormalizationStep(
  draft: MutableDraft,
  step: string,
  touchedBlockIds: ReadonlySet<string>
): MutableDraft {
  switch (step) {
    case 'repair-orphaned-mark-endpoints':
      return mapTouchedParagraphs(draft, touchedBlockIds, (paragraph) => ({
        ...paragraph,
        marks: paragraph.marks.map((mark) => ({
          ...mark,
          start: Math.max(0, Math.min(mark.start, paragraph.text.length)),
          end: Math.max(0, Math.min(mark.end, paragraph.text.length)),
        })),
      }));
    case 'collapse-duplicate-semantic-ids-by-collision-precedence':
      return mapTouchedParagraphs(draft, touchedBlockIds, (paragraph) => ({
        ...paragraph,
        marks: collapseDuplicateMarkIds(paragraph.marks),
      }));
    case 'enforce-story-block-order-consistency':
      return draft;
    case 'drop-repair-orphans-after-delete-before-split-join':
      return draft;
    case 'merge-adjacent-text-runs-with-identical-marks':
      return mapTouchedParagraphs(draft, touchedBlockIds, (paragraph) => ({
        ...paragraph,
        marks: mergeAdjacentMarks(paragraph.marks),
      }));
    case 'remove-zero-length-marks':
      return mapTouchedParagraphs(draft, touchedBlockIds, (paragraph) => ({
        ...paragraph,
        marks: paragraph.marks.filter((mark) => mark.end > mark.start),
      }));
    default:
      return draft;
  }
}

function mapTouchedParagraphs(
  draft: MutableDraft,
  touchedBlockIds: ReadonlySet<string>,
  map: (paragraph: MutableParagraph) => MutableParagraph
): MutableDraft {
  const paragraphs = new Map<string, MutableParagraph>();
  for (const [paragraphId, paragraph] of draft.paragraphs) {
    paragraphs.set(
      paragraphId,
      touchedBlockIds.has(paragraph.blockId) ? map(paragraph) : paragraph
    );
  }
  return { ...draft, paragraphs };
}

function collapseDuplicateMarkIds(marks: AuthoredMark[]): AuthoredMark[] {
  const byId = new Map<string, AuthoredMark[]>();
  for (const mark of marks) {
    const group = byId.get(mark.markId) ?? [];
    group.push(mark);
    byId.set(mark.markId, group);
  }
  const result: AuthoredMark[] = [];
  for (const [markId, group] of byId) {
    if (group.length === 1) {
      result.push(group[0]!);
      continue;
    }
    const winner = [...group].sort((a, b) =>
      a.start - b.start || a.end - b.end || a.kind.localeCompare(b.kind)
    )[0]!;
    result.push({
      ...winner,
      start: Math.min(...group.map((mark) => mark.start)),
      end: Math.max(...group.map((mark) => mark.end)),
      markId,
    });
    for (const loser of group) {
      if (loser === winner) continue;
      result.push({
        ...loser,
        markId: `${markId}~${loser.kind}`,
      });
    }
  }
  return result;
}

function mergeAdjacentMarks(marks: AuthoredMark[]): AuthoredMark[] {
  const sorted = [...marks].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.start - b.start || a.end - b.end
  );
  const merged: AuthoredMark[] = [];
  for (const mark of sorted) {
    const lastIndex = merged.findIndex(
      (candidate) => candidate.kind === mark.kind && candidate.end >= mark.start
    );
    if (lastIndex < 0 || mark.start > merged[lastIndex]!.end) {
      merged.push({ ...mark });
      continue;
    }
    const last = merged[lastIndex]!;
    merged[lastIndex] = {
      ...last,
      start: Math.min(last.start, mark.start),
      end: Math.max(last.end, mark.end),
    };
  }
  return merged;
}

function recordStableMarkChanges(
  before: readonly AuthoredMark[],
  after: readonly AuthoredMark[],
  trace: MutationTrace
): void {
  const afterById = new Map(after.map((mark) => [mark.markId, mark]));
  const beforeIds = new Set(before.map((mark) => mark.markId));
  for (const mark of before) {
    const next = afterById.get(mark.markId);
    if (!next) {
      trace.removedMarkIds.add(mark.markId);
      trace.affectedMarkIds.add(mark.markId);
      continue;
    }
    if (
      mark.kind !== next.kind ||
      mark.start !== next.start ||
      mark.end !== next.end
    ) {
      trace.affectedMarkIds.add(mark.markId);
      trace.identityMappings.push({
        kind: 'mark',
        beforeId: mark.markId,
        afterId: mark.markId,
      });
    }
  }
  for (const mark of after) {
    if (beforeIds.has(mark.markId)) continue;
    trace.addedMarkIds.add(mark.markId);
    trace.affectedMarkIds.add(mark.markId);
  }
}

function recordNormalizationChanges(
  before: readonly AuthoredMark[],
  after: readonly AuthoredMark[],
  trace: MutationTrace
): void {
  recordStableMarkChanges(before, after, trace);
  const afterIds = new Set(after.map((mark) => mark.markId));
  for (const removed of before) {
    if (afterIds.has(removed.markId)) continue;
    const survivor = after.find(
      (mark) =>
        mark.kind === removed.kind &&
        mark.start <= removed.start &&
        mark.end >= removed.end
    );
    if (survivor) {
      trace.identityMappings.push({
        kind: 'mark',
        beforeId: removed.markId,
        afterId: survivor.markId,
      });
    }
  }
}

function draftsEqual(a: MutableDraft, b: MutableDraft): boolean {
  if (a.storyId !== b.storyId) return false;
  if (a.paragraphOrder.join('\u0000') !== b.paragraphOrder.join('\u0000')) return false;
  if (a.paragraphs.size !== b.paragraphs.size) return false;
  for (const [paragraphId, paragraph] of a.paragraphs) {
    const other = b.paragraphs.get(paragraphId);
    if (!other) return false;
    if (
      paragraph.blockId !== other.blockId ||
      paragraph.text !== other.text ||
      JSON.stringify(paragraph.marks) !== JSON.stringify(other.marks)
    ) {
      return false;
    }
  }
  return true;
}

function touchStructuralProvenance(
  trace: MutationTrace,
  blockId: string
): {
  splitOffset?: number;
  originalTail?: string;
  editEvents: Array<{
    kind: 'insert' | 'delete';
    offset: number;
    text?: string;
    length?: number;
  }>;
} {
  let draft = trace.structuralProvenance.get(blockId);
  if (!draft) {
    draft = { editEvents: [] };
    trace.structuralProvenance.set(blockId, draft);
  }
  return draft;
}

function isSplitTailCandidate(_trace: MutationTrace, blockId: string): boolean {
  return blockId.endsWith('-tail');
}
