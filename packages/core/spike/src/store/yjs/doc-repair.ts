/** @spike-features yjs-backend */
import * as Y from 'yjs';
import {
  getMetaMap,
  getRecordField,
  getRootArray,
  getRootMap,
  setRecordField,
} from './doc-access';
import type { YjsCollisionCandidate, YjsDocState } from './doc-types';
import {
  codeUnitCompare,
  compareCollisionCandidates,
  parseCommitSeq,
  parseCreationId,
  repairedSemanticId,
} from './identity';
import { resolveEndpointOffset } from './endpoints';
import {
  ensureAuthoredContributionsMap,
  ensureSplitTailEditJournal,
  mergeAuthoredEditEventsIntoText,
  mergeStructuralContributions,
  readAuthoredEditEvents,
  readSplitTailEditJournalEvents,
  readStructuralCollisionProvenance,
  replayStructuralEdits,
  resolveSharedOriginalTail,
} from './structural-provenance';

const RECORD_MAPS = ['stories', 'blocks', 'texts', 'marks', 'capsules'] as const;

export interface YjsRepairResult {
  readonly changed: boolean;
  readonly collisionCandidates: readonly YjsCollisionCandidate[];
  readonly repairSteps: readonly string[];
}

export function repairYjsDocument(
  state: YjsDocState,
  repairOwner: string
): YjsRepairResult {
  const before = Y.encodeStateVector(state.doc);
  const repairSteps: string[] = [];
  let candidates: YjsCollisionCandidate[] = [];
  state.doc.transact(() => {
    candidates = repairYjsDocumentInPlace(state, repairSteps);
  }, { kind: 'repair', owner: repairOwner });
  const after = Y.encodeStateVector(state.doc);
  return Object.freeze({
    changed: !bytesEqual(before, after),
    collisionCandidates: Object.freeze(candidates),
    repairSteps: Object.freeze(repairSteps),
  });
}

export function repairYjsDocumentInPlace(
  state: YjsDocState,
  repairSteps: string[]
): YjsCollisionCandidate[] {
  migrateAuthoredContributionsToMap(state, repairSteps);
  backfillSplitTailEditJournal(state, repairSteps);
  const candidates = repairSemanticCollisions(state, repairSteps);
  remergeDeferredSplitTailContributions(state, repairSteps);
  consolidateSplitTailTextRecords(state, repairSteps);
  reconcileSplitTailContentFromContributions(state, repairSteps);
  repairOwnershipAndOrder(state, repairSteps);
  repairMarkEndpoints(state, repairSteps);
  repairAllocator(state, repairSteps);
  pruneStaleCollisionCandidates(state, repairSteps);
  return candidates;
}

function migrateAuthoredContributionsToMap(state: YjsDocState, repairSteps: string[]): void {
  for (const value of getRootMap(state.doc, 'texts').values()) {
    const text = value as Y.Map<unknown>;
    if (text.get('authoredContributions') instanceof Y.Array) {
      ensureAuthoredContributionsMap(text);
      repairSteps.push('migrate-authored-contributions-map');
    }
  }
}

function backfillSplitTailEditJournal(state: YjsDocState, repairSteps: string[]): void {
  ensureSplitTailEditJournal(state.doc);
  for (const value of getRootMap(state.doc, 'texts').values()) {
    const text = value as Y.Map<unknown>;
    if (typeof text.get('structuralSplitOffset') !== 'number') continue;
    const events = readAuthoredEditEvents(text);
    if (events.length === 0) continue;
    const beforeJournalSize = getRootMap(state.doc, 'meta').get('splitTailEditJournal') instanceof Y.Map
      ? (getRootMap(state.doc, 'meta').get('splitTailEditJournal') as Y.Map<unknown>).size
      : 0;
    mergeAuthoredEditEventsIntoText(text, events);
    const afterJournalSize =
      getRootMap(state.doc, 'meta').get('splitTailEditJournal') instanceof Y.Map
        ? (getRootMap(state.doc, 'meta').get('splitTailEditJournal') as Y.Map<unknown>).size
        : 0;
    if (afterJournalSize > beforeJournalSize) {
      repairSteps.push('backfill-split-tail-edit-journal');
    }
  }
}

