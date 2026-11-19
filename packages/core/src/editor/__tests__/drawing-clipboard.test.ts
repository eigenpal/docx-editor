// Copy, cut and paste of one selected drawing that is not a chart: a line, a text box, a group
// and a picture travel as a one-drawing clipboard fragment, and the paste selects the copy.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { forwardClipboardEvents } from '../chrome-clipboard.ts';
import { createClipboardHandlers } from '../surface-input.ts';
import { buildCopyFlavours } from '../clipboard-copy-payload.ts';
import {
  DRAWING_CLIPBOARD_PARTS_REASON,
  DRAWING_CLIPBOARD_STORY_REASON,
  DRAWING_PASTE_CELLS_REASON,
  GROUP_MEMBER_CLIPBOARD_REASON,
  LINKED_TEXT_BOX_CLIPBOARD_REASON,
  drawingCopyRefusal,
} from '../surface-drawing-clipboard.ts';
import {
  BODY,
  EMU,
  SHAPE_URI,
  SOLID,
  anchor,
  documentBytes,
  drawingNamed,
  mount,
  p,
  saved,
  text,
  wsp,
} from './shape-selection-fixture.ts';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';
import { stubReviewModule } from './review-test-module.ts';

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

async function mounted(
  body = BODY
): Promise<{ editor: DocxEditorInstance; container: HTMLElement }> {
  const result = await mount(body);
  editors.push(result.editor);
  return result;
}

function select(editor: DocxEditorInstance, drawing: AnchoredDrawingRecord): void {
  expect(editor.surface!.selectDrawing(drawing.drawingNodeId, drawing.anchorParagraphId)).toBe(
    true
  );
}

function caretAtEndOf(editor: DocxEditorInstance, paragraph: number): void {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[paragraph]!;
  const offset = paragraphTextOf(surface.session.part(), paragraphId).length;
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

const docPrIds = (xml: string) => [...xml.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1]);
const named = (xml: string, name: string) => xml.split(`name="${name}"`).length - 1;

/** A clipboard event over an in-memory transfer, as the pages and the overlay receive it. */
function clipboardEvent(type: string, data: Map<string, string>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (kind: string, value: string) => data.set(kind, value),
      getData: (kind: string) => data.get(kind) ?? '',
      types: [] as string[],
      items: [] as unknown[],
    },
  });
  return event;
}

test('a copied line pastes as its own line at the caret, selected, in one undo step', async () => {
  const { editor } = await mounted();
  const line = drawingNamed(editor, 2);
  select(editor, line);
  expect(editor.can({ type: 'copy' }).ok).toBe(true);
  expect(editor.can({ type: 'cut' }).ok).toBe(true);
  const flavours = editor.surface!.copyFlavours();
  expect(flavours.reason).toBeUndefined();
  expect(flavours.drawingNodeId).toBe(line.drawingNodeId);
  expect(flavours.chartDrawingNodeId).toBeUndefined();
  expect(flavours.html).toContain('data-docx-fragment=');

  caretAtEndOf(editor, 5);
  const before = await saved(editor);
  const paragraphs = editor.surface!.session.paragraphIds().length;
  expect(editor.surface!.pasteRich(flavours.text, flavours.html)).toBe(true);
  const xml = await saved(editor);
  expect(named(xml, 'Rule')).toBe(2);
  // The copy keeps its geometry and gets a fresh document-unique id.
  const ids = docPrIds(xml);
  expect(new Set(ids).size).toBe(ids.length);
  expect(xml.split(`<wp:extent cx="${200 * EMU}" cy="0"/>`).length - 1).toBe(2);
  // The paste lands no paragraph: the copy joins the caret's paragraph.
  expect(editor.surface!.session.paragraphIds()).toHaveLength(paragraphs);
  // The pasted line is selected, ready to move.
  const selected = editor.snapshot().image;
  expect(selected).not.toBeNull();
  expect(selected!.id).not.toBe(line.drawingNodeId);
  expect(editor.surface!.copyFlavours().drawingNodeId).toBe(selected!.id);

  expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
  expect(await saved(editor)).toBe(before);
});

