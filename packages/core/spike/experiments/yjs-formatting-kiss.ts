/** @spike-features yjs-backend — task 2.4 direct KISS formatting falsification */
import * as Y from 'yjs';

export type CandidateName = 'native-attributes' | 'mark-contributions';
export type CaseName =
  | 'overlap-undo'
  | 'observed-disable'
  | 'mark-independence'
  | 'endpoint-affinity'
  | 'split-tail'
  | 'reopen-history';

type EvidenceValue = boolean | number | string | readonly string[] | readonly number[];

export interface CaseOutcome {
  readonly passed: boolean;
  readonly diagnostic: string;
  readonly evidence: Readonly<Record<string, EvidenceValue>>;
}

export interface ByteMetric {
  readonly authoredOperationBytes: number;
  readonly historyOperationBytes: number;
  readonly terminalSnapshotBytes: number;
  readonly authoredOperationCount: number;
  readonly historyOperationCount: number;
  readonly terminalSnapshotCount: number;
  readonly totalBytes: number;
  readonly schedule: 'genesis-excluded-source-updates-plus-terminal-snapshots';
}

export interface CandidateResult {
  readonly passed: boolean;
  readonly encodedBytes: number;
  readonly byteMetric: ByteMetric;
  readonly clientIdSchedule: readonly number[];
  readonly clientIdsCollisionFree: boolean;
  readonly cases: Readonly<Record<CaseName, CaseOutcome>>;
}

export interface BakeoffResult {
  readonly cases: readonly CaseName[];
  readonly candidates: Readonly<Record<CandidateName, CandidateResult>>;
  readonly winner: CandidateName | null;
}

type MarkKind = 'bold' | 'italic';

interface BoundaryEmbed {
  readonly kind: 'paragraph-boundary';
  readonly paragraphId: string;
}

interface ContributionMeta {
  readonly semanticMarkId: string;
  readonly actorId: string;
  readonly commitId: string;
  readonly kind: MarkKind;
  readonly authoredRawValue?: string;
}

interface MarkSegment {
  readonly kind: MarkKind;
  readonly start: number;
  readonly end: number;
  readonly owners: readonly string[];
}

interface Context {
  readonly doc: Y.Doc;
  readonly clientId: number;
  readonly body: Y.Text;
  readonly formattingMetadata: Y.Map<ContributionMeta>;
  readonly markContributions: Y.Map<Record<string, unknown>>;
}

interface ScenarioResult {
  readonly outcome: CaseOutcome;
  readonly authoredUpdates: readonly Uint8Array[];
  readonly historyUpdates: readonly Uint8Array[];
  readonly terminalSnapshots: readonly Uint8Array[];
}

interface CandidateAdapter {
  readonly name: CandidateName;
  enable(
    ctx: Context,
    origin: string,
    kind: MarkKind,
    start: number,
    end: number,
    contributionId: string,
    metadata: ContributionMeta
  ): void;
  disable(ctx: Context, origin: string, kind: MarkKind, start: number, end: number): void;
  segments(ctx: Context): MarkSegment[];
  evidenceRecords(ctx: Context): readonly Record<string, unknown>[];
  trackedTypes(ctx: Context): Y.AbstractType<any>[];
}

type JournalEntry =
  | {
      readonly op: 'enable';
      readonly kind: MarkKind;
      readonly start: number;
      readonly end: number;
      readonly contributionId: string;
      readonly metadata: ContributionMeta;
    }
  | {
      readonly op: 'disable';
      readonly kind: MarkKind;
      readonly start: number;
      readonly end: number;
    };

const CASES: readonly CaseName[] = [
  'overlap-undo',
  'observed-disable',
  'mark-independence',
  'endpoint-affinity',
  'split-tail',
  'reopen-history',
];
const RECORD_BOUND = 16;
const BYTE_BOUND = 20_000;
let nextClientId = 10_000;
let allocatedClientIds: number[] = [];

function allocateClientId(): number {
  const clientId = nextClientId++;
  allocatedClientIds.push(clientId);
  return clientId;
}

function boundary(paragraphId: string): BoundaryEmbed {
  return Object.freeze({ kind: 'paragraph-boundary', paragraphId });
}

function createEmptyContext(clientId = allocateClientId()): Context {
  const doc = new Y.Doc({ gc: false, guid: `kiss-${clientId}` });
  doc.clientID = clientId;
  return Object.freeze({
    doc,
    clientId,
    body: doc.getText('bodySequence'),
    formattingMetadata: doc.getMap<ContributionMeta>('formattingMetadata'),
    markContributions: doc.getMap<Record<string, unknown>>('markContributions'),
  });
}

function createBase(text: string, clientId = allocateClientId()): Context {
  const ctx = createEmptyContext(clientId);
  ctx.doc.transact(() => {
    ctx.body.insertEmbed(0, boundary('p0'));
    ctx.body.insert(1, text);
    ctx.body.insertEmbed(ctx.body.length, boundary('p1'));
  }, 'fixture');
  return ctx;
}

function cloneFromUpdate(update: Uint8Array, clientId = allocateClientId()): Context {
  const ctx = createEmptyContext(clientId);
  Y.applyUpdate(ctx.doc, update, 'restore');
  return ctx;
}

function cloneContext(source: Context): Context {
  return cloneFromUpdate(Y.encodeStateAsUpdate(source.doc));
}

