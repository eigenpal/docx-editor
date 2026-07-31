/** @spike-features fixture-comparators, yjs-backend */
import { sha256Hex } from '../oracle-hash';
import { canonicalJson } from '../canonical-json';
import {
  compareAuthoredEditEvents,
  validateAuthoredEditEvents,
  validateSplitTailEditJournal,
  type AuthoredTextEditEvent,
} from '../store/yjs/structural-provenance';

export interface RelativeEndpointEnvelope {
  readonly version: 'relative-endpoint/1';
  readonly documentId: string;
  readonly backendVersion: string;
  readonly schemaVersion: string;
  readonly checkpoint: string;
  readonly textCreationId: string;
  readonly affinity: 'before' | 'after';
  readonly relativeBytes: string;
}

interface ProvenancedRecord {
  readonly creationId: string;
  readonly semanticId: string;
  readonly proposedSemanticId: string;
  readonly actorId: string;
  readonly commitId: string;
}

export interface DecodedYjsModel {
  readonly documentId: string;
  readonly backendVersion: string;
  readonly schemaVersion: string;
  readonly normalizationVersion: string;
  readonly gcEnabled: boolean;
  readonly rootContainerType: 'Y.Map';
  readonly rootContainers: Readonly<Record<string, 'Y.Map' | 'Y.Array'>>;
  readonly storyOrderContainerType: 'Y.Array';
  readonly storyOrder: readonly string[];
  readonly stories: readonly (ProvenancedRecord & {
    readonly containerType: 'Y.Map';
    readonly storyKind: 'body';
    readonly blockOrderContainerType: 'Y.Array';
    readonly blockOrder: readonly string[];
  })[];
  readonly blocks: readonly (ProvenancedRecord & {
    readonly containerType: 'Y.Map';
    readonly storyId: string;
    readonly parentId: string;
    readonly blockKind: 'paragraph';
    readonly paragraphId: string;
    readonly proposedParagraphId: string;
    readonly textId: string;
    readonly markIdsContainerType: 'Y.Array';
    readonly markIds: readonly string[];
    readonly capsuleIdsContainerType: 'Y.Array';
    readonly capsuleIds: readonly string[];
    readonly styleId: string;
    readonly authoredProperties: Readonly<Record<string, unknown>>;
  })[];
  readonly texts: readonly (ProvenancedRecord & {
    readonly parentBlockId: string;
    readonly containerType: 'Y.Map';
    readonly contentContainerType: 'Y.Text';
    readonly content: string;
    readonly structuralSplitOffset?: number;
    readonly structuralOriginalTail?: string;
    readonly authoredContributions?: readonly {
      readonly kind: 'insert' | 'delete';
      readonly tokenId?: string;
      readonly leftAnchor?: {
        readonly kind: 'origin' | 'end' | 'base' | 'token';
        readonly offset?: number;
        readonly tokenId?: string;
      };
      readonly rightAnchor?: {
        readonly kind: 'origin' | 'end' | 'base' | 'token';
        readonly offset?: number;
        readonly tokenId?: string;
      };
      readonly affinity?: 'before' | 'after';
      readonly anchorSplitOffset: number;
      readonly text?: string;
      readonly tombstonedTokenIds?: readonly string[];
      readonly observedInsertCreationIds?: readonly string[];
      readonly actorId: string;
      readonly commitId: string;
      readonly creationId: string;
      readonly sourceClientId: number;
    }[];
  })[];
  readonly marks: readonly (ProvenancedRecord & {
    readonly containerType: 'Y.Map';
    readonly parentTextId: string;
    readonly markKind: 'bold' | 'italic';
    readonly start: RelativeEndpointEnvelope;
    readonly end: RelativeEndpointEnvelope;
  })[];
  readonly capsules: readonly (ProvenancedRecord & {
    readonly containerType: 'Y.Map';
    readonly ownerStoryId: string;
    readonly ownerBlockId: string;
    readonly parentBlockId: string;
    readonly childIndex: number;
    readonly byteBoundaryStart: number;
    readonly byteBoundaryEnd: number;
    readonly bytesHex: string;
    readonly namespaceBindings: Readonly<Record<string, string>>;
    readonly previousSiblingBytesHex: string;
    readonly nextSiblingBytesHex: string;
  })[];
  readonly allocatorContainerType: 'Y.Map';
  readonly allocator: readonly {
    readonly containerType: 'Y.Map';
    readonly actorId: string;
    readonly nextLocalSeq: number;
    readonly nextCommitSeq: number;
    readonly observedSemanticIdsContainerType: 'Y.Map';
    readonly observedSemanticIds: readonly string[];
  }[];
  readonly collisionCandidates: readonly {
    readonly creationId: string;
    readonly semanticId: string;
    readonly proposedSemanticId: string;
    readonly actorId: string;
    readonly commitId: string;
  }[];
  readonly splitTailEditJournal: readonly {
    readonly key: string;
    readonly event: {
      readonly kind: 'insert' | 'delete';
      readonly tokenId?: string;
      readonly leftAnchor?: {
        readonly kind: 'origin' | 'end' | 'base' | 'token';
        readonly offset?: number;
        readonly tokenId?: string;
      };
      readonly rightAnchor?: {
        readonly kind: 'origin' | 'end' | 'base' | 'token';
        readonly offset?: number;
        readonly tokenId?: string;
      };
      readonly affinity?: 'before' | 'after';
      readonly anchorSplitOffset: number;
      readonly text?: string;
      readonly tombstonedTokenIds?: readonly string[];
      readonly observedInsertCreationIds?: readonly string[];
      readonly actorId: string;
      readonly commitId: string;
      readonly creationId: string;
      readonly sourceClientId: number;
    };
  }[];
  readonly tombstones: readonly (ProvenancedRecord & {
    readonly recordKind: 'story' | 'block' | 'text' | 'mark' | 'capsule';
    readonly deleted: true;
  })[];
}