test('a copied text box keeps its text and survives save and reopen', async () => {
  const bytes = new Uint8Array(readFileSync('examples/vite/public/textboxes.docx'));
  const editor = createDocxEditor({ container: document.createElement('div'), document: bytes });
  editors.push(editor);
  const surface = editor.surface!;
  const box = surface.layout().pages[0]!.anchoredDrawings![0]!;
  select(editor, box);
  const flavours = surface.copyFlavours();
  expect(flavours.drawingNodeId).toBe(box.drawingNodeId);
  caretAtEndOf(editor, 0);
  expect(surface.pasteRich(flavours.text, flavours.html)).toBe(true);
  expect(editor.findMatches('Alpha beta gamma')).toHaveLength(2);

  const reopened = createDocxEditor({
    container: document.createElement('div'),
    document: new Uint8Array(await editor.save()),
  });
  editors.push(reopened);
  const xml = await saved(reopened);
  expect(named(xml, 'Fixed box')).toBe(2);
  expect(docPrIds(xml)).toEqual(['2', '1']);
  // Both boxes keep the page position, so the copy lies on the original, as pasted.
  expect(xml.split('<wp:posOffset>1905000</wp:posOffset>').length - 1).toBe(2);
  expect(reopened.findMatches('Alpha beta gamma')).toHaveLength(2);

  // Inside a text box the copy has nowhere to land, so the paste says why instead of doing nothing.
  expect(surface.setActiveScope(editor.findMatches('Alpha beta gamma')[0]!.scope!)).toBe(true);
  const inside = await saved(editor);
  expect(editor.exec({ type: 'paste', text: flavours.text, html: flavours.html! })).toEqual({
    ok: false,
    code: 'unsupported',
    reason: DRAWING_CLIPBOARD_STORY_REASON,
  });
  expect(await saved(editor)).toBe(inside);
});

test('the cut and paste events carry a shape through the clipboard', async () => {
  const { editor } = await mounted();
  select(editor, drawingNamed(editor, 3));
  // The overlay holds focus while a drawing is selected; its events run as the pages run them.
  const overlay = document.createElement('div');
  overlay.tabIndex = 0;
  document.body.append(overlay);
  overlay.focus();
  const stop = forwardClipboardEvents(overlay, editor);
  // Cancelling the `before*` events lets every browser offer the gesture on the overlay.
  for (const type of ['beforecopy', 'beforecut', 'beforepaste']) {
    const enabling = new Event(type, { cancelable: true });
    overlay.dispatchEvent(enabling);
    expect(enabling.defaultPrevented).toBe(true);
  }
  const data = new Map<string, string>();
  const cut = clipboardEvent('cut', data);
  overlay.dispatchEvent(cut);
  expect(cut.defaultPrevented).toBe(true);
  expect(data.get('text/html')).toBeString();
  expect(data.get('text/plain')).toBe('');
  expect(named(await saved(editor), 'Group')).toBe(0);
  expect(editor.snapshot().image).toBeNull();
  // The overlay goes with the drawing, so the text takes the keyboard back.
  expect(document.activeElement?.classList.contains('docx-pages')).toBe(true);

  caretAtEndOf(editor, 4);
  const paste = clipboardEvent('paste', data);
  overlay.dispatchEvent(paste);
  expect(paste.defaultPrevented).toBe(true);
  const xml = await saved(editor);
  expect(named(xml, 'Group')).toBe(1);
  expect(xml).toContain('<a:srgbClr val="A9D18E"/>');
  expect(editor.snapshot().image).not.toBeNull();

  // Once unbound, the overlay's events reach nothing.
  stop();
  const copy = clipboardEvent('copy', new Map());
  overlay.dispatchEvent(copy);
  expect(copy.defaultPrevented).toBe(false);
});

