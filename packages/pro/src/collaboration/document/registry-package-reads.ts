/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The package directory, read out of shared state.
 *
 * Parts, content-type overrides and defaults, and binary descriptors are plain projections of
 * one `Y.Map` each. They hold no derived index and touch nothing else in the registry.
 */

import type * as Y from 'yjs';
import type { CanonicalBinaryDescriptor } from '@docx-editor.dev/core/collaboration';
import { partNameKey } from '@docx-editor.dev/core/store';
import { rejectDangerousKey } from './limits.ts';
import { isNodeMap, type PartDirectoryEntry } from './schema.ts';

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Every named XML part, in name order. */
export function readPartEntries(parts: Y.Map<Y.Map<unknown>>): readonly PartDirectoryEntry[] {
  const entries: PartDirectoryEntry[] = [];
  parts.forEach((value, name) => {
    if (!isNodeMap(value) || rejectDangerousKey(name)) return;
    const rootLogicalId = readString(value.get('rootId'));
    if (rootLogicalId.length === 0) return;
    entries.push({
      name,
      id: readString(value.get('id')),
      rootLogicalId,
      contentType: readString(value.get('contentType')),
    });
  });
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return entries;
}

export function readContentTypeOverrides(overrides: Y.Map<string>): ReadonlyMap<string, string> {
  const read = new Map<string, string>();
  overrides.forEach((mediaType, partName) => {
    if (typeof mediaType === 'string' && !rejectDangerousKey(partName)) {
      // Journals captured the authored spelling (`/customXml/itemProps1.xml`).
      // Resolution looks up the OPC-folded key; keep the index that way.
      read.set(partNameKey(partName), mediaType);
    }
  });
  return read;
}

export function readContentTypeDefaults(defaults: Y.Map<string>): ReadonlyMap<string, string> {
  const read = new Map<string, string>();
  defaults.forEach((mediaType, extension) => {
    if (typeof mediaType === 'string' && !rejectDangerousKey(extension)) {
      read.set(extension, mediaType);
    }
  });
  return read;
}

export function readBinaries(
  binaries: Y.Map<Y.Map<unknown>>
): readonly CanonicalBinaryDescriptor[] {
  const descriptors: CanonicalBinaryDescriptor[] = [];
  binaries.forEach((value, storageKey) => {
    if (!isNodeMap(value) || rejectDangerousKey(storageKey)) return;
    const digest = readString(value.get('digest'));
    const size = value.get('size');
    const mediaType = readString(value.get('mediaType'));
    const key = readString(value.get('storageKey')) || storageKey;
    if (digest.length === 0 || typeof size !== 'number') return;
    descriptors.push({ digest, size, mediaType, storageKey: key });
  });
  return descriptors;
}