const ROOT_KEYS = [
  'meta',
  'storyOrder',
  'stories',
  'blocks',
  'texts',
  'marks',
  'capsules',
  'allocator',
] as const;
const BACKEND_VERSION = 'yjs-backend/1.0.0';
const SCHEMA_VERSION = '1.0.0';
const NORMALIZATION_VERSION = '1.0.0';

export function validateDecodedYjsModel(snapshot: DecodedYjsModel): string[] {
  const errors: string[] = [];
  if (typeof snapshot.documentId !== 'string' || snapshot.documentId.length === 0) {
    errors.push('document ID must be nonempty');
  }
  if (snapshot.backendVersion !== BACKEND_VERSION) errors.push('backend version mismatch');
  if (snapshot.schemaVersion !== SCHEMA_VERSION) errors.push('schema version mismatch');
  if (snapshot.normalizationVersion !== NORMALIZATION_VERSION) {
    errors.push('normalization version mismatch');
  }
  if (snapshot.gcEnabled) errors.push('GC must be disabled');
  if (snapshot.rootContainerType !== 'Y.Map') errors.push('root must be Y.Map');
  if (snapshot.storyOrderContainerType !== 'Y.Array') {
    errors.push('storyOrder value must be Y.Array');
  }
  if (
    canonicalJson(Object.keys(snapshot.rootContainers).sort()) !==
    canonicalJson([...ROOT_KEYS].sort())
  ) {
    errors.push('root keys mismatch');
  }
  if (snapshot.rootContainers.storyOrder !== 'Y.Array') errors.push('storyOrder must be Y.Array');
  for (const key of ROOT_KEYS.filter((key) => key !== 'storyOrder')) {
    if (snapshot.rootContainers[key] !== 'Y.Map') errors.push(`${key} must be Y.Map`);
  }
  const liveRecords: ProvenancedRecord[] = [
    ...snapshot.stories,
    ...snapshot.blocks,
    ...snapshot.texts,
    ...snapshot.marks,
    ...snapshot.capsules,
  ];
  validateExactRecordShapes(snapshot, errors);
  validateProvenance(liveRecords, errors);
  const liveCreationIds = new Set(liveRecords.map((record) => record.creationId));
  if (liveCreationIds.size !== liveRecords.length) errors.push('duplicate live creation ID');
  const liveSemanticIds = new Set(liveRecords.map((record) => record.semanticId));
  if (liveSemanticIds.size !== liveRecords.length) errors.push('duplicate live semantic ID');

  const storyIds = new Set(snapshot.stories.map((record) => record.creationId));
  if (
    hasDuplicates(snapshot.storyOrder) ||
    snapshot.storyOrder.length !== snapshot.stories.length ||
    snapshot.storyOrder.some((id) => !storyIds.has(id))
  ) {
    errors.push('each story must occur exactly once in storyOrder');
  }
  const blockIds = new Set(snapshot.blocks.map((record) => record.creationId));
  const blockMembership = new Map<string, string[]>();
  for (const story of snapshot.stories) {
    if (
      story.containerType !== 'Y.Map' ||
      story.storyKind !== 'body' ||
      story.blockOrderContainerType !== 'Y.Array'
    ) {
      errors.push('story container or kind invalid');
    }
    if (hasDuplicates(story.blockOrder)) errors.push('duplicate block in story order');
    for (const blockId of story.blockOrder) {
      if (!blockIds.has(blockId)) errors.push('block order references missing block');
      const owners = blockMembership.get(blockId) ?? [];
      owners.push(story.creationId);
      blockMembership.set(blockId, owners);
    }
  }
  const textIds = new Set(snapshot.texts.map((record) => record.creationId));
  const markIds = new Set(snapshot.marks.map((record) => record.creationId));
  const capsuleIds = new Set(snapshot.capsules.map((record) => record.creationId));
  const textMembership = new Map<string, string[]>();
  const markMembership = new Map<string, string[]>();
  const capsuleMembership = new Map<string, string[]>();
  for (const block of snapshot.blocks) {
    if (
      block.containerType !== 'Y.Map' ||
      block.markIdsContainerType !== 'Y.Array' ||
      block.capsuleIdsContainerType !== 'Y.Array'
    ) {
      errors.push('block nested container shape mismatch');
    }
    const owners = blockMembership.get(block.creationId) ?? [];
    if (owners.length !== 1 || owners[0] !== block.parentId) {
      errors.push('block must occur once in its owning story order');
    }
    if (!storyIds.has(block.parentId) || block.storyId !== block.parentId) {
      errors.push('block owner missing or storyId inconsistent');
    }
    if (
      block.blockKind !== 'paragraph' ||
      typeof block.paragraphId !== 'string' ||
      block.paragraphId.length === 0 ||
      typeof block.proposedParagraphId !== 'string' ||
      block.proposedParagraphId.length === 0 ||
      typeof block.styleId !== 'string' ||
      block.styleId.length === 0 ||
      block.authoredProperties === null ||
      typeof block.authoredProperties !== 'object' ||
      Array.isArray(block.authoredProperties)
    ) {
      errors.push('block kind or style invalid');
    }
    if (!textIds.has(block.textId)) errors.push('block text missing');
    const textOwners = textMembership.get(block.textId) ?? [];
    textOwners.push(block.creationId);
    textMembership.set(block.textId, textOwners);
    if (hasDuplicates(block.markIds)) errors.push('duplicate mark in block order');
    if (block.markIds.some((id) => !markIds.has(id))) {
      errors.push('mark order references missing mark');
    }
    for (const markId of block.markIds) {
      const memberships = markMembership.get(markId) ?? [];
      memberships.push(block.creationId);
      markMembership.set(markId, memberships);
    }
    if (hasDuplicates(block.capsuleIds)) errors.push('duplicate capsule in block order');
    if (block.capsuleIds.some((id) => !capsuleIds.has(id))) {
      errors.push('capsule order references missing capsule');
    }
    for (const capsuleId of block.capsuleIds) {
      const memberships = capsuleMembership.get(capsuleId) ?? [];
      memberships.push(block.creationId);
      capsuleMembership.set(capsuleId, memberships);
    }
    const orderedCapsules = block.capsuleIds
      .map((id) => snapshot.capsules.find((capsule) => capsule.creationId === id))
      .filter((capsule) => capsule !== undefined);
    if (
      orderedCapsules.some(
        (capsule, index) =>
          index > 0 && capsule.childIndex <= orderedCapsules[index - 1]!.childIndex
      )
    ) {
      errors.push('capsule order must follow unique ascending child indices');
    }
  }
  const tombstonedBlockIds = new Set(
    snapshot.tombstones
      .filter((item) => item.recordKind === 'block')
      .map((item) => item.creationId)
  );
  for (const text of snapshot.texts) {
    const isDeferredSplitTail =
      text.structuralSplitOffset !== undefined && tombstonedBlockIds.has(text.parentBlockId);
    if (!isDeferredSplitTail) {
      const memberships = textMembership.get(text.creationId) ?? [];
      if (memberships.length !== 1 || memberships[0] !== text.parentBlockId) {
        errors.push('text must be referenced once by its owning block');
      }
      if (!blockIds.has(text.parentBlockId)) errors.push('text owner missing');
    }
    if (
      text.containerType !== 'Y.Map' ||
      text.contentContainerType !== 'Y.Text' ||
      typeof text.content !== 'string'
    ) {
      errors.push('text container shape mismatch');
    }
    if (text.structuralSplitOffset !== undefined) {
      if (!Number.isSafeInteger(text.structuralSplitOffset) || text.structuralSplitOffset <= 0) {
        errors.push('structural split offset invalid');
      }
    }
    if (
      text.structuralOriginalTail !== undefined &&
      typeof text.structuralOriginalTail !== 'string'
    ) {
      errors.push('structural original tail invalid');
    }
    if (text.authoredContributions !== undefined) {
      const allocatorByActor = new Map(
        snapshot.allocator.map((record) => [
          record.actorId,
          { nextLocalSeq: record.nextLocalSeq, nextCommitSeq: record.nextCommitSeq },
        ])
      );
      validateAuthoredEditEvents(
        text.authoredContributions as readonly AuthoredTextEditEvent[],
        text,
        text.structuralSplitOffset !== undefined
          ? text.proposedSemanticId.slice('text-'.length)
          : undefined,
        text.structuralOriginalTail,
        allocatorByActor,
        errors
      );
      const ordered = [...(text.authoredContributions as readonly AuthoredTextEditEvent[])].sort(
        compareAuthoredEditEvents
      );
      if (canonicalJson(ordered) !== canonicalJson(text.authoredContributions)) {
        errors.push('authored text contributions out of precedence order');
      }
    }
  }
  const blocksById = new Map(snapshot.blocks.map((block) => [block.creationId, block]));
  for (const mark of snapshot.marks) {
    const memberships = markMembership.get(mark.creationId) ?? [];
    const ownerBlock = memberships.length === 1 ? blocksById.get(memberships[0]!) : undefined;
    if (memberships.length !== 1 || !ownerBlock || ownerBlock.textId !== mark.parentTextId) {
      errors.push('mark must match owning block and text');
    }
    if (mark.containerType !== 'Y.Map' || !['bold', 'italic'].includes(mark.markKind)) {
      errors.push('mark container or kind invalid');
    }
    if (!textIds.has(mark.parentTextId)) errors.push('mark text owner missing');
    for (const endpoint of [mark.start, mark.end]) {
      if (
        !endpoint ||
        !sameStrings(Object.keys(endpoint), [
          'version',
          'documentId',
          'backendVersion',
          'schemaVersion',
          'checkpoint',
          'textCreationId',
          'affinity',
          'relativeBytes',
        ]) ||
        endpoint.version !== 'relative-endpoint/1' ||
        endpoint.documentId !== snapshot.documentId ||
        endpoint.backendVersion !== snapshot.backendVersion ||
        endpoint.schemaVersion !== snapshot.schemaVersion ||
        typeof endpoint.checkpoint !== 'string' ||
        endpoint.checkpoint.length === 0 ||
        endpoint.textCreationId !== mark.parentTextId ||
        !['before', 'after'].includes(endpoint.affinity) ||
        !isCanonicalBase64Url(endpoint.relativeBytes)
      ) {
        errors.push('mark endpoint envelope invalid');
      }
    }
  }
  for (const capsule of snapshot.capsules) {
    const memberships = capsuleMembership.get(capsule.creationId) ?? [];
    if (memberships.length !== 1 || memberships[0] !== capsule.parentBlockId) {
      errors.push('capsule must occur once in its owning block order');
    }
    if (capsule.containerType !== 'Y.Map') errors.push('capsule record must be Y.Map');
    if (!blockIds.has(capsule.parentBlockId)) errors.push('capsule owner missing');
    const ownerBlock = blocksById.get(capsule.parentBlockId);
    const ownerStory = ownerBlock
      ? snapshot.stories.find((story) => story.creationId === ownerBlock.parentId)
      : undefined;
    if (
      !ownerBlock ||
      !ownerStory ||
      capsule.ownerBlockId !== ownerBlock.semanticId ||
      capsule.ownerStoryId !== ownerStory.semanticId
    ) {
      errors.push('capsule semantic ownership invalid');
    }
    if (!Number.isInteger(capsule.childIndex) || capsule.childIndex < 0) {
      errors.push('capsule child index invalid');
    }
    if (
      !Number.isSafeInteger(capsule.byteBoundaryStart) ||
      !Number.isSafeInteger(capsule.byteBoundaryEnd) ||
      capsule.byteBoundaryStart < 0 ||
      capsule.byteBoundaryEnd < capsule.byteBoundaryStart ||
      !/^(?:[0-9a-f]{2})*$/i.test(capsule.previousSiblingBytesHex) ||
      !/^(?:[0-9a-f]{2})*$/i.test(capsule.nextSiblingBytesHex)
    ) {
      errors.push('capsule boundary or sibling bytes invalid');
    }
    if (!/^(?:[0-9a-f]{2})+$/i.test(capsule.bytesHex)) errors.push('capsule bytes invalid');
    if (
      Object.getPrototypeOf(capsule.namespaceBindings) !== Object.prototype ||
      Object.entries(capsule.namespaceBindings).some(
        ([prefix, namespace]) =>
          prefix.length === 0 || typeof namespace !== 'string' || namespace.length === 0
      )
    ) {
      errors.push('capsule namespace bindings invalid');
    }
  }
  validateAllocator(snapshot, errors);
  const contributionsByTail = new Map<string, NonNullable<DecodedYjsModel['texts'][number]['authoredContributions']>>();
  for (const text of snapshot.texts) {
    if (text.structuralSplitOffset === undefined || !text.authoredContributions?.length) continue;
    const tailBlockProposedId = text.proposedSemanticId.slice('text-'.length);
    contributionsByTail.set(tailBlockProposedId, text.authoredContributions);
  }
  validateSplitTailEditJournal(
    snapshot.splitTailEditJournal as readonly {
      readonly key: string;
      readonly event: AuthoredTextEditEvent;
    }[],
    contributionsByTail as ReadonlyMap<string, readonly AuthoredTextEditEvent[]>,
    errors
  );
  if (snapshot.allocatorContainerType !== 'Y.Map') {
    errors.push('allocator actor map must be Y.Map');
  }
  const collisionOrder = [...snapshot.collisionCandidates].sort(compareCollisionCandidates);
  if (canonicalJson(collisionOrder) !== canonicalJson(snapshot.collisionCandidates)) {
    errors.push('collision candidates out of ActorId/CommitId order');
  }
  validateProvenance(snapshot.collisionCandidates, errors);
  const candidateCreationIds = new Set(snapshot.collisionCandidates.map((item) => item.creationId));
  if (candidateCreationIds.size !== snapshot.collisionCandidates.length) {
    errors.push('duplicate collision candidate creation ID');
  }
  const repairedIds = new Set<string>();
  const candidatesByProposed = new Map<string, (typeof snapshot.collisionCandidates)[number][]>();
  for (const candidate of snapshot.collisionCandidates) {
    const group = candidatesByProposed.get(candidate.proposedSemanticId) ?? [];
    group.push(candidate);
    candidatesByProposed.set(candidate.proposedSemanticId, group);
  }
  for (const [proposedSemanticId, candidates] of candidatesByProposed) {
    const ordered = [...candidates].sort(compareCollisionCandidates);
    ordered.forEach((candidate, index) => {
      const expected =
        index === 0
          ? proposedSemanticId
          : repairedSemanticIdForComparator(
              proposedSemanticId,
              candidate.actorId,
              candidate.commitId,
              candidate.creationId
            );
      if (candidate.semanticId !== expected) errors.push('collision repair semantic ID invalid');
    });
  }
  for (const candidate of snapshot.collisionCandidates) {
    const liveRecord = liveRecords.find((record) => record.creationId === candidate.creationId);
    if (
      !liveRecord ||
      liveRecord.semanticId !== candidate.semanticId ||
      liveRecord.proposedSemanticId !== candidate.proposedSemanticId ||
      liveRecord.actorId !== candidate.actorId ||
      liveRecord.commitId !== candidate.commitId ||
      repairedIds.has(candidate.semanticId)
    ) {
      errors.push('collision candidate reference or semantic ID invalid');
    }
    repairedIds.add(candidate.semanticId);
  }
  const liveByProposed = new Map<string, ProvenancedRecord[]>();
  for (const record of liveRecords) {
    const group = liveByProposed.get(record.proposedSemanticId) ?? [];
    group.push(record);
    liveByProposed.set(record.proposedSemanticId, group);
  }
  for (const records of liveByProposed.values()) {
    for (const record of records) {
      const isCollision = records.length > 1;
      if (
        (isCollision && !candidateCreationIds.has(record.creationId)) ||
        (!isCollision && record.semanticId !== record.proposedSemanticId)
      ) {
        errors.push('live record collision provenance incomplete');
      }
    }
  }
  validateProvenance(snapshot.tombstones, errors);
  const tombstoneIds = new Set<string>();
  const tombstoneSemanticIds = new Set<string>();
  for (const tombstone of snapshot.tombstones) {
    if (
      tombstone.deleted !== true ||
      !['story', 'block', 'text', 'mark', 'capsule'].includes(tombstone.recordKind) ||
      liveCreationIds.has(tombstone.creationId) ||
      tombstoneIds.has(tombstone.creationId) ||
      liveSemanticIds.has(tombstone.semanticId) ||
      tombstoneSemanticIds.has(tombstone.semanticId)
    ) {
      errors.push('tombstone must be unique, deleted, and absent from live records');
    }
    tombstoneIds.add(tombstone.creationId);
    tombstoneSemanticIds.add(tombstone.semanticId);
  }
  return errors;
}

