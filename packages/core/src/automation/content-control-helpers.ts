import {
  contentControlContentNodeOf,
  contentControlsIn,
} from '../store/package/content-control-nodes.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';

/**
 * Every control under a scope, nested ones included, in document order.
 *
 * For the lookups that search what the FILE wrote — an id, a tag, a title. Word's own numbering
 * is not scoped to a nesting level, so a lookup restricted to a scope's direct children would
 * report a control that plainly exists as absent.
 */
export function allControlsUnder(scope: OoxmlNode): readonly OoxmlNode[] {
  const root = scope.kind === 'contentControl' ? contentControlContentNodeOf(scope) : scope;
  if (!root) return [];
  return contentControlsIn(root).map((entry) => entry.node);
}

/** The `ST_Lock` values this automation slice accepts, plus the one that means "none". */
export const CONTENT_CONTROL_LOCKS: ReadonlySet<string> = new Set([
  'unlocked',
  'sdtLocked',
  'contentLocked',
  'sdtContentLocked',
]);