function pruneStaleCollisionCandidates(state: YjsDocState, repairSteps: string[]): void {
  const collisionMap = getMetaMap(state.doc, 'collisionCandidates');
  for (const creationId of [...collisionMap.keys()]) {
    const exists = RECORD_MAPS.some((mapName) =>
      getRootMap(state.doc, mapName).has(creationId)
    );
    if (!exists) {
      collisionMap.delete(creationId);
      repairSteps.push('prune-stale-collision-candidate');
    }
  }
}

function consolidateSplitTailTextRecords(state: YjsDocState, repairSteps: string[]): void {
  const texts = getRootMap(state.doc, 'texts');
  const blocks = getRootMap(state.doc, 'blocks');
  const byProposed = new Map<string, Array<{ creationId: string; text: Y.Map<unknown> }>>();
  for (const [creationId, value] of texts) {
    const text = value as Y.Map<unknown>;
    const proposedSemanticId = getRecordField<string>(text, 'proposedSemanticId');
    if (!proposedSemanticId.startsWith('text-') || !proposedSemanticId.endsWith('-tail')) continue;
    const group = byProposed.get(proposedSemanticId) ?? [];
    group.push({ creationId, text });
    byProposed.set(proposedSemanticId, group);
  }
  for (const [proposedSemanticId, group] of byProposed) {
    if (group.length < 2) continue;
    const tailBlockProposed = proposedSemanticId.slice('text-'.length);
    const winnerBlock = [...blocks.values()].find(
      (value) =>
        getRecordField<string>(value as Y.Map<unknown>, 'proposedSemanticId') === tailBlockProposed
    ) as Y.Map<unknown> | undefined;
    if (!winnerBlock) continue;
    const winnerTextId = getRecordField<string>(winnerBlock, 'textId');
    const winnerEntry = group.find((item) => item.creationId === winnerTextId);
    if (!winnerEntry) continue;
    const ordered = group
      .map((item) =>
        Object.freeze({
          candidate: Object.freeze({
            creationId: getRecordField<string>(item.text, 'creationId'),
            semanticId: getRecordField<string>(item.text, 'semanticId'),
            proposedSemanticId,
            actorId: getRecordField<string>(item.text, 'actorId'),
            commitId: getRecordField<string>(item.text, 'commitId'),
          }),
          provenance: readStructuralCollisionProvenance(item.text, tailBlockProposed),
        })
      )
      .sort((left, right) => compareCollisionCandidates(left.candidate, right.candidate));
    for (const item of group) {
      if (item.creationId === winnerEntry.creationId) continue;
      mergeAuthoredEditEventsIntoText(winnerEntry.text, readAuthoredEditEvents(item.text));
      texts.delete(item.creationId);
      repairSteps.push('consolidate-split-tail-text-record');
    }
    const sharedOriginalTail = resolveSharedOriginalTail(ordered.map((item) => item.provenance));
    const conservedTail = mergeStructuralContributions(
      sharedOriginalTail,
      tailBlockProposed,
      ordered
    );
    const winnerContent = getRecordField<Y.Text>(winnerEntry.text, 'content');
    if (winnerContent.toString() !== conservedTail) {
      winnerContent.delete(0, winnerContent.length);
      winnerContent.insert(0, conservedTail);
      repairSteps.push('consolidate-split-tail-text-content');
    }
  }
}

