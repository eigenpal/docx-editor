/** @spike-features fixture-comparators, yjs-backend */
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const oracleDir = join(
  import.meta.dir,
  '..',
  'experiments',
  'yjs-formatting-bakeoff',
  'oracle'
);

type JsonRecord = Record<string, any>;

function readJson(name: string): JsonRecord {
  return JSON.parse(readFileSync(join(oracleDir, name), 'utf8')) as JsonRecord;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function hashCanonical(value: any): string {
  return `sha256:${sha256(Buffer.from(canonicalJson(value), 'utf8'))}`;
}

function generateTrace(generator: JsonRecord, seed: number): JsonRecord[] {
  let x = seed >>> 0;
  if (x === 0) x = 0x6d2b79f5;
  const next = (): number => {
    x = (x ^ ((x << 13) >>> 0)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ ((x << 5) >>> 0)) >>> 0;
    return x;
  };
  const weighted = (generator.operationWeights as JsonRecord[]).flatMap(
    ({ kind, weight }) => Array<string>(weight).fill(kind)
  );
  const replicas = generator.choices.replicas as string[];
  const shadow = Object.fromEntries(
    replicas.map((replica) => [
      replica,
      {
        active: { bold: [] as JsonRecord[], italic: [] as JsonRecord[] },
        paragraphs: [...generator.initialState.paragraphUtf16Lengths] as number[],
        redoDepth: 0,
        undoDepth: 0,
      },
    ])
  ) as Record<string, JsonRecord>;
  const permutation =
    generator.delivery.permutations[(seed >>> 0) % 6] as string;
  const seedHex = (seed >>> 0).toString(16).padStart(8, '0');
  const trace: JsonRecord[] = [];
  const entry = (
    index: number,
    values: Partial<JsonRecord>
  ): JsonRecord => ({
    actorId: null,
    control: null,
    deliveryPermutation: permutation,
    destinationReplica: null,
    groupId: null,
    index,
    operation: null,
    originId: null,
    replicaId: null,
    retryCount: 0,
    sessionId: null,
    sourceReplica: null,
    ...values,
  });

  for (let index = 1; index <= generator.generator.operationCount; index++) {
    const attemptedKinds: string[] = [];
    let accepted: JsonRecord | null = null;
    for (
      let retry = 0;
      retry <= generator.generator.invalidCandidateRetryCap;
      retry++
    ) {
      const kind = weighted[next() % weighted.length]!;
      attemptedKinds.push(kind);
      const replicaId = replicas[next() % replicas.length]!;
      const actorId = generator.choices.actorsByReplica[replicaId] as string;
      const sessions = generator.choices.sessionsByActor[actorId] as string[];
      const sessionId = sessions[next() % sessions.length]!;
      const state = shadow[replicaId]!;
      const validParagraphs = (state.paragraphs as number[])
        .map((length, paragraphIndex) => ({ length, paragraphIndex }))
        .filter(({ length }) => length > 0);
      let operation: JsonRecord | null = null;

      if (kind === 'insertText') {
        const paragraphIndex = next() % state.paragraphs.length;
        const offsetUtf16 = next() % (state.paragraphs[paragraphIndex] + 1);
        const text =
          generator.generator.insertCharacterAlphabet[next() % 26] as string;
        operation = { kind, offsetUtf16, paragraphIndex, text };
        state.paragraphs[paragraphIndex] += 1;
      } else if (kind === 'deleteText' && validParagraphs.length > 0) {
        const selected = validParagraphs[next() % validParagraphs.length]!;
        const offsetUtf16 = next() % selected.length;
        const maxLength = Math.min(3, selected.length - offsetUtf16);
        const lengthUtf16 = 1 + (next() % maxLength);
        operation = {
          kind,
          lengthUtf16,
          offsetUtf16,
          paragraphIndex: selected.paragraphIndex,
        };
        state.paragraphs[selected.paragraphIndex] -= lengthUtf16;
      } else if (kind === 'splitBoundary') {
        const candidates = (state.paragraphs as number[])
          .map((length, paragraphIndex) => ({ length, paragraphIndex }))
          .filter(({ length }) => length >= 2);
        if (candidates.length > 0) {
          const selected = candidates[next() % candidates.length]!;
          const offsetUtf16 = 1 + (next() % (selected.length - 1));
          state.paragraphs.splice(
            selected.paragraphIndex,
            1,
            offsetUtf16,
            selected.length - offsetUtf16
          );
          operation = {
            kind,
            newBoundaryId: `seed-${seedHex}-boundary-${index}`,
            offsetUtf16,
            paragraphIndex: selected.paragraphIndex,
          };
        }
      } else if (kind === 'joinBoundary' && state.paragraphs.length > 1) {
        const paragraphIndex = next() % (state.paragraphs.length - 1);
        state.paragraphs.splice(
          paragraphIndex,
          2,
          state.paragraphs[paragraphIndex] +
            state.paragraphs[paragraphIndex + 1]
        );
        operation = { kind, paragraphIndex };
      } else if (kind.startsWith('enableMark:') && validParagraphs.length > 0) {
        const markKind = kind.split(':')[1]!;
        const selected = validParagraphs[next() % validParagraphs.length]!;
        const startOffsetUtf16 = next() % selected.length;
        const endOffsetUtf16 =
          startOffsetUtf16 +
          1 +
          (next() % (selected.length - startOffsetUtf16));
        const contributionId = `seed-${seedHex}-${index}-${replicaId}-${markKind}`;
        operation = {
          contributionId,
          endOffsetUtf16,
          kind: 'enableMark',
          markKind,
          paragraphIndex: selected.paragraphIndex,
          startOffsetUtf16,
        };
        state.active[markKind].push({
          contributionId,
          endOffsetUtf16,
          paragraphIndex: selected.paragraphIndex,
          startOffsetUtf16,
        });
      } else if (kind.startsWith('disableMark:')) {
        const markKind = kind.split(':')[1]!;
        const active = state.active[markKind] as JsonRecord[];
        if (active.length > 0) {
          const targetIndex = next() % active.length;
          const target = active[targetIndex]!;
          operation = {
            endOffsetUtf16: target.endOffsetUtf16,
            kind: 'disableMark',
            markKind,
            paragraphIndex: target.paragraphIndex,
            startOffsetUtf16: target.startOffsetUtf16,
            targetContributionId: target.contributionId,
          };
          active.splice(targetIndex, 1);
        }
      } else if (kind === 'undo' && state.undoDepth > 0) {
        state.undoDepth -= 1;
        state.redoDepth += 1;
        operation = { kind };
      } else if (kind === 'redo' && state.redoDepth > 0) {
        state.redoDepth -= 1;
        state.undoDepth += 1;
        operation = { kind };
      } else if (['checkpoint', 'snapshot', 'reopen'].includes(kind)) {
        operation = { kind };
      }

      if (operation) {
        if (
          !['undo', 'redo', 'checkpoint', 'snapshot', 'reopen'].includes(
            operation.kind
          )
        ) {
          state.undoDepth = Math.min(32, state.undoDepth + 1);
          state.redoDepth = 0;
        }
        accepted = entry(index, {
          actorId,
          groupId: `seed-${seedHex}-op-${String(index).padStart(3, '0')}`,
          operation,
          originId: generator.choices.originsBySession[sessionId],
          replicaId,
          retryCount: retry,
          sessionId,
          sourceReplica: replicaId,
        });
        break;
      }
    }
    if (!accepted) {
      accepted = entry(index, {
        control: 'checkpoint',
        operation: { attemptedKinds, kind: 'checkpoint' },
        retryCount: generator.generator.invalidCandidateRetryCap,
      });
    }
    trace.push(accepted);

    if (index % generator.cadence.deliveryAfterGeneratedOperations === 0) {
      const destinationReplica =
        generator.delivery.destinationRotation[
          index / generator.cadence.deliveryAfterGeneratedOperations - 1
        ] ??
        generator.delivery.destinationRotation[
          (index / generator.cadence.deliveryAfterGeneratedOperations - 1) % 3
        ];
      for (const actorLetter of permutation) {
        const sourceReplica = `replica-${actorLetter}`;
        if (sourceReplica === destinationReplica) continue;
        trace.push(
          entry(index, {
            actorId: 'system-remote',
            control: 'deliverUpdate',
            destinationReplica,
            originId: 'origin-remote-delivery',
            sessionId: 'session-remote',
            sourceReplica,
          })
        );
      }
    }
    if (index % generator.cadence.checkpointAfterGeneratedOperations === 0) {
      trace.push(entry(index, { control: 'checkpoint' }));
    }
    if (index % generator.cadence.reopenAfterGeneratedOperations === 0) {
      trace.push(entry(index, { control: 'snapshot' }));
      trace.push(entry(index, { control: 'reopen' }));
    }
  }
  Object.defineProperty(trace, 'lastPrngState', {
    enumerable: false,
    value: x,
  });
  return trace;
}

function expandGeneratedEvents(
  generator: JsonRecord,
  contract: JsonRecord,
  seed: number,
  trace: JsonRecord[]
): { events: JsonRecord[]; terminalDiagnostic: JsonRecord } {
  const seedHex = (seed >>> 0).toString(16).padStart(8, '0');
  const fixtureId = `generated-seed-${seedHex}`;
  const events: JsonRecord[] = [];
  const latestUpdate = new Map<string, string>();
  const snapshots = new Map<string, string>();
  const replicaState = new Map<string, JsonRecord>();
  let eventOrdinal = 0;
  const nextEventId = (type: string, index: number): string =>
    `gen-${seedHex}-${String(index).padStart(3, '0')}-${String(
      ++eventOrdinal
    ).padStart(4, '0')}-${type}`;
  const stateRef = (replica: string, ordinal: number): string =>
    `gen-${seedHex}-state-${replica.slice(-1)}-${String(ordinal).padStart(
      4,
      '0'
    )}`;
  const common = (
    type: string,
    id: string,
    sourceReplica: string | null,
    destinationReplica: string | null,
    actorId: string | null,
    sessionId: string | null,
    groupId: string | null,
    originId: string | null,
    pre: JsonRecord | null,
    post: JsonRecord
  ): JsonRecord => ({
    actorId,
    destinationReplica,
    eventId: id,
    expectedCheckpointAfter: post.checkpointId,
    expectedCheckpointBefore: pre?.checkpointId ?? null,
    expectedRevisionAfter: post.revision,
    expectedRevisionBefore: pre?.revision ?? null,
    expectedStateVectorRelation:
      pre === null
        ? `equal:${post.stateVectorRef}`
        : pre.stateVectorRef === post.stateVectorRef
          ? `equal:${post.stateVectorRef}`
          : `${pre.stateVectorRef}->${post.stateVectorRef}`,
    fixtureId,
    groupId,
    originId,
    postStateRef: post.stateRef,
    preStateRef: pre?.stateRef ?? null,
    sessionId,
    sourceReplica,
    type,
  });
  const advance = (
    replica: string,
    write: boolean,
    checkpointId?: string
  ): { pre: JsonRecord; post: JsonRecord } => {
    const pre = replicaState.get(replica)!;
    const ordinal = pre.ordinal + 1;
    const post = {
      checkpointId: checkpointId ?? pre.checkpointId,
      ordinal,
      revision: pre.revision + (write ? 1 : 0),
      stateRef: stateRef(replica, ordinal),
      stateVectorRef: write
        ? `gen-${seedHex}-sv-${replica.slice(-1)}-${String(ordinal).padStart(
            4,
            '0'
          )}`
        : pre.stateVectorRef,
    };
    replicaState.set(replica, post);
    return { pre, post };
  };
  const generatedOperation = (
    operation: JsonRecord,
    entry: JsonRecord
  ): { expectedGlobalMapping: JsonRecord; operation: JsonRecord } => {
    const replica = entry.replicaId as string;
    const paragraphIndex = operation.paragraphIndex ?? 0;
    const boundaryCreationId = `gen-${seedHex}-${replica}-boundary-${paragraphIndex}`;
    const paragraphId = `gen-${seedHex}-${replica}-paragraph-${paragraphIndex}`;
    const base = {
      endAffinity: 'after',
      endAssoc: 0,
      startAffinity: 'before',
      startAssoc: -1,
    };
    if (operation.kind === 'insertText') {
      const globalStart = operation.offsetUtf16 + 1;
      return {
        expectedGlobalMapping: {
          globalEnd: globalStart + operation.text.length,
          globalStart,
        },
        operation: {
          ...base,
          boundaryCreationId,
          kind: 'insertText',
          offsetUtf16: operation.offsetUtf16,
          paragraphId,
          storyId: 'story-body',
          text: operation.text,
        },
      };
    }
    if (operation.kind === 'deleteText') {
      const globalStart = operation.offsetUtf16 + 1;
      return {
        expectedGlobalMapping: {
          globalEnd: globalStart + operation.lengthUtf16,
          globalStart,
        },
        operation: {
          ...base,
          boundaryCreationId,
          kind: 'deleteText',
          lengthUtf16: operation.lengthUtf16,
          offsetUtf16: operation.offsetUtf16,
          paragraphId,
          storyId: 'story-body',
        },
      };
    }
    if (operation.kind === 'splitBoundary') {
      const globalStart = operation.offsetUtf16 + 1;
      return {
        expectedGlobalMapping: { globalEnd: globalStart, globalStart },
        operation: {
          ...base,
          boundaryCreationId,
          kind: 'splitBoundary',
          newBoundaryCreationId: operation.newBoundaryId,
          offsetUtf16: operation.offsetUtf16,
          paragraphId,
          storyId: 'story-body',
          tailParagraphId: `${paragraphId}-tail-${entry.index}`,
        },
      };
    }
    if (operation.kind === 'joinBoundary') {
      return {
        expectedGlobalMapping: { globalEnd: 2, globalStart: 1 },
        operation: {
          ...base,
          kind: 'joinBoundary',
          leftBoundaryCreationId: boundaryCreationId,
          leftParagraphId: paragraphId,
          rightBoundaryCreationId: `gen-${seedHex}-${replica}-boundary-${
            paragraphIndex + 1
          }`,
          rightParagraphId: `gen-${seedHex}-${replica}-paragraph-${
            paragraphIndex + 1
          }`,
          storyId: 'story-body',
        },
      };
    }
    if (operation.kind === 'enableMark') {
      const globalStart = operation.startOffsetUtf16 + 1;
      return {
        expectedGlobalMapping: {
          globalEnd: operation.endOffsetUtf16 + 1,
          globalStart,
        },
        operation: {
          ...base,
          boundaryCreationId,
          commitId: `gen-${seedHex}-commit-${entry.index}`,
          contributionId: operation.contributionId,
          endOffsetUtf16: operation.endOffsetUtf16,
          kind: 'enableMark',
          markKind: operation.markKind,
          paragraphId,
          semanticMarkId: `gen-${seedHex}-mark-${entry.index}`,
          startOffsetUtf16: operation.startOffsetUtf16,
          storyId: 'story-body',
        },
      };
    }
    const globalStart = operation.startOffsetUtf16 + 1;
    return {
      expectedGlobalMapping: {
        globalEnd: operation.endOffsetUtf16 + 1,
        globalStart,
      },
      operation: {
        ...base,
        boundaryCreationId,
        commitId: `gen-${seedHex}-commit-${entry.index}`,
        contributionId: `gen-${seedHex}-remove-${entry.index}`,
        endOffsetUtf16: operation.endOffsetUtf16,
        kind: 'disableMark',
        markKind: operation.markKind,
        paragraphId,
        startOffsetUtf16: operation.startOffsetUtf16,
        storyId: 'story-body',
        targetObservedContributionIds: [operation.targetContributionId],
      },
    };
  };
  const capture = (
    producer: JsonRecord,
    replica: string,
    index: number
  ): void => {
    const current = replicaState.get(replica)!;
    const updateRef = `gen-${seedHex}-update-${String(index).padStart(
      3,
      '0'
    )}-${replica.slice(-1)}`;
    const eventId = nextEventId('capture', index);
    events.push({
      ...common(
        'captureUpdate',
        eventId,
        replica,
        null,
        producer.actorId,
        producer.sessionId,
        producer.groupId,
        producer.originId,
        current,
        current
      ),
      clientId: generator.choices.clientIdsByReplica[replica],
      producerEventId: producer.eventId,
      stateVectorAfter: producer.expectedStateVectorRelation.split('->').at(-1),
      stateVectorBefore: producer.expectedStateVectorRelation.split('->')[0],
      updateMetricRef: `gen-${seedHex}-metric-${updateRef}`,
      updateRef,
    });
    latestUpdate.set(replica, updateRef);
  };

  for (const replica of generator.choices.replicas as string[]) {
    const initial = {
      checkpointId: `gen-${seedHex}-checkpoint-genesis`,
      ordinal: 0,
      revision: 0,
      stateRef: stateRef(replica, 0),
      stateVectorRef: `gen-${seedHex}-sv-${replica.slice(-1)}-0000`,
    };
    replicaState.set(replica, initial);
    events.push({
      ...common(
        'bootstrapReplica',
        nextEventId('bootstrap', 0),
        null,
        replica,
        null,
        null,
        null,
        null,
        null,
        initial
      ),
      clientId: generator.choices.clientIdsByReplica[replica],
      genesisSnapshotRef: `gen-${seedHex}-snapshot-genesis`,
    });
  }

  const emitSnapshotAndReopen = (replica: string, index: number): void => {
    const current = replicaState.get(replica)!;
    const snapshotRef = `gen-${seedHex}-snapshot-${String(index).padStart(
      3,
      '0'
    )}-${replica.slice(-1)}`;
    const snapshotEvent = {
      ...common(
        'snapshot',
        nextEventId('snapshot', index),
        replica,
        replica,
        null,
        null,
        null,
        null,
        current,
        current
      ),
      snapshotMetricRef: `gen-${seedHex}-metric-${snapshotRef}`,
      snapshotRef,
    };
    events.push(snapshotEvent);
    snapshots.set(replica, snapshotRef);
    events.push({
      ...common(
        'reopen',
        nextEventId('reopen', index),
        replica,
        replica,
        null,
        null,
        null,
        null,
        null,
        current
      ),
      journalRef: `gen-${seedHex}-journal-${replica.slice(-1)}-${String(
        index
      ).padStart(3, '0')}`,
      snapshotRef,
    });
  };

  for (const entry of trace) {
    if (entry.operation !== null) {
      const replica = entry.replicaId ?? generator.choices.replicas[0];
      const operation = entry.operation as JsonRecord;
      if (
        [
          'insertText',
          'deleteText',
          'splitBoundary',
          'joinBoundary',
          'enableMark',
          'disableMark',
        ].includes(operation.kind)
      ) {
        const { pre, post } = advance(replica, true);
        const mapped = generatedOperation(operation, entry);
        const event = {
          ...common(
            'localSemanticOp',
            nextEventId('local', entry.index),
            replica,
            replica,
            entry.actorId,
            entry.sessionId,
            entry.groupId,
            entry.originId,
            pre,
            post
          ),
          ...mapped,
        };
        events.push(event);
        capture(event, replica, entry.index);
      } else if (operation.kind === 'undo' || operation.kind === 'redo') {
        const { pre, post } = advance(replica, true);
        const event = {
          ...common(
            operation.kind,
            nextEventId(operation.kind, entry.index),
            replica,
            replica,
            entry.actorId,
            entry.sessionId,
            entry.groupId,
            entry.originId,
            pre,
            post
          ),
          expectedPoppedStackItem: {
            constituentEventIds: [
              `gen-${seedHex}-history-${String(entry.index).padStart(3, '0')}`,
            ],
            groupId: entry.groupId,
          },
        };
        events.push(event);
        capture(event, replica, entry.index);
      } else if (operation.kind === 'checkpoint') {
        const checkpointRef = `gen-${seedHex}-checkpoint-${String(
          entry.index
        ).padStart(3, '0')}-${replica.slice(-1)}`;
        const { pre, post } = advance(replica, false, checkpointRef);
        events.push({
          ...common(
            'checkpoint',
            nextEventId('checkpoint', entry.index),
            replica,
            replica,
            entry.actorId,
            entry.sessionId,
            entry.groupId,
            entry.originId,
            pre,
            post
          ),
          checkpointRef,
          journalRef: `gen-${seedHex}-journal-${replica.slice(-1)}-${String(
            entry.index
          ).padStart(3, '0')}`,
        });
      } else {
        emitSnapshotAndReopen(replica, entry.index);
      }
    } else if (entry.control === 'deliverUpdate') {
      const updateRef = latestUpdate.get(entry.sourceReplica);
      if (updateRef) {
        const { pre, post } = advance(entry.destinationReplica, true);
        events.push({
          ...common(
            'deliverUpdate',
            nextEventId('deliver', entry.index),
            entry.sourceReplica,
            entry.destinationReplica,
            'system-remote',
            'session-remote',
            null,
            'origin-remote-delivery',
            pre,
            post
          ),
          deliveryOrdinal: events.filter(
            (event) =>
              event.type === 'deliverUpdate' &&
              event.destinationReplica === entry.destinationReplica
          ).length,
          sourceClientId:
            generator.choices.clientIdsByReplica[entry.sourceReplica],
          updateRef,
        });
      }
    } else if (entry.control === 'checkpoint') {
      const replica = generator.choices.replicas[0];
      const checkpointRef = `gen-${seedHex}-checkpoint-cadence-${String(
        entry.index
      ).padStart(3, '0')}`;
      const { pre, post } = advance(replica, false, checkpointRef);
      events.push({
        ...common(
          'checkpoint',
          nextEventId('checkpoint', entry.index),
          replica,
          replica,
          null,
          null,
          null,
          null,
          pre,
          post
        ),
        checkpointRef,
        journalRef: `gen-${seedHex}-journal-cadence-${String(
          entry.index
        ).padStart(3, '0')}`,
      });
    } else if (entry.control === 'snapshot' || entry.control === 'reopen') {
      if (entry.control === 'snapshot') {
        emitSnapshotAndReopen(generator.choices.replicas[0], entry.index);
      }
    }
  }

  return {
    events,
    terminalDiagnostic: {
      attemptedKinds: [],
      canonicalState: Object.fromEntries(replicaState),
      generatedOperationIndex: generator.generator.operationCount,
      lastPrngState: (trace as JsonRecord).lastPrngState,
      reason: 'completed',
      retryCount: 0,
      seed,
    },
  };
}

function generateFormattingSeed(
  generator: JsonRecord,
  seed: number
): {
  events: JsonRecord[];
  states: Record<string, JsonRecord>;
  terminalDiagnostic: JsonRecord;
} {
  let x = seed >>> 0;
  if (x === 0) x = 0x6d2b79f5;
  const next = (): number => {
    x = (x ^ ((x << 13) >>> 0)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ ((x << 5) >>> 0)) >>> 0;
    return x;
  };
  const seedHex = (seed >>> 0).toString(16).padStart(8, '0');
  const fixtureId = `generated-formatting-${seedHex}`;
  const events: JsonRecord[] = [];
  const states: Record<string, JsonRecord> = {};
  const updates = new Map<string, JsonRecord>();
  const attemptedPairs = new Set<string>();
  const rejectedPairs = new Map<
    string,
    { destinationReplica: string; update: JsonRecord }
  >();
  const successfulCoveragePairs = new Set<string>();
  const replicas = generator.choices.replicas as string[];
  const shadow = Object.fromEntries(
    replicas.map((replica) => [
      replica,
      {
        deliveredUpdateIds: new Set<string>(),
        knownOperations: new Map<string, JsonRecord>(),
        localGroups: [] as JsonRecord[],
        ordinal: 0,
        producedUpdateRefs: [] as string[],
        revision: 0,
      },
    ])
  ) as Record<string, JsonRecord>;
  let fallbackCount = 0;
  let deliveryOrdinal = 0;
  const stateRef = (replica: string, ordinal: number): string =>
    `gen-${seedHex}-state-${replica.slice(-1)}-${String(ordinal).padStart(
      4,
      '0'
    )}`;
  const canonicalSet = (values: string[]): string[] =>
    [...new Set(values)].sort((left, right) =>
      Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
    );
  const activeAdds = (replica: string): JsonRecord[] => {
    const operations = [
      ...(shadow[replica].knownOperations as Map<string, JsonRecord>).values(),
    ];
    const removed = new Set(
      operations
        .filter((operation) => operation.kind === 'disableMark')
        .flatMap((operation) => operation.targetObservedContributionIds)
    );
    return operations
      .filter(
        (operation) =>
          operation.kind === 'enableMark' &&
          !removed.has(operation.contributionId)
      )
      .sort((left, right) =>
        canonicalJson(left) < canonicalJson(right) ? -1 : 1
      );
  };
  const semanticFingerprint = (replica: string): JsonRecord[] => {
    const grouped = new Map<string, JsonRecord[]>();
    for (const active of activeAdds(replica)) {
      const key = `${active.markKind}:${active.rangeId}`;
      grouped.set(key, [...(grouped.get(key) ?? []), active]);
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, active]) => {
        const [kind, rangeId] = key.split(':');
        const range = generator.validRangeTable.find(
          (candidate: JsonRecord) => candidate.rangeId === rangeId
        );
        return {
          actorIds: canonicalSet(active.map((entry) => entry.actorId)),
          authoredIntentFingerprint: generator.genesis.authoredIntentFingerprint,
          commitIds: canonicalSet(active.map((entry) => entry.commitId)),
          evidenceCreationIds: canonicalSet(
            active.map((entry) => entry.contributionId)
          ),
          evidenceVersion: 'formatting-evidence/2',
          kind,
          resolvedSegments: [
            {
              globalEnd: range.globalEnd,
              globalStart: range.globalStart,
              storySequenceCreationId:
                generator.genesis.storySequenceCreationId,
            },
          ],
          semanticMarkIds: canonicalSet(
            active.map((entry) => entry.semanticMarkId)
          ),
        };
      });
  };
  const freezeState = (replica: string): JsonRecord => {
    const current = shadow[replica];
    const ref = stateRef(replica, current.ordinal);
    const value = {
      activeAddsByKindRange: activeAdds(replica),
      activeFormattingEvidence: semanticFingerprint(replica),
      deliveredUpdateIds: [...current.deliveredUpdateIds].sort(),
      knownSemanticOperationIds: [
        ...(current.knownOperations as Map<string, JsonRecord>).keys(),
      ].sort(),
      localGroups: structuredClone(current.localGroups),
      producedUpdateRefs: [...current.producedUpdateRefs],
      revision: current.revision,
      stateRef: ref,
      stateVectorRef: `gen-${seedHex}-sv-${replica.slice(-1)}-${String(
        current.ordinal
      ).padStart(4, '0')}`,
    };
    states[ref] = value;
    return value;
  };
  const mutate = (replica: string): { pre: JsonRecord; post: JsonRecord } => {
    const pre = freezeState(replica);
    shadow[replica].ordinal += 1;
    shadow[replica].revision += 1;
    return { pre, post: freezeState(replica) };
  };
  const common = (
    type: string,
    eventId: string,
    sourceReplica: string | null,
    destinationReplica: string | null,
    actorId: string | null,
    sessionId: string | null,
    groupId: string | null,
    originId: string | null,
    pre: JsonRecord | null,
    post: JsonRecord
  ): JsonRecord => ({
    actorId,
    destinationReplica,
    eventId,
    expectedCheckpointAfter: 'cp-000',
    expectedCheckpointBefore: pre === null ? null : 'cp-000',
    expectedRevisionAfter: post.revision,
    expectedRevisionBefore: pre?.revision ?? null,
    expectedStateVectorRelation:
      pre === null
        ? `equal:${post.stateVectorRef}`
        : pre.stateVectorRef === post.stateVectorRef
          ? `equal:${post.stateVectorRef}`
          : `${pre.stateVectorRef}->${post.stateVectorRef}`,
    fixtureId,
    groupId,
    originId,
    postStateRef: post.stateRef,
    preStateRef: pre?.stateRef ?? null,
    sessionId,
    sourceReplica,
    type,
  });

  for (const replica of replicas) {
    const initial = freezeState(replica);
    events.push({
      ...common(
        'bootstrapReplica',
        `gen-${seedHex}-bootstrap-${replica.slice(-1)}`,
        null,
        replica,
        null,
        null,
        null,
        null,
        null,
        initial
      ),
      clientId: generator.choices.clientIdsByReplica[replica],
      genesisSnapshotRef: generator.genesis.snapshotRef,
    });
  }

  for (let index = 1; index <= generator.operationCount; index++) {
    const requestedKind =
      generator.operationDomainExactly[
        next() % generator.operationDomainExactly.length
      ] as string;
    const replica = replicas[next() % replicas.length]!;
    const actorId = generator.choices.actorsByReplica[replica] as string;
    const sessions = generator.choices.sessionsByActor[actorId] as string[];
    const sessionId = sessions[next() % sessions.length]!;
    const originId = generator.choices.originsBySession[sessionId] as string;
    const range =
      generator.validRangeTable[next() % generator.validRangeTable.length];
    const markKind = requestedKind.split(':')[1]!;
    const activeTargets = activeAdds(replica)
      .filter(
        (active) =>
          active.storyId === generator.genesis.storyId &&
          active.markKind === markKind &&
          active.globalStart < range.globalEnd &&
          range.globalStart < active.globalEnd
      )
      .map((active) => active.contributionId);
    const targetObservedContributionIds = canonicalSet(activeTargets);
    const isDisable =
      requestedKind.startsWith('disableMark') &&
      targetObservedContributionIds.length > 0;
    if (requestedKind.startsWith('disableMark') && !isDisable) fallbackCount++;
    const operationKind = isDisable ? 'disableMark' : 'enableMark';
    const eventId = `gen-${seedHex}-${String(index).padStart(3, '0')}-local`;
    const groupId = `gen-${seedHex}-group-${String(index).padStart(3, '0')}`;
    const semanticOperationId = eventId;
    const contributionId = isDisable
      ? `gen-${seedHex}-remove-${String(index).padStart(3, '0')}`
      : `gen-${seedHex}-add-${String(index).padStart(3, '0')}`;
    const commitId = `gen-${seedHex}-commit-${String(index).padStart(3, '0')}`;
    const semanticMarkId = `gen-${seedHex}-mark-${String(index).padStart(
      3,
      '0'
    )}`;
    const semanticOperation = {
      actorId,
      commitId,
      contributionId,
      kind: operationKind,
      globalEnd: range.globalEnd,
      globalStart: range.globalStart,
      markKind,
      rangeId: range.rangeId,
      semanticMarkId: isDisable ? null : semanticMarkId,
      semanticOperationId,
      storyId: generator.genesis.storyId,
      targetObservedContributionIds: isDisable
        ? targetObservedContributionIds
        : [],
    };
    const pre = freezeState(replica);
    shadow[replica].knownOperations.set(
      semanticOperationId,
      semanticOperation
    );
    shadow[replica].localGroups.push({
      constituentEventIds: [eventId],
      groupId,
    });
    shadow[replica].ordinal += 1;
    shadow[replica].revision += 1;
    const post = freezeState(replica);
    const operation =
      operationKind === 'enableMark'
        ? {
            boundaryCreationId: range.boundaryCreationId,
            commitId,
            contributionId,
            endAffinity: range.endAffinity,
            endAssoc: range.endAssoc,
            endOffsetUtf16: range.endOffsetUtf16,
            kind: 'enableMark',
            markKind,
            paragraphId: range.paragraphId,
            semanticMarkId,
            startAffinity: range.startAffinity,
            startAssoc: range.startAssoc,
            startOffsetUtf16: range.startOffsetUtf16,
            storyId: generator.genesis.storyId,
          }
        : {
            boundaryCreationId: range.boundaryCreationId,
            commitId,
            contributionId,
            endAffinity: range.endAffinity,
            endAssoc: range.endAssoc,
            endOffsetUtf16: range.endOffsetUtf16,
            kind: 'disableMark',
            markKind,
            paragraphId: range.paragraphId,
            startAffinity: range.startAffinity,
            startAssoc: range.startAssoc,
            startOffsetUtf16: range.startOffsetUtf16,
            storyId: generator.genesis.storyId,
            targetObservedContributionIds:
              semanticOperation.targetObservedContributionIds,
          };
    const localEvent = {
      ...common(
        'localSemanticOp',
        eventId,
        replica,
        replica,
        actorId,
        sessionId,
        groupId,
        originId,
        pre,
        post
      ),
      expectedGlobalMapping: {
        globalEnd: range.globalEnd,
        globalStart: range.globalStart,
      },
      operation,
    };
    events.push(localEvent);
    const updateRef = `gen-${seedHex}-update-${String(index).padStart(3, '0')}`;
    shadow[replica].producedUpdateRefs.push(updateRef);
    const captured = freezeState(replica);
    const captureEvent = {
      ...common(
        'captureUpdate',
        `gen-${seedHex}-${String(index).padStart(3, '0')}-capture`,
        replica,
        null,
        actorId,
        sessionId,
        groupId,
        originId,
        captured,
        captured
      ),
      clientId: generator.choices.clientIdsByReplica[replica],
      producerEventId: eventId,
      stateVectorAfter: post.stateVectorRef,
      stateVectorBefore: pre.stateVectorRef,
      updateMetricRef: `gen-${seedHex}-metric-${String(index).padStart(
        3,
        '0'
      )}`,
      updateRef,
    };
    events.push(captureEvent);
    updates.set(updateRef, {
      semanticOperation,
      sourceReplica: replica,
      updateRef,
    });
    if (index % 4 === 0) {
      const pending = [...updates.values()]
        .flatMap((update) =>
          [...replicas]
            .reverse()
            .filter((destinationReplica) => destinationReplica !== update.sourceReplica)
            .map((destinationReplica) => ({ destinationReplica, update }))
        )
        .find(
          ({ destinationReplica, update }) =>
            !attemptedPairs.has(
              `${update.updateRef}->${destinationReplica}`
            )
        );
      if (pending)
        deliver(pending.update, pending.destinationReplica, 'first');
    }
  }

  function deliver(
    update: JsonRecord,
    destinationReplica: string,
    requestedKind: 'first' | 'retry' | 'duplicate'
  ): void {
    const pair = `${update.updateRef}->${destinationReplica}`;
    const pre = freezeState(destinationReplica);
    const alreadyDelivered =
      shadow[destinationReplica].deliveredUpdateIds.has(update.updateRef);
    expect(alreadyDelivered).toBe(requestedKind === 'duplicate');
    const knownAdds = new Set(
      [
        ...(shadow[destinationReplica].knownOperations as Map<
          string,
          JsonRecord
        >).values(),
      ]
        .filter((operation) => operation.kind === 'enableMark')
        .map((operation) => operation.contributionId)
    );
    const missingTargetAddIds =
      update.semanticOperation.kind === 'disableMark'
        ? update.semanticOperation.targetObservedContributionIds.filter(
            (target: string) => !knownAdds.has(target)
          )
        : [];
    const rejected =
      requestedKind === 'first' && missingTargetAddIds.length > 0;
    if (requestedKind === 'first') attemptedPairs.add(pair);
    if (rejected) {
      rejectedPairs.set(pair, { destinationReplica, update });
    } else if (!alreadyDelivered) {
      if (requestedKind === 'retry') {
        expect(rejectedPairs.has(pair)).toBe(true);
        expect(missingTargetAddIds).toEqual([]);
      }
      successfulCoveragePairs.add(pair);
      shadow[destinationReplica].deliveredUpdateIds.add(update.updateRef);
      shadow[destinationReplica].knownOperations.set(
        update.semanticOperation.semanticOperationId,
        update.semanticOperation
      );
      shadow[destinationReplica].ordinal += 1;
      shadow[destinationReplica].revision += 1;
    }
    const post = freezeState(destinationReplica);
    const deliveryKind = rejected
      ? 'rejected-missing-target'
      : requestedKind;
    events.push({
      ...common(
        'deliverUpdate',
        `gen-${seedHex}-${String(++deliveryOrdinal).padStart(
          4,
          '0'
        )}-deliver-${deliveryKind}`,
        update.sourceReplica,
        destinationReplica,
        'system-remote',
        'session-remote',
        null,
        'origin-remote-delivery',
        pre,
        post
      ),
      deliveryDiagnostic: rejected
        ? {
            code: 'missing-target-add',
            missingTargetAddIds: [...missingTargetAddIds].sort(),
            updateRef: update.updateRef,
          }
        : null,
      deliveryKind,
      deliveryOrdinal,
      sourceClientId:
        generator.choices.clientIdsByReplica[update.sourceReplica],
      updateRef: update.updateRef,
    });
  }

  const produced = [...updates.values()];
  for (const update of [...produced].reverse()) {
    for (const destination of [...replicas].reverse()) {
      if (
        destination !== update.sourceReplica &&
        !attemptedPairs.has(`${update.updateRef}->${destination}`)
      )
        deliver(update, destination, 'first');
    }
  }
  for (const { destinationReplica, update } of rejectedPairs.values()) {
    deliver(update, destinationReplica, 'retry');
  }
  for (const update of produced) {
    for (const destination of replicas) {
      if (destination !== update.sourceReplica) {
        expect(
          successfulCoveragePairs.has(`${update.updateRef}->${destination}`)
        ).toBe(true);
        deliver(update, destination, 'duplicate');
      }
    }
  }

  const terminalFingerprints = replicas.map((replica) =>
    semanticFingerprint(replica)
  );
  expect(terminalFingerprints.every((value) =>
    canonicalJson(value) === canonicalJson(terminalFingerprints[0])
  )).toBe(true);
  for (const replica of replicas) {
    const current = freezeState(replica);
    events.push({
      ...common(
        'assertState',
        `gen-${seedHex}-assert-${replica.slice(-1)}`,
        replica,
        replica,
        null,
        null,
        null,
        null,
        current,
        current
      ),
      projectionOperationMetricRef: `gen-${seedHex}-metric-terminal-${replica.slice(
        -1
      )}`,
      stateRef: current.stateRef,
    });
  }
  const fingerprint = terminalFingerprints[0]!;
  const candidateDerivationChecks = Object.fromEntries(
    ['candidateA', 'candidateB'].map((candidate) => [
      candidate,
      fingerprint.map((evidence) => ({
        input:
          candidate === 'candidateA'
            ? [
                'engine-core-spike-native-format-v2',
                evidence.kind,
                evidence.evidenceCreationIds,
                0,
              ]
            : [
                'engine-core-spike-mark-v2',
                evidence.kind,
                evidence.evidenceCreationIds,
                [],
                0,
              ],
        normalizedId:
          `mark-normalized-${hashCanonical(
            candidate === 'candidateA'
              ? [
                  'engine-core-spike-native-format-v2',
                  evidence.kind,
                  evidence.evidenceCreationIds,
                  0,
                ]
              : [
                  'engine-core-spike-mark-v2',
                  evidence.kind,
                  evidence.evidenceCreationIds,
                  [],
                  0,
                ]
          ).slice('sha256:'.length)}`,
      })),
    ])
  );
  const diagnosticTraceInput = {
    deliveries: events
      .filter((event) => event.type === 'deliverUpdate')
      .map((event) => ({
        deliveryDiagnostic: event.deliveryDiagnostic,
        deliveryKind: event.deliveryKind,
        destinationReplica: event.destinationReplica,
        postStateRef: event.postStateRef,
        preStateRef: event.preStateRef,
        updateRef: event.updateRef,
      })),
    eventIds: events.map((event) => event.eventId),
    fallbackCount,
    semanticFingerprint: fingerprint,
  };
  return {
    events,
    states,
    terminalDiagnostic: {
      candidateDerivationChecks,
      deliveryCounts: {
        duplicate: events.filter(
          (event) =>
            event.type === 'deliverUpdate' &&
            event.deliveryKind === 'duplicate'
        ).length,
        firstSuccessful: events.filter(
          (event) =>
            event.type === 'deliverUpdate' && event.deliveryKind === 'first'
        ).length,
        rejectedBeforePrerequisite: events.filter(
          (event) =>
            event.type === 'deliverUpdate' &&
            event.deliveryKind === 'rejected-missing-target'
        ).length,
        successfulRetry: events.filter(
          (event) =>
            event.type === 'deliverUpdate' && event.deliveryKind === 'retry'
        ).length,
      },
      diagnosticTraceHash: hashCanonical(diagnosticTraceInput),
      fallbackCount,
      lastPrngState: x,
      seed,
      semanticFingerprint: fingerprint,
    },
  };
}

