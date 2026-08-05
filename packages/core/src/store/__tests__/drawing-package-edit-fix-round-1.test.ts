// Task 12 fix round 1 — package image intent blockers (strict TDD).

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, strFromU8, unzipSync } from 'fflate';
import { sha256FontBytes } from '../../layout/font-resource.ts';
import {
  fetchExternalImageBytes,
  withEmbeddedImage,
  type ExternalImageFetchPort,
} from '../package/drawing-package-edit.ts';
import {
  createValidatedImageBytesRegistry,
  mintValidatedImageBytes,
  type ValidatedImageBytesRegistry,
} from '../package/validated-image-bytes.ts';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import { relationshipsOf, resolveContentTypeOf } from '../package/package-edit.ts';
import { IMAGE_RELATIONSHIP_TYPE } from '../package/relationships.ts';
import type { ImageDecodePort, SupportedImageMime } from '../package/image-resources.ts';
import { canonicalOoxmlFingerprint } from '../package/ooxml-tree.ts';
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

function contentTypes(extra = ''): string {
  return (
    `<Types xmlns="${CT_NS}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    extra +
    '</Types>'
  );
}

function buildPackage(
  options: {
    readonly document?: string;
    readonly docRels?: string;
    readonly media?: Record<string, Uint8Array>;
  } = {}
): OoxmlPackage {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes()),
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
  for (const [name, bytes] of Object.entries(options.media ?? {})) {
    entries[name] = bytes;
  }
  const loaded = readOoxmlPackage(zipSync(entries));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function mockDecodePort(options?: {
  readonly fail?: boolean;
  readonly pixelWidth?: number;
  readonly pixelHeight?: number;
}): ImageDecodePort {
  const calls = { n: 0 };
  const port: ImageDecodePort = {
    decode: async () => {
      calls.n += 1;
      if (options?.fail) throw new Error('decode failed');
      return {
        pixelWidth: options?.pixelWidth ?? 1,
        pixelHeight: options?.pixelHeight ?? 1,
        dpiX: 96,
        dpiY: 96,
      };
    },
  };
  Object.defineProperty(port, 'calls', { get: () => calls.n });
  return port;
}

function partBytesPresent(pkg: OoxmlPackage, partName: string): boolean {
  const normalized = partName.startsWith('/') ? partName : `/${partName}`;
  const alt = normalized.slice(1);
  return pkg.partBytes.has(normalized) || pkg.partBytes.has(alt);
}

function firstParagraphId(
  store: import('../store/tree-package-store.ts').TreePackageStore
): string {
  const part = store.bodyStore().part;
  const body = part.root.children.find((child) => child.kind === 'body')!;
  return body.children.find((child) => child.kind === 'paragraph')!.id;
}

function seededDrawingXml(relId: string): string {
  return (
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p><w:r><w:drawing data-seed="first">' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="12700" cy="12700"/>' +
    '<wp:docPr id="1" name="seeded"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' +
    relId +
    '"/></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="12700" cy="12700"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

describe('Task 12 fix round 1 — IME composition refuses package image intents', () => {
  test('insertImage during active composition refuses before package mutation or history', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const { readOoxmlPart } = await import('../package/ooxml-tree.ts');
    const pkg = buildPackage();
    const main = pkg.parts.get('/word/document.xml')!;
    const store = new TreePackageStore(pkg, main);
    const paragraphId = firstParagraphId(store);
    const revisions: number[] = [];
    store.subscribe((change) => revisions.push(change.toRevision));

    store.beginComposition({ kind: 'body' });
    const refused = await store.insertImage(
      { kind: 'body' },
      {
        paragraphId,
        offset: 0,
        bytes: PNG_1X1,
        mime: 'image/png',
        widthPoints: 8,
        heightPoints: 8,
        expectedPackageRevision: store.packageRevision,
        decodePort: mockDecodePort(),
      }
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.detail).toBe('ime-composition-active');
    expect(revisions).toHaveLength(0);
    expect(store.canUndo).toBe(false);
    expect(store.bodyStore().compositionActive).toBe(true);

    store.endComposition();
    const inserted = await store.insertImage(
      { kind: 'body' },
      {
        paragraphId,
        offset: 0,
        bytes: PNG_1X1,
        mime: 'image/png',
        widthPoints: 8,
        heightPoints: 8,
        expectedPackageRevision: store.packageRevision,
        decodePort: mockDecodePort(),
      }
    );
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;

    store.undo();
    expect(store.currentPackage().parts.get('/word/document.xml')!.root).toBeDefined();
    const xml = strFromU8(
      unzipSync(writeOoxmlPackage(store.currentPackage()))['word/document.xml']!
    );
    expect(xml).not.toContain('pic:pic');
    expect(partBytesPresent(store.currentPackage(), '/word/media/image1.png')).toBe(false);
  });
});

describe('Task 12 fix round 1 — relationship id allocation', () => {
  test('withEmbeddedImage avoids external relationship id collisions on the same owner', () => {
    const pkg = buildPackage({
      docRels:
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId2" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="https://evil.example/x.png" TargetMode="External"/>` +
        `<Relationship Id="rId3" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="https://other.example/y.png" TargetMode="External"/>` +
        '</Relationships>',
    });
    const embedded = withEmbeddedImage(pkg, '/word/document.xml', {
      bytes: PNG_1X1,
      mime: 'image/png',
    });
    expect(embedded.ok).toBe(true);
    if (!embedded.ok) return;
    expect(embedded.relationshipId).toBe('rId4');
    const rels = relationshipsOf(embedded.pkg, '/word/document.xml');
    const ids = rels.map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('rId2');
    expect(ids).toContain('rId3');
    expect(ids).toContain('rId4');
  });
});