function reconcileSplitTailContentFromContributions(
  state: YjsDocState,
  repairSteps: string[]
): void {
  for (const value of getRootMap(state.doc, 'texts').values()) {
    const text = value as Y.Map<unknown>;
    if (typeof text.get('structuralSplitOffset') !== 'number') continue;
    const tailBlockProposedId = getRecordField<string>(text, 'proposedSemanticId').slice(
      'text-'.length
    );
    const journalEvents = readSplitTailEditJournalEvents(state.doc, tailBlockProposedId);
    const beforeContributionCount = readAuthoredEditEvents(text).length;
    if (journalEvents.length > 0) {
      mergeAuthoredEditEventsIntoText(text, journalEvents);
    }
    if (readAuthoredEditEvents(text).length > beforeContributionCount) {
      repairSteps.push('merge-split-tail-edit-journal');
    }
    const events = readAuthoredEditEvents(text);
    if (events.length === 0) continue;
    const basis =
      typeof text.get('structuralOriginalTail') === 'string'
        ? (text.get('structuralOriginalTail') as string)
        : getRecordField<Y.Text>(text, 'content').toString();
    const authoritative = replayStructuralEdits(
      tailBlockProposedId,
      basis,
      events,
      typeof text.get('structuralSplitOffset') === 'number'
        ? (text.get('structuralSplitOffset') as number)
        : undefined
    );
    const content = getRecordField<Y.Text>(text, 'content');
    if (content.toString() !== authoritative) {
      content.delete(0, content.length);
      content.insert(0, authoritative);
      repairSteps.push('reconcile-split-tail-from-contributions');
    }
  }
}

function repairAllocator(state: YjsDocState, repairSteps: string[]): void {
  const summaries = new Map<
    string,
    { maxCommitSeq: number; maxLocalSeq: number; observed: Set<string> }
  >();
  for (const mapName of RECORD_MAPS) {
    for (const [creationId, value] of [...getRootMap(state.doc, mapName)].sort(
      ([left], [right]) => codeUnitCompare(left, right)
    )) {
      const record = value as Y.Map<unknown>;
      const actorId = getRecordField<string>(record, 'actorId');
      const summary = summaries.get(actorId) ?? {
        maxCommitSeq: 0,
        maxLocalSeq: 0,
        observed: new Set<string>(),
      };
      const parsed = parseCreationId(creationId);
      summary.maxCommitSeq = Math.max(
        summary.maxCommitSeq,
        parseCommitSeq(getRecordField<string>(record, 'commitId')) ?? 0,
        parsed?.commitSeq ?? 0
      );
      summary.maxLocalSeq = Math.max(summary.maxLocalSeq, parsed?.localSeq ?? 0);
      summary.observed.add(getRecordField<string>(record, 'semanticId'));
      summary.observed.add(getRecordField<string>(record, 'proposedSemanticId'));
      summaries.set(actorId, summary);
    }
  }
  for (const value of getMetaMap(state.doc, 'tombstones').values()) {
    const tombstone = value as {
      actorId?: unknown;
      commitId?: unknown;
      creationId?: unknown;
      semanticId?: unknown;
      proposedSemanticId?: unknown;
    };
    if (typeof tombstone.actorId !== 'string') continue;
    const summary = summaries.get(tombstone.actorId) ?? {
      maxCommitSeq: 0,
      maxLocalSeq: 0,
      observed: new Set<string>(),
    };
    const parsed =
      typeof tombstone.creationId === 'string'
        ? parseCreationId(tombstone.creationId)
        : undefined;
    summary.maxCommitSeq = Math.max(
      summary.maxCommitSeq,
      typeof tombstone.commitId === 'string'
        ? parseCommitSeq(tombstone.commitId) ?? 0
        : 0,
      parsed?.commitSeq ?? 0
    );
    summary.maxLocalSeq = Math.max(summary.maxLocalSeq, parsed?.localSeq ?? 0);
    if (typeof tombstone.semanticId === 'string') {
      summary.observed.add(tombstone.semanticId);
    }
    if (typeof tombstone.proposedSemanticId === 'string') {
      summary.observed.add(tombstone.proposedSemanticId);
    }
    summaries.set(tombstone.actorId, summary);
  }
  const allocator = getRootMap(state.doc, 'allocator');
  for (const [actorId, summary] of [...summaries].sort(([left], [right]) =>
    codeUnitCompare(left, right)
  )) {
    const existing = allocator.get(actorId) as Y.Map<unknown> | undefined;
    const record = existing ?? new Y.Map<unknown>();
    const observed =
      existing && getRecordField<unknown>(record, 'observedSemanticIds') instanceof Y.Map
        ? getRecordField<Y.Map<boolean>>(record, 'observedSemanticIds')
        : new Y.Map<boolean>();
    let changed = !existing;
    for (const semanticId of summary.observed) {
      if (!observed.has(semanticId)) {
        observed.set(semanticId, true);
        changed = true;
      }
    }
    const nextCommitSeq = summary.maxCommitSeq + 1;
    const nextLocalSeq = summary.maxLocalSeq + 1;
    const existingNextCommitSeq = existing
      ? getRecordField<unknown>(record, 'nextCommitSeq')
      : undefined;
    if (
      !existing ||
      typeof existingNextCommitSeq !== 'number' ||
      !Number.isSafeInteger(existingNextCommitSeq) ||
      existingNextCommitSeq < nextCommitSeq
    ) {
      setRecordField(record, 'nextCommitSeq', nextCommitSeq);
      changed = true;
    }
    const existingNextLocalSeq = existing
      ? getRecordField<unknown>(record, 'nextLocalSeq')
      : undefined;
    if (
      !existing ||
      typeof existingNextLocalSeq !== 'number' ||
      !Number.isSafeInteger(existingNextLocalSeq) ||
      existingNextLocalSeq < nextLocalSeq
    ) {
      setRecordField(record, 'nextLocalSeq', nextLocalSeq);
      changed = true;
    }
    setRecordField(record, 'actorId', actorId);
    if (!existing) {
      setRecordField(record, 'observedSemanticIds', observed);
      allocator.set(actorId, record);
    }
    if (changed) repairSteps.push('repair-allocator-coverage');
  }
}

