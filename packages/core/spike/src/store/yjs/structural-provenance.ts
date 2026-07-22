/** @spike-features yjs-backend */
import * as Y from 'yjs';
import type { MutationTrace } from '../mutate';
import {
  YJS_MAX_CONTRIBUTIONS_PER_TEXT,
  YJS_MAX_SPLIT_TAIL_JOURNAL_ENTRIES,
} from './constants';
import { getMetaMap, getRecordField, getRootMap, nextCreation, setRecordField } from './doc-access';
import type { BootstrapContext } from './doc-types';
import type { YjsCollisionCandidate } from './doc-types';
import { compareCollisionCandidates } from './identity';
import { isValidUtf16Boundary } from '../utf16';
import {
  type AuthoredTextEditEvent,
  type AuthoredTextInsertEvent,
  type SequenceAnchor,
  baseAnchor,
  baseTokenId,
  canonicalEditEventJson,
  collectTokenIdsInRange,
  compareAuthoredEditEvents,
  decodeAuthoredEditEvent,
  materializeTokenSequence,
  remapEventToSharedTail,
  selectTokensAtOffset,
  storedEventsEqual,
  validateAuthoredEditEvents,
  validateSplitTailEditJournal,
} from './token-sequence';

export type { AuthoredTextEditEvent, AuthoredTextInsertEvent, SequenceAnchor };
export {
  canonicalEditEventJson,
  compareAuthoredEditEvents,
  decodeAuthoredEditEvent,
  materializeTokenSequence,
  validateAuthoredEditEvents,
  validateSplitTailEditJournal,
};

export interface StructuralTextProvenanceDraft {
  splitOffset?: number;
  originalTail?: string;
  editEvents: Array<{
    kind: 'insert' | 'delete';
    offset: number;
    text?: string;
    length?: number;
    affinity?: 'before' | 'after';
  }>;
}

export function touchStructuralProvenance(
  trace: MutationTrace,
  blockId: string
): StructuralTextProvenanceDraft {
  let draft = trace.structuralProvenance.get(blockId);
  if (!draft) {
    draft = { editEvents: [] };
    trace.structuralProvenance.set(blockId, draft);
  }
  return draft;
}

function contributionMapFor(textRecord: Y.Map<unknown>): Y.Map<unknown> {
  const raw = textRecord.get('authoredContributions');
  if (raw instanceof Y.Map) return raw;
  const migrated = new Y.Map<unknown>();
  if (raw instanceof Y.Array) {
    for (const value of raw.toArray()) {
      if (value === null || typeof value !== 'object') continue;
      const creationId = (value as { creationId?: unknown }).creationId;
      if (typeof creationId === 'string') migrated.set(creationId, value);
    }
  }
  setRecordField(textRecord, 'authoredContributions', migrated);
  return migrated;
}

function canonicalStoredEvent(event: AuthoredTextEditEvent): Record<string, unknown> {
  if (event.kind === 'insert') {
    return Object.freeze({
      kind: 'insert',
      tokenId: event.tokenId,
      leftAnchor: event.leftAnchor,
      rightAnchor: event.rightAnchor,
      affinity: event.affinity,
      anchorSplitOffset: event.anchorSplitOffset,
      text: event.text,
      actorId: event.actorId,
      commitId: event.commitId,
      creationId: event.creationId,
      sourceClientId: event.sourceClientId,
    });
  }
  return Object.freeze({
    kind: 'delete',
    tombstonedTokenIds: [...event.tombstonedTokenIds],
    observedInsertCreationIds: [...event.observedInsertCreationIds],
    anchorSplitOffset: event.anchorSplitOffset,
    actorId: event.actorId,
    commitId: event.commitId,
    creationId: event.creationId,
    sourceClientId: event.sourceClientId,
  });
}

function tailBlockProposedIdForText(
  doc: Y.Doc,
  textRecord: Y.Map<unknown>
): string | undefined {
  const proposedSemanticId = getRecordField<string>(textRecord, 'proposedSemanticId');
  if (proposedSemanticId.startsWith('text-') && proposedSemanticId.endsWith('-tail')) {
    return proposedSemanticId.slice('text-'.length);
  }
  const parentBlockId = getRecordField<string>(textRecord, 'parentBlockId');
  const block = getRootMap(doc, 'blocks').get(parentBlockId) as Y.Map<unknown> | undefined;
  if (block) return getRecordField<string>(block, 'proposedSemanticId');
  const tombstone = getMetaMap(doc, 'tombstones').get(parentBlockId) as
    | { proposedSemanticId?: unknown }
    | undefined;
  return typeof tombstone?.proposedSemanticId === 'string'
    ? tombstone.proposedSemanticId
    : undefined;
}

