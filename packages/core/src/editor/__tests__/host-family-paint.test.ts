// A family the host answers paints in the host's face after more faces arrive.
//
// The host answers the regular and bold faces of a family. A late answer brings an italic
// face that the document's class fallback can reach. The regular text must still paint in
// the face that measures it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import type { FontSource, FontSourceSubstitution } from '../../contracts/editor.ts';
import { sha256FontBytes, type LayoutFontConfiguration } from '../../layout/index.ts';
import { createDocxEditor } from '../docx-editor.ts';
import * as fontConfiguration from '../font-configuration.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const fontFixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(new URL(`../../layout/__tests__/fixtures/fonts/${name}`, import.meta.url))
  );
const regularBytes = fontFixture('DejaVuSans.ttf');
const boldBytes = fontFixture('DejaVuSans-Bold.ttf');

type Face = { family: string; weight: number; style: 'normal' | 'italic' };
const face = (family: string, weight: number, style: 'normal' | 'italic'): Face => ({
  family,
  weight,
  style,
});
const source = (request: Face, bytes: Uint8Array): FontSource => ({
  request,
  id: `${request.family}-${request.weight}-${request.style}`,
  bytes,
  hash: sha256FontBytes(bytes),
  faceIndex: 0,
});

/** A swiss family in a document whose serif default makes its class fallback Arial. */
function swissFamilyDocument(): Uint8Array {
  const run = (text: string, italic = false) =>
    `<w:p><w:r><w:rPr><w:rFonts w:ascii="Brand Light" w:hAnsi="Brand Light"/>${italic ? '<w:i/>' : ''}</w:rPr><w:t>${text}</w:t></w:r></w:p>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="r" Type="${OD}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="f" Type="${OD}/fontTable" Target="fontTable.xml"/><Relationship Id="s" Type="${OD}/styles" Target="styles.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${run('Regular text')}${run('Italic text', true)}</w:body></w:document>`
    ),
    'word/fontTable.xml': strToU8(
      `<w:fonts xmlns:w="${W}"><w:font w:name="Brand Light"><w:family w:val="swiss"/></w:font><w:font w:name="Times New Roman"><w:family w:val="roman"/></w:font></w:fonts>`
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
    ),
  });
}

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
  add(added: StubFontFace): void {
    this.faces.add(added);
  }
  delete(deleted: StubFontFace): boolean {
    return this.faces.delete(deleted);
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

async function until(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`never reached: ${label}`);
}

test('regular text keeps the host face after a late italic, in measurement and in paint', async () => {
  const configurations: LayoutFontConfiguration[] = [];
  const createLayoutShaping = fontConfiguration.createLayoutShaping;
  const spy = spyOn(fontConfiguration, 'createLayoutShaping').mockImplementation(
    async (configuration, instrumentation) => {
      configurations.push(configuration);
      return createLayoutShaping(configuration, instrumentation);
    }
  );
  // The host serves the family through its stand-in, for the faces that text used first.
  const answered: FontSourceSubstitution[] = [400, 700].map((weight) => ({
    from: face('Brand Light', weight, 'normal'),
    to: face('Stand In', weight, 'normal'),
  }));
  // Its background load then brings the faces of the fallback family too.
  const late = {
    sources: [source(face('Liberation Sans', 400, 'italic'), regularBytes)],
    substitutions: [
      { from: face('Arial', 400, 'italic'), to: face('Liberation Sans', 400, 'italic') },
    ],
  };
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: swissFamilyDocument(),
    fonts: () => ({
      sources: [
        source(face('Stand In', 400, 'normal'), regularBytes),
        source(face('Stand In', 700, 'normal'), boldBytes),
      ],
      substitutions: answered,
      deferred: Promise.resolve(late),
    }),
  });
  try {
    await until(
      () => editor.fontMeasurement().measurer === 'shaped' && !editor.fontMeasurement().resolving,
      'late faces installed'
    );
    expect(configurations.length).toBeGreaterThan(1);

    // Measurement: the regular face resolves to the host's stand-in, first-wins by face.
    const final = configurations.at(-1)!;
    const measuredWith = final.substitutions?.find(
      ({ from }) => from.family === 'Brand Light' && from.weight === 400 && from.style === 'normal'
    )?.to.family;
    expect(measuredWith).toBe('Stand In');
    expect(
      final.substitutions?.filter(
        ({ from, to }) => from.family === 'Brand Light' && to.family === 'Liberation Sans'
      )
    ).toEqual([]);

    // Paint: the regular run asks first for the alias that holds the stand-in's faces.
    const standIn = [...fontSet.faces].find(
      (registered) => registered.bytes.byteLength === boldBytes.byteLength
    )!.family;
    const painted = [
      ...container.querySelectorAll<HTMLElement>('[data-paragraph-id] .layout-run-text'),
    ].find((run) => run.textContent?.startsWith('Regular'));
    expect(painted?.style.fontFamily.split(',')[0]?.replace(/"/g, '').trim()).toBe(standIn);
  } finally {
    editor.destroy();
    spy.mockRestore();
  }
});
