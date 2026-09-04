// An explicit inline owner is stronger than an adjacent content-control transition.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../index.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import { findContentControl, isShowingPlaceholder } from '../store/tree-op-nodes.ts';
import type { TreeDocOp } from '../store/tree-op-types.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(properties: string, prompt: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>` +
      '<w:p><w:smartTag><w:r><w:t>old</w:t></w:r></w:smartTag>' +
      `<w:sdt><w:sdtPr>${properties}</w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>${prompt}</w:t></w:r></w:sdtContent></w:sdt></w:p>` +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstNamed(node: OoxmlNode, localName: string): OoxmlNode | null {
  if (node.kind !== 'textValue' && node.localName === localName) return node;
  if (node.kind === 'textValue') return null;
  for (const child of node.children) {
    const found = firstNamed(child, localName);
    if (found) return found;
  }
  return null;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.part;
}

function textUnder(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return node.children.map(textUnder).join('');
}

function withoutSmartTagText(part: OoxmlPart, paragraphId: string): OoxmlPart {
  return apply(part, { op: 'deleteText', paragraphId, start: 0, end: 3 });
}

function replaceNamedSmartTag(part: OoxmlPart): OoxmlPart {
  const paragraph = firstNamed(part.root, 'p');
  const smartTag = firstNamed(part.root, 'smartTag');
  if (!paragraph || !smartTag) throw new Error('fixture is incomplete');
  const deleted = withoutSmartTagText(part, paragraph.id);
  return apply(deleted, {
    op: 'insertText',
    paragraphId: paragraph.id,
    offset: 0,
    text: 'X',
    inside: smartTag.id,
  });
}

describe('named owners beat adjacent content-control transitions', () => {
  test('a named replacement does not consume an adjacent placeholder', () => {
    const part = load('<w:showingPlcHdr/><w:text/>', 'Prompt');
    const smartTagId = firstNamed(part.root, 'smartTag')!.id;
    const controlId = firstNamed(part.root, 'sdt')!.id;
    const next = replaceNamedSmartTag(part);
    expect(textUnder(firstNamed(next.root, 'smartTag')!)).toBe('X');
    expect(firstNamed(next.root, 'smartTag')!.id).toBe(smartTagId);
    const prompt = findContentControl(next, controlId)!;
    expect(isShowingPlaceholder(prompt)).toBe(true);
    expect(textUnder(prompt)).toBe('Prompt');
  });

  test('a named replacement does not unwrap an adjacent temporary control', () => {
    const part = load('<w:temporary/><w:text/>', 'Keep');
    const controlId = firstNamed(part.root, 'sdt')!.id;
    const next = replaceNamedSmartTag(part);
    expect(textUnder(firstNamed(next.root, 'smartTag')!)).toBe('X');
    expect(textUnder(findContentControl(next, controlId)!)).toBe('Keep');
  });

  test('an unowned insertion still applies both adjacent transitions', () => {
    const placeholder = load('<w:showingPlcHdr/><w:text/>', 'Prompt');
    const placeholderParagraph = firstNamed(placeholder.root, 'p')!;
    const placeholderId = firstNamed(placeholder.root, 'sdt')!.id;
    const withoutPromptOwner = withoutSmartTagText(placeholder, placeholderParagraph.id);
    const filled = apply(withoutPromptOwner, {
      op: 'insertText',
      paragraphId: placeholderParagraph.id,
      offset: 0,
      text: 'X',
    });
    expect(isShowingPlaceholder(findContentControl(filled, placeholderId)!)).toBe(false);
    expect(textUnder(findContentControl(filled, placeholderId)!)).toBe('X');

    const temporary = load('<w:temporary/><w:text/>', 'Keep');
    const temporaryParagraph = firstNamed(temporary.root, 'p')!;
    const temporaryId = firstNamed(temporary.root, 'sdt')!.id;
    const withoutTemporaryOwner = withoutSmartTagText(temporary, temporaryParagraph.id);
    const unwrapped = apply(withoutTemporaryOwner, {
      op: 'insertText',
      paragraphId: temporaryParagraph.id,
      offset: 0,
      text: 'X',
    });
    expect(findContentControl(unwrapped, temporaryId)).toBeNull();
    expect(paragraphTextOf(unwrapped, temporaryParagraph.id)).toBe('XKeep');
  });
});
