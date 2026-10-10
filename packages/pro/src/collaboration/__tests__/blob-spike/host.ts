/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import {
  BLOBS_MAP_KEY,
  describeBytes,
  encodeDescriptor,
  MISSING_RETRY_LIMIT,
  parseDescriptor,
  type BlobDescriptor,
  type BlobIssueCode,
  type DescriptorPin,
  type PinReason,
  type EmptySpikeResult,
  type SpikeResult,
  validateDescriptor,
  validatePartName,
} from './contract.ts';
import { BlobStore } from './store.ts';

export interface CheckpointRecord {
  readonly checkpointId: string;
  readonly roomId: string;
  readonly generationId: string;
  readonly snapshot: Uint8Array;
  readonly requiredDigests: readonly string[];
  readonly lastValidCanonicalId: string | null;
}

export interface OfflineFrame {
  readonly frameId: string;
  readonly roomId: string;
  readonly generationId: string;
  readonly sequence: number;
  readonly update: Uint8Array;
  readonly requiredDigests: readonly string[];
  status: 'buffered' | 'acked' | 'nacked';
}

export interface Proposal {
  readonly proposalId: string;
  readonly roomId: string;
  readonly generationId: string;
  readonly partName: string;
  readonly descriptor: BlobDescriptor;
  readonly leaseId: string;
  readonly update: Uint8Array;
}

interface Generation {
  readonly generationId: string;
  readonly doc: Y.Doc;
  retained: boolean;
}

interface RoomState {
  readonly roomId: string;
  activeGenerationId: string;
  readonly generations: Map<string, Generation>;
  readonly checkpoints: Map<string, CheckpointRecord>;
  readonly frames: Map<string, OfflineFrame>;
  readonly proposals: Map<string, Proposal>;
  lastValidCanonicalId: string | null;
  quarantine: { code: BlobIssueCode; digest: string } | null;
  readonly missingRetries: Map<string, number>;
  generationSeq: number;
  checkpointSeq: number;
  frameSeq: number;
  proposalSeq: number;
}

export class BlobHost {
  now = 0;
  collectHook: ((digest: string) => void) | null = null;
  private readonly rooms = new Map<string, RoomState>();

  constructor(readonly store: BlobStore) {}

  createRoom(roomId: string): string {
    const generationId = `${roomId}:g1`;
    const doc = new Y.Doc();
    doc.getMap(BLOBS_MAP_KEY);
    const room: RoomState = {
      roomId,
      activeGenerationId: generationId,
      generations: new Map([[generationId, { generationId, doc, retained: false }]]),
      checkpoints: new Map(),
      frames: new Map(),
      proposals: new Map(),
      lastValidCanonicalId: `${generationId}:canonical-0`,
      quarantine: null,
      missingRetries: new Map(),
      generationSeq: 1,
      checkpointSeq: 0,
      frameSeq: 0,
      proposalSeq: 0,
    };
    this.rooms.set(roomId, room);
    return generationId;
  }

  activeDoc(roomId: string): Y.Doc {
    return this.activeGeneration(this.room(roomId)).doc;
  }

  proposeBlobRef(input: {
    readonly roomId: string;
    readonly generationId: string;
    readonly partName: string;
    readonly descriptor: BlobDescriptor;
    readonly leaseId: string;
    readonly update: Uint8Array;
  }): SpikeResult<{ proposalId: string }> {
    const room = this.room(input.roomId);
    if (input.generationId !== room.activeGenerationId) {
      return { ok: false, code: 'wrong-generation' };
    }
    const part = validatePartName(input.partName);
    if (!part.ok) return part;
    const valid = validateDescriptor(input.descriptor);
    if (!valid.ok) return valid;
    const lease = this.store.lease(input.leaseId, this.now);
    if (!lease || lease.digest !== input.descriptor.digest) {
      return { ok: false, code: 'lease-expired' };
    }
    if (!this.store.isVerified(input.descriptor.digest)) {
      return { ok: false, code: 'unverified-blob-reference' };
    }
    const candidate = this.isolatedApply(room, input.update);
    try {
      const introduced = readDescriptors(candidate);
      if (!introduced.ok) return introduced;
      const parsed = introduced.descriptors.get(input.partName);
      if (!parsed || parsed.digest !== input.descriptor.digest) {
        return { ok: false, code: 'invalid-blob-descriptor' };
      }
      for (const descriptor of introduced.descriptors.values()) {
        if (!this.store.isVerified(descriptor.digest)) {
          return { ok: false, code: 'unverified-blob-reference' };
        }
      }
    } finally {
      candidate.destroy();
    }
    room.proposalSeq += 1;
    const proposalId = `${input.roomId}:p${room.proposalSeq}`;
    room.proposals.set(proposalId, { ...input, proposalId });
    return { ok: true, proposalId };
  }

