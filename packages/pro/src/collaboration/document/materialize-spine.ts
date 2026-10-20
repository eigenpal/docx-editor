/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The children of a node that rebuilds only because something under it changed.
 *
 * A received keystroke dirties its paragraph and every ancestor up to the part root. The
 * body's own record did not change, so its child list is the one its last build showed; only
 * the children that are themselves dirty can show something new. Reading the whole child
 * list again, with an existence and listing check per child, made each received character
 * cost the number of blocks in the document. This rebuilds the dirty children in place and
 * keeps every other child as built.
 *
 * It refuses, before it changes anything, when the full rebuild could decide differently: a
 * child that some other parent already placed, a child no longer in the cache as shown, or a
 * dirty child that is deleted or missing. The caller then runs the full rebuild.
 */
import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { idOf, type LogicalId } from './identity.ts';

export interface SpineContext {
  /** The dirty ids of this pass. */
  readonly dirty: ReadonlySet<LogicalId>;
  /** The ids this pass placed so far. */
  readonly placed: Set<LogicalId>;
  /** Whether the cache still holds this child as the last build showed it. */
  readonly isCached: (child: OoxmlNode) => boolean;
  /** Whether a dirty child can rebuild as the full loop would: it exists and is live. */
  readonly canRebuild: (childId: LogicalId) => boolean;
  /** Rebuild one dirty child. */
  readonly rebuild: (childId: LogicalId) => OoxmlNode | null;
}

/** The new children, and the ids that left. Null when the full rebuild has to run. */
export function spineChildren(
  previous: OoxmlElement,
  context: SpineContext
): { readonly children: readonly OoxmlNode[]; readonly dropped: readonly LogicalId[] } | null {
  const children = previous.children;
  for (const child of children) {
    const id = idOf(child);
    if (context.placed.has(id) || !context.isCached(child)) return null;
    if (context.dirty.has(id) && !context.canRebuild(id)) return null;
  }
  let next: OoxmlNode[] | null = null;
  const dropped: LogicalId[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const id = idOf(child);
    if (!context.dirty.has(id)) {
      context.placed.add(id);
      next?.push(child);
      continue;
    }
    const rebuilt = context.rebuild(id);
    if (rebuilt === child) {
      next?.push(child);
      continue;
    }
    next ??= children.slice(0, index);
    if (rebuilt) next.push(rebuilt);
    else dropped.push(id);
  }
  return { children: next ? Object.freeze(next) : children, dropped };
}