function validateProvenance(records: readonly ProvenancedRecord[], errors: string[]): void {
  for (const record of records) {
    const creation = parseCreationId(record?.creationId);
    const commitSeq = parseCommitId(record?.commitId);
    if (
      typeof record?.creationId !== 'string' ||
      record.creationId.length === 0 ||
      typeof record.semanticId !== 'string' ||
      record.semanticId.length === 0 ||
      typeof record.proposedSemanticId !== 'string' ||
      record.proposedSemanticId.length === 0 ||
      typeof record.actorId !== 'string' ||
      record.actorId.length === 0 ||
      typeof record.commitId !== 'string' ||
      record.commitId.length === 0 ||
      !creation ||
      creation.actorId !== record.actorId ||
      commitSeq === null ||
      commitSeq !== creation.commitSeq
    ) {
      errors.push('record semantic identity or provenance invalid');
    }
  }
}

function validateExactRecordShapes(snapshot: DecodedYjsModel, errors: string[]): void {
  const provenance = ['creationId', 'semanticId', 'proposedSemanticId', 'actorId', 'commitId'];
  const checks: [readonly Record<string, unknown>[], readonly string[], string][] = [
    [
      snapshot.stories,
      [...provenance, 'containerType', 'storyKind', 'blockOrderContainerType', 'blockOrder'],
      'story',
    ],
    [
      snapshot.blocks,
      [
        ...provenance,
        'storyId',
        'parentId',
        'containerType',
        'blockKind',
        'paragraphId',
        'proposedParagraphId',
        'textId',
        'markIdsContainerType',
        'markIds',
        'capsuleIdsContainerType',
        'capsuleIds',
        'styleId',
        'authoredProperties',
      ],
      'block',
    ],
    [
      snapshot.marks,
      [...provenance, 'containerType', 'parentTextId', 'markKind', 'start', 'end'],
      'mark',
    ],
    [
      snapshot.capsules,
      [
        ...provenance,
        'containerType',
        'ownerStoryId',
        'ownerBlockId',
        'parentBlockId',
        'childIndex',
        'byteBoundaryStart',
        'byteBoundaryEnd',
        'bytesHex',
        'namespaceBindings',
        'previousSiblingBytesHex',
        'nextSiblingBytesHex',
      ],
      'capsule',
    ],
    [
      snapshot.collisionCandidates,
      ['creationId', 'semanticId', 'proposedSemanticId', 'actorId', 'commitId'],
      'collision candidate',
    ],
    [snapshot.tombstones, [...provenance, 'recordKind', 'deleted'], 'tombstone'],
    [
      snapshot.allocator,
      [
        'containerType',
        'actorId',
        'nextLocalSeq',
        'nextCommitSeq',
        'observedSemanticIdsContainerType',
        'observedSemanticIds',
      ],
      'allocator',
    ],
  ];
  for (const [records, expectedKeys, label] of checks) {
    for (const record of records) {
      if (!sameStrings(Object.keys(record), expectedKeys)) {
        errors.push(`${label} record fields mismatch frozen schema`);
      }
    }
  }
  const textBaseKeys = [
    'creationId',
    'semanticId',
    'proposedSemanticId',
    'actorId',
    'commitId',
    'parentBlockId',
    'containerType',
    'contentContainerType',
    'content',
  ];
  const textOptionalKeys = [
    'structuralSplitOffset',
    'structuralOriginalTail',
    'authoredContributions',
  ];
  for (const record of snapshot.texts) {
    const keys = Object.keys(record);
    const allowed = new Set([...textBaseKeys, ...textOptionalKeys]);
    if (
      !keys.every((key) => allowed.has(key)) ||
      !textBaseKeys.every((key) => keys.includes(key))
    ) {
      errors.push('text record fields mismatch frozen schema');
    }
  }
}

