import { describe, expect, test } from 'bun:test';
import { EditorFontError } from '@docx-editor.dev/core-contract/contracts/editor';
import type { DisplayPage, GlyphFont } from '@docx-editor.dev/core-contract/contracts/geometry';
import {
  createFontResourceSnapshot,
  sha256FontBytes,
  type FontRequest,
} from '@docx-editor.dev/engine-layout';
import {
  BrowserFontPaintError,
  installDisplayFonts,
  type BrowserFontFace,
  type BrowserFontFaceFactory,
  type BrowserFontSet,
} from '../src/browser-font-registry.ts';

const REGULAR_BYTES = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const BOLD_BYTES = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
const regularRequest: FontRequest = { family: 'Fixture Sans', weight: 400, style: 'normal' };
const boldRequest: FontRequest = { family: 'Fixture Sans', weight: 700, style: 'normal' };

function fixture() {
  const fonts = createFontResourceSnapshot({
    epoch: 7,
    maxFontBytes: 1024,
    resources: [
      {
        request: regularRequest,
        id: 'fixture-regular',
        bytes: REGULAR_BYTES,
        hash: sha256FontBytes(REGULAR_BYTES),
        faceIndex: 0,
      },
      {
        request: boldRequest,
        id: 'fixture-bold',
        bytes: BOLD_BYTES,
        hash: sha256FontBytes(BOLD_BYTES),
        faceIndex: 0,
      },
    ],
    validateFont: () => ({ valid: true }),
  });
  const resolvedRegular = fonts.resolve(regularRequest);
  const resolvedBold = fonts.resolve(boldRequest);
  if (resolvedRegular instanceof Error || resolvedBold instanceof Error) throw new Error('fixture');
  const glyphFont = (font: typeof resolvedRegular): GlyphFont => ({
    id: font.id,
    identity: font.identity,
    family: font.family,
    request: font.request,
    hash: font.hash,
    faceIndex: font.faceIndex,
    byteLength: font.byteLength,
    substitution: font.substitution,
  });
  const runs = [glyphFont(resolvedRegular), glyphFont(resolvedBold)].map((font) => ({
    text: 'x',
    box: { x: 0, y: 0, width: 10, height: 20 },
    font,
    fontFamily: font.family,
    fontSizeHalfPoints: 24,
    fontSizePx: 16,
    fontWeight: font.request.weight,
    fontStyle: font.request.style,
    color: { kind: 'hex' as const, value: '112233' },
    direction: 'ltr' as const,
    bidiLevel: 0,
    glyphs: [],
    clusters: [],
    fontSpans: [],
    verticalMetrics: { ascent: 12, descent: 4, lineGap: 0, baseline: 12 },
    shaping: {
      font,
      variationAxes: [],
      shapingLibrary: { name: 'fixture', version: '1' },
      unicodeDataVersion: '16',
      normalization: 'none' as const,
      script: 'Latn',
      language: 'und',
      direction: 'ltr' as const,
      features: [],
      fallbackOrder: [],
      fixedPointScale: 20,
      roundingMode: 'halfAwayFromZero' as const,
    },
    producer: {
      resourceEpoch: 7,
      configEpoch: 1,
      extensionFingerprint: 'none',
      shapingHash: 'fixture',
      producerVersion: 1,
    },
  }));
  const pages = [
    {
      index: 0,
      box: { x: 0, y: 0, width: 100, height: 100 },
      contentBox: { x: 0, y: 0, width: 100, height: 100 },
      items: [
        {
          kind: 'text',
          box: { x: 0, y: 0, width: 20, height: 20 },
          runs,
          semantic: {},
          clusters: [],
          scope: { kind: 'body' },
        },
      ],
    },
  ] as unknown as readonly DisplayPage[];
  return { fonts, pages, regular: runs[0]!.font, bold: runs[1]!.font };
}

class FakeFace implements BrowserFontFace {
  readonly loaded: Promise<BrowserFontFace>;
  constructor(
    readonly family: string,
    readonly bytes: Uint8Array,
    readonly descriptors: Readonly<{ weight: string; style: string }>,
    reject = false
  ) {
    this.loaded = reject
      ? Promise.reject(new Error('font decoder rejected bytes'))
      : Promise.resolve(this);
  }
  load(): Promise<BrowserFontFace> {
    return this.loaded;
  }
}

class FakeFontSet implements BrowserFontSet {
  readonly faces = new Set<BrowserFontFace>();
  add(face: BrowserFontFace): void {
    this.faces.add(face);
  }
  delete(face: BrowserFontFace): boolean {
    return this.faces.delete(face);
  }
}

