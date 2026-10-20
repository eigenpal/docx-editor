/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The behavior the structural-edit guides promise, example by example: a minimal tracked
// split, inserting next to existing words, several structural edits in one sync, taking back
// your own pending field, and Paragraph.split.
import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor, type DocxEditorServerRuntime, type RequestContext } from '../../index.ts';
import { RequestContext as BrowserRequestContext } from '../../browser.ts';
import { prepareRewrite } from '../../agent.ts';
import { docx, p } from './support/docx.ts';
import { equationPackage } from './support/flat-opc.ts';

const AUTHOR = 'Agent';
const CLAUSES = p('The supplier delivers the goods. The buyer pays on receipt.') + p('Signed');

async function documentXml(runtime: DocxEditorServerRuntime): Promise<string> {
  return strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
}

async function texts(c: RequestContext): Promise<string[]> {
  const paragraphs = c.document.body.paragraphs;
  paragraphs.load('items/text');
  await c.sync();
  return paragraphs.items.map((paragraph) => paragraph.text);
}

describe('a minimal tracked split', () => {
  test('replacing only the gap strikes the space and proposes one paragraph mark', async () => {
    for (const decision of ['accept', 'reject'] as const) {
      const runtime = await DocxEditor.createServer(docx(CLAUSES), { author: AUTHOR });
      try {
        await runtime.run(async (context) => {
          context.document.changeTrackingMode = 'TrackMineOnly';
          const first = context.document.body.search('the goods.').getFirst();
          const second = context.document.body.search('The buyer').getFirst();
          const gap = first.getRange('End').expandTo(second.getRange('Start'));
          gap.insertText('\n', 'Replace');
          await context.sync();
        });
        const xml = await documentXml(runtime);
        expect(xml.match(/<w:delText[^>]*>([^<]*)<\/w:delText>/g)).toEqual([
          '<w:delText xml:space="preserve"> </w:delText>',
        ]);
        expect(xml.match(/<w:ins /g)).toHaveLength(1);
        expect(xml).toMatch(/<w:pPr><w:rPr><w:ins [^>]*\/><\/w:rPr><\/w:pPr>/);
        await runtime.run(async (c) => {
          if (decision === 'accept') c.document.body.revisions.acceptAll();
          else c.document.body.revisions.rejectAll();
          await c.sync();
          expect(await texts(c)).toEqual(
            decision === 'accept'
              ? ['The supplier delivers the goods.', 'The buyer pays on receipt.', 'Signed']
              : ['The supplier delivers the goods. The buyer pays on receipt.', 'Signed']
          );
        });
      } finally {
        runtime.dispose();
      }
    }
  });
});

describe('inserting next to existing words', () => {
  test('search matches a trailing space, and getTextRanges takes a two-character mark', async () => {
    const runtime = await DocxEditor.createServer(docx(p('Pay 4.2 units. Then stop.')));
    try {
      await runtime.run(async (c) => {
        const hits = c.document.body.search('units. ');
        hits.load('items/text');
        const sentences = c.document.body.paragraphs.getFirst().getTextRanges(['. ']);
        sentences.load('items/text');
        const dots = c.document.body.paragraphs.getFirst().getTextRanges(['.']);
        dots.load('items/text');
        await c.sync();
        expect(hits.items.map((hit) => hit.text)).toEqual(['units. ']);
        expect(sentences.items.map((range) => range.text)).toEqual([
          'Pay 4.2 units. ',
          'Then stop.',
        ]);
        expect(dots.items.map((range) => range.text)).toEqual([
          'Pay 4.',
          '2 units.',
          ' Then stop.',
        ]);
      });
    } finally {
      runtime.dispose();
    }
  });

  test('a field after your own pending space joins it; an equation after your own pending text joins that', async () => {
    const runtime = await DocxEditor.createServer(docx(p('see Section')), { author: AUTHOR });
    try {
      await runtime.run(async (c) => {
        c.document.changeTrackingMode = 'TrackMineOnly';
        const space = c.document.body.search('Section').getFirst().insertText(' ', 'After');
        await c.sync();
        space.insertField('After', 'Ref', '_Ref1');
        await c.sync();
        const words = c.document.body.paragraphs
          .getFirst()
          .getRange('End')
          .insertText(' where ', 'After');
        await c.sync();
        words.insertOoxml(equationPackage(), 'After');
        await c.sync();
      });
      const xml = await documentXml(runtime);
      // The field joins the insertion that holds the space. Text after a field that ends the
      // paragraph starts a second insertion by the same author, after the field's end marker.
      expect(xml.match(/<w:ins /g)).toHaveLength(2);
      expect(xml.match(/<w:ins [^>]*w:author="Agent"/g)).toHaveLength(2);
      expect(xml).toMatch(
        /<w:ins [^>]*><w:r><w:t xml:space="preserve"> <\/w:t><\/w:r><w:r><w:fldChar/
      );
      expect(xml).toContain('<m:oMath>');
      await runtime.run(async (c) => {
        c.document.body.revisions.rejectAll();
        await c.sync();
        expect(await texts(c)).toEqual(['see Section']);
      });
    } finally {
      runtime.dispose();
    }
  });

  test('a range a write returned addresses nothing until the write syncs', async () => {
    const runtime = await DocxEditor.createServer(docx(p('see')), { author: AUTHOR });
    try {
      await expect(
        runtime.run(async (c) => {
          const words = c.document.body.search('see').getFirst().insertText(' also', 'After');
          words.insertOoxml(equationPackage(), 'After');
          await c.sync();
        })
      ).rejects.toMatchObject({ code: 'InvalidObjectPath' });
    } finally {
      runtime.dispose();
    }
  });
});

