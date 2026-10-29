/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Listing the styles a document defines through Document.getStyles().
//
// THE LISTING IS WHAT A WRITE ACCEPTS. A caller lists the paragraph styles to choose one, then
// assigns its nameLocal to paragraph.style. So every listed paragraph name must apply, and a name
// the setter would refuse is not listed.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createBrowser } from '../../runtime/browser.ts';
import { createRuntime, type DocxEditorRuntime } from '../../runtime/runtime.ts';
import { openHost, spyHost } from '../../runtime/__tests__/support/hosts.ts';
import { isDocxEditorError } from '../../runtime/errors.ts';
import { createServer } from '../../runtime/server.ts';
import { StyleType } from '../../index.ts';
import { docx, mainXmlOf, orNull, p } from './support/documents.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const STYLES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';

function withStyles(styles: string): Uint8Array {
  return zipSync({
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
        '<w:p><w:r><w:t>first</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>second</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`),
  });
}

const STYLED = withStyles(
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
    '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:link w:val="Heading1Char"/></w:style>' +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="ClauseText"><w:name w:val="Clause Text"/>' +
    '<w:basedOn w:val="Normal"/></w:style>' +
    '<w:style w:type="character" w:styleId="Heading1Char"><w:name w:val="Heading 1 Char"/>' +
    '<w:link w:val="Heading1"/></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>' +
    '<w:style w:type="numbering" w:styleId="Outline"><w:name w:val="Outline List"/></w:style>' +
    // Not listed: no name, an unknown kind, a later duplicate, an empty name.
    '<w:style w:type="paragraph" w:styleId="Nameless"/>' +
    '<w:style w:type="mystery" w:styleId="Mystery"><w:name w:val="Mystery"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Duplicate"><w:name w:val="HEADING 1"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Blank"><w:name w:val="  "/></w:style>' +
    // A file-supplied name that would be a dangerous object key stays plain data.
    '<w:style w:type="paragraph" w:styleId="Proto"><w:name w:val="__proto__"/></w:style>'
);

interface ListedStyle {
  readonly nameLocal: string;
  readonly type: string;
  readonly builtIn: boolean;
  readonly baseStyle: string;
  readonly nextParagraphStyle: string;
  readonly linked: boolean;
}