function filesRecursively(directory: string, relative = ''): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const childRelative = relative ? `${relative}/${entry}` : entry;
      const child = join(directory, entry);
      return statSync(child).isDirectory()
        ? filesRecursively(child, childRelative)
        : [childRelative];
    })
    .sort();
}

function keys(value: JsonRecord): string[] {
  return Object.keys(value).sort();
}

function substitute(value: any, row: JsonRecord): any {
  if (Array.isArray(value)) return value.map((item) => substitute(item, row));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, substitute(child, row)])
    );
  }
  if (typeof value !== 'string') return value;
  const entire = value.match(/^\$\{([^}]+)\}$/);
  if (entire) return row[entire[1]!];
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) =>
    String(row[name])
  );
}

function pruneNullOperationFields(event: JsonRecord): JsonRecord {
  for (const field of ['operation', 'rejectedOperation']) {
    const operation = event[field] as JsonRecord | undefined;
    if (!operation) continue;
    event[field] = Object.fromEntries(
      Object.entries(operation).filter(([, value]) => value !== null)
    );
  }
  return event;
}

function expandEvents(fixtures: JsonRecord): JsonRecord[] {
  const expanded: JsonRecord[] = [];
  for (const program of fixtures.fixturePrograms as JsonRecord[]) {
    const matrix = (program.matrix as JsonRecord[] | undefined) ?? [];
    for (const template of program.events as JsonRecord[]) {
      if (matrix.length > 0 && JSON.stringify(template).includes('${')) {
        for (const row of matrix) {
          expanded.push(pruneNullOperationFields(substitute(template, row)));
        }
      } else {
        expanded.push(pruneNullOperationFields(structuredClone(template)));
      }
    }
  }
  return expanded;
}