describe('several structural edits in one sync', () => {
  const THREE = docx(p('One. Two.') + p('Field here') + p('Math here'));

  test('a split, a field, and an equation in three paragraphs share one sync', async () => {
    const runtime = await DocxEditor.createServer(THREE, { author: AUTHOR });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const body = context.document.body;
        const one = body.search('One.').getFirst();
        const two = body.search('Two.').getFirst();
        one.getRange('End').expandTo(two.getRange('Start')).insertText('\n', 'Replace');
        body.search('Field').getFirst().insertField('After', 'Seq', 'Figure');
        body.search('Math').getFirst().insertOoxml(equationPackage(), 'After');
        await context.sync();
        expect(await texts(context)).toEqual(['One. ', 'Two.', 'Field here', 'Math￼ here']);
        body.revisions.rejectAll();
        await context.sync();
        expect(await texts(context)).toEqual(['One. Two.', 'Field here', 'Math here']);
      });
    } finally {
      runtime.dispose();
    }
  });

  test('two structural edits in one paragraph refuse together, and errorLocation names the second call', async () => {
    for (const tracked of [false, true]) {
      const runtime = await DocxEditor.createServer(THREE, { author: AUTHOR });
      try {
        const before = await documentXml(runtime);
        await expect(
          runtime.run(async (context) => {
            if (tracked) context.document.changeTrackingMode = 'TrackMineOnly';
            const body = context.document.body;
            body.search('Field').getFirst().insertField('After', 'Seq', 'Figure');
            body.search('here').getFirst().insertOoxml(equationPackage(), 'After');
            await context.sync();
          })
        ).rejects.toMatchObject({
          code: 'ConflictingChanges',
          debugInfo: { errorLocation: 'document.body.search.getFirst().insertOoxml' },
        });
        expect(await documentXml(runtime)).toBe(before);
      } finally {
        runtime.dispose();
      }
    }
  });
});

describe('taking back your own pending field', () => {
  test('delete() removes your pending field outright under TrackMineOnly', async () => {
    const runtime = await DocxEditor.createServer(docx(p('see')), { author: AUTHOR });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const field = context.document.body
          .search('see')
          .getFirst()
          .insertField('After', 'Ref', '_Ref1');
        await context.sync();
        field.delete();
        await context.sync();
        const fields = context.document.body.fields;
        fields.load('items');
        await context.sync();
        expect(fields.items).toHaveLength(0);
      });
      const xml = await documentXml(runtime);
      expect(xml).not.toMatch(/<w:(ins|del)[ >]/);
      expect(xml).not.toContain('fldChar');
    } finally {
      runtime.dispose();
    }
  });

  test('delete() of a field that is not your pending insertion refuses under TrackMineOnly', async () => {
    const runtime = await DocxEditor.createServer(docx(p('see')), { author: AUTHOR });
    try {
      await runtime.run(async (context) => {
        context.document.body.search('see').getFirst().insertField('After', 'Ref', '_Ref1');
        await context.sync();
      });
      const before = await documentXml(runtime);
      await expect(
        runtime.run(async (context) => {
          context.document.changeTrackingMode = 'TrackMineOnly';
          context.document.body.fields.getFirst().delete();
          await context.sync();
        })
      ).rejects.toMatchObject({
        code: 'NotSupported',
        debugInfo: {
          errorLocation: 'document.body.fields.getFirst().delete',
          innerError: { code: 'edit.tracked-operation-unsupported' },
        },
      });
      expect(await documentXml(runtime)).toBe(before);
    } finally {
      runtime.dispose();
    }
  });
});

