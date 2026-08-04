// How an object says WHICH characters it means.
//
// Three things in this model have character formatting and a paragraph style: a story, a stretch of
// one, and a paragraph. The host spells all three as one `AutomationSpanRef`, and this is the single
// place that translation happens — a second copy of it in each class is how one of them ends up
// addressing a whole story where the caller meant a range.

import { fail, type AutomationSpanRef, type ObjectPath } from '../runtime/model-support.ts';

/** What the object is, which is what decides how its characters are named. */
export type SpanOwner = 'body' | 'paragraph' | 'span';

/**
 * The span an object's own address names.
 *
 * Read at the moment it is needed rather than captured, so an object whose paragraph went away
 * between the call and the sync refuses instead of naming a place that is no longer there.
 */
export function spanRefOf(path: ObjectPath, owner: SpanOwner): AutomationSpanRef {
  const address = path.address();
  if (owner === 'span') {
    if (address.kind !== 'span') fail({ code: 'InvalidObjectPath', target: path.label });
    return { start: address.span.start, end: address.span.end };
  }
  if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: path.label });
  return owner === 'body' ? { body: address.handle } : { paragraph: address.handle };
}

/**
 * A style name a write may carry.
 *
 * Only the SHAPE is checked here — a non-empty string of a sane length. Whether the document
 * actually defines a paragraph style by that name is the host's answer, and it is deliberately not
 * guessed at locally: this side has no styles part to consult, and a client-side allowlist would
 * either be wrong for a document Word wrote in another language or be a copy of the file.
 */
export function requireStyleName(value: unknown, target: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 255) {
    fail({ code: 'InvalidArgument', target });
  }
  return value;
}