  persistProposal(proposalId: string, roomId: string): SpikeResult<{ canonicalId: string }> {
    const room = this.room(roomId);
    const proposal = room.proposals.get(proposalId);
    if (!proposal) return { ok: false, code: 'unverified-blob-reference' };
    if (proposal.generationId !== room.activeGenerationId) {
      return { ok: false, code: 'wrong-generation' };
    }
    if (!this.store.isVerified(proposal.descriptor.digest)) {
      return { ok: false, code: 'unverified-blob-reference' };
    }
    const generation = this.activeGeneration(room);
    Y.applyUpdate(generation.doc, proposal.update, 'persist');
    room.proposals.delete(proposalId);
    room.lastValidCanonicalId = `${generation.generationId}:canonical-${generation.doc.clientID}`;
    room.quarantine = null;
    return { ok: true, canonicalId: room.lastValidCanonicalId };
  }

  abandonProposal(proposalId: string, roomId: string): void {
    this.room(roomId).proposals.delete(proposalId);
  }

  removeBlobRef(roomId: string, partName: string): void {
    const doc = this.activeGeneration(this.room(roomId)).doc;
    doc.transact(() => {
      doc.getMap(BLOBS_MAP_KEY).delete(partName);
    }, 'remove-ref');
  }

  replaceGeneration(roomId: string): string {
    const room = this.room(roomId);
    const previous = this.activeGeneration(room);
    previous.retained = true;
    room.generationSeq += 1;
    const generationId = `${roomId}:g${room.generationSeq}`;
    const doc = new Y.Doc();
    doc.getMap(BLOBS_MAP_KEY);
    room.generations.set(generationId, { generationId, doc, retained: false });
    room.activeGenerationId = generationId;
    room.lastValidCanonicalId = `${generationId}:canonical-0`;
    room.quarantine = null;
    return generationId;
  }

  discardGeneration(roomId: string, generationId: string): EmptySpikeResult {
    const room = this.room(roomId);
    if (generationId === room.activeGenerationId) {
      return { ok: false, code: 'wrong-generation' };
    }
    const generation = room.generations.get(generationId);
    if (!generation) return { ok: false, code: 'wrong-generation' };
    generation.doc.destroy();
    room.generations.delete(generationId);
    return { ok: true };
  }

  checkpoint(roomId: string): CheckpointRecord {
    const room = this.room(roomId);
    const generation = this.activeGeneration(room);
    room.checkpointSeq += 1;
    const checkpointId = `${roomId}:cp${room.checkpointSeq}`;
    const record: CheckpointRecord = {
      checkpointId,
      roomId,
      generationId: generation.generationId,
      snapshot: Y.encodeStateAsUpdate(generation.doc),
      requiredDigests: requiredDigestsOf(generation.doc),
      lastValidCanonicalId: room.lastValidCanonicalId,
    };
    room.checkpoints.set(checkpointId, record);
    return record;
  }

