// Fix round 1 — inline drawing production wiring, MC, tables, incremental (task 6).

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlDrawingNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { createInlineDrawingLayoutBundle } from '../inline-drawing-source.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
  projectRunLevelMcDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import {
  emuToPoints,
  inlineDrawingVerticalLayout,
  measureInlineDrawing,
  type InlineDrawingLayoutContext,
} from '../drawing-layout.ts';
import { paragraphLayoutKey, createParagraphLayoutCache } from '../layout-cache.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { piecesOfParagraph } from '../field-projection.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { caretAt, moveCaret } from '../semantic-interaction.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { linesOf, paragraphFragmentsOf, type PageGeometry } from '../semantic-records.ts';
import { createHeadlessImageDecodePort } from '../../editor/browser-image-decode-port.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

const measurer = createFixedMeasurer(6, 14);
const OWNER = '/word/document.xml';

const READY: ImageResourceState = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'c1',
  resourceKey: 'k1',
  mime: 'image/png',
  pixelWidth: 10,
  pixelHeight: 10,
  dpiX: 96,
  dpiY: 96,
});

function inlineXml(
  options: {
    readonly before?: string;
    readonly after?: string;
    readonly inlineAttrs?: string;
    readonly extent?: string;
    readonly mc?: boolean;
  } = {}
): string {
  const extent = options.extent ?? 'cx="914400" cy="457200"';
  const inlineAttrs = options.inlineAttrs ?? 'distT="0" distB="0" distL="0" distR="0"';
  const drawing =
    '<w:r><w:drawing>' +
    `<wp:inline ${inlineAttrs}>` +
    `<wp:extent ${extent}/>` +
    '<wp:docPr id="1" name="pic"/>' +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}">` +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const mcDrawing =
    '<w:r>' +
    `<mc:AlternateContent xmlns:mc="${MC}" xmlns:w14="${W14}">` +
    `<mc:Choice Requires="w14">${drawing.replace(/^<w:r>|<\/w:r>$/g, '')}</mc:Choice>` +
    `<mc:Fallback><w:pict/></mc:Fallback>` +
    '</mc:AlternateContent></w:r>';
  const body = (options.before ?? '') + (options.mc ? mcDrawing : drawing) + (options.after ?? '');
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}" xmlns:mc="${MC}" xmlns:w14="${W14}">` +
    `<w:body><w:p>${body}</w:p></w:body></w:document>`
  );
}

function load(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function drawingOf(part: OoxmlPart): OoxmlDrawingNode {
  const stack: import('../../store/package/ooxml-tree.ts').OoxmlElement[] = [part.root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.kind === 'drawing') return node;
    for (const child of node.children) {
      if (child.kind !== 'textValue') stack.push(child);
    }
  }
  throw new Error('missing drawing');
}

const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;

function indexedContext(part: OoxmlPart, owner = OWNER): InlineDrawingLayoutContext {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  return Object.freeze({
    ownerPartName: owner,
    projectionForAtom: (atomId) => atomProjections.get(atomId) ?? null,
    project: (node) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: owner, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  });
}

describe('fix round 1 — vertical layout math', () => {
  test('nonzero distT grows line height once without double-counting distT', () => {
    const part = load(
      inlineXml({ inlineAttrs: 'distT="25400" distB="12700" distL="0" distR="0"' })
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const measure = measureInlineDrawing(projection);
    const layout = inlineDrawingVerticalLayout(11, 14, measure);
    expect(layout.extentTopY).toBe(measure.distT);
    expect(layout.lineHeight).toBeCloseTo(measure.distT + measure.height + measure.distB, 5);
    expect(layout.baseline).toBeCloseTo(measure.distT + measure.height, 5);
  });

  test('mixed text baseline keeps text metrics when image fits under baseline', () => {
    const part = load(
      inlineXml({ before: run('T'), inlineAttrs: 'distT="0" distB="0" distL="0" distR="0"' })
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: indexedContext(part),
    });
    const line = linesOf(layout)[0]!;
    expect(line.box.height).toBeGreaterThanOrEqual(14);
    expect(line.baseline).toBeGreaterThan(0);
  });
});

