/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Content inserted right after a field that ends its paragraph lands after the field's `end`
// marker: text, a second field, a picture, and an equation, tracked and untracked.
import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor, type DocxEditorServerRuntime, type RequestContext } from '../../index.ts';
import { docx, p } from './support/docx.ts';
import { equationPackage } from './support/flat-opc.ts';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function documentXml(runtime: DocxEditorServerRuntime): Promise<string> {
  return strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
}

const end = (c: RequestContext) => c.document.body.paragraphs.getFirst().getRange('End');

async function counts(c: RequestContext): Promise<[number, number, string]> {
  const fields = c.document.body.fields;
  const pictures = c.document.body.inlinePictures;
  fields.load('items');
  pictures.load('items');
  c.document.body.load('text');
  await c.sync();
  return [fields.items.length, pictures.items.length, c.document.body.text];
}

/** Every `end` marker sits alone in its run, as the field readers require. */
function endsStandAlone(xml: string): void {
  for (const run of xml.match(
    /<w:r>(?:(?!<\/w:r>).)*w:fldCharType="end"(?:(?!<\/w:r>).)*<\/w:r>/g
  ) ?? [])
    expect(run).toMatch(
      /^<w:r>(?:<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>)?<w:fldChar w:fldCharType="end"\/><\/w:r>$/
    );
}

describe('insertions after a field at the end of a paragraph', () => {
  for (const type of ['Ref', 'Seq', 'Page'] as const) {
    for (const result of ['', 'R']) {
      test(`${type}, result ${result ? 'written' : 'empty'}: text, field, picture, and equation follow it`, async () => {
        const runtime = await DocxEditor.createServer(docx(p('anchor')));
        try {
          await runtime.run(async (c) => {
            const field = end(c).insertField('After', type, type === 'Page' ? undefined : 'x');
            await c.sync();
            if (result) field.result.insertText(result, 'Replace');
            await c.sync();
            end(c).insertText('typed', 'After');
            await c.sync();
            end(c).insertField('After', 'Seq', 'Second');
            await c.sync();
            end(c).insertInlinePictureFromBase64(PNG, 'After');
            await c.sync();
            end(c).insertOoxml(equationPackage(), 'After');
            await c.sync();
            const [fields, pictures, text] = await counts(c);
            expect(fields).toBe(2);
            expect(pictures).toBe(1);
            expect(text).toBe(`anchor${result}typed\uFFFC\uFFFC`);
          });
          endsStandAlone(await documentXml(runtime));
          const reopened = await DocxEditor.createServer(await runtime.save());
          try {
            await reopened.run(async (c) => {
              expect((await counts(c)).slice(0, 2)).toEqual([2, 1]);
            });
          } finally {
            reopened.dispose();
          }
        } finally {
          runtime.dispose();
        }
      });
    }
  }

  for (const result of ['', 'R']) {
    test(`tracked, result ${result ? 'written' : 'empty'}: text, a field, and an equation follow it`, async () => {
      const runtime = await DocxEditor.createServer(docx(p('anchor')), { author: 'Agent' });
      try {
        await runtime.run(async (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          const field = end(c).insertField('After', 'Ref', 'x');
          await c.sync();
          if (result) field.result.insertText(result, 'Replace');
          await c.sync();
          end(c).insertText('typed', 'After');
          await c.sync();
          end(c).insertField('After', 'Seq', 'Second');
          await c.sync();
          end(c).insertOoxml(equationPackage(), 'After');
          await c.sync();
          expect(await counts(c)).toEqual([2, 0, `anchor${result}typed\uFFFC`]);
          c.document.body.revisions.rejectAll();
          await c.sync();
          expect(await counts(c)).toEqual([0, 0, 'anchor']);
        });
      } finally {
        runtime.dispose();
      }
    });
  }
});

describe('a field inside a rich text content control stays inside it', () => {
  for (const tracked of [false, true]) {
    test(tracked ? 'tracked' : 'untracked', async () => {
      const runtime = await DocxEditor.createServer(
        docx(
          '<w:p><w:r><w:t xml:space="preserve">Before </w:t></w:r><w:sdt><w:sdtPr><w:richText/>' +
            '</w:sdtPr><w:sdtContent><w:r><w:t>control x text</w:t></w:r></w:sdtContent></w:sdt></w:p>'
        ),
        { author: 'Agent' }
      );
      try {
        await runtime.run(async (c) => {
          if (tracked) c.document.changeTrackingMode = 'TrackMineOnly';
          c.document.body.search('x').getFirst().insertField('After', 'Seq', 'S');
          await c.sync();
          const controls = c.document.body.contentControls;
          controls.load('items');
          await c.sync();
          expect(controls.items).toHaveLength(1);
          expect((await counts(c))[0]).toBe(1);
        });
        expect(await documentXml(runtime)).toMatch(
          /<w:sdtContent>(?:(?!<\/w:sdtContent>).)*w:fldCharType="begin"(?:(?!<\/w:sdtContent>).)*<\/w:sdtContent>/
        );
      } finally {
        runtime.dispose();
      }
    });
  }
});