describe('Document.getStyles', () => {
  test('lists the defined styles in part order with their properties in one sync', async () => {
    const runtime = await createServer(STYLED);
    try {
      const listed = await runtime.run(async (context) => {
        const styles = context.document.getStyles();
        styles.load(
          'items/nameLocal,items/type,items/builtIn,items/baseStyle,items/nextParagraphStyle,items/linked'
        );
        await context.sync();
        return styles.items.map(
          (style): ListedStyle => ({
            nameLocal: style.nameLocal,
            type: style.type,
            builtIn: style.builtIn,
            baseStyle: style.baseStyle,
            nextParagraphStyle: style.nextParagraphStyle,
            linked: style.linked,
          })
        );
      });
      expect(listed).toEqual([
        {
          nameLocal: 'Normal',
          type: 'Paragraph',
          builtIn: true,
          baseStyle: '',
          nextParagraphStyle: 'Normal',
          linked: false,
        },
        {
          nameLocal: 'heading 1',
          type: 'Paragraph',
          builtIn: true,
          baseStyle: 'Normal',
          nextParagraphStyle: 'Normal',
          linked: true,
        },
        {
          nameLocal: 'Clause Text',
          type: 'Paragraph',
          builtIn: false,
          baseStyle: 'Normal',
          nextParagraphStyle: 'Clause Text',
          linked: false,
        },
        {
          nameLocal: 'Heading 1 Char',
          type: 'Character',
          builtIn: true,
          baseStyle: '',
          nextParagraphStyle: '',
          linked: true,
        },
        {
          nameLocal: 'Table Grid',
          type: 'Table',
          builtIn: true,
          baseStyle: '',
          nextParagraphStyle: '',
          linked: false,
        },
        {
          nameLocal: 'Outline List',
          type: 'List',
          builtIn: true,
          baseStyle: '',
          nextParagraphStyle: '',
          linked: false,
        },
        {
          nameLocal: '__proto__',
          type: 'Paragraph',
          builtIn: true,
          baseStyle: '',
          nextParagraphStyle: '__proto__',
          linked: false,
        },
      ]);
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    } finally {
      runtime.dispose();
    }
  });

  test('every listed paragraph style applies through paragraph.style', async () => {
    const runtime = await createServer(STYLED);
    try {
      const applied = await runtime.run(async (context) => {
        const styles = context.document.getStyles();
        styles.load('items/nameLocal,items/type');
        const paragraph = context.document.body.paragraphs.getFirst();
        await context.sync();
        const names = styles.items
          .filter((style) => style.type === StyleType.paragraph)
          .map((style) => style.nameLocal);
        const readBack: string[] = [];
        for (const name of names) {
          paragraph.style = name;
          await context.sync();
          paragraph.load('style');
          await context.sync();
          readBack.push(paragraph.style);
        }
        return { names, readBack };
      });
      expect(applied.names).toEqual(['Normal', 'heading 1', 'Clause Text', '__proto__']);
      expect(applied.readBack).toEqual(applied.names);
      expect(await mainXmlOf(runtime)).toContain('w:val="Proto"');
    } finally {
      runtime.dispose();
    }
  });

  test('getByNameOrNullObject finds a style without case and reports a missing one as null', async () => {
    const runtime = await createServer(STYLED);
    try {
      const read = await runtime.run(async (context) => {
        const styles = context.document.getStyles();
        const found = styles.getByNameOrNullObject('Heading 1');
        const missing = styles.getByNameOrNullObject('Quote');
        found.load('nameLocal,type');
        missing.load('nameLocal');
        const count = styles.getCount();
        await context.sync();
        return {
          foundNull: found.isNullObject,
          name: found.nameLocal,
          type: found.type,
          missingNull: missing.isNullObject,
          count: count.value,
        };
      });
      expect(read).toEqual({
        foundNull: false,
        name: 'heading 1',
        type: 'Paragraph',
        missingNull: true,
        count: 7,
      });
    } finally {
      runtime.dispose();
    }
  });

  test('a bare load, or load("items"), reads every property of each style', async () => {
    const runtime = await createServer(STYLED);
    try {
      const read = await runtime.run(async (context) => {
        const bare = context.document.getStyles();
        bare.load();
        const items = context.document.getStyles();
        items.load('items');
        await context.sync();
        const third = bare.items[2]!;
        return {
          bare: bare.items.map((style) => style.nameLocal),
          items: items.items.map((style) => style.type),
          third: [
            third.nameLocal,
            third.type,
            third.builtIn,
            third.baseStyle,
            third.nextParagraphStyle,
            third.linked,
            third.visibility,
            third.priority,
            third.quickStyle,
            third.unhideWhenUsed,
          ],
        };
      });
      expect(read.bare).toEqual([
        'Normal',
        'heading 1',
        'Clause Text',
        'Heading 1 Char',
        'Table Grid',
        'Outline List',
        '__proto__',
      ]);
      expect(read.items).toEqual([
        'Paragraph',
        'Paragraph',
        'Paragraph',
        'Character',
        'Table',
        'List',
        'Paragraph',
      ]);
      expect(read.third).toEqual([
        'Clause Text',
        'Paragraph',
        false,
        'Normal',
        'Clause Text',
        false,
        true,
        99,
        false,
        false,
      ]);
    } finally {
      runtime.dispose();
    }
  });

  test('repeated loads in one sync accumulate and share one listing', async () => {
    const runtime = await createServer(STYLED);
    try {
      const read = await runtime.run(async (context) => {
        const styles = context.document.getStyles();
        styles.load('items/nameLocal');
        styles.load('items/type');
        styles.load({ select: 'items/builtIn' });
        await context.sync();
        return styles.items
          .slice(0, 3)
          .map((style) => [style.nameLocal, style.type, style.builtIn]);
      });
      expect(read).toEqual([
        ['Normal', 'Paragraph', true],
        ['heading 1', 'Paragraph', true],
        ['Clause Text', 'Paragraph', false],
      ]);
    } finally {
      runtime.dispose();
    }
  });

  test('repeated paragraph collection loads in one sync accumulate too', async () => {
    const runtime = await createServer(STYLED);
    try {
      const read = await runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items/text');
        paragraphs.load('items/style');
        await context.sync();
        return paragraphs.items.map((paragraph) => [paragraph.text, paragraph.style]);
      });
      expect(read).toEqual([
        ['first', 'Normal'],
        ['second', 'Normal'],
      ]);
    } finally {
      runtime.dispose();
    }
  });

  for (const writes of [false, true]) {
    test(`a bare load then item properties answer every name ${writes ? 'with' : 'without'} a write in the sync`, async () => {
      const runtime = await createServer(STYLED);
      try {
        const read = await runtime.run(async (context) => {
          const paragraphs = context.document.body.paragraphs;
          paragraphs.load('items');
          paragraphs.load('items/text');
          const styles = context.document.getStyles();
          styles.load('items');
          styles.load('items/nameLocal');
          if (writes) context.document.body.insertParagraph('third', 'End');
          await context.sync();
          return {
            texts: paragraphs.items.map((paragraph) => paragraph.text),
            first: styles.items[0]!.nameLocal,
            type: styles.items[0]!.type,
          };
        });
        // Reads in a sync report the document from before its writes.
        expect(read).toEqual({ texts: ['first', 'second'], first: 'Normal', type: 'Paragraph' });
      } finally {
        runtime.dispose();
      }
    });
  }

  test('loads with mixed windows keep every name on the members that settle last', async () => {
    const runtime = await createServer(STYLED);
    try {
      const read = await runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items/text');
        paragraphs.load({ select: 'items/style', top: 1 });
        paragraphs.load('items/alignment');
        const styles = context.document.getStyles();
        styles.load('items/nameLocal');
        styles.load({ select: 'items/type', top: 1 });
        styles.load('items/builtIn');
        await context.sync();
        const paragraph = paragraphs.items[0]!;
        const style = styles.items[0]!;
        return {
          paragraph: [paragraph.text, paragraph.style, paragraph.alignment],
          style: [style.nameLocal, style.type, style.builtIn],
        };
      });
      expect(read).toEqual({
        paragraph: ['first', 'Normal', 'Unknown'],
        style: ['Normal', 'Paragraph', true],
      });
    } finally {
      runtime.dispose();
    }
  });

  for (const writes of [false, true]) {
    test(`one host read per window answers a bare load and a later item load ${writes ? 'with' : 'without'} a write`, async () => {
      const spy = spyHost(openHost(STYLED));
      const runtime = createRuntime({ host: spy.host, save: true });
      try {
        const read = await runtime.run(async (context) => {
          const paragraphs = context.document.body.paragraphs;
          const styles = context.document.getStyles();
          paragraphs.load('items');
          styles.load('items');
          paragraphs.load('items/text');
          styles.load('items/nameLocal');
          if (writes) context.document.body.insertParagraph('third', 'End');
          spy.reset();
          await context.sync();
          return [paragraphs.items[0]!.text, styles.items[0]!.nameLocal];
        });
        expect(read).toEqual(['first', 'Normal']);
        const ops = spy.requests.flatMap((request) => request.operations.map((o) => o.op));
        expect(ops.filter((op) => op === 'getParagraphs')).toHaveLength(1);
        expect(ops.filter((op) => op === 'getStyles')).toHaveLength(1);
      } finally {
        runtime.dispose();
      }
    });
  }

  test('properties loaded on a looked-up style come from the lookup itself', async () => {
    const spy = spyHost(openHost(STYLED));
    const runtime = createRuntime({ host: spy.host, save: true });
    try {
      const read = await runtime.run(async (context) => {
        const found = context.document.getStyles().getByNameOrNullObject('Clause Text');
        found.load('nameLocal,builtIn');
        const missing = context.document.getStyles().getByNameOrNullObject('Absent');
        missing.load('nameLocal');
        spy.reset();
        await context.sync();
        return [found.nameLocal, found.builtIn, missing.isNullObject];
      });
      expect(read).toEqual(['Clause Text', false, true]);
      const ops = spy.requests.flatMap((request) => request.operations);
      expect(ops).toEqual([
        { op: 'getStyles', name: 'Clause Text' },
        { op: 'getStyles', name: 'Absent' },
      ]);
    } finally {
      runtime.dispose();
    }
  });

  test('a listed item loads its properties again in a later sync', async () => {
    const runtime = await createServer(STYLED);
    try {
      const name = await runtime.run(async (context) => {
        const styles = context.document.getStyles();
        styles.load('items/type');
        await context.sync();
        const style = styles.items[2]!;
        expect(() => style.nameLocal).toThrow();
        style.load('nameLocal');
        await context.sync();
        return style.nameLocal;
      });
      expect(name).toBe('Clause Text');
    } finally {
      runtime.dispose();
    }
  });

  test('top and skip window the listing', async () => {
    const runtime = await createServer(STYLED);
    try {
      const names = await runtime.run(async (context) => {
        const styles = context.document.getStyles();
        styles.load({ select: 'items/nameLocal', skip: 1, top: 2 });
        await context.sync();
        return styles.items.map((style) => style.nameLocal);
      });
      expect(names).toEqual(['heading 1', 'Clause Text']);
    } finally {
      runtime.dispose();
    }
  });

  test('a document with no styles part lists none and finds nothing', async () => {
    const runtime = await createServer(docx(p('plain')));
    try {
      const read = await runtime.run(async (context) => {
        const styles = context.document.getStyles();
        styles.load('items/nameLocal');
        const found = styles.getByNameOrNullObject('Normal');
        const count = styles.getCount();
        await context.sync();
        return { items: styles.items.length, found: found.isNullObject, count: count.value };
      });
      expect(read).toEqual({ items: 0, found: true, count: 0 });
    } finally {
      runtime.dispose();
    }
  });

  test('refuses an unknown item property, a deeper path, and a non-string name', async () => {
    const runtime = await createServer(STYLED);
    try {
      await runtime.run(async (context) => {
        const styles = context.document.getStyles();
        for (const option of ['items/font', 'items/nameLocal/bold', 'inUse']) {
          let code: string | undefined;
          try {
            styles.load(option);
          } catch (error) {
            if (isDocxEditorError(error)) code = error.code;
          }
          expect(code).toBe('InvalidArgument');
        }
        // Refused at the call, before anything is queued.
        let code: string | undefined;
        try {
          styles.getByNameOrNullObject(42 as unknown as string);
        } catch (error) {
          if (isDocxEditorError(error)) code = error.code;
        }
        expect(code).toBe('InvalidArgument');
        await context.sync();
      });
    } finally {
      runtime.dispose();
    }
  });

  test('reading before a load is PropertyNotLoaded', async () => {
    const runtime = await createServer(STYLED);
    try {
      await runtime.run(async (context) => {
        const styles = context.document.getStyles();
        let code: string | undefined;
        try {
          void styles.items;
        } catch (error) {
          if (isDocxEditorError(error)) code = error.code;
        }
        expect(code).toBe('PropertyNotLoaded');
        const missing = styles.getByNameOrNullObject('Quote');
        code = undefined;
        try {
          void missing.isNullObject;
        } catch (error) {
          if (isDocxEditorError(error)) code = error.code;
        }
        expect(code).toBe('PropertyNotLoaded');
        await context.sync();
      });
    } finally {
      runtime.dispose();
    }
  });
});