function applyUpdates(base: Context, updates: readonly Uint8Array[]): Context {
  const merged = cloneContext(base);
  for (const update of updates) Y.applyUpdate(merged.doc, update, 'delivery');
  return merged;
}

function sumBytes(updates: readonly Uint8Array[]): number {
  return updates.reduce((total, update) => total + update.byteLength, 0);
}

function captureSourceUpdate(ctx: Context, operation: () => void): Uint8Array {
  const updates: Uint8Array[] = [];
  const listener = (update: Uint8Array): void => {
    updates.push(update.slice());
  };
  ctx.doc.on('update', listener);
  try {
    operation();
  } finally {
    ctx.doc.off('update', listener);
  }
  if (updates.length !== 1) {
    throw new TypeError(`expected one source update, received ${updates.length}`);
  }
  return updates[0]!;
}

function scenarioResult(
  outcome: CaseOutcome,
  terminals: readonly Context[],
  authoredUpdates: readonly Uint8Array[],
  historyUpdates: readonly Uint8Array[] = []
): ScenarioResult {
  const terminalSnapshots = terminals.map((terminal) => Y.encodeStateAsUpdate(terminal.doc));
  const sourceUpdateCount = authoredUpdates.length + historyUpdates.length;
  const updateBytes = sumBytes([...authoredUpdates, ...historyUpdates]);
  const snapshotBytes = sumBytes(terminalSnapshots);
  return {
    outcome: {
      ...outcome,
      evidence: {
        ...outcome.evidence,
        sourceOperationUpdateCount: sourceUpdateCount,
        authoredOperationUpdateCount: authoredUpdates.length,
        historyOperationUpdateCount: historyUpdates.length,
        sourceOperationBytes: updateBytes,
        terminalSnapshotCount: terminalSnapshots.length,
        terminalSnapshotBytes: snapshotBytes,
        totalScenarioBytes: updateBytes + snapshotBytes,
        byteAccountingMatches:
          updateBytes + snapshotBytes ===
          sumBytes([...authoredUpdates, ...historyUpdates, ...terminalSnapshots]),
      },
    },
    authoredUpdates,
    historyUpdates,
    terminalSnapshots,
  };
}

function metadata(
  actorId: string,
  commitId: string,
  kind: MarkKind,
  authoredRawValue?: string
): ContributionMeta {
  const value = {
    semanticMarkId: `${actorId}:${commitId}:${kind}`,
    actorId,
    commitId,
    kind,
  };
  return Object.freeze(
    authoredRawValue === undefined ? value : { ...value, authoredRawValue }
  );
}

function textIndices(body: Y.Text): Set<number> {
  const result = new Set<number>();
  let index = 0;
  for (const delta of body.toDelta()) {
    const length = typeof delta.insert === 'string' ? delta.insert.length : 1;
    if (typeof delta.insert === 'string') {
      for (let offset = 0; offset < length; offset++) result.add(index + offset);
    }
    index += length;
  }
  return result;
}

function clipText(body: Y.Text, start: number, end: number): { start: number; end: number } | null {
  const indices = textIndices(body);
  let low = Math.min(start, end);
  let high = Math.max(start, end);
  while (low < high && !indices.has(low)) low++;
  while (high > low && !indices.has(high - 1)) high--;
  return high > low ? { start: low, end: high } : null;
}