function repairSemanticCollisions(
  state: YjsDocState,
  repairSteps: string[]
): YjsCollisionCandidate[] {
  const records: Array<{
    mapName: (typeof RECORD_MAPS)[number];
    record: Y.Map<unknown>;
    candidate: YjsCollisionCandidate;
  }> = [];
  for (const mapName of RECORD_MAPS) {
    for (const [creationId, value] of [...getRootMap(state.doc, mapName)].sort(
      ([left], [right]) => codeUnitCompare(left, right)
    )) {
      const record = value as Y.Map<unknown>;
      records.push({
        mapName,
        record,
        candidate: {
          creationId,
          semanticId: getRecordField<string>(record, 'semanticId'),
          proposedSemanticId: getRecordField<string>(record, 'proposedSemanticId'),
          actorId: getRecordField<string>(record, 'actorId'),
          commitId: getRecordField<string>(record, 'commitId'),
        },
      });
    }
  }
  const byProposed = new Map<string, typeof records>();
  for (const item of records) {
    const group = byProposed.get(item.candidate.proposedSemanticId) ?? [];
    group.push(item);
    byProposed.set(item.candidate.proposedSemanticId, group);
  }

  const collisionMap = getMetaMap(state.doc, 'collisionCandidates');
  const activeCandidateIds = new Set<string>();
  const candidates: YjsCollisionCandidate[] = [];
  for (const [proposedSemanticId, group] of [...byProposed].sort(([left], [right]) =>
    codeUnitCompare(left, right)
  )) {
    const liveGroup = group.filter((item) =>
      getRootMap(state.doc, item.mapName).has(item.candidate.creationId)
    );
    if (liveGroup.length < 2) {
      const only = liveGroup[0];
      if (only && only.candidate.semanticId !== proposedSemanticId) {
        setRecordField(only.record, 'semanticId', proposedSemanticId);
        if (only.mapName === 'blocks') {
          setRecordField(only.record, 'paragraphId', getRecordField<string>(
            only.record,
            'proposedParagraphId'
          ));
        }
        repairSteps.push('restore-single-candidate-semantic-id');
      }
      continue;
    }
    const ordered = [...liveGroup].sort((left, right) =>
      compareCollisionCandidates(left.candidate, right.candidate)
    );
    ordered.forEach((item, index) => {
      const expected =
        index === 0
          ? proposedSemanticId
          : repairedSemanticId(
              proposedSemanticId,
              item.candidate.actorId,
              item.candidate.commitId,
              item.candidate.creationId
            );
      if (item.candidate.semanticId !== expected) {
        setRecordField(item.record, 'semanticId', expected);
        repairSteps.push('repair-semantic-id-collision');
      }
      if (item.mapName === 'blocks') {
        const proposedParagraphId = getRecordField<string>(
          item.record,
          'proposedParagraphId'
        );
        const expectedParagraphId =
          index === 0
            ? proposedParagraphId
            : repairedSemanticId(
                proposedParagraphId,
                item.candidate.actorId,
                item.candidate.commitId,
                item.candidate.creationId
              );
        if (getRecordField<string>(item.record, 'paragraphId') !== expectedParagraphId) {
          setRecordField(item.record, 'paragraphId', expectedParagraphId);
          repairSteps.push('repair-paragraph-id-collision');
        }
      }
      const candidate = Object.freeze({ ...item.candidate, semanticId: expected });
      activeCandidateIds.add(candidate.creationId);
      collisionMap.set(candidate.creationId, candidate);
      candidates.push(candidate);
      addAllocatorObservation(state.doc, candidate.actorId, expected);
    });
    if (ordered.every((item) => item.mapName === 'blocks')) {
      conserveStructuralCollision(state, ordered, repairSteps);
    }
  }
  for (const creationId of [...collisionMap.keys()]) {
    if (!activeCandidateIds.has(creationId)) collisionMap.delete(creationId);
  }
  return candidates.sort(compareCollisionCandidates);
}

