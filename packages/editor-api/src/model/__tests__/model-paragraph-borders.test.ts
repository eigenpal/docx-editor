/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `Paragraph.borders` through the object model.
//
// FIVE ITEMS IN A FIXED ORDER: top, left, bottom, right, then the border between paragraphs. Reads
// answer what the page shows, including a style's border. Every border assignment in one sync joins
// the paragraph's own formatting write, so borders and alignment set together are one operation,
// and border assignments apply in the order they were made.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { isDocxEditorError } from '../../runtime/errors.ts';
import { createServer } from '../../runtime/server.ts';
import type { RequestContext } from '../../runtime/request-context.ts';
import type { BorderUniversalUpdateData } from '../borders.ts';
import type { DocxEditorServerRuntime } from '../../runtime/runtime.ts';
import { docx, mainXmlOf, p, reopen, serverRuntime } from './support/documents.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const STYLES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';

/** A paragraph whose `Title` style draws a red double rule above and a thick line below. */
const TITLED: Uint8Array = zipSync({
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
  'word/styles.xml': strToU8(
    `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:pBdr>' +
      '<w:top w:val="double" w:sz="6" w:space="1" w:color="FF0000"/>' +
      '<w:bottom w:val="single" w:sz="12" w:space="1" w:color="auto"/>' +
      '</w:pBdr></w:pPr></w:style></w:styles>'
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body>` +
      '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>title</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
      '</w:body></w:document>'
  ),
});

async function first(context: RequestContext) {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load('items');
  await context.sync();
  return paragraphs.items[0]!;
}

async function refusalOf(
  runtime: DocxEditorServerRuntime,
  edit: (context: RequestContext) => Promise<void>
): Promise<{ code: string; inner?: string }> {
  return runtime.run(async (context) => {
    try {
      await edit(context);
      await context.sync();
    } catch (error) {
      if (!isDocxEditorError(error)) return { code: 'untyped' };
      const inner = error.debugInfo.innerError as { code?: string } | undefined;
      return { code: error.code, ...(inner?.code ? { inner: inner.code } : {}) };
    }
    return { code: 'accepted' };
  });
}

describe('reading paragraph borders', () => {
  test('five items in collection order, each with every property', async () => {
    const runtime = await serverRuntime(TITLED);
    const read = await runtime.run(async (context) => {
      const borders = (await first(context)).borders;
      borders.load(
        'items/lineStyle,items/lineWidth,items/color,items/colorIndex,items/isVisible,items/inside'
      );
      await context.sync();
      return borders.items.map((border) => ({
        isVisible: border.isVisible,
        lineStyle: border.lineStyle,
        lineWidth: border.lineWidth,
        color: border.color,
        colorIndex: border.colorIndex,
        inside: border.inside,
      }));
    });
    const none = {
      isVisible: false,
      lineStyle: 'None' as const,
      lineWidth: null,
      color: null,
      colorIndex: null,
    };
    expect(read).toEqual([
      {
        isVisible: true,
        lineStyle: 'Double',
        lineWidth: 'Pt075',
        color: '#FF0000',
        colorIndex: 'Red',
        inside: false,
      },
      { ...none, inside: false },
      {
        isVisible: true,
        lineStyle: 'Single',
        lineWidth: 'Pt150',
        color: null,
        colorIndex: 'Auto',
        inside: false,
      },
      { ...none, inside: false },
      { ...none, inside: true },
    ]);
    runtime.dispose();
  });

  test('an item loads on its own', async () => {
    const runtime = await serverRuntime(TITLED);
    const read = await runtime.run(async (context) => {
      const borders = (await first(context)).borders;
      borders.load('items');
      await context.sync();
      const bottom = borders.items[2]!;
      bottom.load('lineWidth');
      await context.sync();
      return bottom.lineWidth;
    });
    expect(read).toBe('Pt150');
    runtime.dispose();
  });

  test('an unknown item property is refused at the load', async () => {
    const runtime = await serverRuntime(TITLED);
    const code = await refusalOf(runtime, async (context) => {
      (await first(context)).borders.load('items/width');
    });
    expect(code.code).toBe('InvalidArgument');
    runtime.dispose();
  });

  test('items are not readable before a load', async () => {
    const runtime = await serverRuntime(TITLED);
    const code = await refusalOf(runtime, async (context) => {
      void (await first(context)).borders.items;
    });
    expect(code.code).toBe('PropertyNotLoaded');
    runtime.dispose();
  });
});

