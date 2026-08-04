// Page-number field insertion for furniture stories (and any paragraph).
//
// Authors allowlisted complex fields only — PAGE / NUMPAGES / SECTIONPAGES and the
// PAGE_X_OF_Y composition. Nodes are typed `fldChar` / `instrText` with schema-legal
// attributes; instruction strings are literals, never file-derived templates.

import { WML_NAMESPACE_URI, XML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';

export type PageFieldKind = 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES' | 'PAGE_X_OF_Y';

function fldChar(nextId: () => string, type: 'begin' | 'separate' | 'end'): OoxmlNode {
  return {
    id: nextId(),
    kind: 'fldChar',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'fldChar',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [
      {
        kind: 'genericExtension',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'fldCharType',
        prefix: 'w',
        value: type,
      },
    ],
    children: [],
  } as unknown as OoxmlNode;
}

function instrText(nextId: () => string, instruction: string): OoxmlNode {
  const valueId = nextId();
  return {
    id: nextId(),
    kind: 'instrText',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'instrText',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [
      {
        kind: 'xmlSpace',
        namespaceUri: XML_NAMESPACE_URI,
        localName: 'space',
        prefix: 'xml',
        value: 'preserve',
      },
    ],
    children: [{ id: valueId, kind: 'textValue', value: ` ${instruction} ` }],
  } as unknown as OoxmlNode;
}

function textElement(nextId: () => string, text: string): OoxmlNode {
  const valueId = nextId();
  return {
    id: nextId(),
    kind: 'text',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 't',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [{ id: valueId, kind: 'textValue', value: text }],
  } as unknown as OoxmlNode;
}

/** Run-child builders for one allowlisted page field (or PAGE X OF Y composition). */
export function pageFieldContentBuilders(
  field: PageFieldKind
): readonly ((mint: () => string) => OoxmlNode)[] {
  const complex = (instruction: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES') =>
    [
      (mint: () => string) => fldChar(mint, 'begin'),
      (mint: () => string) => instrText(mint, instruction),
      (mint: () => string) => fldChar(mint, 'separate'),
      (mint: () => string) => fldChar(mint, 'end'),
    ] as const;

  if (field === 'PAGE_X_OF_Y') {
    return [...complex('PAGE'), (mint) => textElement(mint, ' of '), ...complex('NUMPAGES')];
  }
  return [...complex(field)];
}
