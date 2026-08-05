// Task 12 fix round 2 — byte snapshot, atomic fetch port, acquire/retain handles, D9 oracle.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, strFromU8, unzipSync } from 'fflate';
import { sha256FontBytes } from '../../layout/font-resource.ts';
import {
  fetchExternalImageBytes,
  validateEmbeddedImageForCommit,
  type ExternalImageFetchPort,
} from '../package/drawing-package-edit.ts';
import {
  createValidatedImageBytesRegistry,
  mintValidatedImageBytes,
  retainValidatedImageBytes,
  releaseValidatedImageBytesToken,
  type ValidatedImageBytesRegistry,
} from '../package/validated-image-bytes.ts';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import {
  contentTypesPartBytes,
  relationshipsOf,
  resolveContentTypeOf,
} from '../package/package-edit.ts';
import { IMAGE_RELATIONSHIP_TYPE } from '../package/relationships.ts';
import type { ImageDecodePort, SupportedImageMime } from '../package/image-resources.ts';
import { canonicalOoxmlFingerprint, readOoxmlPart } from '../package/ooxml-tree.ts';
import { normalizePartName, partNameKey, resolveInternalTarget } from '../package/opc-names.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

const JPEG_1X1 = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11,
  0x00, 0xff, 0xd9,
]);

function contentTypes(extra = ''): string {
  return (
    `<Types xmlns="${CT_NS}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    extra +
    '</Types>'
  );
}

function buildPackage(
  options: {
    readonly document?: string;
    readonly docRels?: string;
    readonly header?: { readonly xml: string; readonly rels: string };
    readonly media?: Record<string, Uint8Array>;
  } = {}
): OoxmlPackage {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      contentTypes(
        options.header
          ? `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`
          : ''
      )
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      options.document ??
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r></w:r></w:p></w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      options.docRels ?? `<Relationships xmlns="${REL_NS}"></Relationships>`
    ),
  };
  if (options.header) {
    entries['word/header1.xml'] = strToU8(options.header.xml);
    entries['word/_rels/header1.xml.rels'] = strToU8(options.header.rels);
  }
  for (const [name, bytes] of Object.entries(options.media ?? {})) {
    entries[name] = bytes;
  }
  const loaded = readOoxmlPackage(zipSync(entries));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function partBytesPresent(pkg: OoxmlPackage, partName: string): boolean {
  const normalized = partName.startsWith('/') ? partName : `/${partName}`;
  const alt = normalized.slice(1);
  return pkg.partBytes.has(normalized) || pkg.partBytes.has(alt);
}

function partBytesFor(pkg: OoxmlPackage, partName: string): Uint8Array | null {
  const normalized = normalizePartName(partName);
  if (!normalized.ok) return null;
  for (const [name, bytes] of pkg.partBytes) {
    if (partNameKey(name) === partNameKey(normalized.partName)) return bytes;
  }
  return null;
}

function hashPartBytes(pkg: OoxmlPackage, partName: string): string | null {
  const bytes = partBytesFor(pkg, partName);
  return bytes === null ? null : sha256FontBytes(bytes);
}

function firstParagraphId(
  store: import('../store/tree-package-store.ts').TreePackageStore
): string {
  const part = store.bodyStore().part;
  const body = part.root.children.find((child) => child.kind === 'body')!;
  return body.children.find((child) => child.kind === 'paragraph')!.id;
}

function seededDrawingXml(relId: string, embed = true): string {
  const blip = embed ? `<a:blip r:embed="${relId}"/>` : `<a:blip r:link="${relId}"/>`;
  return (
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p><w:r><w:drawing data-seed="body">' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="12700" cy="12700"/>' +
    '<wp:docPr id="1" name="seeded"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>' +
    blip +
    '</pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="12700" cy="12700"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function seededHeaderDrawingXml(relId: string): string {
  return (
    `<w:hdr xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:p><w:r><w:drawing data-seed="header">' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="12700" cy="12700"/>' +
    '<wp:docPr id="2" name="hdr"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' +
    relId +
    '"/></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="12700" cy="12700"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:hdr>'
  );
}