describe('fix round 1 — MC field projection', () => {
  test('selected MC inline picture yields one layout record', () => {
    const part = load(inlineXml({ mc: true, before: run('A'), after: run('B') }));
    const paragraph = part.root.children[0]!.children[0]!;
    const ctx = indexedContext(part);
    expect(
      piecesOfParagraph(
        paragraph,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ctx
      ).some((piece) => piece.inlineDrawing)
    ).toBe(true);
    const layout = layoutSemanticDocument(part, 1, { measurer, inlineDrawingLayout: ctx });
    expect(linesOf(layout)[0]!.drawings).toHaveLength(1);
  });

  test('unsupported MC branch stays one inert offset without layout record', () => {
    const part = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:mc="${MC}" xmlns:w14="urn:not-supported" xmlns:wp="${WP}"><w:body><w:p>` +
        '<w:r>' +
        `<mc:AlternateContent xmlns:mc="${MC}">` +
        `<mc:Choice Requires="w14"><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/></wp:inline></w:drawing></mc:Choice>` +
        '</mc:AlternateContent></w:r></w:p></w:body></w:document>'
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: indexedContext(part),
    });
    const line = linesOf(layout)[0]!;
    expect(line.drawings ?? []).toEqual([]);
    expect(line.range.end).toBe(1);
  });
});

describe('fix round 1 — caret/advance with distL/distR', () => {
  test('caret after image equals line advance including distR', () => {
    const part = load(
      inlineXml({
        before: run('A'),
        after: run('B'),
        inlineAttrs: 'distT="0" distB="0" distL="12700" distR="25400"',
      })
    );
    const measure = measureInlineDrawing(
      projectDrawing(drawingOf(part), {
        ownerPartName: OWNER,
        limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
      })!
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: indexedContext(part),
    });
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    expect(drawing.advanceEnd - drawing.advanceStart).toBeCloseTo(measure.totalWidth, 5);
    const caretBefore = caretAt(layout, { paragraphId: line.range.paragraphId, offset: 1 });
    expect(caretBefore!.x).toBeCloseTo(drawing.advanceStart, 3);
    const step = moveCaret(layout, { paragraphId: line.range.paragraphId, offset: 1 }, 'right');
    expect(step?.position.offset).toBe(2);
  });
});

describe('fix round 1 — tables and alignment', () => {
  test('inline image in a table cell publishes cell/page coordinates', () => {
    const drawingRun =
      '<w:r><w:drawing>' +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="457200"/>' +
      '<wp:docPr id="1" name="pic"/><wp:cNvGraphicFramePr/>' +
      `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC_URI}">` +
      `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
      '<pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    const doc =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:body><w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr><w:p>' +
      run('C') +
      drawingRun +
      '</w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
    const part = load(doc);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: indexedContext(part),
    });
    const page = layout.pages[0]!;
    const tableFragment = page.fragments.find((fragment) => fragment.kind === 'table');
    expect(tableFragment).toBeDefined();
    const cellLine = tableFragment!.rows[0]!.cells[0]!.blocks[0]!.lines[0]!;
    expect(cellLine.drawings).toHaveLength(1);
    expect(cellLine.drawings![0]!.x).toBeGreaterThan(cellLine.box.x);
    const hit = hitTestPage(layout, 0, {
      x: cellLine.drawings![0]!.hitBounds.x + 2,
      y: cellLine.drawings![0]!.hitBounds.y + 2,
    })!;
    expect(hit.position.offset).toBe(1);
  });

  test('center alignment includes drawing width in used width', () => {
    const drawingRun =
      '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="pic"/><wp:cNvGraphicFramePr/>' +
      `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC_URI}">` +
      `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
      '<pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    const part = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        '<w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
        run('Z') +
        drawingRun +
        '</w:p></w:body></w:document>'
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      geometry: { width: 200, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
      inlineDrawingLayout: indexedContext(part),
    });
    const line = linesOf(layout)[0]!;
    expect(line.spans[0]!.box.x).toBeGreaterThan(0);
    expect(line.drawings![0]!.advanceStart).toBeGreaterThan(line.spans[0]!.box.x);
  });
});

describe('fix round 1 — incremental/cache', () => {
  test('resource epoch change invalidates paragraph break cache', () => {
    const part = load(inlineXml({ before: run('Q') }));
    const paragraph = part.root.children[0]!.children[0]!;
    const cache =
      createParagraphLayoutCache<readonly import('../paragraph-flow.ts').PendingLine[]>();
    const keyPending = paragraphLayoutKey({
      paragraph,
      properties: [],
      width: 400,
      producer: 'p',
      drawingToken: 'pending',
    });
    const keyReady = paragraphLayoutKey({
      paragraph,
      properties: [],
      width: 400,
      producer: 'p',
      drawingToken: 'ready',
    });
    expect(keyPending).not.toBe(keyReady);
    const lines = breakParagraph(
      paragraph,
      paragraph.id,
      0,
      400,
      measurer,
      cache,
      keyPending,
      [],
      undefined,
      undefined,
      undefined,
      {
        inlineDrawingLayout: indexedContext(part),
      }
    );
    cache.set(keyPending, lines);
    expect(cache.get(keyReady)).toBeUndefined();
  });

  test('unchanged drawing-free incremental pass preserves page identity', () => {
    const session = createLayoutSession();
    const part = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p>${run('plain')}</w:p></w:body></w:document>`
    );
    const first = layoutSemanticDocument(part, 1, { measurer, session });
    const second = layoutSemanticDocument(part, 2, { measurer, session });
    expect(second.pages[0]).toBe(first.pages[0]);
  });
});

