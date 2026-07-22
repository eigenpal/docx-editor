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

type EvidenceValue = boolean | number | string | readonly string[];

export interface CaseOutcome {
  readonly passed: boolean;
  readonly diagnostic: string;
  readonly evidence: Readonly<Record<string, EvidenceValue>>;
}

export interface ByteMetric {
  readonly snapshotBytes: number;
  readonly updateBytes: number;
  readonly totalBytes: number;
  readonly schedule: 'snapshot-plus-captured-updates';
}

export interface CandidateResult {
  readonly passed: boolean;
  readonly encodedBytes: number;
  readonly byteMetric: ByteMetric;
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
  readonly rawIntent: 'w:val="preserve"';
}

interface ContributionMeta {
  readonly semanticMarkId: string;
  readonly actorId: string;
  readonly commitId: string;
  readonly kind: MarkKind;
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
  readonly capturedUpdates: Uint8Array[];
}

interface ScenarioResult {
  readonly outcome: CaseOutcome;
  readonly snapshotBytes: number;
  readonly updateBytes: number;
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
  | { readonly op: 'insert'; readonly index: number; readonly text: string }
  | {
      readonly op: 'enable';
      readonly kind: MarkKind;
      readonly start: number;
      readonly end: number;
      readonly contributionId: string;
      readonly metadata: ContributionMeta;
    };

const CASES: readonly CaseName[] = [
  'overlap-undo',
  'observed-disable',
  'mark-independence',
  'endpoint-affinity',
  'split-tail',
  'reopen-history',
];
const RAW_INTENT = 'w:val="preserve"' as const;
const RECORD_BOUND = 16;
const BYTE_BOUND = 20_000;
let nextClientId = 10_000;

function allocateClientId(): number {
  return nextClientId++;
}

function boundary(paragraphId: string): BoundaryEmbed {
  return Object.freeze({ kind: 'paragraph-boundary', paragraphId, rawIntent: RAW_INTENT });
}

function createEmptyContext(clientId = allocateClientId()): Context {
  const doc = new Y.Doc({ gc: false, guid: `kiss-${clientId}` });
  doc.clientID = clientId;
  const capturedUpdates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => capturedUpdates.push(update.slice()));
  return Object.freeze({
    doc,
    clientId,
    body: doc.getText('bodySequence'),
    formattingMetadata: doc.getMap<ContributionMeta>('formattingMetadata'),
    markContributions: doc.getMap<Record<string, unknown>>('markContributions'),
    capturedUpdates,
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
  ctx.capturedUpdates.length = 0;
  return ctx;
}

function cloneContext(source: Context): Context {
  return cloneFromUpdate(Y.encodeStateAsUpdate(source.doc));
}

function updateSince(base: Context, branch: Context): Uint8Array {
  return Y.encodeStateAsUpdate(branch.doc, Y.encodeStateVector(base.doc));
}

function applyUpdates(base: Context, updates: readonly Uint8Array[]): Context {
  const merged = cloneContext(base);
  for (const update of updates) Y.applyUpdate(merged.doc, update, 'delivery');
  return merged;
}

function sumBytes(updates: readonly Uint8Array[]): number {
  return updates.reduce((total, update) => total + update.byteLength, 0);
}

function scenarioResult(
  outcome: CaseOutcome,
  final: Context,
  captured: readonly Uint8Array[]
): ScenarioResult {
  return {
    outcome,
    snapshotBytes: Y.encodeStateAsUpdate(final.doc).byteLength,
    updateBytes: sumBytes(captured),
  };
}

function metadata(actorId: string, commitId: string, kind: MarkKind): ContributionMeta {
  return Object.freeze({
    semanticMarkId: `${actorId}:${commitId}:${kind}`,
    actorId,
    commitId,
    kind,
  });
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
      setCreationOnly(ctx.markContributions, contributionId, {
        kind: 'add',
        markKind: kind,
        actorId: meta.actorId,
        commitId: meta.commitId,
        proposedSemanticMarkId: meta.semanticMarkId,
        relativeStart: encodeEndpoint(ctx.body, range.start, 'after'),
        relativeEnd: encodeEndpoint(ctx.body, range.end, 'before'),
      });
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

function rawIntentPreserved(ctx: Context): boolean {
  for (const delta of ctx.body.toDelta()) {
    if (
      typeof delta.insert !== 'string' &&
      (delta.insert as BoundaryEmbed).rawIntent !== RAW_INTENT
    ) {
      return false;
    }
  }
  return true;
}

function runOverlapUndo(adapter: CandidateAdapter): ScenarioResult {
  const base = createBase('abcdefghij');
  const alice = cloneContext(base);
  const bob = cloneContext(base);
  const aliceUndo = createUndoManager(alice, adapter, 'alice');
  adapter.enable(alice, 'alice', 'bold', 2, 7, 'alice:add', metadata('alice', 'a1', 'bold'));
  aliceUndo.stopCapturing();
  adapter.enable(bob, 'bob', 'bold', 4, 9, 'bob:add', metadata('bob', 'b1', 'bold'));
  const aliceUpdate = updateSince(base, alice);
  const bobUpdate = updateSince(base, bob);
  const orderAB = applyUpdates(base, [aliceUpdate, bobUpdate]);
  const orderBA = applyUpdates(base, [bobUpdate, aliceUpdate]);
  Y.applyUpdate(alice.doc, bobUpdate, 'delivery');
  const owners = ownersIntersecting(adapter, alice, 'bold', 4, 7);
  const converged = semanticFingerprint(adapter, orderAB) === semanticFingerprint(adapter, orderBA);
  aliceUndo.undo();
  const otherSurvived = ownersIntersecting(adapter, alice, 'bold', 4, 9).includes('bob:add');
  const passed = owners.length === 2 && otherSurvived && converged;
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
        bothDeliveryOrdersConverged: converged,
      },
    },
    alice,
    [aliceUpdate, bobUpdate]
  );
}

