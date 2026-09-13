/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { isElementRecord, isTextRecord } from './schema.ts';
import type { DocumentRegistry } from './registry.ts';

export type SplitTextRecordingRegistry = Pick<
  DocumentRegistry,
  'limits' | 'record' | 'projectedTextValue' | 'registerSplitText'
>;

interface TextLeaf {
  readonly id: string;
  readonly value: string;
}

function leaves(registry: SplitTextRecordingRegistry, root: string): readonly TextLeaf[] | null {
  const found: TextLeaf[] = [];
  const pending = [{ id: root, depth: 0 }];
  const seen = new Set<string>();
  let length = 0;
  while (pending.length > 0) {
    const { id, depth } = pending.pop()!;
    if (seen.has(id) || depth > registry.limits.maxTreeDepth) return null;
    seen.add(id);
    const node = registry.record(id);
    if (!node) return null;
    if (isTextRecord(node)) {
      const value = registry.projectedTextValue(id) ?? node.value;
      length += value.length;
      if (length > registry.limits.maxTextLength) return null;
      found.push({ id, value });
    } else if (isElementRecord(node) && !node.kind.endsWith('Properties')) {
      for (let index = node.childIds.length - 1; index >= 0; index -= 1) {
        pending.push({ id: node.childIds[index]!, depth: depth + 1 });
      }
    }
  }
  return found;
}

/** A pure split partitions existing text; it must not mint a second shared character sequence. */
export function recordSplitTextSources(
  registry: SplitTextRecordingRegistry,
  source: string,
  products: readonly string[]
): void {
  const before = leaves(registry, source);
  const after: TextLeaf[] = [];
  if (!before || before.length === 0) return;
  for (const product of products) {
    const parts = leaves(registry, product);
    if (!parts) return;
    for (const part of parts) after.push(part);
  }
  if (before.map((leaf) => leaf.value).join('') !== after.map((leaf) => leaf.value).join(''))
    return;
  const aliases: { product: string; source: string; start: number; end: number }[] = [];
  let sourceIndex = 0;
  let start = 0;
  for (const leaf of after) {
    while (sourceIndex < before.length - 1 && start === before[sourceIndex]!.value.length) {
      sourceIndex += 1;
      start = 0;
    }
    const original = before[sourceIndex];
    if (!original || start + leaf.value.length > original.value.length) return;
    if (leaf.id !== original.id) {
      aliases.push({
        product: leaf.id,
        source: original.id,
        start,
        end: start + leaf.value.length,
      });
    }
    start += leaf.value.length;
  }
  for (const alias of aliases)
    registry.registerSplitText(alias.product, alias.source, alias.start, alias.end);
}
