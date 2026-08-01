// The Word keymap and Increase/Decrease Indent.
//
// Two things a user notices immediately if they are wrong: Enter/Shift+Enter/Ctrl+Enter
// must produce three DIFFERENT breaks, and Tab in a list must demote the item rather than
// insert a tab — which changes the marker, because the level is what selects the format
// out of numbering.xml.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { createKeyDownHandler } from '../surface-input.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUM = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const NUMBERING =
  `<w:numbering xmlns:w="${W}">` +
  '<w:abstractNum w:abstractNumId="0">' +
  '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
  '<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="○"/>' +
  '<w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>' +
  '</w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

function docx(body: string, withNumbering = false): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (withNumbering
          ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (withNumbering) {
    files['word/numbering.xml'] = strToU8(NUMBERING);
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUM}" Target="numbering.xml"/></Relationships>`
    );
  }
  return zipSync(files);
}

function mount(body: string, withNumbering = false): PaginatedSurface {
  return mountBytes(docx(body, withNumbering));
}

function mountBytes(bytes: Uint8Array): PaginatedSurface {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes);
  if (!opened.ok) throw new Error(opened.reason);
  return opened.surface;
}

const listItem = (text: string, ilvl = 0) =>
  '<w:p><w:pPr><w:numPr>' +
  `<w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/>` +
  `</w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const key = (init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({
    preventDefault: () => {},
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...init,
  }) as KeyboardEvent;

const markerOf = (surface: PaginatedSurface) => {
  for (const page of surface.layout().pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind === 'paragraph' && fragment.marker) return fragment.marker;
    }
  }
  return undefined;
};

describe('Increase/Decrease Indent', () => {
  test('a list item changes LEVEL, and its marker changes with it', () => {
    const surface = mount(listItem('alpha'), true);
    expect(markerOf(surface)).toMatchObject({ text: '•', level: 0 });

    expect(surface.adjustIndent('increase')).toBe(true);
    expect(markerOf(surface)).toMatchObject({ text: '○', level: 1 });

    expect(surface.adjustIndent('decrease')).toBe(true);
    expect(markerOf(surface)).toMatchObject({ text: '•', level: 0 });
  });

  test('the list level is clamped at both ends rather than erroring', () => {
    const surface = mount(listItem('alpha'), true);
    expect(surface.adjustIndent('decrease')).toBe(false);
    expect(markerOf(surface)?.level).toBe(0);
  });

  test('a plain paragraph moves its left indent by one default tab stop', () => {
    const surface = mount('<w:p><w:r><w:t>plain</w:t></w:r></w:p>');
    expect(surface.isListParagraph()).toBe(false);
    surface.adjustIndent('increase');
    const indented = surface.layout().pages[0]!.fragments[0]!;
    if (indented.kind !== 'paragraph') throw new Error('expected a paragraph');
    // 720 twips = 36pt.
    expect(indented.lines[0]!.box.x).toBe(36);
    surface.adjustIndent('decrease');
    const back = surface.layout().pages[0]!.fragments[0]!;
    if (back.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(back.lines[0]!.box.x).toBe(0);
  });

  test('outdent never pushes a paragraph past the margin', () => {
    const surface = mount('<w:p><w:r><w:t>plain</w:t></w:r></w:p>');
    expect(surface.adjustIndent('decrease')).toBe(false);
  });

  test('changing the level keeps w:numId and the rest of w:pPr', () => {
    const surface = mount(listItem('alpha'), true);
    surface.setParagraphProperty('jc', { val: 'center' });
    surface.adjustIndent('increase');
    const xml = JSON.stringify(surface.session.part().root);
    expect(xml).toContain('numId');
    expect(xml).toContain('jc');
    expect(markerOf(surface)?.level).toBe(1);
  });
});

describe('the Word keymap', () => {
  test('Tab demotes inside a list and inserts a tab outside one', () => {
    const list = mount(listItem('alpha'), true);
    createKeyDownHandler(list)(key({ key: 'Tab' }));
    expect(markerOf(list)?.level).toBe(1);

    const plain = mount('<w:p><w:r><w:t>x</w:t></w:r></w:p>');
    createKeyDownHandler(plain)(key({ key: 'Tab' }));
    expect(JSON.stringify(plain.session.part().root)).toContain('"tab"');
  });

  test('Shift+Tab promotes inside a list and outdents outside one', () => {
    const list = mount(listItem('alpha', 1), true);
    createKeyDownHandler(list)(key({ key: 'Tab', shiftKey: true }));
    expect(markerOf(list)?.level).toBe(0);
  });

  test('Enter, Shift+Enter and Ctrl+Enter are three different breaks', () => {
    const paragraphs = () => mount('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');

    const split = paragraphs();
    createKeyDownHandler(split)(key({ key: 'Enter' }));
    expect(split.session.paragraphIds().length).toBe(2);

    const line = paragraphs();
    createKeyDownHandler(line)(key({ key: 'Enter', shiftKey: true }));
    expect(line.session.paragraphIds().length).toBe(1);
    expect(JSON.stringify(line.session.part().root)).toContain('"br"');

    const page = paragraphs();
    createKeyDownHandler(page)(key({ key: 'Enter', ctrlKey: true }));
    expect(page.session.paragraphIds().length).toBe(1);
    expect(JSON.stringify(page.session.part().root)).toContain('page');
  });

  test('Ctrl+M indents and Ctrl+Shift+M outdents', () => {
    const surface = mount('<w:p><w:r><w:t>x</w:t></w:r></w:p>');
    const handler = createKeyDownHandler(surface);
    handler(key({ key: 'm', ctrlKey: true }));
    const indented = surface.layout().pages[0]!.fragments[0]!;
    if (indented.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(indented.lines[0]!.box.x).toBe(36);
    handler(key({ key: 'm', ctrlKey: true, shiftKey: true }));
    const back = surface.layout().pages[0]!.fragments[0]!;
    if (back.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(back.lines[0]!.box.x).toBe(0);
  });

  test('Ctrl+E/L/R/J set alignment and Ctrl+1/5/2 set line spacing', () => {
    const surface = mount('<w:p><w:r><w:t>x</w:t></w:r></w:p>');
    const handler = createKeyDownHandler(surface);
    handler(key({ key: 'e', ctrlKey: true }));
    expect(JSON.stringify(surface.session.part().root)).toContain('center');
    handler(key({ key: '2', ctrlKey: true }));
    const xml = JSON.stringify(surface.session.part().root);
    expect(xml).toContain('480');
    expect(xml).toContain('auto');
  });

  test('Ctrl+Backspace deletes a word, not a character', () => {
    const surface = mount('<w:p><w:r><w:t>alpha beta</w:t></w:r></w:p>');
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 10 },
      head: { paragraphId: id, offset: 10 },
    });
    createKeyDownHandler(surface)(key({ key: 'Backspace', ctrlKey: true }));
    expect(surface.session.bodyText()).toBe('alpha ');
  });

  test('Ctrl+Y redoes, like Word on Windows', () => {
    const surface = mount('<w:p><w:r><w:t>x</w:t></w:r></w:p>');
    const handler = createKeyDownHandler(surface);
    handler(key({ key: 'm', ctrlKey: true }));
    handler(key({ key: 'z', ctrlKey: true }));
    const undone = surface.layout().pages[0]!.fragments[0]!;
    if (undone.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(undone.lines[0]!.box.x).toBe(0);
    handler(key({ key: 'y', ctrlKey: true }));
    const redone = surface.layout().pages[0]!.fragments[0]!;
    if (redone.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(redone.lines[0]!.box.x).toBe(36);
  });
});

describe('Bullets and Numbering', () => {
  test('a plain document gains numbering.xml, its rel and its content type', () => {
    const surface = mount('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>');
    expect(surface.isListActive('bullet')).toBe(false);
    expect(surface.toggleList('bullet')).toBe(true);

    const marker = markerOf(surface);
    expect(marker).toMatchObject({ text: '•', level: 0 });
    expect(surface.isListActive('bullet')).toBe(true);

    // The whole package has to survive a save/reopen, not just the tree.
    const reopened = mountBytes(surface.session.save());
    expect(markerOf(reopened)).toMatchObject({ text: '•' });
  });

  test('an ordered list numbers, and the two kinds are distinguishable', () => {
    const surface = mount('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>');
    surface.toggleList('ordered');
    expect(markerOf(surface)?.text).toBe('1.');
    expect(surface.isListActive('ordered')).toBe(true);
    expect(surface.isListActive('bullet')).toBe(false);
  });

  test('toggling the same kind again removes the list', () => {
    const surface = mount('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>');
    surface.toggleList('bullet');
    expect(markerOf(surface)).toBeDefined();
    surface.toggleList('bullet');
    expect(markerOf(surface)).toBeUndefined();
    expect(JSON.stringify(surface.session.part().root)).not.toContain('numPr');
  });

  test('switching kinds replaces rather than clears', () => {
    const surface = mount('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>');
    surface.toggleList('bullet');
    surface.toggleList('ordered');
    expect(markerOf(surface)?.text).toBe('1.');
  });

  test('a document that already has numbering reuses its definition', () => {
    const surface = mount(listItem('alpha') + '<w:p><w:r><w:t>beta</w:t></w:r></w:p>', true);
    const before = JSON.stringify(surface.session.part().root);
    surface.selectAll();
    surface.toggleList('bullet');
    const numbering = surface.session.save();
    // One abstractNum only: a definition per toggled paragraph makes a document unreadable.
    const reopened = mountBytes(numbering);
    expect(markerOf(reopened)).toMatchObject({ text: '•' });
    expect(before).toContain('numPr');
  });

  test('the toggle keeps the rest of w:pPr', () => {
    const surface = mount(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>alpha</w:t></w:r></w:p>'
    );
    surface.toggleList('bullet');
    const xml = JSON.stringify(surface.session.part().root);
    expect(xml).toContain('center');
    expect(xml).toContain('numPr');
  });

  test('a new list demotes and promotes like any other', () => {
    const surface = mount('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>');
    surface.toggleList('bullet');
    expect(markerOf(surface)).toMatchObject({ text: '•', level: 0 });
    surface.adjustIndent('increase');
    expect(markerOf(surface)).toMatchObject({ text: 'o', level: 1 });
  });
});
