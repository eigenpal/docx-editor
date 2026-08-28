// What the ENGINE actually sends a resolver, and what `packagedFonts()` loads when it
// arrives.
//
// Every other test in this package hand-writes the request, which leaves each one free to
// hand-write a request the engine never sends — and one of them did. `defaultFamily` was
// set to a family outside the packaged five, which no default configuration can produce,
// and the assertion that "a document naming none of the five costs nothing at all" passed
// on a premise the engine contradicts.
//
// The real chain: `docx-editor.ts` passes `configuredDefaultFontFamily(fontConfiguration())`,
// and `fontConfiguration()` answers `resolvedFontConfiguration` for a function-form
// `fonts` — which is `undefined` until the resolver returns. `font-catalog.ts` answers
// `WORD_DEFAULT_FONT.family` for `undefined`, so the request always carries 'Calibri'.
//
// UNCONDITIONALLY, for this form. `defaultFont` lives on the font configuration the
// resolver has not produced yet, and `createDocxEditor` has no `defaultFont` option, so no
// host setting reaches it. Carlito is a floor under `packagedFonts()`, not something only
// a Calibri document pays for.
//
// core is a devDependency here strictly FOR THIS TEST; the shipped module has no engine
// dependency in either direction.

// MUST be first: happy-dom registration happens on import, and the engine skips font
// resolution entirely when it has no container to attach to.
import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import type { FontResolutionRequest } from '@docx-editor.dev/core/editor';
import { packagedFonts } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const assetsDir = new URL('../../assets/', import.meta.url);

function docxNaming(family: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r>` +
        `<w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/></w:rPr>` +
        '<w:t>engine request</w:t></w:r></w:p></w:body></w:document>'
    ),
  });
}

function countingFetcher(): { fetcher: typeof fetch; files: string[] } {
  const files: string[] = [];
  const fetcher = ((input: RequestInfo | URL) => {
    const url = String(input);
    const file = url.slice(url.lastIndexOf('/') + 1);
    files.push(file);
    return Promise.resolve(new Response(new Uint8Array(readFileSync(new URL(file, assetsDir)))));
  }) as typeof fetch;
  return { fetcher, files };
}

/** Containers this file mounted, so nothing is left on `document` for the serial run. */
const mounted: HTMLElement[] = [];
const destroy: (() => void)[] = [];

afterEach(() => {
  for (const dispose of destroy.splice(0)) dispose();
  for (const element of mounted.splice(0)) element.remove();
});

/** Open a document with `fonts`, attached, and wait for the one font resolution. */
async function open(bytes: Uint8Array, fonts: Parameters<typeof createDocxEditor>[0]['fonts']) {
  const container = document.createElement('div');
  document.body.append(container);
  mounted.push(container);
  const editor = createDocxEditor({ document: bytes, fonts });
  destroy.push(() => editor.destroy());
  editor.attach(container);
  // The resolver runs after the parse and mount, then the shaper initializes.
  await new Promise((resolve) => setTimeout(resolve, 400));
  return editor;
}

describe('the request the engine sends', () => {
  test('carries Calibri as the default family, whatever the document names', async () => {
    const seen: FontResolutionRequest[] = [];
    await open(docxNaming('Montserrat'), (request) => {
      seen.push(request);
      return undefined;
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.families).toEqual(['Montserrat']);
    // NOT the document's family. `WORD_DEFAULT_FONT.family`, because a function-form
    // configuration has resolved nothing yet when this call is made. A test that writes
    // its own `defaultFamily` here can assert anything it likes.
    expect(seen[0]!.defaultFamily).toBe('Calibri');
  });
});

describe('packagedFonts under that request', () => {
  test('loads Carlito for a document that names none of the five', async () => {
    const { fetcher, files } = countingFetcher();
    await open(docxNaming('Montserrat'), packagedFonts({ fetcher, install: false }));

    // The floor: four Carlito faces for the default family alone. "Costs nothing at all"
    // was never true through the engine.
    expect([...files].sort()).toEqual([
      'Carlito-Bold.ttf',
      'Carlito-BoldItalic.ttf',
      'Carlito-Italic.ttf',
      'Carlito-Regular.ttf',
    ]);
  });

  test('loads the named family ON TOP of the default one', async () => {
    const { fetcher, files } = countingFetcher();
    await open(docxNaming('Times New Roman'), packagedFonts({ fetcher, install: false }));

    // Liberation Serif for what the document names, Carlito for the default it inherits.
    // A file using only Times New Roman does not cost Liberation Serif alone.
    expect([...files].sort()).toEqual([
      'Carlito-Bold.ttf',
      'Carlito-BoldItalic.ttf',
      'Carlito-Italic.ttf',
      'Carlito-Regular.ttf',
      'LiberationSerif-Bold.ttf',
      'LiberationSerif-BoldItalic.ttf',
      'LiberationSerif-Italic.ttf',
      'LiberationSerif-Regular.ttf',
    ]);
  });

  test('reaches zero only through `allow`, never through the document', async () => {
    // There is no host configuration that moves `defaultFamily` off Calibri for a
    // resolver: `defaultFont` lives on the font CONFIGURATION, which for a function-form
    // `fonts` is whatever the resolver returns — and it has not returned yet when the
    // request is built. `createDocxEditor` has no `defaultFont` option either. So the
    // Carlito floor is a property of the form, and narrowing is the only lever over it.
    const { fetcher, files } = countingFetcher();
    await open(
      docxNaming('Montserrat'),
      packagedFonts({ allow: ['Times New Roman'], fetcher, install: false })
    );

    expect(files).toEqual([]);
  });
});