test('a copied inline picture carries its image part and keeps the caret after it', async () => {
  const PNG = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    ),
    (c) => c.charCodeAt(0)
  );
  const files = unzipSync(documentBytes(p(text('Before'))));
  const picture =
    '<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="7" name="Photo"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr>' +
    '<pic:cNvPr id="7" name="p.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>' +
    '<a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdP"/>' +
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/>' +
    '<a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']!).replace('<w:body>', `<w:body><w:p>${picture}</w:p>`)
  );
  files['word/_rels/document.xml.rels'] = strToU8(
    strFromU8(files['word/_rels/document.xml.rels']!).replace(
      '</Relationships>',
      '<Relationship Id="rIdP" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/p.png"/></Relationships>'
    )
  );
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace(
      '<Default Extension="xml"',
      '<Default Extension="png" ContentType="image/png"/><Default Extension="xml"'
    )
  );
  files['word/media/p.png'] = PNG;
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: zipSync(files),
  });
  editors.push(editor);
  const surface = editor.surface!;
  const [first, second] = surface.session.paragraphIds();
  const drawing = surface
    .layout()
    .pages[0]!.fragments.flatMap((fragment) =>
      'lines' in fragment ? fragment.lines.flatMap((line) => line.drawings ?? []) : []
    )[0]!;
  expect(surface.selectDrawing(drawing.drawingNodeId, first!)).toBe(true);
  const flavours = surface.copyFlavours();
  expect(flavours.drawingNodeId).toBe(drawing.drawingNodeId);
  surface.setSelection({
    anchor: { paragraphId: second!, offset: 6 },
    head: { paragraphId: second!, offset: 6 },
  });
  expect(surface.pasteRich(flavours.text, flavours.html)).toBe(true);
  // An inline copy is not selected: the caret stays after it, so typing continues the line.
  expect(editor.snapshot().image).toBeNull();
  expect(surface.state().selection.head).toEqual({ paragraphId: second!, offset: 7 });
  expect(editor.exec({ type: 'insertText', text: 'After' }).ok).toBe(true);
  expect(paragraphTextOf(surface.session.part(), second!).endsWith('After')).toBe(true);
  const out = unzipSync(new Uint8Array(await editor.save()));
  const xml = strFromU8(out['word/document.xml']!);
  expect(named(xml, 'Photo')).toBe(2);
  const media = Object.keys(out).filter((name) => name.startsWith('word/media/'));
  expect(media.length).toBeGreaterThanOrEqual(1);
  expect(out[media[0]!]).toEqual(PNG);
});

test('a drawing outside the main document, inside a group, or with other parts refuses', async () => {
  const { editor } = await mounted();
  const surface = editor.surface!;
  const line = drawingNamed(editor, 2);
  const header = { kind: 'header', partName: '/word/header1.xml' } as never;
  expect(drawingCopyRefusal(surface.session, header, line)).toBe(DRAWING_CLIPBOARD_STORY_REASON);
  expect(
    drawingCopyRefusal(surface.session, { kind: 'body' }, { ...line, groupMemberSelected: true })
  ).toBe(GROUP_MEMBER_CLIPBOARD_REASON);
  expect(drawingCopyRefusal(surface.session, { kind: 'body' }, line)).toBeNull();

  // A shape that names a part other than an image cannot travel whole, so the copy refuses.
  const files = unzipSync(
    documentBytes(
      p(
        anchor({
          id: 4,
          name: 'Linked',
          x: 0,
          y: 0,
          cx: 100 * EMU,
          cy: 40 * EMU,
          graphic: wsp(100 * EMU, 40 * EMU, 'rect', SOLID('FFE699')).replace(
            '<wps:bodyPr/>',
            '<wps:bodyPr/><wps:extLst xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><a:ext uri="x" r:id="rIdData"/></wps:extLst>'
          ),
          uri: SHAPE_URI,
        }) + text('Body')
      )
    )
  );
  files['word/_rels/document.xml.rels'] = strToU8(
    strFromU8(files['word/_rels/document.xml.rels']!).replace(
      '</Relationships>',
      '<Relationship Id="rIdData" Type="http://example.com/data" Target="data/item1.xml"/></Relationships>'
    )
  );
  files['word/data/item1.xml'] = strToU8('<data/>');
  const linked = createDocxEditor({
    container: document.createElement('div'),
    document: zipSync(files),
  });
  editors.push(linked);
  select(linked, linked.surface!.layout().pages[0]!.anchoredDrawings![0]!);
  const refused = { ok: false, code: 'unsupported', reason: DRAWING_CLIPBOARD_PARTS_REASON };
  expect(linked.can({ type: 'copy' })).toMatchObject(refused);
  expect(linked.can({ type: 'cut' })).toMatchObject(refused);
  expect(linked.exec({ type: 'copy' })).toMatchObject(refused);
  expect(linked.surface!.copyFlavours()).toMatchObject({
    html: null,
    reason: 'unsupported-content',
  });
});

const VML_BOX =
  '<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" ' +
  'xmlns:o="urn:schemas-microsoft-com:office:office" id="Box" o:spid="_x0000_s1026" ' +
  'style="position:absolute;margin-left:10pt;margin-top:10pt;width:100pt;height:40pt;z-index:1">' +
  '<v:textbox><w:txbxContent><w:p><w:r><w:t>Legacy box</w:t></w:r></w:p></w:txbxContent>' +
  '</v:textbox></v:shape></w:pict></w:r>';

