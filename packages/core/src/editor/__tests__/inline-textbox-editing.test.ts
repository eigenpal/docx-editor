// Inline text boxes: Find reaches their story, a click or a match enters it, and edits use
// the same frame scope as an anchored text box.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { selectedDrawingOverlayTargetOf, selectedImageStateOf } from '../docx-editor-images.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** An inline text box in an `mc:AlternateContent` run, as Word writes one. */
export function inlineTextboxRun(text: string, id = 7): string {
  return (
    `<w:r><mc:AlternateContent xmlns:mc="${MC}" xmlns:wps="${WPS}"><mc:Choice Requires="wps">` +
    `<w:drawing xmlns:wp="${WP}" xmlns:a="${A}">` +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="1828800" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    `<wp:docPr id="${id}" name="Inline text box ${id}"/>` +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvSpPr txBox="1"/>` +
    '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="457200"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent>` +
    '</wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>' +
    '</mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r>'
  );
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

export function inlineTextboxDocx(
  options: { readonly inCell?: boolean; readonly inHeader?: boolean } = {}
): Uint8Array {
  const host = `<w:p>${run('before ')}${inlineTextboxRun('boxed needle')}${run(' after')}</w:p>`;
  const bodyBox = options.inCell
    ? '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid>' +
      `<w:tr><w:tc>${host}</w:tc></w:tr></w:tbl><w:p/>`
    : host;
  const sectPr = options.inHeader
    ? '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/></w:sectPr>'
    : '';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (options.inHeader
          ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${DOC_REL}"><w:body>` +
        `<w:p>${run('body')}</w:p>${bodyBox}${sectPr}</w:body></w:document>`
    ),
  };
  if (options.inHeader) {
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rHeader" Type="${DOC_REL}/header" Target="header1.xml"/></Relationships>`
    );
    files['word/header1.xml'] = strToU8(
      `<w:hdr xmlns:w="${W}"><w:p>${inlineTextboxRun('header needle', 9)}</w:p></w:hdr>`
    );
  }
  return zipSync(files);
}

test('Find reaches an inline box, and its story takes typing, undo, redo, and save', async () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: inlineTextboxDocx(),
  });
  try {
    const surface = editor.surface!;
    const match = editor.findMatches('boxed needle')[0]!;
    expect(match.scope?.kind).toBe('frame');
    expect(surface.setActiveScope(match.scope!)).toBe(true);
    expect(editor.exec({ type: 'insertText', text: 'New ' }).ok).toBe(true);
    expect(editor.findMatches('New boxed needle')[0]?.scope?.kind).toBe('frame');
    expect(editor.findMatches('before')).toHaveLength(1);
    expect(editor.findMatches('after')).toHaveLength(1);
    editor.exec({ type: 'undo' });
    expect(editor.findMatches('New ')).toHaveLength(0);
    editor.exec({ type: 'redo' });
    expect(editor.findMatches('New boxed needle')).toHaveLength(1);
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: new Uint8Array(await editor.save()),
    });
    try {
      expect(reopened.findMatches('New boxed needle')[0]?.scope?.kind).toBe('frame');
      expect(reopened.findMatches('before')).toHaveLength(1);
    } finally {
      reopened.destroy();
    }
  } finally {
    editor.destroy();
  }
});

test('selecting a match selects the inline box without move or resize', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: inlineTextboxDocx(),
  });
  try {
    const match = editor.findMatches('boxed needle')[0]!;
    expect(editor.selectMatch(match).ok).toBe(true);
    const drawingNodeId = match.scope?.kind === 'frame' ? match.scope.drawingNodeId : '';
    const image = selectedImageStateOf(editor.surface!);
    expect(image?.id).toBe(drawingNodeId);
    expect(image?.kind).toBe('inline');
    expect(image?.canMove).toBe(false);
    expect(image?.canResize).toBe(false);
    expect(image?.canChangeWrap).toBe(false);
    const overlay = selectedDrawingOverlayTargetOf(editor.surface!);
    expect(overlay?.textbox).toBe(true);
    expect(overlay?.canMove).toBe(false);
    expect(overlay?.canResize).toBe(false);
  } finally {
    editor.destroy();
  }
});

