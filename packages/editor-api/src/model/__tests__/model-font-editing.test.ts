/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { docx, mainXmlOf, p, reopen, serverRuntime } from './support/documents.ts';

const FIXTURE = docx(
  '<w:p><w:bookmarkStart w:id="7" w:name="sentinel"/>' +
    '<w:r><w:rPr><w:color w:val="123456"/><w:u w:val="single" w:color="ABCDEF"/>' +
    '<w:shd w:val="clear" w:fill="EEFFFF"/></w:rPr><w:t>target</w:t></w:r>' +
    '<w:bookmarkEnd w:id="7"/></w:p>' +
    p('untouched')
);

test('extended font writes coalesce, preserve unrelated properties, and survive reopening', async () => {
  const runtime = await serverRuntime(FIXTURE);
  await runtime.run(async (context) => {
    const hits = context.document.body.search('target');
    hits.load('items');
    await context.sync();
    const font = hits.items[0]!.font;
    font.underline = 'Double';
    font.strikeThrough = true;
    font.highlightColor = '#FFFF00';
    font.subscript = true;
    font.superscript = true;
    await context.sync();
  });
  const xml = await mainXmlOf(runtime);
  expect(xml).toContain('w:color="ABCDEF"');
  expect(xml).toContain('w:fill="EEFFFF"');
  expect(xml).toContain('w:name="sentinel"');
  expect(xml).toContain('untouched');
  const saved = await reopen(runtime);
  await saved.run(async (context) => {
    const hits = context.document.body.search('target');
    hits.load('items');
    await context.sync();
    const font = hits.items[0]!.font;
    font.load();
    await context.sync();
    expect(font.underline).toBe('Double');
    expect(font.strikeThrough).toBe(true);
    expect(font.highlightColor).toBe('#FFFF00');
    expect(font.subscript).toBe(false);
    expect(font.superscript).toBe(true);
    expect(font.color).toBe('#123456');
    font.subscript = false;
    font.underline = 'None';
    font.strikeThrough = false;
    // @ts-expect-error Office's pinned declaration omits its documented runtime null clearing.
    font.highlightColor = null;
    await context.sync();
    font.load();
    await context.sync();
    expect(font.superscript).toBe(true);
    expect(font.underline).toBe('None');
    expect(font.strikeThrough).toBe(false);
    expect(font.highlightColor).toBeNull();
    font.superscript = false;
    await context.sync();
    font.load();
    await context.sync();
    expect(font.superscript).toBe(false);
    expect(font.subscript).toBe(false);
  });
  saved.dispose();
  runtime.dispose();
});

test('subscript false preserves superscript independently on each run and paragraph mark', async () => {
  const runtime = await serverRuntime(
    docx(
      '<w:p><w:pPr><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:pPr>' +
        '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>super</w:t></w:r>' +
        '<w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>sub</w:t></w:r></w:p>'
    )
  );
  await runtime.run(async (context) => {
    context.document.body.font.subscript = false;
    await context.sync();
  });
  const xml = await mainXmlOf(runtime);
  expect(xml.match(/w:val="superscript"/g)).toHaveLength(2);
  expect(xml).toContain('w:val="baseline"');
  expect(xml).not.toContain('w:val="subscript"');
  runtime.dispose();
});

for (const [field, value] of [
  ['underline', 'Hidden'],
  ['underline', 'Mixed'],
  ['underline', 'DotLine'],
  ['highlightColor', '#123456'],
] as const) {
  test(`unsupported ${field} ${value} refuses atomically`, async () => {
    const runtime = await serverRuntime(FIXTURE);
    const before = await mainXmlOf(runtime);
    await expect(
      runtime.run(async (context) => {
        const font = context.document.body.font;
        font.bold = true;
        if (field === 'underline') font.underline = value as 'Hidden';
        else font.highlightColor = value;
        await context.sync();
      })
    ).rejects.toMatchObject({ code: 'InvalidArgument' });
    expect(await mainXmlOf(runtime)).toBe(before);
    runtime.dispose();
  });
}

test('highlight palette maps Office color names to exact OOXML colors', async () => {
  const runtime = await serverRuntime(docx(p('text')));
  await runtime.run(async (context) => {
    const font = context.document.body.font;
    for (const [name, hex] of [
      ['Lime', '#00FF00'],
      ['Green', '#008000'],
      ['Pink', '#FF00FF'],
      ['Teal', '#008080'],
    ]) {
      font.highlightColor = name!;
      await context.sync();
      font.load('highlightColor');
      await context.sync();
      expect(font.highlightColor).toBe(hex!);
    }
  });
  runtime.dispose();
});

test('sequential script toggles coalesce without restoring the original opposite mode', async () => {
  const runtime = await serverRuntime(
    docx('<w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>text</w:t></w:r></w:p>')
  );
  await runtime.run(async (context) => {
    const font = context.document.body.font;
    font.subscript = true;
    font.subscript = false;
    await context.sync();
    font.load('subscript,superscript');
    await context.sync();
    expect(font.subscript).toBe(false);
    expect(font.superscript).toBe(false);
  });
  runtime.dispose();
});

test('every supported underline style saves and reads its exact Office value', async () => {
  const runtime = await serverRuntime(docx(p('text')));
  const styles = [
    'None',
    'Single',
    'Word',
    'Double',
    'Thick',
    'Dotted',
    'DottedHeavy',
    'DashLine',
    'DashLineHeavy',
    'DashLineLong',
    'DashLineLongHeavy',
    'DotDashLine',
    'DotDashLineHeavy',
    'TwoDotDashLine',
    'TwoDotDashLineHeavy',
    'Wave',
    'WaveHeavy',
    'WaveDouble',
  ] as const;
  for (const style of styles) {
    await runtime.run(async (context) => {
      context.document.body.font.underline = style;
      await context.sync();
    });
    const saved = await reopen(runtime);
    await saved.run(async (context) => {
      const font = context.document.body.font;
      font.load('underline');
      await context.sync();
      expect(font.underline).toBe(style);
    });
    saved.dispose();
  }
  runtime.dispose();
});
