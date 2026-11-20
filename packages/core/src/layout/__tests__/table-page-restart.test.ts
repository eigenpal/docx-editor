// Restarting a long table's pagination at the page an edit leaves standing, in a whole
// document: two sections with their own header and footer and a different first page, a
// repeated header row, vertical merges that span page breaks, rows that split across a page,
// and footnote references in cells. Every edit must give the layout of the saved document
// opened again, and keep the pages before the restart by identity when no note reserve moves.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../../editor/docx-editor.ts';
import type { TreeDocOp } from '../../store/store/tree-op-types.ts';
import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { tablePageRestartTestRecorder } from '../table-page-restart.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const ROWS = 90;

const p = (text: string, extra = '') =>
  `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r>${extra}</w:p>`;
const note = (id: number) =>
  `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
const tc = (content: string, tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${tcPr}</w:tcPr>${content}</w:tc>`;
const lines = (name: string, count: number) =>
  `<w:p><w:r>${Array.from({ length: count }, (_, i) => `<w:t>${name}-${i}</w:t>`).join('<w:br/>')}</w:r></w:p>`;

/** Row `r`: a merge every five rows, a footnote every eleventh, a tall row every thirteenth. */
function row(r: number): string {
  const vMerge = r % 5 === 1 ? '<w:vMerge w:val="restart"/>' : r % 5 > 1 ? '<w:vMerge/>' : '';
  const second = r % 11 === 4 ? p(`R${r}b`, note(1 + ((r / 11) | 0))) : p(`R${r}b`);
  const third = r % 13 === 6 ? lines(`R${r}c`, 9) : p(`R${r}c`);
  return `<w:tr>${tc(p(`R${r}a`), vMerge)}${tc(second)}${tc(third)}</w:tr>`;
}

const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
    .join('') +
  '</w:tblBorders>';
const TABLE =
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>${BORDERS}</w:tblPr>` +
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>` +
  `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(p('Head A'))}${tc(p('Head B'))}${tc(p('Head C'))}</w:tr>` +
  `${Array.from({ length: ROWS }, (_, r) => row(r)).join('')}</w:tbl>`;
const PAGE =
  '<w:pgSz w:w="7000" w:h="5200"/><w:pgMar w:top="700" w:bottom="700" w:left="400" ' +
  'w:right="400" w:header="200" w:footer="200" w:gutter="0"/>';
const BODY =
  p('Opening section') +
  `<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/>${PAGE}</w:sectPr></w:pPr></w:p>` +
  p('Table section') +
  TABLE +
  p('After the table') +
  `<w:sectPr><w:headerReference w:type="default" r:id="rIdH2"/>` +
  `<w:headerReference w:type="first" r:id="rIdH1"/><w:footerReference w:type="default" r:id="rIdF1"/>` +
  `${PAGE}<w:titlePg/></w:sectPr>`;

function docx(): Uint8Array {
  const override = (part: string, type: string) =>
    `<Override PartName="/word/${part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`;
  const rel = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`;
  const notes = Array.from(
    { length: 10 },
    (_, i) => `<w:footnote w:id="${i + 1}">${p(`Note ${i + 1}`)}</w:footnote>`
  ).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        override('document', 'document.main') +
        override('styles', 'styles') +
        override('footnotes', 'footnotes') +
        override('header1', 'header') +
        override('header2', 'header') +
        override('footer1', 'footer') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">${rel('rId1', 'officeDocument', 'word/document.xml')}</Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        rel('rIdS', 'styles', 'styles.xml') +
        rel('rIdN', 'footnotes', 'footnotes.xml') +
        rel('rIdH1', 'header', 'header1.xml') +
        rel('rIdH2', 'header', 'header2.xml') +
        rel('rIdF1', 'footer', 'footer1.xml') +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${BODY}</w:body></w:document>`
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
        '<w:name w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:style></w:styles>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        `${notes}</w:footnotes>`
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${p('First header')}</w:hdr>`),
    'word/header2.xml': strToU8(`<w:hdr xmlns:w="${W}">${p('Running header')}</w:hdr>`),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${p('Running footer')}</w:ftr>`),
  });
}

const open: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { editor, container } of open.splice(0)) {
    editor.destroy();
    container.remove();
  }
});

function mount(bytes: Uint8Array) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: bytes });
  open.push({ editor, container });
  const surface = editor.surface;
  if (!surface) throw new Error('surface failed to mount');
  surface.layout();
  return { editor, surface, container };
}

/** Keys that name a node or a record. A document opened again gives its nodes other ids. */
const NAMES = /^(id|range|revision|date|key)$|Id$|Ids$|Key$/;

