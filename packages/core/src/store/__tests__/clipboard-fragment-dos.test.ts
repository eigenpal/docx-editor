// Resource-exhaustion guards for the paste merge: a fragment under every declared cap must
// still merge in near-linear time. These pin the O(1) media allocation, the O(1) style-id
// collision resolution, and the non-body budget against regressions to the measured O(n^2)
// freezes a prior review found.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import { mergeFragmentIntoPackage } from '../store/clipboard-fragment-merge.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function load(bytes: Uint8Array): OoxmlPackage {
  const r = readOoxmlPackage(bytes);
  if (!r.ok) throw new Error(r.reason);
  return r.package;
}

const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function blankTarget(): OoxmlPackage {
  return load(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`
      ),
    })
  );
}

describe('paste merge stays near-linear under the caps', () => {
  test('a fragment with 3000 distinct images merges quickly (no O(media^2))', () => {
    const N = 3000;
    const entries: Record<string, Uint8Array> = {};
    const paras: string[] = [];
    const rels: string[] = [];
    for (let i = 0; i < N; i += 1) {
      // Each distinct image: flip one byte so the content hash differs.
      const bytes = new Uint8Array(TINY_PNG);
      bytes[bytes.length - 5] = i & 0xff;
      bytes[bytes.length - 6] = (i >> 8) & 0xff;
      entries[`word/media/img${i}.png`] = bytes;
      rels.push(`<Relationship Id="rId${i + 10}" Type="${R}/image" Target="media/img${i}.png"/>`);
      paras.push(
        `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><wp:extent cx="100" cy="100"/><wp:docPr id="${i + 1}" name=""/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${i + 10}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
      );
    }
    entries['[Content_Types].xml'] = strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    );
    entries['_rels/.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    );
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${rels.join('')}</Relationships>`
    );
    entries['word/document.xml'] = strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${paras.join('')}</w:body></w:document>`
    );
    const fragment = load(zipSync(entries));
    const target = blankTarget();

    const start = performance.now();
    const merged = mergeFragmentIntoPackage(target, fragment, target.mainDocumentPart);
    const elapsed = performance.now() - start;

    expect(merged.ok).toBe(true);
    // A quadratic curve put 2000 images at ~21s; near-linear keeps 3000 well under a second
    // on CI. Generous ceiling — a regression to O(media^2) blows straight past it.
    expect(elapsed).toBeLessThan(4000);
  });

  test('a fragment with 8000 colliding style ids merges quickly (no O(style^2))', () => {
    const styles: string[] = [];
    for (let i = 0; i < 8000; i += 1) {
      // All named "Normal" with distinct signatures, all colliding with the target's Normal.
      styles.push(
        `<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="${20 + (i % 40)}"/></w:rPr></w:style>`
      );
    }
    const fragment = load(
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
        ),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rIdS" Type="${R}/styles" Target="styles.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`
        ),
        'word/styles.xml': strToU8(
          `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${styles.join('')}</w:styles>`
        ),
      })
    );
    const target = load(
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
        ),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rIdS" Type="${R}/styles" Target="styles.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`
        ),
        'word/styles.xml': strToU8(
          `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style></w:styles>`
        ),
      })
    );

    const start = performance.now();
    const merged = mergeFragmentIntoPackage(target, fragment, target.mainDocumentPart);
    const elapsed = performance.now() - start;

    expect(merged.ok).toBe(true);
    expect(elapsed).toBeLessThan(4000);
  });
});