function splitTailEditJournal(doc: Y.Doc): Y.Map<unknown> {
  const meta = getRootMap(doc, 'meta');
  let journal = meta.get('splitTailEditJournal');
  if (!(journal instanceof Y.Map)) {
    journal = new Y.Map<unknown>();
    setRecordField(meta, 'splitTailEditJournal', journal);
  }
  return journal as Y.Map<unknown>;
}

function appendToSplitTailEditJournal(
  doc: Y.Doc,
  tailBlockProposedId: string,
  event: AuthoredTextEditEvent
): boolean {
  const journal = splitTailEditJournal(doc);
  const key = `${tailBlockProposedId}\u0000${event.creationId}`;
  const stored = canonicalStoredEvent(event);
  const existing = journal.get(key);
  if (existing !== undefined && storedEventsEqual(existing, stored)) return false;
  if (existing !== undefined) {
    throw new TypeError('split tail edit journal entry conflict');
  }
  if (journal.size >= YJS_MAX_SPLIT_TAIL_JOURNAL_ENTRIES) {
    throw new TypeError('split tail edit journal quota exceeded');
  }
  journal.set(key, stored);
  return true;
}

export function ensureSplitTailEditJournal(doc: Y.Doc): void {
  splitTailEditJournal(doc);
}

export function readSplitTailEditJournalEvents(
  doc: Y.Doc,
  tailBlockProposedId: string
): AuthoredTextEditEvent[] {
  const journal = splitTailEditJournal(doc);
  const prefix = `${tailBlockProposedId}\u0000`;
  const events: AuthoredTextEditEvent[] = [];
  for (const [key, value] of journal.entries()) {
    if (!key.startsWith(prefix)) continue;
    events.push(decodeAuthoredEditEvent(value));
  }
  return events.sort(compareAuthoredEditEvents);
}

function encodeTokenEditEvent(
  draftEvent: StructuralTextProvenanceDraft['editEvents'][number],
  originalTail: string,
  tailProposedSemanticId: string,
  anchorSplitOffset: number,
  priorEvents: readonly AuthoredTextEditEvent[],
  ctx: BootstrapContext
): AuthoredTextEditEvent {
  const creationId = nextCreation(ctx);
  if (draftEvent.kind === 'insert') {
    if (!isValidUtf16Boundary(originalTail, 0)) {
      throw new TypeError('structural original tail invalid');
    }
    const selection = selectTokensAtOffset(
      tailProposedSemanticId,
      originalTail,
      priorEvents,
      draftEvent.offset
    );
    const affinity = draftEvent.affinity ?? selection.affinity;
    return Object.freeze({
      kind: 'insert',
      tokenId: creationId,
      leftAnchor: selection.leftAnchor,
      rightAnchor: selection.rightAnchor,
      affinity,
      anchorSplitOffset,
      text: draftEvent.text ?? '',
      actorId: ctx.actorId,
      commitId: `commit-${ctx.commitSeq}`,
      creationId,
      sourceClientId: ctx.sourceClientId,
    });
  }
  const tokenIds = collectTokenIdsInRange(
    tailProposedSemanticId,
    originalTail,
    priorEvents,
    draftEvent.offset,
    draftEvent.offset + (draftEvent.length ?? 0)
  );
  if (tokenIds.length === 0) {
    throw new TypeError('delete range does not cover any live tokens');
  }
  const observedInsertCreationIds = Object.freeze(
    tokenIds.filter((tokenId) => !tokenId.startsWith('base:'))
  );
  return Object.freeze({
    kind: 'delete',
    tombstonedTokenIds: tokenIds,
    observedInsertCreationIds,
    anchorSplitOffset,
    actorId: ctx.actorId,
    commitId: `commit-${ctx.commitSeq}`,
    creationId,
    sourceClientId: ctx.sourceClientId,
  });
}

