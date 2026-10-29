// The Vue twin of `packages/react/test/paragraph-style-labels.test.tsx`.

import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { h } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import { en } from '@docx-editor.dev/i18n';
import { LocaleProvider } from '../src/i18n';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { flush, mountEditorTree, type MountedEditor } from './helpers/mount';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const style = (id: string, name: string, extra = '') =>
  `<w:style w:type="paragraph" w:styleId="${id}"${extra}><w:name w:val="${name}"/></w:style>`;

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
    `<Relationships xmlns="${REL}"><Relationship Id="rIdStyles" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
  ),
  'word/styles.xml': strToU8(
    `<w:styles xmlns:w="${W}">` +
      style('Normal', 'Normal', ' w:default="1"') +
      style('Title', 'Title') +
      style('Ttulo1', 'heading 1') +
      style('Heading2', 'Heading 2') +
      style('NoSpacing', 'No Spacing') +
      style('ListParagraph', 'List Paragraph') +
      style('Callout', 'Callout') +
      '</w:styles>'
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>`
  ),
});

const CATALOGUE = {
  ...en,
  styles: {
    ...en.styles,
    normal: 'Padrão',
    title: 'Título',
    headingLevel: 'Título {level}',
    noSpacing: 'Sem Espaçamento',
    listParagraph: 'Parágrafo da Lista',
  },
};

const mounted: MountedEditor[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
});

test('built-in styles take the catalogue label, and the document own styles keep their name', async () => {
  const view = mountEditorTree(
    () => [h(DocxEditorToolbar)],
    SOURCE,
    () => [],
    undefined,
    {},
    (root) => h(LocaleProvider, { i18n: CATALOGUE as typeof en }, { default: () => root })
  );
  mounted.push(view);
  await flush();
  const trigger = view.container.querySelector(
    '[data-slot="styles.style"] .docx-toolbar__style-trigger'
  ) as HTMLButtonElement;
  expect(trigger.textContent).toBe('Padrão');
  trigger.click();
  await flush();
  const rows = [...view.container.querySelectorAll('[data-slot="styles.style"] [role="option"]')];
  expect(rows.map((row) => row.querySelector('span')?.textContent)).toEqual([
    'Padrão',
    'Título',
    'Título 1',
    'Título 2',
    'Sem Espaçamento',
    'Parágrafo da Lista',
    'Callout',
  ]);
});