function resolveStates(fixtures: JsonRecord): Record<string, JsonRecord> {
  const catalog = fixtures.stateCatalog as Record<string, JsonRecord>;
  const resolved: Record<string, JsonRecord> = {};
  const active = new Set<string>();
  const resolve = (stateRef: string): JsonRecord => {
    if (resolved[stateRef]) return resolved[stateRef]!;
    expect(catalog[stateRef], `missing state ${stateRef}`).toBeDefined();
    expect(active.has(stateRef), `state cycle at ${stateRef}`).toBe(false);
    active.add(stateRef);
    const definition = catalog[stateRef]!;
    const state = definition.baseStateRef
      ? {
          ...structuredClone(resolve(definition.baseStateRef as string)),
          ...(structuredClone(definition.replace) as JsonRecord),
        }
      : structuredClone(definition);
    active.delete(stateRef);
    resolved[stateRef] = state;
    return state;
  };
  for (const stateRef of Object.keys(catalog)) resolve(stateRef);
  return resolved;
}

function paragraphBounds(
  state: JsonRecord,
  boundaryCreationId: string
): { globalTextStart: number; textLength: number } {
  let global = 0;
  let found = false;
  let globalTextStart = 0;
  let textLength = 0;
  for (const item of state.sequence as JsonRecord[]) {
    if (item.kind === 'boundary') {
      if (found) break;
      found = item.creationId === boundaryCreationId;
      global += 1;
      if (found) globalTextStart = global;
      continue;
    }
    const length = (item.text as string).length;
    if (found) textLength += length;
    global += length;
  }
  expect(found, `missing boundary ${boundaryCreationId}`).toBe(true);
  return { globalTextStart, textLength };
}

