/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Characters an undo or redo puts back keep the identity of the characters they replace.
 *
 * Yjs puts a deleted character back as a new item and links the old item to it only on the
 * replica that undid. That replica marks each new item with the old item's identity, so on
 * every replica the character still hides behind a copy a peer moved meanwhile.
 */
import * as Y from 'yjs';
import { fieldOf, firstItem, itemsWrittenSince, structAt } from './yjs-items.ts';
import { INLINE_FIELD } from './paragraph-text.ts';
import { itemIdentity } from './paragraph-text-identity.ts';
import { textMarksOf } from './paragraph-text-marks.ts';

/** The transaction origin of the marks, which no undo stack tracks. */
export const RESTORE_ORIGIN = Symbol('docx-restore-marks');

/** Mark the characters this replica put back since its clock stood at `from`. */
export function markRestoredText(doc: Y.Doc, from: number): void {
  const created = new Map<Y.Text, Set<string>>();
  for (const item of itemsWrittenSince(doc, from)) {
    if (item.deleted || !(item.content instanceof Y.ContentString)) continue;
    const parent = item.parent;
    if (!(parent instanceof Y.Text) || fieldOf(parent) !== INLINE_FIELD) continue;
    const keys = created.get(parent) ?? new Set<string>();
    keys.add(`${item.id.client}:${item.id.clock}`);
    created.set(parent, keys);
  }
  if (created.size === 0) return;
  const marks = textMarksOf(doc);
  doc.transact(() => {
    for (const [text, keys] of created) {
      for (let item = firstItem(text); item; item = item.right) {
        if (!item.redone) continue;
        const key = `${item.redone.client}:${item.redone.clock}`;
        if (!keys.has(key)) continue;
        // The new item starts at the clock the old one names, and is as long: Yjs puts each
        // deleted item back whole. A neighbor it merged with later does not change that.
        const restored = structAt(doc, item.redone);
        if (!restored || restored.deleted) continue;
        const identity = itemIdentity(text, item, 0);
        marks.markCopy('restore', item.redone.client, item.redone.clock, item.length, identity);
      }
    }
  }, RESTORE_ORIGIN);
}