function conserveStructuralCollision(
  state: YjsDocState,
  ordered: Array<{
    mapName: (typeof RECORD_MAPS)[number];
    record: Y.Map<unknown>;
    candidate: YjsCollisionCandidate;
  }>,
  repairSteps: string[]
): void {
  const [winner, ...losers] = ordered;
  if (!winner || losers.length === 0) return;
  const texts = getRootMap(state.doc, 'texts');
  const tailProposedSemanticId = winner.candidate.proposedSemanticId;
  const provenanced = ordered.map((item) => {
    const textId = getRecordField<string>(item.record, 'textId');
    const text = texts.get(textId) as Y.Map<unknown> | undefined;
    if (!text) throw new TypeError('collision tail text missing during repair');
    return Object.freeze({
      candidate: item.candidate,
      provenance: readStructuralCollisionProvenance(text, tailProposedSemanticId),
    });
  });
  const sharedOriginalTail = resolveSharedOriginalTail(
    provenanced.map((item) => item.provenance)
  );
  const splitOffsets = provenanced
    .map((item) => item.provenance.splitOffset)
    .filter((offset): offset is number => offset !== undefined);
  const canonicalSplitOffset =
    splitOffsets.length > 0 ? Math.min(...splitOffsets) : undefined;
  if (canonicalSplitOffset !== undefined) {
    const headProposedId = winner.candidate.proposedSemanticId.replace(/-tail$/, '');
    for (const value of getRootMap(state.doc, 'blocks').values()) {
      const block = value as Y.Map<unknown>;
      if (getRecordField<string>(block, 'proposedSemanticId') !== headProposedId) continue;
      const headTextId = getRecordField<string>(block, 'textId');
      const headText = texts.get(headTextId) as Y.Map<unknown> | undefined;
      if (!headText) break;
      const headContent = getRecordField<Y.Text>(headText, 'content');
      const currentHead = headContent.toString();
      if (currentHead.length !== canonicalSplitOffset) {
        const canonicalHead = currentHead.slice(0, canonicalSplitOffset);
        headContent.delete(0, headContent.length);
        headContent.insert(0, canonicalHead);
        repairSteps.push('conserve-structural-split-head');
      }
      break;
    }
  }
  const conservedTail = mergeStructuralContributions(
    sharedOriginalTail,
    tailProposedSemanticId,
    provenanced
  );
  const winnerTextId = getRecordField<string>(winner.record, 'textId');
  const winnerText = texts.get(winnerTextId) as Y.Map<unknown>;
  if (sharedOriginalTail.length > 0) {
    setRecordField(winnerText, 'structuralOriginalTail', sharedOriginalTail);
  }
  if (canonicalSplitOffset !== undefined) {
    setRecordField(winnerText, 'structuralSplitOffset', canonicalSplitOffset);
  }
  for (const item of provenanced) {
    mergeAuthoredEditEventsIntoText(winnerText, item.provenance.editEvents);
  }
  const winnerContent = getRecordField<Y.Text>(winnerText, 'content');
  if (winnerContent.toString() !== conservedTail) {
    winnerContent.delete(0, winnerContent.length);
    winnerContent.insert(0, conservedTail);
    repairSteps.push('conserve-structural-split-text');
  }
  const blocks = getRootMap(state.doc, 'blocks');
  const tombstones = getMetaMap(state.doc, 'tombstones');
  const collisionMap = getMetaMap(state.doc, 'collisionCandidates');
  for (const loser of losers) {
    const creationId = loser.candidate.creationId;
    const textId = getRecordField<string>(loser.record, 'textId');
    tombstones.set(creationId, {
      creationId,
      semanticId: getRecordField<string>(loser.record, 'semanticId'),
      proposedSemanticId: loser.candidate.proposedSemanticId,
      actorId: loser.candidate.actorId,
      commitId: loser.candidate.commitId,
      recordKind: 'block',
    });
    collisionMap.delete(creationId);
    blocks.delete(creationId);
    for (const storyValue of getRootMap(state.doc, 'stories').values()) {
      const order = getRecordField<Y.Array<string>>(
        storyValue as Y.Map<unknown>,
        'blockOrder'
      );
      syncArray(order, order.toArray().filter((id) => id !== creationId));
    }
    repairSteps.push('tombstone-losing-structural-split');
  }
}

