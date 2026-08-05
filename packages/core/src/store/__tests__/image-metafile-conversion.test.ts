// EMF media renders through the decode-port seam: the host converts the metafile to SVG
// once, the resource becomes an ordinary ready state with `image/svg+xml`, and paint's
// blob-URL <img> path draws it inert. Without a converter the placeholder behavior stays.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createImageResourceCache, type ImageDecodePort } from '../package/image-resources.ts';
import { mintValidatedImageBytes } from '../package/validated-image-bytes.ts';
import { readOoxmlPackage } from '../package/ooxml-package.ts';

const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Minimal EMF: `01 00 00 00` signature dword + 84 bytes of header padding. */
function emfBytes(): Uint8Array {
  const bytes = new Uint8Array(88);
  bytes[0] = 0x01;
  // " EMF" at offset 40, as real files carry.
  bytes[40] = 0x20;
  bytes[41] = 0x45;
  bytes[42] = 0x4d;
  bytes[43] = 0x46;
  return bytes;
}

const SVG_BYTES = strToU8('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>');

function emfPackage() {
  const parsed = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT_NS}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Default Extension="emf" ContentType="image/x-emf"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL_NS}"><Relationship Id="rId7" Type="${IMAGE_REL}" Target="media/image1.emf"/></Relationships>`
      ),
      'word/media/image1.emf': emfBytes(),
    })
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(String(parsed.reason));
  return parsed.package;
}

function rasterRejectingPort(
  convertMetafile?: ImageDecodePort['convertMetafile']
): ImageDecodePort {
  return Object.freeze({
    async decode(): Promise<never> {
      throw new Error('raster decode not expected');
    },
    ...(convertMetafile ? { convertMetafile } : {}),
  });
}

describe('metafile conversion through the decode port', () => {
  test('EMF resolves ready as svg when the port converts it', async () => {
    const cache = createImageResourceCache(emfPackage(), {
      decodePort: rasterRejectingPort(async (bytes, mime) => {
        expect(mime).toBe('image/x-emf');
        expect(bytes[0]).toBe(0x01);
        return Object.freeze({ svgBytes: SVG_BYTES, pixelWidth: 795, pixelHeight: 1124 });
      }),
    });
    const state = await cache.resolveEmbedded('/word/document.xml', 'rId7');
    expect(state.kind).toBe('ready');
    if (state.kind !== 'ready') return;
    expect(state.mime).toBe('image/svg+xml');
    expect(state.pixelWidth).toBe(795);
    expect(state.pixelHeight).toBe(1124);
    expect(mintValidatedImageBytes(state.validatedHandle, state.contentId)).toEqual(SVG_BYTES);
  });

  test('EMF stays an unsupported-format placeholder without a converter', async () => {
    const cache = createImageResourceCache(emfPackage(), {
      decodePort: rasterRejectingPort(),
    });
    const state = await cache.resolveEmbedded('/word/document.xml', 'rId7');
    expect(state).toMatchObject({
      kind: 'unrenderable',
      mime: 'image/x-emf',
      reason: 'unsupported-format',
    });
  });

  test('a converter returning non-SVG output is refused as decode-failed', async () => {
    const cache = createImageResourceCache(emfPackage(), {
      decodePort: rasterRejectingPort(async () =>
        Object.freeze({
          svgBytes: strToU8('<script>alert(1)</script>'),
          pixelWidth: 10,
          pixelHeight: 10,
        })
      ),
    });
    const state = await cache.resolveEmbedded('/word/document.xml', 'rId7');
    expect(state).toMatchObject({ kind: 'unrenderable', reason: 'decode-failed' });
  });

  test('a throwing converter is refused as decode-failed', async () => {
    const cache = createImageResourceCache(emfPackage(), {
      decodePort: rasterRejectingPort(async () => {
        throw new Error('bad metafile');
      }),
    });
    const state = await cache.resolveEmbedded('/word/document.xml', 'rId7');
    expect(state).toMatchObject({ kind: 'unrenderable', reason: 'decode-failed' });
  });

  test('oversized converter output is refused as resource-limit', async () => {
    const huge = new Uint8Array(64 * 1024 * 1024 + 1);
    huge.set(strToU8('<svg xmlns="http://www.w3.org/2000/svg">'));
    const cache = createImageResourceCache(emfPackage(), {
      decodePort: rasterRejectingPort(async () =>
        Object.freeze({ svgBytes: huge, pixelWidth: 10, pixelHeight: 10 })
      ),
    });
    const state = await cache.resolveEmbedded('/word/document.xml', 'rId7');
    expect(state).toMatchObject({ kind: 'unrenderable', reason: 'resource-limit' });
  });
});