describe('Task 12 fix round 1 — insert returns constructed drawing node id', () => {
  test('insertImage returns the inserted drawing id, not the first drawing scan', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const { readOoxmlPart } = await import('../package/ooxml-tree.ts');
    const seeded = readOoxmlPart(seededDrawingXml('rId2'), {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    if (!seeded.ok) throw new Error(seeded.reason);
    let pkg = buildPackage({
      media: { 'word/media/seed.png': PNG_1X1 },
      docRels:
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId2" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="media/seed.png"/>` +
        '</Relationships>',
    });
    pkg = { ...pkg, parts: new Map([...pkg.parts, ['/word/document.xml', seeded.part]]) };
    const store = new TreePackageStore(pkg, seeded.part);
    const seededDrawingId = seeded.part.root.children
      .find((c) => c.kind === 'body')!
      .children.find((c) => c.kind === 'paragraph')!
      .children.find((c) => c.kind === 'run')!
      .children.find((c) => c.kind === 'drawing')!.id;

    const inserted = await store.insertImage(
      { kind: 'body' },
      {
        paragraphId: firstParagraphId(store),
        offset: 1,
        bytes: PNG_1X1,
        mime: 'image/png',
        widthPoints: 8,
        heightPoints: 8,
        expectedPackageRevision: store.packageRevision,
        decodePort: mockDecodePort(),
      }
    );
    expect(inserted.ok).toBe(true);
    if (!inserted.ok || !inserted.drawingNodeId) return;
    expect(inserted.drawingNodeId).not.toBe(seededDrawingId);
  });
});

describe('Task 12 fix round 1 — owner-scoped media liveness', () => {
  test('duplicate relationship ids across owners do not delete the wrong media', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const { readOoxmlPart } = await import('../package/ooxml-tree.ts');
    const bodyDrawing = readOoxmlPart(seededDrawingXml('rId5'), {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    const headerDrawing = readOoxmlPart(
      `<w:hdr xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="12700" cy="12700"/><wp:docPr id="2" name="hdr"/>' +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:ext cx="12700" cy="12700"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:hdr>',
      {
        name: '/word/header1.xml',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
      }
    );
    if (!bodyDrawing.ok || !headerDrawing.ok) throw new Error('parse failed');

    const entries: Record<string, Uint8Array> = {
      '[Content_Types].xml': strToU8(
        contentTypes(
          `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`
        )
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r></w:r></w:p></w:body></w:document>`
      ),
      'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL_NS}"></Relationships>`),
      'word/media/body.png': PNG_1X1,
      'word/media/header.png': PNG_1X1,
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>h</w:t></w:r></w:p></w:hdr>`
      ),
      'word/_rels/header1.xml.rels': strToU8(
        `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId5" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="media/header.png"/>` +
          '</Relationships>'
      ),
    };
    const loaded = readOoxmlPackage(zipSync(entries));
    if (!loaded.ok) throw new Error(loaded.reason);
    let pkg = loaded.package;
    pkg = {
      ...pkg,
      parts: new Map([
        ...pkg.parts,
        ['/word/document.xml', bodyDrawing.part],
        ['/word/header1.xml', headerDrawing.part],
      ]),
    };

    const store = new TreePackageStore(pkg, bodyDrawing.part);
    const bodyDrawingId = bodyDrawing.part.root.children
      .find((c) => c.kind === 'body')!
      .children.find((c) => c.kind === 'paragraph')!
      .children.find((c) => c.kind === 'run')!
      .children.find((c) => c.kind === 'drawing')!.id;

    const replaced = await store.replaceImage(
      { kind: 'body' },
      bodyDrawingId,
      PNG_1X1,
      'image/png',
      mockDecodePort(),
      { expectedPackageRevision: store.packageRevision }
    );
    expect(replaced.ok).toBe(true);

    const after = store.currentPackage();
    expect(partBytesPresent(after, '/word/media/header.png')).toBe(true);
    expect(resolveContentTypeOf(after, '/word/media/header.png')).toBe('image/png');
  });
});