/** Every box, offset, and piece of text a layout places, in page order, without tree nodes. */
function geometryOf(value: unknown, out: string[], depth = 0): void {
  if (depth > 64 || value === null || value === undefined) return;
  if (typeof value === 'number') out.push(String(Math.round(value * 100) / 100));
  else if (typeof value === 'string' || typeof value === 'boolean') out.push(String(value));
  else if (Array.isArray(value)) for (const item of value) geometryOf(item, out, depth + 1);
  // Tree nodes a record carries: a document read again spells their attributes its own way.
  else if (typeof value === 'object' && !('namespaceUri' in value))
    for (const [key, item] of Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (NAMES.test(key)) continue;
      out.push(key);
      geometryOf(item, out, depth + 1);
    }
}

const kids = (node: OoxmlNode | undefined, kind: string): OoxmlElement[] =>
  node && 'children' in node
    ? (node.children as OoxmlNode[]).filter((child): child is OoxmlElement => child.kind === kind)
    : [];

test('row edits restart at the page they leave standing and lay out as the document reopened', () => {
  const view = mount(docx());
  const surface = view.surface;
  const pagesOf = () => surface.layout().pages;
  const table = () => kids(kids(surface.session.part().root, 'body')[0], 'table')[0]!;
  const rows = () => kids(table(), 'tableRow');
  const firstParagraph = (rowIndex: number, cell: number) =>
    kids(kids(rows()[rowIndex]!, 'tableCell')[cell], 'paragraph')[0]!;
  const opened = pagesOf();
  expect(opened.length).toBeGreaterThan(12);
  const textOf = (page: (typeof opened)[number]) => JSON.stringify(page);
  // The section's own furniture and the footnotes are on the table's pages.
  expect(opened.some((page) => textOf(page).includes('Running footer'))).toBe(true);
  expect(opened.filter((page) => page.footnotes).length).toBeGreaterThan(2);

  // Below the last footnote row, an edit moves no note reserve, so the final pass keeps the
  // pages before the restart. Above it, a moved reserve lays the pages out again.
  const belowNotes = new Set(['insert near the end', 'delete near the end']);
  const edits: [string, () => TreeDocOp][] = [
    ['insert near the end', () => insertRow(rows().length - 6, 'below')],
    ['delete near the end', () => deleteRow(rows().length - 4)],
    ['insert in the middle', () => insertRow(48, 'above')],
    ['delete a merge head', () => deleteRow(51)],
    ['enter in a cell', () => split(70, 1)],
    ['enter in a tall row', () => split(rowWith('R71c'), 2)],
    ['insert below a footnote row', () => insertRow(rowWith('R59b'), 'below')],
    ['delete in the middle', () => deleteRow(40)],
  ];
  function insertRow(at: number, where: 'above' | 'below'): TreeDocOp {
    return { op: 'insertTableRow', tableId: table().id, rowId: rows()[at]!.id, where };
  }
  function deleteRow(at: number): TreeDocOp {
    return { op: 'deleteTableRow', tableId: table().id, rowId: rows()[at]!.id };
  }
  function split(at: number, cell: number): TreeDocOp {
    return { op: 'splitParagraph', paragraphId: firstParagraph(at, cell).id, offset: 1 };
  }
  function rowWith(text: string): number {
    return rows().findIndex((entry) => JSON.stringify(entry).includes(`"${text}`));
  }

  let kept = 0;
  for (const [label, edit] of edits) {
    const before = pagesOf();
    const restarts = tablePageRestartTestRecorder();
    surface.session.applyTreeOps([edit()]);
    const after = pagesOf();
    restarts.dispose();
    // The pages before the restart page are the previous pages themselves. A page with notes
    // gets its note area again on every pass, whatever the body did. The restart page index
    // counts from the table's section, which opens on the table's first page.
    const offset = before.findIndex((page) => page.fragments.some((item) => item.kind === 'table'));
    if (belowNotes.has(label)) {
      expect([label, restarts.keptPages > 4]).toEqual([label, true]);
      for (let index = 0; index < offset + restarts.keptPages; index += 1)
        if (!before[index]!.footnotes)
          expect([label, index, after[index] === before[index]]).toEqual([label, index, true]);
    }
    kept += restarts.restarts;
    const fresh = mount(surface.save());
    const live: string[] = [];
    const again: string[] = [];
    geometryOf(after, live);
    geometryOf(fresh.surface.layout().pages, again);
    expect([label, live.join('\n')]).toEqual([label, again.join('\n')]);
    fresh.editor.destroy();
    fresh.container.remove();
    open.pop();
  }
  // Most edits restart; a restart is refused only where the state at a page top is open.
  expect(kept).toBeGreaterThanOrEqual(5);
}, 120_000);
