// Page breaks that push every later page down in a document with footnotes. The pages after the
// edit are reused some pages away with the footnote space they were laid out under; the
// oracle is a fresh open of the saved document, whose footnote search starts from nothing.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { BlockFragmentRecord } from '../../layout/semantic-records.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const FN = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';

/** 400 paragraphs, a footnote on every 25th, notes of one to three lines. */
function docx(): Uint8Array {
  const paragraphs: string[] = [];
  const notes = [
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>',
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>',
  ];
  for (let index = 0; index < 400; index += 1) {
    let reference = '';
    if (index % 25 === 7) {
      const id = notes.length - 1;
      const text = `Note ${id} `.repeat(1 + (id % 3) * 12);
      notes.push(
        `<w:footnote w:id="${id}"><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:footnote>`
      );
      reference = `<w:r><w:footnoteReference w:id="${id}"/></w:r>`;
    }
    paragraphs.push(`<w:p><w:r><w:t>Paragraph ${index}</w:t></w:r>${reference}</w:p>`);
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${FN}" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${paragraphs.join('')}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${notes.join('')}</w:footnotes>`),
  });
}

/** Each page's lines as `page|text|y`, then its note count. */
function linesOf(surface: PaginatedSurface): string[] {
  const out: string[] = [];
  surface.layout().pages.forEach((page, index) => {
    const visit = (blocks: readonly BlockFragmentRecord[]): void => {
      for (const block of blocks) {
        if (block.kind === 'table') continue;
        for (const line of block.lines) {
          out.push(`${index}|${line.spans.map((span) => span.text).join('')}|${line.box.y}`);
        }
      }
    };
    visit(page.fragments);
    out.push(`${index}|notes|${page.footnotes?.notes.length ?? 0}`);
  });
  return out;
}

function mount(bytes: Uint8Array): { surface: PaginatedSurface; dispose(): void } {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes);
  if (!opened.ok) throw new Error(opened.reason);
  return {
    surface: opened.surface,
    dispose() {
      opened.surface.destroy();
      container.remove();
    },
  };
}

function coldLines(surface: PaginatedSurface): string[] {
  const cold = mount(surface.session.save());
  try {
    return linesOf(cold.surface);
  } finally {
    cold.dispose();
  }
}

test('page breaks that push later pages down end on the layout of a fresh open', () => {
  const { surface, dispose } = mount(docx());
  try {
    expect(linesOf(surface).some((line) => /\|notes\|[1-9]/.test(line))).toBe(true);
    for (const at of [3, 40, 41, 120, 5, 200]) {
      const paragraphId = surface.session.paragraphIds()[at]!;
      surface.setSelection({
        anchor: { paragraphId, offset: 3 },
        head: { paragraphId, offset: 3 },
      });
      surface.insertPageBreak();
      expect(linesOf(surface)).toEqual(coldLines(surface));
    }
    for (let undo = 0; undo < 3; undo += 1) surface.undo();
    expect(linesOf(surface)).toEqual(coldLines(surface));
  } finally {
    dispose();
  }
});