  restoreCheckpoint(roomId: string, checkpointId: string): SpikeResult<{ generationId: string }> {
    const room = this.room(roomId);
    const record = room.checkpoints.get(checkpointId);
    if (!record) return { ok: false, code: 'checkpoint-blob-missing' };
    for (const digest of record.requiredDigests) {
      const got = this.store.get(digest);
      if (!got.ok || got.state !== 'visible') {
        return { ok: false, code: 'checkpoint-blob-missing' };
      }
    }
    const previous = this.activeGeneration(room);
    previous.retained = true;
    room.generationSeq += 1;
    const generationId = `${roomId}:g${room.generationSeq}`;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, record.snapshot, 'restore');
    room.generations.set(generationId, { generationId, doc, retained: false });
    room.activeGenerationId = generationId;
    room.lastValidCanonicalId = record.lastValidCanonicalId;
    room.quarantine = null;
    return { ok: true, generationId };
  }

  bufferOfflineFrame(input: {
    readonly roomId: string;
    readonly generationId: string;
    readonly update: Uint8Array;
  }): SpikeResult<{ frameId: string; requiredDigests: readonly string[] }> {
    const room = this.room(input.roomId);
    if (input.generationId !== room.activeGenerationId) {
      return { ok: false, code: 'wrong-generation' };
    }
    const candidate = this.isolatedApply(room, input.update);
    try {
      const parsed = readDescriptors(candidate);
      if (!parsed.ok) return parsed;
      const requiredDigests = [
        ...new Set([...parsed.descriptors.values()].map((row) => row.digest)),
      ];
      for (const digest of requiredDigests) {
        if (!this.store.isVerified(digest)) {
          return { ok: false, code: 'unverified-blob-reference' };
        }
      }
      room.frameSeq += 1;
      const frameId = `${input.roomId}:f${room.frameSeq}`;
      room.frames.set(frameId, {
        frameId,
        roomId: input.roomId,
        generationId: input.generationId,
        sequence: room.frameSeq,
        update: input.update,
        requiredDigests,
        status: 'buffered',
      });
      return { ok: true, frameId, requiredDigests };
    } finally {
      candidate.destroy();
    }
  }

  ackFrame(roomId: string, frameId: string): SpikeResult<{ canonicalId: string }> {
    const room = this.room(roomId);
    const frame = room.frames.get(frameId);
    if (!frame || frame.status !== 'buffered') {
      return { ok: false, code: 'unverified-blob-reference' };
    }
    if (frame.generationId !== room.activeGenerationId) {
      return { ok: false, code: 'wrong-generation' };
    }
    Y.applyUpdate(this.activeGeneration(room).doc, frame.update, 'offline-ack');
    frame.status = 'acked';
    room.lastValidCanonicalId = `${room.activeGenerationId}:canonical-offline`;
    return { ok: true, canonicalId: room.lastValidCanonicalId };
  }

  nackFrame(roomId: string, frameId: string): void {
    const frame = this.room(roomId).frames.get(frameId);
    if (frame) frame.status = 'nacked';
  }

  deleteRoom(roomId: string, keepCheckpoints: boolean): CheckpointRecord[] {
    const room = this.room(roomId);
    const kept = keepCheckpoints ? [...room.checkpoints.values()] : [];
    for (const generation of room.generations.values()) generation.doc.destroy();
    this.rooms.delete(roomId);
    if (keepCheckpoints) {
      const shell = this.ensureDeletedRoomShell(roomId);
      for (const checkpoint of kept) shell.checkpoints.set(checkpoint.checkpointId, checkpoint);
    }
    return kept;
  }

  materialize(roomId: string): SpikeResult<{
    blobs: ReadonlyMap<string, Uint8Array>;
    canonicalId: string;
  }> {
    const room = this.room(roomId);
    if (room.quarantine) {
      return { ok: false, code: room.quarantine.code };
    }
    const parsed = readDescriptors(this.activeGeneration(room).doc);
    if (!parsed.ok) return parsed;
    const blobs = new Map<string, Uint8Array>();
    for (const [partName, descriptor] of parsed.descriptors) {
      const got = this.store.get(descriptor.digest);
      if (got.ok && got.state === 'pending') {
        return { ok: false, code: 'blob-bytes-pending' };
      }
      if (!got.ok || got.state !== 'visible') {
        const retries = (room.missingRetries.get(descriptor.digest) ?? 0) + 1;
        room.missingRetries.set(descriptor.digest, retries);
        if (retries >= MISSING_RETRY_LIMIT) {
          room.quarantine = { code: 'blob-bytes-missing', digest: descriptor.digest };
          return { ok: false, code: 'blob-bytes-missing' };
        }
        return { ok: false, code: 'blob-bytes-missing' };
      }
      if (got.blob.bytes.byteLength !== descriptor.size) {
        return { ok: false, code: 'size-mismatch' };
      }
      blobs.set(partName, got.blob.bytes);
      room.missingRetries.delete(descriptor.digest);
    }
    return { ok: true, blobs, canonicalId: room.lastValidCanonicalId ?? room.activeGenerationId };
  }

  restart(): void {
    for (const room of this.rooms.values()) room.proposals.clear();
  }

  destroy(): void {
    for (const room of this.rooms.values()) {
      for (const generation of room.generations.values()) generation.doc.destroy();
    }
    this.rooms.clear();
    this.collectHook = null;
  }

  pins(digest: string): readonly DescriptorPin[] {
    const pins: DescriptorPin[] = [];
    for (const lease of this.store.liveLeases(digest, this.now)) {
      pins.push({ digest, reason: 'lease', token: lease.leaseId });
    }
    for (const room of this.rooms.values()) {
      for (const proposal of room.proposals.values()) {
        if (
          proposal.descriptor.digest === digest &&
          proposal.generationId === room.activeGenerationId
        ) {
          pins.push({ digest, reason: 'pending-persist', token: proposal.proposalId });
        }
      }
      for (const generation of room.generations.values()) {
        const parsed = readDescriptors(generation.doc);
        if (!parsed.ok) continue;
        if (![...parsed.descriptors.values()].some((row) => row.digest === digest)) {
          continue;
        }
        const reason: PinReason =
          generation.generationId === room.activeGenerationId
            ? 'active-generation'
            : 'retained-generation';
        pins.push({ digest, reason, token: `${room.roomId}:${generation.generationId}` });
      }
      for (const checkpoint of room.checkpoints.values()) {
        if (checkpoint.requiredDigests.includes(digest)) {
          pins.push({ digest, reason: 'checkpoint', token: checkpoint.checkpointId });
        }
      }
      for (const frame of room.frames.values()) {
        if (frame.status === 'buffered' && frame.requiredDigests.includes(digest)) {
          pins.push({ digest, reason: 'offline-frame', token: frame.frameId });
        }
      }
    }
    return pins;
  }

  requiredDigests(): ReadonlySet<string> {
    const required = new Set<string>();
    for (const room of this.rooms.values()) {
      for (const proposal of room.proposals.values()) {
        if (proposal.generationId === room.activeGenerationId) {
          required.add(proposal.descriptor.digest);
        }
      }
      for (const generation of room.generations.values()) {
        const parsed = readDescriptors(generation.doc);
        if (!parsed.ok) continue;
        for (const descriptor of parsed.descriptors.values()) {
          required.add(descriptor.digest);
        }
      }
      for (const checkpoint of room.checkpoints.values()) {
        for (const digest of checkpoint.requiredDigests) required.add(digest);
      }
      for (const frame of room.frames.values()) {
        if (frame.status === 'buffered') {
          for (const digest of frame.requiredDigests) required.add(digest);
        }
      }
    }
    return required;
  }

  missingRequired(): readonly string[] {
    return [...this.requiredDigests()].filter((digest) => !this.store.hasBytes(digest));
  }

  collectGarbage(): readonly string[] {
    return this.store.collect(
      this.now,
      (digest) => this.requiredDigests().has(digest),
      this.collectHook ? { afterEligible: this.collectHook } : undefined
    );
  }

  room(roomId: string): RoomState {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`unknown room ${roomId}`);
    return room;
  }

  private activeGeneration(room: RoomState): Generation {
    const generation = room.generations.get(room.activeGenerationId);
    if (!generation) throw new Error(`missing active generation ${room.activeGenerationId}`);
    return generation;
  }

  private isolatedApply(room: RoomState, update: Uint8Array): Y.Doc {
    const candidate = new Y.Doc();
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.activeGeneration(room).doc), 'isolate');
    const pending = [...room.proposals.values()]
      .filter((proposal) => proposal.generationId === room.activeGenerationId)
      .sort((left, right) => left.proposalId.localeCompare(right.proposalId));
    for (const proposal of pending) {
      Y.applyUpdate(candidate, proposal.update, 'isolate');
    }
    Y.applyUpdate(candidate, update, 'isolate');
    return candidate;
  }

  private ensureDeletedRoomShell(roomId: string): RoomState {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    const shell: RoomState = {
      roomId,
      activeGenerationId: `${roomId}:deleted`,
      generations: new Map(),
      checkpoints: new Map(),
      frames: new Map(),
      proposals: new Map(),
      lastValidCanonicalId: null,
      quarantine: null,
      missingRetries: new Map(),
      generationSeq: 0,
      checkpointSeq: 0,
      frameSeq: 0,
      proposalSeq: 0,
    };
    this.rooms.set(roomId, shell);
    return shell;
  }
}