describe('writing paragraph borders', () => {
  test('a bottom line, saved and reopened', async () => {
    const runtime = await serverRuntime(docx(p('plain')));
    await runtime.run(async (context) => {
      const borders = (await first(context)).borders;
      borders.load('items');
      await context.sync();
      const bottom = borders.items[2]!;
      bottom.lineStyle = 'Single';
      bottom.lineWidth = 'Pt075';
      bottom.color = '#1F4E79';
      await context.sync();
    });
    expect(await mainXmlOf(runtime)).toContain(
      '<w:pBdr><w:bottom w:color="1F4E79" w:space="0" w:sz="6" w:val="single"/></w:pBdr>'
    );
    const reopened = await reopen(runtime);
    const read = await reopened.run(async (context) => {
      const borders = (await first(context)).borders;
      borders.load('items/lineStyle,items/lineWidth,items/color');
      await context.sync();
      const bottom = borders.items[2]!;
      return [bottom.lineStyle, bottom.lineWidth, bottom.color];
    });
    expect(read).toEqual(['Single', 'Pt075', '#1F4E79']);
    runtime.dispose();
    reopened.dispose();
  });

  test('borders and alignment in one sync are one write', async () => {
    const runtime = await serverRuntime(docx(p('plain')));
    await runtime.run(async (context) => {
      const paragraph = await first(context);
      paragraph.borders.load('items');
      await context.sync();
      paragraph.alignment = 'Centered';
      paragraph.borders.items[0]!.isVisible = true;
      paragraph.borders.items[2]!.lineStyle = 'Double';
      paragraph.spaceAfter = 6;
      await context.sync();
    });
    const xml = await mainXmlOf(runtime);
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:top w:color="auto" w:space="0" w:sz="4" w:val="single"/>');
    expect(xml).toContain('<w:bottom w:color="auto" w:space="0" w:sz="4" w:val="double"/>');
    expect(xml).toContain('w:after="120"');
    runtime.dispose();
  });

  test('assignments apply in order, and a line style resets the width', async () => {
    const runtime = await serverRuntime(docx(p('plain')));
    await runtime.run(async (context) => {
      const borders = (await first(context)).borders;
      borders.load('items');
      await context.sync();
      const top = borders.items[0]!;
      top.isVisible = false;
      top.lineStyle = 'Triple';
      top.colorIndex = 'Blue';
      top.color = '#00FF00';
      const bottom = borders.items[2]!;
      bottom.lineWidth = 'Pt300';
      bottom.lineStyle = 'Single';
      const right = borders.items[3]!;
      right.lineStyle = 'Single';
      right.lineStyle = 'None';
      await context.sync();
    });
    const xml = await mainXmlOf(runtime);
    expect(xml).toContain(
      '<w:pBdr><w:top w:color="00FF00" w:space="0" w:sz="4" w:val="triple"/>' +
        '<w:bottom w:color="auto" w:space="0" w:sz="4" w:val="single"/></w:pBdr>'
    );
    runtime.dispose();
  });

  test('set() applies several properties, and copies another border', async () => {
    const runtime = await serverRuntime(TITLED);
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      const [title, body] = paragraphs.items;
      title!.borders.load('items/lineStyle,items/lineWidth,items/color,items/isVisible');
      body!.borders.load('items');
      await context.sync();
      body!.borders.items[0]!.set(title!.borders.items[0]!);
      body!.borders.items[2]!.set({ lineStyle: 'Dot', lineWidth: 'Pt225', colorIndex: 'Green' });
      await context.sync();
    });
    const xml = await mainXmlOf(runtime);
    const body = xml.slice(xml.indexOf('<w:t>title</w:t>'));
    expect(body).toContain('<w:top w:color="FF0000" w:space="0" w:sz="6" w:val="double"/>');
    expect(body).toContain('<w:bottom w:color="008000" w:space="0" w:sz="18" w:val="dotted"/>');
    runtime.dispose();
  });

  test('writing back a style border changes nothing, and turning it off states one edge', async () => {
    const runtime = await serverRuntime(TITLED);
    const before = await mainXmlOf(runtime);
    await runtime.run(async (context) => {
      const borders = (await first(context)).borders;
      borders.load('items/lineStyle,items/lineWidth,items/color,items/isVisible');
      await context.sync();
      const top = borders.items[0]!;
      top.lineStyle = top.lineStyle as 'Double';
      top.lineWidth = top.lineWidth!;
      top.color = top.color!;
      top.isVisible = top.isVisible;
      await context.sync();
    });
    expect(await mainXmlOf(runtime)).toBe(before);
    await runtime.run(async (context) => {
      const borders = (await first(context)).borders;
      borders.load('items');
      await context.sync();
      borders.items[0]!.isVisible = false;
      await context.sync();
    });
    expect(await mainXmlOf(runtime)).toContain(
      '<w:pBdr><w:top w:color="auto" w:space="0" w:sz="0" w:val="none"/></w:pBdr>'
    );
    runtime.dispose();
  });

  test('tracked borders record one revision that rejecting restores', async () => {
    const runtime = await createServer(TITLED, { author: 'Reviewer' });
    const before = await mainXmlOf(runtime);
    await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      const paragraph = await first(context);
      paragraph.borders.load('items');
      await context.sync();
      paragraph.borders.items[2]!.lineStyle = 'Double';
      paragraph.alignment = 'Right';
      await context.sync();
    });
    const tracked = await mainXmlOf(runtime);
    expect(tracked.match(/<w:pPrChange /g)?.length).toBe(1);
    expect(tracked).toContain('w:author="Reviewer"');
    await runtime.run(async (context) => {
      context.document.body.revisions.rejectAll();
      await context.sync();
    });
    expect(await mainXmlOf(runtime)).toBe(before);
    runtime.dispose();
  });

  test('a content lock refuses a border write and leaves the document alone', async () => {
    const runtime = await serverRuntime(
      docx(
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
          p('locked') +
          '</w:sdtContent></w:sdt>'
      )
    );
    const before = await mainXmlOf(runtime);
    const refused = await refusalOf(runtime, async (context) => {
      const borders = (await first(context)).borders;
      borders.load('items');
      await context.sync();
      borders.items[2]!.lineStyle = 'Single';
    });
    expect(refused.code).not.toBe('accepted');
    expect(await mainXmlOf(runtime)).toBe(before);
    runtime.dispose();
  });

  test('a width on an edge with no line changes nothing', async () => {
    const runtime = await serverRuntime(docx(p('plain')));
    const before = await mainXmlOf(runtime);
    const refused = await refusalOf(runtime, async (context) => {
      const borders = (await first(context)).borders;
      borders.load('items');
      await context.sync();
      borders.items[0]!.lineWidth = 'Pt100';
    });
    expect(refused.code).toBe('accepted');
    expect(await mainXmlOf(runtime)).toBe(before);
    runtime.dispose();
  });

  const callRefusals: readonly [
    string,
    string,
    (items: import('../borders.ts').BorderUniversal[]) => void,
  ][] = [
    [
      'an unknown line style',
      'InvalidArgument',
      (items) => ((items[0] as unknown as { lineStyle: string }).lineStyle = 'Zigzag'),
    ],
    ['a colour without a hash', 'InvalidArgument', (items) => (items[0]!.color = 'FF0000')],
    [
      'a palette entry the host cannot resolve',
      'NotSupported',
      (items) => (items[0]!.colorIndex = 'ByAuthor'),
    ],
    ['an artStyle load', 'NotSupported', (items) => void items[0]!.load('artStyle')],
    ['artStyle', 'NotSupported', (items) => (items[0]!.artStyle = 'Apples')],
    ['artWidth', 'NotSupported', (items) => (items[0]!.artWidth = 12)],
    ['an artStyle read', 'NotSupported', (items) => void items[0]!.artStyle],
    ['a set() with art', 'NotSupported', (items) => items[0]!.set({ artWidth: 3 })],
    [
      'a set() with an unknown key',
      'InvalidArgument',
      (items) => items[0]!.set({ width: 3 } as unknown as Parameters<(typeof items)[0]['set']>[0]),
    ],
    [
      'a set() with inside',
      'InvalidArgument',
      (items) =>
        items[0]!.set({ inside: true } as unknown as Parameters<(typeof items)[0]['set']>[0]),
    ],
    [
      'a visibility that is not a boolean',
      'InvalidArgument',
      (items) => ((items[0] as unknown as { isVisible: unknown }).isVisible = 'yes'),
    ],
  ];
  for (const [name, code, edit] of callRefusals) {
    test(`${name} throws ${code} at the call`, async () => {
      const runtime = await serverRuntime(docx(p('plain')));
      const refused = await refusalOf(runtime, async (context) => {
        const borders = (await first(context)).borders;
        borders.load('items');
        await context.sync();
        edit(borders.items);
      });
      expect(refused.code).toBe(code);
      runtime.dispose();
    });
  }

  test('set() skips inside when throwOnReadOnly is false', async () => {
    const runtime = await serverRuntime(docx(p('plain')));
    await runtime.run(async (context) => {
      const borders = (await first(context)).borders;
      borders.load('items');
      await context.sync();
      borders.items[4]!.set(
        { inside: true, lineStyle: 'Dot' } as unknown as BorderUniversalUpdateData,
        { throwOnReadOnly: false }
      );
      await context.sync();
    });
    expect(await mainXmlOf(runtime)).toContain(
      '<w:between w:color="auto" w:space="0" w:sz="4" w:val="dotted"/>'
    );
    runtime.dispose();
  });

  test('a collection load naming artStyle throws NotSupported', async () => {
    const runtime = await serverRuntime(docx(p('plain')));
    const refused = await refusalOf(runtime, async (context) => {
      (await first(context)).borders.load('items/artStyle');
    });
    expect(refused.code).toBe('NotSupported');
    runtime.dispose();
  });

  test('a rejected value throws at the assignment, naming the property', async () => {
    const runtime = await serverRuntime(docx(p('plain')));
    const location = await runtime.run(async (context) => {
      const borders = (await first(context)).borders;
      borders.load('items');
      await context.sync();
      try {
        borders.items[2]!.color = 'red';
      } catch (error) {
        return isDocxEditorError(error) ? error.debugInfo.errorLocation : 'untyped';
      }
      return 'accepted';
    });
    expect(location).toMatch(/borders\.items\[2\]\.color$/);
    runtime.dispose();
  });

  test('applyPageBordersToAllSections throws NotSupported', async () => {
    const runtime = await serverRuntime(docx(p('plain')));
    const refused = await refusalOf(runtime, async (context) => {
      (await first(context)).borders.applyPageBordersToAllSections();
    });
    expect(refused.code).toBe('NotSupported');
    runtime.dispose();
  });
});