function remergeDeferredSplitTailContributions(
  state: YjsDocState,
  repairSteps: string[]
): void {
  const blocks = getRootMap(state.doc, 'blocks');
  const texts = getRootMap(state.doc, 'texts');
  const tombstones = getMetaMap(state.doc, 'tombstones');

  for (const [tombstoneCreationId, tombstoneValue] of tombstones) {
    const tombstone = tombstoneValue as {
      recordKind?: unknown;
      proposedSemanticId?: unknown;
      semanticId?: unknown;
      actorId?: unknown;
      commitId?: unknown;
    };
    if (tombstone.recordKind !== 'block' || typeof tombstone.proposedSemanticId !== 'string') {
      continue;
    }
    if (!tombstone.proposedSemanticId.endsWith('-tail')) continue;

    const winnerBlock = [...blocks.values()].find(
      (value) =>
        getRecordField<string>(value as Y.Map<unknown>, 'proposedSemanticId') ===
        tombstone.proposedSemanticId
    ) as Y.Map<unknown> | undefined;
    if (!winnerBlock) continue;

    const deferred: Array<{ text: Y.Map<unknown>; candidate: YjsCollisionCandidate }> = [];
    for (const [textCreationId, textValue] of texts) {
      const text = textValue as Y.Map<unknown>;
      if (getRecordField<string>(text, 'parentBlockId') !== tombstoneCreationId) continue;
      if (typeof text.get('structuralSplitOffset') !== 'number') continue;
      if (readAuthoredEditEvents(text).length === 0) continue;
      deferred.push({
        text,
        candidate: {
          creationId: tombstoneCreationId,
          semanticId:
            typeof tombstone.semanticId === 'string'
              ? tombstone.semanticId
              : tombstone.proposedSemanticId,
          proposedSemanticId: tombstone.proposedSemanticId,
          actorId: typeof tombstone.actorId === 'string' ? tombstone.actorId : 'actor-unknown',
          commitId: typeof tombstone.commitId === 'string' ? tombstone.commitId : 'commit-0',
        },
      });
    }
    if (deferred.length === 0) continue;

    const winnerTextId = getRecordField<string>(winnerBlock, 'textId');
    const winnerText = texts.get(winnerTextId) as Y.Map<unknown> | undefined;
    if (!winnerText) continue;

    const winnerCandidate: YjsCollisionCandidate = {
      creationId: getRecordField<string>(winnerBlock, 'creationId'),
      semanticId: getRecordField<string>(winnerBlock, 'semanticId'),
      proposedSemanticId: getRecordField<string>(winnerBlock, 'proposedSemanticId'),
      actorId: getRecordField<string>(winnerBlock, 'actorId'),
      commitId: getRecordField<string>(winnerBlock, 'commitId'),
    };
    const ordered = [
      Object.freeze({
        candidate: winnerCandidate,
        provenance: readStructuralCollisionProvenance(winnerText, tombstone.proposedSemanticId),
      }),
      ...deferred
        .sort((left, right) => compareCollisionCandidates(left.candidate, right.candidate))
        .map((item) =>
          Object.freeze({
            candidate: item.candidate,
            provenance: readStructuralCollisionProvenance(
              item.text,
              typeof tombstone.proposedSemanticId === 'string'
                ? tombstone.proposedSemanticId
                : undefined
            ),
          })
        ),
    ];
    const sharedOriginalTail = resolveSharedOriginalTail(ordered.map((item) => item.provenance));
    const conservedTail = mergeStructuralContributions(
      sharedOriginalTail,
      tombstone.proposedSemanticId,
      ordered
    );
    const winnerContent = getRecordField<Y.Text>(winnerText, 'content');
    if (winnerContent.toString() !== conservedTail) {
      winnerContent.delete(0, winnerContent.length);
      winnerContent.insert(0, conservedTail);
      repairSteps.push('remerge-deferred-split-tail-contributions');
    }

    for (const [textCreationId, textValue] of texts) {
      const text = textValue as Y.Map<unknown>;
      if (getRecordField<string>(text, 'parentBlockId') !== tombstoneCreationId) continue;
      mergeAuthoredEditEventsIntoText(winnerText, readAuthoredEditEvents(text));
      texts.delete(textCreationId);
    }
  }
}

