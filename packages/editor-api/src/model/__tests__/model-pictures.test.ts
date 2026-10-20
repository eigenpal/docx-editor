/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { docx, mainXmlOf, p, reopen, serverRuntime } from './support/documents.ts';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const FIXTURE = docx(
  '<w:p><w:bookmarkStart w:id="9" w:name="keep"/><w:r><w:rPr><w:b/></w:rPr><w:t>anchor</w:t></w:r><w:bookmarkEnd w:id="9"/></w:p>' +
    p('sentinel')
);

test('insert, size, describe, reopen, and delete a picture through public document objects', async () => {
  const runtime = await serverRuntime(FIXTURE);
  await runtime.run(async (context) => {
    const ranges = context.document.body.search('anchor');
    ranges.load('items');
    await context.sync();
    const picture = ranges.items[0]!.insertInlinePictureFromBase64(PNG, 'After');
    await context.sync();
    picture.load('width,height,lockAspectRatio');
    await context.sync();
    expect(picture.width).toBe(0.75);
    expect(picture.height).toBe(0.75);
    expect(picture.lockAspectRatio).toBe(true);
    picture.width = 72;
    picture.altTextDescription = 'Logo <& "company">';
    await context.sync();
    picture.load('width,height,altTextDescription');
    await context.sync();
    expect(picture.width).toBe(72);
    expect(picture.height).toBe(72);
    expect(picture.altTextDescription).toBe('Logo <& "company">');
  });
  const xml = await mainXmlOf(runtime);
  expect(xml).toContain('w:name="keep"');
  expect(xml).toContain('sentinel');
  expect(xml).toContain('<w:b');
  const parts = unzipSync(await runtime.save());
  expect(Object.keys(parts).filter((name) => name.includes('/media/'))).toHaveLength(1);
  expect(strFromU8(parts['word/_rels/document.xml.rels']!)).toContain('/image');
  const saved = await reopen(runtime);
  await saved.run(async (context) => {
    const pictures = context.document.body.inlinePictures;
    pictures.load('items');
    await context.sync();
    expect(pictures.items).toHaveLength(1);
    const picture = pictures.items[0]!;
    picture.load('width,height,altTextDescription');
    await context.sync();
    expect(picture.width).toBe(72);
    expect(picture.height).toBe(72);
    expect(picture.altTextDescription).toBe('Logo <& "company">');
    picture.lockAspectRatio = false;
    picture.height = 36;
    await context.sync();
    picture.load('width,height,lockAspectRatio');
    await context.sync();
    expect(picture.width).toBe(72);
    expect(picture.height).toBe(36);
    expect(picture.lockAspectRatio).toBe(false);
    picture.delete();
    await context.sync();
    pictures.load('items');
    await context.sync();
    expect(pictures.items).toHaveLength(0);
  });
  expect(await mainXmlOf(saved)).not.toContain('<w:drawing');
  expect(await mainXmlOf(saved)).toContain('anchor');
  saved.dispose();
  runtime.dispose();
});

for (const invalid of [
  '',
  'data:image/png;base64,' + PNG,
  '!!!!',
  PNG.slice(0, 44),
  'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
]) {
  test(`invalid or unsupported image refuses without editing the package (${invalid.slice(0, 20)})`, async () => {
    const runtime = await serverRuntime(FIXTURE);
    const before = await mainXmlOf(runtime);
    await expect(
      runtime.run(async (context) => {
        const hits = context.document.body.search('anchor');
        hits.load('items');
        await context.sync();
        hits.items[0]!.insertInlinePictureFromBase64(invalid, 'After');
        await context.sync();
      })
    ).rejects.toMatchObject({ code: 'InvalidArgument' });
    expect(await mainXmlOf(runtime)).toBe(before);
    expect(
      Object.keys(unzipSync(await runtime.save())).filter((name) => name.includes('/media/'))
    ).toHaveLength(0);
    runtime.dispose();
  });
}

test('locked conflicting dimensions and invalid alt text refuse atomically', async () => {
  const runtime = await serverRuntime(FIXTURE);
  await runtime.run(async (context) => {
    const hits = context.document.body.search('anchor');
    hits.load('items');
    await context.sync();
    hits.items[0]!.insertInlinePictureFromBase64(PNG, 'Before');
    await context.sync();
  });
  const before = await mainXmlOf(runtime);
  await expect(
    runtime.run(async (context) => {
      const pictures = context.document.body.inlinePictures;
      pictures.load('items');
      await context.sync();
      const picture = pictures.items[0]!;
      picture.width = 72;
      picture.height = 36;
      await context.sync();
    })
  ).rejects.toMatchObject({ code: 'InvalidArgument' });
  expect(await mainXmlOf(runtime)).toBe(before);
  await expect(
    runtime.run(async (context) => {
      const picture = context.document.body.inlinePictures.getFirst();
      await context.sync();
      picture.altTextDescription = 'invalid\u0000';
      await context.sync();
    })
  ).rejects.toMatchObject({ code: 'InvalidArgument' });
  expect(await mainXmlOf(runtime)).toBe(before);
  runtime.dispose();
});

