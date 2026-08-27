/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Package-level projections, cached across materialize passes.
//
// A pass that only moved node text still assembled the package from scratch: it decoded and
// sorted the whole relationship map twice, re-read every content-type entry, and rebuilt the
// part-bytes map from every binary descriptor. None of that can have changed unless package
// metadata changed, and the materializer already knows when it did — the same `packageChanged`
// flag that drives `.rels` projection. So everything here lives until a pass runs with that
// flag set, and a text-only remote keystroke performs zero relationship decodes.

import {
  buildRelationshipSet,
  resolveRelationship,
  type OoxmlExternalTarget,
  type RelationshipRecord,
} from '@docx-editor.dev/core/store';
import type { EncodedRelationship } from './schema.ts';
import type { DocumentRegistry } from './registry.ts';
import type { BlobBytesStore } from './seed.ts';
import { relationshipsByOwner } from './materialize-rels.ts';
import { mergeCustomXmlRelationships } from './materialize-custom-xml.ts';
import { countBlobBytes } from './materialize-freeze.ts';

/** The validated relationship projection a package embeds. `null` means a duplicate id. */
export interface RelationshipAssembly {
  readonly byOwner: ReadonlyMap<string, readonly RelationshipRecord[]>;
  readonly externalTargets: readonly OoxmlExternalTarget[];
}

export class PackageProjectionCache {
  private decoded: readonly EncodedRelationship[] | null = null;
  private merged: {
    readonly custom: readonly EncodedRelationship[];
    readonly records: readonly EncodedRelationship[];
  } | null = null;
  private grouped: {
    readonly records: readonly EncodedRelationship[];
    readonly map: Map<string, EncodedRelationship[]>;
  } | null = null;
  private assembly: {
    readonly records: readonly EncodedRelationship[];
    readonly value: RelationshipAssembly | null;
  } | null = null;
  private defaults: ReadonlyMap<string, string> | null = null;
  private overrides: ReadonlyMap<string, string> | null = null;
  private partBytes: Map<string, Uint8Array> | null = null;
  /** Media payload per storage key, with the digest it was read for. Survives invalidation. */
  private readonly blobBytes = new Map<string, { digest: string; bytes: Uint8Array }>();

  constructor(private readonly registry: DocumentRegistry) {}

  /** Drop every projection of package metadata. Blob payloads stay; digests vouch for them. */
  invalidate(): void {
    this.decoded = null;
    this.merged = null;
    this.grouped = null;
    this.assembly = null;
    this.defaults = null;
    this.overrides = null;
    this.partBytes = null;
  }

  /** The replicated relationships with the customXml repair folded in, decoded at most once. */
  projected(custom: readonly EncodedRelationship[]): readonly EncodedRelationship[] {
    if (!this.decoded) {
      this.decoded = this.registry.relationships();
      this.merged = null;
    }
    // `grouped` and `assembly` key on the record array's identity themselves, so a pass that
    // hands in a fresh empty `custom` array keeps them: the merged records stay `decoded`.
    if (!this.merged || this.merged.custom !== custom) {
      this.merged = {
        custom,
        records:
          custom.length === 0 ? this.decoded : mergeCustomXmlRelationships(this.decoded, custom),
      };
    }
    return this.merged.records;
  }

  groupedByOwner(custom: readonly EncodedRelationship[]): Map<string, EncodedRelationship[]> {
    const records = this.projected(custom);
    if (!this.grouped || this.grouped.records !== records) {
      this.grouped = { records, map: relationshipsByOwner(records) };
    }
    return this.grouped.map;
  }

  relationshipAssembly(custom: readonly EncodedRelationship[]): RelationshipAssembly | null {
    const records = this.projected(custom);
    if (!this.assembly || this.assembly.records !== records) {
      this.assembly = { records, value: assembleRelationships(records as RelationshipRecord[]) };
    }
    return this.assembly.value;
  }

  contentTypeDefaults(): ReadonlyMap<string, string> {
    return (this.defaults ??= this.registry.contentTypeDefaults());
  }

  contentTypeOverrides(): ReadonlyMap<string, string> {
    return (this.overrides ??= this.registry.contentTypeOverrides());
  }

  /**
   * Media bytes for every binary part, keyed the way the package wants them.
   *
   * The blob store returns a defensive copy on every read, and a descriptor names its bytes
   * by content digest — so a descriptor whose digest is unchanged names bytes this cache
   * already holds. Re-reading them would copy every image in the document to learn they are
   * the same images, on every pass, which is to say on every received character. The map
   * itself is reused across passes too, until a package write invalidates it: no descriptor
   * can change without one.
   */
  resolvePartBytes(blobs: BlobBytesStore): Map<string, Uint8Array> | null {
    if (this.partBytes) return this.partBytes;
    const partBytes = new Map<string, Uint8Array>();
    const live = new Set<string>();
    for (const descriptor of this.registry.binaries()) {
      live.add(descriptor.storageKey);
      const held = this.blobBytes.get(descriptor.storageKey);
      if (held && held.digest === descriptor.digest) {
        partBytes.set(descriptor.storageKey, held.bytes);
        continue;
      }
      const bytes = blobs.get(descriptor.digest);
      if (!bytes) return null;
      countBlobBytes(bytes.length);
      this.blobBytes.set(descriptor.storageKey, { digest: descriptor.digest, bytes });
      partBytes.set(descriptor.storageKey, bytes);
    }
    for (const key of [...this.blobBytes.keys()]) {
      if (!live.has(key)) this.blobBytes.delete(key);
    }
    this.partBytes = partBytes;
    return partBytes;
  }
}

function assembleRelationships(
  records: readonly RelationshipRecord[]
): RelationshipAssembly | null {
  const set = buildRelationshipSet(records);
  if (!set.ok) return null;
  const externalTargets: OoxmlExternalTarget[] = [];
  for (const record of records) {
    const resolved = resolveRelationship(record);
    if (resolved.mode === 'External') {
      externalTargets.push({
        ownerPart: record.ownerPart,
        id: record.id,
        type: record.type,
        rawTarget: record.rawTarget,
        sinkSafe: resolved.sinkSafe.ok,
      });
    }
  }
  return { byOwner: set.byOwner, externalTargets: Object.freeze(externalTargets) };
}