describe('one name, several kinds', () => {
  // A character style listed BEFORE a paragraph style of the same name: a name lookup that took
  // the first match would answer the character style, which the setters refuse.
  const COLLIDING = withStyles(
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="character" w:styleId="QuoteChar"><w:name w:val="Quote"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/>' +
      '<w:next w:val="Nameless"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Nameless"/>'
  );

  test('a listed item reloads the style it was listed as, not the first of its name', async () => {
    const runtime = await createServer(COLLIDING);
    try {
      const types = await runtime.run(async (context) => {
        const styles = context.document.getStyles();
        styles.load('items');
        await context.sync();
        for (const style of styles.items) style.load('nameLocal,type');
        await context.sync();
        return styles.items.map((style) => [style.nameLocal, style.type]);
      });
      expect(types).toEqual([
        ['Normal', 'Paragraph'],
        ['Quote', 'Character'],
        ['Quote', 'Paragraph'],
      ]);
    } finally {
      runtime.dispose();
    }
  });

  test('getByNameOrNullObject answers the paragraph style, which the setters apply', async () => {
    const runtime = await createServer(COLLIDING);
    try {
      const read = await runtime.run(async (context) => {
        const found = context.document.getStyles().getByNameOrNullObject('quote');
        found.load('nameLocal,type');
        await context.sync();
        // A second load on the same object keeps naming the same style.
        found.load('type');
        await context.sync();
        context.document.body.paragraphs.getFirst().style = found.nameLocal;
        await context.sync();
        return found.type;
      });
      expect(read).toBe('Paragraph');
      expect(await mainXmlOf(runtime)).toContain('<w:pStyle w:val="Quote"/>');
    } finally {
      runtime.dispose();
    }
  });

  test('nextParagraphStyle is empty where w:next names a style the listing leaves out', async () => {
    const runtime = await createServer(COLLIDING);
    try {
      const next = await runtime.run(async (context) => {
        const styles = context.document.getStyles();
        styles.load('items/nameLocal,items/type,items/nextParagraphStyle');
        await context.sync();
        return styles.items.map((style) => style.nextParagraphStyle);
      });
      // Normal states none and follows itself; the character style has none; Quote names an
      // unlisted style.
      expect(next).toEqual(['Normal', '', '']);
    } finally {
      runtime.dispose();
    }
  });

  test('a character style name is listed but refused by paragraph.style', async () => {
    const runtime = await createServer(
      withStyles(
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
          '<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/></w:style>'
      )
    );
    try {
      const code = await runtime.run(async (context) => {
        const styles = context.document.getStyles();
        styles.load('items/nameLocal,items/type');
        await context.sync();
        const strong = styles.items.find((style) => style.type === 'Character')!;
        context.document.body.paragraphs.getFirst().style = strong.nameLocal;
        try {
          await context.sync();
          return null;
        } catch (error) {
          return isDocxEditorError(error) ? error.code : 'unknown';
        }
      });
      expect(code).not.toBe(null);
    } finally {
      runtime.dispose();
    }
  });
});

