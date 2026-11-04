// A tracked change inside a text box is a change the reader can reach: it has a range in the
// box's own paragraph, Next and Previous land on it, and the caret in it opens its card.
//
// Without a range the change listed in the pane but nothing could open it, so a document
// whose changes all sat in text boxes reported "no visible changes to review".

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { collectReviewItems, findNode, revisionItemsOf } from '@docx-editor.dev/core/store';
import type { EditorModule } from '../../contracts/modules.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docxOf(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:wps="${WPS}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:v="${V}">` +
        `<w:body>${body}</w:body></w:document>`
    ),
  });
}

/** The engine's own review derivation, wired as a module (core may not import pro). */
function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems,
      revisionItemsOfParagraph: (part, paragraphId) => {
        const paragraph = findNode(part, paragraphId);
        if (!paragraph || paragraph.kind !== 'paragraph') return [];
        return revisionItemsOf({
          id: part.id,
          name: part.name,
          contentType: part.contentType,
          root: paragraph,
        });
      },
    },
  };
}

const INSERTION =
  '<w:p><w:r><w:t xml:space="preserve">In box </w:t></w:r>' +
  '<w:ins w:id="7" w:author="Ada" w:date="2026-11-04T00:00:00Z"><w:r><w:t>added</w:t></w:r></w:ins></w:p>';

const DRAWING_BOX =
  '<w:p><w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="2000000" cy="800000"/>' +
  '<wp:wrapNone/><wp:docPr id="1" name="Box"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
  '<wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm><a:prstGeom prst="rect"/></wps:spPr>' +
  `<wps:txbx><w:txbxContent>${INSERTION}</w:txbxContent></wps:txbx>` +
  '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r><w:r><w:t>Host</w:t></w:r></w:p>';

const VML_BOX =
  '<w:p><w:r><w:pict><v:shape style="width:100pt;height:40pt"><v:textbox><w:txbxContent>' +
  INSERTION +
  '</w:txbxContent></v:textbox></v:shape></w:pict></w:r><w:r><w:t>Host</w:t></w:r></w:p>';

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docxOf(body),
    author: 'Grace',
    modules: [reviewModule()],
  });
  editors.push(editor);
  container.remove();
  return editor;
}

for (const [name, body] of [
  ['DrawingML', DRAWING_BOX],
  ['VML', VML_BOX],
] as const) {
  test(`a change in a ${name} text box has a range in the box and Next Change opens it`, () => {
    const editor = mount(body);
    const [placement] = editor.getReviewItems();
    expect(placement?.activatable).toBe(true);
    const range = placement!.item.ranges[0]!;
    // The box's paragraph, not the host paragraph the box rides in.
    expect(range.start.paragraphId).not.toBe(editor.surface!.session.paragraphIds()[0]);
    expect([range.start.offset, range.end.offset]).toEqual([7, 12]);
    expect(editor.can({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(true);
    expect(editor.exec({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(true);
    expect(editor.getReviewItems()[0]?.isActive).toBe(true);
  });
}
