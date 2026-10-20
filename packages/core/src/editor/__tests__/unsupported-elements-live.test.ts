import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function source() {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:x="urn:widgets"><w:body><w:p><w:r><w:t>Hello</w:t><x:chip data="one"/></w:r></w:p><x:widget data="two"/><w:p><w:r><w:t>End</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

test('live registrations reveal inline and block unknown content, preserve edits and undo, and leave source XML intact', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: source() });
  try {
    expect(container.querySelectorAll('[data-docx-unsupported]').length).toBe(0);
    expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    const session = editor.surface!.session;
    const selection = editor.surface!.state().selection;
    editor.setUnsupportedElementRules([
      {
        match: (element) => element.namespaceUri === 'urn:widgets',
        layout: { width: 60, height: 30 },
      },
    ]);
    expect(editor.surface!.session).toBe(session);
    expect(editor.surface!.state().selection).toEqual(selection);
    expect(container.querySelectorAll('[data-docx-unsupported]').length).toBe(2);
    const firstBox = container.querySelector<HTMLElement>('[data-docx-unsupported]')!.style.cssText;
    editor.setUnsupportedElementRules([
      {
        match: (element) => element.namespaceUri === 'urn:widgets',
        layout: { width: 90, height: 45 },
      },
    ]);
    expect(container.querySelector<HTMLElement>('[data-docx-unsupported]')!.style.cssText).not.toBe(
      firstBox
    );
    const version = editor.stateVersion();
    editor.setUnsupportedElementRules([
      {
        match: (element) => element.namespaceUri === 'urn:widgets',
        layout: { width: 90, height: 45 },
      },
    ]);
    expect(editor.stateVersion()).toBe(version);
    const saved = await editor.save();
    const xml = strFromU8(unzipSync(new Uint8Array(saved!))['word/document.xml']!);
    expect(xml).toContain('x:chip');
    expect(xml).toContain('x:widget');
    expect(xml).not.toContain('docx-unsupported');
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(editor.surface!.session.bodyText()).not.toContain('XHello');
    editor.setUnsupportedElementRules([]);
    expect(container.querySelectorAll('[data-docx-unsupported]').length).toBe(0);
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('invalid dimensions fail before replacing active registrations', () => {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: source(), unsupportedElementRules: [{}] });
  try {
    expect(container.querySelectorAll('[data-docx-unsupported]').length).toBe(2);
    expect(() =>
      editor.setUnsupportedElementRules([{ layout: { width: NaN, height: 20 } }])
    ).toThrow(RangeError);
    expect(container.querySelectorAll('[data-docx-unsupported]').length).toBe(2);
  } finally {
    editor.destroy();
  }
});
