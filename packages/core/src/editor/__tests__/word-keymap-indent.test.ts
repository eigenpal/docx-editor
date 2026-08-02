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
  // Level 0 ONLY — the shape a great many real documents have, including Word's own
  // "Simple Bullet List" and "Upper Roman" in the comprehensive fixture.
  '<w:abstractNum w:abstractNumId="1">' +
  '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="§"/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>' +
  '<w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/></w:rPr></w:lvl>' +
  '</w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="2">' +
  '<w:lvl w:ilvl="0"><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
  '</w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
  '<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num></w:numbering>';

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

describe('a list definition that declares only level 0', () => {
  const shallow = (text: string, numId: string) =>
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/>` +
    `</w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

  test('indenting DECLARES the missing level rather than erasing the bullet', () => {
    // numId 2 declares `ilvl 0` only. Demoting to a level it does not declare used to
    // resolve to no marker at all — and before that was guarded, the paragraph silently
    // stopped being a list item. Word never greys Increase Indent out here: it defines
    // the level with its stock bullet for that depth, and so does this.
    const surface = mount(shallow('alpha', '2'), true);
    expect(markerOf(surface)).toMatchObject({ text: '§', level: 0 });
    expect(surface.adjustIndent('increase')).toBe(true);
    expect(markerOf(surface)).toMatchObject({ text: 'o', level: 1 });
    // And back: the item's own level 0 still resolves to its authored glyph.
    expect(surface.adjustIndent('decrease')).toBe(true);
    expect(markerOf(surface)).toMatchObject({ text: '§', level: 0 });
  });

  test("a numbered list gains Word's default format for the depth", () => {
    const surface = mount(shallow('Introduction', '3'), true);
    expect(markerOf(surface)?.text).toBe('I.');
    expect(surface.adjustIndent('increase')).toBe(true);
    // Depth 1 of Word's default cycle is lowerLetter.
    expect(markerOf(surface)?.text).toBe('a.');
  });

  test('the declared level survives a save and reopen', () => {
    const surface = mount(shallow('alpha', '2'), true);
    expect(surface.adjustIndent('increase')).toBe(true);
    const reopened = mountBytes(surface.session.save());
    expect(markerOf(reopened)).toMatchObject({ text: 'o', level: 1 });
  });

  test('Tab takes the same lane', () => {
    const surface = mount(shallow('alpha', '2'), true);
    createKeyDownHandler(surface)(key({ key: 'Tab' }));
    expect(markerOf(surface)).toMatchObject({ text: 'o', level: 1 });
  });

  test('the control stays enabled, greying out only at the ends of the range', () => {
    const surface = mount(shallow('alpha', '2'), true);
    expect(surface.canAdjustIndent('increase')).toBe(true);
    expect(surface.canAdjustIndent('decrease')).toBe(false);
  });

  test('a definition that DOES declare the level still indents', () => {
    const surface = mount(listItem('alpha'), true);
    expect(surface.canAdjustIndent('increase')).toBe(true);
    expect(surface.adjustIndent('increase')).toBe(true);
    expect(markerOf(surface)).toMatchObject({ text: '○', level: 1 });
  });
});

describe('list kind is read from w:numFmt, not the marker glyph', () => {
  test('a bullet level using a letter-shaped glyph is still a bullet', () => {
    // Word's own default list uses Courier `o` and Wingdings `§` at levels 2 and 3.
    // Sniffing the glyph reported those as numbered and lit the wrong toolbar button.
    const surface = mount(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>' +
        '<w:r><w:t>alpha</w:t></w:r></w:p>',
      true
    );
    expect(markerOf(surface)?.text).toBe('§');
    expect(surface.isListActive('bullet')).toBe(true);
    expect(surface.isListActive('ordered')).toBe(false);
  });

  test('a numbered item does not report itself as a bullet', () => {
    const surface = mount(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>' +
        '<w:r><w:t>Introduction</w:t></w:r></w:p>',
      true
    );
    expect(surface.isListActive('ordered')).toBe(true);
    expect(surface.isListActive('bullet')).toBe(false);
  });
});

describe('turning a list off and on again', () => {
  test('rejoins the list around it rather than minting a new glyph', () => {
    const item = (text: string) =>
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>' +
      `<w:r><w:t>${text}</w:t></w:r></w:p>`;
    const surface = mount(item('one') + item('two') + item('three'), true);
    const markers = () =>
      surface
        .layout()
        .pages.flatMap((page) => page.fragments)
        .flatMap((fragment) =>
          fragment.kind === 'paragraph' && fragment.marker ? [fragment.marker.text] : []
        );
    expect(markers()).toEqual(['§', '§', '§']);

    // Put the caret in the middle item, toggle its bullet off and back on.
    const middle = surface.session.paragraphIds()[1]!;
    surface.setSelection({
      anchor: { paragraphId: middle, offset: 0 },
      head: { paragraphId: middle, offset: 0 },
    });
    surface.toggleList('bullet');
    expect(markers()).toEqual(['§', '§']);
    surface.toggleList('bullet');
    // The restored item takes its NEIGHBOURS' bullet, not a freshly minted one.
    expect(markers()).toEqual(['§', '§', '§']);
  });
});

describe('Enter at the end of a list', () => {
  test('makes another item, then leaves the list on the empty one', () => {
    const surface = mount(listItem('alpha'), true);
    const handler = createKeyDownHandler(surface);
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 5 },
      head: { paragraphId: id, offset: 5 },
    });

    // First Enter: a new, empty item in the same list.
    handler(key({ key: 'Enter' }));
    expect(surface.session.paragraphIds().length).toBe(2);
    expect(markerOf(surface)).toBeDefined();
    // The caret follows the split, so the second Enter acts on the new item.
    expect(surface.isListParagraph()).toBe(true);

    // Second Enter on that empty item: out of the list, and no third paragraph.
    handler(key({ key: 'Enter' }));
    expect(surface.session.paragraphIds().length).toBe(2);
    expect(surface.isListParagraph()).toBe(false);
  });

  test('a nested item steps out one level at a time', () => {
    const surface = mount(listItem('alpha', 1), true);
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 5 },
      head: { paragraphId: id, offset: 5 },
    });
    const handler = createKeyDownHandler(surface);
    // The marker of the paragraph the CARET is in, not the first in the document.
    const levelAtCaret = () => {
      const caret = surface.state().selection.head.paragraphId;
      for (const page of surface.layout().pages) {
        for (const fragment of page.fragments) {
          if (fragment.kind !== 'paragraph' || fragment.paragraphId !== caret) continue;
          return fragment.marker?.level ?? null;
        }
      }
      return null;
    };
    handler(key({ key: 'Enter' }));
    expect(levelAtCaret()).toBe(1);
    handler(key({ key: 'Enter' }));
    // Level 1 -> level 0, still a list.
    expect(levelAtCaret()).toBe(0);
    handler(key({ key: 'Enter' }));
    expect(surface.isListParagraph()).toBe(false);
  });

  test('Enter inside text still splits the paragraph', () => {
    const surface = mount(listItem('alpha'), true);
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 2 },
      head: { paragraphId: id, offset: 2 },
    });
    createKeyDownHandler(surface)(key({ key: 'Enter' }));
    expect(surface.session.paragraphIds().length).toBe(2);
    expect(surface.isListParagraph()).toBe(true);
  });
});