function countNewAuthoredEditEvents(
  contributions: Y.Map<unknown>,
  events: readonly AuthoredTextEditEvent[]
): number {
  let newEvents = 0;
  for (const event of events) {
    const existing = contributions.get(event.creationId);
    if (existing === undefined) {
      newEvents += 1;
      continue;
    }
    if (!storedEventsEqual(existing, canonicalStoredEvent(event))) {
      throw new TypeError('authored edit event identity conflict');
    }
  }
  return newEvents;
}

function appendAuthenticatedEditEvents(
  textRecord: Y.Map<unknown>,
  events: ReadonlyArray<StructuralTextProvenanceDraft['editEvents'][number]>,
  ctx: BootstrapContext
): void {
  if (events.length === 0) return;
  const contributions = contributionMapFor(textRecord);
  if (contributions.size + events.length > YJS_MAX_CONTRIBUTIONS_PER_TEXT) {
    throw new TypeError('authored contributions quota exceeded');
  }
  const doc = textRecord.doc ?? contributions.doc;
  const originalTail =
    typeof textRecord.get('structuralOriginalTail') === 'string'
      ? (textRecord.get('structuralOriginalTail') as string)
      : undefined;
  if (!originalTail) {
    throw new TypeError('structural original tail missing for authenticated edit events');
  }
  const priorEvents = readAuthoredEditEvents(textRecord);
  const tailBlockProposedId =
    doc instanceof Y.Doc && typeof textRecord.get('structuralSplitOffset') === 'number'
      ? tailBlockProposedIdForText(doc, textRecord)
      : undefined;
  if (!tailBlockProposedId) {
    throw new TypeError('split tail block proposed semantic ID missing');
  }
  const anchorSplitOffsetRaw = textRecord.get('structuralSplitOffset');
  if (typeof anchorSplitOffsetRaw !== 'number' || !Number.isSafeInteger(anchorSplitOffsetRaw)) {
    throw new TypeError('structural split offset missing for authenticated edit events');
  }
  for (const event of events) {
    const stored = encodeTokenEditEvent(
      event,
      originalTail,
      tailBlockProposedId,
      anchorSplitOffsetRaw,
      priorEvents,
      ctx
    );
    mergeAuthoredEditEventsIntoText(textRecord, [stored]);
    priorEvents.push(stored);
  }
}

export function mergeAuthoredEditEventsIntoText(
  textRecord: Y.Map<unknown>,
  events: readonly AuthoredTextEditEvent[]
): void {
  if (events.length === 0) return;
  const contributions = contributionMapFor(textRecord);
  const newEventCount = countNewAuthoredEditEvents(contributions, events);
  if (contributions.size + newEventCount > YJS_MAX_CONTRIBUTIONS_PER_TEXT) {
    throw new TypeError('authored contributions quota exceeded');
  }
  const doc = textRecord.doc ?? contributions.doc;
  const tailBlockProposedId =
    doc instanceof Y.Doc && typeof textRecord.get('structuralSplitOffset') === 'number'
      ? tailBlockProposedIdForText(doc, textRecord)
      : undefined;
  for (const event of events) {
    const stored = canonicalStoredEvent(event);
    const existing = contributions.get(event.creationId);
    if (existing !== undefined) {
      if (!storedEventsEqual(existing, stored)) {
        throw new TypeError('authored edit event identity conflict');
      }
      continue;
    }
    contributions.set(event.creationId, stored);
    if (doc instanceof Y.Doc && tailBlockProposedId) {
      appendToSplitTailEditJournal(doc, tailBlockProposedId, event);
    }
  }
}

export function ensureAuthoredContributionsMap(textRecord: Y.Map<unknown>): void {
  contributionMapFor(textRecord);
}

export function syncStructuralProvenanceOnText(
  textRecord: Y.Map<unknown>,
  blockId: string,
  trace: MutationTrace | undefined,
  ctx: BootstrapContext,
  _beforeText?: string
): void {
  if (!trace) return;
  const draft = trace.structuralProvenance.get(blockId);
  if (!draft) return;
  if (draft.splitOffset !== undefined) {
    setRecordField(textRecord, 'structuralSplitOffset', draft.splitOffset);
  }
  if (draft.originalTail !== undefined) {
    setRecordField(textRecord, 'structuralOriginalTail', draft.originalTail);
  }
  if (draft.editEvents.length > 0) {
    appendAuthenticatedEditEvents(textRecord, draft.editEvents, ctx);
  }
}