export function readDescriptors(
  doc: Y.Doc
): SpikeResult<{ descriptors: Map<string, BlobDescriptor> }> {
  const blobs = doc.getMap<string>(BLOBS_MAP_KEY);
  const descriptors = new Map<string, BlobDescriptor>();
  for (const [partName, raw] of blobs.entries()) {
    const part = validatePartName(partName);
    if (!part.ok) return part;
    const parsed = parseDescriptor(raw);
    if (!parsed.ok) return parsed;
    descriptors.set(partName, parsed.descriptor);
  }
  return { ok: true, descriptors };
}

export function descriptorsIn(doc: Y.Doc): Map<string, BlobDescriptor> {
  const parsed = readDescriptors(doc);
  return parsed.ok ? parsed.descriptors : new Map();
}

function requiredDigestsOf(doc: Y.Doc): readonly string[] {
  const parsed = readDescriptors(doc);
  if (!parsed.ok) return [];
  return [...parsed.descriptors.values()].map((row) => row.digest);
}

export function publishBlob(
  host: BlobHost,
  local: Y.Doc,
  input: {
    readonly roomId: string;
    readonly actorId: string;
    readonly partName: string;
    readonly bytes: Uint8Array;
    readonly mediaType: string;
  }
): SpikeResult<{
  descriptor: BlobDescriptor;
  leaseId: string;
  proposalId: string;
  update: Uint8Array;
}> {
  const descriptor = describeBytes(input.bytes, input.mediaType);
  const put = host.store.put(input.bytes, descriptor, input.actorId, host.now);
  if (!put.ok) return put;
  const update = commitLocalBlobRef(local, input.partName, put.descriptor);
  const proposed = host.proposeBlobRef({
    roomId: input.roomId,
    generationId: host.room(input.roomId).activeGenerationId,
    partName: input.partName,
    descriptor: put.descriptor,
    leaseId: put.lease.leaseId,
    update,
  });
  if (!proposed.ok) return proposed;
  return {
    ok: true,
    descriptor: put.descriptor,
    leaseId: put.lease.leaseId,
    proposalId: proposed.proposalId,
    update,
  };
}

export function commitLocalBlobRef(
  doc: Y.Doc,
  partName: string,
  descriptor: BlobDescriptor
): Uint8Array {
  const part = validatePartName(partName);
  if (!part.ok) throw new Error(part.code);
  let captured: Uint8Array | null = null;
  const listener = (update: Uint8Array) => {
    captured = update;
  };
  doc.on('update', listener);
  doc.transact(() => {
    doc.getMap(BLOBS_MAP_KEY).set(partName, encodeDescriptor(descriptor));
  }, 'local-blob-ref');
  doc.off('update', listener);
  if (!captured) throw new Error('no blob-ref update');
  return captured;
}

export function createConnectedClient(host: BlobHost, roomId: string, clientId: number): Y.Doc {
  const local = new Y.Doc();
  local.clientID = clientId;
  Y.applyUpdate(local, Y.encodeStateAsUpdate(host.activeDoc(roomId)), 'join');
  return local;
}
