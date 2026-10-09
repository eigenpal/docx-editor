/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `Paragraph.readingOrder`: a paragraph's base direction, read and written through the object model.
//
// A DocxEditor addition, recorded in `compat/manifest.json` `omissions`. The read answers the
// direction the paragraph reads in after its style cascade. The write states `w:bidi` only where the
// paragraph does not already read the asked way, so writing back what was read changes nothing.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  canonicalOoxmlFingerprint,
  diffSemanticDigests,
  readOoxmlPackage,
  semanticDigest,
} from '@docx-editor.dev/core/store';
import { createBrowser } from '../../runtime/browser.ts';
import { createServer } from '../../runtime/server.ts';
import type { DocxEditorRuntime, DocxEditorServerRuntime } from '../../runtime/runtime.ts';
import type { ParagraphReadingOrder } from '../paragraph.ts';
import { docx } from '../../runtime/__tests__/support/docx.ts';

const RTL_STYLE =
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Rtl"><w:name w:val="Rtl"/><w:pPr><w:bidi/></w:pPr></w:style>';

const para = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const SAMPLE = docx(
  para('שלום עולם') +
    para('Latin text', '<w:jc w:val="center"/>') +
    para('مرحبا', '<w:bidi/>') +
    para('Explicitly left', '<w:bidi w:val="0"/>') +
    para('Styled', '<w:pStyle w:val="Rtl"/>'),
  RTL_STYLE
);

const INITIAL: ParagraphReadingOrder[] = [
  'LeftToRight',
  'LeftToRight',
  'RightToLeft',
  'LeftToRight',
  // The paragraph states nothing; its style makes it right to left.
  'RightToLeft',
];

function mainXml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/document.xml']!);
}

async function readOrders(runtime: DocxEditorRuntime): Promise<ParagraphReadingOrder[]> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    for (const paragraph of paragraphs.items) paragraph.load('readingOrder');
    await context.sync();
    return paragraphs.items.map((paragraph) => paragraph.readingOrder);
  });
}

async function setOrder(
  runtime: DocxEditorRuntime,
  index: number,
  value: ParagraphReadingOrder
): Promise<void> {
  await runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    paragraphs.items[index]!.readingOrder = value;
    await context.sync();
  });
}

async function revisionCount(runtime: DocxEditorRuntime): Promise<number> {
  return runtime.run(async (context) => {
    const revisions = context.document.body.revisions;
    revisions.load('items');
    await context.sync();
    return revisions.items.length;
  });
}

function mount(bytes: Uint8Array = SAMPLE): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: bytes });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

