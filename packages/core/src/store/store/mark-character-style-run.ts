// The character style of the first run in a paragraph that had nothing in it.
//
// A paragraph with no content shows only its MARK: layout sizes the empty line from the mark's
// formatting, character style included, and the toolbar reports that face at the caret. Text
// typed there takes the same formatting, `w:rStyle` included, and zero-length runs do not
// count: a paragraph whose runs hold nothing is still empty.
//
// The mark's DIRECT properties reach the typed text through the editor's caret format, because
// they are in the accepted run vocabulary. `w:rStyle` is not: it is preserved, not accepted
// (`tree-op-types.ts`), so no property write can carry it. The insertion copies it itself,
// when it mints the run. The value is the paragraph's own authored reference, never a caller's,
// so the vocabulary an op may write stays as it was.

import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlNode, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { propertyContainer } from './direct-properties.ts';
import { segmentsOf } from './tree-op-segments.ts';

/** A `w:rStyle` naming `styleId`, the first child a `w:rPr` may hold (CT_RPr). */
export function characterStyleElement(nextId: () => string, styleId: string): OoxmlNode {
  return {
    id: nextId(),
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'rStyle',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [
      {
        kind: 'genericExtension',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'val',
        prefix: 'w',
        value: styleId,
      },
    ],
    children: [],
  } as unknown as OoxmlNode;
}

/**
 * The character style the mark of a paragraph with NO content names, or `undefined`.
 *
 * `undefined` for a paragraph with any addressable content (text, tab, break, field, drawing,
 * struck text): typing there joins a neighbouring run, which is where its formatting comes from.
 */
export function emptyParagraphMarkStyle(paragraph: OoxmlParagraphNode): string | undefined {
  if (segmentsOf(paragraph).length > 0) return undefined;
  const mark = propertyContainer(
    propertyContainer(paragraph, 'paragraphProperties', 'pPr'),
    'runProperties',
    'rPr'
  );
  if (!mark || mark.kind === 'textValue') return undefined;
  const reference = mark.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.localName === 'rStyle' &&
      child.namespaceUri === WML_NAMESPACE_URI
  );
  if (!reference || reference.kind === 'textValue') return undefined;
  const styleId = reference.attributes.find(
    (attribute) => attribute.localName === 'val' && attribute.namespaceUri === WML_NAMESPACE_URI
  )?.value;
  return styleId ? styleId : undefined;
}

/**
 * The `w:rPr` of the run minted for the first content of an empty paragraph, or `[]` when its
 * mark names no character style. Spread into the minted run ahead of its content.
 */
export function emptyParagraphRunProperties(
  paragraph: OoxmlParagraphNode,
  nextId: () => string
): OoxmlNode[] {
  const styleId = emptyParagraphMarkStyle(paragraph);
  if (styleId === undefined) return [];
  return [
    {
      id: nextId(),
      kind: 'runProperties',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'rPr',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [characterStyleElement(nextId, styleId)],
    } as unknown as OoxmlNode,
  ];
}
