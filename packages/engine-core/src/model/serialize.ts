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
  /** [blockId, verbatimXml] pairs for preserved blocks (tables). Omitted when empty. */
  readonly preservedXml?: readonly (readonly [string, string])[];
}

export function encodeModel(model: PackageModel): SerializedModel {
  return {
    contentTypes: model.contentTypes,
    relationships: model.relationships,
    stories: [...model.stories.values()],
    styles: model.styles,
    numbering: model.numbering,
    parts: [...model.parts.values()],
    identity: model.identity,
    ...(model.preservedXml && model.preservedXml.size > 0 ? { preservedXml: [...model.preservedXml] } : {}),
  };
}

export function decodeModel(s: SerializedModel): PackageModel {
  return {
    contentTypes: s.contentTypes,
    relationships: s.relationships,
    stories: new Map(s.stories.map((story) => [story.id, story])),
    styles: s.styles,
    numbering: s.numbering,
    parts: new Map(s.parts.map((part) => [part.partName, part])),
    identity: s.identity,
    ...(s.preservedXml ? { preservedXml: new Map(s.preservedXml) } : {}),
  };
}
