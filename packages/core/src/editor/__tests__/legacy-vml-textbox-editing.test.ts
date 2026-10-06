// Legacy VML text boxes: Find reaches their story, a match or a press enters it, and edits
// use the same frame scope as a DrawingML text box. The VML shape itself stays read-only.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { selectedImageStateOf } from '../docx-editor-images.ts';
import { paintRemoteSelections } from '../surface-remote-selection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const W10 = 'urn:schemas-microsoft-com:office:word';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

function floatingBox(text: string): string {
  return (
    '<w:r><w:pict><v:rect style="position:absolute;margin-left:200pt;margin-top:0;width:144pt;' +
    'height:48pt;z-index:1;mso-position-horizontal-relative:page" fillcolor="#ccecff">' +
    `<v:textbox><w:txbxContent><w:p>${run(text)}</w:p></w:txbxContent></v:textbox></v:rect></w:pict></w:r>`
  );
}

function inlineBox(text: string): string {
  return (
    '<w:r><w:pict><v:shape type="#_x0000_t202" style="width:144pt;height:36pt;' +
    'mso-position-horizontal-relative:char;mso-position-vertical-relative:line">' +
    `<v:textbox><w:txbxContent><w:p>${run(text)}</w:p></w:txbxContent></v:textbox>` +
    '<w10:anchorlock/></v:shape></w:pict></w:r>'
  );
}

function vmlDocx(box: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:w10="${W10}"><w:body>` +
        `<w:p>${run('body')}</w:p><w:p>${run('before ')}${box}${run(' after')}</w:p>` +
        '</w:body></w:document>'
    ),
  });
}

for (const [kind, box] of [
  ['floating', floatingBox],
  ['inline', inlineBox],
] as const) {
  test(`Find reaches a ${kind} VML box, and its story takes typing, undo, redo, and save`, async () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: vmlDocx(box('boxed needle')),
    });
    try {
      const match = editor.findMatches('boxed needle')[0]!;
      expect(match.scope?.kind).toBe('frame');
      expect(editor.surface!.setActiveScope(match.scope!)).toBe(true);
      expect(editor.exec({ type: 'insertText', text: 'New ' }).ok).toBe(true);
      expect(editor.findMatches('New boxed needle')[0]?.scope?.kind).toBe('frame');
      expect(editor.findMatches('before')).toHaveLength(1);
      editor.exec({ type: 'undo' });
      expect(editor.findMatches('New ')).toHaveLength(0);
      editor.exec({ type: 'redo' });
      const saved = new Uint8Array(await editor.save());
      const xml = strFromU8(unzipSync(saved)['word/document.xml']!);
      expect(xml).toContain('<v:textbox><w:txbxContent>');
      expect(xml).toContain('New boxed needle');
      const reopened = createDocxEditor({
        container: document.createElement('div'),
        document: saved,
      });
      try {
        expect(reopened.findMatches('New boxed needle')[0]?.scope?.kind).toBe('frame');
      } finally {
        reopened.destroy();
      }
    } finally {
      editor.destroy();
    }
  });
}

test('a press on the VML box text enters its story and paints the text', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: vmlDocx(floatingBox('boxed needle')) });
  try {
    const content = container.querySelector('.docx-drawing-textbox-content')!;
    expect(content.textContent).toContain('boxed needle');
    content.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
    );
    expect(editor.surface!.activeScope().kind).toBe('frame');
    const active = container.querySelector<HTMLElement>('[data-docx-textbox-active="true"]');
    expect(active?.querySelector('[data-paragraph-id]')).not.toBeNull();
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('the VML shape frame offers no move, resize, or wrap controls', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: vmlDocx(floatingBox('boxed needle')),
  });
  try {
    const match = editor.findMatches('boxed needle')[0]!;
    expect(editor.selectMatch(match).ok).toBe(true);
    // The legacy shape is a read-only graphic: only its story text is editable.
    expect(selectedImageStateOf(editor.surface!)).toBeNull();
  } finally {
    editor.destroy();
  }
});

test('a remote caret and range paint inside the VML box', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: vmlDocx(floatingBox('boxed needle')),
  });
  try {
    const match = editor.findMatches('boxed needle')[0]!;
    const scope = match.scope;
    if (scope?.kind !== 'frame') throw new Error('Missing text box scope');
    const layout = editor.surface!.layout();
    const drawing = layout.pages[0]!.anchoredDrawings!.find(
      (item) => item.drawingNodeId === scope.drawingNodeId
    )!;
    const remote = {
      actorId: 'peer',
      name: 'Peer',
      anchor: { nodeId: match.blockId, paragraphId: '00000001', offset: 0 },
      head: { nodeId: match.blockId, paragraphId: '00000001', offset: 0 },
    };
    const layer = document.createElement('div');
    paintRemoteSelections(layer, layout, [remote], { scale: 1 });
    const caret = layer.querySelector<HTMLElement>('.docx-remote-caret');
    expect(caret).not.toBeNull();
    expect(Number.parseFloat(caret!.style.left)).toBeGreaterThanOrEqual(drawing.x);
    expect(Number.parseFloat(caret!.style.left)).toBeLessThan(drawing.x + drawing.width);
    paintRemoteSelections(layer, layout, [{ ...remote, head: { ...remote.head, offset: 5 } }], {
      scale: 1,
    });
    expect(layer.querySelectorAll('.docx-remote-selection-rect').length).toBeGreaterThan(0);
  } finally {
    editor.destroy();
  }
});
