import '@docx-editor.dev/core/styles/editor.css';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { sha256FontBytes } from '@docx-editor.dev/core/layout';
import { execute, plan } from './report-plan';

const evidence: unknown[] = [];
const sources = await Promise.all(
  ['Regular', 'Bold', 'Italic', 'BoldItalic'].map(async (variant) => {
    const bytes = new Uint8Array(
      await (await fetch(`/packages/fonts/assets/Carlito-${variant}.ttf`)).arrayBuffer()
    );
    return {
      request: {
        family: 'Calibri',
        weight: variant.includes('Bold') ? 700 : 400,
        style: variant.includes('Italic') ? ('italic' as const) : ('normal' as const),
      },
      id: variant,
      bytes,
      hash: sha256FontBytes(bytes),
      faceIndex: 0,
    };
  })
);
const input = await (await fetch('/@fs/tmp/editor-api-consumers/report/input.docx')).arrayBuffer();
const editor = createDocxEditor({
  container: document.getElementById('editor')!,
  document: input,
  fonts: {
    epoch: 1,
    maxFontBytes: 10000000,
    sources,
    defaultFont: { family: 'Calibri', sizeHalfPoints: 22 },
  },
});
await editor.save(); // Complete host document opening before borrowing it.
const runtime = DocxEditor.createBrowser(editor, { author: 'Report agent' });
try {
  for (const [index, action] of plan.entries()) {
    try {
      await runtime.run((context) => execute(context, action, evidence));
      evidence.push({ index, kind: action.kind, status: 'passed' });
    } catch (error) {
      evidence.push({
        index,
        kind: action.kind,
        status: 'failed',
        error: String(error),
        code: (error as { code?: string }).code,
        stack: (error as Error).stack,
      });
    }
  }
  const saved = await editor.save();
  // Reopen through the same public browser host, then read actual document semantics.
  runtime.dispose();
  editor.load(saved);
  await editor.save();
  const reopened = DocxEditor.createBrowser(editor);
  try {
    await reopened.run(async (context) => {
      const body = context.document.body;
      const tables = body.tables;
      const pictures = body.inlinePictures;
      body.load('text');
      tables.load('items');
      pictures.load('items');
      await context.sync();
      for (const [kind, read] of [
        ['body.tables-getter', () => body.tables.items.length],
        ['body.inlinePictures-getter', () => body.inlinePictures.items.length],
      ] as const) {
        try {
          read();
          evidence.push({ kind, status: 'passed' });
        } catch (error) {
          evidence.push({ kind, status: 'failed', error: String(error) });
        }
      }
      const table = tables.items[0]!;
      table.load('values,headerRowCount');
      const picture = pictures.items[0]!;
      picture.load('width,height,altTextDescription');
      await context.sync();
      if (
        table.values[0]![0] !== 'Measure' ||
        table.headerRowCount !== 1 ||
        picture.width !== 96 ||
        picture.height !== 36
      )
        throw new Error('Reopened report semantics differ');
      evidence.push({
        reopened: {
          text: body.text,
          values: table.values,
          picture: {
            width: picture.width,
            height: picture.height,
            alt: picture.altTextDescription,
          },
        },
      });
    });
  } finally {
    reopened.dispose();
  }
  (window as unknown as { reportResult: unknown }).reportResult = {
    evidence,
    bytes: Array.from(new Uint8Array(saved)),
  };
} catch (error) {
  (window as unknown as { reportResult: unknown }).reportResult = {
    evidence,
    fatal: String(error),
    stack: (error as Error).stack,
  };
} finally {
  runtime.dispose();
}