export function readAuthoredEditEvents(textRecord: Y.Map<unknown>): AuthoredTextEditEvent[] {
  const raw = textRecord.get('authoredContributions');
  const values =
    raw instanceof Y.Map
      ? [...raw.values()]
      : raw instanceof Y.Array
        ? raw.toArray()
        : [];
  return values
    .map((value) => {
      try {
        return decodeAuthoredEditEvent(value);
      } catch {
        return null;
      }
    })
    .filter((value): value is AuthoredTextEditEvent => value !== null)
    .sort(compareAuthoredEditEvents);
}

export interface StructuralCollisionProvenance {
  readonly splitOffset: number | undefined;
  readonly originalTail: string | undefined;
  readonly editEvents: readonly AuthoredTextEditEvent[];
  readonly tailProposedSemanticId: string | undefined;
}

export function readStructuralCollisionProvenance(
  textRecord: Y.Map<unknown>,
  tailProposedSemanticId?: string
): StructuralCollisionProvenance {
  const splitOffsetRaw = textRecord.get('structuralSplitOffset');
  const originalTailRaw = textRecord.get('structuralOriginalTail');
  return Object.freeze({
    splitOffset:
      typeof splitOffsetRaw === 'number' && Number.isSafeInteger(splitOffsetRaw)
        ? splitOffsetRaw
        : undefined,
    originalTail: typeof originalTailRaw === 'string' ? originalTailRaw : undefined,
    editEvents: Object.freeze(readAuthoredEditEvents(textRecord)),
    tailProposedSemanticId,
  });
}

export function resolveSharedOriginalTail(
  provenances: readonly StructuralCollisionProvenance[]
): string {
  let minSplit = Number.MAX_SAFE_INTEGER;
  let shared = '';
  for (const provenance of provenances) {
    if (
      provenance.splitOffset === undefined ||
      provenance.originalTail === undefined
    ) {
      continue;
    }
    if (
      provenance.splitOffset < minSplit ||
      (provenance.splitOffset === minSplit &&
        provenance.originalTail.length > shared.length)
    ) {
      minSplit = provenance.splitOffset;
      shared = provenance.originalTail;
    }
  }
  if (shared.length > 0) return shared;
  for (const provenance of provenances) {
    if (provenance.originalTail !== undefined && provenance.originalTail.length > shared.length) {
      shared = provenance.originalTail;
    }
  }
  return shared;
}

export function mergeStructuralContributions(
  sharedOriginalTail: string,
  tailProposedSemanticId: string,
  orderedCandidates: readonly {
    candidate: YjsCollisionCandidate;
    provenance: StructuralCollisionProvenance;
  }[]
): string {
  const allEvents = orderedCandidates.flatMap(({ provenance }) => provenance.editEvents);
  const splitOffsets = orderedCandidates
    .map(({ provenance }) => provenance.splitOffset)
    .filter((offset): offset is number => offset !== undefined);
  const sharedSplitOffset = splitOffsets.length > 0 ? Math.min(...splitOffsets) : undefined;
  return materializeTokenSequence(
    tailProposedSemanticId,
    sharedOriginalTail,
    allEvents,
    sharedSplitOffset
  );
}

export function replayStructuralEdits(
  tailProposedSemanticId: string,
  baseText: string,
  events: readonly AuthoredTextEditEvent[],
  sharedSplitOffset?: number
): string {
  return materializeTokenSequence(
    tailProposedSemanticId,
    baseText,
    events,
    sharedSplitOffset
  );
}

export function pruneIncorporatedSplitTailJournal(doc: Y.Doc): boolean {
  const journal = splitTailEditJournal(doc);
  const incorporatedCreationIds = new Set<string>();
  for (const value of getRootMap(doc, 'texts').values()) {
    const record = value as Y.Map<unknown>;
    if (typeof record.get('structuralSplitOffset') !== 'number') continue;
    for (const event of readAuthoredEditEvents(record)) {
      incorporatedCreationIds.add(event.creationId);
    }
  }
  let changed = false;
  for (const [key, value] of [...journal.entries()]) {
    const event = decodeAuthoredEditEvent(value);
    if (incorporatedCreationIds.has(event.creationId)) {
      journal.delete(key);
      changed = true;
    }
  }
  return changed;
}

/** @deprecated use readAuthoredEditEvents */
export const readAuthoredContributions = readAuthoredEditEvents;

/** @deprecated use validateAuthoredEditEvents */
export const validateAuthoredContributions = validateAuthoredEditEvents;
