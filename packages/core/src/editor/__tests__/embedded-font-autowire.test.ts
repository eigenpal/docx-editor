// Embedded DOCX fonts reach shaped measurement automatically (font-resolution-overhaul
// group 2, plus the group-1 composition/lifecycle guarantees).
//
// The fixture embeds REAL faces (the DejaVu test fonts) behind Word's §2.8.1 obfuscation
// — `deobfuscateFont` is a pure XOR, so applying it to clean bytes produces a correctly
// obfuscated part. What these tests pin down, end to end through `createDocxEditor`:
//
// - zero config + embedded fonts → the shaped measurer engages, exactly one remount
// - pre-resolution edits survive the shaped remount
// - explicit config sources beat embedded faces on the same request
// - a corrupt embedded face degrades THAT face with a typed report; the load never blocks
// - zero config + no embedded fonts stays fixed with no font work and no errors

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import type { EditorFontError } from '../../contracts/editor.ts';
import { sha256FontBytes } from '../../layout/index.ts';
import { deobfuscateFont } from '../../store/package/embedded-fonts.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const FT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable';
const FONT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font';

const GUID = '001B70DC-AA60-4AD5-90EC-18A0948E1EAE';

const fontFixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(new URL(`../../layout/__tests__/fixtures/fonts/${name}`, import.meta.url))
  );

const regularBytes = fontFixture('DejaVuSans.ttf');
const boldBytes = fontFixture('DejaVuSans-Bold.ttf');

/** Obfuscate per §2.8.1 — the same XOR that deobfuscates. */
const obfuscate = (bytes: Uint8Array): Uint8Array => deobfuscateFont(bytes, GUID)!;

interface EmbedEntry {
  readonly family: string;
  readonly slot: 'embedRegular' | 'embedBold' | 'embedItalic' | 'embedBoldItalic';
  readonly bytes: Uint8Array;
}

