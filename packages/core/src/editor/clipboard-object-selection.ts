import { readOoxmlPackage } from '../store/package/ooxml-package.ts';
import { containsClipboardObject } from '../store/store/clipboard-object-policy.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';

/** Check canonical content, including unpainted atoms and stories outside the body. */
export function selectionContainsClipboardObject(
  part: OoxmlPart,
  ranges: ReadonlyMap<string, { start: number; end: number }>
): boolean {
  for (const [id, range] of ranges) {
    const node = findNode(part, id);
    if (!node) continue;
    if (node.kind === 'textValue') continue;
    if (node.kind === 'paragraph' && range && range.end > range.start) {
      const index = paragraphOffsetIndex(node);
      const children: OoxmlNode[] = [...node.children];
      while (children.length) {
        const child = children.pop()!;
        if (child.kind === 'textValue') continue;
        if (child.namespaceUri === WML_NAMESPACE_URI && child.localName === 'object') {
          const span = index.spanOf(child);
          // Opaque objects have no span; a whole-paragraph transfer must still refuse them.
          if (
            span
              ? span.end > range.start && span.start < range.end
              : range.start === 0 && range.end === Infinity
          )
            return true;
        }
        for (const inner of child.children) children.push(inner);
      }
    }
  }
  return false;
}

/** Structural refusal also applies when the target supports only plain text. */
export function fragmentContainsClipboardObject(bytes: Uint8Array): boolean {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) return false;
  for (const part of read.package.parts.values()) {
    if (containsClipboardObject([part.root])) return true;
  }
  return false;
}