function encodeEndpoint(body: Y.Text, index: number, affinity: 'before' | 'after'): string {
  const relative = Y.createRelativePositionFromTypeIndex(body, index, affinity === 'before' ? -1 : 0);
  return btoa(String.fromCharCode(...Y.encodeRelativePosition(relative)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeEndpoint(ctx: Context, value: string): number {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError('endpoint is not canonical base64url');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const absolute = Y.createAbsolutePositionFromRelativePosition(
    Y.decodeRelativePosition(bytes),
    ctx.doc
  );
  if (!absolute || absolute.type !== ctx.body) throw new TypeError('endpoint detached');
  return absolute.index;
}

function plainRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.freeze({ ...record });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every((field) => !(field instanceof Y.AbstractType))
  );
}

function setCreationOnly(
  map: Y.Map<Record<string, unknown>>,
  key: string,
  value: Record<string, unknown>
): void {
  if (map.has(key)) throw new TypeError(`creation-only key already exists: ${key}`);
  map.set(key, plainRecord(value));
}

function subtractIntervals(
  start: number,
  end: number,
  removes: readonly { start: number; end: number }[]
): Array<{ start: number; end: number }> {
  let ranges = [{ start, end }];
  for (const remove of removes) {
    ranges = ranges.flatMap((range) => {
      if (remove.end <= range.start || remove.start >= range.end) return [range];
      const parts: Array<{ start: number; end: number }> = [];
      if (remove.start > range.start) parts.push({ start: range.start, end: remove.start });
      if (remove.end < range.end) parts.push({ start: remove.end, end: range.end });
      return parts;
    });
  }
  return ranges.filter((range) => range.end > range.start);
}

const nativeAttributes: CandidateAdapter = {
  name: 'native-attributes',
  enable(ctx, origin, kind, start, end, contributionId, meta) {
    const range = clipText(ctx.body, start, end);
    if (!range) return;
    ctx.doc.transact(() => {
      if (!ctx.formattingMetadata.has(contributionId)) {
        ctx.formattingMetadata.set(contributionId, Object.freeze({ ...meta }));
      }
      ctx.body.format(range.start, range.end - range.start, { [kind]: contributionId });
    }, origin);
  },
  disable(ctx, origin, kind, start, end) {
    const range = clipText(ctx.body, start, end);
    if (!range) return;
    ctx.doc.transact(
      () => ctx.body.format(range.start, range.end - range.start, { [kind]: null }),
      origin
    );
  },
  segments(ctx) {
    const segments: MarkSegment[] = [];
    let index = 0;
    for (const delta of ctx.body.toDelta()) {
      const length = typeof delta.insert === 'string' ? delta.insert.length : 1;
      if (typeof delta.insert === 'string') {
        for (const kind of ['bold', 'italic'] as const) {
          const owner = delta.attributes?.[kind];
          if (typeof owner === 'string' && ctx.formattingMetadata.get(owner)?.kind === kind) {
            segments.push({ kind, start: index, end: index + length, owners: [owner] });
          }
        }
      }
      index += length;
    }
    return segments;
  },
  evidenceRecords(ctx) {
    return [...ctx.formattingMetadata.entries()].map(([id, value]) => ({ id, ...value }));
  },
  trackedTypes(ctx) {
    return [ctx.body];
  },
};

const markContributions: CandidateAdapter = {
  name: 'mark-contributions',
  enable(ctx, origin, kind, start, end, contributionId, meta) {
    const range = clipText(ctx.body, start, end);
    if (!range) return;
    ctx.doc.transact(() => {
      const record: Record<string, unknown> = {
        kind: 'add',
        markKind: kind,
        actorId: meta.actorId,
        commitId: meta.commitId,
        proposedSemanticMarkId: meta.semanticMarkId,
        relativeStart: encodeEndpoint(ctx.body, range.start, 'after'),
        relativeEnd: encodeEndpoint(ctx.body, range.end, 'before'),
      };
      if (meta.authoredRawValue !== undefined) {
        record.authoredRawValue = meta.authoredRawValue;
      }
      setCreationOnly(ctx.markContributions, contributionId, record);
    }, origin);
  },
  disable(ctx, origin, kind, start, end) {
    const range = clipText(ctx.body, start, end);
    if (!range) return;
    const targets: string[] = [];
    ctx.markContributions.forEach((record, id) => {
      if (record.kind !== 'add' || record.markKind !== kind) return;
      const addStart = decodeEndpoint(ctx, record.relativeStart as string);
      const addEnd = decodeEndpoint(ctx, record.relativeEnd as string);
      if (addStart < range.end && addEnd > range.start) targets.push(id);
    });
    targets.sort();
    if (targets.length === 0) return;
    const removeId = `remove:${origin}:${kind}:${range.start}:${range.end}`;
    ctx.doc.transact(() => {
      setCreationOnly(ctx.markContributions, removeId, {
        kind: 'remove',
        markKind: kind,
        actorId: origin,
        commitId: `${origin}:disable`,
        relativeStart: encodeEndpoint(ctx.body, range.start, 'after'),
        relativeEnd: encodeEndpoint(ctx.body, range.end, 'before'),
        targetAddContributionIds: Object.freeze([...targets]),
      });
    }, origin);
  },
  segments(ctx) {
    const adds: Array<{
      id: string;
      kind: MarkKind;
      start: number;
      end: number;
    }> = [];
    const removals: Array<{
      kind: MarkKind;
      start: number;
      end: number;
      targets: readonly string[];
    }> = [];
    ctx.markContributions.forEach((record, id) => {
      if (record.kind === 'add') {
        adds.push({
          id,
          kind: record.markKind as MarkKind,
          start: decodeEndpoint(ctx, record.relativeStart as string),
          end: decodeEndpoint(ctx, record.relativeEnd as string),
        });
      } else if (record.kind === 'remove') {
        removals.push({
          kind: record.markKind as MarkKind,
          start: decodeEndpoint(ctx, record.relativeStart as string),
          end: decodeEndpoint(ctx, record.relativeEnd as string),
          targets: record.targetAddContributionIds as readonly string[],
        });
      }
    });
    return adds
      .sort((left, right) => left.id.localeCompare(right.id))
      .flatMap((add) =>
        subtractIntervals(
          add.start,
          add.end,
          removals
            .filter((remove) => remove.kind === add.kind && remove.targets.includes(add.id))
            .map(({ start, end }) => ({ start, end }))
        ).map((range) => ({ ...range, kind: add.kind, owners: [add.id] }))
      );
  },
  evidenceRecords(ctx) {
    return [...ctx.markContributions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, value]) => ({ id, ...value }));
  },
  trackedTypes(ctx) {
    return [ctx.body, ctx.markContributions];
  },
};

function createUndoManager(ctx: Context, adapter: CandidateAdapter, origin: string): Y.UndoManager {
  return new Y.UndoManager(adapter.trackedTypes(ctx), {
    trackedOrigins: new Set([origin]),
    captureTimeout: Number.MAX_SAFE_INTEGER,
  });
}

function ownersIntersecting(
  adapter: CandidateAdapter,
  ctx: Context,
  kind: MarkKind,
  start: number,
  end: number
): string[] {
  return [
    ...new Set(
      adapter
        .segments(ctx)
        .filter((segment) => segment.kind === kind && segment.start < end && segment.end > start)
        .flatMap((segment) => segment.owners)
    ),
  ].sort();
}

function isCovered(
  adapter: CandidateAdapter,
  ctx: Context,
  kind: MarkKind,
  index: number
): boolean {
  return adapter
    .segments(ctx)
    .some((segment) => segment.kind === kind && segment.start <= index && index < segment.end);
}