test('an overlay inside the pages pastes once, and a refused cut writes no clipboard', async () => {
  const { editor, container } = await mounted();
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  const overlay = document.createElement('div');
  overlay.tabIndex = 0;
  pages.append(overlay);
  const stop = forwardClipboardEvents(overlay, editor);
  select(editor, drawingNamed(editor, 2));
  const data = new Map<string, string>();
  overlay.dispatchEvent(clipboardEvent('copy', data));
  caretAtEndOf(editor, 5);
  overlay.dispatchEvent(clipboardEvent('paste', data));
  // The pages do not run the overlay's paste a second time.
  expect(named(await saved(editor), 'Rule')).toBe(2);
  stop();

  // A cut whose delete refuses leaves the clipboard as it was: a cut is never a copy.
  select(editor, drawingNamed(editor, 2));
  const surface = editor.surface!;
  const refusing = Object.create(surface) as typeof surface;
  refusing.deleteImage = () => ({ ok: false, reason: 'locked' }) as never;
  const written = new Map<string, string>();
  const cut = clipboardEvent('cut', written);
  createClipboardHandlers(refusing).onCut(cut as ClipboardEvent);
  expect(written.size).toBe(0);
  expect(named(await saved(editor), 'Rule')).toBe(2);
});

const VML_CHAIN = (id: number, next: string) =>
  `<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" ` +
  `xmlns:o="urn:schemas-microsoft-com:office:office" id="_x0000_s${id}" o:spid="_x0000_s${id}" ` +
  `style="position:absolute;margin-left:10pt;margin-top:${id - 1000}pt;width:100pt;height:40pt">` +
  `<v:textbox${next}><w:txbxContent><w:p><w:r><w:t>Chain ${id}</w:t></w:r></w:p>` +
  '</w:txbxContent></v:textbox></v:shape></w:pict></w:r>';

