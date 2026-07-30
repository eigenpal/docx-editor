// Bounded OPC loading into canonical trees (task 4.4). Adversarial coverage for the four
// classes the spec names: LIMITS, PATHS, ENTITIES, and EXTERNAL TARGETS.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../package/ooxml-package.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

const CONTENT_TYPES =
  `<Types xmlns="${CT_NS}">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const ROOT_RELS =
  `<Relationships xmlns="${REL_NS}">` +
  `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
  '</Relationships>';

const DOCUMENT = `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>`;

function build(overrides: Record<string, string | Uint8Array> = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(DOCUMENT),
  };
  for (const [name, value] of Object.entries(overrides)) {
    entries[name] = typeof value === 'string' ? strToU8(value) : value;
  }
  return zipSync(entries);
}

describe('bounded OPC loading into canonical trees (task 4.4)', () => {
  test('loads parts as canonical trees and resolves the main document', () => {
    const result = readOoxmlPackage(build());
    if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
    expect(result.package.mainDocumentPart).toBe('/word/document.xml');
    const main = result.package.parts.get('/word/document.xml');
    expect(main?.root.localName).toBe('document');
    // The paragraph text reached the tree through typed nodes.
    expect(JSON.stringify(main)).toContain('hello');
    // Relationship parts are XML and load as trees too; the root rels owner is `/`.
    expect([...(result.package.relationships.get('/') ?? [])].map((r) => r.id)).toEqual(['rId1']);
  });

  test('a non-XML part keeps its bytes and gets no tree', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
    const result = readOoxmlPackage(build({ 'word/media/image1.png': png }));
    if (!result.ok) throw new Error(result.reason);
    expect(result.package.parts.has('/word/media/image1.png')).toBe(false);
    expect(result.package.partBytes.get('/word/media/image1.png')).toEqual(png);
  });

  describe('limits', () => {
    test('too many XML parts fails closed', () => {
      const extra: Record<string, string> = {};
      for (let i = 0; i < 5; i += 1) extra[`word/extra${i}.xml`] = '<a/>';
      const types = CONTENT_TYPES.replace(
        '</Types>',
        '<Default Extension="xml" ContentType="application/xml"/></Types>'
      );
      const result = readOoxmlPackage(build({ ...extra, '[Content_Types].xml': types }), {
        maxXmlParts: 3,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('too-many-xml-parts');
    });

    test('too many relationships fails closed', () => {
      const rels = [`<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>`];
      for (let i = 2; i < 12; i += 1) {
        rels.push(`<Relationship Id="rId${i}" Type="${IMAGE_REL}" Target="media/i${i}.png"/>`);
      }
      const result = readOoxmlPackage(
        build({
          '_rels/.rels': `<Relationships xmlns="${REL_NS}">${rels.join('')}</Relationships>`,
        }),
        { maxRelationships: 5 }
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('too-many-relationships');
    });

    test('an oversized part fails closed before tree construction', () => {
      const result = readOoxmlPackage(build(), { xml: { maxBytes: 32 } });
      expect(result.ok).toBe(false);
    });

    test('a zip entry-count limit fails closed', () => {
      const result = readOoxmlPackage(build(), {
        zip: { maxEntries: 1, maxTotalBytes: 1_000_000 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('too-many-entries');
    });
  });

  describe('paths', () => {
    test('a traversing internal relationship target is refused', () => {
      const rels =
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="../../../../etc/passwd"/>` +
        '</Relationships>';
      const result = readOoxmlPackage(build({ '_rels/.rels': rels }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('bad-relationship-target');
        expect(result.detail).toContain('traversal-escape');
      }
    });

    test('a percent-encoded separator in a target is refused', () => {
      const rels =
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        `<Relationship Id="rId2" Type="${IMAGE_REL}" Target="media%2f..%2f..%2fsecret.png"/>` +
        '</Relationships>';
      const result = readOoxmlPackage(build({ '_rels/.rels': rels }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('bad-relationship-target');
    });

    test('a traversing zip entry name is refused by the reader', () => {
      const result = readOoxmlPackage(build({ '../escape.xml': '<a/>' }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('bad-name');
    });

    test('a duplicate relationship id fails closed', () => {
      const rels =
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        `<Relationship Id="rId1" Type="${IMAGE_REL}" Target="media/a.png"/>` +
        '</Relationships>';
      const result = readOoxmlPackage(build({ '_rels/.rels': rels }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('duplicate-relationship-id');
    });

    test('a missing main document relationship fails closed', () => {
      const result = readOoxmlPackage(
        build({ '_rels/.rels': `<Relationships xmlns="${REL_NS}"></Relationships>` })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('no-main-document');
    });
  });

  describe('entities', () => {
    test('a DTD with an external entity never expands', () => {
      const evil =
        '<!DOCTYPE doc [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' +
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>&xxe;</w:t></w:r></w:p></w:body></w:document>`;
      const result = readOoxmlPackage(build({ 'word/document.xml': evil }));
      // Either the read refuses the DTD outright, or it loads with the entity UNEXPANDED.
      // What must never happen is the file's contents appearing in the tree.
      if (result.ok) {
        expect(JSON.stringify([...result.package.parts.values()])).not.toContain('root:');
      } else {
        expect(typeof result.reason).toBe('string');
      }
    });

    test('a billion-laughs nesting never expands', () => {
      const bomb =
        '<!DOCTYPE lolz [<!ENTITY lol "lol">' +
        '<!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">' +
        '<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>' +
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>&lol3;</w:t></w:r></w:p></w:body></w:document>`;
      const result = readOoxmlPackage(build({ 'word/document.xml': bomb }));
      if (result.ok) {
        const serialized = JSON.stringify([...result.package.parts.values()]);
        expect(serialized.length).toBeLessThan(100_000);
      } else {
        expect(typeof result.reason).toBe('string');
      }
    });
  });

  describe('external targets', () => {
    test('an external relationship is recorded, never resolved into a part', () => {
      const rels =
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        `<Relationship Id="rId9" Type="${IMAGE_REL}" Target="https://evil.example/track.png" TargetMode="External"/>` +
        '</Relationships>';
      const result = readOoxmlPackage(build({ '_rels/.rels': rels }));
      if (!result.ok) throw new Error(result.reason);
      expect(result.package.externalTargets).toEqual([
        {
          ownerPart: '/',
          id: 'rId9',
          type: IMAGE_REL,
          rawTarget: 'https://evil.example/track.png',
          sinkSafe: true,
        },
      ]);
      // Recorded only. It is not a part, so nothing downstream can load it by name.
      expect(result.package.parts.has('https://evil.example/track.png')).toBe(false);
      expect(result.package.partBytes.has('https://evil.example/track.png')).toBe(false);
    });

    test('an unsafe external scheme loads but is marked unsafe rather than fetched', () => {
      const rels =
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        `<Relationship Id="rId9" Type="${IMAGE_REL}" Target="javascript:alert(1)" TargetMode="External"/>` +
        '</Relationships>';
      const result = readOoxmlPackage(build({ '_rels/.rels': rels }));
      if (!result.ok) throw new Error(result.reason);
      expect(result.package.externalTargets[0]!.sinkSafe).toBe(false);
      expect(result.package.externalTargets[0]!.rawTarget).toBe('javascript:alert(1)');
    });

    test('an external target does NOT have to resolve as a part name', () => {
      // The whole point of the Internal/External split: an external target is never run
      // through owner-relative part resolution, so it cannot fail the load the way a
      // traversing INTERNAL target does.
      const rels =
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        `<Relationship Id="rId9" Type="${IMAGE_REL}" Target="../../../outside" TargetMode="External"/>` +
        '</Relationships>';
      const result = readOoxmlPackage(build({ '_rels/.rels': rels }));
      if (!result.ok) throw new Error(result.reason);
      expect(result.package.externalTargets[0]!.sinkSafe).toBe(false);
    });
  });
});

describe('package writer (cutover step 2)', () => {
  test('an unedited package round-trips through both D9 oracles', async () => {
    const { canonicalOoxmlFingerprint } = await import('../package/ooxml-tree.ts');
    const { semanticDigest, diffSemanticDigests } = await import('../package/ooxml-digest.ts');
    const { writeOoxmlPackage } = await import('../package/ooxml-package.ts');

    const original = readOoxmlPackage(build());
    if (!original.ok) throw new Error(original.reason);
    const reopened = readOoxmlPackage(writeOoxmlPackage(original.package));
    if (!reopened.ok) throw new Error(`${reopened.reason}: ${reopened.detail ?? ''}`);

    const before = original.package.parts.get('/word/document.xml')!;
    const after = reopened.package.parts.get('/word/document.xml')!;
    expect(canonicalOoxmlFingerprint(after)).toBe(canonicalOoxmlFingerprint(before));
    expect(diffSemanticDigests(semanticDigest([before]), semanticDigest([after]))).toEqual([]);
  });

  test('a part the loader never modeled passes through untouched', async () => {
    const { writeOoxmlPackage } = await import('../package/ooxml-package.ts');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 7, 7]);
    const original = readOoxmlPackage(build({ 'word/media/image1.png': png }));
    if (!original.ok) throw new Error(original.reason);
    const reopened = readOoxmlPackage(writeOoxmlPackage(original.package));
    if (!reopened.ok) throw new Error(reopened.reason);
    // Byte-for-byte: the engine claims nothing about this part, so it must not touch it.
    expect(reopened.package.partBytes.get('/word/media/image1.png')).toEqual(png);
  });

  test('an edited tree is what gets written', async () => {
    const { withPart, writeOoxmlPackage } = await import('../package/ooxml-package.ts');
    const { applyTreeOp } = await import('../store/tree-ops.ts');
    const { deriveOoxmlIndexes } = await import('../package/ooxml-indexes.ts');

    const original = readOoxmlPackage(build());
    if (!original.ok) throw new Error(original.reason);
    const part = original.package.parts.get('/word/document.xml')!;
    const paragraphId = deriveOoxmlIndexes(original.package, 0).stories.get('/word/document.xml')!
      .paragraphs[0]!.nodeId;

    const edited = applyTreeOp(part, {
      op: 'insertText',
      paragraphId,
      offset: 5,
      text: ' EDITED',
    });
    if (!edited.ok) throw new Error(edited.reason);

    const bytes = writeOoxmlPackage(withPart(original.package, edited.part));
    const reopened = readOoxmlPackage(bytes);
    if (!reopened.ok) throw new Error(reopened.reason);
    const text = deriveOoxmlIndexes(reopened.package, 0).stories.get('/word/document.xml')!
      .paragraphs[0]!.text;
    expect(text).toBe('hello EDITED');
  });
});