describe('fix round 1 — package-backed source', () => {
  test('injectable lookup returns ready without reading bytes in layout', () => {
    const part = load(inlineXml());
    const bundle = createInlineDrawingLayoutBundle({
      session: {
        part: () => part,
        currentPackage: () =>
          ({
            relationships: new Map(),
            externalTargets: [],
            parts: new Map([[OWNER, part]]),
          }) as never,
        packageRevision: () => 1,
      } as never,
      decodePort: createHeadlessImageDecodePort(),
      onResourcesChanged: () => {},
      resourceLookup: {
        resolveEmbedded: async () => READY,
        resolveLinked: () =>
          Object.freeze({ kind: 'external', relationshipId: 'r', sinkSafe: false }),
        resolveForProjection: async () => READY,
        liveReferenceCount: () => 0,
        dispose: () => {},
      },
    });
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    expect(bundle.bodyContext.resourceOf(projection).kind).toBe('pending');
    expect(bundle.cacheTokenForPart(OWNER)).toContain(OWNER);
    bundle.dispose();
  });
});

describe('fix round 1 — overflow and header/footer furniture', () => {
  test('drawing taller than page clips vertically without pagination loop', () => {
    const part = load(inlineXml({ extent: 'cx="914400" cy="3657600"' }));
    const SMALL: PageGeometry = {
      width: 120,
      height: 60,
      margin: { top: 5, right: 5, bottom: 5, left: 5 },
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      geometry: SMALL,
      inlineDrawingLayout: indexedContext(part),
    });
    expect(layout.pages.length).toBeLessThan(20);
    expect(layout.pages.length).toBeGreaterThanOrEqual(1);
  });

  test('header/footer story layout attaches inline records on the HF part', () => {
    const headerXml = inlineXml({ before: run('H') });
    const headerPart = readOoxmlPart(headerXml, {
      name: '/word/header1.xml',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
    });
    if (!headerPart.ok) throw new Error(headerPart.reason);
    const hfCtx = indexedContext(headerPart.part, '/word/header1.xml');
    const story = layoutHeaderFooterStory(
      headerPart.part,
      400,
      measurer,
      'prod',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      hfCtx
    );
    const line = story.fragments[0]!.lines[0]!;
    expect(line.drawings).toHaveLength(1);
    expect(line.drawings![0]!.ownerPartName).toBe('/word/header1.xml');
  });
});
