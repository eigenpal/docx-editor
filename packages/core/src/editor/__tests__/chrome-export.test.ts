import { expect, test } from 'bun:test';
import { ChromeExportError, runChromeExport } from '../chrome-export.ts';

test('missing converters fail before serializing the document', async () => {
  let saves = 0;
  const editor = {
    save: async () => {
      saves++;
      return new ArrayBuffer(0);
    },
  };
  for (const format of ['markdown', 'pdf'] as const) {
    try {
      await runChromeExport(editor, format);
      throw new Error('Expected a missing converter error');
    } catch (error) {
      expect(error).toBeInstanceOf(ChromeExportError);
      expect((error as ChromeExportError).code).toBe('missing-exporter');
      expect((error as Error).message).toContain(`@docx-editor.dev/docx-to-${format}`);
    }
  }
  expect(saves).toBe(0);
});

test('Markdown exports current bytes as continuous text without page output', async () => {
  const source = new Uint8Array([1, 2, 3]);
  const result = await runChromeExport({ save: async () => source.buffer }, 'markdown', {
    markdown: async (bytes) => {
      expect(bytes).toEqual(source);
      return { markdown: '# Title\n\nContinuous body é', pages: [{ markdown: 'DO NOT DOWNLOAD' }] };
    },
  });
  expect(new TextDecoder().decode(result.bytes)).toBe('# Title\n\nContinuous body é');
  expect(result.extension).toBe('md');
  expect(result.mimeType).toBe('text/markdown;charset=utf-8');
});

test('PDF exports handler bytes and reports conversion failures', async () => {
  const editor = { save: async () => new ArrayBuffer(1) };
  const bytes = new TextEncoder().encode('%PDF-1.7\n');
  expect(await runChromeExport(editor, 'pdf', { pdf: async () => ({ bytes }) })).toEqual({
    bytes,
    extension: 'pdf',
    mimeType: 'application/pdf',
  });
  await expect(
    runChromeExport(editor, 'pdf', {
      pdf: async () => {
        throw new Error('Server refused conversion');
      },
    })
  ).rejects.toThrow('Server refused conversion');
  await expect(
    runChromeExport(editor, 'pdf', {
      pdf: async () => ({ bytes: new Uint8Array() }),
    })
  ).rejects.toThrow('no PDF bytes');
});

test('PDF export rejects endpoint error pages and incomplete headers', async () => {
  for (const body of [
    '<!doctype html><title>Missing PDF endpoint</title>',
    '{"message":"Converter is not installed"}',
    '%PD',
  ]) {
    await expect(
      runChromeExport({ save: async () => new ArrayBuffer(0) }, 'pdf', {
        pdf: async () => ({ bytes: new TextEncoder().encode(body) }),
      })
    ).rejects.toThrow('without a PDF header');
  }
});