describe('Paragraph.split and the rewrite helper inputs', () => {
  test('Paragraph.split changes the document and refuses under TrackMineOnly', async () => {
    const runtime = await DocxEditor.createServer(docx(CLAUSES), { author: AUTHOR });
    try {
      await runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items');
        await context.sync();
        const pieces = paragraphs.items[0]!.split(['. ']);
        await context.sync();
        pieces.load('items/text');
        await context.sync();
        expect(pieces.items.map((piece) => piece.text)).toEqual([
          'The supplier delivers the goods. ',
          'The buyer pays on receipt.',
        ]);
        expect(await texts(context)).toHaveLength(3);
      });
      await expect(
        runtime.run(async (context) => {
          context.document.changeTrackingMode = 'TrackMineOnly';
          const paragraphs = context.document.body.paragraphs;
          paragraphs.load('items');
          await context.sync();
          paragraphs.items[0]!.split([' ']);
          await context.sync();
        })
      ).rejects.toMatchObject({
        code: 'NotSupported',
        debugInfo: { innerError: { code: 'edit.tracked-operation-unsupported' } },
      });
    } finally {
      runtime.dispose();
    }
  });

  test('prepareRewrite takes the paragraph of an unsynced search hit, and one RequestContext class', async () => {
    expect(BrowserRequestContext).toBe((await import('../../index.ts')).RequestContext);
    const runtime = await DocxEditor.createServer(docx(CLAUSES), { author: AUTHOR });
    try {
      await runtime.run(async (context) => {
        const paragraph = context.document.body.search('receipt').getFirst().paragraphs.getFirst();
        const draft = await prepareRewrite(context, paragraph);
        expect(draft.text).toBe('The supplier delivers the goods. The buyer pays on receipt.');
      });
    } finally {
      runtime.dispose();
    }
  });
});

// A browser runtime's context is the same class, so the helper's types accept it.
type _BrowserContextAccepted = Parameters<typeof prepareRewrite>[0] extends BrowserRequestContext
  ? BrowserRequestContext extends Parameters<typeof prepareRewrite>[0]
    ? true
    : never
  : never;
const _accepted: _BrowserContextAccepted = true;
void _accepted;

describe('how a tracked split lists in revisions', () => {
  test('the inserted paragraph mark is an Insert, and the replaced gap a Delete', async () => {
    const runtime = await DocxEditor.createServer(docx(CLAUSES), { author: AUTHOR });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const first = context.document.body.search('the goods.').getFirst();
        const second = context.document.body.search('The buyer').getFirst();
        first.getRange('End').expandTo(second.getRange('Start')).insertText('\n', 'Replace');
        await context.sync();
        const revisions = context.document.body.revisions;
        revisions.load('items/type');
        await context.sync();
        expect(revisions.items.map((revision) => revision.type).sort()).toEqual([
          'Delete',
          'Insert',
        ]);
        // Accepting only the mark splits the paragraph and keeps the struck space pending.
        revisions.items.find((revision) => revision.type === 'Insert')!.accept();
        await context.sync();
        expect(await texts(context)).toEqual([
          'The supplier delivers the goods. ',
          'The buyer pays on receipt.',
          'Signed',
        ]);
        const left = context.document.body.revisions;
        left.load('items/type');
        await context.sync();
        expect(left.items.map((revision) => revision.type)).toEqual(['Delete']);
      });
    } finally {
      runtime.dispose();
    }
  });

  test('text with a line feed lists as insertions; rejecting the mark joins the paragraphs', async () => {
    const runtime = await DocxEditor.createServer(docx(p('Hello world')), { author: AUTHOR });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        context.document.body.search('world').getFirst().insertText('x\ny', 'Before');
        await context.sync();
        const revisions = context.document.body.revisions;
        revisions.load('items/type');
        await context.sync();
        expect(new Set(revisions.items.map((revision) => revision.type))).toEqual(
          new Set(['Insert'])
        );
        revisions.rejectAll();
        await context.sync();
        expect(await texts(context)).toEqual(['Hello world']);
      });
    } finally {
      runtime.dispose();
    }
  });
});

