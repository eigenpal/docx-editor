// A heading click in the navigation pane or the outline goes to the heading text.
//
// A heading that opens with a page break lays the break out at the bottom of the previous
// page. Offset 0 is that break, so a caret there sits on the wrong page and typing lands in
// front of the break. The click puts the caret at the start of the text instead.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { h } from 'vue';
import { strToU8, zipSync } from 'fflate';
import { DocxEditorNavigation } from '../src/editor/navigation';
import { DocxEditorDocumentOutline } from '../src/editor/DocxEditorOutline';
import { flush, mountEditorTree, type MountedEditor } from './helpers/mount';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const heading = (runs: string) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${runs}</w:p>`;
const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;

const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLES}" Target="styles.xml"/></Relationships>`
  ),
  'word/styles.xml': strToU8(
    `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
      '<w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>' +
      '</w:styles>'
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body>` +
      heading(text('First heading')) +
      heading('<w:r><w:br w:type="page"/></w:r>' + text('Second heading')) +
      '</w:body></w:document>'
  ),
});

const mounted: MountedEditor[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
});

function mount(outline: 'navigation' | 'outline'): MountedEditor {
  const view = mountEditorTree(
    () => [],
    SOURCE,
    () => [h(outline === 'navigation' ? DocxEditorNavigation : DocxEditorDocumentOutline)]
  );
  mounted.push(view);
  return view;
}

async function clickHeading(container: HTMLElement, selector: string, title: string) {
  const button = [...container.querySelectorAll<HTMLElement>(selector)].find(
    (element) => element.textContent?.trim() === title
  );
  expect(button).toBeDefined();
  button!.click();
  await flush();
}

describe('heading click past a leading page break', () => {
  for (const [outline, selector] of [
    ['navigation', 'button.docx-nav__heading'],
    ['outline', 'button.docx-outline-heading-btn'],
  ] as const) {
    test(`the ${outline} puts the caret at the heading text`, async () => {
      const view = mount(outline);
      await flush();
      await clickHeading(view.container, selector, 'Second heading');
      const surface = view.editor().surface!;
      const second = surface.session.paragraphIds().at(-1)!;
      // Offset 0 is the break at the bottom of page 1; offset 1 starts the text on page 2.
      expect(surface.state().selection.head).toEqual({ paragraphId: second, offset: 1 });
      expect(surface.state().selection.anchor).toEqual({ paragraphId: second, offset: 1 });

      // A heading without a break keeps its start.
      await clickHeading(view.container, selector, 'First heading');
      const first = surface.session.paragraphIds()[0]!;
      expect(surface.state().selection.head).toEqual({ paragraphId: first, offset: 0 });
    });
  }
});
