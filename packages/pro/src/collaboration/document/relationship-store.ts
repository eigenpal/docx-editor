/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// How relationships are keyed in shared state, and how they are read back out.
//
// Keying by part alone meant two peers adding the FIRST relationship to one part both took the
// "create the owner map" branch, and a nested `Y.Map` at one key resolves last-writer-wins: the
// loser's map went away with its rId inside it, leaving a broken image or a dead hyperlink that
// no later edit could repair. Keying by part AND id means concurrent writers touch different
// keys and cannot collide at all.

import type * as Y from 'yjs';
import { FIELD_SEP, isNodeMap, type EncodedRelationship } from './schema.ts';
import { rejectDangerousKey } from './limits.ts';

type RelationshipMap = Y.Map<Y.Map<Y.Map<unknown>>>;

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** One shared key per relationship, so two peers adding the first one cannot collide. */
export function relationshipKey(ownerPart: string, relationshipId: string): string {
  return `${ownerPart}${FIELD_SEP}${relationshipId}`;
}

/** The owning part of a relationship key, tolerating a key an earlier build wrote. */
function ownerPartOfKey(key: string): string {
  const cut = key.indexOf(FIELD_SEP);
  return cut < 0 ? key : key.slice(0, cut);
}

/**
 * Every relationship in shared state, in an order both replicas agree on.
 *
 * Sorting on `order` alone leaves ties to Yjs map iteration, and a key's position there follows
 * the order THIS replica first saw it — so two peers would emit different `.rels` bytes for the
 * same state. Ties are reachable: peers adding a relationship to one part concurrently both
 * compute the same `order` from the same count.
 *
 * Reads a value holding one entry, which is what {@link relationshipKey} writes, and equally an
 * owner map holding many, which is what a peer on an earlier build wrote.
 */
export function readRelationships(map: RelationshipMap): readonly EncodedRelationship[] {
  const records: EncodedRelationship[] = [];
  map.forEach((holder, mapKey) => {
    if (!isNodeMap(holder) || rejectDangerousKey(mapKey)) return;
    holder.forEach((value) => {
      if (!isNodeMap(value)) return;
      const id = readString(value.get('id'));
      const type = readString(value.get('type'));
      if (id.length === 0 || type.length === 0) return;
      const ownerPart = readString(value.get('ownerPart')) || ownerPartOfKey(mapKey);
      if (rejectDangerousKey(ownerPart)) return;
      const order = value.get('order');
      records.push({
        ownerPart,
        id,
        type,
        rawTarget: readString(value.get('rawTarget')),
        targetMode: value.get('targetMode') === 'External' ? 'External' : 'Internal',
        order: typeof order === 'number' && Number.isSafeInteger(order) ? order : 0,
      });
    });
  });
  records.sort(
    (left, right) =>
      left.order - right.order ||
      compareText(left.ownerPart, right.ownerPart) ||
      compareText(left.id, right.id)
  );
  return records;
}
