// Paragraph styles through the object model.
//
// A STYLE IS NAMED THE WAY A READER NAMES IT. `heading 1` is what the styles gallery shows;
// `Heading1` is the internal id, and the two differ — including per language. So the model talks in
// names, and the host resolves them against the document's own `styles.xml` in both directions.
//
// A NAME THE DOCUMENT DOES NOT DEFINE IS REFUSED, not created. A host that minted the definition
// would answer "applied" for a style carrying no formatting: the paragraph would look untouched and
// read back as styled, which is the least useful outcome available. It would also turn a caller's
// string into a new part.
//
// APPLYING A STYLE AND ADJUSTING A SPACING IS ONE WRITE. Both rewrite the same `w:pPr`, so the model
// puts them in one operation rather than letting the second be refused as a conflict.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { isDocxEditorError } from '../../runtime/errors.ts';
import { createServer } from '../../runtime/server.ts';
import type { DocxEditorServerRuntime } from '../../runtime/runtime.ts';
import { mainXmlOf, orNull, reopen } from './support/documents.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const STYLES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';

/** A document with a real styles part: a default, two paragraph styles and a character style. */
const STYLED: Uint8Array = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      `<Override PartName="/word/styles.xml" ContentType="${STYLES_CT}"/>` +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body>` +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>heading</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t>indented</w:t></w:r></w:p>' +
      '</w:body></w:document>'
  ),
  'word/styles.xml': strToU8(
    `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>' +
      '<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/></w:style>' +
      '</w:styles>'
  ),
});

function styled(): Promise<DocxEditorServerRuntime> {
  return createServer(STYLED);
}

describe('reading a paragraph style', () => {
  test('answers the gallery name rather than the internal id', async () => {
    const runtime = await styled();
    const read = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const paragraph = paragraphs.items[0]!;
      paragraph.load('style');
      await context.sync();
      return paragraph.style;
    });
    expect(read).toBe('heading 1');
    runtime.dispose();
  });

  test('a paragraph that states none answers the document default', async () => {
    const runtime = await styled();
    const read = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const paragraph = paragraphs.items[1]!;
      paragraph.load('style');
      await context.sync();
      return paragraph.style;
    });
    expect(read).toBe('Normal');
    runtime.dispose();
  });

  test('a story whose paragraphs disagree answers null', async () => {
    const runtime = await styled();
    const read = await runtime.run(async (context) => {
      const body = context.document.body;
      body.load('style');
      await context.sync();
      return orNull(body.style);
    });
    expect(read).toBe(null);
    runtime.dispose();
  });

  test('a range answers the style of the paragraphs it covers', async () => {
    const runtime = await styled();
    const read = await runtime.run(async (context) => {
      const found = context.document.body.search('heading', { matchCase: true });
      found.load();
      await context.sync();
      const range = found.items[0]!;
      range.load('style');
      await context.sync();
      return range.style;
    });
    expect(read).toBe('heading 1');
    runtime.dispose();
  });
});

describe('applying a paragraph style', () => {
  test('lands on a paragraph and survives a reopen', async () => {
    const runtime = await styled();
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      paragraphs.items[1]!.style = 'Quote';
      await context.sync();
    });

    const reopened = await reopen(runtime);
    const read = await reopened.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const paragraph = paragraphs.items[1]!;
      paragraph.load(['style', 'leftIndent']);
      await context.sync();
      return { style: paragraph.style, leftIndent: paragraph.leftIndent };
    });
    // And the indent the paragraph already had is still there: the write carried it forward.
    expect(read).toEqual({ style: 'Quote', leftIndent: 36 });
    runtime.dispose();
    reopened.dispose();
  });

  test('a style and a spacing set on one paragraph in one sync are one write', async () => {
    const runtime = await styled();
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const paragraph = paragraphs.items[1]!;
      paragraph.style = 'Quote';
      paragraph.spaceAfter = 6;
      paragraph.alignment = 'Right';
      await context.sync();
    });
    const xml = await mainXmlOf(runtime);
    expect(xml).toContain('<w:pStyle w:val="Quote"/>');
    expect(xml).toContain('w:after="120"');
    expect(xml).toContain('w:val="right"');
    runtime.dispose();
  });

  test('applies to every paragraph of a story at once', async () => {
    const runtime = await styled();
    await runtime.run(async (context) => {
      const body = context.document.body;
      body.style = 'Quote';
      await context.sync();
    });
    const xml = await mainXmlOf(runtime);
    expect(xml.split('<w:pStyle w:val="Quote"/>')).toHaveLength(3);
    runtime.dispose();
  });

  test('a name the document does not define fails the sync and changes nothing', async () => {
    const runtime = await styled();
    const code = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      paragraphs.items[1]!.style = 'Invented';
      try {
        await context.sync();
      } catch (error) {
        return isDocxEditorError(error) ? error.code : 'untyped';
      }
      return 'accepted';
    });
    expect(code).toBe('InvalidArgument');
    expect(await mainXmlOf(runtime)).not.toContain('Invented');
    runtime.dispose();
  });

  test('a character style is refused: it is not what a paragraph can be set to', async () => {
    const runtime = await styled();
    const code = await runtime.run(async (context) => {
      const body = context.document.body;
      body.style = 'Emphasis';
      try {
        await context.sync();
      } catch (error) {
        return isDocxEditorError(error) ? error.code : 'untyped';
      }
      return 'accepted';
    });
    expect(code).toBe('InvalidArgument');
    runtime.dispose();
  });

  test('an empty name is refused at the assignment, where the mistake was made', async () => {
    const runtime = await styled();
    const code = await runtime.run(async (context) => {
      try {
        context.document.body.style = '';
      } catch (error) {
        return isDocxEditorError(error) ? error.code : 'untyped';
      }
      return 'accepted';
    });
    expect(code).toBe('InvalidArgument');
    runtime.dispose();
  });
});