describe('task 2.4 formatting bake-off reviewed oracle', () => {
  const contract = readJson('contract.v2.json');
  const fixtures = readJson('fixtures.v2.json');
  const generator = readJson('generator.v2.json');
  const representations = readJson('representation-contracts.v2.json');
  const states = resolveStates(fixtures);
  const events = expandEvents(fixtures);

  test('closes the oracle directory with no implementation or result artifacts', () => {
    const manifest = readJson('manifest.v2.json');
    expect(filesRecursively(oracleDir)).toEqual(manifest.closedDirectoryEntries);
    expect(filesRecursively(join(oracleDir, '..'))).toEqual(
      manifest.closedDirectoryEntries.map((entry: string) => `oracle/${entry}`)
    );
    expect(manifest.taskComplete).toBe(false);
    expect(manifest.winner).toBeNull();
    expect(
      filesRecursively(join(oracleDir, '..')).some((entry) =>
        /(?:candidate|runner|result|trace|winner|src\/|tests\/)/i.test(entry)
      )
    ).toBe(false);
  });

  test('binds every reviewed input and the ordered bundle independently', () => {
    const manifest = readJson('manifest.v2.json');
    const chunks: Uint8Array[] = [];
    for (const artifact of manifest.artifactOrder as string[]) {
      const bytes = readFileSync(join(oracleDir, artifact));
      expect(sha256(bytes)).toBe(manifest.artifacts[artifact].sha256);
      chunks.push(bytes, Buffer.from('\n'));
    }
    expect(manifest.bundle.algorithm).toBe('sha256');
    expect(sha256(Buffer.concat(chunks))).toBe(manifest.bundle.hash);
  });

  test('freezes the authoritative winner rule and metric units exactly', () => {
    expect(contract.winnerRule.eligibility).toBe(
      'candidate is eligible if and only if every mandatory gate passes'
    );
    expect(contract.winnerRule.selectionOrder).toEqual([
      'eligible candidates only',
      'lower maximum combined encoded snapshot + aggregate update bytes across the whole frozen corpus',
      'lower maximum projection work count',
      'exact tie chooses Candidate B',
    ]);
    expect(contract.winnerRule.metricAggregation.bytesMetric).toEqual({
      candidateScore:
        'maximum per-corpus-run combinedBytes across all frozen corpus runs',
      combinedBytes: 'encodedSnapshotBytes + aggregateEncodedUpdateBytes',
      encodedSnapshotBytes:
        'sum of byteLength for every snapshotRef produced in one corpus run',
      encodedUpdateBytes:
        'sum of byteLength for every unique updateRef produced in one corpus run; delivery repeats count zero additional bytes',
      unit: 'bytes, non-negative safe integers',
    });
    expect(contract.winnerRule.metricAggregation.projectionMetric.unit).toBe(
      'operations, non-negative safe integers'
    );
  });

  test('uses a closed event and semantic-operation union', () => {
    const language = contract.eventLanguage as JsonRecord;
    expect(language.eventTypesExactly).toEqual([
      'assertRejected',
      'assertState',
      'bootstrapReplica',
      'captureUpdate',
      'checkpoint',
      'deliverUpdate',
      'localSemanticOp',
      'redo',
      'repair',
      'reopen',
      'snapshot',
      'stopCapturing',
      'undo',
    ]);
    expect(language.operationKindsExactly).toEqual([
      'deleteText',
      'disableMark',
      'enableMark',
      'insertText',
      'joinBoundary',
      'malformedInput',
      'quotaAttempt',
      'splitBoundary',
    ]);

    const ids = events.map((event) => event.eventId as string);
    expect(new Set(ids).size).toBe(ids.length);
    for (const event of events) {
      const expectedFields = [
        ...language.commonFieldsExactly,
        ...language.eventSpecificFieldsExactly[event.type],
      ].sort();
      expect(keys(event), event.eventId).toEqual(expectedFields);
      expect(language.eventTypesExactly).toContain(event.type);
      if (event.type === 'localSemanticOp') {
        expect(keys(event.operation), event.eventId).toEqual(
          language.operationFieldsExactly[event.operation.kind].slice().sort()
        );
        if (
          !['malformedInput', 'quotaAttempt'].includes(event.operation.kind)
        ) {
          expect(event.operation.startAssoc, event.eventId).toBe(
            contract.endpointEnvelope.affinityAssocExactly[
              event.operation.startAffinity
            ]
          );
          expect(event.operation.endAssoc, event.eventId).toBe(
            contract.endpointEnvelope.affinityAssocExactly[
              event.operation.endAffinity
            ]
          );
        }
        if (['enableMark', 'disableMark'].includes(event.operation.kind)) {
          const metadata =
            fixtures.contributionMetadata[event.operation.contributionId];
          expect(metadata, event.eventId).toBeDefined();
          expect(metadata.actorId, event.eventId).toBe(event.actorId);
          expect(metadata.commitId, event.eventId).toBe(
            event.operation.commitId
          );
          expect(metadata.kind, event.eventId).toBe(event.operation.markKind);
          expect(metadata.recordKind as any, event.eventId).toBe(
            (event.operation.kind === 'enableMark' ? 'add' : 'remove') as any
          );
          expect(metadata.semanticMarkId, event.eventId).toBe(
            event.operation.semanticMarkId ?? null
          );
        }
      }
      if (event.type === 'assertRejected') {
        expect(keys(event.rejectedOperation), event.eventId).toEqual(
          language.operationFieldsExactly[event.rejectedOperation.kind]
            .slice()
            .sort()
        );
        expect(keys(event.diagnostic), event.eventId).toEqual(
          contract.diagnosticSchema.fieldsExactly.slice().sort()
        );
      }
    }
  });

  test('resolves exact canonical states and FormattingEvidence fields', () => {
    const stateFields = contract.canonicalState.fieldsExactly.slice().sort();
    const evidenceFields =
      contract.canonicalState.formattingEvidence.fieldsExactly.slice().sort();
    const segmentFields =
      contract.canonicalState.formattingEvidence.resolvedSegmentFieldsExactly
        .slice()
        .sort();
    for (const [stateRef, state] of Object.entries(states)) {
      expect(keys(state), stateRef).toEqual(stateFields);
      expect(state.rawEvidenceHashes, stateRef).toBeUndefined();
      const sequenceLength = (state.sequence as JsonRecord[]).reduce(
        (total, item) =>
          total + (item.kind === 'boundary' ? 1 : (item.text as string).length),
        0
      );
      const boundaryOffsets = new Set<number>();
      let offset = 0;
      for (const item of state.sequence as JsonRecord[]) {
        if (item.kind === 'boundary') {
          boundaryOffsets.add(offset);
          offset += 1;
        } else {
          offset += (item.text as string).length;
        }
      }
      for (const evidence of state.formattingEvidence as JsonRecord[]) {
        expect(keys(evidence), stateRef).toEqual(evidenceFields);
        for (const listName of [
          'actorIds',
          'commitIds',
          'evidenceCreationIds',
          'semanticMarkIds',
        ]) {
          const list = evidence[listName] as string[];
          expect(list, `${stateRef}.${listName}`).toEqual(
            [...new Set(list)].sort()
          );
        }
        let previousEnd = -1;
        for (const segment of evidence.resolvedSegments as JsonRecord[]) {
          expect(keys(segment), stateRef).toEqual(segmentFields);
          expect(segment.globalStart).toBeGreaterThanOrEqual(previousEnd);
          expect(segment.globalEnd).toBeGreaterThan(segment.globalStart);
          expect(segment.globalEnd).toBeLessThanOrEqual(sequenceLength);
          for (let unit = segment.globalStart; unit < segment.globalEnd; unit++) {
            expect(boundaryOffsets.has(unit), `${stateRef} crosses boundary`).toBe(
              false
            );
          }
          previousEnd = segment.globalEnd;
        }
        const metadata = (evidence.evidenceCreationIds as string[]).map(
          (creationId) => fixtures.contributionMetadata[creationId]
        );
        expect(metadata.every(Boolean), stateRef).toBe(true);
        expect(evidence.actorIds, stateRef).toEqual(
          [...new Set(metadata.map((item) => item.actorId))].sort()
        );
        expect(evidence.commitIds, stateRef).toEqual(
          [...new Set(metadata.map((item) => item.commitId))].sort()
        );
        expect(evidence.semanticMarkIds, stateRef).toEqual(
          [
            ...new Set(
              metadata
                .map((item) => item.semanticMarkId)
                .filter((item) => item !== null)
            ),
          ].sort()
        );
        expect(
          metadata.every((item) => item.kind === evidence.kind),
          stateRef
        ).toBe(true);
      }
      expect(
        (state.paragraphProjection as JsonRecord[])
          .map((paragraph) => paragraph.text)
          .join(''),
        stateRef
      ).toBe(
        (state.sequence as JsonRecord[])
          .filter((item) => item.kind === 'text')
          .map((item) => item.text)
          .join('')
      );
      const boundaryIds = (state.sequence as JsonRecord[])
        .filter((item) => item.kind === 'boundary')
        .map((item) => item.creationId);
      if (state.authored.boundarySetRef) {
        expect(
          fixtures.authoredBoundarySets[state.authored.boundarySetRef]
            .orderedCreationIds,
          stateRef
        ).toEqual(boundaryIds);
      } else {
        expect(
          state.authored.boundaries.map(
            (boundary: JsonRecord) => boundary.creationId
          ),
          stateRef
        ).toEqual(boundaryIds);
      }
      let globalOffset = 0;
      const projectedByBoundary = new Map(
        (state.paragraphProjection as JsonRecord[]).map((paragraph) => [
          paragraph.boundaryCreationId,
          paragraph,
        ])
      );
      for (let index = 0; index < state.sequence.length; index++) {
        const item = state.sequence[index];
        if (item.kind !== 'boundary') {
          globalOffset += item.text.length;
          continue;
        }
        const globalTextStart = globalOffset + 1;
        globalOffset += 1;
        let text = '';
        for (
          let cursor = index + 1;
          cursor < state.sequence.length &&
          state.sequence[cursor].kind === 'text';
          cursor++
        ) {
          text += state.sequence[cursor].text;
        }
        if (index !== state.sequence.length - 1) {
          expect(
            projectedByBoundary.get(item.creationId),
            `${stateRef}.${item.creationId}`
          ).toMatchObject({
            globalTextEnd: globalTextStart + text.length,
            globalTextStart,
            text,
          });
        }
      }
    }
  });

  test('separates candidate storage and normalized-ID evidence', () => {
    expect(
      representations.crossCandidateExclusion
        .excludedFromSemanticFingerprint
    ).toEqual([
      'candidateNormalizedSemanticMarkId',
      'candidateStorageEvidence',
      'candidateRawEvidenceHash',
    ]);
    for (const evidence of representations.candidateA
      .storageEvidence as JsonRecord[]) {
      expect(evidence.source).toBe('ordered bodySequence.toDelta()');
      expect(evidence.expectedMetadataKeys).toEqual(
        [...new Set(evidence.expectedMetadataKeys)].sort()
      );
      let priorEnd = -1;
      for (const span of evidence.expectedOrderedAttributeSpans) {
        expect(span.globalStart).toBeGreaterThanOrEqual(priorEnd);
        expect(span.globalEnd).toBeGreaterThan(span.globalStart);
        priorEnd = span.globalEnd;
      }
    }
    for (const evidence of representations.candidateB
      .storageEvidence as JsonRecord[]) {
      expect(evidence.source).toBe(
        'ordered immutable mark contribution records'
      );
      const ids = evidence.expectedOrderedRecords.map(
        (record: JsonRecord) => record.contributionId
      );
      expect(new Set(ids).size).toBe(ids.length);
      for (const record of evidence.expectedOrderedRecords) {
        for (const endpoint of [record.startBinding, record.endBinding]) {
          expect(endpoint.assoc).toBe(
            contract.endpointEnvelope.affinityAssocExactly[endpoint.affinity]
          );
        }
      }
    }
    const checkpointIds = new Set(
      Object.values(states).map((state) => state.checkpointId)
    );
    for (const checkpoint of representations.stabilityCheckpoints as string[]) {
      expect(checkpointIds.has(checkpoint), checkpoint).toBe(true);
    }
    for (const state of Object.values(states)) {
      for (const evidence of state.formattingEvidence as JsonRecord[]) {
        expect(
          evidence.semanticMarkIds.some((id: string) =>
            id.startsWith('mark-normalized-')
          )
        ).toBe(false);
      }
    }
  });

  test('chains event revisions, checkpoints, state refs, updates, and snapshots', () => {
    const priorEvents = new Map<string, JsonRecord>();
    const capturedUpdates = new Map<string, JsonRecord>();
    const snapshots = new Set<string>(Object.keys(fixtures.reviewedSnapshots));
    for (const event of events) {
      if (event.preStateRef !== null) {
        expect(states[event.preStateRef], event.eventId).toBeDefined();
        expect(states[event.preStateRef].revision, event.eventId).toBe(
          event.expectedRevisionBefore
        );
        expect(states[event.preStateRef].checkpointId, event.eventId).toBe(
          event.expectedCheckpointBefore
        );
      }
      expect(states[event.postStateRef], event.eventId).toBeDefined();
      expect(states[event.postStateRef].revision, event.eventId).toBe(
        event.expectedRevisionAfter
      );
      expect(states[event.postStateRef].checkpointId, event.eventId).toBe(
        event.expectedCheckpointAfter
      );
      if (event.preStateRef !== null) {
        const writes =
          event.type === 'deliverUpdate' ||
          event.type === 'undo' ||
          event.type === 'redo' ||
          event.type === 'repair' ||
          (event.type === 'localSemanticOp' &&
            event.operation.kind !== 'quotaAttempt');
        expect(
          event.expectedRevisionAfter - event.expectedRevisionBefore,
          event.eventId
        ).toBe(writes ? 1 : 0);
      }
      if (event.type === 'captureUpdate') {
        const producer = priorEvents.get(event.producerEventId);
        expect(producer, event.eventId).toBeDefined();
        expect(event.stateVectorBefore, event.eventId).toBe(
          states[producer!.preStateRef].stateVectorRef
        );
        expect(event.stateVectorAfter, event.eventId).toBe(
          states[producer!.postStateRef].stateVectorRef
        );
        expect(capturedUpdates.has(event.updateRef), event.eventId).toBe(false);
        capturedUpdates.set(event.updateRef, event);
      }
      if (event.type === 'deliverUpdate') {
        const captured = capturedUpdates.get(event.updateRef);
        expect(captured, event.eventId).toBeDefined();
        expect(captured!.clientId, event.eventId).toBe(event.sourceClientId);
        expect(captured!.sourceReplica, event.eventId).toBe(event.sourceReplica);
        expect(event.expectedStateVectorRelation, event.eventId).toBeTruthy();
        expect(
          states[event.preStateRef].stateVectorRef,
          `${event.eventId}.destinationStateVectorBefore`
        ).toBeDefined();
      }
      if (event.type === 'snapshot') snapshots.add(event.snapshotRef);
      if (event.type === 'bootstrapReplica') {
        expect(snapshots.has(event.genesisSnapshotRef), event.eventId).toBe(true);
      }
      if (event.type === 'reopen') {
        expect(snapshots.has(event.snapshotRef), event.eventId).toBe(true);
        expect(fixtures.reconstructionJournals[event.journalRef]).toBeDefined();
      }
      if (event.type === 'checkpoint') {
        expect(fixtures.reconstructionJournals[event.journalRef]).toBeDefined();
      }
      if (event.type === 'assertRejected') {
        expect(event.postStateRef, event.eventId).toBe(event.preStateRef);
        expect(event.unchangedSurfaces).toEqual(
          contract.rejection.atomicNoWriteSurfaces
        );
      }
      priorEvents.set(event.eventId, event);
    }
  });

  test('does not reuse history-bearing state IDs across replica paths', () => {
    const pathsByState = new Map<string, Set<string>>();
    for (const event of events) {
      const path = event.destinationReplica ?? event.sourceReplica;
      if (path === null || event.postStateRef === 'state-genesis') continue;
      const paths = pathsByState.get(event.postStateRef) ?? new Set<string>();
      paths.add(path);
      pathsByState.set(event.postStateRef, paths);
    }
    for (const [stateRef, paths] of pathsByState) {
      if (!/^state-(?:three|history|overlap)/.test(stateRef)) continue;
      if (states[stateRef].managerStacks.length === 0) continue;
      expect([...paths], stateRef).toHaveLength(1);
    }
    for (const order of fixtures.permutationRequirements.threeUpdateAll) {
      for (const phase of ['first', 'pair', 'final']) {
        expect(states[`state-three-${order}-${phase}`]).toBeDefined();
      }
    }
    expect(states['state-three-source-A'].managerStacks[0]).toMatchObject({
      actorId: 'actor-A',
      sessionId: 'session-A-1',
      undo: [
        {
          constituentEventIds: ['evt-three-op-A'],
          groupId: 'group-three-A',
        },
      ],
    });
    expect(states['state-history-undone-reopened']).not.toBe(
      states['state-history-undone']
    );
    expect(states['state-history-undone-redo-target']).not.toBe(
      states['state-history-undone-reopened']
    );
  });

  test('freezes paragraph-local UTF-16 to global mapping for every semantic op', () => {
    for (const event of events.filter(
      (candidate) => candidate.type === 'localSemanticOp'
    )) {
      const operation = event.operation as JsonRecord;
      if (
        operation.kind === 'quotaAttempt' ||
        operation.kind === 'malformedInput'
      ) {
        expect(event.expectedGlobalMapping).toBeNull();
        continue;
      }
      if (operation.kind === 'joinBoundary') {
        expect(event.expectedGlobalMapping.globalEnd).toBe(
          event.expectedGlobalMapping.globalStart + 1
        );
        continue;
      }
      const bounds = paragraphBounds(
        states[event.preStateRef],
        operation.boundaryCreationId
      );
      const start =
        operation.startOffsetUtf16 ??
        operation.offsetUtf16 ??
        event.expectedGlobalMapping.globalStart - bounds.globalTextStart;
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start).toBeLessThanOrEqual(bounds.textLength);
      expect(event.expectedGlobalMapping.globalStart).toBe(
        bounds.globalTextStart + start
      );
      if (operation.kind === 'insertText') {
        expect(event.expectedGlobalMapping.globalEnd).toBe(
          event.expectedGlobalMapping.globalStart + operation.text.length
        );
      } else if (operation.kind === 'deleteText') {
        expect(start + operation.lengthUtf16).toBeLessThanOrEqual(
          bounds.textLength
        );
        expect(event.expectedGlobalMapping.globalEnd).toBe(
          event.expectedGlobalMapping.globalStart + operation.lengthUtf16
        );
      } else if (operation.kind === 'enableMark') {
        expect(event.expectedGlobalMapping.globalEnd).toBe(
          bounds.globalTextStart + operation.endOffsetUtf16
        );
      } else if (operation.kind === 'disableMark') {
        expect(event.expectedGlobalMapping.globalEnd).toBe(
          bounds.globalTextStart + operation.endOffsetUtf16
        );
      } else {
        expect(event.expectedGlobalMapping.globalEnd).toBe(
          event.expectedGlobalMapping.globalStart
        );
      }
    }
  });

  test('covers every affinity case with exact before=-1 and after=0 behavior', () => {
    expect(contract.endpointEnvelope.affinityAssocExactly).toEqual({
      after: 0,
      before: -1,
    });
    const affinity = fixtures.fixturePrograms.find(
      (program: JsonRecord) => program.fixtureId === 'affinity-matrix'
    );
    expect(affinity.matrix.map((row: JsonRecord) => row.caseId).sort()).toEqual([
      'delete-end-after',
      'delete-end-before',
      'delete-inside-after',
      'delete-inside-before',
      'delete-start-after',
      'delete-start-before',
      'insert-end-after',
      'insert-end-before',
      'insert-inside-after',
      'insert-inside-before',
      'insert-start-after',
      'insert-start-before',
    ]);
    expect(states['state-affinity-insert-start-before'].formattingEvidence[0]
      .resolvedSegments).toEqual([
      {
        globalEnd: 7,
        globalStart: 2,
        storySequenceCreationId: 'sequence-body-creation-1',
      },
    ]);
    expect(states['state-affinity-insert-start-after'].formattingEvidence[0]
      .resolvedSegments).toEqual([
      {
        globalEnd: 7,
        globalStart: 3,
        storySequenceCreationId: 'sequence-body-creation-1',
      },
    ]);
    expect(states['state-affinity-insert-end-before'].formattingEvidence[0]
      .resolvedSegments[0].globalEnd).toBe(6);
    expect(states['state-affinity-insert-end-after'].formattingEvidence[0]
      .resolvedSegments[0].globalEnd).toBe(7);
    const affinityOperations = Object.fromEntries(
      events
        .filter((event) => event.eventId.startsWith('evt-affinity-op-'))
        .map((event) => [event.eventId.replace('evt-affinity-op-', ''), event])
    );
    for (const position of ['start', 'inside', 'end']) {
      for (const edit of ['insert', 'delete']) {
        const before = affinityOperations[`${edit}-${position}-before`];
        const after = affinityOperations[`${edit}-${position}-after`];
        expect(before.operation.startAffinity).toBe('before');
        expect(before.operation.startAssoc).toBe(-1);
        expect(after.operation.startAffinity).toBe('after');
        expect(after.operation.startAssoc).toBe(0);
        expect(before.operation).not.toEqual(after.operation);
      }
    }
  });

  test('freezes every two- and three-update delivery permutation', () => {
    const overlap = fixtures.fixturePrograms.find(
      (program: JsonRecord) => program.fixtureId === 'overlapping-owners'
    );
    const observed = fixtures.fixturePrograms.find(
      (program: JsonRecord) => program.fixtureId === 'observed-unseen-delivery'
    );
    const boundaries = fixtures.fixturePrograms.find(
      (program: JsonRecord) => program.fixtureId === 'concurrent-boundaries'
    );
    const three = fixtures.fixturePrograms.find(
      (program: JsonRecord) =>
        program.fixtureId === 'three-replica-permutations'
    );
    expect(overlap.matrix.map((row: JsonRecord) => row.order).sort()).toEqual(
      fixtures.permutationRequirements.twoUpdateAll
    );
    expect(observed.matrix.map((row: JsonRecord) => row.order).sort()).toEqual(
      fixtures.permutationRequirements.twoUpdateAll
    );
    expect(
      observed.matrix.map((row: JsonRecord) => [
        row.order,
        row.firstUpdateRef,
        row.secondUpdateRef,
        row.thirdUpdateRef,
      ])
    ).toEqual([
      [
        'AB',
        'update-observed-add',
        'update-observed-remove',
        'update-unseen',
      ],
      [
        'BA',
        'update-unseen',
        'update-observed-add',
        'update-observed-remove',
      ],
    ]);
    for (const scenario of ['same', 'different']) {
      expect(
        boundaries.matrix
          .filter((row: JsonRecord) => row.scenario === scenario)
          .map((row: JsonRecord) => row.order)
          .sort()
      ).toEqual(fixtures.permutationRequirements.twoUpdateAll);
    }
    expect(three.matrix.map((row: JsonRecord) => row.order).sort()).toEqual(
      fixtures.permutationRequirements.threeUpdateAll.slice().sort()
    );
    for (const row of three.matrix as JsonRecord[]) {
      expect(`${row.first}${row.second}${row.third}`).toBe(row.order);
    }
  });

  test('freezes every quota boundary and prospective atomic overflow', () => {
    const quotaProgram = fixtures.fixturePrograms.find(
      (program: JsonRecord) => program.fixtureId === 'quota-boundaries'
    );
    expect(
      Object.fromEntries(
        quotaProgram.matrix.map((row: JsonRecord) => [
          row.quotaName,
          row.atLimit,
        ])
      )
    ).toEqual(
      Object.fromEntries(
        Object.entries(contract.quotas).filter(
          ([quota]) =>
            ![
              'reconstructionJournalEvents',
              'retainedJournalHorizonEvents',
            ].includes(quota)
        )
      )
    );
    for (const row of quotaProgram.matrix as JsonRecord[]) {
      expect(row.overLimit).toBe(row.atLimit + 1);
      expect(contract.diagnosticSchema.requiredCodes).toContain(
        row.diagnosticCode
      );
    }
  });

  test('rejects non-plain embeds and mismatched retained restores atomically', () => {
    const malformed = fixtures.fixturePrograms.find(
      (program: JsonRecord) => program.fixtureId === 'malformed-inputs'
    );
    const rows = Object.fromEntries(
      malformed.matrix.map((row: JsonRecord) => [row.caseId, row])
    );
    expect(rows['embed-custom-prototype'].diagnosticCode).toBe(
      'NON_PLAIN_OBJECT'
    );
    expect(rows['embed-non-plain-object'].diagnosticCode).toBe(
      'NON_PLAIN_OBJECT'
    );
    expect(rows['restore-retained-horizon-mismatch']).toMatchObject({
      diagnosticCode: 'JOURNAL_CHECKPOINT_STACK_MISMATCH',
      inputKind: 'historyRestore',
      limit: 48,
    });
    for (const caseId of [
      'embed-custom-prototype',
      'embed-non-plain-object',
      'restore-retained-horizon-mismatch',
    ]) {
      const rejection = events.find(
        (event) => event.eventId === `evt-reject-${caseId}`
      );
      expect(rejection, caseId).toBeDefined();
      expect(rejection!.preStateRef, caseId).toBe(rejection!.postStateRef);
      expect(rejection!.unchangedSurfaces, caseId).toEqual(
        contract.rejection.atomicNoWriteSurfaces
      );
    }
  });

  test('freezes durable history, reconstruction journal, and redo rules', () => {
    const journal = fixtures.reconstructionJournals[
      'journal-history-full'
    ] as JsonRecord[];
    expect(journal.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4]);
    expect(journal.map((entry) => entry.eventId)).toEqual([
      'evt-history-bold',
      'evt-history-italic',
      'evt-history-stop',
      'evt-history-undo',
    ]);
    const undone = states['state-history-undone'].managerStacks[0];
    expect(undone.undo).toEqual([]);
    expect(undone.redo[0].constituentEventIds).toEqual([
      'evt-history-bold',
      'evt-history-italic',
    ]);
    expect(
      states['state-history-remote-preserved'].managerStacks[0].redo
    ).toEqual(undone.redo);
    expect(
      states['state-history-repair-preserved'].managerStacks[0].redo
    ).toEqual(undone.redo);
    expect(
      states['state-history-other-session-preserved'].managerStacks[0].redo
    ).toEqual(undone.redo);
    expect(
      states['state-history-new-local-cleared'].managerStacks[0].redo
    ).toEqual([]);
    const eventIds = new Set(events.map((event) => event.eventId));
    const eventsById = new Map(
      events.map((event) => [event.eventId as string, event])
    );
    for (const [stateRef, state] of Object.entries(states)) {
      for (const manager of state.managerStacks as JsonRecord[]) {
        for (const stackName of ['undo', 'redo']) {
          for (const item of (manager[stackName] as JsonRecord[] | undefined) ??
            []) {
            for (const constituent of item.constituentEventIds as string[]) {
              const source = eventsById.get(constituent);
              expect(source, `${stateRef}.${constituent}`).toBeDefined();
              expect(source!.actorId, `${stateRef}.${constituent}`).toBe(
                manager.actorId
              );
              expect(source!.sessionId, `${stateRef}.${constituent}`).toBe(
                manager.sessionId
              );
              expect(source!.groupId, `${stateRef}.${constituent}`).toBe(
                item.groupId
              );
            }
          }
        }
      }
    }
    const capturedUpdateRefs = new Set(
      events
        .filter((event) => event.type === 'captureUpdate')
        .map((event) => event.updateRef)
    );
    for (const journal of Object.values(
      fixtures.reconstructionJournals as Record<string, JsonRecord[]>
    )) {
      if (!Array.isArray(journal)) continue;
      for (const entry of journal) {
        if (entry.updateRef !== null) {
          expect(capturedUpdateRefs.has(entry.updateRef), entry.eventId).toBe(
            true
          );
        }
      }
    }
    for (const assertion of fixtures.nonDestructiveAssertions as JsonRecord[]) {
      expect(eventIds.has(assertion.beforeEventId)).toBe(true);
      expect(eventIds.has(assertion.actionEventId)).toBe(true);
      expect(eventIds.has(assertion.afterEventId)).toBe(true);
      expect(assertion.relation).toBe('byte-for-byte-equal');
      expect(assertion.expectedWritesToComparedSurfaces).toBe(0);
      expect(
        assertion.candidateActualHashExcludedFromSemanticExpectedHash
      ).toBe(true);
      expect(assertion.surfaces).not.toContain('candidateRawFormattingEvidence');
    }
  });

  test('recomputes normalized IDs, repair evidence, and retention semantics', () => {
    const splitPayload = structuredClone(
      states['state-split'].authored.boundaries.find(
        (boundary: JsonRecord) => boundary.creationId === 'boundary-split'
      )
    );
    const splitFingerprint = splitPayload.payloadFingerprint;
    delete splitPayload.payloadFingerprint;
    expect(splitFingerprint).toBe(hashCanonical(splitPayload));
    for (const candidateName of ['candidateA', 'candidateB']) {
      const candidate = representations[candidateName];
      for (const assertion of candidate.derivations as JsonRecord[]) {
        expect(assertion.expectedId).toBe(
          `mark-normalized-${hashCanonical(assertion.input).slice('sha256:'.length)}`
        );
        expect(assertion.input[0]).toBe(candidate.domain);
      }
    }
    expect(representations.crossCandidateExclusion).toMatchObject({
      excludedFromWinnerEligibility: true,
    });
    for (const record of Object.values(
      fixtures.repairRecords as Record<string, JsonRecord>
    )) {
      expect(record.repairEvidenceKey).toBe(
        hashCanonical(record.repairEvidenceKeyInput)
      );
      expect(
        record.derivedMappings['boundary-collision-B']
      ).toBe(
        `paragraph-derived-${hashCanonical(record.loserDerivedIdInput).slice(
          'sha256:'.length
        )}`
      );
      const { expectedCanonicalHash, ...hashInput } = record;
      expect(expectedCanonicalHash).toBe(hashCanonical(hashInput));
      expect(record.selectedSurvivor).toBe('boundary-collision-A');
    }
    const retention = Object.fromEntries(
      (fixtures.retentionScenarios as JsonRecord[]).map((scenario) => [
        scenario.eventCount,
        scenario,
      ])
    );
    expect(retention[49]).toMatchObject({
      accepted: true,
      oldestEligibleEvent: 'journal-002',
      oldestStoredEvent: 'journal-001',
      stateChanged: false,
    });
    expect(retention[64]).toMatchObject({
      accepted: true,
      oldestEligibleEvent: 'journal-017',
      oldestStoredEvent: 'journal-001',
      stateChanged: false,
    });
    expect(retention[65]).toMatchObject({
      accepted: true,
      foldedIntoGenesisRangeInclusive: [1, 17],
      oldestEligibleEvent: 'journal-018',
      oldestStoredEvent: 'journal-018',
      retainedEligibleCount: 48,
      stateChanged: true,
      terminalEventId: 'journal-065',
      terminalGroupId: 'group-retention-065',
    });
    expect(
      states['state-retention-65-compacted'].reconstructionJournal
        .storedRangeInclusive
    ).toEqual([18, 65]);
    expect(states['state-retention-65-compacted']).toMatchObject({
      checkpointId: 'cp-retention-65-compacted',
      managerStacks: [
        {
          actorId: 'actor-A',
          sessionId: 'session-A-1',
          terminalStackItem: {
            constituentEventIds: ['journal-065'],
            groupId: 'group-retention-065',
          },
          undoEventRangeInclusive: [34, 65],
        },
      ],
      revision: 1,
      stateVectorRef: 'sv-retention-65',
    });
    expect(
      states['state-retention-65-compacted'].reconstructionJournal
    ).toMatchObject({
      eligibleRangeInclusive: [18, 65],
      foldedIntoGenesisRangeInclusive: [1, 17],
      genesisCheckpointAfterCompaction: 'cp-retention-genesis-through-017',
      genesisStateVectorAfterCompaction: 'sv-retention-genesis-through-017',
      storedRangeInclusive: [18, 65],
    });
  });

  test('freezes generator algorithm, seeds, count, domain, and diagnostics', () => {
    expect(contract.seededGenerator.algorithm.name).toBe('xorshift32');
    expect(contract.seededGenerator.operationCountPerSeed).toBe(64);
    expect(contract.seededGenerator.seeds).toEqual([
      0, 1, 2, 7, 42, 255, 65537, 2147483647, 3735928559,
    ]);
    expect(generator.operationDomainExactly).toEqual([
      'enableMark:bold',
      'enableMark:italic',
      'disableMark:bold',
      'disableMark:italic',
    ]);
    expect(generator.operationDomainExactly).toEqual(
      contract.seededGenerator.domainExactly
    );
    expect(
      generator.seedExpectations.map((entry: JsonRecord) => entry.seed)
    ).toEqual(contract.seededGenerator.seeds);
    expect(generator.operationCount).toBe(64);
    expect(
      generator.deliverySchedule.missingTargetDiagnostic.candidateScope
    ).toBe(
      'Candidate A and Candidate B must both reject before applying representation-specific mutation or update coverage'
    );
    expect(generator.terminalDiagnosticFieldsExactly).toEqual([
      'candidateDerivationChecks',
      'deliveryCounts',
      'diagnosticTraceHash',
      'fallbackCount',
      'lastPrngState',
      'seed',
      'semanticFingerprint',
    ]);
    expect(generator.validRangeTable.map((range: JsonRecord) => range.rangeId))
      .toEqual([
        'range-p1-0-2',
        'range-p1-2-4',
        'range-p1-4-6',
        'range-p2-0-2',
        'range-p2-2-4',
        'range-p2-4-6',
      ]);
    for (const {
      seed,
      expectedDiagnosticTraceHash,
      expectedEventHash,
      expectedSemanticFingerprintHash,
    } of generator.seedExpectations as JsonRecord[]) {
      const executable = generateFormattingSeed(generator, seed);
      expect(expectedEventHash, `generated events seed ${seed}`).not.toBeNull();
      expect(hashCanonical(executable.events), `generated events seed ${seed}`)
        .toBe(expectedEventHash);
      expect(
        hashCanonical(executable.terminalDiagnostic.semanticFingerprint),
        `semantic fingerprint seed ${seed}`
      ).toBe(expectedSemanticFingerprintHash);
      expect(
        executable.terminalDiagnostic.diagnosticTraceHash,
        `diagnostic trace seed ${seed}`
      ).toBe(expectedDiagnosticTraceHash);
      const generatedIds = executable.events.map((event) => event.eventId);
      expect(new Set(generatedIds).size, `generated IDs seed ${seed}`).toBe(
        generatedIds.length
      );
      const generatedUpdates = new Map<string, JsonRecord>();
      const semanticOperations = new Map<string, JsonRecord>();
      const successfulDeliveries = new Set<string>();
      const rejectedDeliveries = new Set<string>();
      const retriedDeliveries = new Set<string>();
      const duplicateDeliveries = new Set<string>();
      let multiTargetDisableCount = 0;
      let prior: JsonRecord | null = null;
      for (const event of executable.events) {
        expect(
          generator.eventExpansion.closedEventTypesExactly,
          event.eventId
        ).toContain(event.type);
        expect(keys(event), event.eventId).toEqual(
          [
            ...contract.eventLanguage.commonFieldsExactly,
            ...contract.eventLanguage.eventSpecificFieldsExactly[event.type],
          ].sort()
        );
        if (event.type === 'localSemanticOp') {
          semanticOperations.set(event.eventId, event.operation);
          expect(keys(event.operation), event.eventId).toEqual(
            contract.eventLanguage.operationFieldsExactly[event.operation.kind]
              .slice()
              .sort()
          );
          expect(['enableMark', 'disableMark']).toContain(event.operation.kind);
          const range = generator.validRangeTable.find(
            (candidate: JsonRecord) =>
              candidate.boundaryCreationId ===
                event.operation.boundaryCreationId &&
              candidate.startOffsetUtf16 ===
                event.operation.startOffsetUtf16 &&
              candidate.endOffsetUtf16 === event.operation.endOffsetUtf16
          );
          expect(range, event.eventId).toBeDefined();
          expect(event.expectedGlobalMapping).toEqual({
            globalEnd: range.globalEnd,
            globalStart: range.globalStart,
          });
        }
        const postState = executable.states[event.postStateRef];
        expect(postState, event.eventId).toBeDefined();
        expect(postState.revision, event.eventId).toBe(
          event.expectedRevisionAfter
        );
        const preState =
          event.preStateRef === null
            ? null
            : executable.states[event.preStateRef];
        if (event.preStateRef !== null) {
          expect(preState, event.eventId).toBeDefined();
          expect(preState!.revision, event.eventId).toBe(
            event.expectedRevisionBefore
          );
        }
        if (event.type === 'localSemanticOp') {
          expect(postState.knownSemanticOperationIds, event.eventId).toContain(
            event.eventId
          );
          expect(postState.localGroups.at(-1) as any, event.eventId).toEqual(
            {
              constituentEventIds: [event.eventId],
              groupId: event.groupId,
            } as any
          );
          if (event.operation.kind === 'disableMark') {
            const expectedTargets = [
              ...new Set(
                preState!.activeAddsByKindRange
                  .filter(
                    (active: JsonRecord) =>
                      active.storyId === event.operation.storyId &&
                      active.markKind === event.operation.markKind &&
                      active.globalStart <
                        event.expectedGlobalMapping.globalEnd &&
                      event.expectedGlobalMapping.globalStart <
                        active.globalEnd
                  )
                  .map((active: JsonRecord) => active.contributionId)
              ),
            ].sort((left, right) =>
              Buffer.compare(
                Buffer.from(left as string, 'utf8'),
                Buffer.from(right as string, 'utf8')
              )
            );
            expect(
              event.operation.targetObservedContributionIds as any,
              event.eventId
            ).toEqual(expectedTargets as any);
            if (expectedTargets.length > 1) multiTargetDisableCount++;
          }
        }
        if (event.type === 'captureUpdate') {
          expect(prior?.eventId, event.eventId).toBe(event.producerEventId);
          expect(generatedUpdates.has(event.updateRef), event.eventId).toBe(
            false
          );
          generatedUpdates.set(event.updateRef, {
            operation: prior?.operation,
            producerEventId: event.producerEventId,
            sourceReplica: event.sourceReplica,
          });
        }
        if (event.type === 'deliverUpdate') {
          const produced = generatedUpdates.get(event.updateRef);
          expect(produced?.sourceReplica, event.eventId).toBe(
            event.sourceReplica
          );
          const key = `${event.updateRef}->${event.destinationReplica}`;
          if (event.deliveryKind === 'first') {
            expect(successfulDeliveries.has(key), event.eventId).toBe(false);
            expect(event.postStateRef, event.eventId).not.toBe(
              event.preStateRef
            );
            expect(event.deliveryDiagnostic, event.eventId).toBeNull();
            expect(
              postState.knownSemanticOperationIds,
              event.eventId
            ).toContain(produced?.producerEventId);
            expect(postState.deliveredUpdateIds, event.eventId).toContain(
              event.updateRef
            );
            successfulDeliveries.add(key);
          } else if (event.deliveryKind === 'rejected-missing-target') {
            expect(produced?.operation.kind as any, event.eventId).toBe(
              'disableMark' as any
            );
            expect(rejectedDeliveries.has(key), event.eventId).toBe(false);
            expect(successfulDeliveries.has(key), event.eventId).toBe(false);
            expect(event.postStateRef, event.eventId).toBe(event.preStateRef);
            expect(event.expectedRevisionAfter, event.eventId).toBe(
              event.expectedRevisionBefore
            );
            expect(postState.deliveredUpdateIds, event.eventId).not.toContain(
              event.updateRef
            );
            const knownAddIds = new Set(
              preState!.knownSemanticOperationIds
                .map((operationId: string) => semanticOperations.get(operationId))
                .filter(
                  (operation: JsonRecord | undefined) =>
                    operation?.kind === 'enableMark'
                )
                .map((operation: JsonRecord) => operation.contributionId)
            );
            const expectedMissingTargets = (
              produced?.operation.targetObservedContributionIds ?? []
            ).filter((target: string) => !knownAddIds.has(target));
            expect(event.deliveryDiagnostic as any, event.eventId).toEqual(
              {
                code: 'missing-target-add',
                missingTargetAddIds: expectedMissingTargets,
                updateRef: event.updateRef,
              } as any
            );
            for (const target of event.deliveryDiagnostic.missingTargetAddIds) {
              expect(knownAddIds.has(target), event.eventId).toBe(false);
            }
            rejectedDeliveries.add(key);
          } else if (event.deliveryKind === 'retry') {
            expect(rejectedDeliveries.has(key), event.eventId).toBe(true);
            expect(retriedDeliveries.has(key), event.eventId).toBe(false);
            expect(event.deliveryDiagnostic, event.eventId).toBeNull();
            expect(event.postStateRef, event.eventId).not.toBe(
              event.preStateRef
            );
            expect(postState.deliveredUpdateIds, event.eventId).toContain(
              event.updateRef
            );
            const knownAddIds = new Set(
              preState!.knownSemanticOperationIds
                .map((operationId: string) => semanticOperations.get(operationId))
                .filter(
                  (operation: JsonRecord | undefined) =>
                    operation?.kind === 'enableMark'
                )
                .map((operation: JsonRecord) => operation.contributionId)
            );
            for (const target of produced?.operation
              .targetObservedContributionIds ?? []) {
              expect(knownAddIds.has(target), event.eventId).toBe(true);
            }
            successfulDeliveries.add(key);
            retriedDeliveries.add(key);
          } else {
            expect(successfulDeliveries.has(key), event.eventId).toBe(true);
            expect(duplicateDeliveries.has(key), event.eventId).toBe(false);
            expect(event.deliveryDiagnostic, event.eventId).toBeNull();
            expect(event.postStateRef, event.eventId).toBe(event.preStateRef);
            duplicateDeliveries.add(key);
          }
        }
        prior = event;
      }
      expect(duplicateDeliveries).toEqual(successfulDeliveries);
      expect(retriedDeliveries).toEqual(rejectedDeliveries);
      expect(rejectedDeliveries.size, `rejections seed ${seed}`).toBeGreaterThan(
        0
      );
      expect(
        multiTargetDisableCount,
        `multi-target disables seed ${seed}`
      ).toBeGreaterThan(0);
      expect(keys(executable.terminalDiagnostic)).toEqual(
        generator.terminalDiagnosticFieldsExactly.slice().sort()
      );
      expect(keys(executable.terminalDiagnostic.deliveryCounts)).toEqual(
        generator.deliveryCountFieldsExactly.slice().sort()
      );
      expect(executable.terminalDiagnostic.seed).toBe(seed);
      expect(
        Number.isInteger(executable.terminalDiagnostic.lastPrngState)
      ).toBe(true);
      expect(
        executable.terminalDiagnostic.deliveryCounts
          .rejectedBeforePrerequisite
      ).toBe(rejectedDeliveries.size);
      expect(
        executable.terminalDiagnostic.deliveryCounts.successfulRetry
      ).toBe(retriedDeliveries.size);
      expect(
        executable.terminalDiagnostic.deliveryCounts.duplicate
      ).toBe(successfulDeliveries.size);
      const terminalAssertions = executable.events.filter(
        (event) => event.type === 'assertState'
      );
      expect(terminalAssertions).toHaveLength(3);
      const terminalFingerprints = terminalAssertions.map(
        (event) =>
          executable.states[event.stateRef].activeFormattingEvidence
      );
      expect(
        terminalFingerprints.every(
          (fingerprint) =>
            canonicalJson(fingerprint) ===
            canonicalJson(terminalFingerprints[0])
        )
      ).toBe(true);
      for (const state of Object.values(executable.states)) {
        expect(
          [
            'activeAddsByKindRange',
            'deliveredUpdateIds',
            'knownSemanticOperationIds',
            'localGroups',
            'producedUpdateRefs',
          ].every((field) => field in state)
        ).toBe(true);
        for (const evidence of state.activeFormattingEvidence) {
          expect(keys(evidence)).toEqual(
            contract.canonicalState.formattingEvidence.fieldsExactly
              .slice()
              .sort()
          );
          expect(evidence.authoredIntentFingerprint).toBe(
            generator.genesis.authoredIntentFingerprint
          );
          for (const field of [
            'actorIds',
            'commitIds',
            'evidenceCreationIds',
            'semanticMarkIds',
          ]) {
            const values = evidence[field] as string[];
            expect(values).toEqual(
              [...new Set(values)].sort((left, right) =>
                Buffer.compare(
                  Buffer.from(left, 'utf8'),
                  Buffer.from(right, 'utf8')
                )
              )
            );
          }
          for (const segment of evidence.resolvedSegments) {
            expect(keys(segment)).toEqual(
              contract.canonicalState.formattingEvidence
                .resolvedSegmentFieldsExactly
            );
            expect(segment.storySequenceCreationId).toBe(
              generator.genesis.storySequenceCreationId
            );
            expect(segment.globalStart).toBeLessThan(segment.globalEnd);
          }
        }
      }
      for (const candidate of ['candidateA', 'candidateB']) {
        const derivations =
          executable.terminalDiagnostic.candidateDerivationChecks[candidate];
        expect(derivations).toHaveLength(
          executable.terminalDiagnostic.semanticFingerprint.length
        );
        for (const [index, derivation] of derivations.entries()) {
          const evidence =
            executable.terminalDiagnostic.semanticFingerprint[index];
          expect(derivation.input[1]).toBe(evidence.kind);
          expect(derivation.input[2]).toEqual(
            evidence.evidenceCreationIds
          );
          expect(derivation.input.at(-1)).toBe(0);
          expect(derivation.normalizedId).toBe(
            `mark-normalized-${hashCanonical(derivation.input).slice(
              'sha256:'.length
            )}`
          );
        }
      }
    }
  });

  test('keeps semantic expectations representation-neutral', () => {
    const text = readFileSync(join(oracleDir, 'fixtures.v2.json'), 'utf8');
    expect(text).not.toMatch(
      /"(?:formattingMetadata|markContributions|candidateA|candidateB|toDelta)"\s*:/
    );
    expect(text).not.toMatch(/observed result|measured bytes|winner/i);
  });
});