test('a pasted legacy text box chain links its own renumbered boxes', async () => {
  const { editor } = await mounted(
    p(
      VML_CHAIN(1026, ' style="mso-next-textbox:#_x0000_s1027"') +
        VML_CHAIN(1027, '') +
        text('Chain')
    ) + p(text('Target'))
  );
  const surface = editor.surface!;
  const [first] = surface.session.paragraphIds();
  const end = paragraphTextOf(surface.session.part(), first!).length + 2;
  surface.setSelection({
    anchor: { paragraphId: first!, offset: 0 },
    head: { paragraphId: first!, offset: end },
  });
  const flavours = surface.copyFlavours();
  caretAtEndOf(editor, 1);
  expect(surface.pasteRich(flavours.text, flavours.html)).toBe(true);
  const xml = await saved(editor);
  const spids = [...xml.matchAll(/o:spid="_x0000_s(\d+)"/g)].map((match) => match[1]!);
  expect(spids).toHaveLength(4);
  expect(new Set(spids).size).toBe(4);
  const links = [...xml.matchAll(/mso-next-textbox:#_x0000_s(\d+)/g)].map((match) => match[1]);
  // The source links 1026 to 1027; the copy links its first box to its own second box.
  expect(links).toEqual(['1027', spids[3]]);
});

test('a text box with a compatibility fallback gives other applications its text once', async () => {
  const box = anchor({
    id: 6,
    name: 'Wrapped',
    x: 0,
    y: 0,
    cx: 100 * EMU,
    cy: 40 * EMU,
    graphic: wsp(100 * EMU, 40 * EMU, 'rect', SOLID('FFE699')).replace(
      '<wps:bodyPr/>',
      '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Hello box</w:t></w:r></w:p></w:txbxContent>' +
        '</wps:txbx><wps:bodyPr/>'
    ),
    uri: SHAPE_URI,
  })
    .replace('<w:r><w:drawing>', '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>')
    .replace(
      '</w:drawing></w:r>',
      `</w:drawing></mc:Choice><mc:Fallback>${VML_BOX.replace('Legacy box', 'Hello box').slice(5, -6)}` +
        '</mc:Fallback></mc:AlternateContent></w:r>'
    );
  const { editor } = await mounted(p(box + text('Body')) + p(text('Target')));
  select(editor, editor.surface!.layout().pages[0]!.anchoredDrawings![0]!);
  const flavours = editor.surface!.copyFlavours();
  expect(flavours.text).toBe('Hello box');
  expect(flavours.html).toContain('<p>Hello box</p>');
  expect(flavours.html!.split('<p>Hello box</p>')).toHaveLength(2);
});

test('a copied drawing pasted while viewing refuses with the viewing reason', async () => {
  const { editor } = await mounted();
  select(editor, drawingNamed(editor, 2));
  const flavours = editor.surface!.copyFlavours();
  caretAtEndOf(editor, 5);
  editor.surface!.setEditingMode('view');
  expect(editor.surface!.pasteRich(flavours.text, flavours.html)).toBe(false);
  expect(editor.surface!.state().lastRejection).toBe('the document is open for viewing');
  expect(named(await saved(editor), 'Rule')).toBe(1);
});

test('paste without formatting arms from the overlay', async () => {
  const { editor } = await mounted();
  const overlay = document.createElement('div');
  document.body.append(overlay);
  const stop = forwardClipboardEvents(overlay, editor);
  select(editor, drawingNamed(editor, 2));
  const data = new Map<string, string>();
  overlay.dispatchEvent(clipboardEvent('copy', data));
  caretAtEndOf(editor, 5);
  const shortcut = { key: 'V', shiftKey: true, ctrlKey: true, bubbles: true };
  overlay.dispatchEvent(new KeyboardEvent('keydown', shortcut));
  // Browsers run this paste only in editable content, so the pages take the keyboard.
  expect(document.activeElement?.classList.contains('docx-pages')).toBe(true);
  overlay.dispatchEvent(clipboardEvent('paste', data));
  // The forced plain paste lands the line's text, which is nothing: no second line.
  expect(named(await saved(editor), 'Rule')).toBe(1);
  stop();
});

test('a legacy VML text box copies, cuts and pastes with its text', async () => {
  const { editor } = await mounted(p(VML_BOX + text('Anchor')) + p(text('Target')));
  const box = editor.surface!.layout().pages[0]!.anchoredDrawings![0]!;
  select(editor, box);
  expect(editor.can({ type: 'copy' }).ok).toBe(true);
  const flavours = editor.surface!.copyFlavours();
  expect(flavours.text).toBe('Legacy box');
  expect(flavours.html).toContain('<p>Legacy box</p>');
  caretAtEndOf(editor, 1);
  expect(editor.surface!.pasteRich(flavours.text, flavours.html)).toBe(true);
  const xml = await saved(editor);
  expect(xml.split('<w:pict>').length - 1).toBe(2);
  // The copy gets its own shape number, so it does not name the same shape as its source.
  const spids = [...xml.matchAll(/o:spid="(_x0000_s\d+)"/g)].map((match) => match[1]);
  expect(spids).toHaveLength(2);
  expect(new Set(spids).size).toBe(2);
  expect(spids).toContain('_x0000_s1026');
  expect(editor.findMatches('Legacy box')).toHaveLength(2);
  expect(editor.snapshot().image).not.toBeNull();
  // The pasted copy is selected, so a cut takes it straight back out.
  expect(editor.exec({ type: 'cut' })).toMatchObject({ ok: true });
  expect(editor.findMatches('Legacy box')).toHaveLength(1);
});

test('a text box linked to another refuses to copy with its reason', async () => {
  const box = (link: string) =>
    anchor({
      id: 5,
      name: 'Chained',
      x: 0,
      y: 0,
      cx: 100 * EMU,
      cy: 40 * EMU,
      graphic: wsp(100 * EMU, 40 * EMU, 'rect', SOLID('FFE699')).replace(
        '<wps:bodyPr/>',
        `${link}<wps:bodyPr/>`
      ),
      uri: SHAPE_URI,
    });
  const vml = VML_BOX.replace('<v:textbox>', '<v:textbox style="mso-next-textbox:#Next">');
  for (const drawing of [
    box('<wps:linkedTxbx id="1" seq="1"/>'),
    box('<wps:txbx id="1"><w:txbxContent><w:p/></w:txbxContent></wps:txbx>'),
    vml,
  ]) {
    const { editor } = await mounted(p(drawing + text('Body')));
    select(editor, editor.surface!.layout().pages[0]!.anchoredDrawings![0]!);
    const refused = { ok: false, code: 'unsupported', reason: LINKED_TEXT_BOX_CLIPBOARD_REASON };
    expect(editor.can({ type: 'copy' })).toMatchObject(refused);
    expect(editor.exec({ type: 'copy' })).toMatchObject(refused);
    expect(editor.exec({ type: 'cut' })).toMatchObject(refused);
    expect(editor.surface!.copyFlavours()).toMatchObject({ html: null });
    expect(editor.surface!.state().lastRejection).toBe(LINKED_TEXT_BOX_CLIPBOARD_REASON);
  }
});

test('other applications read a text box as its text and a line as nothing', async () => {
  const { editor } = await mounted();
  select(editor, drawingNamed(editor, 2));
  const line = editor.surface!.copyFlavours();
  expect(line.text).toBe('');
  // No empty paragraph for other applications: the wrapper holds the fragment and nothing else.
  expect(line.html).toMatch(/^<div data-docx-editor-drawing="1" [^>]*><\/div>$/);

  const bytes = new Uint8Array(readFileSync('examples/vite/public/textboxes.docx'));
  const boxes = createDocxEditor({ container: document.createElement('div'), document: bytes });
  editors.push(boxes);
  select(boxes, boxes.surface!.layout().pages[0]!.anchoredDrawings![0]!);
  const box = boxes.surface!.copyFlavours();
  expect(box.text).toBe('Fixed box\nAlpha beta gamma. Editable textbox content.');
  expect(box.html).toContain('<p>Fixed box</p><p>Alpha beta gamma. Editable textbox content.</p>');
});

test('a drawing over the clipboard budget refuses rather than copying without its image', async () => {
  const { editor } = await mounted();
  const surface = editor.surface!;
  const line = drawingNamed(editor, 2);
  const at = { paragraphId: line.anchorParagraphId, start: 0, end: 1 };
  const coverage = {
    partName: surface.session.part().name,
    paragraphIds: [at.paragraphId],
    startOffset: at.start,
    endOffset: at.end,
    coveredParagraphIds: [],
    fullyCoveredBlockIds: [],
    lastMarkCovered: false,
  };
  const input = { text: '', cellRectangle: false, coverage, pkg: surface.session.currentPackage() };
  expect(buildCopyFlavours({ ...input, maxFragmentBytes: 1, requireFullFragment: true })).toEqual({
    text: '',
    html: null,
    oversized: true,
  });
  // A text range keeps its degrade: the HTML still ships without the fragment.
  expect(buildCopyFlavours({ ...input, maxFragmentBytes: 1 }).html).toBeString();
});

test('a copied drawing refuses to paste over a cell selection', async () => {
  const table =
    '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
    `<w:tr><w:tc>${p(text('A'))}</w:tc><w:tc>${p(text('B'))}</w:tc></w:tr></w:tbl>`;
  const { editor } = await mounted(p(text('Lead')) + table + BODY);
  const surface = editor.surface!;
  select(editor, drawingNamed(editor, 2));
  const flavours = surface.copyFlavours();
  const tableId = surface.layout().pages[0]!.fragments.find((f) => f.kind === 'table')!;
  const { wholeTableCellSelection } = await import('../../layout/semantic-cell-selection.ts');
  surface.setCellSelection(
    wholeTableCellSelection(surface.layout(), (tableId as { tableId: string }).tableId)
  );
  expect(surface.state().cellSelection).not.toBeNull();
  const before = await saved(editor);
  expect(editor.exec({ type: 'paste', text: flavours.text, html: flavours.html! })).toEqual({
    ok: false,
    code: 'unsupported',
    reason: DRAWING_PASTE_CELLS_REASON,
  });
  expect(await saved(editor)).toBe(before);
});

test('suggesting mode proposes the paste and the cut as tracked changes', async () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: documentBytes(BODY),
    author: 'Reviewer',
    modules: [stubReviewModule()],
  });
  editors.push(editor);
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  editor.surface!.setEditingMode('suggest');
  select(editor, drawingNamed(editor, 2));
  const flavours = editor.surface!.copyFlavours();
  caretAtEndOf(editor, 5);
  expect(editor.surface!.pasteRich(flavours.text, flavours.html)).toBe(true);
  let xml = await saved(editor);
  expect(named(xml, 'Rule')).toBe(2);
  expect(xml).toMatch(/<w:ins [^>]*>(?:(?!<\/w:ins>).)*name="Rule"/s);
  // The pasted copy is selected; cutting it while suggesting removes the proposal itself.
  expect(editor.exec({ type: 'cut' })).toMatchObject({ ok: true });
  xml = await saved(editor);
  expect(named(xml, 'Rule')).toBe(1);
  // Cutting the original proposes its deletion and keeps it in the file.
  select(editor, drawingNamed(editor, 2));
  expect(editor.exec({ type: 'cut' })).toMatchObject({ ok: true });
  xml = await saved(editor);
  expect(named(xml, 'Rule')).toBe(1);
  expect(xml).toMatch(/<w:del [^>]*>(?:(?!<\/w:del>).)*name="Rule"/s);
});
