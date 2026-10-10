// Font origins provide bytes. Core registers private aliases, preserving native glyph fallback.
import './dom-setup.ts';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { registerEmbeddedFontFaces } from '../../../core/src/editor/embedded-font-faces.ts';
import { defaultFonts, packagedFonts } from '../index.ts';

const assets = new URL('../../assets/', import.meta.url);
const fetcher = (async (input: RequestInfo | URL) => {
  const name = String(input).split('/').at(-1)!;
  return new Response(new Uint8Array(readFileSync(new URL(name, assets))));
}) as typeof fetch;

class TestFontFace {
  readonly family: string;
  readonly weight: string;
  readonly style: string;
  constructor(family: string, _source: unknown, descriptors: Record<string, string>) {
    this.family = family;
    this.weight = descriptors.weight ?? '400';
    this.style = descriptors.style ?? 'normal';
  }
  async load(): Promise<this> {
    return this;
  }
}

let fontSet: Set<TestFontFace>;
let previousFonts: PropertyDescriptor | undefined;
let previousFontFace: PropertyDescriptor | undefined;
beforeEach(() => {
  fontSet = new Set();
  previousFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  previousFontFace = Object.getOwnPropertyDescriptor(globalThis, 'FontFace');
  Object.defineProperty(document, 'fonts', { configurable: true, value: fontSet });
  Object.defineProperty(globalThis, 'FontFace', { configurable: true, value: TestFontFace });
});
afterEach(() => {
  if (previousFonts) Object.defineProperty(document, 'fonts', previousFonts);
  else Reflect.deleteProperty(document, 'fonts');
  if (previousFontFace) Object.defineProperty(globalThis, 'FontFace', previousFontFace);
  else Reflect.deleteProperty(globalThis, 'FontFace');
});

const loaders = [
  ['defaultFonts', () => defaultFonts({ families: ['Arial'], fetcher })],
  [
    'packagedFonts',
    () => packagedFonts({ fetcher })({ families: ['Arial'], defaultFamily: 'Arial' }),
  ],
  [
    'packagedFonts with install:undefined',
    () =>
      packagedFonts({ fetcher, install: undefined })({
        families: ['Arial'],
        defaultFamily: 'Arial',
      }),
  ],
  [
    'packagedFonts with install:false',
    () =>
      packagedFonts({ fetcher, install: false })({ families: ['Arial'], defaultFamily: 'Arial' }),
  ],
  [
    'packagedFonts with deprecated install:true',
    () =>
      packagedFonts({ fetcher, install: true })({ families: ['Arial'], defaultFamily: 'Arial' }),
  ],
] as const;

test.each(loaders)(
  '%s preserves native family names and supplies privately paintable bytes',
  async (_name, load) => {
    const fragment = await load();
    // A public Arial face backed by Liberation Sans hides native Arabic glyphs. The
    // substitute has no Arabic coverage, so CSS then uses a different family's metrics.
    expect(fontSet.size).toBe(0);
    expect(fragment.sources).toHaveLength(4);
    expect(fragment.failures).toHaveLength(0);
    const registration = await registerEmbeddedFontFaces(
      fragment.sources,
      undefined,
      fragment.substitutions
    );
    expect(registration.installed).toBe(4);
    expect([...fontSet].every((face) => face.family.startsWith('docx-embedded-'))).toBe(true);
    expect(registration.alias('Arial')).toBe(registration.alias('Liberation Sans'));
    expect(registration.alias('Arial')).toMatch(/^docx-embedded-/);
    // The editor owns the aliases and removes them without changing host-page families.
    registration.dispose();
    expect(fontSet.size).toBe(0);
  }
);

test('an editor preserves Arabic fallback widths across font resolution and disposal', async () => {
  const { createDocxEditor } = await import('@docx-editor.dev/core/editor');
  const { strToU8, zipSync } = await import('fflate');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:bidi/></w:pPr>` +
        '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>' +
        '<w:sz w:val="22"/></w:rPr><w:t>العربية العربية</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="2400" w:h="6000"/>' +
        '<w:pgMar w:left="400" w:right="400" w:top="400" w:bottom="400"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
  const prototype = HTMLCanvasElement.prototype;
  const previousContext = Object.getOwnPropertyDescriptor(prototype, 'getContext');
  Object.defineProperty(prototype, 'getContext', {
    configurable: true,
    value: () => ({
      font: '',
      measureText(this: { font: string }, text: string) {
        const px = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 11);
        // Model the browser's native glyph fallback. A public Arial web face removes
        // native Arial from that family; private aliases leave it reachable.
        const native = ![...fontSet].some((face) => face.family === 'Arial');
        return { width: text.length * (native ? 3 : 7) * (px / 11) };
      },
    }),
  });
  const host = document.createElement('div');
  document.body.append(host);
  const hostFace = new TestFontFace('Host Page Face', null, {});
  fontSet.add(hostFace);
  const editor = createDocxEditor({
    document: bytes,
    fonts: packagedFonts({ fetcher, install: true }),
  });
  try {
    editor.attach(host);
    const deadline = Date.now() + 8000;
    while (editor.fontMeasurement().resolving && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.fontMeasurement().resolving).toBe(false);
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    expect([...fontSet].some((face) => face.family.startsWith('docx-embedded-'))).toBe(true);
    expect([...fontSet].some((face) => face.family === 'Arial')).toBe(false);
    const lines = host.querySelectorAll('.docx-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toBe('العربية العربية');
    editor.detach();
    editor.attach(host);
    expect(host.querySelectorAll('.docx-line')).toHaveLength(1);
  } finally {
    editor.destroy();
    host.remove();
    if (previousContext) Object.defineProperty(prototype, 'getContext', previousContext);
    else Reflect.deleteProperty(prototype, 'getContext');
  }
  expect([...fontSet]).toEqual([hostFace]);
});