describe('Paragraph.readingOrder reads the direction the paragraph reads in', () => {
  test('answers the paragraph’s own w:bidi, else its style’s', async () => {
    const runtime = await createServer(SAMPLE);
    try {
      expect(await readOrders(runtime)).toEqual(INITIAL);
    } finally {
      runtime.dispose();
    }
  });

  test('resolves the document defaults and a based-on style chain', async () => {
    const styles =
      '<w:docDefaults><w:pPrDefault><w:pPr><w:bidi/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Ltr"><w:name w:val="Ltr"/><w:pPr><w:bidi w:val="0"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Child"><w:name w:val="Child"/><w:basedOn w:val="Ltr"/></w:style>';
    const runtime = await createServer(
      docx(para('Defaults') + para('Based on', '<w:pStyle w:val="Child"/>'), styles)
    );
    try {
      expect(await readOrders(runtime)).toEqual(['RightToLeft', 'LeftToRight']);
    } finally {
      runtime.dispose();
    }
  });

  test('reads the last of several w:bidi elements, as layout does', async () => {
    const runtime = await createServer(
      docx(
        para('Twice', '<w:bidi w:val="0"/><w:bidi/>') +
          para('Again', '<w:bidi/><w:bidi w:val="0"/>')
      )
    );
    try {
      expect(await readOrders(runtime)).toEqual(['RightToLeft', 'LeftToRight']);
      await setOrder(runtime, 0, 'LeftToRight');
      expect(await readOrders(runtime)).toEqual(['LeftToRight', 'LeftToRight']);
    } finally {
      runtime.dispose();
    }
  });

  test('reads the on and off values the layout honours', async () => {
    const values = ['1', 'true', 'on', '0', 'false', 'off', 'none', 'unexpected'];
    const runtime = await createServer(
      docx(values.map((value) => para(value, `<w:bidi w:val="${value}"/>`)).join(''))
    );
    try {
      expect(await readOrders(runtime)).toEqual([
        'RightToLeft',
        'RightToLeft',
        'RightToLeft',
        'LeftToRight',
        'LeftToRight',
        'LeftToRight',
        'LeftToRight',
        'LeftToRight',
      ]);
    } finally {
      runtime.dispose();
    }
  });

  test('is readable only after load and sync, and a write is queued until sync', async () => {
    const runtime = await createServer(SAMPLE);
    try {
      await runtime.run(async (context) => {
        const first = context.document.body.paragraphs.getFirst();
        expect(() => first.readingOrder).toThrow();
        first.load('readingOrder');
        await context.sync();
        expect(first.readingOrder).toBe('LeftToRight');
        first.readingOrder = 'RightToLeft';
        // The proxy keeps the loaded value until the write and a later read complete.
        expect<ParagraphReadingOrder>(first.readingOrder).toBe('LeftToRight');
        await context.sync();
        expect<ParagraphReadingOrder>(first.readingOrder).toBe('LeftToRight');
        first.load('readingOrder');
        await context.sync();
        expect(first.readingOrder).toBe('RightToLeft');
      });
    } finally {
      runtime.dispose();
    }
  });

  test('a bare load reads readingOrder with the other paragraph properties', async () => {
    const runtime = await createServer(SAMPLE);
    try {
      const read = await runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items');
        await context.sync();
        const third = paragraphs.items[2]!;
        third.load();
        await context.sync();
        return { readingOrder: third.readingOrder, text: third.text };
      });
      expect(read).toMatchObject({ readingOrder: 'RightToLeft', text: 'مرحبا' });
    } finally {
      runtime.dispose();
    }
  });
});