function validateAllocator(snapshot: DecodedYjsModel, errors: string[]): void {
  const allocator = snapshot.allocator;
  const actorIds = new Set<string>();
  let previousActorId: string | undefined;
  for (const record of allocator) {
    if (
      record.containerType !== 'Y.Map' ||
      record.observedSemanticIdsContainerType !== 'Y.Map' ||
      typeof record.actorId !== 'string' ||
      record.actorId.length === 0 ||
      record.actorId.includes(':') ||
      actorIds.has(record.actorId) ||
      (previousActorId !== undefined && codeUnitCompare(previousActorId, record.actorId) >= 0) ||
      !Number.isSafeInteger(record.nextLocalSeq) ||
      record.nextLocalSeq < 0 ||
      !Number.isSafeInteger(record.nextCommitSeq) ||
      record.nextCommitSeq < 0 ||
      hasDuplicates(record.observedSemanticIds) ||
      record.observedSemanticIds.some((id) => typeof id !== 'string' || id.length === 0) ||
      record.observedSemanticIds.some(
        (id, index) => index > 0 && codeUnitCompare(record.observedSemanticIds[index - 1]!, id) >= 0
      )
    ) {
      errors.push('allocator actor record invalid');
    }
    actorIds.add(record.actorId);
    previousActorId = record.actorId;
  }
  if (allocator.length === 0) errors.push('allocator must contain at least one actor record');

  const observedRecords: ProvenancedRecord[] = [
    ...snapshot.stories,
    ...snapshot.blocks,
    ...snapshot.texts,
    ...snapshot.marks,
    ...snapshot.capsules,
    ...snapshot.collisionCandidates,
    ...snapshot.tombstones,
  ];
  const requirements = new Map<
    string,
    { maxCommitSeq: number; maxLocalSeq: number; semanticIds: Set<string> }
  >();
  for (const observed of observedRecords) {
    const creation = parseCreationId(observed.creationId);
    const commitSeq = parseCommitId(observed.commitId);
    if (!creation || creation.actorId !== observed.actorId || commitSeq === null) continue;
    const requirement = requirements.get(observed.actorId) ?? {
      maxCommitSeq: -1,
      maxLocalSeq: -1,
      semanticIds: new Set<string>(),
    };
    requirement.maxCommitSeq = Math.max(requirement.maxCommitSeq, creation.commitSeq, commitSeq);
    requirement.maxLocalSeq = Math.max(requirement.maxLocalSeq, creation.localSeq);
    requirement.semanticIds.add(observed.proposedSemanticId);
    requirement.semanticIds.add(observed.semanticId);
    requirements.set(observed.actorId, requirement);
  }
  for (const text of snapshot.texts) {
    for (const event of text.authoredContributions ?? []) {
      const creation = parseCreationId(event.creationId);
      if (!creation) continue;
      const requirement = requirements.get(creation.actorId) ?? {
        maxCommitSeq: -1,
        maxLocalSeq: -1,
        semanticIds: new Set<string>(),
      };
      requirement.maxCommitSeq = Math.max(
        requirement.maxCommitSeq,
        creation.commitSeq,
        parseCommitId(event.commitId) ?? -1
      );
      requirement.maxLocalSeq = Math.max(requirement.maxLocalSeq, creation.localSeq);
      requirements.set(creation.actorId, requirement);
    }
  }
  for (const [actorId, requirement] of requirements) {
    const actorAllocator = allocator.find((record) => record.actorId === actorId);
    if (
      !actorAllocator ||
      actorAllocator.nextCommitSeq <= requirement.maxCommitSeq ||
      actorAllocator.nextLocalSeq <= requirement.maxLocalSeq ||
      [...requirement.semanticIds].some(
        (semanticId) => !actorAllocator.observedSemanticIds.includes(semanticId)
      )
    ) {
      errors.push(`allocator does not safely cover actor ${actorId}`);
    }
  }
}

