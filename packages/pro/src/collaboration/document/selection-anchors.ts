/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * A caret anchored on the shared character beside it.
 *
 * The editor addresses a caret by paragraph and offset. Offsets mean nothing once other
 * participants change the text, so a caret is carried across their changes on the character
 * it stands after (or, at a paragraph start, before): wherever that character shows after the
 * change, the caret stands beside it. A character that moved shows as a copy with the same
 * identity, so the caret follows the move too.
 *
 * Offsets count the editor's model text, so a paragraph's layout comes from the same tree
 * walk the editor uses (`segmentsOf`). The layout is used only when its text is exactly the
 * text the editor shows; any other paragraph has no anchor, and the editor maps the caret by
 * text instead.
 */
import {
  segmentsOf,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlParagraphNode,
} from '@docx-editor.dev/core/store';
import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import type { SharedCharacter } from './paragraph-text.ts';
import { inlineChildren } from './paragraph-text-view.ts';

/** Which shared character a caret stands beside, and on which side. */
export interface CaretAnchor {
  readonly character: SharedCharacter;
  /** True when the caret stands right after the character, false when right before it. */
  readonly after: boolean;
}

/** A paragraph's model text, character by character, with the shared character behind each. */
interface ParagraphLayout {
  readonly length: number;
  /** The shared character behind each text character, in the order the paragraph shows them. */
  readonly characters: readonly (SharedCharacter | null)[];
  /** For each model offset, the index of the text character there, or -1. */
  readonly characterAt: Int32Array;
  /** For each text character, its model offset, or -1 inside an atom such as a field. */
  readonly offsetOf: Int32Array;
}

/**
 * Lay out a paragraph as the editor shows it, or null when the layout cannot be trusted:
 * the paragraph has no shared text, or the layout's text differs from `shownText`, the text
 * the editor shows. `embedOf` returns an embedded node as last built.
 */
export function paragraphLayout(
  registry: DocumentRegistry,
  paragraphId: LogicalId,
  embedOf: (id: LogicalId) => OoxmlNode | null,
  shownText: string
): ParagraphLayout | null {
  const text = registry.inline.textOf(paragraphId);
  if (!text) return null;
  const characters: (SharedCharacter | null)[] = [];
  // An embedded node, as a text box, holds text of its own story, which is no character here.
  const embedded = new Set<string>();
  const children = inlineChildren(
    paragraphId,
    text,
    (id) => {
      // A node two copies embed shows once, as the editor shows it.
      if (embedded.has(id)) return null;
      const node = embedOf(id);
      if (node) embedded.add(node.id);
      return node;
    },
    registry.limits,
    // Laying a paragraph out to read a caret changes nothing, so it reports no drift.
    { ...registry.inline.viewOf(paragraphId), noteDrift: () => {} },
    (character) => characters.push(character)
  );
  const paragraph = {
    id: paragraphId,
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children,
  } as unknown as OoxmlParagraphNode;
  // Each text value holds a stretch of the characters, in the order the paragraph shows them.
  const firstCharacter = new Map<string, number>();
  let counted = 0;
  const visit = (node: OoxmlNode): void => {
    if (embedded.has(node.id)) return;
    if (node.kind === 'textValue') {
      firstCharacter.set(node.id, counted);
      counted += node.value.length;
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const child of children) visit(child);
  if (counted !== characters.length) return null;
  const segments = segmentsOf(paragraph);
  const length = segments.length > 0 ? segments[segments.length - 1]!.end : 0;
  if (length !== shownText.length) return null;
  const characterAt = new Int32Array(length).fill(-1);
  const offsetOf = new Int32Array(characters.length).fill(-1);
  for (const segment of segments) {
    if (segment.node.kind !== 'textValue' || segment.removeNodeIds) continue;
    const first = firstCharacter.get(segment.node.id);
    const value = segment.node.value;
    if (first === undefined || shownText.slice(segment.start, segment.end) !== value) return null;
    for (let at = 0; at < segment.end - segment.start; at += 1) {
      characterAt[segment.start + at] = first + at;
      offsetOf[first + at] = segment.start + at;
    }
  }
  return { length, characters, characterAt, offsetOf };
}

/**
 * The shared character a caret at `offset` stands beside: the text character right before
 * it, or, when there is none, the one right after it. Null when neither is a text character,
 * as between two embeds or in an empty paragraph.
 */
export function anchorAt(layout: ParagraphLayout, offset: number): CaretAnchor | null {
  const before = offset > 0 ? layout.characterAt[offset - 1] : -1;
  if (before !== undefined && before >= 0) {
    const character = layout.characters[before];
    return character ? { character, after: true } : null;
  }
  const next = offset < layout.length ? layout.characterAt[offset] : -1;
  if (next !== undefined && next >= 0) {
    const character = layout.characters[next];
    return character ? { character, after: false } : null;
  }
  return null;
}

/**
 * Where an anchored caret stands in `layout`: beside the same Yjs item if the paragraph shows
 * it, else beside a copy of the same character. Null when the paragraph shows neither.
 */
export function offsetIn(layout: ParagraphLayout, anchor: CaretAnchor): number | null {
  // An original character is its own identity, which its copies carry.
  const identity = anchor.character.identity ?? anchor.character.item;
  let copy = -1;
  for (let index = 0; index < layout.characters.length; index += 1) {
    const character = layout.characters[index];
    if (!character) continue;
    if (character.item === anchor.character.item) {
      copy = index;
      break;
    }
    if (copy < 0 && character.identity === identity) {
      copy = index;
    }
  }
  if (copy < 0) return null;
  const offset = layout.offsetOf[copy]!;
  if (offset < 0) return null;
  return anchor.after ? offset + 1 : offset;
}
