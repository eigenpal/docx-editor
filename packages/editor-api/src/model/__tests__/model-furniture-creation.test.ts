/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { docx, p, serverRuntime, reopen, mainXmlOf } from './support/documents.ts';

const fixture = docx(p('Body sentinel') + '<w:sectPr/>');

test('reading a virtual header does not create parts; its first text write creates a saved header', async () => {
  const runtime = await serverRuntime(fixture);
  const before = await mainXmlOf(runtime);
  await runtime.run(async (context) => {
    const section = context.document.sections.getFirst();
    await context.sync();
    const header = section.getHeader('Primary');
    await context.sync();
    header.load('text');
    header.paragraphs.load('items');
    await context.sync();
    expect(header.text).toBe('');
    expect(header.paragraphs.items).toHaveLength(0);
  });
  expect(await mainXmlOf(runtime)).toBe(before);
  expect(
    Object.keys(unzipSync(await runtime.save())).some((name) => /word\/header\d+\.xml/.test(name))
  ).toBe(false);
  await runtime.run(async (context) => {
    const section = context.document.sections.getFirst();
    await context.sync();
    const header = section.getHeader('Primary');
    await context.sync();
    const range = header.insertText('Company header', 'Replace');
    await context.sync();
    range.load('text');
    await context.sync();
    expect(range.text).toBe('Company header');
  });
  const saved = await reopen(runtime);
  await saved.run(async (context) => {
    const section = context.document.sections.getFirst();
    await context.sync();
    const header = section.getHeader('Primary');
    await context.sync();
    header.load('text');
    await context.sync();
    expect(header.text).toBe('Company header');
  });
  expect(await mainXmlOf(saved)).toContain('Body sentinel');
});

test('first-page and even-page footer authoring preserves variants and enables their rendering flags', async () => {
  const runtime = await serverRuntime(fixture);
  await runtime.run(async (context) => {
    const section = context.document.sections.getFirst();
    await context.sync();
    for (const variant of ['FirstPage', 'EvenPages'] as const) {
      const footer = section.getFooter(variant);
      await context.sync();
      const paragraph = footer.insertParagraph(variant, 'Start');
      await context.sync();
      paragraph.load('text');
      await context.sync();
      expect(paragraph.text).toBe(variant);
    }
  });
  const parts = unzipSync(await runtime.save());
  expect(await mainXmlOf(runtime)).toContain('w:titlePg');
  expect(strFromU8(parts['word/settings.xml']!)).toContain('w:evenAndOddHeaders');
  const footerParts = Object.keys(parts).filter((name) => /word\/footer\d+\.xml/.test(name));
  expect(footerParts).toHaveLength(2);
  expect(footerParts.map((name) => strFromU8(parts[name]!)).join('')).toContain('FirstPage');
  expect(footerParts.map((name) => strFromU8(parts[name]!)).join('')).toContain('EvenPages');
});

test('invalid first content write leaves virtual furniture absent', async () => {
  const runtime = await serverRuntime(fixture);
  const before = await mainXmlOf(runtime);
  await expect(
    runtime.run(async (context) => {
      const section = context.document.sections.getFirst();
      await context.sync();
      const footer = section.getFooter('Primary');
      await context.sync();
      footer.insertText('bad\ntext', 'Replace');
      await context.sync();
    })
  ).rejects.toBeDefined();
  expect(await mainXmlOf(runtime)).toBe(before);
  expect(
    Object.keys(unzipSync(await runtime.save())).some((name) => /word\/footer\d+\.xml/.test(name))
  ).toBe(false);
});

test('an inherited header stays linked when its content is edited through the later section', async () => {
  const runtime = await serverRuntime(
    docx(
      '<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>first section</w:t></w:r></w:p>' +
        p('second section') +
        '<w:sectPr/>'
    )
  );
  await runtime.run(async (context) => {
    const sections = context.document.sections;
    sections.load('items');
    await context.sync();
    expect(sections.items).toHaveLength(2);
    const first = sections.items[0]!.getHeader('Primary');
    await context.sync();
    first.insertText('Initial', 'Replace');
    await context.sync();
    const inherited = sections.items[1]!.getHeader('Primary');
    await context.sync();
    inherited.insertText('Shared replacement', 'Replace');
    await context.sync();
    first.load('text');
    await context.sync();
    expect(first.text).toBe('Shared replacement');
  });
  const parts = unzipSync(await runtime.save());
  expect(Object.keys(parts).filter((name) => /word\/header\d+\.xml/.test(name))).toHaveLength(1);
  expect((await mainXmlOf(runtime)).match(/<w:headerReference\b/g)).toHaveLength(1);
});

test('first furniture writes cannot share a transaction with another command', async () => {
  const runtime = await serverRuntime(fixture);
  const before = await mainXmlOf(runtime);
  for (const reversed of [false, true]) {
    await expect(
      runtime.run(async (context) => {
        const section = context.document.sections.getFirst();
        await context.sync();
        const header = section.getHeader('Primary');
        await context.sync();
        if (reversed) context.document.body.insertText('extra', 'End');
        header.insertText('Header', 'Replace');
        if (!reversed) context.document.body.insertText('extra', 'End');
        await context.sync();
      })
    ).rejects.toBeDefined();
  }
  expect(await mainXmlOf(runtime)).toBe(before);
  expect(
    Object.keys(unzipSync(await runtime.save())).some((name) => /word\/header\d+\.xml/.test(name))
  ).toBe(false);
});
