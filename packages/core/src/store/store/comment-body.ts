// The elements a comment's body is built from: one paragraph of plain text, styled the way
// Word styles its own comments.

import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import { W14_NAMESPACE_URI, XML_NAMESPACE_URI } from '../package/ooxml-shared.ts';

export function wmlAttr(localName: string, value: string): OoxmlElement['attributes'][number] {
  return {
    kind: 'genericExtension' as const,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    value,
  };
}

/**
 * Build an element with an explicit KIND.
 *
 * Typed rather than generic on purpose: everything that reads comments matches on kind, so a
 * body written as generic nodes would serialize correctly and be invisible to the reader in the
 * same session — the comment would appear only after a save and reopen.
 */
export function element(
  id: string,
  kind: OoxmlElement['kind'],
  namespaceUri: string,
  prefix: string,
  localName: string,
  attributes: OoxmlElement['attributes'],
  children: readonly OoxmlNode[],
  bindings: readonly { prefix: string; namespaceUri: string }[] = []
): OoxmlElement {
  return {
    id,
    kind,
    namespaceUri,
    localName,
    prefix,
    namespaceBindings: bindings,
    attributes,
    children,
  } as OoxmlElement;
}

/** The one paragraph of plain text a comment body holds, carrying its `w14:paraId`. */
export function commentParagraph(
  base: string,
  paraId: string,
  bodyText: string,
  paraIdPrefix: string
): OoxmlElement {
  // `xml:space="preserve"` when the body has an edge space, which is what a conformant
  // reader is entitled to drop — Word writes the attribute for exactly this case. Omitted
  // otherwise, so an ordinary reply adds no attribute the file did not need.
  const preservesSpace = bodyText !== bodyText.trim();
  const text = element(
    `${base}.t`,
    'text',
    WML_NAMESPACE_URI,
    'w',
    't',
    preservesSpace
      ? [
          {
            kind: 'xmlSpace' as const,
            namespaceUri: XML_NAMESPACE_URI,
            localName: 'space' as const,
            prefix: 'xml' as const,
            value: 'preserve' as const,
          },
        ]
      : [],
    [{ id: `${base}.tv`, kind: 'textValue', value: bodyText }]
  );
  // Word's own shape: the body carries `CommentText`, and the run carries
  // `CommentReference`. Without them a comment renders in body formatting and the pane loses
  // the styling every other editor gives it.
  const runProperties = element(
    `${base}.rPr`,
    'runProperties',
    WML_NAMESPACE_URI,
    'w',
    'rPr',
    [],
    [
      element(
        `${base}.rStyle`,
        'generic',
        WML_NAMESPACE_URI,
        'w',
        'rStyle',
        [wmlAttr('val', 'CommentReference')],
        []
      ),
    ]
  );
  const run = element(`${base}.r`, 'run', WML_NAMESPACE_URI, 'w', 'r', [], [runProperties, text]);
  const paragraphProperties = element(
    `${base}.pPr`,
    'paragraphProperties',
    WML_NAMESPACE_URI,
    'w',
    'pPr',
    [],
    [
      element(
        `${base}.pStyle`,
        'generic',
        WML_NAMESPACE_URI,
        'w',
        'pStyle',
        [wmlAttr('val', 'CommentText')],
        []
      ),
    ]
  );
  return element(
    `${base}.p`,
    'paragraph',
    WML_NAMESPACE_URI,
    'w',
    'p',
    [
      {
        kind: 'genericExtension' as const,
        namespaceUri: W14_NAMESPACE_URI,
        localName: 'paraId',
        prefix: paraIdPrefix,
        value: paraId,
      },
    ],
    [paragraphProperties, run]
  );
}