describe('finding a sentence gap without a read sync', () => {
  test('the trimmed and untrimmed first sentence give the gap, in one sync', async () => {
    const runtime = await DocxEditor.createServer(docx(CLAUSES), { author: AUTHOR });
    let syncs = 0;
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const paragraph = context.document.body.paragraphs.getFirst();
        const words = paragraph.getTextRanges(['. '], true).getFirst();
        const sentence = paragraph.getTextRanges(['. ']).getFirst();
        words.getRange('End').expandTo(sentence.getRange('End')).insertText('\n', 'Replace');
        await context.sync();
        syncs += 1;
      });
      expect(syncs).toBe(1);
      const xml = await documentXml(runtime);
      expect(xml.match(/<w:delText[^>]*>([^<]*)<\/w:delText>/g)).toEqual([
        '<w:delText xml:space="preserve"> </w:delText>',
      ]);
      await runtime.run(async (context) => {
        context.document.body.revisions.acceptAll();
        await context.sync();
        expect(await texts(context)).toEqual([
          'The supplier delivers the goods.',
          'The buyer pays on receipt.',
          'Signed',
        ]);
      });
    } finally {
      runtime.dispose();
    }
  });
});

describe('the E = mc² example in the equation guide', () => {
  test('inserts the equation and its trailing plain run with its space', async () => {
    const runtime = await DocxEditor.createServer(
      docx(p('Einstein gave the relation for energy.')),
      {
        author: AUTHOR,
      }
    );
    try {
      const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
      const PKG = 'http://schemas.microsoft.com/office/2006/xmlPackage';
      const TYPE =
        'application/vnd.openxmlformats-officedocument.' + 'wordprocessingml.document.main+xml';
      const equation =
        '<m:oMath><m:r><m:t>E=m</m:t></m:r><m:sSup><m:e><m:r><m:t>c</m:t></m:r>' +
        '</m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>';
      const after = '<w:r><w:t xml:space="preserve"> holds.</w:t></w:r>';
      const ooxml =
        `<pkg:package xmlns:pkg="${PKG}">` +
        `<pkg:part pkg:name="/word/document.xml" pkg:contentType="${TYPE}">` +
        `<pkg:xmlData><w:document xmlns:w="${W}" xmlns:m="${M}">` +
        `<w:body><w:p>${equation}${after}</w:p></w:body></w:document>` +
        '</pkg:xmlData></pkg:part></pkg:package>';

      await runtime.run(async (context) => {
        const hit = context.document.body.search('the relation ').getFirst();
        const inserted = hit.insertOoxml(ooxml, 'After');
        await context.sync();
        inserted.load('text');
        await context.sync();
        expect(inserted.text).toBe('\uFFFC holds.');
      });
      const xml = await documentXml(runtime);
      expect(xml).toContain('<w:t xml:space="preserve"> holds.</w:t>');
      expect(xml).toContain('<m:sSup>');
    } finally {
      runtime.dispose();
    }
  });
});

describe('the page field sample in the fields guide', () => {
  test('inserts at a read-derived range in the first sync and updates in the second', async () => {
    const { createFixedMeasurer } = await import('../../../../core/src/layout/semantic-layout.ts');
    const runtime = await DocxEditor.createServer(docx(p('Pages: ')), {
      pagination: { measurer: createFixedMeasurer(6, 14) },
    });
    try {
      await runtime.run(async (context) => {
        const anchor = context.document.paragraphs.getLast().getRange('End');
        const field = anchor.insertField('After', 'NumPages');
        await context.sync();
        field.updateResult();
        await context.sync();
        expect(await texts(context)).toEqual(['Pages: 1']);
      });
    } finally {
      runtime.dispose();
    }
  });
});