test('the guide example offers only visible paragraph styles and applies one', async () => {
  // packages/editor-api/OFFICE_JS_GUIDE.md, "Apply a style the document defines".
  const runtime = await createServer(
    withStyles(
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
        '<w:uiPriority w:val="0"/><w:qFormat/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/>' +
        '<w:uiPriority w:val="29"/><w:qFormat/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
        '<w:uiPriority w:val="9"/></w:style>' +
        // As a default template marks headings 2 to 9: hidden until used.
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>' +
        '<w:uiPriority w:val="9"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/>' +
        '<w:uiPriority w:val="39"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Old"><w:name w:val="Old"/><w:hidden w:val="1"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Shown"><w:name w:val="Shown"/><w:semiHidden w:val="0"/></w:style>' +
        '<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/></w:style>'
    )
  );
  try {
    const offered = await runtime.run(async (context) => {
      const styles = context.document.getStyles();
      styles.load(
        'items/nameLocal,items/type,items/visibility,items/unhideWhenUsed,items/priority'
      );
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();

      // Offer an agent the paragraph styles a reader would see, in gallery order.
      // Keep hidden styles that unhide once used, such as heading 2, so they can be applied too.
      const names = styles.items
        .filter((style) => style.type === 'Paragraph' && (style.visibility || style.unhideWhenUsed))
        .sort((a, b) => a.priority - b.priority || a.nameLocal.localeCompare(b.nameLocal))
        .map((style) => style.nameLocal);
      const chosen = names.find((name) => name.toLowerCase() === 'quote');
      if (chosen === undefined) return names;
      paragraph.style = chosen;
      await context.sync();
      return names;
    });
    expect(offered).toEqual(['Normal', 'heading 1', 'heading 2', 'Quote', 'toc 1', 'Shown']);
    expect(await mainXmlOf(runtime)).toContain('<w:pStyle w:val="Quote"/>');

    const flags = await runtime.run(async (context) => {
      const styles = context.document.getStyles();
      styles.load('items/nameLocal,items/quickStyle,items/unhideWhenUsed,items/visibility');
      await context.sync();
      return styles.items.map((style) => [
        style.nameLocal,
        style.quickStyle,
        style.unhideWhenUsed,
        style.visibility,
      ]);
    });
    expect(flags).toEqual([
      ['Normal', true, false, true],
      ['Quote', true, false, true],
      ['heading 1', false, false, true],
      ['heading 2', false, true, false],
      ['toc 1', false, true, false],
      ['Old', false, false, false],
      ['Shown', false, false, true],
      ['Strong', false, false, true],
    ]);
  } finally {
    runtime.dispose();
  }
});