describe('Paragraph.readingOrder writes the smallest w:bidi change', () => {
  test('the documented example runs as published', async () => {
    // docs/site/content/editor-api/formatting.mdx, "Right-to-left paragraphs".
    const runtime = await createServer(SAMPLE);
    try {
      const read = await runtime.run(async (context) => {
        const paragraph = context.document.body.paragraphs.getFirst();
        paragraph.readingOrder = 'RightToLeft';
        await context.sync();

        paragraph.load('readingOrder');
        await context.sync();
        return paragraph.readingOrder;
      });
      expect(read).toBe('RightToLeft');
    } finally {
      runtime.dispose();
    }
  });

  test('the agent guide example runs as published', async () => {
    // packages/editor-api/OFFICE_JS_GUIDE.md, "Set paragraph direction".
    const runtime = await createServer(SAMPLE);
    try {
      const read = await runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load({ select: 'items', top: 2 });
        await context.sync();

        const targets = paragraphs.items;
        for (const paragraph of targets) paragraph.readingOrder = 'RightToLeft';
        await context.sync();

        for (const paragraph of targets) paragraph.load('readingOrder');
        await context.sync();
        return targets.map((paragraph) => paragraph.readingOrder);
      });
      expect(read).toEqual(['RightToLeft', 'RightToLeft']);
    } finally {
      runtime.dispose();
    }
  });

  test('a direction the paragraph already reads in writes nothing, even with tracking on', async () => {
    const runtime = await createServer(SAMPLE, { author: 'Agent' });
    try {
      const before = mainXml(await runtime.save());
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        await context.sync();
      });
      for (const [index, value] of INITIAL.entries()) await setOrder(runtime, index, value);
      expect(mainXml(await runtime.save())).toBe(before);
      expect(await revisionCount(runtime)).toBe(0);
    } finally {
      runtime.dispose();
    }
  });

  test('RightToLeft writes w:bidi and keeps the other paragraph properties', async () => {
    const runtime = await createServer(SAMPLE);
    try {
      await setOrder(runtime, 1, 'RightToLeft');
      const xml = mainXml(await runtime.save());
      expect(xml).toContain('<w:pPr><w:bidi/><w:jc w:val="center"/></w:pPr>');
      expect((await readOrders(runtime))[1]).toBe('RightToLeft');
    } finally {
      runtime.dispose();
    }
  });

  test('a write removes the paragraph’s own w:bidi when that alone set the other direction', async () => {
    const runtime = await createServer(SAMPLE);
    try {
      // Own `<w:bidi/>` over the left-to-right default.
      await setOrder(runtime, 2, 'LeftToRight');
      expect(mainXml(await runtime.save())).toMatch(/<w:p [^>]*><w:r><w:t>مرحبا<\/w:t>/);
      expect((await readOrders(runtime))[2]).toBe('LeftToRight');
    } finally {
      runtime.dispose();
    }
    // Own off value over a right-to-left style.
    const styled = await createServer(
      docx(para('Styled', '<w:pStyle w:val="Rtl"/><w:bidi w:val="0"/>'), RTL_STYLE)
    );
    try {
      await setOrder(styled, 0, 'RightToLeft');
      expect(mainXml(await styled.save())).toContain('<w:pPr><w:pStyle w:val="Rtl"/></w:pPr>');
      expect(await readOrders(styled)).toEqual(['RightToLeft']);
    } finally {
      styled.dispose();
    }
  });

  test('LeftToRight writes the explicit off value only over a right-to-left style', async () => {
    const runtime = await createServer(SAMPLE);
    try {
      await setOrder(runtime, 4, 'LeftToRight');
      await setOrder(runtime, 0, 'LeftToRight');
      const xml = mainXml(await runtime.save());
      expect(xml).toContain('<w:pStyle w:val="Rtl"/><w:bidi w:val="0"/>');
      // The off value the file already had, and the one over the style: none on paragraph one.
      expect(xml.match(/<w:bidi w:val="0"\/>/g)).toHaveLength(2);
      expect(await readOrders(runtime)).toEqual([
        'LeftToRight',
        'LeftToRight',
        'RightToLeft',
        'LeftToRight',
        'LeftToRight',
      ]);
    } finally {
      runtime.dispose();
    }
  });

  test('rides the same paragraph-property write as alignment and spacing in one sync', async () => {
    const runtime = await createServer(SAMPLE);
    try {
      await runtime.run(async (context) => {
        const first = context.document.body.paragraphs.getFirst();
        first.readingOrder = 'RightToLeft';
        first.alignment = 'Justified';
        first.spaceAfter = 6;
        await context.sync();
        first.load(['readingOrder', 'alignment', 'spaceAfter']);
        await context.sync();
        expect({
          readingOrder: first.readingOrder,
          alignment: first.alignment,
          spaceAfter: first.spaceAfter,
        }).toEqual({
          readingOrder: 'RightToLeft',
          alignment: 'Justified',
          spaceAfter: 6,
        });
      });
    } finally {
      runtime.dispose();
    }
  });

  test('a write of any other value is refused before anything is sent', async () => {
    const runtime = await createServer(SAMPLE);
    try {
      const before = mainXml(await runtime.save());
      for (const value of ['Unknown', 'rtl', 'Mixed', '', null, 1]) {
        await runtime.run(async (context) => {
          const first = context.document.body.paragraphs.getFirst();
          expect(() => {
            first.readingOrder = value as ParagraphReadingOrder;
          }).toThrow(expect.objectContaining({ code: 'InvalidArgument' }) as unknown as Error);
          await context.sync();
        });
      }
      expect(mainXml(await runtime.save())).toBe(before);
    } finally {
      runtime.dispose();
    }
  });

  test('survives save and reopen under both fidelity oracles', async () => {
    const runtime = await createServer(SAMPLE);
    try {
      await setOrder(runtime, 0, 'RightToLeft');
      await setOrder(runtime, 4, 'LeftToRight');
      const once = await runtime.save();
      const reopened = await createServer(once);
      try {
        expect(await readOrders(reopened)).toEqual([
          'RightToLeft',
          'LeftToRight',
          'RightToLeft',
          'LeftToRight',
          'LeftToRight',
        ]);
        const again = await reopened.save();
        const first = readOoxmlPackage(once);
        const second = readOoxmlPackage(again);
        if (!first.ok || !second.ok) throw new Error('saved bytes did not reopen');
        const main = (opened: typeof first & { ok: true }) =>
          opened.package.parts.get(opened.package.mainDocumentPart)!;
        expect(canonicalOoxmlFingerprint(main(second))).toBe(
          canonicalOoxmlFingerprint(main(first))
        );
        expect(
          diffSemanticDigests(
            semanticDigest(first.package.parts.values()),
            semanticDigest(second.package.parts.values())
          )
        ).toEqual([]);
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
});

/** Add a numbering part whose level 0 states `w:bidi` in its own `w:pPr`. */
function withRtlNumbering(bytes: Uint8Array): Uint8Array {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const files = unzipSync(bytes);
  files['word/numbering.xml'] = strToU8(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
      '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
      '<w:pPr><w:bidi/></w:pPr></w:lvl></w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
  );
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace(
      '</Types>',
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'
    )
  );
  files['word/_rels/document.xml.rels'] = strToU8(
    strFromU8(files['word/_rels/document.xml.rels']!).replace(
      '</Relationships>',
      '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>'
    )
  );
  return zipSync(files);
}

describe('Paragraph.readingOrder follows what layout paints', () => {
  const NUM = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';

  test('a numbering level that states w:bidi makes its paragraphs right to left', async () => {
    const runtime = await createServer(
      withRtlNumbering(docx(para('Item', NUM) + para('Own', `${NUM}<w:bidi/>`), RTL_STYLE))
    );
    try {
      expect(await readOrders(runtime)).toEqual(['RightToLeft', 'RightToLeft']);
      // Over a right-to-left level, left to right needs the explicit off value on both.
      await setOrder(runtime, 0, 'LeftToRight');
      await setOrder(runtime, 1, 'LeftToRight');
      expect(mainXml(await runtime.save()).match(/<w:bidi w:val="0"\/>/g)).toHaveLength(2);
      expect(await readOrders(runtime)).toEqual(['LeftToRight', 'LeftToRight']);
    } finally {
      runtime.dispose();
    }
  });

  test('a style and a direction written in one sync resolve against the new style', async () => {
    const runtime = await createServer(
      docx(para('Plain') + para('Styled', '<w:pStyle w:val="Rtl"/>'), RTL_STYLE)
    );
    try {
      await runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items');
        await context.sync();
        paragraphs.items[0]!.style = 'Rtl';
        paragraphs.items[0]!.readingOrder = 'LeftToRight';
        paragraphs.items[1]!.style = 'Normal';
        paragraphs.items[1]!.readingOrder = 'RightToLeft';
        await context.sync();
      });
      expect(await readOrders(runtime)).toEqual(['LeftToRight', 'RightToLeft']);
      const xml = mainXml(await runtime.save());
      expect(xml).toContain('<w:pPr><w:pStyle w:val="Rtl"/><w:bidi w:val="0"/></w:pPr>');
      expect(xml).toContain('<w:pPr><w:pStyle w:val="Normal"/><w:bidi/></w:pPr>');
    } finally {
      runtime.dispose();
    }
  });

  test('the read agrees with the editor’s painted direction', async () => {
    const bytes = withRtlNumbering(
      docx(
        para('Item', NUM) +
          para('Styled', '<w:pStyle w:val="Rtl"/>') +
          para('Plain') +
          para('Own', '<w:bidi/>'),
        RTL_STYLE
      )
    );
    const editor = mount(bytes);
    const runtime = createBrowser(editor);
    try {
      const ids = editor.surface!.session.paragraphIds();
      const painted = ids.map((id) => {
        editor.surface!.setSelection({
          anchor: { paragraphId: id, offset: 1 },
          head: { paragraphId: id, offset: 1 },
        });
        return editor.snapshot().formatting?.direction === 'rtl' ? 'RightToLeft' : 'LeftToRight';
      });
      expect(painted).toEqual(['RightToLeft', 'RightToLeft', 'LeftToRight', 'RightToLeft']);
      expect(await readOrders(runtime)).toEqual(painted);
    } finally {
      runtime.dispose();
      editor.destroy();
    }
  });
});