describe('Task 12 fix round 1 — external fetch policy', () => {
  test('fetchExternalImageBytes refuses http, relative, credentials, localhost, and private redirects', async () => {
    const port: ExternalImageFetchPort = {
      requestPublicHttps: async (url) => ({
        status: 200,
        location: null,
        contentType: 'image/png',
        body: (async function* () {
          yield PNG_1X1;
        })(),
        connectedUrl: url,
      }),
    };

    const http = await fetchExternalImageBytes(
      port,
      'http://example.com/x.png',
      new AbortController().signal
    );
    expect(http.ok).toBe(false);

    const relative = await fetchExternalImageBytes(port, '/x.png', new AbortController().signal);
    expect(relative.ok).toBe(false);

    const creds = await fetchExternalImageBytes(
      port,
      'https://user:pass@example.com/x.png',
      new AbortController().signal
    );
    expect(creds.ok).toBe(false);

    const localhost = await fetchExternalImageBytes(
      port,
      'https://localhost/x.png',
      new AbortController().signal
    );
    expect(localhost.ok).toBe(false);

    const redirectPort: ExternalImageFetchPort = {
      requestPublicHttps: async (url) => {
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
          connectedUrl: url,
        };
      },
    };
    const rebinding = await fetchExternalImageBytes(
      redirectPort,
      'https://example.com/start.png',
      new AbortController().signal
    );
    expect(rebinding.ok).toBe(false);
  });

  test('fetchExternalImageBytes fails closed when the port lacks requestPublicHttps', async () => {
    const port = {
      request: async () => ({
        status: 200,
        location: null,
        contentType: 'image/png',
        body: (async function* () {
          yield PNG_1X1;
        })(),
      }),
    } as unknown as ExternalImageFetchPort;
    const refused = await fetchExternalImageBytes(
      port,
      'https://example.com/x.png',
      new AbortController().signal
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.detail).toBe('atomic-fetch-port-required');
  });
});

describe('Task 12 fix round 1 — decode port before package write', () => {
  test('insertImage refuses corrupt valid-header bytes without event/history after decode failure', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const pkg = buildPackage();
    const main = pkg.parts.get('/word/document.xml')!;
    const store = new TreePackageStore(pkg, main);
    const revisions: number[] = [];
    store.subscribe((change) => revisions.push(change.toRevision));

    const refused = await store.insertImage(
      { kind: 'body' },
      {
        paragraphId: firstParagraphId(store),
        offset: 0,
        bytes: PNG_1X1,
        mime: 'image/png',
        widthPoints: 8,
        heightPoints: 8,
        expectedPackageRevision: store.packageRevision,

        decodePort: mockDecodePort({ fail: true }),
      }
    );
    expect(refused.ok).toBe(false);
    expect(revisions).toHaveLength(0);
    expect(store.canUndo).toBe(false);
    expect(partBytesPresent(store.currentPackage(), '/word/media/image1.png')).toBe(false);
  });
});

