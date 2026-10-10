/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { strFromU8, unzipSync } from 'fflate';
import { createFixedMeasurer } from '../../../../core/src/layout/semantic-layout.ts';
import { createBrowser } from '../../runtime/browser.ts';
import { createServer } from '../../runtime/server.ts';
import type { DocxEditorRuntime } from '../../runtime/runtime.ts';
import { docx, p } from './support/documents.ts';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
async function author(runtime: DocxEditorRuntime) {
  return runtime.run(async (context) => {
    const picture = context.document.body
      .getRange('Start')
      .insertInlinePictureFromBase64(PNG, 'Before');
    await context.sync();
    picture.width = 18;
    picture.altTextDescription = 'Agent logo';
    await context.sync();
    const field = context.document.body.getRange('End').insertField('Before', 'Page');
    await context.sync();
    field.updateResult();
    await context.sync();
    field.code = 'NUMPAGES';
    await context.sync();
    field.updateResult();
    await context.sync();
    picture.load('width,height,lockAspectRatio,altTextDescription');
    field.load('code');
    context.document.body.load('text');
    await context.sync();
    return {
      width: picture.width,
      height: picture.height,
      lock: picture.lockAspectRatio,
      description: picture.altTextDescription,
      code: field.code.trim(),
      text: context.document.body.text,
    };
  });
}
async function snapshot(runtime: DocxEditorRuntime) {
  return runtime.run(async (context) => {
    const picture = context.document.body.inlinePictures.getFirst();
    const field = context.document.body.fields.getFirst();
    picture.load('width,height,lockAspectRatio,altTextDescription');
    field.load('code');
    context.document.body.load('text');
    await context.sync();
    return {
      width: picture.width,
      height: picture.height,
      lock: picture.lockAspectRatio,
      description: picture.altTextDescription,
      code: field.code.trim(),
      text: context.document.body.text,
    };
  });
}

test('browser and headless agent workflows insert pictures and compute saved field results', async () => {
  const bytes = docx(
    p('Page one') + '<w:p><w:r><w:br w:type="page"/><w:t>Page two </w:t></w:r></w:p>'
  );
  const server = await createServer(bytes, {
    pagination: { measurer: createFixedMeasurer(6, 14) },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: bytes });
  if (!editor.surface) throw new Error('browser surface did not mount');
  const browser = createBrowser(editor);
  try {
    const expected = await author(server);
    const actual = await author(browser);
    expect(actual).toEqual(expected);
    expect(actual).toMatchObject({
      width: 18,
      height: 18,
      lock: true,
      description: 'Agent logo',
      code: 'NUMPAGES',
    });
    expect(actual.text).toContain('Page two 2');
    const savedBrowser = await createServer(new Uint8Array(await editor.save()));
    const savedServer = await createServer(await server.save());
    try {
      expect(await snapshot(savedBrowser)).toEqual(await snapshot(savedServer));
      expect(await snapshot(savedBrowser)).toEqual(actual);
    } finally {
      savedBrowser.dispose();
      savedServer.dispose();
    }
    const parts = unzipSync(new Uint8Array(await editor.save()));
    expect(Object.keys(parts).some((name) => name.includes('/media/'))).toBe(true);
    expect(strFromU8(parts['word/document.xml']!)).toContain('w:instr="NUMPAGES"');
  } finally {
    browser.dispose();
    server.dispose();
    editor.destroy();
    container.remove();
  }
});

async function footer(runtime: DocxEditorRuntime): Promise<string> {
  return runtime.run(async (context) => {
    const section = context.document.sections.getFirst();
    await context.sync();
    const body = section.getFooter('Primary');
    await context.sync();
    body.insertText('Pages: ', 'End');
    await context.sync();
    const field = body.getRange('End').insertField('Before', 'Page');
    await context.sync();
    body.insertText(' of ', 'End');
    await context.sync();
    const total = body.getRange('End').insertField('After', 'NumPages');
    await context.sync();
    const paragraph = body.paragraphs.getFirst();
    await context.sync();
    paragraph.font.name = 'Calibri';
    paragraph.font.size = 9;
    paragraph.alignment = 'Centered';
    await context.sync();
    field.updateResult();
    await context.sync();
    total.updateResult();
    await context.sync();
    body.load('text');
    await context.sync();
    return body.text;
  });
}

test('browser and headless hosts create footer fields and save computed caches', async () => {
  const bytes = docx(
    p('Page one') +
      '<w:p><w:r><w:br w:type="page"/><w:t>Page two</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720"/></w:sectPr>'
  );
  const server = await createServer(bytes, {
    pagination: { measurer: createFixedMeasurer(6, 14) },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: bytes });
  const browser = createBrowser(editor);
  try {
    const expected = await footer(server);
    const actual = await footer(browser);
    expect(actual).toBe(expected);
    expect(actual).toBe('Pages: 1 of 2');
    for (const bytes of [await server.save(), new Uint8Array(await editor.save())]) {
      const parts = unzipSync(bytes);
      const name = Object.keys(parts).find((name) => /^word\/footer.*\.xml$/.test(name));
      expect(name).toBeDefined();
      expect(strFromU8(parts[name!]!)).toContain('w:instr="NUMPAGES"');
      const footerXml = strFromU8(parts[name!]!);
      expect(footerXml).toContain('>2<');
      expect(footerXml).toContain('w:instr="PAGE"');
      expect(footerXml.match(/<w:fldSimple[^>]*>[\s\S]*?<\/w:fldSimple>/g)).toHaveLength(2);
      for (const fieldXml of footerXml.match(/<w:fldSimple[^>]*>[\s\S]*?<\/w:fldSimple>/g) ?? []) {
        expect(fieldXml).toContain('w:ascii="Calibri"');
        expect(fieldXml).toContain('w:sz w:val="18"');
      }
      const saved = await createServer(bytes);
      try {
        await saved.run(async (context) => {
          const section = context.document.sections.getFirst();
          await context.sync();
          const body = section.getFooter('Primary');
          body.load('text');
          await context.sync();
          expect(body.text).toBe('Pages: 1 of 2');
        });
      } finally {
        saved.dispose();
      }
    }
  } finally {
    browser.dispose();
    server.dispose();
    editor.destroy();
    container.remove();
  }
});