function runObservedDisable(adapter: CandidateAdapter): ScenarioResult {
  const observed = createBase('0123456789');
  adapter.enable(
    observed,
    'alice',
    'bold',
    2,
    7,
    'alice:observed',
    metadata('alice', 'a1', 'bold')
  );
  adapter.enable(
    observed,
    'bob',
    'bold',
    5,
    9,
    'bob:observed',
    metadata('bob', 'b1', 'bold')
  );
  const causalBase = Y.encodeStateAsUpdate(observed.doc);
  const disabling = cloneFromUpdate(causalBase);
  const unseen = cloneFromUpdate(causalBase);
  adapter.disable(disabling, 'alice', 'bold', 2, 9);
  adapter.enable(
    unseen,
    'carol',
    'bold',
    6,
    10,
    'carol:unseen',
    metadata('carol', 'c1', 'bold')
  );
  const disableUpdate = updateSince(observed, disabling);
  const unseenUpdate = updateSince(observed, unseen);
  const orderDU = applyUpdates(observed, [disableUpdate, unseenUpdate]);
  const orderUD = applyUpdates(observed, [unseenUpdate, disableUpdate]);
  const observedOwners = ['alice:observed', 'bob:observed'];
  const postOwners = ownersIntersecting(adapter, orderDU, 'bold', 2, 10);
  const observedDisabled = observedOwners.every((owner) => !postOwners.includes(owner));
  const unseenPreserved = postOwners.includes('carol:unseen');
  const converged = semanticFingerprint(adapter, orderDU) === semanticFingerprint(adapter, orderUD);
  const remove = [...disabling.markContributions.values()].find(
    (record) => record.kind === 'remove'
  );
  const targets = (remove?.targetAddContributionIds as readonly string[] | undefined) ?? [];
  const targetsFromYjsState =
    adapter.name === 'native-attributes' ||
    (targets.length === 2 && observedOwners.every((owner) => targets.includes(owner)));
  const creationOnlyRecords =
    adapter.name === 'native-attributes' ||
    observedOwners.every(
      (owner) =>
        JSON.stringify(orderDU.markContributions.get(owner)) ===
        JSON.stringify(observed.markContributions.get(owner))
    );
  const passed =
    observedDisabled &&
    unseenPreserved &&
    converged &&
    targetsFromYjsState &&
    creationOnlyRecords;
  return scenarioResult(
    {
      passed,
      diagnostic: passed
        ? 'all observed intersecting owners disabled; concurrent unseen owner preserved'
        : `post-disable owners=${postOwners.join(',') || 'none'}`,
      evidence: {
        observedIntersectingCount: 2,
        observedDisabled,
        unseenPreserved,
        targetsFromYjsState,
        creationOnlyRecords,
        bothDeliveryOrdersConverged: converged,
      },
    },
    orderDU,
    [disableUpdate, unseenUpdate]
  );
}