describe('Task 12 fix round 1 — scoped validated-byte handles', () => {
  test('two registries with the same resource key do not delete each other; dispose invalidates stale generation', () => {
    const left = createValidatedImageBytesRegistry();
    const right = createValidatedImageBytesRegistry();
    const key = 'owner\0/word/media/shared.png\0abc';
    const contentId = sha256FontBytes(PNG_1X1);
    const leftHandle = left.acquire(key, contentId, PNG_1X1);
    left.retain(leftHandle);
    const rightHandle = right.acquire(key, contentId, PNG_1X1);
    right.retain(rightHandle);
    expect(left.mint(leftHandle, contentId)).not.toBeNull();
    expect(right.mint(rightHandle, contentId)).not.toBeNull();

    left.dispose();
    expect(left.mint(leftHandle, contentId)).toBeNull();
    expect(right.mint(rightHandle, contentId)).not.toBeNull();

    right.dispose();
    expect(right.mint(rightHandle, contentId)).toBeNull();
  });
});

describe('Task 12 fix round 1 — D9 package oracle edges', () => {
  test('insert/replace/delete/undo/reopen preserve owner relationships, targets, and content types', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const { semanticDigest, diffSemanticDigests } = await import('../package/ooxml-digest.ts');
    const pkg = buildPackage();
    const main = pkg.parts.get('/word/document.xml')!;
    const store = new TreePackageStore(pkg, main);
    const decodePort = mockDecodePort();

    const inserted = await store.insertImage(
      { kind: 'body' },
      {
        paragraphId: firstParagraphId(store),
        offset: 0,
        bytes: PNG_1X1,
        mime: 'image/png',
        widthPoints: 12,
        heightPoints: 12,
        expectedPackageRevision: store.packageRevision,
        decodePort,
      }
    );
    expect(inserted.ok).toBe(true);
    if (!inserted.ok || !inserted.drawingNodeId || !inserted.mediaPartName) return;

    const afterInsert = store.currentPackage();
    const insertRel = relationshipsOf(afterInsert, '/word/document.xml').find(
      (record) => record.type === IMAGE_RELATIONSHIP_TYPE
    );
    expect(insertRel?.rawTarget).toBe('media/image1.png');
    expect(resolveContentTypeOf(afterInsert, inserted.mediaPartName)).toBe('image/png');

    const replaced = await store.replaceImage(
      { kind: 'body' },
      inserted.drawingNodeId,
      PNG_1X1,
      'image/png',
      decodePort,
      { expectedPackageRevision: store.packageRevision }
    );
    expect(replaced.ok).toBe(true);

    const afterReplace = store.currentPackage();
    const replaceRel = relationshipsOf(afterReplace, '/word/document.xml').find(
      (record) => record.type === IMAGE_RELATIONSHIP_TYPE
    );
    expect(replaceRel).toBeDefined();
    const resolvedMedia = resolveInternalTarget('/word/document.xml', replaceRel!.rawTarget);
    expect(resolvedMedia.ok).toBe(true);
    const mediaPartName = resolvedMedia.ok ? resolvedMedia.partName : inserted.mediaPartName;

    store.deleteImage({ kind: 'body' }, inserted.drawingNodeId);
    expect(partBytesPresent(store.currentPackage(), mediaPartName)).toBe(false);
    expect(
      relationshipsOf(store.currentPackage(), '/word/document.xml').some(
        (record) => record.type === IMAGE_RELATIONSHIP_TYPE
      )
    ).toBe(false);

    store.undo();
    const restored = store.currentPackage();
    expect(partBytesPresent(restored, mediaPartName)).toBe(true);
    expect(
      relationshipsOf(restored, '/word/document.xml').some(
        (r) => r.type === IMAGE_RELATIONSHIP_TYPE
      )
    ).toBe(true);

    const reopened = readOoxmlPackage(writeOoxmlPackage(restored));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(canonicalOoxmlFingerprint(reopened.package.parts.get('/word/document.xml')!)).toBe(
      canonicalOoxmlFingerprint(restored.parts.get('/word/document.xml')!)
    );
    expect(
      diffSemanticDigests(
        semanticDigest([restored.parts.get('/word/document.xml')!]),
        semanticDigest([reopened.package.parts.get('/word/document.xml')!])
      )
    ).toEqual([]);
  });
});
