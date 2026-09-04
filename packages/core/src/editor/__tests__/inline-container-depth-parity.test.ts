// Every paragraph-inline consumer uses one total depth for wrappers and content controls.

import { describe, expect, test } from 'bun:test';
import { treeToDoc } from '../../binding/tree-binding.ts';
import { piecesOfParagraph } from '../../layout/field-projection.ts';
import {
  readOoxmlPart,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { MAX_INLINE_CONTAINER_DEPTH } from '../../store/package/ooxml-shared.ts';
import { paragraphOffsetIndex } from '../../store/store/tree-op-segments.ts';
import { applyTreeOp, paragraphTextOf, validateTreeOp } from '../../store/store/tree-ops.ts';
import { inlineContentControlsAt } from '../content-controls.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function mixedContainers(count: number, label: string, text: string): string {
  let content = `<w:r><w:t>${text}</w:t></w:r>`;
  for (let depth = 0; depth < count; depth += 1) {
    content =
      depth % 2 === 0
        ? `<w:smartTag>${content}</w:smartTag>`
        : `<w:sdt><w:sdtPr><w:tag w:val="${label}-${depth}"/></w:sdtPr>` +
          `<w:sdtContent>${content}</w:sdtContent></w:sdt>`;
  }
  return content;
}

function inlineControl(label: string, text: string): string {
  return (
    `<w:sdt><w:sdtPr><w:tag w:val="${label}"/></w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>${text}</w:t></w:r></w:sdtContent></w:sdt>`
  );
}

function nestedOwner(count: number, owner: 'bdo' | 'control'): string {
  let content =
    owner === 'bdo'
      ? '<w:bdo><w:r><w:t>A</w:t></w:r></w:bdo>'
      : '<w:sdt><w:sdtPr><w:tag w:val="target"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>A</w:t></w:r></w:sdtContent></w:sdt>';
  for (let depth = 1; depth < count; depth += 1) {
    content =
      depth % 2 === 0
        ? `<w:smartTag>${content}</w:smartTag>`
        : '<w:sdt><w:sdtPr/><w:sdtContent>' + content + '</w:sdtContent></w:sdt>';
  }
  return content;
}

function demotedControlsAround(count: number, content: string): string {
  let nested = content;
  for (let depth = 0; depth < count; depth += 1) {
    // Properties after content make each `w:sdt` canonical but generic.
    nested = `<w:sdt><w:sdtContent>${nested}</w:sdtContent><w:sdtPr/></w:sdt>`;
  }
  return nested;
}

function loadedParagraph(xml: string): { part: OoxmlPart; paragraph: OoxmlParagraphNode } {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${xml}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  const paragraph = result.part.root.children
    .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
    .find((child): child is OoxmlParagraphNode => child.kind === 'paragraph');
  if (!paragraph) throw new Error('paragraph is missing');
  return { part: result.part, paragraph };
}

function descendants(node: OoxmlNode): OoxmlNode[] {
  if (node.kind === 'textValue') return [node];
  return [node, ...node.children.flatMap(descendants)];
}