function runMarkIndependence(adapter: CandidateAdapter): ScenarioResult {
  const ctx = createBase('0123456789');
  const undo = createUndoManager(ctx, adapter, 'alice');
  adapter.enable(ctx, 'alice', 'italic', 2, 8, 'alice:italic', metadata('alice', 'i1', 'italic'));
  undo.stopCapturing();
  adapter.enable(ctx, 'alice', 'bold', 2, 8, 'alice:bold', metadata('alice', 'b1', 'bold'));
  undo.stopCapturing();
  const records = adapter.evidenceRecords(ctx);
  const beforeProjection = Y.encodeStateAsUpdate(ctx.doc);
  adapter.segments(ctx);
  const afterProjection = Y.encodeStateAsUpdate(ctx.doc);
  undo.undo();
  const independent =
    ownersIntersecting(adapter, ctx, 'bold', 2, 8).length === 0 &&
    ownersIntersecting(adapter, ctx, 'italic', 2, 8).includes('alice:italic');
  const recordText = JSON.stringify(records);
  const semanticMarkIdPreserved =
    recordText.includes('alice:i1:italic') && recordText.includes('alice:b1:bold');
  const provenancePreserved =
    recordText.includes('"actorId":"alice"') &&
    recordText.includes('"commitId":"i1"') &&
    recordText.includes('"commitId":"b1"');
  const unformattedIndex = 9;
  const omissionPreserved =
    !isCovered(adapter, ctx, 'bold', unformattedIndex) &&
    !isCovered(adapter, ctx, 'italic', unformattedIndex);
  const normalizationReadOnly =
    Buffer.from(beforeProjection).equals(Buffer.from(afterProjection));
  const intentPreserved = rawIntentPreserved(ctx);
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
    omissionPreserved &&
    intentPreserved &&
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
        authoredOmissionPreserved: omissionPreserved,
        rawIntentPreserved: intentPreserved,
        normalizationWasReadOnly: normalizationReadOnly,
        plainImmutableRecords,
        canonicalBase64urlEndpoints,
      },
    },
    ctx,
    ctx.capturedUpdates
  );
}

function runEndpointAffinity(adapter: CandidateAdapter): ScenarioResult {
  const base = createBase('0123456789');
  const formatting = cloneContext(base);
  const typing = cloneContext(base);
  adapter.enable(
    formatting,
    'alice',
    'bold',
    3,
    7,
    'alice:endpoint',
    metadata('alice', 'e1', 'bold')
  );
  typing.doc.transact(() => typing.body.insert(7, 'X'), 'bob');
  const formatUpdate = updateSince(base, formatting);
  const typingUpdate = updateSince(base, typing);
  const orderFT = applyUpdates(base, [formatUpdate, typingUpdate]);
  const orderTF = applyUpdates(base, [typingUpdate, formatUpdate]);
  const converged = semanticFingerprint(adapter, orderFT) === semanticFingerprint(adapter, orderTF);
  const originalCoverage = markedText(adapter, orderFT, 'bold') === '2345';
  const insertionExcluded = !markedText(adapter, orderFT, 'bold').includes('X');
  const passed = converged && originalCoverage && insertionExcluded;
  return scenarioResult(
    {
      passed,
      diagnostic: passed
        ? 'concurrent tail insertion excluded with identical half-open endpoint semantics'
        : `marked text=${markedText(adapter, orderFT, 'bold')}`,
      evidence: {
        concurrentFromSameBase: true,
        bothDeliveryOrdersConverged: converged,
        boundaryInsertionExcluded: insertionExcluded,
        originalCoveragePreserved: originalCoverage,
      },
    },
    orderFT,
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
  adapter.enable(
    formatting,
    'alice',
    'bold',
    2,
    10,
    'alice:split',
    metadata('alice', 's1', 'bold')
  );
  structural.doc.transact(() => {
    structural.body.insertEmbed(6, boundary('p-split'));
    structural.body.insert(7, 'X');
  }, 'bob');
  const formatUpdate = updateSince(base, formatting);
  const structureUpdate = updateSince(base, structural);
  const orderFS = applyUpdates(base, [formatUpdate, structureUpdate]);
  const orderSF = applyUpdates(base, [structureUpdate, formatUpdate]);
  const converged = semanticFingerprint(adapter, orderFS) === semanticFingerprint(adapter, orderSF);
  const markedBeforeJoin = markedText(adapter, orderFS, 'bold');
  const textPreserved = sequenceText(orderFS.body) === 'abcdeXfghij';
  const splitPreserved =
    paragraphCount(orderFS) === 2 &&
    'bcdefghi'.split('').every((character) => markedBeforeJoin.includes(character));
  const joinIndex = middleBoundaryIndex(orderFS);
  orderFS.doc.transact(() => orderFS.body.delete(joinIndex, 1), 'joiner');
  const markedAfterJoin = markedText(adapter, orderFS, 'bold');
  const joinPreserved =
    paragraphCount(orderFS) === 1 &&
    'bcdefghi'.split('').every((character) => markedAfterJoin.includes(character));
  const recordCount = adapter.evidenceRecords(orderFS).length;
  const encodedBytes = Y.encodeStateAsUpdate(orderFS.doc).byteLength;
  const recordsWithinBound = recordCount <= RECORD_BOUND;
  const bytesWithinBound = encodedBytes <= BYTE_BOUND;
  const passed =
    converged &&
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
        concurrentFromSameBase: true,
        bothDeliveryOrdersConverged: converged,
        textInsertPreserved: textPreserved,
        splitTailPreserved: splitPreserved,
        joinPreserved,
        recordCount,
        recordCountWithinBound: recordsWithinBound,
        encodedBytes,
        encodedBytesWithinBound: bytesWithinBound,
      },
    },
    orderFS,
    [formatUpdate, structureUpdate]
  );
}