function addAllocatorObservation(doc: Y.Doc, actorId: string, semanticId: string): void {
  const actor = getRootMap(doc, 'allocator').get(actorId) as Y.Map<unknown> | undefined;
  if (!actor) return;
  const observed = getRecordField<Y.Map<boolean>>(actor, 'observedSemanticIds');
  observed.set(semanticId, true);
}

function repairOwnershipAndOrder(state: YjsDocState, repairSteps: string[]): void {
  const storyOrder = getRootArray(state.doc, 'storyOrder');
  const stories = getRootMap(state.doc, 'stories');
  const validStories = uniqueExisting(storyOrder.toArray(), stories);
  if (validStories.length !== 1) {
    const fallback = [...stories.keys()].sort(codeUnitCompare).slice(0, 1);
    syncArray(storyOrder, fallback);
    repairSteps.push('repair-story-order');
  } else {
    syncArray(storyOrder, validStories);
  }
  const storyCreationId = storyOrder.get(0);
  const story = stories.get(storyCreationId) as Y.Map<unknown>;
  const blockOrder = getRecordField<Y.Array<string>>(story, 'blockOrder');
  const blocks = getRootMap(state.doc, 'blocks');
  const tombstoneIds = new Set(getMetaMap(state.doc, 'tombstones').keys());
  const desired = uniqueExisting(blockOrder.toArray(), blocks);
  const desiredSet = new Set(desired);
  for (const [creationId, value] of [...blocks].sort(([left], [right]) =>
    codeUnitCompare(left, right)
  )) {
    if (tombstoneIds.has(creationId)) continue;
    const block = value as Y.Map<unknown>;
    if (!desiredSet.has(creationId)) {
      desired.push(creationId);
      desiredSet.add(creationId);
      repairSteps.push('restore-unordered-block');
    }
    if (
      getRecordField<string>(block, 'parentId') !== storyCreationId ||
      getRecordField<string>(block, 'storyId') !== storyCreationId
    ) {
      setRecordField(block, 'parentId', storyCreationId);
      setRecordField(block, 'storyId', storyCreationId);
      repairSteps.push('repair-block-owner');
    }
    repairBlockReferences(state, creationId, block, repairSteps);
  }
  syncArray(blockOrder, desired);
}

