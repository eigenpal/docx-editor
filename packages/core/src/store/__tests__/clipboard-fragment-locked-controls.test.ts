import { describe, expect, test } from 'bun:test';
import { serializeOoxmlPart, type OoxmlPackage } from '@docx-editor.dev/core/store';
import { extractFragmentPackage } from '../store/clipboard-fragment-extract.ts';
import {
  bodyOf,
  buildPackage,
  loadPackage,
  paragraphIdsUnder,
} from './clipboard-fragment-fixtures.ts';

const chip = (tag: string, text: string, lock: string): string =>
  `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/><w:lock w:val="${lock}"/></w:sdtPr>` +
  `<w:sdtContent><w:r><w:t>${text}</w:t></w:r></w:sdtContent></w:sdt>`;

const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

function copy(
  pkg: OoxmlPackage,
  paragraphIds: readonly string[],
  startOffset: number,
  endOffset: number
): string {
  const part = pkg.parts.get(pkg.mainDocumentPart)!;
  const result = extractFragmentPackage(pkg, {
    partName: part.name,
    paragraphIds,
    startOffset,
    endOffset,
    coveredParagraphIds: paragraphIds,
    fullyCoveredBlockIds: [],
    lastMarkCovered: false,
  });
  expect(result.ok ? 'ok' : result.reason).toBe('ok');
  if (!result.ok) return '';
  return serializeOoxmlPart(loadPackage(result.bytes).parts.get('/word/document.xml')!);
}

describe('clipboard fragment trim beside protected controls', () => {
  test('a control that cannot be deleted still trims off a copy, and the document keeps it', () => {
    // "Intro [1] end": `sdtContentLocked` forbids deleting the chip in the document. A copy of
    // "Intro" or "end" leaves it out without editing the document.
    const pkg = buildPackage(
      `<w:p>${run('Intro ')}${chip('chip', '[1]', 'sdtContentLocked')}${run(' end')}</w:p>`
    );
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const [id] = paragraphIdsUnder(bodyOf(part));
    for (const [start, end, kept] of [
      [0, 5, 'Intro'],
      [10, 13, 'end'],
    ] as const) {
      const xml = copy(pkg, [id!], start, end);
      expect(xml).toContain(kept);
      expect(xml).not.toContain('w:sdt');
    }
    const chipCopy = copy(pkg, [id!], 6, 9);
    expect(chipCopy).toContain('w:val="sdtContentLocked"');
    expect(chipCopy).toContain('[1]');
    expect(serializeOoxmlPart(pkg.parts.get(pkg.mainDocumentPart)!)).toContain('[1]');
  });

  test('a copy across paragraphs trims protected controls off both edges', () => {
    // "A [1] tail" / "head [2] B": copying "tail ... head" trims a chip off each edge.
    const pkg = buildPackage(
      `<w:p>${run('A ')}${chip('first', '[1]', 'contentLocked')}${run(' tail')}</w:p>` +
        `<w:p>${run('head ')}${chip('second', '[2]', 'sdtContentLocked')}${run(' B')}</w:p>`
    );
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const ids = paragraphIdsUnder(bodyOf(part));
    const xml = copy(pkg, ids, 6, 4);
    expect(xml).toContain('tail');
    expect(xml).toContain('head');
    expect(xml).not.toContain('w:sdt');
  });

  test('a protected chip inside an unlocked control trims off as a node', () => {
    const outer =
      '<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>' +
      `${run('see ')}${chip('inner', '[3]', 'sdtContentLocked')}` +
      '</w:sdtContent></w:sdt>';
    const pkg = buildPackage(`<w:p>${run('Text ')}${outer}</w:p>`);
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const [id] = paragraphIdsUnder(bodyOf(part));
    const xml = copy(pkg, [id!], 0, 4);
    expect(xml).toContain('Text');
    expect(xml).not.toContain('[3]');
  });
});
