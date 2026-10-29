/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `Paragraph.split` and `Range.insertBreak` with `TrackMineOnly`: each new paragraph mark, page
// break, and section break is a tracked insertion that accept keeps and reject removes.
import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor, type DocxEditorServerRuntime, type RequestContext } from '../../index.ts';
import { docx, p } from './support/docx.ts';

const open = (bytes: Uint8Array) => DocxEditor.createServer(bytes, { author: 'Agent' });

async function bodyXml(r: DocxEditorServerRuntime): Promise<string> {
  const xml = strFromU8(unzipSync(await r.save())['word/document.xml']!);
  return xml.slice(xml.indexOf('<w:body>'), xml.indexOf('</w:body>'));
}

async function texts(r: DocxEditorServerRuntime): Promise<string[]> {
  return r.run(async (c) => {
    const paragraphs = c.document.body.paragraphs;
    paragraphs.load('items/text');
    await c.sync();
    return paragraphs.items.map((paragraph) => paragraph.text);
  });
}

async function sectionCount(r: DocxEditorServerRuntime): Promise<number> {
  return r.run(async (c) => {
    const sections = c.document.sections;
    sections.load('items');
    await c.sync();
    return sections.items.length;
  });
}

async function revisionCount(r: DocxEditorServerRuntime): Promise<number> {
  return r.run(async (c) => {
    const revisions = c.document.body.revisions;
    revisions.load('items');
    await c.sync();
    return revisions.items.length;
  });
}

async function reopen(r: DocxEditorServerRuntime) {
  return open(await r.save());
}

async function decideAll(r: DocxEditorServerRuntime, decision: 'accept' | 'reject') {
  await r.run(async (c) => {
    if (decision === 'accept') c.document.body.revisions.acceptAll();
    else c.document.body.revisions.rejectAll();
    await c.sync();
  });
}

async function tracked(r: DocxEditorServerRuntime, edit: (c: RequestContext) => Promise<void>) {
  await r.run(async (c) => {
    c.document.changeTrackingMode = 'TrackMineOnly';
    await c.sync();
    await edit(c);
    await c.sync();
  });
}

async function firstMatch(c: RequestContext, quote: string) {
  const range = c.document.body.search(quote).getFirst();
  await c.sync();
  return range;
}

/** The inserted-mark property, `w:pPr/w:rPr/w:ins`, by this runtime's author. */
const INSERTED_MARK = /<w:pPr><w:rPr><w:ins\b[^>]*w:author="Agent"[^>]*\/><\/w:rPr>/;

describe('Paragraph.split with TrackMineOnly', () => {
  test('proposes each new paragraph mark; reject joins, accept keeps', async () => {
    const r = await open(docx(p('One; two; three') + p('Tail')));
    try {
      await tracked(r, async (c) => {
        const paragraph = c.document.body.paragraphs.getFirst();
        await c.sync();
        paragraph.split(['; ']);
      });
      expect(await texts(r)).toEqual(['One; ', 'two; ', 'three', 'Tail']);
      const xml = await bodyXml(r);
      expect(xml.match(new RegExp(INSERTED_MARK.source, 'g'))).toHaveLength(2);
      expect(xml).not.toContain('<w:del ');

      const rejected = await reopen(r);
      expect(await revisionCount(rejected)).toBeGreaterThan(0);
      await decideAll(rejected, 'reject');
      expect(await texts(rejected)).toEqual(['One; two; three', 'Tail']);
      expect(await bodyXml(rejected)).not.toContain('<w:ins');

      const accepted = await reopen(r);
      await decideAll(accepted, 'accept');
      expect(await texts(accepted)).toEqual(['One; ', 'two; ', 'three', 'Tail']);
      expect(await bodyXml(accepted)).not.toContain('<w:ins');
      expect(await texts(await reopen(accepted))).toEqual(['One; ', 'two; ', 'three', 'Tail']);
      rejected.dispose();
      accepted.dispose();
    } finally {
      r.dispose();
    }
  });

  test('the pieces it answers load in the next sync', async () => {
    const r = await open(docx(p('Alpha. Beta.')));
    try {
      const pieces = await r.run(async (c) => {
        c.document.changeTrackingMode = 'TrackMineOnly';
        const paragraph = c.document.body.paragraphs.getFirst();
        await c.sync();
        const split = paragraph.split(['. '], false, true);
        await c.sync();
        split.load('items/text');
        await c.sync();
        return split.items.map((piece) => piece.text);
      });
      expect(pieces).toEqual(['Alpha.', 'Beta.']);
    } finally {
      r.dispose();
    }
  });

  test('removing delimiters refuses and applies nothing', async () => {
    const r = await open(docx(p('One; two')));
    try {
      const before = await bodyXml(r);
      await expect(
        tracked(r, async (c) => {
          const paragraph = c.document.body.paragraphs.getFirst();
          await c.sync();
          paragraph.split(['; '], true);
        })
      ).rejects.toMatchObject({
        code: 'NotSupported',
        debugInfo: { innerError: { code: 'edit.tracked-operation-unsupported' } },
      });
      expect(await bodyXml(r)).toBe(before);
    } finally {
      r.dispose();
    }
  });
});