function repairBlockReferences(
  state: YjsDocState,
  blockCreationId: string,
  block: Y.Map<unknown>,
  repairSteps: string[]
): void {
  const textCreationId = getRecordField<string>(block, 'textId');
  const text = getRootMap(state.doc, 'texts').get(textCreationId) as Y.Map<unknown> | undefined;
  if (!text) throw new TypeError('block text missing after merge');
  if (getRecordField<string>(text, 'parentBlockId') !== blockCreationId) {
    setRecordField(text, 'parentBlockId', blockCreationId);
    repairSteps.push('repair-text-owner');
  }
  const markIds = getRecordField<Y.Array<string>>(block, 'markIds');
  const validMarks = uniqueExisting(markIds.toArray(), getRootMap(state.doc, 'marks')).filter(
    (creationId) => {
      const mark = getRootMap(state.doc, 'marks').get(creationId) as Y.Map<unknown>;
      if (getRecordField<string>(mark, 'parentTextId') !== textCreationId) {
        setRecordField(mark, 'parentTextId', textCreationId);
        repairSteps.push('repair-mark-owner');
      }
      return true;
    }
  );
  syncArray(markIds, validMarks);
  const capsuleIds = getRecordField<Y.Array<string>>(block, 'capsuleIds');
  const validCapsules = uniqueExisting(
    capsuleIds.toArray(),
    getRootMap(state.doc, 'capsules')
  );
  for (const creationId of validCapsules) {
    const capsule = getRootMap(state.doc, 'capsules').get(creationId) as Y.Map<unknown>;
    setRecordField(capsule, 'parentBlockId', blockCreationId);
    setRecordField(capsule, 'ownerBlockId', getRecordField<string>(block, 'semanticId'));
  }
  syncArray(capsuleIds, validCapsules);
}

function repairMarkEndpoints(state: YjsDocState, repairSteps: string[]): void {
  const marks = getRootMap(state.doc, 'marks');
  const texts = getRootMap(state.doc, 'texts');
  for (const [creationId, value] of [...marks.entries()].sort(([left], [right]) =>
    codeUnitCompare(left, right)
  )) {
    const mark = value as Y.Map<unknown>;
    const textCreationId = getRecordField<string>(mark, 'parentTextId');
    const textRecord = texts.get(textCreationId) as Y.Map<unknown> | undefined;
    let valid = textRecord !== undefined;
    if (textRecord) {
      const ytext = getRecordField<Y.Text>(textRecord, 'content');
      try {
        const start = resolveEndpointOffset(
          state.doc,
          ytext,
          getRecordField(mark, 'start')
        );
        const end = resolveEndpointOffset(state.doc, ytext, getRecordField(mark, 'end'));
        valid = start >= 0 && end > start && end <= ytext.length;
      } catch {
        valid = false;
      }
    }
    if (valid) continue;
    const tombstone = {
      creationId,
      semanticId: getRecordField<string>(mark, 'semanticId'),
      proposedSemanticId: getRecordField<string>(mark, 'proposedSemanticId'),
      actorId: getRecordField<string>(mark, 'actorId'),
      commitId: getRecordField<string>(mark, 'commitId'),
      recordKind: 'mark' as const,
    };
    getMetaMap(state.doc, 'tombstones').set(creationId, tombstone);
    marks.delete(creationId);
    for (const blockValue of getRootMap(state.doc, 'blocks').values()) {
      const markIds = getRecordField<Y.Array<string>>(
        blockValue as Y.Map<unknown>,
        'markIds'
      );
      syncArray(
        markIds,
        markIds.toArray().filter((id) => id !== creationId)
      );
    }
    repairSteps.push('remove-invalid-mark-endpoint');
  }
}

function uniqueExisting(ids: readonly string[], map: Y.Map<unknown>): string[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    if (seen.has(id) || !map.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function syncArray(target: Y.Array<string>, desired: readonly string[]): void {
  const current = target.toArray();
  if (
    current.length === desired.length &&
    current.every((value, index) => value === desired[index])
  ) {
    return;
  }
  target.delete(0, target.length);
  if (desired.length > 0) target.insert(0, [...desired]);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
