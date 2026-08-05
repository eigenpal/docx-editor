// Whole-branch blocker 2 — deleteImage cleans embedded and linked external rels (strict TDD).

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPart } from '../package/ooxml-tree.ts';
import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import { relationshipsOf } from '../package/package-edit.ts';
import { IMAGE_RELATIONSHIP_TYPE } from '../package/relationships.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_NS = REL;
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

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
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
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

function partBytesPresent(pkg: OoxmlPackage, partName: string): boolean {
  const normalized = partName.startsWith('/') ? partName : `/${partName}`;
  const alt = normalized.slice(1);
  return pkg.partBytes.has(normalized) || pkg.partBytes.has(alt);
}

function linkedDrawingDocument(
  relId: string,
  target: string
): {
  readonly bodyPart: ReturnType<typeof readOoxmlPart> extends { ok: true; part: infer P }
    ? P
    : never;
  readonly pkg: OoxmlPackage;
} {
  const linkedXml =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="12700" cy="12700"/><wp:docPr id="1" name="linked"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:link="' +
    relId +
    '"/></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="12700" cy="12700"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
  const bodyPart = readOoxmlPart(linkedXml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!bodyPart.ok) throw new Error(bodyPart.reason);
  const loaded = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(linkedXml),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="${relId}" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="${target}" TargetMode="External"/></Relationships>`
      ),
    })
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  const pkg = Object.freeze({
    ...loaded.package,
    parts: new Map([...loaded.package.parts, ['/word/document.xml', bodyPart.part]]),
    externalTargets: Object.freeze([
      {
        ownerPart: '/word/document.xml',
        id: relId,
        type: IMAGE_RELATIONSHIP_TYPE,
        rawTarget: target,
        sinkSafe: true,
      },
    ]),
  });
  return { bodyPart: bodyPart.part, pkg };
}

function drawingIdOf(part: { readonly root: { readonly children: readonly unknown[] } }): string {
  const body = part.root.children.find(
    (child): child is { readonly kind: string; readonly children: readonly unknown[] } =>
      typeof child === 'object' && child !== null && 'kind' in child && child.kind === 'body'
  )!;
  const paragraph = body.children.find(
    (child): child is { readonly kind: string; readonly children: readonly unknown[] } =>
      typeof child === 'object' && child !== null && 'kind' in child && child.kind === 'paragraph'
  )!;
  const run = paragraph.children.find(
    (child): child is { readonly kind: string; readonly children: readonly unknown[] } =>
      typeof child === 'object' && child !== null && 'kind' in child && child.kind === 'run'
  )!;
  const drawing = run.children.find(
    (child): child is { readonly id: string; readonly kind: string } =>
      typeof child === 'object' && child !== null && 'kind' in child && child.kind === 'drawing'
  )!;
  return drawing.id;
}

describe('deleteImage relationship cleanup fix round 3', () => {
  test('removes orphaned external link relationship without fetch', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const { bodyPart, pkg } = linkedDrawingDocument('rIdExternal', 'https://example.com/x.png');
    const store = new TreePackageStore(pkg, bodyPart);
    const drawingId = drawingIdOf(bodyPart);
    expect(
      relationshipsOf(store.currentPackage(), '/word/document.xml').some(
        (rel) => rel.id === 'rIdExternal'
      )
    ).toBe(true);
    store.deleteImage({ kind: 'body' }, drawingId);
    expect(
      relationshipsOf(store.currentPackage(), '/word/document.xml').some(
        (rel) => rel.id === 'rIdExternal'
      )
    ).toBe(false);
    expect(store.currentPackage().externalTargets).toHaveLength(0);
  });

  test('preserves shared external link when another drawing still references it', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const sharedXml =
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:body><w:p>' +
      '<w:r><w:drawing data-id="a"><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="12700" cy="12700"/><wp:docPr id="1" name="a"/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:link="rIdShared"/></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="12700" cy="12700"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>' +
      '<w:r><w:drawing data-id="b"><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="12700" cy="12700"/><wp:docPr id="2" name="b"/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:link="rIdShared"/></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="12700" cy="12700"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>' +
      '</w:p></w:body></w:document>';
    const bodyPart = readOoxmlPart(sharedXml, {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    if (!bodyPart.ok) throw new Error(bodyPart.reason);
    const loaded = readOoxmlPackage(
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
            `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(sharedXml),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rIdShared" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="https://example.com/shared.png" TargetMode="External"/></Relationships>`
        ),
      })
    );
    if (!loaded.ok) throw new Error(loaded.reason);
    const pkg = Object.freeze({
      ...loaded.package,
      parts: new Map([...loaded.package.parts, ['/word/document.xml', bodyPart.part]]),
      externalTargets: Object.freeze([
        {
          ownerPart: '/word/document.xml',
          id: 'rIdShared',
          type: IMAGE_RELATIONSHIP_TYPE,
          rawTarget: 'https://example.com/shared.png',
          sinkSafe: true,
        },
      ]),
    });
    const store = new TreePackageStore(pkg, bodyPart.part);
    const drawings = bodyPart.part.root.children
      .find((c) => c.kind === 'body')!
      .children.find((c) => c.kind === 'paragraph')!
      .children.flatMap((c) =>
        c.kind === 'run' ? c.children.filter((g) => g.kind === 'drawing') : []
      );
    expect(drawings).toHaveLength(2);
    store.deleteImage({ kind: 'body' }, drawings[0]!.id);
    expect(
      relationshipsOf(store.currentPackage(), '/word/document.xml').some(
        (rel) => rel.id === 'rIdShared'
      )
    ).toBe(true);
    expect(store.currentPackage().externalTargets).toHaveLength(1);
    store.undo();
    expect(
      relationshipsOf(store.currentPackage(), '/word/document.xml').some(
        (rel) => rel.id === 'rIdShared'
      )
    ).toBe(true);
    expect(store.currentPackage().externalTargets).toHaveLength(1);
  });

  test('undo restores embedded media and relationship exactly', async () => {
    const { TreePackageStore } = await import('../store/tree-package-store.ts');
    const pkg = buildPackage({
      media: { 'word/media/image1.png': PNG_1X1 },
      docRels:
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rIdImage" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="media/image1.png"/>` +
        '</Relationships>',
      document:
        `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        '<w:body><w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="12700" cy="12700"/><wp:docPr id="1" name="embed"/>' +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:ext cx="12700" cy="12700"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>',
    });
    const main = pkg.parts.get('/word/document.xml')!;
    const store = new TreePackageStore(pkg, main);
    const drawingId = drawingIdOf(main);
    store.deleteImage({ kind: 'body' }, drawingId);
    expect(partBytesPresent(store.currentPackage(), '/word/media/image1.png')).toBe(false);
    store.undo();
    expect(partBytesPresent(store.currentPackage(), '/word/media/image1.png')).toBe(true);
    expect(
      relationshipsOf(store.currentPackage(), '/word/document.xml').some(
        (rel) => rel.id === 'rIdImage'
      )
    ).toBe(true);
  });
});