describe('Paragraph.readingOrder with change tracking on', () => {
  async function tracked(): Promise<DocxEditorServerRuntime> {
    const runtime = await createServer(SAMPLE, { author: 'Agent' });
    await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      await context.sync();
    });
    await setOrder(runtime, 0, 'RightToLeft');
    await setOrder(runtime, 2, 'LeftToRight');
    return runtime;
  }

  test('records a paragraph formatting revision rather than changing the paragraph silently', async () => {
    const runtime = await tracked();
    try {
      const xml = mainXml(await runtime.save());
      expect(xml.match(/<w:pPrChange\b/g)).toHaveLength(2);
      expect(xml).toMatch(/<w:pPr><w:bidi\/><w:pPrChange [^>]*w:author="Agent"[^>]*><w:pPr\/>/);
      // Own `<w:bidi/>` over the left-to-right default: the write removes it.
      expect(xml).toMatch(/<w:pPr><w:pPrChange [^>]*><w:pPr><w:bidi\/><\/w:pPr><\/w:pPrChange>/);
      const kinds = await runtime.run(async (context) => {
        const revisions = context.document.body.revisions;
        revisions.load('items');
        await context.sync();
        for (const revision of revisions.items) revision.load('type');
        await context.sync();
        return revisions.items.map((revision) => revision.type);
      });
      expect(kinds).toEqual(['Property', 'Property']);
    } finally {
      runtime.dispose();
    }
  });

  test('reject restores the previous direction and accept keeps the new one, after reopen', async () => {
    const runtime = await tracked();
    try {
      const rejected = await createServer(await runtime.save(), { author: 'Reviewer' });
      try {
        await rejected.run(async (context) => {
          context.document.body.revisions.rejectAll();
          await context.sync();
        });
        expect(await readOrders(rejected)).toEqual(INITIAL);
        expect(mainXml(await rejected.save())).not.toContain('pPrChange');
      } finally {
        rejected.dispose();
      }
      await runtime.run(async (context) => {
        context.document.body.revisions.acceptAll();
        await context.sync();
      });
      expect(await readOrders(runtime)).toEqual([
        'RightToLeft',
        'LeftToRight',
        'LeftToRight',
        'LeftToRight',
        'RightToLeft',
      ]);
      expect(mainXml(await runtime.save())).not.toContain('pPrChange');
    } finally {
      runtime.dispose();
    }
  });
});

