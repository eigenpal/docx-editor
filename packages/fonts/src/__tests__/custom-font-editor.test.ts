import './dom-setup.ts';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createDocxEditor, customFonts } from '@docx-editor.dev/core/editor';

class TestFontFace {
  constructor(
    readonly family: string,
    readonly source: ArrayBuffer,
    readonly descriptors: { weight: string; style: string }
  ) {}
  async load(): Promise<this> {
    return this;
  }
}

test('a blank editor offers company fonts and applies loaded regular and bold private faces', async () => {
  const fixtures = new URL('../../../core/src/layout/__tests__/fixtures/fonts/', import.meta.url);
  const regular = new Uint8Array(readFileSync(new URL('DejaVuSans.ttf', fixtures)));
  const bold = new Uint8Array(readFileSync(new URL('DejaVuSans-Bold.ttf', fixtures)));
  const requests: string[] = [];
  const fonts = customFonts({
    sources: [
      { url: '/company/regular.ttf', family: 'Company Sans', weight: 400, style: 'normal' },
      { url: '/company/bold.ttf', family: 'Company Sans', weight: 700, style: 'normal' },
    ],
    fetcher: (async (url: RequestInfo | URL) => {
      requests.push(String(url));
      if (url === '/company/regular.ttf') return new Response(regular.slice());
      if (url === '/company/bold.ttf') return new Response(bold.slice());
      throw new Error(`Unexpected font request: ${url}`);
    }) as typeof fetch,
  });
  expect(requests).toEqual([]);

  const previousFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  const previousFontFace = Object.getOwnPropertyDescriptor(globalThis, 'FontFace');
  const previousCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const hostFace = new TestFontFace('Host Page Font', new ArrayBuffer(0), {
    weight: '400',
    style: 'normal',
  });
  const fontSet = new Set([hostFace]);
  Object.defineProperty(document, 'fonts', { configurable: true, value: fontSet });
  Object.defineProperty(globalThis, 'FontFace', { configurable: true, value: TestFontFace });
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: undefined });
  const host = document.createElement('div');
  document.body.append(host);
  let editor: ReturnType<typeof createDocxEditor> | undefined;
  try {
    editor = createDocxEditor({ document: 'blank', fonts });
    editor.attach(host);
    const deadline = Date.now() + 8000;
    while (editor.fontMeasurement().resolving && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.fontMeasurement().resolving).toBe(false);
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    expect(editor.getDocumentFonts()).not.toContain('Company Sans');
    expect(editor.getAvailableFonts()).toContain('Company Sans');
    expect(requests).toEqual(['/company/regular.ttf', '/company/bold.ttf']);

    const companyFaces = [...fontSet].filter((face) => face !== hostFace);
    expect(companyFaces).toHaveLength(2);
    const alias = companyFaces[0]!.family;
    expect(alias).toMatch(/^docx-embedded-/);
    expect(companyFaces.every((face) => face.family === alias)).toBe(true);
    expect(
      new Uint8Array(companyFaces.find((face) => face.descriptors.weight === '400')!.source)
    ).toEqual(regular);
    expect(
      new Uint8Array(companyFaces.find((face) => face.descriptors.weight === '700')!.source)
    ).toEqual(bold);

    expect(
      editor.exec({
        type: 'setMarkAttr',
        mark: 'fontFamily',
        attr: 'family',
        value: 'Company Sans',
      }).ok
    ).toBe(true);
    expect(editor.exec({ type: 'insertText', text: 'Regular' }).ok).toBe(true);
    expect(editor.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
    expect(editor.exec({ type: 'insertText', text: 'Bold' }).ok).toBe(true);
    const spans = [...host.querySelectorAll<HTMLElement>('span[style]')];
    const regularSpan = spans.find((span) => span.textContent === 'Regular');
    const boldSpan = spans.find((span) => span.textContent === 'Bold');
    expect(regularSpan).toBeDefined();
    expect(boldSpan).toBeDefined();
    expect(regularSpan!.style.fontFamily).toContain(alias);
    expect(boldSpan!.style.fontFamily).toContain(alias);
    expect(boldSpan!.style.fontWeight).toBe('bold');
    expect(editor.getSelectionFormatting()?.fontFamily).toBe('Company Sans');
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    expect(requests).toHaveLength(2);
    expect([...fontSet]).toEqual([hostFace, ...companyFaces]);
    editor.destroy();
    editor = undefined;
    expect([...fontSet]).toEqual([hostFace]);
  } finally {
    editor?.destroy();
    host.remove();
    if (previousFonts) Object.defineProperty(document, 'fonts', previousFonts);
    else Reflect.deleteProperty(document, 'fonts');
    if (previousFontFace) Object.defineProperty(globalThis, 'FontFace', previousFontFace);
    else Reflect.deleteProperty(globalThis, 'FontFace');
    if (previousCaches) Object.defineProperty(globalThis, 'caches', previousCaches);
    else Reflect.deleteProperty(globalThis, 'caches');
  }
});
