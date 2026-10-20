/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Field insertion as a tracked proposal, the inert field types, and the refusals.
import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import {
  DocxEditor,
  type DocxEditorServerRuntime,
  type FieldTypeLiteral,
  type RequestContext,
} from '../../index.ts';
import { docx, p } from './support/docx.ts';

const AUTHOR = 'Field agent';
const SAMPLE = docx(p('See figure here.') + p('Second paragraph.'));

async function documentXml(runtime: DocxEditorServerRuntime): Promise<string> {
  return strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
}

async function fieldCodes(c: RequestContext): Promise<string[]> {
  const fields = c.document.body.fields;
  fields.load('items');
  await c.sync();
  for (const field of fields.items) field.load('code');
  await c.sync();
  return fields.items.map((field) => field.code.trim());
}

async function bodyText(c: RequestContext): Promise<string> {
  c.document.body.load('text');
  await c.sync();
  return c.document.body.text;
}

/** Insert one field after "figure" in the first paragraph and return its read-back code. */
async function insertAfterFigure(
  runtime: DocxEditorServerRuntime,
  type: FieldTypeLiteral,
  text: string | undefined,
  tracked: boolean
): Promise<string> {
  return runtime.run(async (c) => {
    if (tracked) c.document.changeTrackingMode = 'TrackMineOnly';
    const hit = c.document.body.search('figure').getFirst();
    const field = hit.insertField('After', type, text);
    await c.sync();
    field.load('code');
    await c.sync();
    return field.code.trim();
  });
}

const ALLOWED: readonly {
  readonly type: FieldTypeLiteral;
  readonly text?: string;
  readonly code: string;
}[] = [
  { type: 'Page', code: 'PAGE' },
  { type: 'NumPages', code: 'NUMPAGES' },
  { type: 'Ref', text: '_Ref1 \\h', code: 'REF _Ref1 \\h' },
  { type: 'PageRef', text: '_Ref1  \\h \\p', code: 'PAGEREF _Ref1 \\h \\p' },
  { type: 'NoteRef', text: '_Ref2 \\f \\h', code: 'NOTEREF _Ref2 \\f \\h' },
  { type: 'Seq', text: 'Figure \\* ARABIC', code: 'SEQ Figure \\* ARABIC' },
  { type: 'StyleRef', text: '"Heading 1" \\n', code: 'STYLEREF "Heading 1" \\n' },
  { type: 'Date', text: '\\@ "d MMMM yyyy"', code: 'DATE \\@ "d MMMM yyyy"' },
  { type: 'Time', code: 'TIME' },
  { type: 'Empty', text: 'ref _Ref3 \\h', code: 'REF _Ref3 \\h' },
];