function applyJournalEntry(
  ctx: Context,
  adapter: CandidateAdapter,
  origin: string,
  entry: JournalEntry
): void {
  if (entry.op === 'insert') {
    ctx.doc.transact(() => ctx.body.insert(entry.index, entry.text), origin);
  } else {
    adapter.enable(
      ctx,
      origin,
      entry.kind,
      entry.start,
      entry.end,
      entry.contributionId,
      entry.metadata
    );
  }
}

function buildJournalState(
  adapter: CandidateAdapter,
  initialSnapshot: Uint8Array,
  journal: readonly JournalEntry[]
): { ctx: Context; undo: Y.UndoManager } {
  const ctx = cloneFromUpdate(initialSnapshot);
  const undo = createUndoManager(ctx, adapter, 'alice');
  for (const entry of journal) {
    applyJournalEntry(ctx, adapter, 'alice', entry);
    undo.stopCapturing();
  }
  return { ctx, undo };
}

function runReopenHistory(adapter: CandidateAdapter): ScenarioResult {
  const initial = createBase('');
  const initialSnapshot = Y.encodeStateAsUpdate(initial.doc);
  const journal: readonly JournalEntry[] = [
    { op: 'insert', index: 1, text: 'abc' },
    {
      op: 'enable',
      kind: 'bold',
      start: 1,
      end: 4,
      contributionId: 'alice:reopen',
      metadata: metadata('alice', 'r1', 'bold'),
    },
    { op: 'insert', index: 4, text: 'Z' },
  ];
  const live = buildJournalState(adapter, initialSnapshot, journal);
  const persistedSnapshot = Y.encodeStateAsUpdate(live.ctx.doc);
  const restoredSnapshot = cloneFromUpdate(persistedSnapshot);
  const reopened = buildJournalState(adapter, initialSnapshot, journal);
  const restored =
    semanticFingerprint(adapter, restoredSnapshot) === semanticFingerprint(adapter, reopened.ctx);
  live.undo.undo();
  reopened.undo.undo();
  const undoParity =
    semanticFingerprint(adapter, live.ctx) === semanticFingerprint(adapter, reopened.ctx) &&
    sequenceText(reopened.ctx.body) === 'abc';
  live.undo.redo();
  reopened.undo.redo();
  const redoParity =
    semanticFingerprint(adapter, live.ctx) === semanticFingerprint(adapter, reopened.ctx) &&
    sequenceText(reopened.ctx.body) === 'abcZ';
  const ids = [initial.clientId, live.ctx.clientId, restoredSnapshot.clientId, reopened.ctx.clientId];
  const distinctClientIds = new Set(ids).size === ids.length;
  const passed = restored && undoParity && redoParity && distinctClientIds;
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
        undoParity,
        redoParity,
        distinctClientIds,
      },
    },
    reopened.ctx,
    [...live.ctx.capturedUpdates, ...reopened.ctx.capturedUpdates]
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
  let snapshotBytes = 0;
  let updateBytes = 0;
  for (const caseName of CASES) {
    const result = SCENARIOS[caseName](adapter);
    cases[caseName] = result.outcome;
    snapshotBytes += result.snapshotBytes;
    updateBytes += result.updateBytes;
  }
  const totalBytes = snapshotBytes + updateBytes;
  const byteMetric: ByteMetric = Object.freeze({
    snapshotBytes,
    updateBytes,
    totalBytes,
    schedule: 'snapshot-plus-captured-updates',
  });
  return Object.freeze({
    passed: CASES.every((caseName) => cases[caseName].passed),
    encodedBytes: totalBytes,
    byteMetric,
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
  const native = evaluate(nativeAttributes);
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
