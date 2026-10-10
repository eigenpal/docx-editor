/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Typing, written straight to its paragraph's shared text.
 *
 * Every other edit rebuilds the paragraph as shared state shows it, replays the journal on
 * it, encodes both sides and diffs them. Typing is most of what a paragraph sees, and for an
 * insert at one place that whole path writes one insert. This module writes that insert
 * directly when it can prove the general path would write the same one, and otherwise
 * leaves the edit to it.
 *
 * The proof needs the paragraph to show exactly what its text says: no hidden or incoming
 * text, no ID shown tagged, no shell repeated apart, and attributes that encode back to
 * themselves. Then the general path's two sides differ only by the typed characters, and
 * its diff places them where this module does. Where equal letters border the insert, the
 * diff decides by its own rules, so the general path writes those.
 */
import type * as Y from 'yjs';
import type { CanonicalPrimitiveJournal } from '@docx-editor.dev/core/collaboration/replication';
import type { LogicalId } from './identity.ts';
import type { DocumentLimits } from './limits.ts';
import { SharedTextValueRefused } from './paragraph-text-codec.ts';
import type { TextIdentities } from './paragraph-text-identity.ts';
import {
  attributeSignature,
  decodeAttributes,
  encodeAttributes,
  type InlineAttributes,
} from './paragraph-text.ts';
import { followAnchorAt, insertFollowing, insertTyped } from './paragraph-text-apply.ts';
import type { DocumentRegistry } from './registry.ts';
import { awaitingUpdates } from './yjs-items.ts';

/** An insert the general path would write as one insert, and what it needs to write it. */
export interface TypedInsert {
  readonly paragraphId: LogicalId;
  readonly text: Y.Text;
  /** The text's length when the insert was planned; another length means it changed since. */
  readonly length: number;
  readonly position: number;
  readonly value: string;
  readonly attributes: InlineAttributes;
  readonly identities: TextIdentities;
}

let shortcut = true;
let written = 0;

/** How many inserts this module wrote. Tests check that the shortcut ran. */
export function typedInsertsWritten(): number {
  return written;
}

/** Write every edit by the general path. Tests compare the two paths with it. */
export function setTypedInsertShortcut(enabled: boolean): void {
  shortcut = enabled;
}

/** Whether each attribute set encodes back to itself, per limits and paragraph. */
const normalized = new WeakMap<DocumentLimits, Map<string, boolean>>();
const MAX_NORMALIZED_CACHE = 4096;

/**
 * The insert a journal makes, when it only types at one place and the general path would
 * write exactly that insert. Null for any other journal.
 */