describe('Range.insertBreak with TrackMineOnly', () => {
  test('a page break is an inserted run that reject removes and accept keeps', async () => {
    const r = await open(docx(p('Before TARGET After') + p('Untouched')));
    try {
      await tracked(r, async (c) => {
        (await firstMatch(c, 'TARGET')).insertBreak('Page', 'After');
      });
      expect(await bodyXml(r)).toMatch(
        /<w:ins\b[^>]*w:author="Agent"[^>]*><w:r><w:br w:type="page"\/><\/w:r><\/w:ins>/
      );
      expect(await revisionCount(r)).toBe(1);

      const rejected = await reopen(r);
      await decideAll(rejected, 'reject');
      expect(await bodyXml(rejected)).not.toContain('w:type="page"');
      expect(await texts(rejected)).toEqual(['Before TARGET After', 'Untouched']);

      const accepted = await reopen(r);
      await decideAll(accepted, 'accept');
      const xml = await bodyXml(accepted);
      expect(xml).toContain('<w:br w:type="page"/>');
      expect(xml).not.toContain('<w:ins');
      rejected.dispose();
      accepted.dispose();
    } finally {
      r.dispose();
    }
  });

  test('a next-page section break proposes its mark with the new section', async () => {
    const r = await open(docx(p('BeforeAfter') + p('Tail')));
    try {
      await tracked(r, async (c) => {
        (await firstMatch(c, 'Before')).insertBreak('SectionNext', 'After');
      });
      expect(await texts(r)).toEqual(['Before', 'After', 'Tail']);
      expect(await sectionCount(r)).toBe(2);
      expect(await bodyXml(r)).toMatch(
        /<w:pPr><w:rPr><w:ins\b[^>]*w:author="Agent"[^>]*\/><\/w:rPr><w:sectPr>/
      );

      const rejected = await reopen(r);
      await decideAll(rejected, 'reject');
      expect(await texts(rejected)).toEqual(['BeforeAfter', 'Tail']);
      expect(await sectionCount(rejected)).toBe(1);
      const rejectedXml = await bodyXml(rejected);
      expect(rejectedXml).not.toContain('<w:ins');
      expect(rejectedXml).not.toContain('<w:pPr><w:sectPr>');

      const accepted = await reopen(r);
      await decideAll(accepted, 'accept');
      expect(await texts(accepted)).toEqual(['Before', 'After', 'Tail']);
      expect(await sectionCount(accepted)).toBe(2);
      expect(await bodyXml(accepted)).not.toContain('<w:ins');
      rejected.dispose();
      accepted.dispose();
    } finally {
      r.dispose();
    }
  });

  test('a next-page section break refuses where it would change the next section type', async () => {
    const continuous =
      p('BeforeAfter') +
      '<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';
    const r = await open(docx(continuous));
    try {
      const before = await bodyXml(r);
      await expect(
        tracked(r, async (c) => {
          (await firstMatch(c, 'Before')).insertBreak('SectionNext', 'After');
        })
      ).rejects.toMatchObject({
        code: 'NotSupported',
        debugInfo: { innerError: { code: 'edit.tracked-operation-unsupported' } },
      });
      expect(await bodyXml(r)).toBe(before);
    } finally {
      r.dispose();
    }
  });

  test('other break types still refuse with tracking on, and apply nothing', async () => {
    const r = await open(docx(p('Before After')));
    try {
      const before = await bodyXml(r);
      await expect(
        tracked(r, async (c) => {
          (await firstMatch(c, 'Before')).insertBreak('SectionContinuous', 'After');
        })
      ).rejects.toMatchObject({ code: 'InvalidArgument' });
      expect(await bodyXml(r)).toBe(before);
    } finally {
      r.dispose();
    }
  });
});
