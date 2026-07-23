// Model-shaped state serialization (document-engine tasks 5.1, 5.6). Converts a
// PackageModel to/from a JSON-safe shape (Maps become ordered arrays) for
// snapshots and persistence. This is authored-model state, NOT DOCX bytes — the
// OOXML serializer is task 3.6 and library-gated.

import {
  type PackageModel,
  type Story,
  type PartRecord,
  type StyleRecord,
  type NumberingRecord,
  type IdentityState,
  type BlockRange,
} from './authored-model.ts';
import type { RelationshipRecord } from '../package/index.ts';
import type { ContentTypeRecords } from '../package/index.ts';
import { bytesToHex, hexToBytes } from '../util/hex.ts';

export interface SerializedModel {
  readonly contentTypes: ContentTypeRecords;
  readonly relationships: readonly RelationshipRecord[];
  readonly stories: readonly Story[];
  readonly styles: readonly StyleRecord[];
  readonly numbering: readonly NumberingRecord[];
  readonly parts: readonly PartRecord[];
  readonly identity: IdentityState;
  /** Snapshot form of PreservationState (Maps -> ordered pair arrays). Omitted when empty. */
  readonly preservation?: {
    readonly originalParts: readonly (readonly [string, string])[];
    readonly blockRanges: readonly (readonly [string, BlockRange])[];
    /** [partName, hex-encoded bytes] for the verbatim package parts. */
    readonly packageParts?: readonly (readonly [string, string])[];
  };
}

export function encodeModel(model: PackageModel): SerializedModel {
  const p = model.preservation;
  const hasPreservation = p && (p.originalParts.size > 0 || p.blockRanges.size > 0);
  return {
    contentTypes: model.contentTypes,
    relationships: model.relationships,
    stories: [...model.stories.values()],
    styles: model.styles,
    numbering: model.numbering,
    parts: [...model.parts.values()],
    identity: model.identity,
    ...(hasPreservation
      ? {
          preservation: {
            originalParts: [...p!.originalParts],
            blockRanges: [...p!.blockRanges],
            ...(p!.packageParts && p!.packageParts.size > 0
              ? { packageParts: [...p!.packageParts].map(([name, bytes]) => [name, bytesToHex(bytes)] as const) }
              : {}),
          },
        }
      : {}),
  };
}

/** Build a Map from pairs, rejecting duplicate keys (silent overwrite would lose data). */
function mapFromPairs<V>(pairs: readonly (readonly [string, V])[], what: string): Map<string, V> {
  const out = new Map<string, V>();
  for (const [k, v] of pairs) {
    if (out.has(k)) throw new Error(`duplicate ${what} key on decode: ${k}`);
    out.set(k, v);
  }
  return out;
}

export function decodeModel(s: SerializedModel): PackageModel {
  const base = {
    contentTypes: s.contentTypes,
    relationships: s.relationships,
    stories: new Map(s.stories.map((story) => [story.id, story])),
    styles: s.styles,
    numbering: s.numbering,
    parts: new Map(s.parts.map((part) => [part.partName, part])),
    identity: s.identity,
  };
  if (!s.preservation) return base;
  const originalParts = mapFromPairs(s.preservation.originalParts, 'preservation part');
  const blockRanges = mapFromPairs(s.preservation.blockRanges, 'preservation block range');
  const packageParts = s.preservation.packageParts
    ? mapFromPairs(s.preservation.packageParts.map(([n, h]) => [n, hexToBytes(h)] as const), 'preservation package part')
    : undefined;
  const model: PackageModel = { ...base, preservation: { originalParts, blockRanges, ...(packageParts ? { packageParts } : {}) } };
  validatePreservation(model); // full validation on a restored snapshot, not just duplicates
  return model;
}

/**
 * Validate the preservation index: every range references a retained part and an
 * existing top-level block, offsets are integers with `0 <= start < end <= length`,
 * and ranges within one part do not overlap. Called on decode AND before serialize so
 * a tampered/stale snapshot can never splice XML into the wrong region.
 */
export function validatePreservation(model: PackageModel): void {
  const p = model.preservation;
  if (!p) return;
  const ids = new Set<string>();
  for (const story of model.stories.values()) for (const b of story.blocks) ids.add(b.id);
  const byPart = new Map<string, { start: number; end: number }[]>();
  for (const [blockId, r] of p.blockRanges) {
    const text = p.originalParts.get(r.partName);
    if (text === undefined) throw new Error(`preservation range for block ${blockId} references unknown part ${r.partName}`);
    if (!ids.has(blockId)) throw new Error(`preservation range references a missing block ${blockId}`);
    if (!Number.isInteger(r.start) || !Number.isInteger(r.end)) throw new Error(`non-integer preservation range for block ${blockId}`);
    if (!(r.start >= 0 && r.start < r.end && r.end <= text.length)) throw new Error(`out-of-bounds preservation range for block ${blockId}`);
    const list = byPart.get(r.partName) ?? [];
    list.push({ start: r.start, end: r.end });
    byPart.set(r.partName, list);
  }
  for (const list of byPart.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].start < list[i - 1].end) throw new Error('overlapping preservation ranges within one part');
    }
  }
}