/** A DOCX whose fontTable embeds the given faces, one obfuscated part each. */
function docxWithEmbeds(body: string, embeds: readonly EmbedEntry[]): Uint8Array {
  const byFamily = new Map<string, EmbedEntry[]>();
  for (const embed of embeds) {
    const list = byFamily.get(embed.family) ?? [];
    list.push(embed);
    byFamily.set(embed.family, list);
  }
  const fontRels: string[] = [];
  const fontEntries: string[] = [];
  const parts: Record<string, Uint8Array> = {};
  let partIndex = 0;
  for (const [family, list] of byFamily) {
    const slots = list
      .map((embed) => {
        partIndex += 1;
        const relId = `rIdFont${partIndex}`;
        const partName = `fonts/font${partIndex}.odttf`;
        parts[`word/${partName}`] = obfuscate(embed.bytes);
        fontRels.push(`<Relationship Id="${relId}" Type="${FONT_REL}" Target="${partName}"/>`);
        return `<w:${embed.slot} r:id="${relId}" w:fontKey="{${GUID}}"/>`;
      })
      .join('');
    fontEntries.push(`<w:font w:name="${family}">${slots}</w:font>`);
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId10" Type="${FT}" Target="fontTable.xml"/></Relationships>`
    ),
    'word/_rels/fontTable.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${fontRels.join('')}</Relationships>`
    ),
    'word/fontTable.xml': strToU8(
      `<w:fonts xmlns:w="${W}" xmlns:r="${R}">${fontEntries.join('')}</w:fonts>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    ...parts,
  });
}

const p = (text: string, family = 'DejaVu Sans') =>
  `<w:p><w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** Wait until shaped resolution lands (or the editor settles on fixed). */
async function fontsSettled(editor: DocxEditorInstance): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const measurement = editor.fontMeasurement();
    if (!measurement.resolving && (measurement.measurer === 'shaped' || attempt > 20)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('font resolution never settled');
}

const EMBED_BOTH: readonly EmbedEntry[] = [
  { family: 'DejaVu Sans', slot: 'embedRegular', bytes: regularBytes },
  { family: 'DejaVu Sans', slot: 'embedBold', bytes: boldBytes },
];

describe('embedded fonts auto-wire into shaped measurement', () => {
  test('zero config + embedded fonts engages the shaped measurer', async () => {
    const container = document.createElement('div');
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('shaped hello'), EMBED_BOTH),
      onFontError: (error) => errors.push(error),
    });
    expect(editor.surface).not.toBeNull();
    expect(editor.fontMeasurement().measurer).toBe('fixed');
    await fontsSettled(editor);
    expect(editor.fontMeasurement()).toMatchObject({ measurer: 'shaped', resolving: false });
    expect(errors).toHaveLength(0);
    expect(container.textContent).toContain('shaped hello');
    editor.destroy();
  });

  test('exactly one shaped remount per load, and pre-resolution edits survive it', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('base'), EMBED_BOTH),
    });
    // Typed BEFORE fonts resolved: the remount must carry this edit.
    editor.exec({ type: 'insertText', text: 'X' });
    const surfaceBeforeResolve = editor.surface;
    await fontsSettled(editor);
    const surfaceAfterResolve = editor.surface;
    expect(surfaceAfterResolve).not.toBe(surfaceBeforeResolve);
    expect(editor.surface!.session.bodyText()).toBe('Xbase');
    // Settled: no further remount happens once shaped layout is in place.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(editor.surface).toBe(surfaceAfterResolve);
    editor.destroy();
  });

  test('bold-italic slot resolves bold+italic runs (style-slot mapping)', async () => {
    const container = document.createElement('div');
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('bold italic text'), [
        { family: 'DejaVu Sans', slot: 'embedBoldItalic', bytes: boldBytes },
      ]),
      onFontError: (error) => errors.push(error),
    });
    await fontsSettled(editor);
    // The single embedded face admits: shaped measurement is live and nothing errored.
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    expect(errors).toHaveLength(0);
    editor.destroy();
  });

  test('a corrupt embedded face degrades that face only, with a typed report', async () => {
    const container = document.createElement('div');
    const errors: EditorFontError[] = [];
    const corrupt = new Uint8Array(4096).fill(0x42);
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('still opens'), [
        { family: 'DejaVu Sans', slot: 'embedRegular', bytes: regularBytes },
        { family: 'Broken Face', slot: 'embedRegular', bytes: corrupt },
      ]),
      onFontError: (error) => errors.push(error),
    });
    expect(editor.surface).not.toBeNull();
    await fontsSettled(editor);
    // The valid face admitted…
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    // …and the broken one was reported, not swallowed.
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.request?.family).toBe('Broken Face');
    // The document stays fully editable throughout.
    expect(editor.exec({ type: 'insertText', text: 'Y' })).toEqual({ ok: true, changed: true });
    editor.destroy();
  });

  test('every embedded face corrupt: the load never blocks, editing works on fixed', async () => {
    const container = document.createElement('div');
    const errors: EditorFontError[] = [];
    const corrupt = new Uint8Array(4096).fill(0x42);
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('resilient'), [
        { family: 'Broken Face', slot: 'embedRegular', bytes: corrupt },
      ]),
      onFontError: (error) => errors.push(error),
    });
    expect(editor.surface).not.toBeNull();
    await fontsSettled(editor);
    expect(errors.length).toBeGreaterThan(0);
    expect(editor.exec({ type: 'insertText', text: 'Z' })).toEqual({ ok: true, changed: true });
    expect(editor.surface!.session.bodyText()).toBe('Zresilient');
    editor.destroy();
  });

  test('explicit config sources beat embedded faces on the same request', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('precedence'), [
        // The embedded regular face is the BOLD file, mislabeled — if it won, the
        // regular request would resolve to the bold hash below.
        { family: 'DejaVu Sans', slot: 'embedRegular', bytes: boldBytes },
      ]),
      fonts: {
        epoch: 1,
        maxFontBytes: 2_000_000,
        sources: [
          {
            request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
            id: 'explicit-regular',
            bytes: regularBytes,
            hash: sha256FontBytes(regularBytes),
            faceIndex: 0,
          },
        ],
        defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 24 },
      },
    });
    await fontsSettled(editor);
    const measurement = editor.fontMeasurement();
    expect(measurement.measurer).toBe('shaped');
    // The composed configuration kept the EXPLICIT source: the producer fingerprint
    // carries the admitted face hashes, so the regular file's hash must be there and
    // the mislabeled embedded (bold) bytes must not occupy the regular slot alone.
    expect(measurement.producer).toContain(sha256FontBytes(regularBytes));
    expect(measurement.producer).not.toContain(sha256FontBytes(boldBytes));
    expect(editor.exec({ type: 'insertText', text: 'ok' })).toEqual({ ok: true, changed: true });
    editor.destroy();
  });

  test('zero config + no embedded fonts stays fixed with no font work and no errors', async () => {
    const container = document.createElement('div');
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container,
      document: zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>plain</w:t></w:r></w:p></w:body></w:document>`
        ),
      }),
      onFontError: (error) => errors.push(error),
    });
    const surfaceAtMount = editor.surface;
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    await new Promise((resolve) => setTimeout(resolve, 150));
    // No resolution started, no remount happened, nothing errored.
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    expect(editor.surface).toBe(surfaceAtMount);
    expect(errors).toHaveLength(0);
    editor.destroy();
  });

  test('a whitespace-only family degrades that face; other faces and explicit fonts survive', async () => {
    // The family is attacker-controlled and the request contract THROWS on
    // empty/whitespace names — one crafted face must not detonate the composition
    // carrying every other face.
    const container = document.createElement('div');
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('crafted'), [
        { family: 'DejaVu Sans', slot: 'embedRegular', bytes: regularBytes },
        { family: '   ', slot: 'embedRegular', bytes: boldBytes },
      ]),
      onFontError: (error) => errors.push(error),
    });
    await fontsSettled(editor);
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    expect(errors.some((error) => error.code === 'malformed')).toBe(true);
    editor.destroy();
  });

  test('a load superseding an in-flight resolution never leaves resolving stuck true', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('first'), EMBED_BOTH),
    });
    // Immediately supersede with a document that starts NO font work of its own.
    expect(editor.fontMeasurement().resolving).toBe(true);
    editor.load(
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>plain</w:t></w:r></w:p></w:body></w:document>`
        ),
      })
    );
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    // Let the superseded resolution land: it must neither install the previous
    // document's measurer nor flip resolving back on.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    editor.destroy();
  });

  test('load() of a NEW document re-resolves for that document', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('first'), EMBED_BOTH),
    });
    await fontsSettled(editor);
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    // The second document has NO embedded fonts: the previous document's shaped
    // measurer must not leak onto it.
    editor.load(
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>second</w:t></w:r></w:p></w:body></w:document>`
        ),
      })
    );
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    editor.destroy();
  });
});

// Paint-side registration (embedded-font-paint-registration): admitted embedded faces
// land on `document.fonts` so painted glyphs use the measured bytes, and leave it when
// the document is replaced or the editor destroyed. Happy-dom ships neither
// `document.fonts` nor `FontFace` (which is what keeps every test ABOVE this block a
// registration no-op), so the environment is stubbed per test here.
describe('admitted embedded faces register on document.fonts', () => {
  class StubFontFace {
    constructor(
      readonly family: string,
      readonly bytes: ArrayBuffer,
      readonly descriptors: { readonly weight: string; readonly style: string }
    ) {}
    load(): Promise<unknown> {
      return Promise.resolve(this);
    }
  }
  class StubFontFaceSet {
    readonly faces = new Set<StubFontFace>();
    add(face: StubFontFace): void {
      this.faces.add(face);
    }
    delete(face: StubFontFace): boolean {
      return this.faces.delete(face);
    }
  }

  let fontSet: StubFontFaceSet;
  beforeEach(() => {
    fontSet = new StubFontFaceSet();
    (document as unknown as { fonts: StubFontFaceSet }).fonts = fontSet;
    (globalThis as unknown as { FontFace: typeof StubFontFace }).FontFace = StubFontFace;
  });
  afterEach(() => {
    delete (document as unknown as { fonts?: StubFontFaceSet }).fonts;
    delete (globalThis as unknown as { FontFace?: typeof StubFontFace }).FontFace;
  });

  const registeredFamilies = () => [...fontSet.faces].map((face) => face.family).sort();

  test('embedded faces register under their (quoted) family with canonical descriptors', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('paint me'), EMBED_BOTH),
    });
    await fontsSettled(editor);
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    expect(registeredFamilies()).toEqual(['"DejaVu Sans"', '"DejaVu Sans"']);
    expect(
      [...fontSet.faces]
        .map((face) => `${face.descriptors.weight}/${face.descriptors.style}`)
        .sort()
    ).toEqual(['400/normal', '700/normal']);
    editor.destroy();
  });

  test('a validator-rejected face never reaches the FontFaceSet', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('partial'), [
        { family: 'DejaVu Sans', slot: 'embedRegular', bytes: regularBytes },
        { family: 'Broken Face', slot: 'embedRegular', bytes: new Uint8Array(4096).fill(0x42) },
      ]),
      onFontError: () => {},
    });
    await fontsSettled(editor);
    expect(registeredFamilies()).toEqual(['"DejaVu Sans"']);
    editor.destroy();
  });

  test('loading a new document removes the previous document’s faces', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('first'), EMBED_BOTH),
    });
    await fontsSettled(editor);
    expect(fontSet.faces.size).toBe(2);
    editor.load(docxWithEmbeds(p('second, no embeds'), []));
    expect(fontSet.faces.size).toBe(0);
    editor.destroy();
  });

  test('destroy removes every face the editor registered', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('bye'), EMBED_BOTH),
    });
    await fontsSettled(editor);
    expect(fontSet.faces.size).toBe(2);
    editor.destroy();
    expect(fontSet.faces.size).toBe(0);
  });
});