describe('tracked field insertion', () => {
  for (const { type, text, code } of ALLOWED) {
    test(`${type} inserts as one tracked complex field that accept keeps and reject removes`, async () => {
      const runtime = await DocxEditor.createServer(SAMPLE, { author: AUTHOR });
      try {
        expect(await insertAfterFigure(runtime, type, text, true)).toBe(code);
        await runtime.run(async (c) => {
          expect(await fieldCodes(c)).toEqual([code]);
        });
        const xml = await documentXml(runtime);
        expect(xml).not.toContain('fldSimple');
        // begin, instruction, separate, and end sit together in ONE insertion by the author.
        const insertion = /<w:ins [^>]*>(.*?)<\/w:ins>/.exec(xml);
        expect(insertion?.[0]).toContain(`w:author="${AUTHOR}"`);
        expect(xml.match(/<w:ins /g)).toHaveLength(1);
        for (const marker of ['begin', 'separate', 'end'])
          expect(insertion?.[1]).toContain(`w:fldCharType="${marker}"`);
        expect(insertion?.[1]).toContain('<w:instrText');
        const bytes = await runtime.save();
        for (const decision of ['accept', 'reject'] as const) {
          const reopened = await DocxEditor.createServer(bytes, { author: 'Reviewer' });
          try {
            await reopened.run(async (c) => {
              expect(await fieldCodes(c)).toEqual([code]);
              const revisions = c.document.body.revisions;
              revisions.load('items');
              await c.sync();
              expect(revisions.items).toHaveLength(1);
              if (decision === 'accept') revisions.acceptAll();
              else revisions.rejectAll();
              await c.sync();
              expect(await fieldCodes(c)).toEqual(decision === 'accept' ? [code] : []);
              expect(await bodyText(c)).toBe('See figure here.\rSecond paragraph.');
            });
            const decided = await documentXml(reopened);
            expect(decided).not.toMatch(/<w:ins[ >]/);
            if (decision === 'reject') expect(decided).not.toContain('fldChar');
            else expect(decided).toContain('w:fldCharType="begin"');
          } finally {
            reopened.dispose();
          }
        }
      } finally {
        runtime.dispose();
      }
    });

    const simple = type === 'Page' || type === 'NumPages';
    test(`${type} inserts untracked as ${simple ? 'a simple' : 'one complex'} field`, async () => {
      const runtime = await DocxEditor.createServer(SAMPLE);
      try {
        expect(await insertAfterFigure(runtime, type, text, false)).toBe(code);
        const xml = await documentXml(runtime);
        if (simple) {
          expect(xml).toContain(`<w:fldSimple w:instr="${code}"><w:r><w:t/></w:r></w:fldSimple>`);
          expect(xml).not.toContain('w:dirty');
        } else {
          expect(xml).not.toContain('fldSimple');
          expect(xml).toContain('<w:fldChar w:dirty="true" w:fldCharType="begin"/>');
        }
        expect(xml).not.toMatch(/<w:ins[ >]/);
        const reopened = await DocxEditor.createServer(await runtime.save());
        try {
          await reopened.run(async (c) => {
            expect(await fieldCodes(c)).toEqual([code]);
          });
        } finally {
          reopened.dispose();
        }
      } finally {
        runtime.dispose();
      }
    });
  }

  test('a tracked replacement strikes the range and proposes the field after it', async () => {
    const runtime = await DocxEditor.createServer(SAMPLE, { author: AUTHOR });
    try {
      await runtime.run(async (c) => {
        c.document.changeTrackingMode = 'TrackMineOnly';
        c.document.body.search('figure').getFirst().insertField('Replace', 'Seq', 'Figure');
        await c.sync();
      });
      const xml = await documentXml(runtime);
      expect(xml).toMatch(
        /<w:del [^>]*><w:r><w:delText>figure<\/w:delText><\/w:r><\/w:del><w:ins /
      );
      const bytes = await runtime.save();
      const rejected = await DocxEditor.createServer(bytes, { author: 'Reviewer' });
      try {
        await rejected.run(async (c) => {
          c.document.body.revisions.rejectAll();
          await c.sync();
          expect(await fieldCodes(c)).toEqual([]);
          expect(await bodyText(c)).toBe('See figure here.\rSecond paragraph.');
        });
      } finally {
        rejected.dispose();
      }
      const accepted = await DocxEditor.createServer(bytes, { author: 'Reviewer' });
      try {
        await accepted.run(async (c) => {
          c.document.body.revisions.acceptAll();
          await c.sync();
          expect(await fieldCodes(c)).toEqual(['SEQ Figure']);
          expect(await bodyText(c)).toBe('See  here.\rSecond paragraph.');
        });
      } finally {
        accepted.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  test('a tracked field and tracked text in one batch both review as proposals', async () => {
    const runtime = await DocxEditor.createServer(SAMPLE, { author: AUTHOR });
    try {
      await runtime.run(async (c) => {
        c.document.changeTrackingMode = 'TrackMineOnly';
        const paragraph = c.document.body.paragraphs.getLast();
        paragraph.getRange('End').insertText(' See ', 'After');
        await c.sync();
        c.document.body.paragraphs.getLast().getRange('End').insertField('After', 'Ref', '_Ref9');
        await c.sync();
        c.document.body.revisions.rejectAll();
        await c.sync();
        expect(await fieldCodes(c)).toEqual([]);
        expect(await bodyText(c)).toBe('See figure here.\rSecond paragraph.');
      });
    } finally {
      runtime.dispose();
    }
  });
});

const UNSAFE: readonly { readonly type: FieldTypeLiteral; readonly text?: string }[] = [
  { type: 'IncludeText', text: '"C:\\\\a.docx"' },
  { type: 'IncludePicture', text: '"https://example.com/a.png"' },
  { type: 'Link', text: 'Excel.Sheet.8 "a.xlsx"' },
  { type: 'Import', text: '"a.png"' },
  { type: 'MacroButton', text: 'Run Click' },
  { type: 'AutoText', text: 'Entry' },
  { type: 'Hyperlink', text: '"https://example.com"' },
  { type: 'FillIn', text: '"Name?"' },
  { type: 'Empty', text: 'DDE Excel Sheet1 R1C1' },
  { type: 'Empty', text: 'DDEAUTO Excel Sheet1 R1C1' },
  { type: 'Empty', text: 'INCLUDETEXT "https://example.com/a.docx"' },
  { type: 'Empty', text: 'INCLUDEPICTURE "a.png"' },
  { type: 'Empty', text: 'IMPORT "a.png"' },
  { type: 'Empty', text: 'LINK Word.Document.12 "a.docx"' },
  { type: 'Empty', text: 'MACROBUTTON Run Click' },
  { type: 'Empty', text: 'AUTOTEXT Entry' },
  { type: 'Empty', text: '_Ref1' },
  { type: 'Ref', text: '_Ref1 INCLUDETEXT' },
  { type: 'Ref', text: '"https://example.com"' },
  { type: 'Ref' },
  { type: 'Seq' },
  { type: 'Page', text: '\\* roman' },
  { type: 'Ref', text: '_Ref1\t\\h' },
  { type: 'Ref', text: '_Ref1\n\\h' },
  { type: 'Ref', text: '<w:r/>' },
  { type: 'Date', text: '\\@ "a\\"b"' },
  { type: 'Ref', text: `_Ref1 ${'\\h '.repeat(100)}` },
  { type: 'Empty', text: '' },
];

describe('field insertion refusals', () => {
  for (const [index, { type, text }] of UNSAFE.entries()) {
    for (const tracked of [false, true]) {
      test(`${type} ${String(index)} ${tracked ? 'tracked' : 'untracked'} refuses unchanged`, async () => {
        const runtime = await DocxEditor.createServer(SAMPLE, { author: AUTHOR });
        try {
          const before = await documentXml(runtime);
          await expect(insertAfterFigure(runtime, type, text, tracked)).rejects.toMatchObject({
            code: 'InvalidArgument',
            debugInfo: { innerError: { code: 'edit.field-unsupported' } },
          });
          expect(await documentXml(runtime)).toBe(before);
        } finally {
          runtime.dispose();
        }
      });
    }
  }

  test('a field inside a content-locked control refuses, tracked or not', async () => {
    const locked = docx(
      '<w:p><w:r><w:t xml:space="preserve">Before </w:t></w:r><w:sdt><w:sdtPr>' +
        '<w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:r><w:t>locked words</w:t></w:r>' +
        '</w:sdtContent></w:sdt><w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>'
    );
    for (const tracked of [false, true]) {
      const runtime = await DocxEditor.createServer(locked, { author: AUTHOR });
      try {
        const before = await documentXml(runtime);
        await expect(
          runtime.run(async (c) => {
            if (tracked) c.document.changeTrackingMode = 'TrackMineOnly';
            c.document.body.search('words').getFirst().insertField('Before', 'Ref', '_Ref1');
            await c.sync();
          })
        ).rejects.toMatchObject({
          code: 'InvalidArgument',
          debugInfo: { innerError: { code: 'edit.protected-content' } },
        });
        expect(await documentXml(runtime)).toBe(before);
      } finally {
        runtime.dispose();
      }
    }
  });

  test("a tracked field inside another author's pending table row refuses", async () => {
    const row = docx(
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:trPr>' +
        '<w:ins w:id="9" w:author="Other" w:date="2026-01-01T00:00:00Z"/></w:trPr><w:tc><w:tcPr>' +
        '<w:tcW w:w="4000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Cell text</w:t></w:r></w:p></w:tc>' +
        '</w:tr></w:tbl><w:p/>'
    );
    const runtime = await DocxEditor.createServer(row, { author: AUTHOR });
    try {
      const before = await documentXml(runtime);
      await expect(
        runtime.run(async (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          c.document.body.search('Cell').getFirst().insertField('After', 'Ref', '_Ref1');
          await c.sync();
        })
      ).rejects.toMatchObject({
        code: 'NotImplemented',
        debugInfo: { innerError: { code: 'edit.tracked-foreign-revision-unsupported' } },
      });
      expect(await documentXml(runtime)).toBe(before);
    } finally {
      runtime.dispose();
    }
  });

  test('tracked replacement across paragraphs and removeFormatting refuse', async () => {
    const runtime = await DocxEditor.createServer(SAMPLE, { author: AUTHOR });
    try {
      const before = await documentXml(runtime);
      await expect(
        runtime.run(async (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          c.document.body.getRange('Whole').insertField('Replace', 'Ref', '_Ref1');
          await c.sync();
        })
      ).rejects.toMatchObject({
        code: 'InvalidArgument',
        debugInfo: { innerError: { code: 'edit.invalid-argument' } },
      });
      await expect(
        runtime.run(async (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          c.document.body.search('figure').getFirst().insertField('After', 'Ref', '_Ref1', true);
          await c.sync();
        })
      ).rejects.toMatchObject({ code: 'InvalidArgument' });
      expect(await documentXml(runtime)).toBe(before);
    } finally {
      runtime.dispose();
    }
  });

  test('a tracked field refuses updateResult and code writes until it is accepted', async () => {
    const runtime = await DocxEditor.createServer(SAMPLE, { author: AUTHOR });
    try {
      await insertAfterFigure(runtime, 'Page', undefined, true);
      const before = await documentXml(runtime);
      for (const write of ['update', 'code'] as const) {
        await expect(
          runtime.run(async (c) => {
            const field = c.document.body.fields.getFirst();
            if (write === 'update') field.updateResult();
            else field.code = 'NUMPAGES';
            await c.sync();
          })
        ).rejects.toMatchObject({
          debugInfo: {
            errorLocation:
              write === 'update'
                ? 'document.body.fields.getFirst().updateResult'
                : 'document.body.fields.getFirst().code',
          },
        });
      }
      expect(await documentXml(runtime)).toBe(before);
    } finally {
      runtime.dispose();
    }
  });
});