function sequenceText(body: Y.Text): string {
  let result = '';
  for (const delta of body.toDelta()) {
    if (typeof delta.insert === 'string') result += delta.insert;
  }
  return result;
}

function markedText(adapter: CandidateAdapter, ctx: Context, kind: MarkKind): string {
  let result = '';
  let index = 0;
  for (const delta of ctx.body.toDelta()) {
    const length = typeof delta.insert === 'string' ? delta.insert.length : 1;
    if (typeof delta.insert === 'string') {
      for (let offset = 0; offset < length; offset++) {
        if (isCovered(adapter, ctx, kind, index + offset)) result += delta.insert[offset];
      }
    }
    index += length;
  }
  return result;
}

function semanticFingerprint(adapter: CandidateAdapter, ctx: Context): string {
  return JSON.stringify({
    delta: ctx.body.toDelta(),
    segments: adapter.segments(ctx),
  });
}

function byteToken(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function branchStateVectors(left: Context, right: Context): readonly string[] {
  return [byteToken(Y.encodeStateVector(left.doc)), byteToken(Y.encodeStateVector(right.doc))];
}

function sameCausalBase(vectors: readonly string[]): boolean {
  return vectors.length === 2 && vectors[0] === vectors[1];
}

function fullStatesEqual(left: Context, right: Context): boolean {
  return Buffer.from(Y.encodeStateAsUpdate(left.doc)).equals(
    Buffer.from(Y.encodeStateAsUpdate(right.doc))
  );
}

function runOverlapUndo(adapter: CandidateAdapter): ScenarioResult {
  const base = createBase('abcdefghij');
  const alice = cloneContext(base);
  const bob = cloneContext(base);
  const vectors = branchStateVectors(alice, bob);
  const aliceUndo = createUndoManager(alice, adapter, 'alice');
  const aliceUpdate = captureSourceUpdate(alice, () =>
    adapter.enable(alice, 'alice', 'bold', 2, 7, 'alice:add', metadata('alice', 'a1', 'bold'))
  );
  aliceUndo.stopCapturing();
  const bobUpdate = captureSourceUpdate(bob, () =>
    adapter.enable(bob, 'bob', 'bold', 4, 9, 'bob:add', metadata('bob', 'b1', 'bold'))
  );
  const orderAB = applyUpdates(base, [aliceUpdate, bobUpdate]);
  const orderBA = applyUpdates(base, [bobUpdate, aliceUpdate]);
  Y.applyUpdate(alice.doc, bobUpdate, 'delivery');
  const owners = ownersIntersecting(adapter, alice, 'bold', 4, 7);
  const undoUpdate = captureSourceUpdate(alice, () => aliceUndo.undo());
  Y.applyUpdate(orderAB.doc, undoUpdate, 'delivery');
  Y.applyUpdate(orderBA.doc, undoUpdate, 'delivery');
  const converged =
    semanticFingerprint(adapter, orderAB) === semanticFingerprint(adapter, orderBA);
  const terminalStatesEqual = fullStatesEqual(orderAB, orderBA);
  const otherSurvived = ownersIntersecting(adapter, alice, 'bold', 4, 9).includes('bob:add');
  const concurrent = sameCausalBase(vectors);
  const passed =
    owners.length === 2 && otherSurvived && concurrent && converged && terminalStatesEqual;
  return scenarioResult(
    {
      passed,
      diagnostic: passed
        ? 'two same-kind owners coexist before actor undo; other owner survives'
        : `pre-undo owners=${owners.join(',') || 'none'} other-survived=${otherSurvived}`,
      evidence: {
        preUndoOwnerCount: owners.length,
        preUndoOwners: owners,
        otherActorSurvivedUndo: otherSurvived,
        branchStateVectors: vectors,
        concurrentFromSameBase: concurrent,
        bothDeliveryOrdersConverged: converged,
        terminalStatesEqual,
      },
    },
    [alice, orderAB, orderBA],
    [aliceUpdate, bobUpdate],
    [undoUpdate]
  );
}

function runObservedDisable(adapter: CandidateAdapter): ScenarioResult {
  const observed = createBase('0123456789');
  const aliceObservedUpdate = captureSourceUpdate(observed, () =>
    adapter.enable(
      observed,
      'alice',
      'bold',
      2,
      7,
      'alice:observed',
      metadata('alice', 'a1', 'bold')
    )
  );
  const bobObservedUpdate = captureSourceUpdate(observed, () =>
    adapter.enable(
      observed,
      'bob',
      'bold',
      5,
      9,
      'bob:observed',
      metadata('bob', 'b1', 'bold')
    )
  );
  const causalBase = Y.encodeStateAsUpdate(observed.doc);
  const disabling = cloneFromUpdate(causalBase);
  const unseen = cloneFromUpdate(causalBase);
  const vectors = branchStateVectors(disabling, unseen);
  const observedOwners = ownersIntersecting(adapter, observed, 'bold', 2, 9);
  const disableUpdate = captureSourceUpdate(disabling, () =>
    adapter.disable(disabling, 'alice', 'bold', 2, 9)
  );
  const unseenUpdate = captureSourceUpdate(unseen, () =>
    adapter.enable(
      unseen,
      'carol',
      'bold',
      6,
      10,
      'carol:unseen',
      metadata('carol', 'c1', 'bold')
    )
  );
  const orderDU = applyUpdates(observed, [disableUpdate, unseenUpdate]);
  const orderUD = applyUpdates(observed, [unseenUpdate, disableUpdate]);
  const postOwners = ownersIntersecting(adapter, orderDU, 'bold', 2, 10);
  const observedDisabled = observedOwners.every((owner) => !postOwners.includes(owner));
  const unseenPreserved = postOwners.includes('carol:unseen');
  const converged =
    semanticFingerprint(adapter, orderDU) === semanticFingerprint(adapter, orderUD);
  const terminalStatesEqual = fullStatesEqual(orderDU, orderUD);
  const concurrent = sameCausalBase(vectors);
  const remove = [...disabling.markContributions.values()].find(
    (record) => record.kind === 'remove'
  );
  const targets = (remove?.targetAddContributionIds as readonly string[] | undefined) ?? [];
  const targetsFromYjsState =
    adapter.name === 'native-attributes' ||
    (targets.length === observedOwners.length &&
      observedOwners.every((owner) => targets.includes(owner)));
  const creationOnlyRecords =
    adapter.name === 'native-attributes' ||
    observedOwners.every(
      (owner) =>
        JSON.stringify(orderDU.markContributions.get(owner)) ===
        JSON.stringify(observed.markContributions.get(owner))
    );
  const passed =
    observedOwners.length === 2 &&
    observedDisabled &&
    unseenPreserved &&
    concurrent &&
    converged &&
    terminalStatesEqual &&
    targetsFromYjsState &&
    creationOnlyRecords;
  return scenarioResult(
    {
      passed,
      diagnostic: passed
        ? 'all observed intersecting owners disabled; concurrent unseen owner preserved'
        : `post-disable owners=${postOwners.join(',') || 'none'}`,
      evidence: {
        observedIntersectingCount: observedOwners.length,
        observedIntersectingIds: observedOwners,
        observedDisabled,
        unseenPreserved,
        targetsFromYjsState,
        creationOnlyRecords,
        branchStateVectors: vectors,
        concurrentFromSameBase: concurrent,
        bothDeliveryOrdersConverged: converged,
        terminalStatesEqual,
      },
    },
    [orderDU, orderUD],
    [aliceObservedUpdate, bobObservedUpdate, disableUpdate, unseenUpdate]
  );
}

function runMarkIndependence(adapter: CandidateAdapter): ScenarioResult {
  const ctx = createBase('0123456789');
  const undo = createUndoManager(ctx, adapter, 'alice');
  const italicUpdate = captureSourceUpdate(ctx, () =>
    adapter.enable(
      ctx,
      'alice',
      'italic',
      2,
      8,
      'alice:italic',
      metadata('alice', 'i1', 'italic')
    )
  );
  undo.stopCapturing();
  const boldUpdate = captureSourceUpdate(ctx, () =>
    adapter.enable(
      ctx,
      'alice',
      'bold',
      2,
      8,
      'alice:bold',
      metadata('alice', 'b1', 'bold', 'w:val="1"')
    )
  );
  undo.stopCapturing();
  const records = adapter.evidenceRecords(ctx);
  const synced = cloneContext(ctx);
  const syncedRecords = adapter.evidenceRecords(synced);
  const beforeProjection = Y.encodeStateAsUpdate(ctx.doc);
  adapter.segments(ctx);
  const afterProjection = Y.encodeStateAsUpdate(ctx.doc);
  const undoUpdate = captureSourceUpdate(ctx, () => undo.undo());
  const independentAfterUndo =
    ownersIntersecting(adapter, ctx, 'bold', 2, 8).length === 0 &&
    ownersIntersecting(adapter, ctx, 'italic', 2, 8).includes('alice:italic');
  const redoUpdate = captureSourceUpdate(ctx, () => undo.redo());
  const independent =
    independentAfterUndo &&
    ownersIntersecting(adapter, ctx, 'bold', 2, 8).includes('alice:bold') &&
    ownersIntersecting(adapter, ctx, 'italic', 2, 8).includes('alice:italic');
  const finalRecords = adapter.evidenceRecords(ctx);
  const recordText = JSON.stringify(records);
  const semanticMarkIdPreserved =
    recordText.includes('alice:i1:italic') && recordText.includes('alice:b1:bold');
  const provenancePreserved =
    recordText.includes('"actorId":"alice"') &&
    recordText.includes('"commitId":"i1"') &&
    recordText.includes('"commitId":"b1"');
  const normalizationReadOnly =
    Buffer.from(beforeProjection).equals(Buffer.from(afterProjection));
  const explicitRecord = records.find((record) => record.id === 'alice:bold');
  const omittedRecord = records.find((record) => record.id === 'alice:italic');
  const explicitRawLexicalValue = explicitRecord?.authoredRawValue as string | undefined;
  const omittedRecordHasRawValue =
    omittedRecord !== undefined &&
    Object.prototype.hasOwnProperty.call(omittedRecord, 'authoredRawValue');
  const formattingRawIntentPreserved =
    explicitRawLexicalValue === 'w:val="1"' &&
    !omittedRecordHasRawValue &&
    JSON.stringify(records) === JSON.stringify(syncedRecords) &&
    JSON.stringify(records) === JSON.stringify(finalRecords);
  const contributionRecords = [...ctx.markContributions.values()];
  const plainImmutableRecords =
    adapter.name === 'native-attributes' || contributionRecords.every(isPlainRecord);
  const endpointValues = contributionRecords.flatMap((record) => [
    record.relativeStart,
    record.relativeEnd,
  ]);
  const canonicalBase64urlEndpoints =
    adapter.name === 'native-attributes' ||
    endpointValues.every(
      (endpoint) =>
        typeof endpoint === 'string' &&
        /^[A-Za-z0-9_-]+$/.test(endpoint) &&
        !endpoint.includes('=')
    );
  const passed =
    independent &&
    semanticMarkIdPreserved &&
    provenancePreserved &&
    formattingRawIntentPreserved &&
    normalizationReadOnly &&
    plainImmutableRecords &&
    canonicalBase64urlEndpoints;
  return scenarioResult(
    {
      passed,
      diagnostic: passed
        ? 'marks independent; identity, provenance, omission, raw intent, and read-only projection preserved'
        : 'mark independence or authored evidence failed',
      evidence: {
        boldItalicIndependent: independent,
        semanticMarkIdPreserved,
        actorCommitProvenancePreserved: provenancePreserved,
        explicitRawLexicalValue: explicitRawLexicalValue ?? '',
        omittedRecordHasRawValue,
        formattingRawIntentPreservedAcrossSyncProjectionUndoRedo:
          formattingRawIntentPreserved,
        normalizationWasReadOnly: normalizationReadOnly,
        plainImmutableRecords,
        canonicalBase64urlEndpoints,
      },
    },
    [ctx],
    [italicUpdate, boldUpdate],
    [undoUpdate, redoUpdate]
  );
}

function runEndpointAffinity(adapter: CandidateAdapter): ScenarioResult {
  const base = createBase('0123456789');
  const formatting = cloneContext(base);
  const typing = cloneContext(base);
  const vectors = branchStateVectors(formatting, typing);
  const formatUpdate = captureSourceUpdate(formatting, () =>
    adapter.enable(
      formatting,
      'alice',
      'bold',
      3,
      7,
      'alice:endpoint',
      metadata('alice', 'e1', 'bold')
    )
  );
  const typingUpdate = captureSourceUpdate(typing, () =>
    typing.doc.transact(() => typing.body.insert(7, 'X'), 'bob')
  );
  const orderFT = applyUpdates(base, [formatUpdate, typingUpdate]);
  const orderTF = applyUpdates(base, [typingUpdate, formatUpdate]);
  const concurrent = sameCausalBase(vectors);
  const converged =
    semanticFingerprint(adapter, orderFT) === semanticFingerprint(adapter, orderTF);
  const terminalStatesEqual = fullStatesEqual(orderFT, orderTF);
  const originalCoverage = markedText(adapter, orderFT, 'bold') === '2345';
  const insertionExcluded = !markedText(adapter, orderFT, 'bold').includes('X');
  const passed =
    concurrent && converged && terminalStatesEqual && originalCoverage && insertionExcluded;
  return scenarioResult(
    {
      passed,
      diagnostic: passed
        ? 'concurrent tail insertion excluded with identical half-open endpoint semantics'
        : `marked text=${markedText(adapter, orderFT, 'bold')}`,
      evidence: {
        concurrentFromSameBase: concurrent,
        branchStateVectors: vectors,
        bothDeliveryOrdersConverged: converged,
        terminalStatesEqual,
        boundaryInsertionExcluded: insertionExcluded,
        originalCoveragePreserved: originalCoverage,
      },
    },
    [orderFT, orderTF],
    [formatUpdate, typingUpdate]
  );
}

function paragraphCount(ctx: Context): number {
  let boundaries = 0;
  for (const delta of ctx.body.toDelta()) {
    if (typeof delta.insert !== 'string') boundaries++;
  }
  return boundaries - 1;
}

function middleBoundaryIndex(ctx: Context): number {
  let index = 0;
  for (const delta of ctx.body.toDelta()) {
    if (
      typeof delta.insert !== 'string' &&
      (delta.insert as BoundaryEmbed).paragraphId === 'p-split'
    ) {
      return index;
    }
    index += typeof delta.insert === 'string' ? delta.insert.length : 1;
  }
  throw new TypeError('split boundary missing');
}

function runSplitTail(adapter: CandidateAdapter): ScenarioResult {
  const base = createBase('abcdefghij');
  const formatting = cloneContext(base);
  const structural = cloneContext(base);
  const vectors = branchStateVectors(formatting, structural);
  const formatUpdate = captureSourceUpdate(formatting, () =>
    adapter.enable(
      formatting,
      'alice',
      'bold',
      2,
      10,
      'alice:split',
      metadata('alice', 's1', 'bold')
    )
  );
  const splitUpdate = captureSourceUpdate(structural, () =>
    structural.doc.transact(() => structural.body.insertEmbed(6, boundary('p-split')), 'bob')
  );
  const textUpdate = captureSourceUpdate(structural, () =>
    structural.doc.transact(() => structural.body.insert(7, 'X'), 'bob')
  );
  const orderFS = applyUpdates(base, [formatUpdate, splitUpdate, textUpdate]);
  const orderSF = applyUpdates(base, [splitUpdate, textUpdate, formatUpdate]);
  const concurrent = sameCausalBase(vectors);
  const convergedBeforeJoin =
    semanticFingerprint(adapter, orderFS) === semanticFingerprint(adapter, orderSF);
  const markedBeforeJoin = markedText(adapter, orderFS, 'bold');
  const textPreserved = sequenceText(orderFS.body) === 'abcdeXfghij';
  const splitPreserved =
    paragraphCount(orderFS) === 2 &&
    'bcdefghi'.split('').every((character) => markedBeforeJoin.includes(character));
  const joinIndex = middleBoundaryIndex(orderFS);
  const joinUpdate = captureSourceUpdate(orderFS, () =>
    orderFS.doc.transact(() => orderFS.body.delete(joinIndex, 1), 'joiner')
  );
  Y.applyUpdate(orderSF.doc, joinUpdate, 'delivery');
  const markedAfterJoin = markedText(adapter, orderFS, 'bold');
  const joinPreserved =
    paragraphCount(orderFS) === 1 &&
    'bcdefghi'.split('').every((character) => markedAfterJoin.includes(character));
  const recordCount = adapter.evidenceRecords(orderFS).length;
  const encodedBytes = Y.encodeStateAsUpdate(orderFS.doc).byteLength;
  const recordsWithinBound = recordCount <= RECORD_BOUND;
  const bytesWithinBound = encodedBytes <= BYTE_BOUND;
  const converged =
    convergedBeforeJoin &&
    semanticFingerprint(adapter, orderFS) === semanticFingerprint(adapter, orderSF);
  const terminalStatesEqual = fullStatesEqual(orderFS, orderSF);
  const passed =
    concurrent &&
    converged &&
    terminalStatesEqual &&
    textPreserved &&
    splitPreserved &&
    joinPreserved &&
    recordsWithinBound &&
    bytesWithinBound;
  return scenarioResult(
    {
      passed,
      diagnostic: passed
        ? 'concurrent text/split preserves marked tail; join preserves coverage within bounds'
        : `text=${sequenceText(orderFS.body)} marked=${markedAfterJoin}`,
      evidence: {
        concurrentFromSameBase: concurrent,
        branchStateVectors: vectors,
        bothDeliveryOrdersConverged: converged,
        terminalStatesEqual,
        textInsertPreserved: textPreserved,
        splitTailPreserved: splitPreserved,
        joinPreserved,
        recordCount,
        recordCountWithinBound: recordsWithinBound,
        encodedBytes,
        encodedBytesWithinBound: bytesWithinBound,
      },
    },
    [orderFS, orderSF],
    [formatUpdate, splitUpdate, textUpdate, joinUpdate]
  );
}

function applyJournalEntry(
  ctx: Context,
  adapter: CandidateAdapter,
  origin: string,
  entry: JournalEntry
): void {
  if (entry.op === 'enable') {
    adapter.enable(
      ctx,
      origin,
      entry.kind,
      entry.start,
      entry.end,
      entry.contributionId,
      entry.metadata
    );
  } else {
    adapter.disable(ctx, origin, entry.kind, entry.start, entry.end);
  }
}

function buildJournalState(
  adapter: CandidateAdapter,
  initialSnapshot: Uint8Array,
  journal: readonly JournalEntry[]
): { ctx: Context; undo: Y.UndoManager; updates: readonly Uint8Array[] } {
  const ctx = cloneFromUpdate(initialSnapshot);
  const undo = createUndoManager(ctx, adapter, 'alice');
  const updates: Uint8Array[] = [];
  for (const entry of journal) {
    updates.push(
      captureSourceUpdate(ctx, () => applyJournalEntry(ctx, adapter, 'alice', entry))
    );
    undo.stopCapturing();
  }
  return { ctx, undo, updates };
}

function runReopenHistory(adapter: CandidateAdapter): ScenarioResult {
  const initial = createBase('abc');
  const initialSnapshot = Y.encodeStateAsUpdate(initial.doc);
  const journal: readonly JournalEntry[] = [
    {
      op: 'enable',
      kind: 'bold',
      start: 1,
      end: 4,
      contributionId: 'alice:reopen',
      metadata: metadata('alice', 'r1', 'bold', 'w:val="1"'),
    },
    { op: 'disable', kind: 'bold', start: 1, end: 4 },
  ];
  const live = buildJournalState(adapter, initialSnapshot, journal);
  const persistedSnapshot = Y.encodeStateAsUpdate(live.ctx.doc);
  const restoredSnapshot = cloneFromUpdate(persistedSnapshot);
  const reopened = buildJournalState(adapter, initialSnapshot, journal);
  const restored =
    semanticFingerprint(adapter, restoredSnapshot) === semanticFingerprint(adapter, reopened.ctx);
  const liveUndoUpdate = captureSourceUpdate(live.ctx, () => live.undo.undo());
  const reopenedUndoUpdate = captureSourceUpdate(reopened.ctx, () => reopened.undo.undo());
  const undoRestoredCoverage = markedText(adapter, reopened.ctx, 'bold');
  const undoOwners = ownersIntersecting(adapter, reopened.ctx, 'bold', 1, 4);
  const undoStacksMatch =
    live.undo.undoStack.length === reopened.undo.undoStack.length &&
    live.undo.redoStack.length === reopened.undo.redoStack.length;
  const undoParity =
    semanticFingerprint(adapter, live.ctx) === semanticFingerprint(adapter, reopened.ctx) &&
    undoRestoredCoverage === 'abc' &&
    undoOwners.includes('alice:reopen');
  const liveRedoUpdate = captureSourceUpdate(live.ctx, () => live.undo.redo());
  const reopenedRedoUpdate = captureSourceUpdate(reopened.ctx, () => reopened.undo.redo());
  const redoRemovedCoverage = markedText(adapter, reopened.ctx, 'bold');
  const redoStacksMatch =
    live.undo.undoStack.length === reopened.undo.undoStack.length &&
    live.undo.redoStack.length === reopened.undo.redoStack.length;
  const redoParity =
    semanticFingerprint(adapter, live.ctx) === semanticFingerprint(adapter, reopened.ctx) &&
    redoRemovedCoverage === '';
  const finalRecords = adapter.evidenceRecords(reopened.ctx);
  const contributionIdentityParity =
    finalRecords.some((record) => record.id === 'alice:reopen') &&
    (adapter.name === 'native-attributes' ||
      finalRecords.some((record) => record.id === 'remove:alice:bold:1:4'));
  const managerStackParity = undoStacksMatch && redoStacksMatch;
  const ids = [initial.clientId, live.ctx.clientId, restoredSnapshot.clientId, reopened.ctx.clientId];
  const distinctClientIds = new Set(ids).size === ids.length;
  const passed =
    restored &&
    undoParity &&
    redoParity &&
    contributionIdentityParity &&
    managerStackParity &&
    distinctClientIds;
  return scenarioResult(
    {
      passed,
      diagnostic: passed
        ? 'snapshot restored; bounded journal reconstructs public undo and redo parity'
        : `restored=${restored} undo=${undoParity} redo=${redoParity}`,
      evidence: {
        persistedSnapshotBytes: persistedSnapshot.byteLength,
        persistedSnapshotRestored: restored,
        journalEntries: journal.length,
        historyItemKind: 'format-disable',
        undoRestoredContributionId: undoOwners[0] ?? '',
        undoRestoredCoverage,
        redoRemovedCoverage,
        contributionIdentityParity,
        managerStackParity,
        undoParity,
        redoParity,
        distinctClientIds,
      },
    },
    [live.ctx, reopened.ctx, restoredSnapshot],
    [...live.updates, ...reopened.updates],
    [liveUndoUpdate, reopenedUndoUpdate, liveRedoUpdate, reopenedRedoUpdate]
  );
}

const SCENARIOS: Readonly<Record<CaseName, (adapter: CandidateAdapter) => ScenarioResult>> = {
  'overlap-undo': runOverlapUndo,
  'observed-disable': runObservedDisable,
  'mark-independence': runMarkIndependence,
  'endpoint-affinity': runEndpointAffinity,
  'split-tail': runSplitTail,
  'reopen-history': runReopenHistory,
};

function evaluate(adapter: CandidateAdapter): CandidateResult {
  const cases = {} as Record<CaseName, CaseOutcome>;
  const authoredUpdates: Uint8Array[] = [];
  const historyUpdates: Uint8Array[] = [];
  const terminalSnapshots: Uint8Array[] = [];
  for (const caseName of CASES) {
    const clientStart = allocatedClientIds.length;
    const result = SCENARIOS[caseName](adapter);
    const clientIds = allocatedClientIds.slice(clientStart);
    cases[caseName] = {
      ...result.outcome,
      evidence: {
        ...result.outcome.evidence,
        clientIds,
        clientIdsCollisionFree: new Set(clientIds).size === clientIds.length,
      },
    };
    authoredUpdates.push(...result.authoredUpdates);
    historyUpdates.push(...result.historyUpdates);
    terminalSnapshots.push(...result.terminalSnapshots);
  }
  const authoredOperationBytes = sumBytes(authoredUpdates);
  const historyOperationBytes = sumBytes(historyUpdates);
  const terminalSnapshotBytes = sumBytes(terminalSnapshots);
  const totalBytes =
    authoredOperationBytes + historyOperationBytes + terminalSnapshotBytes;
  const byteMetric: ByteMetric = Object.freeze({
    authoredOperationBytes,
    historyOperationBytes,
    terminalSnapshotBytes,
    authoredOperationCount: authoredUpdates.length,
    historyOperationCount: historyUpdates.length,
    terminalSnapshotCount: terminalSnapshots.length,
    totalBytes,
    schedule: 'genesis-excluded-source-updates-plus-terminal-snapshots',
  });
  const clientIdSchedule = Object.freeze([...allocatedClientIds]);
  return Object.freeze({
    passed: CASES.every((caseName) => cases[caseName].passed),
    encodedBytes: totalBytes,
    byteMetric,
    clientIdSchedule,
    clientIdsCollisionFree: new Set(clientIdSchedule).size === clientIdSchedule.length,
    cases: Object.freeze(cases),
  });
}

function winner(native: CandidateResult, contributions: CandidateResult): CandidateName | null {
  if (native.passed && contributions.passed) {
    return native.encodedBytes < contributions.encodedBytes
      ? 'native-attributes'
      : 'mark-contributions';
  }
  if (native.passed) return 'native-attributes';
  if (contributions.passed) return 'mark-contributions';
  return null;
}

export function runFormattingBakeoff(): BakeoffResult {
  nextClientId = 10_000;
  allocatedClientIds = [];
  const native = evaluate(nativeAttributes);
  nextClientId = 10_000;
  allocatedClientIds = [];
  const contributions = evaluate(markContributions);
  return Object.freeze({
    cases: CASES,
    candidates: Object.freeze({
      'native-attributes': native,
      'mark-contributions': contributions,
    }),
    winner: winner(native, contributions),
  });
}

if (import.meta.main) console.log(JSON.stringify(runFormattingBakeoff(), null, 2));
