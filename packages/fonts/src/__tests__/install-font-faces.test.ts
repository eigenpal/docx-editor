// Legacy installer calls must not change host fonts or start browser font requests.
import './dom-setup.ts';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { installDefaultFontFaces, type DefaultFontSource } from '../index.ts';

const hostFace = { family: 'Calibri', weight: '400', style: 'normal' };
let fontSet: Set<unknown>;
let previousFonts: PropertyDescriptor | undefined;
let previousFontFace: PropertyDescriptor | undefined;
let previousFetch: PropertyDescriptor | undefined;
const constructFace = mock(() => {});
const fetcher = mock(async () => new Response(null, { status: 404 }));

beforeEach(() => {
  fontSet = new Set([hostFace]);
  constructFace.mockClear();
  fetcher.mockClear();
  previousFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  previousFontFace = Object.getOwnPropertyDescriptor(globalThis, 'FontFace');
  previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(document, 'fonts', { configurable: true, value: fontSet });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetcher });
  Object.defineProperty(globalThis, 'FontFace', {
    configurable: true,
    value: class {
      constructor() {
        constructFace();
      }
      async load(): Promise<this> {
        return this;
      }
    },
  });
});
afterEach(() => {
  if (previousFonts) Object.defineProperty(document, 'fonts', previousFonts);
  else Reflect.deleteProperty(document, 'fonts');
  if (previousFontFace) Object.defineProperty(globalThis, 'FontFace', previousFontFace);
  else Reflect.deleteProperty(globalThis, 'FontFace');
  if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch);
  else Reflect.deleteProperty(globalThis, 'fetch');
});

test('the deprecated installer does nothing when called without options', async () => {
  expect(await installDefaultFontFaces()).toBe(0);
  expect(constructFace).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  expect([...fontSet]).toEqual([hostFace]);
});

const loaded: readonly DefaultFontSource[] = [
  {
    request: { family: 'Carlito', weight: 400, style: 'normal' },
    id: 'default-fonts:Carlito-Regular.ttf',
    bytes: new Uint8Array([1, 2, 3]),
    hash: 'sha256:0',
    faceIndex: 0,
  },
];

test.each([undefined, loaded])(
  'the deprecated installer ignores supplied options and never falls back to URL registration (%#)',
  async (sources) => {
    const otherFonts = new Set([hostFace]);
    const otherDocument = { fonts: otherFonts } as unknown as Document;
    expect(
      await installDefaultFontFaces({
        document: otherDocument,
        families: ['Calibri'],
        fetcher: fetcher as unknown as typeof fetch,
        loaded: sources,
      })
    ).toBe(0);
    expect(constructFace).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect([...otherFonts]).toEqual([hostFace]);
    expect([...fontSet]).toEqual([hostFace]);
  }
);