describe('browser font registry', () => {
  test('loads exact regular and bold bytes before returning identity-derived aliases', async () => {
    const { fonts, pages, regular, bold } = fixture();
    const set = new FakeFontSet();
    const created: FakeFace[] = [];
    const factory: BrowserFontFaceFactory = (family, bytes, descriptors) => {
      const face = new FakeFace(family, new Uint8Array(bytes), descriptors);
      created.push(face);
      return face;
    };

    const lease = await installDisplayFonts(pages, fonts, set, factory);

    expect(created.map((face) => [...face.bytes])).toEqual([[...REGULAR_BYTES], [...BOLD_BYTES]]);
    expect(lease.aliasFor(regular)).toMatch(/^DocxFont_[a-f0-9]{64}_0_400_normal$/);
    expect(lease.aliasFor(bold)).toMatch(/^DocxFont_[a-f0-9]{64}_0_700_normal$/);
    expect(lease.aliasFor(regular)).not.toBe(lease.aliasFor(bold));
    expect(set.faces.size).toBe(2);
    lease.release();
  });

  test('deduplicates by hash, face, weight, and style and reference-counts editors', async () => {
    const { fonts, pages } = fixture();
    const set = new FakeFontSet();
    let creations = 0;
    const factory: BrowserFontFaceFactory = (family, bytes, descriptors) => {
      creations += 1;
      return new FakeFace(family, new Uint8Array(bytes), descriptors);
    };

    const first = await installDisplayFonts(pages, fonts, set, factory);
    const second = await installDisplayFonts(pages, fonts, set, factory);
    expect(creations).toBe(2);
    expect(set.faces.size).toBe(2);
    first.release();
    expect(set.faces.size).toBe(2);
    second.release();
    expect(set.faces.size).toBe(0);
  });

  test('fails visibly when FontFace loading fails and leaves no registration', async () => {
    const { fonts, pages } = fixture();
    const set = new FakeFontSet();
    const factory: BrowserFontFaceFactory = (family, bytes, descriptors) =>
      new FakeFace(family, new Uint8Array(bytes), descriptors, true);

    await expect(installDisplayFonts(pages, fonts, set, factory)).rejects.toMatchObject({
      name: 'BrowserFontPaintError',
      code: 'loadFailed',
    });
    expect(set.faces.size).toBe(0);
  });

  test('fails typed when layout font metadata does not match resource bytes', async () => {
    const { fonts, pages } = fixture();
    const badPages = structuredClone(pages) as unknown as DisplayPage[];
    const text = badPages[0]!.items[0] as Extract<DisplayPage['items'][number], { kind: 'text' }>;
    (text.runs[0]!.font as { hash: string }).hash = `sha256:${'0'.repeat(64)}`;

    await expect(
      installDisplayFonts(
        badPages,
        fonts,
        new FakeFontSet(),
        (family, bytes, descriptors) => new FakeFace(family, new Uint8Array(bytes), descriptors)
      )
    ).rejects.toMatchObject({
      name: 'BrowserFontPaintError',
      code: 'fontMismatch',
    });
  });

  test('refuses a mixed-font span until the display bridge splits it', async () => {
    const { fonts, pages, bold } = fixture();
    const mixedPages = structuredClone(pages) as unknown as DisplayPage[];
    const text = mixedPages[0]!.items[0] as Extract<DisplayPage['items'][number], { kind: 'text' }>;
    (text.runs[0] as { fontSpans: unknown[] }).fontSpans = [
      { glyphFrom: 0, glyphTo: 1, font: bold, fallbackIndex: 0 },
    ];

    await expect(
      installDisplayFonts(
        mixedPages,
        fonts,
        new FakeFontSet(),
        (family, bytes, descriptors) => new FakeFace(family, new Uint8Array(bytes), descriptors)
      )
    ).rejects.toMatchObject({
      name: 'BrowserFontPaintError',
      code: 'fontMismatch',
    });
  });

  test('fails typed for a missing layout-selected font', async () => {
    const { pages } = fixture();
    const empty = createFontResourceSnapshot({
      epoch: 7,
      maxFontBytes: 1024,
      resources: [],
      validateFont: () => ({ valid: true }),
    });

    try {
      await installDisplayFonts(
        pages,
        empty,
        new FakeFontSet(),
        (family, bytes, descriptors) => new FakeFace(family, new Uint8Array(bytes), descriptors)
      );
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserFontPaintError);
      expect(error).toBeInstanceOf(EditorFontError);
      expect((error as BrowserFontPaintError).code).toBe('missingFont');
    }
  });

  test('fails typed when the supplied registry declares hash-invalid bytes', async () => {
    const { pages } = fixture();
    const invalid = createFontResourceSnapshot({
      epoch: 7,
      maxFontBytes: 1024,
      resources: [
        {
          request: regularRequest,
          id: 'fixture-regular',
          bytes: REGULAR_BYTES,
          hash: `sha256:${'0'.repeat(64)}`,
          faceIndex: 0,
        },
      ],
      validateFont: () => ({ valid: true }),
    });

    await expect(
      installDisplayFonts(
        pages,
        invalid,
        new FakeFontSet(),
        (family, bytes, descriptors) => new FakeFace(family, new Uint8Array(bytes), descriptors)
      )
    ).rejects.toMatchObject({
      name: 'BrowserFontPaintError',
      code: 'hashInvalid',
    });
  });
});