function parseCreationId(
  value: unknown
): { actorId: string; commitSeq: number; localSeq: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^([^:]+):(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const commitSeq = Number(match[2]);
  const localSeq = Number(match[3]);
  if (!Number.isSafeInteger(commitSeq) || !Number.isSafeInteger(localSeq)) return null;
  return { actorId: match[1]!, commitSeq, localSeq };
}

function creationLocalSeq(creationId: string): number {
  return parseCreationId(creationId)?.localSeq ?? Number.MAX_SAFE_INTEGER;
}

function repairedSemanticIdForComparator(
  proposedSemanticId: string,
  actorId: string,
  commitId: string,
  creationId: string
): string {
  const candidate = `${proposedSemanticId}-collision-${actorId}-${commitId}-${creationLocalSeq(
    creationId
  )}`;
  if (/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(candidate)) return candidate;
  const hash = new Bun.CryptoHasher('sha256')
    .update(`${proposedSemanticId}\u0000${actorId}\u0000${commitId}\u0000${creationId}`)
    .digest('hex');
  return `derived-${hash.slice(0, 40)}`;
}

function parseCommitId(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^commit-(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) ? sequence : null;
}

function compareCollisionCandidates(
  a: DecodedYjsModel['collisionCandidates'][number],
  b: DecodedYjsModel['collisionCandidates'][number]
): number {
  return (
    codeUnitCompare(a.actorId, b.actorId) ||
    codeUnitCompare(a.commitId, b.commitId) ||
    creationLocalSeq(a.creationId) - creationLocalSeq(b.creationId) ||
    codeUnitCompare(a.creationId, b.creationId)
  );
}

function isCanonicalBase64Url(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    /^[A-Za-z0-9_-]+$/.test(value) &&
    Buffer.from(value, 'base64url').toString('base64url') === value
  );
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return (
    a.length === b.length &&
    [...a]
      .sort(codeUnitCompare)
      .every((value, index) => value === [...b].sort(codeUnitCompare)[index])
  );
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function fingerprintYjsSchema(snapshot: DecodedYjsModel): string {
  const errors = validateDecodedYjsModel(snapshot);
  if (errors.length > 0) throw new TypeError(errors.join('; '));
  return sha256Hex(canonicalJson(snapshot));
}

export function compareYjsSchema(
  a: DecodedYjsModel,
  b: DecodedYjsModel
): { equal: boolean; errors: readonly string[] } {
  const errors = [...validateDecodedYjsModel(a), ...validateDecodedYjsModel(b)];
  return {
    equal: errors.length === 0 && fingerprintYjsSchema(a) === fingerprintYjsSchema(b),
    errors,
  };
}

export const YJS_SCHEMA_FINGERPRINT_COMPARATOR_VERSION = '5.0.0';