function ownerScopedDuplicateRelsPackage(): OoxmlPackage {
  const bodyDrawing = readOoxmlPart(seededDrawingXml('rId5'), {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  const headerDrawing = readOoxmlPart(seededHeaderDrawingXml('rId5'), {
    name: '/word/header1.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  });
  if (!bodyDrawing.ok || !headerDrawing.ok) throw new Error('parse failed');

  let pkg = buildPackage({
    media: {
      'word/media/body.png': PNG_1X1,
      'word/media/header.png': PNG_1X1,
    },
    docRels:
      `<Relationships xmlns="${REL_NS}">` +
      `<Relationship Id="rId5" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="media/body.png"/>` +
      '</Relationships>',
    header: {
      xml: seededHeaderDrawingXml('rId5'),
      rels:
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId5" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="media/header.png"/>` +
        '</Relationships>',
    },
  });
  pkg = {
    ...pkg,
    parts: new Map([
      ...pkg.parts,
      ['/word/document.xml', bodyDrawing.part],
      ['/word/header1.xml', headerDrawing.part],
    ]),
  };
  return pkg;
}

function mockDeferredMutatingDecodePort(mutate: (bytes: Uint8Array) => void): ImageDecodePort {
  return {
    decode: async (bytes: Uint8Array, _mime: SupportedImageMime) => {
      await Promise.resolve();
      mutate(bytes);
      return { pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 };
    },
  };
}

function atomicFetchPort(
  handler: (url: string) => Promise<{
    status: number;
    location: string | null;
    contentType: string | null;
    body: AsyncIterable<Uint8Array>;
    connectedUrl?: string;
  }>
): ExternalImageFetchPort {
  return {
    requestPublicHttps: async (url, _init) => {
      const response = await handler(url);
      return {
        status: response.status,
        location: response.location,
        contentType: response.contentType,
        body: response.body,
        connectedUrl: response.connectedUrl ?? url,
      };
    },
  };
}

describe('Task 12 fix round 2 — input bytes snapshotted before decode', () => {
  test('validateEmbeddedImageForCommit returns immutable snapshot independent of caller mutation', async () => {
    const live = new Uint8Array(PNG_1X1);
    const originalHash = sha256FontBytes(live);
    const validated = await validateEmbeddedImageForCommit(
      mockDeferredMutatingDecodePort((bytes) => {
        bytes.fill(0xff);
      }),
      live,
      'image/png'
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(sha256FontBytes(validated.bytes)).toBe(originalHash);
    expect(sha256FontBytes(live)).toBe(originalHash);
  });

  test('insertImage commits snapshotted bytes when caller mutates during deferred decode', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const live = new Uint8Array(PNG_1X1);
    const expectedHash = sha256FontBytes(live);
    const pkg = buildPackage();
    const main = pkg.parts.get('/word/document.xml')!;
    const store = new TreePackageStore(pkg, main);

    const inserted = await store.insertImage(
      { kind: 'body' },
      {
        paragraphId: firstParagraphId(store),
        offset: 0,
        bytes: live,
        mime: 'image/png',
        widthPoints: 8,
        heightPoints: 8,
        expectedPackageRevision: store.packageRevision,

        decodePort: mockDeferredMutatingDecodePort((bytes) => {
          bytes.fill(0xaa);
        }),
      }
    );
    expect(inserted.ok).toBe(true);
    if (!inserted.ok || !inserted.mediaPartName) return;
    expect(hashPartBytes(store.currentPackage(), inserted.mediaPartName)).toBe(expectedHash);
  });

  test('insertImage refuses when decode fails after snapshot and leaves package unchanged', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const live = new Uint8Array(PNG_1X1);
    const pkg = buildPackage();
    const store = new TreePackageStore(pkg, pkg.parts.get('/word/document.xml')!);
    const revisions: number[] = [];
    store.subscribe((change) => revisions.push(change.toRevision));

    const refused = await store.insertImage(
      { kind: 'body' },
      {
        paragraphId: firstParagraphId(store),
        offset: 0,
        bytes: live,
        mime: 'image/png',
        widthPoints: 8,
        heightPoints: 8,
        expectedPackageRevision: store.packageRevision,

        decodePort: {
          decode: async () => {
            await Promise.resolve();
            throw new Error('decode failed');
          },
        },
      }
    );
    expect(refused.ok).toBe(false);
    expect(revisions).toHaveLength(0);
    expect(partBytesPresent(store.currentPackage(), '/word/media/image1.png')).toBe(false);
  });
});

describe('Task 12 fix round 2 — atomic requestPublicHttps fetch port', () => {
  test('ports without requestPublicHttps fail closed — separate attest/request path removed', async () => {
    const legacyPort = {
      request: async () => ({
        status: 200,
        location: null,
        contentType: 'image/png',
        body: (async function* () {
          yield PNG_1X1;
        })(),
      }),
      assertPublicNetworkTarget: async () => ({ ok: true as const }),
    } as unknown as ExternalImageFetchPort;

    const refused = await fetchExternalImageBytes(
      legacyPort,
      'https://example.com/x.png',
      new AbortController().signal
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.detail).toBe('atomic-fetch-port-required');
  });

  test('redirect hop uses atomic port call and refuses private connectedUrl rebinding', async () => {
    const calls: string[] = [];
    const port = atomicFetchPort(async (url) => {
      calls.push(url);
      if (url.endsWith('/start.png')) {
        return {
          status: 302,
          location: 'https://127.0.0.1/final.png',
          contentType: null,
          body: (async function* () {})(),
          connectedUrl: url,
        };
      }
      return {
        status: 200,
        location: null,
        contentType: 'image/png',
        body: (async function* () {
          yield PNG_1X1;
        })(),
        connectedUrl: 'https://127.0.0.1/final.png',
      };
    });

    const refused = await fetchExternalImageBytes(
      port,
      'https://example.com/start.png',
      new AbortController().signal
    );
    expect(refused.ok).toBe(false);
    expect(calls).toEqual(['https://example.com/start.png']);
  });

  test('connectedUrl must match requested url on 200 responses', async () => {
    const port = atomicFetchPort(async (url) => ({
      status: 200,
      location: null,
      contentType: 'image/png',
      body: (async function* () {
        yield PNG_1X1;
      })(),
      connectedUrl: 'https://attacker.example/evil.png',
    }));

    const refused = await fetchExternalImageBytes(
      port,
      'https://example.com/x.png',
      new AbortController().signal
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.detail).toBe('connected-url-mismatch');
  });
});

describe('Task 12 fix round 2 — acquire/retain/release validated-byte registry', () => {
  test('two consumers retain shared content; releasing one leaves the other valid', () => {
    const registry = createValidatedImageBytesRegistry();
    const key = 'owner\0/word/media/shared.png\0abc';
    const contentId = sha256FontBytes(PNG_1X1);
    const handle = registry.acquire(key, contentId, PNG_1X1);
    const tokenA = registry.retain(handle);
    const tokenB = registry.retain(handle);

    expect(registry.mint(handle, contentId)).not.toBeNull();
    registry.release(tokenA);
    expect(registry.mint(handle, contentId)).not.toBeNull();

    registry.release(tokenB);
    expect(registry.mint(handle, contentId)).toBeNull();
  });

  test('independent registries do not cross-invalidate', () => {
    const left = createValidatedImageBytesRegistry();
    const right = createValidatedImageBytesRegistry();
    const key = 'owner\0/word/media/shared.png\0abc';
    const contentId = sha256FontBytes(PNG_1X1);
    const leftHandle = left.acquire(key, contentId, PNG_1X1);
    left.retain(leftHandle);
    const rightHandle = right.acquire(key, contentId, PNG_1X1);
    right.retain(rightHandle);

    left.dispose();
    expect(left.mint(leftHandle, contentId)).toBeNull();
    expect(right.mint(rightHandle, contentId)).not.toBeNull();
  });

  test('generation replacement revokes stale handles after content swap', () => {
    const registry = createValidatedImageBytesRegistry();
    const base = 'owner\0/word/media/shared.png';
    const oldId = sha256FontBytes(PNG_1X1);
    const handle = registry.acquire(`${base}\0${oldId}`, oldId, PNG_1X1);
    const token = registry.retain(handle);

    const newId = sha256FontBytes(JPEG_1X1);
    const replacement = registry.acquire(`${base}\0${newId}`, newId, JPEG_1X1);
    registry.retain(replacement);
    expect(registry.mint(handle, oldId)).toBeNull();
    expect(registry.mint(replacement, newId)).not.toBeNull();

    registry.release(token);
    expect(registry.mint(replacement, newId)).not.toBeNull();
  });

  test('module retain/release tokens are scoped to registry id', () => {
    const left = createValidatedImageBytesRegistry();
    const right = createValidatedImageBytesRegistry();
    const key = 'owner\0/word/media/x.png';
    const contentId = sha256FontBytes(PNG_1X1);
    const handle = left.acquire(`${key}\0${contentId}`, contentId, PNG_1X1);
    const token = retainValidatedImageBytes(handle);
    expect(token).not.toBeNull();
    if (!token) return;

    left.dispose();
    expect(mintValidatedImageBytes(handle, contentId)).toBeNull();

    const rightHandle = right.acquire(`${key}\0${contentId}`, contentId, PNG_1X1);
    right.retain(rightHandle);
    expect(mintValidatedImageBytes(rightHandle, contentId)).not.toBeNull();
    releaseValidatedImageBytesToken(token);
  });
});

describe('Task 12 fix round 2 — D9 package oracle across body and header owners', () => {
  function assertOwnerImageRel(
    pkg: OoxmlPackage,
    ownerPart: string,
    expected: Readonly<{ id: string; target: string; external?: boolean }>
  ): void {
    const rels = relationshipsOf(pkg, ownerPart).filter(
      (record) => record.type === IMAGE_RELATIONSHIP_TYPE
    );
    const match = rels.find((record) => record.id === expected.id);
    expect(match).toBeDefined();
    expect(match!.rawTarget).toBe(expected.target);
    if (expected.external) {
      expect(match!.targetMode).toBe('External');
    } else {
      expect(match!.targetMode).not.toBe('External');
    }
  }

  function assertContentTypeForMedia(pkg: OoxmlPackage, mediaPart: string, mime: string): void {
    expect(resolveContentTypeOf(pkg, mediaPart)).toBe(mime);
    const normalized = mediaPart.startsWith('/') ? mediaPart : `/${mediaPart}`;
    const ct = contentTypesPartBytes(pkg);
    expect(ct).not.toBeNull();
    if (!ct) return;
    const xml = strFromU8(ct.bytes);
    const ext = normalized.split('.').pop() ?? '';
    const defaultMimeByExt: Record<string, string> = {
      png: 'image/png',
      jpeg: 'image/jpeg',
      jpg: 'image/jpeg',
      gif: 'image/gif',
    };
    if (defaultMimeByExt[ext] === mime) {
      expect(xml).toContain(`Extension="${ext}"`);
      expect(xml).toContain(`ContentType="${mime}"`);
      return;
    }
    expect(xml).toContain(`PartName="${normalized}"`);
    expect(xml).toContain(`ContentType="${mime}"`);
  }

  test('insert/replace/delete/undo/redo preserve owner rels, content types, media hashes, and fingerprints', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const { semanticDigest, diffSemanticDigests } = await import('../package/ooxml-digest.ts');
    const pkg = ownerScopedDuplicateRelsPackage();
    const main = pkg.parts.get('/word/document.xml')!;
    const store = new TreePackageStore(pkg, main);
    const decodePort = {
      decode: async () => ({ pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 }),
    };

    const bodyDrawingId = main.root.children
      .find((c) => c.kind === 'body')!
      .children.find((c) => c.kind === 'paragraph')!
      .children.find((c) => c.kind === 'run')!
      .children.find((c) => c.kind === 'drawing')!.id;

    const bodyHashBefore = hashPartBytes(store.currentPackage(), '/word/media/body.png');
    const headerHashBefore = hashPartBytes(store.currentPackage(), '/word/media/header.png');
    expect(bodyHashBefore).toBe(sha256FontBytes(PNG_1X1));
    expect(headerHashBefore).toBe(sha256FontBytes(PNG_1X1));

    const replaced = await store.replaceImage(
      { kind: 'body' },
      bodyDrawingId,
      JPEG_1X1,
      'image/jpeg',
      decodePort,
      { expectedPackageRevision: store.packageRevision }
    );
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;

    const afterReplace = store.currentPackage();
    assertOwnerImageRel(afterReplace, '/word/document.xml', {
      id: 'rId6',
      target: 'media/image1.jpeg',
    });
    assertOwnerImageRel(afterReplace, '/word/header1.xml', {
      id: 'rId5',
      target: 'media/header.png',
    });
    assertContentTypeForMedia(afterReplace, '/word/media/image1.jpeg', 'image/jpeg');
    assertContentTypeForMedia(afterReplace, '/word/media/header.png', 'image/png');
    expect(hashPartBytes(afterReplace, '/word/media/header.png')).toBe(headerHashBefore);
    expect(partBytesPresent(afterReplace, '/word/media/body.png')).toBe(false);

    store.deleteImage({ kind: 'body' }, bodyDrawingId);
    const afterDelete = store.currentPackage();
    expect(
      relationshipsOf(afterDelete, '/word/document.xml').some(
        (record) => record.type === IMAGE_RELATIONSHIP_TYPE
      )
    ).toBe(false);
    expect(partBytesPresent(afterDelete, '/word/media/image1.jpeg')).toBe(false);
    expect(partBytesPresent(afterDelete, '/word/media/header.png')).toBe(true);
    expect(hashPartBytes(afterDelete, '/word/media/header.png')).toBe(headerHashBefore);

    store.undo();
    const restored = store.currentPackage();
    assertOwnerImageRel(restored, '/word/document.xml', {
      id: 'rId6',
      target: 'media/image1.jpeg',
    });
    expect(hashPartBytes(restored, '/word/media/image1.jpeg')).toBe(sha256FontBytes(JPEG_1X1));

    store.redo();
    const redone = store.currentPackage();
    expect(partBytesPresent(redone, '/word/media/image1.jpeg')).toBe(false);
    expect(hashPartBytes(redone, '/word/media/header.png')).toBe(headerHashBefore);

    store.undo();
    const saved = store.currentPackage();
    const reopened = readOoxmlPackage(writeOoxmlPackage(saved));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    for (const owner of ['/word/document.xml', '/word/header1.xml'] as const) {
      expect(canonicalOoxmlFingerprint(reopened.package.parts.get(owner)!)).toBe(
        canonicalOoxmlFingerprint(saved.parts.get(owner)!)
      );
      expect(
        diffSemanticDigests(
          semanticDigest([saved.parts.get(owner)!]),
          semanticDigest([reopened.package.parts.get(owner)!])
        )
      ).toEqual([]);
    }

    const bodyRel = relationshipsOf(reopened.package, '/word/document.xml').find(
      (record) => record.type === IMAGE_RELATIONSHIP_TYPE
    );
    expect(bodyRel).toBeDefined();
    const resolved = resolveInternalTarget('/word/document.xml', bodyRel!.rawTarget);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(hashPartBytes(reopened.package, resolved.partName)).toBe(sha256FontBytes(JPEG_1X1));
    }
  });
});
