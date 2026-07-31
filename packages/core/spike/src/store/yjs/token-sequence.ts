/** @spike-features yjs-backend */
import {
  codeUnitCompare,
  compareCollisionCandidates,
  parseCommitSeq,
  parseCreationId,
} from './identity';
import { YJS_MAX_CONTRIBUTIONS_PER_TEXT, YJS_MAX_SPLIT_TAIL_JOURNAL_ENTRIES } from './constants';
import { isValidUtf16Boundary, isValidUtf16Range } from '../utf16';

export type SequenceAnchor =
  | { readonly kind: 'origin' }
  | { readonly kind: 'end' }
  | { readonly kind: 'base'; readonly offset: number; readonly tokenId: string }
  | { readonly kind: 'token'; readonly tokenId: string };

export interface AuthoredTextInsertEvent {
  readonly kind: 'insert';
  readonly tokenId: string;
  readonly leftAnchor: SequenceAnchor;
  readonly rightAnchor: SequenceAnchor;
  readonly affinity: 'before' | 'after';
  readonly anchorSplitOffset: number;
  readonly text: string;
  readonly actorId: string;
  readonly commitId: string;
  readonly creationId: string;
  readonly sourceClientId: number;
}

export interface AuthoredTextDeleteEvent {
  readonly kind: 'delete';
  readonly tombstonedTokenIds: readonly string[];
  readonly observedInsertCreationIds: readonly string[];
  readonly anchorSplitOffset: number;
  readonly actorId: string;
  readonly commitId: string;
  readonly creationId: string;
  readonly sourceClientId: number;
}

export type AuthoredTextEditEvent = AuthoredTextInsertEvent | AuthoredTextDeleteEvent;

export interface TokenSequenceNode {
  readonly tokenId: string;
  readonly text: string;
  readonly kind: 'base' | 'insert';
}

export function baseTokenId(tailProposedSemanticId: string, offset: number): string {
  return `base:${tailProposedSemanticId}:${offset}`;
}

export function enumerateBaseTokenOffsets(text: string): readonly number[] {
  const offsets: number[] = [];
  for (let offset = 0; offset < text.length; ) {
    offsets.push(offset);
    const code = text.charCodeAt(offset);
    offset += code >= 0xd800 && code <= 0xdbff ? 2 : 1;
  }
  return Object.freeze(offsets);
}

export function compareAuthoredEditEvents(
  left: AuthoredTextEditEvent,
  right: AuthoredTextEditEvent
): number {
  return (
    compareCollisionCandidates(
      {
        creationId: left.creationId,
        actorId: left.actorId,
        commitId: left.commitId,
      },
      {
        creationId: right.creationId,
        actorId: right.actorId,
        commitId: right.commitId,
      }
    ) ||
    (parseCreationId(left.creationId)?.localSeq ?? 0) -
      (parseCreationId(right.creationId)?.localSeq ?? 0) ||
    codeUnitCompare(left.creationId, right.creationId) ||
    (left.kind === right.kind ? 0 : left.kind === 'delete' ? -1 : 1) ||
    (left.kind === 'insert' && right.kind === 'insert'
      ? codeUnitCompare(left.tokenId, right.tokenId) ||
        codeUnitCompare(left.text, right.text) ||
        anchorCompare(left.leftAnchor, right.leftAnchor) ||
        anchorCompare(left.rightAnchor, right.rightAnchor) ||
        (left.affinity === right.affinity ? 0 : left.affinity === 'before' ? -1 : 1)
      : left.kind === 'delete' && right.kind === 'delete'
        ? codeUnitCompare(
            [...left.tombstonedTokenIds].sort(codeUnitCompare).join('\u0000'),
            [...right.tombstonedTokenIds].sort(codeUnitCompare).join('\u0000')
          ) ||
          codeUnitCompare(
            [...left.observedInsertCreationIds].sort(codeUnitCompare).join('\u0000'),
            [...right.observedInsertCreationIds].sort(codeUnitCompare).join('\u0000')
          )
        : 0) ||
    left.sourceClientId - right.sourceClientId
  );
}

function anchorCompare(left: SequenceAnchor, right: SequenceAnchor): number {
  const leftKey = anchorSortKey(left);
  const rightKey = anchorSortKey(right);
  return codeUnitCompare(leftKey, rightKey);
}

