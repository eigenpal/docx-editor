/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Parts made on first use that a relationship still names after their directory entry went
 * away: comments and their companions, notes, and numbering.
 *
 * The part directory keys an entry by part name. Two peers that add the first comment, or the
 * first footnote, at the same time each create the part; one entry wins, and the other peer's
 * root keeps its content but no entry names it. When the winner then undoes its comment, its entry goes,
 * and the other peer's relationship names a part the directory no longer has. Its root is
 * still in shared state, so the view shows the part from that root, as every replica can
 * decide alike: of the roots no entry names, one with its namespace bindings, one that holds
 * content first, then the smallest ID.
 */
import {
  partNameKey,
  resolveContentType,
  resolveInternalTarget,
  type ContentTypeIndex,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { LogicalId } from './identity.ts';
import { rejectPartName } from './limits.ts';
import { isRelsPartName } from './materialize-rels.ts';
import type { DocumentRegistry } from './registry.ts';
import { isElementRecord, type EncodedRelationship, type PartDirectoryEntry } from './schema.ts';

const WORDPROCESSING = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

/** By the last segment of a relationship type: the part's root element and content type. */
const RESCUABLE: ReadonlyMap<string, { readonly root: string; readonly contentType: string }> =
  new Map(
    Object.entries({
      comments: { root: 'comments', contentType: `${WORDPROCESSING}.comments+xml` },
      commentsExtended: {
        root: 'commentsEx',
        contentType: `${WORDPROCESSING}.commentsExtended+xml`,
      },
      commentsIds: { root: 'commentsIds', contentType: `${WORDPROCESSING}.commentsIds+xml` },
      commentsExtensible: {
        root: 'commentsExtensible',
        contentType: `${WORDPROCESSING}.commentsExtensible+xml`,
      },
      people: { root: 'people', contentType: `${WORDPROCESSING}.people+xml` },
      footnotes: { root: 'footnotes', contentType: `${WORDPROCESSING}.footnotes+xml` },
      endnotes: { root: 'endnotes', contentType: `${WORDPROCESSING}.endnotes+xml` },
      numbering: { root: 'numbering', contentType: `${WORDPROCESSING}.numbering+xml` },
    })
  );

/** A part name a rescued part may take: an XML part that is not package plumbing. */
function rescuableName(partName: string): boolean {
  return (
    rejectPartName(partName) === null &&
    !isRelsPartName(partName) &&
    partName.toLowerCase() !== '/[content_types].xml' &&
    partName.toLowerCase().endsWith('.xml')
  );
}

export function rescuedPartEntries(
  registry: DocumentRegistry,
  entries: readonly PartDirectoryEntry[],
  relationships: Iterable<EncodedRelationship>
): PartDirectoryEntry[] {
  const names = new Set(entries.map((entry) => entry.name));
  const wanted: { readonly name: string; readonly root: string; readonly contentType: string }[] =
    [];
  for (const relationship of relationships) {
    if (relationship.targetMode === 'External' || !names.has(relationship.ownerPart)) continue;
    const spec = RESCUABLE.get(relationship.type.slice(relationship.type.lastIndexOf('/') + 1));
    if (!spec) continue;
    const target = resolveInternalTarget(relationship.ownerPart, relationship.rawTarget);
    // A rescued part takes only a name of its own kind: never a relationships part, the
    // content types, or a name the limits refuse, whatever a peer's relationship says.
    if (!target.ok || names.has(target.partName) || !rescuableName(target.partName)) continue;
    names.add(target.partName);
    wanted.push({ name: target.partName, ...spec });
  }
  if (wanted.length === 0) return [];
  const named = new Set(entries.map((entry) => entry.rootLogicalId));
  // One scan for every wanted part: a peer that plants many relationships costs one walk.
  const roots = new Set(wanted.map((part) => part.root));
  const candidates: { readonly id: LogicalId; readonly root: string; readonly empty: boolean }[] =
    [];
  for (const id of registry.allLogicalIds()) {
    if (named.has(id) || registry.isTombstoned(id) || registry.parentOf(id) !== null) continue;
    const record = registry.record(id);
    if (!record || !isElementRecord(record) || !roots.has(record.localName)) continue;
    // An undo leaves the root it took out without its bindings or children: never that one.
    if (!record.bindings.some((binding) => binding.prefix === (record.prefix ?? ''))) continue;
    candidates.push({ id, root: record.localName, empty: record.childIds.length === 0 });
  }
  const rescued: PartDirectoryEntry[] = [];
  for (const part of wanted) {
    // Of the roots left, one that holds content, then the smallest ID.
    let best: { id: LogicalId; empty: boolean } | null = null;
    for (const { id, root, empty } of candidates) {
      if (root !== part.root || named.has(id)) continue;
      if (best === null || (best.empty && !empty) || (best.empty === empty && id < best.id)) {
        best = { id, empty };
      }
    }
    if (best === null) continue;
    named.add(best.id);
    rescued.push({
      name: part.name,
      id: part.name,
      rootLogicalId: best.id,
      contentType: part.contentType,
    });
  }
  return rescued;
}

/**
 * Give each part the content type of its entry when the content type index does not type it.
 *
 * Two peers that create one part at once write one override key. The key keeps one writer,
 * and that writer's undo removes it while the other writer's part stays. Each part entry
 * carries its own type, so every replica can decide alike from the parts it shows.
 */
export function typeUntypedParts(
  parts: ReadonlyMap<string, OoxmlPart>,
  index: ContentTypeIndex,
  overrides: Map<string, string>
): void {
  for (const [name, part] of parts) {
    const resolved = resolveContentType(index, name);
    if (
      resolved.ok &&
      (resolved.source === 'override' || resolved.contentType === part.contentType)
    )
      continue;
    overrides.set(partNameKey(name), part.contentType);
  }
}