test('JPEG bytes persist exactly, and deleting one shared picture keeps the other relationship', async () => {
  const jpeg = readFileSync(
    new URL(
      '../../../../../examples/collaboration-hocuspocus/public/avatars/gandalf.jpg',
      import.meta.url
    )
  );
  const runtime = await serverRuntime(FIXTURE);
  await runtime.run(async (context) => {
    const hits = context.document.body.search('anchor');
    hits.load('items');
    await context.sync();
    hits.items[0]!.insertInlinePictureFromBase64(jpeg.toString('base64'), 'Before');
    await context.sync();
  });
  await runtime.run(async (context) => {
    const hits = context.document.body.search('sentinel');
    hits.load('items');
    await context.sync();
    hits.items[0]!.insertInlinePictureFromBase64(jpeg.toString('base64'), 'After');
    await context.sync();
  });
  const parts = unzipSync(await runtime.save());
  const xml = strFromU8(parts['word/document.xml']!);
  const ids = [...xml.matchAll(/r:embed="([^"]+)"/g)].map((match) => match[1]!);
  expect(ids).toHaveLength(2);
  parts['word/document.xml'] = strToU8(xml.replace(`r:embed="${ids[1]}"`, `r:embed="${ids[0]}"`));
  const shared = await serverRuntime(zipSync(parts));
  await shared.run(async (context) => {
    const pictures = context.document.body.inlinePictures;
    pictures.load('items');
    await context.sync();
    expect(pictures.items).toHaveLength(2);
    pictures.items[0]!.delete();
    await context.sync();
    pictures.load('items');
    await context.sync();
    expect(pictures.items).toHaveLength(1);
    pictures.items[0]!.load('width,height');
    await context.sync();
    expect(pictures.items[0]!.width).toBeGreaterThan(0);
  });
  const after = unzipSync(await shared.save());
  const media = Object.keys(after).filter((name) => name.includes('/media/'));
  expect(media).toHaveLength(2);
  for (const name of media) expect(after[name]).toEqual(new Uint8Array(jpeg));
  const again = await reopen(shared);
  await again.run(async (context) => {
    const pictures = context.document.body.inlinePictures;
    pictures.load('items');
    await context.sync();
    expect(pictures.items).toHaveLength(1);
  });
  again.dispose();
  shared.dispose();
  runtime.dispose();
});

test('Replace removes only the intended text and picture handles become stale after deletion', async () => {
  const runtime = await serverRuntime(docx(p('prefix target suffix') + p('target sentinel')));
  await runtime.run(async (context) => {
    const hits = context.document.body.search('target');
    hits.load('items');
    await context.sync();
    const picture = hits.items[0]!.insertInlinePictureFromBase64(PNG, 'Replace');
    await context.sync();
    picture.load('width');
    await context.sync();
    expect(picture.width).toBe(0.75);
    picture.delete();
    await context.sync();
    picture.load('width');
    await expect(context.sync()).rejects.toMatchObject({ code: 'InvalidObjectPath' });
  });
  const xml = await mainXmlOf(runtime);
  expect(xml).toContain('prefix ');
  expect(xml).toContain(' suffix');
  expect(xml).toContain('target sentinel');
  runtime.dispose();
});

test('picture replacement inside a locked control refuses without allocating media', async () => {
  const runtime = await serverRuntime(
    docx(
      '<w:p><w:sdt><w:sdtPr><w:id w:val="17"/><w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent><w:r><w:t>locked</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    )
  );
  const before = await mainXmlOf(runtime);
  await expect(
    runtime.run(async (context) => {
      const hits = context.document.body.search('locked');
      hits.load('items');
      await context.sync();
      hits.items[0]!.insertInlinePictureFromBase64(PNG, 'Replace');
      await context.sync();
    })
  ).rejects.toMatchObject({ code: 'InvalidArgument' });
  expect(await mainXmlOf(runtime)).toBe(before);
  expect(
    Object.keys(unzipSync(await runtime.save())).some((name) => name.includes('/media/'))
  ).toBe(false);
  runtime.dispose();
});
