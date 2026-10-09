/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `Paragraph.readingOrder`: a paragraph's base direction, read and written through the object model.
//
// A DocxEditor addition, recorded in `compat/manifest.json` `additions`. The write states `w:bidi`
// on the paragraph itself; the read answers only what the paragraph states, so a paragraph that
// leaves its direction to its style reads `Unknown`.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
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

function mount(bytes: Uint8Array = SAMPLE): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: bytes });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

describe('Paragraph.readingOrder reads what the paragraph states', () => {
  test('answers RightToLeft, LeftToRight, or Unknown when the paragraph states nothing', async () => {
    const runtime = await createServer(SAMPLE);
    try {
      expect(await readOrders(runtime)).toEqual([
        'Unknown',
        'Unknown',
        'RightToLeft',
        'LeftToRight',
        // The style makes this paragraph right-to-left, but the paragraph states nothing itself.
        'Unknown',
      ]);
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
        expect(first.readingOrder).toBe('Unknown');
        first.readingOrder = 'RightToLeft';
        // The proxy keeps the loaded value until the write and a later read complete.
        expect<ParagraphReadingOrder>(first.readingOrder).toBe('Unknown');
        await context.sync();
        expect<ParagraphReadingOrder>(first.readingOrder).toBe('Unknown');
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

describe('Paragraph.readingOrder writes w:bidi on the paragraph', () => {
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

  test('LeftToRight writes the explicit off value, which wins over a right-to-left style', async () => {
    const runtime = await createServer(SAMPLE);
    try {
      await setOrder(runtime, 4, 'LeftToRight');
      await setOrder(runtime, 2, 'LeftToRight');
      const xml = mainXml(await runtime.save());
      expect(xml).toContain('<w:pStyle w:val="Rtl"/><w:bidi w:val="0"/>');
      expect(xml).not.toContain('<w:bidi/>');
      expect(await readOrders(runtime)).toEqual([
        'Unknown',
        'Unknown',
        'LeftToRight',
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

  test('a write of Unknown or an invalid value is refused before anything is sent', async () => {
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
          'Unknown',
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
      expect(xml).toMatch(
        /<w:pPr><w:bidi w:val="0"\/><w:pPrChange [^>]*><w:pPr><w:bidi\/><\/w:pPr><\/w:pPrChange>/
      );
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
        expect(await readOrders(rejected)).toEqual([
          'Unknown',
          'Unknown',
          'RightToLeft',
          'LeftToRight',
          'Unknown',
        ]);
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
        'Unknown',
        'LeftToRight',
        'LeftToRight',
        'Unknown',
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
      expect(await readOrders(runtime)).toEqual([
        'Unknown',
        'Unknown',
        'RightToLeft',
        'LeftToRight',
        'Unknown',
      ]);
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
      }
      expect(await readOrders(browser)).toEqual(await readOrders(server));
    } finally {
      browser.dispose();
      server.dispose();
      editor.destroy();
    }
  });
});