function anchorSortKey(anchor: SequenceAnchor): string {
  if (anchor.kind === 'origin') return '0:origin';
  if (anchor.kind === 'end') return '3:end';
  if (anchor.kind === 'base') return `1:base:${anchor.offset}:${anchor.tokenId}`;
  return `2:token:${anchor.tokenId}`;
}

export function decodeSequenceAnchor(value: unknown): SequenceAnchor | null {
  if (value === null || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const kind = item.kind;
  if (kind === 'origin') return Object.freeze({ kind: 'origin' });
  if (kind === 'end') return Object.freeze({ kind: 'end' });
  if (kind === 'base') {
    const offset = item.offset;
    const tokenId = item.tokenId;
    if (
      typeof offset !== 'number' ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      typeof tokenId !== 'string' ||
      tokenId.length === 0
    ) {
      return null;
    }
    return Object.freeze({ kind: 'base', offset, tokenId });
  }
  if (kind === 'token') {
    if (typeof item.tokenId !== 'string' || item.tokenId.length === 0) return null;
    return Object.freeze({ kind: 'token', tokenId: item.tokenId });
  }
  return null;
}

function decodeContributionValue(value: unknown): AuthoredTextEditEvent | null {
  if (value === null || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const kind = item.kind;
  if (kind !== 'insert' && kind !== 'delete') return null;
  if (
    typeof item.actorId !== 'string' ||
    typeof item.commitId !== 'string' ||
    typeof item.creationId !== 'string' ||
    typeof item.sourceClientId !== 'number' ||
    !Number.isInteger(item.sourceClientId) ||
    item.sourceClientId <= 0 ||
    item.sourceClientId > 0xffff_ffff
  ) {
    return null;
  }
    const anchorSplitOffset = item.anchorSplitOffset;
    if (
      typeof anchorSplitOffset !== 'number' ||
      !Number.isSafeInteger(anchorSplitOffset) ||
      anchorSplitOffset < 0
    ) {
      return null;
    }
    if (kind === 'insert') {
    if (typeof item.text !== 'string' || typeof item.tokenId !== 'string') return null;
    const leftAnchor = decodeSequenceAnchor(item.leftAnchor);
    const rightAnchor = decodeSequenceAnchor(item.rightAnchor);
    const affinity = item.affinity;
    if (!leftAnchor || !rightAnchor || (affinity !== 'before' && affinity !== 'after')) {
      return null;
    }
    return Object.freeze({
      kind: 'insert',
      tokenId: item.tokenId,
      leftAnchor,
      rightAnchor,
      affinity,
      anchorSplitOffset,
      text: item.text,
      actorId: item.actorId,
      commitId: item.commitId,
      creationId: item.creationId,
      sourceClientId: item.sourceClientId,
    });
  }
  const tombstonedTokenIds = item.tombstonedTokenIds;
  if (!Array.isArray(tombstonedTokenIds) || tombstonedTokenIds.length === 0) return null;
  if (!tombstonedTokenIds.every((tokenId) => typeof tokenId === 'string' && tokenId.length > 0)) {
    return null;
  }
  const observedInsertCreationIds = item.observedInsertCreationIds;
  if (
    !Array.isArray(observedInsertCreationIds) ||
    !observedInsertCreationIds.every(
      (creationId) => typeof creationId === 'string' && creationId.length > 0
    )
  ) {
    return null;
  }
  return Object.freeze({
    kind: 'delete',
    tombstonedTokenIds: Object.freeze([...tombstonedTokenIds]),
    observedInsertCreationIds: Object.freeze([...observedInsertCreationIds]),
    anchorSplitOffset,
    actorId: item.actorId,
    commitId: item.commitId,
    creationId: item.creationId,
    sourceClientId: item.sourceClientId,
  });
}

export function decodeAuthoredEditEvent(value: unknown): AuthoredTextEditEvent {
  const decoded = decodeContributionValue(value);
  if (!decoded) throw new TypeError('authored edit event schema invalid');
  return decoded;
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

export function storedEventsEqual(left: unknown, right: Record<string, unknown>): boolean {
  const decoded = decodeContributionValue(left);
  if (!decoded) return false;
  return JSON.stringify(canonicalStoredEvent(decoded)) === JSON.stringify(right);
}

export function buildInitialTokenNodes(
  tailProposedSemanticId: string,
  sharedOriginalTail: string
): TokenSequenceNode[] {
  return enumerateBaseTokenOffsets(sharedOriginalTail).map((offset) =>
    Object.freeze({
      tokenId: baseTokenId(tailProposedSemanticId, offset),
      text: sharedOriginalTail.slice(
        offset,
        offset +
          (sharedOriginalTail.charCodeAt(offset) >= 0xd800 &&
          sharedOriginalTail.charCodeAt(offset) <= 0xdbff
            ? 2
            : 1)
      ),
      kind: 'base' as const,
    })
  );
}

function remapAnchorToSharedTail(
  anchor: SequenceAnchor,
  delta: number,
  tailProposedSemanticId: string
): SequenceAnchor {
  if (anchor.kind === 'base') {
    return baseAnchor(tailProposedSemanticId, anchor.offset + delta);
  }
  return anchor;
}

function remapTokenIdToSharedTail(
  tokenId: string,
  delta: number,
  tailProposedSemanticId: string
): string {
  const prefix = `base:${tailProposedSemanticId}:`;
  if (!tokenId.startsWith(prefix)) return tokenId;
  const offset = Number.parseInt(tokenId.slice(prefix.length), 10);
  if (!Number.isSafeInteger(offset)) return tokenId;
  return baseTokenId(tailProposedSemanticId, offset + delta);
}

export function remapEventToSharedTail(
  event: AuthoredTextEditEvent,
  sharedSplitOffset: number,
  tailProposedSemanticId: string
): AuthoredTextEditEvent {
  const delta = event.anchorSplitOffset - sharedSplitOffset;
  if (delta === 0) return event;
  if (event.kind === 'insert') {
    return Object.freeze({
      ...event,
      leftAnchor: remapAnchorToSharedTail(event.leftAnchor, delta, tailProposedSemanticId),
      rightAnchor: remapAnchorToSharedTail(event.rightAnchor, delta, tailProposedSemanticId),
    });
  }
  return Object.freeze({
    ...event,
    tombstonedTokenIds: Object.freeze(
      event.tombstonedTokenIds.map((tokenId) =>
        remapTokenIdToSharedTail(tokenId, delta, tailProposedSemanticId)
      )
    ),
  });
}

function remappedEventsForMaterialization(
  tailProposedSemanticId: string,
  events: readonly AuthoredTextEditEvent[],
  sharedSplitOffset?: number
): AuthoredTextEditEvent[] {
  const canonicalSplitOffset =
    sharedSplitOffset ??
    (events.length > 0
      ? Math.min(...events.map((event) => event.anchorSplitOffset))
      : undefined);
  if (canonicalSplitOffset === undefined) return [...events];
  return events.map((event) =>
    event.anchorSplitOffset === canonicalSplitOffset
      ? event
      : remapEventToSharedTail(event, canonicalSplitOffset, tailProposedSemanticId)
  );
}

function findNodeIndex(nodes: readonly TokenSequenceNode[], tokenId: string): number {
  return nodes.findIndex((node) => node.tokenId === tokenId);
}

function gapKey(leftAnchor: SequenceAnchor, rightAnchor: SequenceAnchor): string {
  return `${anchorSortKey(leftAnchor)}\u0000${anchorSortKey(rightAnchor)}`;
}

function normalizeGapAnchors(
  leftAnchor: SequenceAnchor,
  rightAnchor: SequenceAnchor,
  tailProposedSemanticId: string,
  sharedOriginalTail: string
): { readonly left: SequenceAnchor; readonly right: SequenceAnchor } {
  if (rightAnchor.kind === 'end' && leftAnchor.kind === 'base') {
    const offsets = enumerateBaseTokenOffsets(sharedOriginalTail);
    const next = offsets.find((offset) => offset > leftAnchor.offset);
    if (next !== undefined) {
      return Object.freeze({
        left: leftAnchor,
        right: baseAnchor(tailProposedSemanticId, next),
      });
    }
  }
  return Object.freeze({ left: leftAnchor, right: rightAnchor });
}

function normalizedGapKey(
  leftAnchor: SequenceAnchor,
  rightAnchor: SequenceAnchor,
  tailProposedSemanticId: string,
  sharedOriginalTail: string
): string {
  const normalized = normalizeGapAnchors(
    leftAnchor,
    rightAnchor,
    tailProposedSemanticId,
    sharedOriginalTail
  );
  return gapKey(normalized.left, normalized.right);
}

function openGapBounds(
  nodes: readonly TokenSequenceNode[],
  leftAnchor: SequenceAnchor,
  rightAnchor: SequenceAnchor
): { readonly start: number; readonly end: number } {
  let start = 0;
  if (leftAnchor.kind === 'token' || leftAnchor.kind === 'base') {
    const index = findNodeIndex(nodes, leftAnchor.tokenId);
    if (index < 0) throw new TypeError('insert left anchor missing');
    start = leftAnchor.kind === 'base' ? index + 1 : index + 1;
  }
  let end = nodes.length;
  if (rightAnchor.kind === 'token' || rightAnchor.kind === 'base') {
    const index = findNodeIndex(nodes, rightAnchor.tokenId);
    if (index < 0) throw new TypeError('insert right anchor missing');
    end = index;
  }
  if (start > end) throw new TypeError('insert anchors define an invalid gap');
  return Object.freeze({ start, end });
}

function gapAffinityKey(
  leftAnchor: SequenceAnchor,
  rightAnchor: SequenceAnchor,
  tailProposedSemanticId: string,
  sharedOriginalTail: string,
  affinity: 'before' | 'after'
): string {
  return `${normalizedGapKey(leftAnchor, rightAnchor, tailProposedSemanticId, sharedOriginalTail)}\u0000${affinity}`;
}

function resolveInsertIndex(
  nodes: readonly TokenSequenceNode[],
  leftAnchor: SequenceAnchor,
  rightAnchor: SequenceAnchor,
  affinity: 'before' | 'after',
  priorInsertsWithSameAffinityInGap: number
): number {
  const { start, end } = openGapBounds(nodes, leftAnchor, rightAnchor);
  if (affinity === 'before') {
    return Math.min(start + priorInsertsWithSameAffinityInGap, end);
  }
  return Math.max(start, end - priorInsertsWithSameAffinityInGap);
}

function applyInsertNodes(
  nodes: TokenSequenceNode[],
  event: AuthoredTextInsertEvent,
  priorInsertsWithSameAffinityInGap: number
): TokenSequenceNode[] {
  const index = resolveInsertIndex(
    nodes,
    event.leftAnchor,
    event.rightAnchor,
    event.affinity,
    priorInsertsWithSameAffinityInGap
  );
  const next = [...nodes];
  next.splice(
    index,
    0,
    Object.freeze({
      tokenId: event.tokenId,
      text: event.text,
      kind: 'insert',
    })
  );
  return next;
}

export function materializeTokenNodes(
  tailProposedSemanticId: string,
  sharedOriginalTail: string,
  events: readonly AuthoredTextEditEvent[],
  sharedSplitOffset?: number
): TokenSequenceNode[] {
  const remapped = remappedEventsForMaterialization(
    tailProposedSemanticId,
    events,
    sharedSplitOffset
  );
  const tombstones = new Set<string>();
  const inserts: AuthoredTextInsertEvent[] = [];
  for (const event of [...remapped].sort(compareAuthoredEditEvents)) {
    if (event.kind === 'delete') {
      for (const tokenId of event.tombstonedTokenIds) tombstones.add(tokenId);
      continue;
    }
    inserts.push(event);
  }

  let nodes = buildInitialTokenNodes(tailProposedSemanticId, sharedOriginalTail);
  const gapAffinityCounts = new Map<string, number>();
  for (const insert of topologicalInsertOrder(
    inserts,
    tailProposedSemanticId,
    sharedOriginalTail
  )) {
    const key = gapAffinityKey(
      insert.leftAnchor,
      insert.rightAnchor,
      tailProposedSemanticId,
      sharedOriginalTail,
      insert.affinity
    );
    const prior = gapAffinityCounts.get(key) ?? 0;
    nodes = applyInsertNodes(nodes, insert, prior);
    gapAffinityCounts.set(key, prior + 1);
  }
  return nodes.filter((node) => !tombstones.has(node.tokenId));
}

export function materializeTokenSequence(
  tailProposedSemanticId: string,
  sharedOriginalTail: string,
  events: readonly AuthoredTextEditEvent[],
  sharedSplitOffset?: number
): string {
  return materializeTokenNodes(
    tailProposedSemanticId,
    sharedOriginalTail,
    events,
    sharedSplitOffset
  ).reduce((text, node) => text + node.text, '');
}

export interface TokenRangeSelection {
  readonly leftAnchor: SequenceAnchor;
  readonly rightAnchor: SequenceAnchor;
  readonly affinity: 'before' | 'after';
  readonly tokenIds: readonly string[];
}

export function baseAnchor(tailProposedSemanticId: string, offset: number): SequenceAnchor {
  return Object.freeze({
    kind: 'base',
    offset,
    tokenId: baseTokenId(tailProposedSemanticId, offset),
  });
}

export function selectTokensAtOffset(
  tailProposedSemanticId: string,
  sharedOriginalTail: string,
  events: readonly AuthoredTextEditEvent[],
  offset: number
): TokenRangeSelection {
  const nodes = materializeTokenNodes(tailProposedSemanticId, sharedOriginalTail, events);
  let cursor = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const next = cursor + node.text.length;
    if (offset <= cursor) {
      const leftAnchor: SequenceAnchor =
        index === 0
          ? { kind: 'origin' }
          : nodes[index - 1]!.kind === 'base'
            ? baseAnchor(
                tailProposedSemanticId,
                enumerateBaseTokenOffsets(sharedOriginalTail).find(
                  (item) => baseTokenId(tailProposedSemanticId, item) === nodes[index - 1]!.tokenId
                ) ?? 0
              )
            : { kind: 'token', tokenId: nodes[index - 1]!.tokenId };
      const rightAnchor: SequenceAnchor =
        node.kind === 'base'
          ? baseAnchor(
              tailProposedSemanticId,
              enumerateBaseTokenOffsets(sharedOriginalTail).find(
                (item) => baseTokenId(tailProposedSemanticId, item) === node.tokenId
              ) ?? 0
            )
          : { kind: 'token', tokenId: node.tokenId };
      return Object.freeze({
        leftAnchor,
        rightAnchor,
        affinity: offset === cursor ? 'before' : 'after',
        tokenIds: Object.freeze([]),
      });
    }
    if (offset < next) {
      throw new TypeError('offset splits token interior');
    }
    if (offset === next) {
      const leftAnchor: SequenceAnchor =
        node.kind === 'base'
          ? baseAnchor(
              tailProposedSemanticId,
              enumerateBaseTokenOffsets(sharedOriginalTail).find(
                (item) => baseTokenId(tailProposedSemanticId, item) === node.tokenId
              ) ?? 0
            )
          : { kind: 'token', tokenId: node.tokenId };
      const rightAnchor: SequenceAnchor =
        index + 1 < nodes.length
          ? nodes[index + 1]!.kind === 'base'
            ? baseAnchor(
                tailProposedSemanticId,
                enumerateBaseTokenOffsets(sharedOriginalTail).find(
                  (item) => baseTokenId(tailProposedSemanticId, item) === nodes[index + 1]!.tokenId
                ) ?? 0
              )
            : { kind: 'token', tokenId: nodes[index + 1]!.tokenId }
          : { kind: 'end' };
      return Object.freeze({
        leftAnchor,
        rightAnchor,
        affinity: 'after',
        tokenIds: Object.freeze([]),
      });
    }
    cursor = next;
  }
  const last = nodes.at(-1);
  const leftAnchor: SequenceAnchor = last
    ? last.kind === 'base'
      ? baseAnchor(
          tailProposedSemanticId,
          enumerateBaseTokenOffsets(sharedOriginalTail).find(
            (item) => baseTokenId(tailProposedSemanticId, item) === last.tokenId
          ) ?? 0
        )
      : { kind: 'token', tokenId: last.tokenId }
    : { kind: 'origin' };
  return Object.freeze({
    leftAnchor,
    rightAnchor: { kind: 'end' as const },
    affinity: 'after',
    tokenIds: Object.freeze([]),
  });
}

export function collectTokenIdsInRange(
  tailProposedSemanticId: string,
  sharedOriginalTail: string,
  events: readonly AuthoredTextEditEvent[],
  start: number,
  end: number
): readonly string[] {
  if (!isValidUtf16Range(sharedOriginalTail, 0, sharedOriginalTail.length)) {
    throw new TypeError('shared original tail invalid');
  }
  const materialized = materializeTokenSequence(tailProposedSemanticId, sharedOriginalTail, events);
  if (!isValidUtf16Range(materialized, start, end)) {
    throw new TypeError('delete range invalid for token sequence');
  }
  const nodes = materializeTokenNodes(tailProposedSemanticId, sharedOriginalTail, events);
  const tokenIds: string[] = [];
  let cursor = 0;
  for (const node of nodes) {
    const nodeStart = cursor;
    const nodeEnd = cursor + node.text.length;
    if (nodeEnd > start && nodeStart < end) {
      tokenIds.push(node.tokenId);
    }
    cursor = nodeEnd;
  }
  return Object.freeze(tokenIds);
}

function dedupeAuthoredEditEventsByCreationId(
  events: readonly AuthoredTextEditEvent[]
): readonly AuthoredTextEditEvent[] {
  const seen = new Set<string>();
  const unique: AuthoredTextEditEvent[] = [];
  for (const event of [...events].sort(compareAuthoredEditEvents)) {
    if (seen.has(event.creationId)) continue;
    seen.add(event.creationId);
    unique.push(event);
  }
  return Object.freeze(unique);
}

function isDeleteCausallyAuthenticated(
  deleteEvent: AuthoredTextDeleteEvent,
  insertIds: ReadonlySet<string>
): boolean {
  const expected = observedInsertIdsFromTombstones(deleteEvent.tombstonedTokenIds, insertIds);
  if (deleteEvent.observedInsertCreationIds.length !== expected.length) return false;
  const observed = [...deleteEvent.observedInsertCreationIds].sort(codeUnitCompare);
  return observed.every((creationId, index) => creationId === expected[index]);
}

function insertTokenAnchorDependencies(insert: AuthoredTextInsertEvent): readonly string[] {
  const deps: string[] = [];
  for (const anchor of [insert.leftAnchor, insert.rightAnchor]) {
    if (anchor.kind === 'token') deps.push(anchor.tokenId);
  }
  return Object.freeze(deps);
}

function observedInsertIdsFromTombstones(
  tombstonedTokenIds: readonly string[],
  insertIds: ReadonlySet<string>
): readonly string[] {
  return Object.freeze(
    tombstonedTokenIds.filter((tokenId) => insertIds.has(tokenId)).sort(codeUnitCompare)
  );
}

function insertDependenciesReady(
  insert: AuthoredTextInsertEvent,
  placedTokenIds: ReadonlySet<string>,
  insertByTokenId: ReadonlyMap<string, AuthoredTextInsertEvent>
): boolean {
  return insertTokenAnchorDependencies(insert).every(
    (tokenId) => placedTokenIds.has(tokenId) || !insertByTokenId.has(tokenId)
  );
}

function topologicalInsertOrder(
  inserts: readonly AuthoredTextInsertEvent[],
  tailProposedSemanticId: string,
  sharedOriginalTail: string
): AuthoredTextInsertEvent[] {
  const insertByTokenId = new Map(inserts.map((insert) => [insert.tokenId, insert]));
  const placedTokenIds = new Set<string>(
    enumerateBaseTokenOffsets(sharedOriginalTail).map((offset) =>
      baseTokenId(tailProposedSemanticId, offset)
    )
  );
  const remaining = new Set(inserts.map((insert) => insert.tokenId));
  const ordered: AuthoredTextInsertEvent[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining]
      .map((tokenId) => insertByTokenId.get(tokenId)!)
      .filter((insert) => insertDependenciesReady(insert, placedTokenIds, insertByTokenId))
      .sort((left, right) => {
        const gapLeft = gapAffinityKey(
          left.leftAnchor,
          left.rightAnchor,
          tailProposedSemanticId,
          sharedOriginalTail,
          left.affinity
        );
        const gapRight = gapAffinityKey(
          right.leftAnchor,
          right.rightAnchor,
          tailProposedSemanticId,
          sharedOriginalTail,
          right.affinity
        );
        return codeUnitCompare(gapLeft, gapRight) || compareAuthoredEditEvents(left, right);
      });
    if (ready.length === 0) break;
    const next = ready[0]!;
    ordered.push(next);
    placedTokenIds.add(next.tokenId);
    remaining.delete(next.tokenId);
  }

  return ordered;
}

function hasInsertAnchorCycle(inserts: readonly AuthoredTextInsertEvent[]): boolean {
  const insertByTokenId = new Map(inserts.map((insert) => [insert.tokenId, insert]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(tokenId: string): boolean {
    if (visited.has(tokenId)) return false;
    if (visiting.has(tokenId)) return true;
    visiting.add(tokenId);
    const insert = insertByTokenId.get(tokenId);
    if (insert) {
      for (const dep of insertTokenAnchorDependencies(insert)) {
        if (insertByTokenId.has(dep) && visit(dep)) return true;
      }
    }
    visiting.delete(tokenId);
    visited.add(tokenId);
    return false;
  }

  for (const insert of inserts) {
    if (visit(insert.tokenId)) return true;
  }
  return false;
}

export function validateTokenEventGraph(
  tailProposedSemanticId: string,
  sharedOriginalTail: string,
  events: readonly AuthoredTextEditEvent[],
  errors: string[]
): void {
  const uniqueEvents = dedupeAuthoredEditEventsByCreationId(events);
  if (uniqueEvents.length > YJS_MAX_CONTRIBUTIONS_PER_TEXT) {
    errors.push('authored text contributions quota exceeded');
  }
  const knownBase = new Set(
    enumerateBaseTokenOffsets(sharedOriginalTail).map((offset) =>
      baseTokenId(tailProposedSemanticId, offset)
    )
  );
  const inserts = uniqueEvents.filter(
    (event): event is AuthoredTextInsertEvent => event.kind === 'insert'
  );
  const insertByTokenId = new Map(inserts.map((insert) => [insert.tokenId, insert]));
  const insertIds = new Set(insertByTokenId.keys());
  const tombstones = new Set<string>();
  const seenCreationIds = new Set<string>();

  for (const event of [...uniqueEvents].sort(compareAuthoredEditEvents)) {
    if (seenCreationIds.has(event.creationId)) {
      errors.push('authored text contribution creation ID duplicated');
    }
    seenCreationIds.add(event.creationId);
    if (event.kind !== 'insert') continue;
    if (event.tokenId !== event.creationId) {
      errors.push('insert token ID must equal event creation ID');
    }
    if (!isValidUtf16Boundary(event.text, 0) || !isValidUtf16Boundary(event.text, event.text.length)) {
      errors.push('insert text UTF-16 boundary invalid');
    }
    for (const anchor of [event.leftAnchor, event.rightAnchor]) {
      if (anchor.kind === 'base') {
        const expected = baseTokenId(tailProposedSemanticId, anchor.offset);
        if (anchor.tokenId !== expected || !knownBase.has(expected)) {
          errors.push('insert anchor references missing base token');
        }
      }
      if (anchor.kind === 'token' && !insertIds.has(anchor.tokenId)) {
        errors.push('insert anchor references dangling token');
      }
    }
  }

  if (hasInsertAnchorCycle(inserts)) {
    errors.push('insert anchor references cyclic token');
    return;
  }

  for (const event of [...uniqueEvents].sort(compareAuthoredEditEvents)) {
    if (event.kind !== 'delete') continue;
    if (event.tombstonedTokenIds.length === 0) {
      errors.push('delete must tombstone at least one token');
    }
    if (!isDeleteCausallyAuthenticated(event, insertIds)) {
      errors.push('delete causal basis invalid for tombstoned insert tokens');
    }
    for (const tokenId of event.tombstonedTokenIds) {
      if (tombstones.has(tokenId)) {
        errors.push('token tombstone duplicated across delete events');
      }
      tombstones.add(tokenId);
      if (!knownBase.has(tokenId) && !insertIds.has(tokenId)) {
        errors.push('delete references unknown token ID');
      }
    }
  }

  let nodes = buildInitialTokenNodes(tailProposedSemanticId, sharedOriginalTail);
  const gapAffinityCounts = new Map<string, number>();
  for (const insert of topologicalInsertOrder(
    inserts,
    tailProposedSemanticId,
    sharedOriginalTail
  )) {
    const key = gapAffinityKey(
      insert.leftAnchor,
      insert.rightAnchor,
      tailProposedSemanticId,
      sharedOriginalTail,
      insert.affinity
    );
    const prior = gapAffinityCounts.get(key) ?? 0;
    try {
      nodes = applyInsertNodes(nodes, insert, prior);
      gapAffinityCounts.set(key, prior + 1);
    } catch {
      errors.push('insert anchor references dangling token');
      return;
    }
  }
  for (const insert of inserts) {
    for (const anchor of [insert.leftAnchor, insert.rightAnchor]) {
      if (anchor.kind === 'token' && findNodeIndex(nodes, anchor.tokenId) < 0) {
        errors.push('insert anchor references dangling token');
      }
    }
  }
}

export function validateAuthoredEditEvents(
  events: readonly AuthoredTextEditEvent[],
  textRecord: { actorId: string; commitId: string; creationId: string },
  tailProposedSemanticId: string | undefined,
  sharedOriginalTail: string | undefined,
  allocator: ReadonlyMap<string, { nextLocalSeq: number; nextCommitSeq: number }> | undefined,
  errors: string[]
): void {
  const uniqueEvents = dedupeAuthoredEditEventsByCreationId(events);
  if (uniqueEvents.length > YJS_MAX_CONTRIBUTIONS_PER_TEXT) {
    errors.push('authored text contributions quota exceeded');
  }
  const orderedUnique = [...uniqueEvents].sort(compareAuthoredEditEvents);
  if (
    JSON.stringify(orderedUnique.map(canonicalStoredEvent)) !==
    JSON.stringify(uniqueEvents.map(canonicalStoredEvent))
  ) {
    errors.push('authored text contributions out of precedence order');
  }
  const seenCreationIds = new Set<string>();
  for (const event of uniqueEvents) {
    const creation = parseCreationId(event.creationId);
    const commitSeq = parseCommitSeq(event.commitId);
    if (!creation || creation.actorId !== event.actorId || commitSeq === null) {
      errors.push('authored text contribution provenance invalid');
      continue;
    }
    if (commitSeq !== creation.commitSeq) {
      errors.push('authored text contribution commit sequence invalid');
    }
    if (seenCreationIds.has(event.creationId)) {
      errors.push('authored text contribution creation ID duplicated');
    }
    seenCreationIds.add(event.creationId);
    const actorAllocator = allocator?.get(event.actorId);
    if (
      !actorAllocator ||
      actorAllocator.nextLocalSeq <= creation.localSeq ||
      actorAllocator.nextCommitSeq <= creation.commitSeq
    ) {
      errors.push('authored text contribution allocator coverage invalid');
    }
    if (
      !Number.isInteger(event.sourceClientId) ||
      event.sourceClientId <= 0 ||
      event.sourceClientId > 0xffff_ffff
    ) {
      errors.push('authored text contribution source client invalid');
    }
  }
  if (
    tailProposedSemanticId &&
    sharedOriginalTail !== undefined &&
    uniqueEvents.length > 0
  ) {
    validateTokenEventGraph(tailProposedSemanticId, sharedOriginalTail, events, errors);
  }
  if (uniqueEvents.length > 0) {
    const textCreation = parseCreationId(textRecord.creationId);
    const textCommit = parseCommitSeq(textRecord.commitId);
    if (!textCreation || textCommit === null || textCreation.actorId !== textRecord.actorId) {
      errors.push('authored text record provenance invalid');
    }
  }
}

export function canonicalEditEventJson(events: readonly AuthoredTextEditEvent[]): string {
  return JSON.stringify(events.map((item) => canonicalStoredEvent(item)));
}

export function validateSplitTailEditJournal(
  journalEntries: readonly { readonly key: string; readonly event: AuthoredTextEditEvent }[],
  contributionsByTail: ReadonlyMap<string, readonly AuthoredTextEditEvent[]>,
  errors: string[]
): void {
  const uniqueEntries: Array<{ readonly key: string; readonly event: AuthoredTextEditEvent }> = [];
  for (const entry of journalEntries) {
    const existing = uniqueEntries.find((item) => item.key === entry.key);
    if (existing) {
      if (canonicalEditEventJson([existing.event]) !== canonicalEditEventJson([entry.event])) {
        errors.push('split tail edit journal entry mismatch');
      }
      continue;
    }
    uniqueEntries.push(entry);
  }
  if (uniqueEntries.length > YJS_MAX_SPLIT_TAIL_JOURNAL_ENTRIES) {
    errors.push('split tail edit journal quota exceeded');
  }
  const seenKeys = new Set<string>();
  for (const entry of uniqueEntries) {
    if (seenKeys.has(entry.key)) {
      errors.push('split tail edit journal key duplicated');
    }
    seenKeys.add(entry.key);
    const [tailBlockProposedId, creationId] = entry.key.split('\u0000');
    if (!tailBlockProposedId || !creationId || creationId !== entry.event.creationId) {
      errors.push('split tail edit journal key invalid');
    }
    const contributions = contributionsByTail.get(tailBlockProposedId) ?? [];
    const match = contributions.find((event) => event.creationId === entry.event.creationId);
    if (!match) {
      errors.push('split tail edit journal entry missing authored contribution');
      continue;
    }
    if (canonicalEditEventJson([match]) !== canonicalEditEventJson([entry.event])) {
      errors.push('split tail edit journal entry mismatch');
    }
  }
}
