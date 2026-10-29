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
import { strToU8, zipSync } from 'fflate';
import { createBrowser } from '../../runtime/browser.ts';
import type { DocxEditorRuntime } from '../../runtime/runtime.ts';
import { isDocxEditorError } from '../../runtime/errors.ts';
import { createServer } from '../../runtime/server.ts';
import { StyleType } from '../../index.ts';
import { docx, mainXmlOf, p } from './support/documents.ts';

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

  test('a listed item loads its properties in a later sync', async () => {
    const runtime = await createServer(STYLED);
    try {
      const name = await runtime.run(async (context) => {
        const styles = context.document.getStyles();
        styles.load('items');
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
        for (const option of ['items/font', 'items/nameLocal/bold', 'priority']) {
          let code: string | undefined;
          try {
            styles.load(option);
          } catch (error) {
            if (isDocxEditorError(error)) code = error.code;
          }
          expect(code).toBe('InvalidArgument');
        }
        styles.getByNameOrNullObject(42 as unknown as string);
        let code: string | undefined;
        try {
          await context.sync();
        } catch (error) {
          if (isDocxEditorError(error)) code = error.code;
        }
        expect(code).toBe('InvalidArgument');
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

test('the guide example applies a listed style', async () => {
  // packages/editor-api/OFFICE_JS_GUIDE.md, "Apply a style the document defines".
  const runtime = await createServer(
    withStyles(
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>'
    )
  );
  try {
    await runtime.run(async (context) => {
      const styles = context.document.getStyles();
      styles.load('items/nameLocal,items/type');
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();

      const names = styles.items
        .filter((style) => style.type === 'Paragraph')
        .map((style) => style.nameLocal);
      const chosen = names.find((name) => name.toLowerCase() === 'quote');
      if (chosen === undefined) return;
      paragraph.style = chosen;
      await context.sync();
    });
    expect(await mainXmlOf(runtime)).toContain('<w:pStyle w:val="Quote"/>');
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