test('a heading hidden until used is offered and applies', async () => {
  const runtime = await createServer(
    withStyles(
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>' +
        '<w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
    )
  );
  try {
    const read = await runtime.run(async (context) => {
      const styles = context.document.getStyles();
      styles.load();
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      const offered = styles.items.filter(
        (style) => style.type === 'Paragraph' && (style.visibility || style.unhideWhenUsed)
      );
      const heading = offered.find((style) => style.nameLocal === 'heading 2')!;
      paragraph.style = heading.nameLocal;
      await context.sync();
      paragraph.load('style');
      await context.sync();
      return [heading.visibility, heading.unhideWhenUsed, paragraph.style];
    });
    expect(read).toEqual([false, true, 'heading 2']);
  } finally {
    runtime.dispose();
  }
});

test('Table.style accepts the nameLocal of a listed table style', async () => {
  const runtime = await createServer(
    withStyles(
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>'
    )
  );
  try {
    const style = await runtime.run(async (context) => {
      const styles = context.document.getStyles();
      styles.load('items/nameLocal,items/type');
      const table = context.document.body.getRange('Start').insertTable(1, 1, 'Before', [['A']]);
      await context.sync();
      const tableStyle = styles.items.find((item) => item.type === 'Table')!;
      table.style = tableStyle.nameLocal;
      await context.sync();
      table.load('style');
      await context.sync();
      return table.style;
    });
    expect(style).toBe('Table Grid');
  } finally {
    runtime.dispose();
  }
});

