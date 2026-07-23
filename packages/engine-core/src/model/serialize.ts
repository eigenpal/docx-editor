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
    ...(hasPreservation ? { preservation: { originalParts: [...p!.originalParts], blockRanges: [...p!.blockRanges] } } : {}),
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
  // Reject orphan ranges that point at a part we do not retain — they can never
  // resolve on serialize.
  for (const [blockId, range] of blockRanges) {
    if (!originalParts.has(range.partName)) {
      throw new Error(`preservation range for block ${blockId} references unknown part ${range.partName}`);
    }
  }
  return { ...base, preservation: { originalParts, blockRanges } };
}