test('a press on the inline box text enters its story', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: inlineTextboxDocx() });
  try {
    const content = container.querySelector('.docx-drawing-textbox-content')!;
    content.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
    );
    expect(editor.surface!.activeScope().kind).toBe('frame');
    const box = container.querySelector<HTMLElement>('[data-docx-textbox-active="true"]');
    expect(box?.closest('[data-line-id]')).not.toBeNull();
    expect(box?.querySelector('[data-paragraph-id]')).not.toBeNull();
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('the caret paints inside the inline box at its line position', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: inlineTextboxDocx() });
  try {
    const surface = editor.surface!;
    surface.focus();
    const match = editor.findMatches('boxed needle')[0]!;
    expect(surface.setActiveScope(match.scope!)).toBe(true);
    surface.setSelection({
      anchor: { paragraphId: match.blockId, offset: 6 },
      head: { paragraphId: match.blockId, offset: 6 },
    });
    const caret = container.querySelector<HTMLElement>('[data-docx-caret]')!;
    const content = container.querySelector<HTMLElement>(
      '[data-docx-textbox-active="true"] .docx-drawing-textbox-content'
    )!;
    expect(caret.parentElement).toBe(content);
    expect(parseFloat(caret.style.left)).toBeGreaterThan(0);
    expect(parseFloat(caret.style.left)).toBeLessThan(parseFloat(content.style.width));
    expect(parseFloat(caret.style.top)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(caret.style.top)).toBeLessThan(parseFloat(content.style.height));
    surface.setActiveScope({ kind: 'body' });
    expect(container.querySelector('[data-docx-caret]')?.parentElement?.className).toBe(
      'docx-page-content'
    );
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('boundary deletion and select all stay inside the inline box', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: inlineTextboxDocx(),
  });
  try {
    const surface = editor.surface!;
    const match = editor.findMatches('boxed needle')[0]!;
    surface.setActiveScope(match.scope!);
    surface.setSelection({
      anchor: { paragraphId: match.blockId, offset: 0 },
      head: { paragraphId: match.blockId, offset: 0 },
    });
    surface.deleteBackward();
    expect(editor.findMatches('before')).toHaveLength(1);
    expect(editor.findMatches('boxed needle')).toHaveLength(1);
    surface.selectAll();
    expect(surface.selectedText()).toBe('boxed needle');
    expect(editor.exec({ type: 'insertText', text: 'replacement' }).ok).toBe(true);
    expect(editor.findMatches('replacement')[0]?.scope?.kind).toBe('frame');
    expect(editor.findMatches('before')).toHaveLength(1);
    expect(editor.findMatches('after')).toHaveLength(1);
  } finally {
    editor.destroy();
  }
});

test('an inline box in a table cell is editable like an anchored one', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: inlineTextboxDocx({ inCell: true }),
  });
  try {
    const surface = editor.surface!;
    const match = editor.findMatches('boxed needle')[0]!;
    expect(surface.setActiveScope(match.scope!)).toBe(true);
    expect(editor.exec({ type: 'insertText', text: 'Cell ' }).ok).toBe(true);
    expect(editor.findMatches('Cell boxed needle')[0]?.scope?.kind).toBe('frame');
  } finally {
    editor.destroy();
  }
});

test('an inline box in a header is found but stays read-only', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: inlineTextboxDocx({ inHeader: true }),
  });
  try {
    const match = editor.findMatches('header needle')[0]!;
    expect(match.scope?.kind).toBe('frame');
    expect(match.scope?.kind === 'frame' && match.scope.owner).toBeTruthy();
    expect(editor.surface!.setActiveScope(match.scope!)).toBe(false);
  } finally {
    editor.destroy();
  }
});
