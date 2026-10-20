/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { docx, p, serverRuntime, reopen } from './support/documents.ts';

test('metadata loads explicitly, batches writes, escapes XML and survives reopen', async () => {
  const runtime = await serverRuntime(docx(p('Body sentinel')));
  await runtime.run(async (context) => {
    const properties = context.document.properties;
    expect(properties).toBe(context.document.properties);
    expect(() => properties.author).toThrow();
    properties.load('author,title');
    await context.sync();
    expect(properties.author).toBe('');
    properties.author = 'Public Records Office';
    properties.title = 'A < B & "C"';
    properties.subject = 'Public packet';
    properties.comments = '';
    properties.keywords = 'release';
    properties.category = 'Policy';
    await context.sync();
  });
  const saved = await reopen(runtime);
  await saved.run(async (context) => {
    const properties = context.document.properties;
    properties.load('author,title,subject,comments,keywords,category');
    context.document.body.load('text');
    await context.sync();
    expect(properties.author).toBe('Public Records Office');
    expect(properties.title).toBe('A < B & "C"');
    expect(properties.subject).toBe('Public packet');
    expect(properties.comments).toBe('');
    expect(properties.keywords).toBe('release');
    expect(properties.category).toBe('Policy');
    expect(context.document.body.text).toBe('Body sentinel');
  });
});

test('invalid XML and tracked metadata writes refuse atomically', async () => {
  const runtime = await serverRuntime(docx(p('Body sentinel')));
  await expect(
    runtime.run(async (context) => {
      context.document.properties.author = 'Valid';
      context.document.properties.title = '\u0000';
      await context.sync();
    })
  ).rejects.toMatchObject({ code: 'InvalidArgument' });
  await runtime.run(async (context) => {
    context.document.properties.load('author');
    await context.sync();
    expect(context.document.properties.author).toBe('');
  });
  await expect(
    runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      await context.sync();
      context.document.properties.author = 'Changed';
      await context.sync();
    })
  ).rejects.toMatchObject({ code: 'NotSupported' });
});

test('rewriting existing properties preserves unrelated package metadata', async () => {
  const { zipSync, unzipSync, strToU8, strFromU8 } = await import('fflate');
  const seed = await serverRuntime(docx(p('Body sentinel')));
  await seed.run(async (c) => {
    c.document.properties.author = 'Old';
    await c.sync();
  });
  const parts = unzipSync(await seed.save());
  parts['docProps/core.xml'] = strToU8(
    strFromU8(parts['docProps/core.xml']!).replace(
      '</cp:coreProperties>',
      '<cp:lastModifiedBy>Retained</cp:lastModifiedBy><cp:revision>42</cp:revision></cp:coreProperties>'
    )
  );
  const runtime = await serverRuntime(zipSync(parts));
  await runtime.run(async (c) => {
    c.document.properties.author = 'New';
    c.document.properties.title = 'Title';
    await c.sync();
  });
  const xml = strFromU8(unzipSync(await runtime.save())['docProps/core.xml']!);
  expect(xml).toContain('Retained');
  expect(xml).toContain('42');
  expect(xml).not.toContain('>Old<');
  await runtime.run(async (c) => {
    c.document.properties.author = '';
    await c.sync();
    c.document.properties.load('author,title');
    await c.sync();
    expect(c.document.properties.author).toBe('');
    expect(c.document.properties.title).toBe('Title');
  });
});

for (const kind of ['nested', 'contentType', 'relationships'] as const) {
  test(`metadata refuses ambiguous or complex input: ${kind}`, async () => {
    const { zipSync, unzipSync, strToU8, strFromU8 } = await import('fflate');
    const seed = await serverRuntime(docx(p('Body')));
    await seed.run(async (c) => {
      c.document.properties.title = 'Old';
      await c.sync();
    });
    const parts = unzipSync(await seed.save());
    if (kind === 'nested')
      parts['docProps/core.xml'] = strToU8(
        strFromU8(parts['docProps/core.xml']!).replace(
          '</dc:title>',
          '<x:keep xmlns:x="urn:test">Retain</x:keep></dc:title>'
        )
      );
    if (kind === 'contentType')
      parts['[Content_Types].xml'] = strToU8(
        strFromU8(parts['[Content_Types].xml']!).replace(
          'application/vnd.openxmlformats-package.core-properties+xml',
          'application/xml'
        )
      );
    if (kind === 'relationships')
      parts['_rels/.rels'] = strToU8(
        strFromU8(parts['_rels/.rels']!).replace(
          '</Relationships>',
          '<Relationship Id="otherCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'
        )
      );
    const runtime = await serverRuntime(zipSync(parts));
    const before = await runtime.save();
    await expect(
      runtime.run(async (c) => {
        c.document.properties.title = 'Changed';
        await c.sync();
      })
    ).rejects.toMatchObject({ code: 'NotSupported' });
    expect(await runtime.save()).toEqual(before);
    seed.dispose();
    runtime.dispose();
  });
}
