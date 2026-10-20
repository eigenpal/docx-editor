/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `Field.result`: read the cached result, write it with insertText(text, 'Replace'), tracked
// and untracked, and the refusals for every other range member.
import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  paragraphFragmentsOf,
} from '@docx-editor.dev/core/layout';
import { DocxEditor, type DocxEditorServerRuntime, type RequestContext } from '../../index.ts';
import { docx, p } from './support/docx.ts';

const AUTHOR = 'Field agent';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SAMPLE = docx(
  '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">See figure</w:t></w:r>' +
    '<w:r><w:t xml:space="preserve"> here.</w:t></w:r></w:p>' +
    p('Second paragraph.')
);

async function documentXml(runtime: DocxEditorServerRuntime): Promise<string> {
  return strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
}

async function bodyText(c: RequestContext): Promise<string> {
  c.document.body.load('text');
  await c.sync();
  return c.document.body.text;
}

async function resultTexts(c: RequestContext): Promise<string[]> {
  const fields = c.document.body.fields;
  fields.load('items');
  await c.sync();
  for (const field of fields.items) field.load('result');
  await c.sync();
  return fields.items.map((field) => field.result.text);
}

/** The text each painted paragraph shows, laid out from the saved document part. */
function paintedTexts(xml: string): string[] {
  const read = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 1, { measurer: createFixedMeasurer(6, 14) });
  return layout.pages.flatMap((page) =>
    paragraphFragmentsOf(page).map((fragment) =>
      fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('')
    )
  );
}

/** Insert a Ref field after "figure", sync, and write its result. */
async function insertWithResult(
  runtime: DocxEditorServerRuntime,
  tracked: boolean,
  result = 'Figure 1'
): Promise<void> {
  await runtime.run(async (c) => {
    if (tracked) c.document.changeTrackingMode = 'TrackMineOnly';
    const field = c.document.body.search('figure').getFirst().insertField('After', 'Ref', '_Ref1');
    await c.sync();
    field.result.insertText(result, 'Replace');
    await c.sync();
  });
}

