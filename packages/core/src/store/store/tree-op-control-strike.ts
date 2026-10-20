import {
  lockForbidsEdit,
  lockForbidsRemoval,
  type ContentControlLock,
} from '../package/content-control-nodes.ts';
import type { OffsetSpan } from './tree-op-segments.ts';

/**
 * Whether a tracked deletion over `range` strikes this control WHOLE: the range covers all of
 * it, and its lock forbids editing what it holds but allows removing it (`contentLocked`).
 * The tracked-delete applier writes such a control inside one `w:del`; every other control is
 * struck from inside, as before.
 */
export function strikesWholeControl(
  span: OffsetSpan | null,
  range: { readonly start: number; readonly end: number },
  lock: ContentControlLock
): boolean {
  return (
    span !== null &&
    span.start < span.end &&
    range.start <= span.start &&
    span.end <= range.end &&
    lockForbidsEdit(lock) &&
    !lockForbidsRemoval(lock)
  );
}