describe('Paragraph.readingOrder in an open editor', () => {
  test('the painted paragraph takes the direction, and one Undo restores it', async () => {
    const editor = mount();
    const runtime = createBrowser(editor);
    try {
      const ids = editor.surface!.session.paragraphIds();
      const caretIn = (index: number) =>
        editor.surface!.setSelection({
          anchor: { paragraphId: ids[index]!, offset: 1 },
          head: { paragraphId: ids[index]!, offset: 1 },
        });
      caretIn(0);
      expect(editor.snapshot().formatting?.direction).toBe('ltr');

      let changes = 0;
      const off = editor.on('change', () => {
        changes += 1;
      });
      await setOrder(runtime, 0, 'RightToLeft');
      expect(changes).toBe(1);
      // A value the paragraph already has is no edit and no undo step, for any paragraph property.
      await setOrder(runtime, 2, 'RightToLeft');
      await runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items');
        await context.sync();
        paragraphs.items[1]!.alignment = 'Centered';
        await context.sync();
      });
      off();
      expect(changes).toBe(1);
      caretIn(0);
      expect(editor.snapshot().formatting?.direction).toBe('rtl');
      // The style's right-to-left direction stops at an explicit left-to-right paragraph.
      caretIn(4);
      expect(editor.snapshot().formatting?.direction).toBe('rtl');
      await setOrder(runtime, 4, 'LeftToRight');
      caretIn(4);
      expect(editor.snapshot().formatting?.direction).toBe('ltr');

      expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
      expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
      caretIn(0);
      expect(editor.snapshot().formatting?.direction).toBe('ltr');
      expect(await readOrders(runtime)).toEqual(INITIAL);
      expect(editor.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
      expect((await readOrders(runtime))[0]).toBe('RightToLeft');
    } finally {
      runtime.dispose();
      editor.destroy();
    }
  });

  test('the same script answers the same on the server and in the editor', async () => {
    const editor = mount();
    const browser = createBrowser(editor);
    const server = await createServer(SAMPLE);
    try {
      for (const runtime of [server, browser]) {
        await setOrder(runtime, 1, 'RightToLeft');
        await setOrder(runtime, 2, 'LeftToRight');
        await setOrder(runtime, 4, 'LeftToRight');
      }
      expect(await readOrders(browser)).toEqual(await readOrders(server));
    } finally {
      browser.dispose();
      server.dispose();
      editor.destroy();
    }
  });
});
