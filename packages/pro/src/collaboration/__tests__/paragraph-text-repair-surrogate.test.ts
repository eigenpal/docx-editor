/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Characters that arrive with no run take one from a neighbor. The two halves of a surrogate
// pair have different nearest neighbors, and split between two text elements, neither half is
// a character XML can hold: the document could not be saved.
import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import * as Y from 'yjs';
import { linearizeParagraph, materializeParagraph } from '../document/paragraph-linear.ts';
import { decodeItems, encodeItems } from '../document/paragraph-text.ts';
import { DEFAULT_DOCUMENT_LIMITS } from '../document/limits.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function paragraphOf(xml: string): OoxmlElement {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${xml}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const body = parsed.part.root.children[0];
  const paragraph = body && body.kind !== 'textValue' ? body.children[0] : null;
  if (!paragraph || paragraph.kind === 'textValue') throw new Error('no paragraph');
  return paragraph as OoxmlElement;
}

function textValues(node: OoxmlNode, into: string[] = []): string[] {
  if (node.kind === 'textValue') into.push(node.value);
  else for (const child of node.children) textValues(child, into);
  return into;
}

test('a repaired surrogate pair stays in one text element', () => {
  const paragraph = paragraphOf(
    '<w:r><w:t>ab</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>cd</w:t></w:r>'
  );
  const linear = linearizeParagraph(paragraph);
  const text = new Y.Doc().getText('inline');
  let at = 0;
  for (const op of encodeItems(linear.items, paragraph.id, DEFAULT_DOCUMENT_LIMITS)) {
    if (typeof op.insert !== 'string') throw new Error('unexpected embed');
    text.insert(at, op.insert, { ...op.attributes });
    at += op.insert.length;
  }
  // A peer's emoji, with no run and no text element, between the two runs.
  text.insert(2, ' \u{1F603}', {});
  for (const key of Object.keys(text.toDelta()[0].attributes ?? {})) {
    text.format(2, 3, { [key]: null });
  }
  const items = decodeItems(text.toDelta(), () => null, DEFAULT_DOCUMENT_LIMITS, paragraph.id);
  const values = textValues(materializeParagraph({ shell: linear.shell, items }));
  expect(values.join('')).toBe('ab \u{1F603}cd');
  for (const value of values) {
    expect(value).not.toMatch(
      /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
    );
  }
});
