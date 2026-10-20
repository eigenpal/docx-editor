/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import { holderItem } from './yjs-items.ts';
import { parseBindingMapKey, readNodeShell, type PackageSchema } from './schema.ts';

const PART = '/word/numbering.xml';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

/**
 * Numbering definitions from concurrent authors share one package part.
 * Undo removes the author's definitions and paragraph references, but retains the package
 * directory entry, content type, and relationship. A peer can still need that infrastructure.
 * Retaining an empty numbering part also makes redo independent of relationship winner order.
 */
export function retainsNumberingInfrastructure(schema: PackageSchema, item: Y.Item): boolean {
  const parent = item.parent;
  if (parent === schema.bindings && item.parentSub) {
    const key = parseBindingMapKey(item.parentSub);
    const node = key && schema.nodes.get(key.logicalId);
    if (node) {
      const shell = readNodeShell(node);
      if (
        shell.localName === 'numbering' &&
        schema.namespaces.get(shell.namespaceId) ===
          'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
      )
        return true;
    }
  }
  if (parent === schema.overrides && item.parentSub === PART) return true;
  if (parent === schema.parts && item.parentSub === PART) return true;
  const holder = holderItem(parent);
  if (holder?.parent === schema.parts && holder.parentSub === PART) return true;
  // Relationships use a holder map, then a record map. Preserve only numbering records.
  const numbering = (value: unknown): boolean =>
    value instanceof Y.Map && value.get('type') === REL;
  const hasNumbering = (value: unknown): boolean =>
    value instanceof Y.Map && [...value.values()].some(numbering);
  if (parent === schema.relationships) return item.content.getContent().some(hasNumbering);
  if (holder?.parent === schema.relationships) return item.content.getContent().some(numbering);
  const owner = holderItem(holder?.parent);
  return owner?.parent === schema.relationships && numbering(parent);
}