test('a paragraph style that repeats an earlier name reads null, as the setter applies the earlier', async () => {
  const bytes = zipSync({
    ...Object.fromEntries(
      Object.entries(
        unzipSync(
          withStyles(
            '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
              '<w:style w:type="paragraph" w:styleId="Body1"><w:name w:val="Body"/></w:style>' +
              '<w:style w:type="paragraph" w:styleId="Body2"><w:name w:val="body"/></w:style>'
          )
        )
      )
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:pPr><w:pStyle w:val="Body2"/></w:pPr><w:r><w:t>later</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="Body1"/></w:pPr><w:r><w:t>earlier</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    ),
  });
  const runtime = await createServer(bytes);
  try {
    const read = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items/style');
      const styles = context.document.getStyles();
      styles.load('items/nameLocal');
      await context.sync();
      return {
        styles: paragraphs.items.map((paragraph) => orNull(paragraph.style)),
        listed: styles.items.map((style) => style.nameLocal),
      };
    });
    expect(read).toEqual({ styles: [null, 'Body'], listed: ['Normal', 'Body'] });
  } finally {
    runtime.dispose();
  }
});

test('a style name of 150 characters reads, lists, and applies', async () => {
  const long = `Long ${'x'.repeat(145)}`;
  expect(long.length).toBe(150);
  const runtime = await createServer(
    withStyles(
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        `<w:style w:type="paragraph" w:styleId="Long"><w:name w:val="${long}"/></w:style>`
    )
  );
  try {
    const read = await runtime.run(async (context) => {
      const styles = context.document.getStyles();
      styles.load('items/nameLocal');
      const found = styles.getByNameOrNullObject(long);
      found.load('nameLocal');
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      paragraph.style = long;
      await context.sync();
      paragraph.load('style');
      await context.sync();
      return {
        listed: styles.items.map((style) => style.nameLocal),
        found: found.isNullObject ? null : found.nameLocal,
        style: paragraph.style,
      };
    });
    expect(read).toEqual({ listed: ['Normal', long], found: long, style: long });
  } finally {
    runtime.dispose();
  }
});

test('a refused style name says so and points to getStyles()', async () => {
  const runtime = await createServer(STYLED);
  try {
    const refusal = await runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().style = 'Missing Style';
      try {
        await context.sync();
        return null;
      } catch (error) {
        if (!isDocxEditorError(error)) throw error;
        return { code: error.code, inner: error.debugInfo.innerError };
      }
    });
    expect(refusal?.code).toBe('InvalidArgument');
    expect(refusal?.inner?.code).toBe('edit.style-not-defined');
    expect(refusal?.inner?.message).toContain('not defined');
    expect(refusal?.inner?.message).toContain('document.getStyles()');
  } finally {
    runtime.dispose();
  }
});

async function refusalOf(
  bytes: Uint8Array,
  write: (context: import('../../runtime/request-context.ts').RequestContext) => Promise<void>
): Promise<{ code: string; inner: string | undefined; message: string | undefined } | null> {
  const runtime = await createServer(bytes);
  try {
    return await runtime.run(async (context) => {
      try {
        await write(context);
        return null;
      } catch (error) {
        if (!isDocxEditorError(error)) throw error;
        return {
          code: error.code,
          inner: error.debugInfo.innerError?.code,
          message: error.debugInfo.innerError?.message,
        };
      }
    });
  } finally {
    runtime.dispose();
  }
}