describe('Field.result reads and writes', () => {
  test('a tracked field takes its result inside the same insertion; reject removes both', async () => {
    const runtime = await DocxEditor.createServer(SAMPLE, { author: AUTHOR });
    try {
      await insertWithResult(runtime, true);
      await runtime.run(async (c) => {
        expect(await resultTexts(c)).toEqual(['Figure 1']);
        const field = c.document.body.fields.getFirst();
        field.result.load('text');
        await c.sync();
        expect(field.result.text).toBe('Figure 1');
        expect(await bodyText(c)).toBe('See figureFigure 1 here.\rSecond paragraph.');
      });
      const xml = await documentXml(runtime);
      // One insertion holds the whole field: begin (dirty), instruction, separate, result, end.
      expect(xml.match(/<w:ins /g)).toHaveLength(1);
      const insertion = /<w:ins [^>]*>(.*?)<\/w:ins>/.exec(xml)![1]!;
      expect(insertion).toMatch(
        /<w:fldChar w:dirty="true" w:fldCharType="begin"\/>.*<w:instrText[^>]*> REF _Ref1 <\/w:instrText>.*w:fldCharType="separate".*<w:t>Figure 1<\/w:t>.*w:fldCharType="end"/
      );
      // Every field run, the result run among them, takes the formatting of the text before it.
      expect(insertion.match(/<w:r><w:rPr><w:b\/><\/w:rPr>/g)).toHaveLength(5);
      expect(paintedTexts(xml)[0]).toContain('See figureFigure 1 here.');
      const bytes = await runtime.save();
      for (const decision of ['accept', 'reject'] as const) {
        const reopened = await DocxEditor.createServer(bytes, { author: 'Reviewer' });
        try {
          await reopened.run(async (c) => {
            expect(await resultTexts(c)).toEqual(['Figure 1']);
            c.document.body.revisions.load('items');
            await c.sync();
            expect(c.document.body.revisions.items).toHaveLength(1);
            if (decision === 'accept') c.document.body.revisions.acceptAll();
            else c.document.body.revisions.rejectAll();
            await c.sync();
            expect(await resultTexts(c)).toEqual(decision === 'accept' ? ['Figure 1'] : []);
            expect(await bodyText(c)).toBe(
              decision === 'accept'
                ? 'See figureFigure 1 here.\rSecond paragraph.'
                : 'See figure here.\rSecond paragraph.'
            );
          });
          const decided = await documentXml(reopened);
          expect(decided).not.toMatch(/<w:ins[ >]/);
          if (decision === 'reject') expect(decided).not.toContain('Figure 1');
          else expect(decided).toContain('w:dirty="true"');
        } finally {
          reopened.dispose();
        }
      }
    } finally {
      runtime.dispose();
    }
  });

  test('an untracked write rewrites the result, marks the field dirty, and survives reopen', async () => {
    const runtime = await DocxEditor.createServer(SAMPLE);
    try {
      await insertWithResult(runtime, false, 'Table\t2');
      const xml = await documentXml(runtime);
      expect(xml).not.toMatch(/<w:ins[ >]/);
      expect(xml).toContain('<w:fldChar w:dirty="true" w:fldCharType="begin"/>');
      expect(xml).toMatch(/<w:t>Table<\/w:t><w:tab\/><w:t>2<\/w:t>/);
      expect(paintedTexts(xml)[0]).toContain('See figureTable');
      const reopened = await DocxEditor.createServer(await runtime.save());
      try {
        await reopened.run(async (c) => {
          expect(await resultTexts(c)).toEqual(['Table\t2']);
          // A second write replaces the first; the instruction stays the same.
          c.document.body.fields.getFirst().result.insertText('Table 3', 'Replace');
          await c.sync();
          expect(await resultTexts(c)).toEqual(['Table 3']);
          const field = c.document.body.fields.getFirst();
          field.load('code');
          await c.sync();
          expect(field.code.trim()).toBe('REF _Ref1');
        });
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  test("an existing field's result reads and writes, simple or complex", async () => {
    const existing = docx(
      '<w:p><w:r><w:t xml:space="preserve">A </w:t></w:r><w:fldSimple w:instr=" SEQ Figure ">' +
        '<w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve"> B </w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> DATE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:i/></w:rPr>' +
        '<w:t>1 May</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    );
    const runtime = await DocxEditor.createServer(existing);
    try {
      await runtime.run(async (c) => {
        expect(await resultTexts(c)).toEqual(['1', '1 May']);
        const fields = c.document.body.fields;
        fields.load('items');
        await c.sync();
        fields.items[0]!.result.insertText('7', 'Replace');
        fields.items[1]!.result.insertText('2 June', 'Replace');
        await c.sync();
        expect(await resultTexts(c)).toEqual(['7', '2 June']);
      });
      const xml = await documentXml(runtime);
      expect(xml).toMatch(/<w:fldSimple [^>]*w:dirty="true"[^>]*><w:r><w:t>7<\/w:t>/);
      expect(xml).toContain('<w:rPr><w:i/></w:rPr><w:t>2 June</w:t>');
    } finally {
      runtime.dispose();
    }
  });
});

describe('page fields after review', () => {
  test('an accepted tracked PAGE field takes updateResult; the computed result is not dirty', async () => {
    const runtime = await DocxEditor.createServer(SAMPLE, {
      author: AUTHOR,
      pagination: { measurer: createFixedMeasurer(6, 14) },
    });
    try {
      await runtime.run(async (c) => {
        c.document.changeTrackingMode = 'TrackMineOnly';
        c.document.body.search('figure').getFirst().insertField('After', 'Page');
        await c.sync();
        c.document.changeTrackingMode = 'Off';
        c.document.body.revisions.acceptAll();
        await c.sync();
        c.document.body.fields.getFirst().updateResult();
        await c.sync();
        expect(await resultTexts(c)).toEqual(['1']);
      });
      const xml = await documentXml(runtime);
      expect(xml).not.toContain('w:dirty');
      expect(xml).toContain('<w:t>1</w:t>');
    } finally {
      runtime.dispose();
    }
  });
});

describe('Field.result refusals', () => {
  const refused = (code: string, inner: string) => ({
    code,
    debugInfo: { innerError: { code: inner } },
  });

  test('every other range member refuses with NotImplemented and changes nothing', async () => {
    const runtime = await DocxEditor.createServer(SAMPLE, { author: AUTHOR });
    try {
      await insertWithResult(runtime, false);
      const before = await documentXml(runtime);
      const members: ((c: RequestContext) => void)[] = [
        (c) => {
          c.document.body.fields.getFirst().result.font.bold = true;
        },
        (c) => c.document.body.fields.getFirst().result.load('style'),
        (c) => c.document.body.fields.getFirst().result.paragraphs.load('items'),
        (c) => c.document.body.fields.getFirst().result.delete(),
        (c) => c.document.body.fields.getFirst().result.getRange('Start').load('text'),
        (c) => c.document.body.fields.getFirst().result.search('Figure').load('items'),
        (c) => c.document.body.fields.getFirst().result.insertText('x', 'After'),
        (c) => c.document.body.fields.getFirst().result.insertText('x', 'Start'),
        (c) => c.document.body.fields.getFirst().result.insertField('After', 'Page'),
        (c) => c.document.body.fields.getFirst().result.insertOoxml('<x/>', 'Replace'),
        (c) => c.document.body.fields.getFirst().result.insertParagraph('x', 'After'),
        (c) => c.document.body.fields.getFirst().result.revisions.load('items'),
      ];
      for (const member of members) {
        await expect(
          runtime.run(async (c) => {
            member(c);
            await c.sync();
          })
        ).rejects.toMatchObject(refused('NotImplemented', 'edit.field-result-unsupported'));
      }
      expect(await documentXml(runtime)).toBe(before);
    } finally {
      runtime.dispose();
    }
  });

  test("a tracked write on a field that is not the author's own insertion refuses", async () => {
    const runtime = await DocxEditor.createServer(SAMPLE, { author: AUTHOR });
    try {
      await insertWithResult(runtime, false);
      const before = await documentXml(runtime);
      await expect(
        runtime.run(async (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          c.document.body.fields.getFirst().result.insertText('Figure 2', 'Replace');
          await c.sync();
        })
      ).rejects.toMatchObject(refused('NotSupported', 'edit.tracked-operation-unsupported'));
      expect(await documentXml(runtime)).toBe(before);
    } finally {
      runtime.dispose();
    }
  });

  test("writes to a field in another author's insertion refuse, tracked or not", async () => {
    const runtime = await DocxEditor.createServer(SAMPLE, { author: AUTHOR });
    try {
      await insertWithResult(runtime, true);
      const bytes = await runtime.save();
      const other = await DocxEditor.createServer(bytes, { author: 'Other' });
      try {
        const before = await documentXml(other);
        await expect(
          other.run(async (c) => {
            c.document.body.fields.getFirst().result.insertText('Figure 9', 'Replace');
            await c.sync();
          })
        ).rejects.toMatchObject(refused('NotImplemented', 'edit.revision-unsupported'));
        await expect(
          other.run(async (c) => {
            c.document.changeTrackingMode = 'TrackMineOnly';
            c.document.body.fields.getFirst().result.insertText('Figure 9', 'Replace');
            await c.sync();
          })
        ).rejects.toMatchObject(refused('NotSupported', 'edit.tracked-operation-unsupported'));
        expect(await documentXml(other)).toBe(before);
      } finally {
        other.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  test('a result with more than plain runs, a locked field, and bad text refuse', async () => {
    const shaped = docx(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> REF a </w:instrText>' +
        '</w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>One</w:t></w:r>' +
        '<w:r><w:sym w:font="Symbol" w:char="F062"/></w:r><w:r><w:fldChar ' +
        'w:fldCharType="end"/></w:r></w:p>' +
        '<w:p><w:fldSimple w:instr=" SEQ T " w:fldLock="true"><w:r><w:t>4</w:t></w:r>' +
        '</w:fldSimple></w:p>' +
        `<w:p><w:fldSimple w:instr=" SEQ U "><w:r><w:t>5</w:t></w:r></w:fldSimple></w:p>`
    );
    const runtime = await DocxEditor.createServer(shaped);
    try {
      const before = await documentXml(runtime);
      const write = (index: number, text: string) =>
        runtime.run(async (c) => {
          const fields = c.document.body.fields;
          fields.load('items');
          await c.sync();
          fields.items[index]!.result.insertText(text, 'Replace');
          await c.sync();
        });
      await expect(write(0, 'Two')).rejects.toMatchObject(
        refused('NotSupported', 'edit.unsupported-content')
      );
      await expect(write(1, '5')).rejects.toMatchObject({ code: 'InvalidArgument' });
      await expect(write(2, 'a\u000bb')).rejects.toMatchObject(
        refused('InvalidArgument', 'edit.invalid-argument')
      );
      for (const text of ['a\nb', 'a\rb'])
        await expect(write(2, text)).rejects.toMatchObject(
          refused('InvalidArgument', 'edit.invalid-argument')
        );
      await expect(write(2, 'x'.repeat(2049))).rejects.toMatchObject({ code: 'InvalidArgument' });
      expect(await documentXml(runtime)).toBe(before);
      // A read works whatever the result holds.
      await runtime.run(async (c) => {
        const texts = await resultTexts(c);
        expect(texts[0]).toStartWith('One');
        expect(texts.slice(1)).toEqual(['4', '5']);
      });
    } finally {
      runtime.dispose();
    }
  });
});

describe('w:dirty and formatting on inserted fields', () => {
  test('new field types are dirty, page fields keep their simple form, and runs take the left formatting', async () => {
    const runtime = await DocxEditor.createServer(SAMPLE);
    try {
      await runtime.run(async (c) => {
        const hit = c.document.body.search('figure').getFirst();
        hit.insertField('After', 'Seq', 'Figure');
        await c.sync();
        c.document.body.search('here').getFirst().insertField('After', 'Page');
        await c.sync();
      });
      const xml = await documentXml(runtime);
      expect(xml.match(/w:dirty="true"/g)).toHaveLength(1);
      expect(xml).toMatch(
        /<w:rPr><w:b\/><\/w:rPr><w:fldChar w:dirty="true" w:fldCharType="begin"\/>/
      );
      expect(xml).toContain('<w:fldSimple w:instr="PAGE"><w:r><w:t/></w:r></w:fldSimple>');
      void W;
    } finally {
      runtime.dispose();
    }
  });
});
