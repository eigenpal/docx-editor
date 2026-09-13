/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { test, expect } from 'bun:test';
import { docx, p, serverRuntime, mainXmlOf, reopen } from './support/documents.ts';

test('page break inserts after its range and survives reopen', async () => {
  const runtime = await serverRuntime(docx(p('Before TARGET After') + p('Untouched')));
  await runtime.run(async (context) => {
    const hits = context.document.body.search('TARGET');
    hits.load();
    await context.sync();
    hits.items[0]!.insertBreak('Page', 'After');
    await context.sync();
  });
  const xml = await mainXmlOf(runtime);
  expect(xml).toContain('w:type="page"');
  expect(xml).toContain('TARGET');
  const next = await reopen(runtime);
  expect(await mainXmlOf(next)).toContain('Untouched');
  runtime.dispose();
  next.dispose();
});

test('next-page section break preserves text and creates a section boundary', async () => {
  const runtime = await serverRuntime(docx(p('BeforeAfter') + p('Tail')));
  await runtime.run(async (context) => {
    const hits = context.document.body.search('Before');
    hits.load();
    await context.sync();
    hits.items[0]!.insertBreak('SectionNext', 'After');
    await context.sync();
    const sections = context.document.sections;
    sections.load();
    await context.sync();
    expect(sections.items).toHaveLength(2);
  });
  const next = await reopen(runtime);
  const xml = await mainXmlOf(next);
  expect(xml).toContain('Before');
  expect(xml).toContain('After');
  expect(xml).toContain('Tail');
  expect(xml).toContain('w:sectPr');
  runtime.dispose();
  next.dispose();
});

test('unsupported break and section break inside table refuse atomically', async () => {
  const runtime = await serverRuntime(
    docx('<w:tbl><w:tr><w:tc>' + p('Cell') + '</w:tc></w:tr></w:tbl>' + p('Tail'))
  );
  const before = await mainXmlOf(runtime);
  await runtime.run(async (context) => {
    const hits = context.document.body.search('Cell');
    hits.load();
    await context.sync();
    hits.items[0]!.insertBreak('SectionNext', 'After');
    await expect(context.sync()).rejects.toBeDefined();
    hits.items[0]!.insertBreak('SectionOdd', 'After');
    await expect(context.sync()).rejects.toBeDefined();
  });
  expect(await mainXmlOf(runtime)).toBe(before);
  runtime.dispose();
});