test('a refused table style name reports edit.style-not-defined', async () => {
  const refusal = await refusalOf(STYLED, async (context) => {
    const table = context.document.body.getRange('Start').insertTable(1, 1, 'Before', [['A']]);
    await context.sync();
    table.style = 'Missing Table Style';
    await context.sync();
  });
  expect(refusal?.inner).toBe('edit.style-not-defined');
  expect(refusal?.message).toContain('document.getStyles()');
});

test('a table style name too long for any style is refused before it is compared', async () => {
  const refusal = await refusalOf(STYLED, async (context) => {
    const table = context.document.body.getRange('Start').insertTable(1, 1, 'Before', [['A']]);
    await context.sync();
    table.style = 'x'.repeat(256);
    await context.sync();
  });
  expect(refusal?.code).toBe('InvalidArgument');
  expect(refusal?.inner).not.toBe('edit.style-not-defined');
});

test('a document with no styles part says no style name applies, for paragraphs and tables', async () => {
  const paragraph = await refusalOf(docx(p('plain')), async (context) => {
    context.document.body.paragraphs.getFirst().style = 'Normal';
    await context.sync();
  });
  expect(paragraph?.code).toBe('InvalidArgument');
  expect(paragraph?.inner).toBe('edit.no-styles-defined');
  expect(paragraph?.message).toContain('no style name applies');
  expect(paragraph?.message).not.toContain('getStyles');

  const table = await refusalOf(docx(p('plain')), async (context) => {
    const inserted = context.document.body.getRange('Start').insertTable(1, 1, 'Before', [['A']]);
    await context.sync();
    inserted.style = 'Table Grid';
    await context.sync();
  });
  expect(table?.inner).toBe('edit.no-styles-defined');
});

test('style references resolve only to a listed style of the allowed kind', async () => {
  const runtime = await createServer(
    withStyles(
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/></w:style>' +
        // w:next naming a character style, w:basedOn naming a character style.
        '<w:style w:type="paragraph" w:styleId="Probe"><w:name w:val="Probe"/>' +
        '<w:basedOn w:val="Strong"/><w:next w:val="Strong"/></w:style>' +
        // A character style based on a paragraph style, and one based on a character style.
        '<w:style w:type="character" w:styleId="Odd"><w:name w:val="Odd"/><w:basedOn w:val="Normal"/></w:style>' +
        '<w:style w:type="character" w:styleId="Fine"><w:name w:val="Fine"/><w:basedOn w:val="Strong"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Next"><w:name w:val="Next"/><w:next w:val="Normal"/></w:style>'
    )
  );
  try {
    const read = await runtime.run(async (context) => {
      const styles = context.document.getStyles();
      styles.load('items/nameLocal,items/baseStyle,items/nextParagraphStyle');
      await context.sync();
      return styles.items.map((style) => [
        style.nameLocal,
        style.baseStyle,
        style.nextParagraphStyle,
      ]);
    });
    expect(read).toEqual([
      ['Normal', '', 'Normal'],
      ['Strong', '', ''],
      ['Probe', '', ''],
      ['Odd', '', ''],
      ['Fine', 'Strong', ''],
      ['Next', '', 'Normal'],
    ]);
  } finally {
    runtime.dispose();
  }
});

describe('both hosts', () => {
  async function listing(runtime: DocxEditorRuntime): Promise<unknown> {
    return runtime.run(async (context) => {
      const styles = context.document.getStyles();
      styles.load('items/nameLocal,items/type,items/baseStyle');
      const found = styles.getByNameOrNullObject('clause text');
      found.load('builtIn');
      await context.sync();
      return {
        items: styles.items.map((style) => [style.nameLocal, style.type, style.baseStyle]),
        builtIn: found.builtIn,
      };
    });
  }

  test('the browser host lists the same styles as the server host', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({ container, document: STYLED });
    const server = await createServer(STYLED);
    try {
      const browser = createBrowser(editor);
      const fromBrowser = await listing(browser);
      expect(fromBrowser).toEqual(await listing(server));
      expect((fromBrowser as { builtIn: boolean }).builtIn).toBe(false);
    } finally {
      server.dispose();
      editor.destroy();
    }
  });
});