export function typedInsertOf(
  registry: DocumentRegistry,
  journal: CanonicalPrimitiveJournal
): TypedInsert | null {
  if (!shortcut || journal.effects.length !== 1) return null;
  const effect = journal.effects[0]!;
  if (effect.kind !== 'spliceText' || effect.deleteCount !== 0) return null;
  if (!plainLetters(effect.insert)) return null;
  // Shared state that holds a write its events have not described, or an update Yjs holds
  // back, can show other text than the indexes say.
  if (registry.hasUnobservedWrites() || awaitingUpdates(registry.doc)) return null;
  const paragraphId = registry.inline.owner(effect.logicalId);
  if (paragraphId === null) return null;
  const text = registry.inline.textOf(paragraphId);
  if (!text || registry.inline.sharesIds(paragraphId)) return null;
  const view = registry.inline.viewOf(paragraphId);
  const shown = view.shown(text);
  if (shown.hidden.size > 0 || shown.incoming.length > 0) return null;

  // The typed value's characters, and the tokens beside the place the insert goes.
  const delta = text.toDelta() as { insert: unknown; attributes?: InlineAttributes }[];
  let at = 0;
  let start = -1;
  let count = 0;
  let attributes: InlineAttributes | null = null;
  const seen = new Set<string>();
  let previousIds = new Set<string>();
  for (const op of delta) {
    const opAttributes = op.attributes ?? {};
    if (!encodesBack(registry, paragraphId, opAttributes)) return null;
    const decoded = decodeAttributes(opAttributes, registry.limits, paragraphId);
    // A shell that shows again apart from where it first showed is renamed by the view.
    const ids = new Set<string>();
    for (const id of [
      decoded.run?.id,
      decoded.runProperties?.id,
      decoded.text?.id,
      decoded.textValueId,
      ...decoded.wrap.map((wrapper) => wrapper.id),
    ]) {
      if (!id) continue;
      if (seen.has(id) && !previousIds.has(id)) return null;
      ids.add(id);
      seen.add(id);
    }
    previousIds = ids;
    const length = typeof op.insert === 'string' ? op.insert.length : 1;
    if (
      typeof op.insert === 'string' &&
      decoded.textValueId !== null &&
      view.shownId(decoded.textValueId) === effect.logicalId
    ) {
      if (start < 0) start = at;
      else if (start + count !== at) return null;
      if (attributes && attributeSignature(attributes) !== attributeSignature(opAttributes)) {
        return null;
      }
      attributes ??= opAttributes;
      count += length;
    }
    at += length;
  }
  // An empty value has no character to take attributes from. A bound outside the value, or a
  // value grown past the limit, is the general path's to refuse.
  if (!attributes || !Number.isSafeInteger(effect.utf16Start)) return null;
  if (effect.utf16Start < 0 || effect.utf16Start > count) return null;
  if (count + effect.insert.length > registry.limits.maxTextLength) return null;
  const position = start + effect.utf16Start;
  const before = position > 0 ? tokenAt(delta, position - 1) : null;
  const after = position < at ? tokenAt(delta, position) : null;
  const first = effect.insert[0]!;
  const last = effect.insert[effect.insert.length - 1]!;
  // Equal letters at the border: the diff places the insert by its own rules.
  if (after && after.key === `c${first}`) return null;
  if (before && before.key === `c${last}` && before.element !== (attributes.t ?? '')) return null;
  if (before?.highSurrogate) return null;
  return {
    paragraphId,
    text,
    length: text.length,
    position,
    value: effect.insert,
    attributes,
    identities: shown.identities,
  };
}

/** Write a planned insert, as the general path writes an insert at one place. */
export function writeTypedInsert(registry: DocumentRegistry, typed: TypedInsert): boolean {
  if (typed.text.length !== typed.length) return false;
  const follow = followAnchorAt(typed.identities, typed.position);
  if (follow) {
    insertFollowing(typed.text, typed.position, typed.value, typed.attributes, follow);
  } else {
    insertTyped(
      typed.text,
      typed.position,
      typed.value,
      typed.attributes,
      typed.identities,
      (identity) => registry.inline.follow.shownCopy(identity) !== null
    );
  }
  registry.inline.follow.invalidate(typed.paragraphId);
  written += 1;
  return true;
}

/** Letters of the basic plane that are not control characters: what typing inserts. */
function plainLetters(value: string): boolean {
  if (value.length === 0) return false;
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at);
    if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff)) return false;
  }
  return true;
}

/** Whether attributes read and written again are the same attributes. */
function encodesBack(
  registry: DocumentRegistry,
  paragraphId: LogicalId,
  attributes: InlineAttributes
): boolean {
  const signature = attributeSignature(attributes);
  const key = JSON.stringify([paragraphId, signature]);
  let cache = normalized.get(registry.limits);
  if (!cache) normalized.set(registry.limits, (cache = new Map()));
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let same: boolean;
  try {
    const decoded = decodeAttributes(attributes, registry.limits, paragraphId);
    same =
      attributeSignature(encodeAttributes(decoded, paragraphId, registry.limits)) === signature;
  } catch (error) {
    if (!(error instanceof SharedTextValueRefused)) throw error;
    same = false;
  }
  if (cache.size >= MAX_NORMALIZED_CACHE) cache.clear();
  cache.set(key, same);
  return same;
}

/** The token at one position of a delta: its content key and its text element. */
function tokenAt(
  delta: readonly { insert: unknown; attributes?: InlineAttributes }[],
  position: number
): { readonly key: string; readonly element: string; readonly highSurrogate: boolean } | null {
  let at = 0;
  for (const op of delta) {
    const length = typeof op.insert === 'string' ? op.insert.length : 1;
    if (position < at + length) {
      if (typeof op.insert !== 'string') return { key: 'embed', element: '', highSurrogate: false };
      const code = op.insert.charCodeAt(position - at);
      return {
        key: `c${op.insert[position - at]}`,
        element: op.attributes?.t ?? '',
        highSurrogate: code >= 0xd800 && code <= 0xdbff,
      };
    }
    at += length;
  }
  return null;
}