describe('inline container depth parity', () => {
  test('all paragraph consumers stop at the same mixed-container boundary', () => {
    const addressable = mixedContainers(MAX_INLINE_CONTAINER_DEPTH - 1, 'visible', 'seen');
    const capped = mixedContainers(MAX_INLINE_CONTAINER_DEPTH, 'capped', 'hidden');
    const pastCap = mixedContainers(MAX_INLINE_CONTAINER_DEPTH + 1, 'past', 'hidden-too');
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p>${addressable}${capped}${pastCap}` +
        `${inlineControl('later', 'later')}</w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const paragraph = result.part.root.children
      .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
      .find((child): child is OoxmlParagraphNode => child.kind === 'paragraph');
    if (!paragraph) throw new Error('paragraph is missing');

    const text = paragraphTextOf(result.part, paragraph.id);
    const layoutText = piecesOfParagraph(paragraph)
      .map((piece) => piece.text)
      .join('');
    const projectedText = treeToDoc(result.part).textContent;
    const offsets = paragraphOffsetIndex(paragraph);

    expect(text).toBe('seenlater');
    expect(layoutText).toBe(text);
    expect(projectedText).toBe(text);
    expect(offsets.length).toBe(text.length);
    expect(
      inlineContentControlsAt(paragraph, 1).every((control) => control.tag?.startsWith('visible'))
    ).toBe(true);
    expect(inlineContentControlsAt(paragraph, 1).length).toBeGreaterThan(0);
    expect(inlineContentControlsAt(paragraph, 4).map((control) => control.tag)).toEqual(['later']);
  });

  test('named owners stop at the shared addressability boundary', () => {
    const addressable = loadedParagraph(nestedOwner(MAX_INLINE_CONTAINER_DEPTH - 1, 'bdo'));
    const addressableOwner = descendants(addressable.paragraph).find(
      (node) => node.kind === 'generic' && node.localName === 'bdo'
    );
    if (!addressableOwner) throw new Error('addressable owner is missing');
    const op = {
      op: 'insertText' as const,
      paragraphId: addressable.paragraph.id,
      offset: 1,
      text: 'X',
      inside: addressableOwner.id,
    };
    expect(validateTreeOp(addressable.part, op)).toBeNull();
    const inserted = applyTreeOp(addressable.part, op);
    if (!inserted.ok) throw new Error(inserted.reason);
    const insertedParagraph = descendants(inserted.part.root).find(
      (node): node is OoxmlParagraphNode => node.kind === 'paragraph'
    );
    if (!insertedParagraph) throw new Error('inserted paragraph is missing');
    expect(paragraphTextOf(inserted.part, insertedParagraph.id)).toBe('AX');
    expect(
      piecesOfParagraph(insertedParagraph)
        .map((piece) => piece.text)
        .join('')
    ).toBe('AX');

    for (const ownerKind of ['bdo', 'control'] as const) {
      const opaque = loadedParagraph(nestedOwner(MAX_INLINE_CONTAINER_DEPTH, ownerKind));
      const owner =
        ownerKind === 'bdo'
          ? descendants(opaque.paragraph).find(
              (node) => node.kind === 'generic' && node.localName === 'bdo'
            )
          : descendants(opaque.paragraph)
              .filter((node) => node.kind === 'contentControl')
              .at(-1);
      if (!owner) throw new Error(`${ownerKind} owner is missing`);
      const opaqueOp = {
        op: 'insertText' as const,
        paragraphId: opaque.paragraph.id,
        offset: 0,
        text: 'X',
        inside: owner.id,
      };
      expect(validateTreeOp(opaque.part, opaqueOp)).toBe('not-a-content-control');
      const refused = applyTreeOp(opaque.part, opaqueOp);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.reason).toBe('not-a-content-control');
    }
  });

  test('demoted content controls consume the shared container budget', () => {
    const wrapper = '<w:bdo><w:r><w:t>A</w:t></w:r></w:bdo>';
    const addressable = loadedParagraph(
      demotedControlsAround(MAX_INLINE_CONTAINER_DEPTH - 2, wrapper)
    );
    const addressableOwner = descendants(addressable.paragraph).find(
      (node) => node.kind === 'generic' && node.localName === 'bdo'
    );
    if (!addressableOwner) throw new Error('addressable demoted owner is missing');
    expect(
      descendants(addressable.paragraph).filter(
        (node) => node.kind === 'generic' && node.localName === 'sdt'
      )
    ).toHaveLength(MAX_INLINE_CONTAINER_DEPTH - 2);
    const inserted = applyTreeOp(addressable.part, {
      op: 'insertText',
      paragraphId: addressable.paragraph.id,
      offset: 1,
      text: 'X',
      inside: addressableOwner.id,
    });
    if (!inserted.ok) throw new Error(inserted.reason);
    const insertedParagraph = descendants(inserted.part.root).find(
      (node): node is OoxmlParagraphNode => node.kind === 'paragraph'
    );
    if (!insertedParagraph) throw new Error('inserted demoted paragraph is missing');
    expect(paragraphTextOf(inserted.part, insertedParagraph.id)).toBe('AX');
    expect(
      piecesOfParagraph(insertedParagraph)
        .map((piece) => piece.text)
        .join('')
    ).toBe('AX');

    for (const count of [MAX_INLINE_CONTAINER_DEPTH - 1, MAX_INLINE_CONTAINER_DEPTH]) {
      const opaque = loadedParagraph(demotedControlsAround(count, wrapper));
      const owner = descendants(opaque.paragraph).find(
        (node) => node.kind === 'generic' && node.localName === 'bdo'
      );
      if (!owner) throw new Error('opaque demoted owner is missing');
      expect(paragraphTextOf(opaque.part, opaque.paragraph.id)).toBe('');
      expect(
        piecesOfParagraph(opaque.paragraph)
          .map((piece) => piece.text)
          .join('')
      ).toBe('');
      expect(treeToDoc(opaque.part).textContent).toBe('');
      expect(
        validateTreeOp(opaque.part, {
          op: 'insertText',
          paragraphId: opaque.paragraph.id,
          offset: 0,
          text: 'X',
          inside: owner.id,
        })
      ).toBe('not-a-content-control');
    }
  });
});
