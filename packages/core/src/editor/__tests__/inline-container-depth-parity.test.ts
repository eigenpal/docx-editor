// Every paragraph-inline consumer uses one total depth for wrappers and content controls.

import { describe, expect, test } from 'bun:test';
import { treeToDoc } from '../../binding/tree-binding.ts';
import { piecesOfParagraph } from '../../layout/field-projection.ts';
import { readOoxmlPart, type OoxmlParagraphNode } from '../../store/package/ooxml-tree.ts';
import { MAX_INLINE_CONTAINER_DEPTH } from '../../store/package/ooxml-shared.ts';
import { paragraphOffsetIndex } from '../../store/store/tree-op-segments.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
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
});
