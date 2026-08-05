import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  validateOoxmlPart,
  type OoxmlAttribute,
  type OoxmlDrawingNode,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { ST_POSITION_OFFSET_MAX, ST_POSITION_OFFSET_MIN } from '../package/ooxml-drawing-rules.ts';
import { IMAGE_WRAP_TARGETS, type ImageWrapTarget } from '../package/drawing-projection.ts';
import { applyTreeOp, validateTreeOp, type TreeDocOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parse(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, metadata);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  return result.part;
}

function refuse(part: OoxmlPart, op: TreeDocOp): string {
  const validation = validateTreeOp(part, op);
  if (validation) return validation;
  const result = applyTreeOp(part, op);
  if (result.ok) throw new Error('expected rejection');
  return result.reason;
}

function findDrawing(node: OoxmlNode): OoxmlDrawingNode | null {
  if (node.kind === 'drawing') return node;
  if (node.kind === 'textValue') return null;
  for (const child of node.children) {
    const found = findDrawing(child);
    if (found) return found;
  }
  return null;
}

function anchorOf(part: OoxmlPart): OoxmlElement {
  return findDrawing(part.root)!.children[0] as OoxmlElement;
}

function wrapChild(anchor: OoxmlElement): OoxmlElement | undefined {
  return anchor.children.find(
    (c) =>
      c.kind !== 'textValue' &&
      (String(c.kind).startsWith('drawingWrap') ||
        (c.namespaceUri === WP && String(c.localName).startsWith('wrap')))
  ) as OoxmlElement | undefined;
}

function schemaAttrNames(element: OoxmlElement): string[] {
  return element.attributes
    .filter((a) => a.namespaceUri === '')
    .map((a) => a.localName)
    .sort();
}

function schemaAttrValue(element: OoxmlElement, localName: string): string | undefined {
  return element.attributes.find((a) => a.namespaceUri === '' && a.localName === localName)?.value;
}

function foreignAttrs(element: OoxmlElement): readonly OoxmlAttribute[] {
  return element.attributes.filter((a) => a.namespaceUri !== '');
}

function anchoredWithWrap(wrapXml: string): string {
  return (
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" relativeHeight="251658240" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="457200"/>' +
    wrapXml +
    '<wp:docPr id="2" name="float"/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function assertWrapXsdShape(wrap: OoxmlElement, target: ImageWrapTarget): void {
  const names = schemaAttrNames(wrap);
  switch (target) {
    case 'inline':
    case 'behind':
    case 'inFront':
      expect(wrap.localName).toBe('wrapNone');
      expect(names).toEqual([]);
      expect(wrap.children.some((c) => c.localName === 'wrapPolygon')).toBe(false);
      expect(wrap.children.some((c) => c.localName === 'effectExtent')).toBe(false);
      break;
    case 'square':
    case 'squareLeft':
    case 'squareRight':
      expect(wrap.localName).toBe('wrapSquare');
      expect(names.sort()).toEqual(['distB', 'distL', 'distR', 'distT', 'wrapText'].sort());
      expect(wrap.children.some((c) => c.localName === 'wrapPolygon')).toBe(false);
      break;
    case 'tight':
    case 'through':
      expect(['wrapTight', 'wrapThrough']).toContain(wrap.localName);
      expect(names.sort()).toEqual(['distL', 'distR', 'wrapText'].sort());
      expect(wrap.children.some((c) => c.localName === 'wrapPolygon')).toBe(true);
      expect(wrap.children.some((c) => c.localName === 'effectExtent')).toBe(false);
      break;
    case 'topAndBottom':
      expect(wrap.localName).toBe('wrapTopAndBottom');
      expect(names.sort()).toEqual(['distB', 'distT'].sort());
      expect(schemaAttrValue(wrap, 'wrapText')).toBeUndefined();
      expect(wrap.children.some((c) => c.localName === 'wrapPolygon')).toBe(false);
      break;
    default: {
      const _exhaustive: never = target;
      void _exhaustive;
    }
  }
}

describe('task 11 fix round 2 — wrap XSD attribute shapes', () => {
  test.each(IMAGE_WRAP_TARGETS.filter((t) => t !== 'inline'))(
    '%s emits only schema-legal wrap attributes',
    (target) => {
      const part = parse(
        anchoredWithWrap(
          '<wp:wrapSquare wrapText="bothSides" distT="11" distB="22" distL="33" distR="44"/>'
        )
      );
      const drawing = findDrawing(part.root)!;
      const next = apply(part, { op: 'setDrawingWrap', drawingNodeId: drawing.id, wrap: target });
      const wrap = wrapChild(anchorOf(next))!;
      assertWrapXsdShape(wrap, target);
    }
  );

  test('preserves foreign namespaced wrap attributes across conversion', () => {
    const part = parse(
      anchoredWithWrap(
        '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4" wp:custom="keep"/>'
      )
    );
    const drawing = findDrawing(part.root)!;
    const next = apply(part, {
      op: 'setDrawingWrap',
      drawingNodeId: drawing.id,
      wrap: 'squareLeft',
    });
    const wrap = wrapChild(anchorOf(next))!;
    expect(foreignAttrs(wrap).some((a) => a.localName === 'custom' && a.value === 'keep')).toBe(
      true
    );
    assertWrapXsdShape(wrap, 'squareLeft');
  });

  test('square→tight preserves distL/distR and drops distT/distB/wrapText side attrs', () => {
    const part = parse(
      anchoredWithWrap(
        '<wp:wrapSquare wrapText="left" distT="10" distB="20" distL="30" distR="40"/>'
      )
    );
    const drawing = findDrawing(part.root)!;
    const next = apply(part, { op: 'setDrawingWrap', drawingNodeId: drawing.id, wrap: 'tight' });
    const wrap = wrapChild(anchorOf(next))!;
    expect(schemaAttrValue(wrap, 'distL')).toBe('30');
    expect(schemaAttrValue(wrap, 'distR')).toBe('40');
    expect(schemaAttrValue(wrap, 'distT')).toBeUndefined();
    expect(schemaAttrValue(wrap, 'distB')).toBeUndefined();
    expect(schemaAttrValue(wrap, 'wrapText')).toBe('bothSides');
    assertWrapXsdShape(wrap, 'tight');
  });

  test('tight→topAndBottom preserves distT/distB from prior illegal attrs as zero defaults', () => {
    const part = parse(
      anchoredWithWrap(
        '<wp:wrapTight wrapText="bothSides" distL="5" distR="6"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="1" y="0"/><wp:lineTo x="1" y="1"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapTight>'
      )
    );
    const drawing = findDrawing(part.root)!;
    const next = apply(part, {
      op: 'setDrawingWrap',
      drawingNodeId: drawing.id,
      wrap: 'topAndBottom',
    });
    const wrap = wrapChild(anchorOf(next))!;
    expect(schemaAttrValue(wrap, 'distT')).toBe('0');
    expect(schemaAttrValue(wrap, 'distB')).toBe('0');
    assertWrapXsdShape(wrap, 'topAndBottom');
  });

  test('behind uses wrapNone with no distance attributes', () => {
    const part = parse(
      anchoredWithWrap('<wp:wrapSquare wrapText="right" distT="1" distB="2" distL="3" distR="4"/>')
    );
    const drawing = findDrawing(part.root)!;
    const next = apply(part, { op: 'setDrawingWrap', drawingNodeId: drawing.id, wrap: 'behind' });
    const wrap = wrapChild(anchorOf(next))!;
    assertWrapXsdShape(wrap, 'behind');
    expect(schemaAttributeValue(anchorOf(next), 'behindDoc')).toBe('1');
  });
});

function schemaAttributeValue(element: OoxmlElement, localName: string): string | undefined {
  return element.attributes.find((a) => a.namespaceUri === '' && a.localName === localName)?.value;
}

describe('task 11 fix round 2 — position offset int32 validation', () => {
  test('accepts boundary ST_PositionOffset values', () => {
    const part = parse(anchoredWithWrap('<wp:wrapSquare wrapText="bothSides"/>'));
    const drawing = findDrawing(part.root)!;
    for (const offset of [ST_POSITION_OFFSET_MIN, ST_POSITION_OFFSET_MAX, 0, -1, 1]) {
      const next = apply(part, {
        op: 'positionDrawing',
        drawingNodeId: drawing.id,
        position: { horizontalEmu: offset, relativeToH: 'column' },
      });
      const posH = anchorOf(next).children.find(
        (c) => c.kind === 'drawingPositionH'
      ) as OoxmlElement;
      const posOffset = posH.children.find((c) => c.localName === 'posOffset') as OoxmlElement;
      const text = posOffset.children.find((c) => c.kind === 'textValue')!;
      expect((text as { value: string }).value).toBe(String(offset));
    }
  });

  test('rejects one-past-max and non-integer offsets before mutation', () => {
    const part = parse(anchoredWithWrap('<wp:wrapSquare wrapText="bothSides"/>'));
    const drawing = findDrawing(part.root)!;
    const beforeFp = canonicalOoxmlFingerprint(anchorOf(part));
    expect(
      refuse(part, {
        op: 'positionDrawing',
        drawingNodeId: drawing.id,
        position: { horizontalEmu: ST_POSITION_OFFSET_MAX + 1 },
      })
    ).toBe('invalid-drawing-value');
    expect(
      refuse(part, {
        op: 'positionDrawing',
        drawingNodeId: drawing.id,
        position: { verticalEmu: ST_POSITION_OFFSET_MIN - 1 },
      })
    ).toBe('invalid-drawing-value');
    expect(
      refuse(part, {
        op: 'positionDrawing',
        drawingNodeId: drawing.id,
        position: { horizontalEmu: 1.5 },
      })
    ).toBe('invalid-drawing-value');
    expect(canonicalOoxmlFingerprint(anchorOf(part))).toBe(beforeFp);
  });
});

describe('task 11 fix round 2 — graphic frame locks', () => {
  test('creates cNvGraphicFramePr in schema order when absent', () => {
    const part = parse(
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
        '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="457200"/>' +
        '<wp:docPr id="1" name="pic"/>' +
        `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
    );
    const drawing = findDrawing(part.root)!;
    const beforeFp = canonicalOoxmlFingerprint(findDrawing(part.root)!);
    const next = apply(part, {
      op: 'setDrawingLocks',
      drawingNodeId: drawing.id,
      locks: { move: true },
    });
    expect(canonicalOoxmlFingerprint(findDrawing(next.root)!)).not.toBe(beforeFp);
    const anchor = anchorOf(next);
    const docPrIndex = anchor.children.findIndex((c) => c.localName === 'docPr');
    const frameIndex = anchor.children.findIndex((c) => c.localName === 'cNvGraphicFramePr');
    const graphicIndex = anchor.children.findIndex((c) => c.localName === 'graphic');
    expect(frameIndex).toBeGreaterThan(docPrIndex);
    expect(frameIndex).toBeLessThan(graphicIndex);
    const framePr = anchor.children[frameIndex] as OoxmlElement;
    expect(framePr.localName).toBe('cNvGraphicFramePr');
    const locks = framePr.children.find((c) => c.localName === 'graphicFrameLocks') as OoxmlElement;
    expect(locks.attributes.find((a) => a.localName === 'noMove')?.value).toBe('1');
  });

  test('preserves wrapper attrs, unknown lock attrs, namespace attrs, and ext children on partial update', () => {
    const part = parse(
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
        '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="457200"/>' +
        '<wp:docPr id="1" name="pic"/>' +
        '<wp:cNvGraphicFramePr wp:custom="keep">' +
        '<a:graphicFrameLocks noGrp="1" noResize="0"/>' +
        '<a:extLst><a:ext uri="{00000000-0000-0000-0000-000000000001}"/></a:extLst>' +
        '</wp:cNvGraphicFramePr>' +
        `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
    );
    const drawing = findDrawing(part.root)!;
    const frameBefore = anchorOf(part).children.find(
      (c) => c.localName === 'cNvGraphicFramePr'
    ) as OoxmlElement;
    const extBefore = canonicalOoxmlFingerprint(
      frameBefore.children.find((c) => c.localName === 'extLst') as OoxmlElement
    );
    const next = apply(part, {
      op: 'setDrawingLocks',
      drawingNodeId: drawing.id,
      locks: { resize: true },
    });
    const frameAfter = anchorOf(next).children.find(
      (c) => c.localName === 'cNvGraphicFramePr'
    ) as OoxmlElement;
    expect(frameAfter.attributes.some((a) => a.localName === 'custom' && a.value === 'keep')).toBe(
      true
    );
    const locks = frameAfter.children.find(
      (c) => c.localName === 'graphicFrameLocks'
    ) as OoxmlElement;
    expect(locks.attributes.find((a) => a.localName === 'noGrp')?.value).toBe('1');
    expect(locks.attributes.find((a) => a.localName === 'noResize')?.value).toBe('1');
    const extAfter = frameAfter.children.find((c) => c.localName === 'extLst') as OoxmlElement;
    expect(canonicalOoxmlFingerprint(extAfter)).toBe(extBefore);
  });

  test('clearing managed locks keeps graphicFrameLocks when unknown attrs remain', () => {
    const part = parse(
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
        '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="457200"/>' +
        '<wp:docPr id="1" name="pic"/>' +
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks noMove="1" noGrp="1"/></wp:cNvGraphicFramePr>' +
        `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
    );
    const drawing = findDrawing(part.root)!;
    const next = apply(part, {
      op: 'setDrawingLocks',
      drawingNodeId: drawing.id,
      locks: { move: false },
    });
    const framePr = anchorOf(next).children.find(
      (c) => c.localName === 'cNvGraphicFramePr'
    ) as OoxmlElement;
    const locks = framePr.children.find((c) => c.localName === 'graphicFrameLocks') as OoxmlElement;
    expect(locks).toBeDefined();
    expect(locks.attributes.find((a) => a.localName === 'noMove')).toBeUndefined();
    expect(locks.attributes.find((a) => a.localName === 'noGrp')?.value).toBe('1');
  });

  function inlinePictureBody(anchorOpen: string, framePr = ''): string {
    return (
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
      `${anchorOpen}<wp:extent cx="914400" cy="457200"/>` +
      '<wp:docPr id="1" name="pic"/>' +
      framePr +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
    );
  }

  function anchoredPictureBody(lockedAttr: string, framePr = ''): string {
    return (
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
      `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" ${lockedAttr} relativeHeight="251658240" layoutInCell="1" allowOverlap="1">` +
      '<wp:simplePos x="0" y="0"/>' +
      '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>' +
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="914400" cy="457200"/>' +
      '<wp:wrapNone/>' +
      '<wp:docPr id="2" name="float"/>' +
      framePr +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic>' +
      '</wp:anchor></w:drawing></w:r></w:p></w:body></w:document>'
    );
  }

  function frameLocksOf(part: OoxmlPart): OoxmlElement | undefined {
    const framePr = anchorOf(part).children.find((c) => c.localName === 'cNvGraphicFramePr') as
      | OoxmlElement
      | undefined;
    return framePr?.children.find((c) => c.localName === 'graphicFrameLocks') as
      | OoxmlElement
      | undefined;
  }

  function managedLock(locks: OoxmlElement | undefined, localName: string): boolean | undefined {
    const value = locks?.attributes.find(
      (a) => a.localName === localName && a.namespaceUri === ''
    )?.value;
    if (value === undefined) return undefined;
    if (value === '1' || value === 'true') return true;
    if (value === '0' || value === 'false') return false;
    return undefined;
  }

  test('partial update from aggregate locked="1" materializes unspecified effective locks', () => {
    const part = parse(
      inlinePictureBody('<wp:inline distT="0" distB="0" distL="0" distR="0" locked="1">')
    );
    const drawing = findDrawing(part.root)!;
    const next = apply(part, {
      op: 'setDrawingLocks',
      drawingNodeId: drawing.id,
      locks: { move: false },
    });
    const anchor = anchorOf(next);
    expect(schemaAttrValue(anchor, 'locked')).toBe('0');
    const locks = frameLocksOf(next)!;
    expect(managedLock(locks, 'noMove')).toBeUndefined();
    expect(managedLock(locks, 'noSelect')).toBe(true);
    expect(managedLock(locks, 'noResize')).toBe(true);
    expect(managedLock(locks, 'noChangeAspect')).toBe(true);
  });

  test('partial update from aggregate locked="true" on anchored drawing materializes effective locks', () => {
    const part = parse(anchoredPictureBody('locked="true"'));
    const drawing = findDrawing(part.root)!;
    const next = apply(part, {
      op: 'setDrawingLocks',
      drawingNodeId: drawing.id,
      locks: { resize: false },
    });
    expect(schemaAttrValue(anchorOf(next), 'locked')).toBe('0');
    const locks = frameLocksOf(next)!;
    expect(managedLock(locks, 'noResize')).toBeUndefined();
    expect(managedLock(locks, 'noSelect')).toBe(true);
    expect(managedLock(locks, 'noMove')).toBe(true);
    expect(managedLock(locks, 'noChangeAspect')).toBe(true);
  });

  test.each([
    ['select', 'noSelect'],
    ['move', 'noMove'],
    ['resize', 'noResize'],
    ['changeAspect', 'noChangeAspect'],
  ] as const)(
    'aggregate locked partial clear of %s preserves other effective locks',
    (field, attr) => {
      const part = parse(
        inlinePictureBody('<wp:inline distT="0" distB="0" distL="0" distR="0" locked="1">')
      );
      const drawing = findDrawing(part.root)!;
      const next = apply(part, {
        op: 'setDrawingLocks',
        drawingNodeId: drawing.id,
        locks: { [field]: false },
      });
      const locks = frameLocksOf(next)!;
      expect(managedLock(locks, attr)).toBeUndefined();
      for (const [otherField, otherAttr] of [
        ['select', 'noSelect'],
        ['move', 'noMove'],
        ['resize', 'noResize'],
        ['changeAspect', 'noChangeAspect'],
      ] as const) {
        if (otherField === field) continue;
        expect(managedLock(locks, otherAttr)).toBe(true);
      }
    }
  );

  test('aggregate locked with mixed explicit overrides materializes effective locks on partial update', () => {
    const part = parse(
      inlinePictureBody(
        '<wp:inline distT="0" distB="0" distL="0" distR="0" locked="1">',
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks noResize="0" noGrp="1"/></wp:cNvGraphicFramePr>'
      )
    );
    const drawing = findDrawing(part.root)!;
    const next = apply(part, {
      op: 'setDrawingLocks',
      drawingNodeId: drawing.id,
      locks: { move: false },
    });
    const locks = frameLocksOf(next)!;
    expect(managedLock(locks, 'noMove')).toBeUndefined();
    expect(managedLock(locks, 'noSelect')).toBe(true);
    expect(managedLock(locks, 'noResize')).toBe(true);
    expect(managedLock(locks, 'noChangeAspect')).toBe(true);
    expect(locks.attributes.find((a) => a.localName === 'noGrp')?.value).toBe('1');
  });

  test('aggregate locked two-field partial update materializes remaining effective locks', () => {
    const part = parse(
      inlinePictureBody('<wp:inline distT="0" distB="0" distL="0" distR="0" locked="1">')
    );
    const drawing = findDrawing(part.root)!;
    const next = apply(part, {
      op: 'setDrawingLocks',
      drawingNodeId: drawing.id,
      locks: { select: false, move: false },
    });
    const locks = frameLocksOf(next)!;
    expect(managedLock(locks, 'noSelect')).toBeUndefined();
    expect(managedLock(locks, 'noMove')).toBeUndefined();
    expect(managedLock(locks, 'noResize')).toBe(true);
    expect(managedLock(locks, 'noChangeAspect')).toBe(true);
  });

  test('aggregate locked partial update preserves OOXML boolean strings on unchanged materialized attrs', () => {
    const part = parse(
      inlinePictureBody(
        '<wp:inline distT="0" distB="0" distL="0" distR="0" locked="1">',
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks noSelect="true" noChangeAspect="false"/></wp:cNvGraphicFramePr>'
      )
    );
    const drawing = findDrawing(part.root)!;
    const next = apply(part, {
      op: 'setDrawingLocks',
      drawingNodeId: drawing.id,
      locks: { move: false },
    });
    const locks = frameLocksOf(next)!;
    expect(locks.attributes.find((a) => a.localName === 'noSelect')?.value).toBe('true');
    expect(locks.attributes.find((a) => a.localName === 'noChangeAspect')?.value).toBe('1');
    expect(locks.attributes.find((a) => a.localName === 'noResize')?.value).toBe('1');
  });

  test('lock roundtrip preserves unrelated anchor content', () => {
    const xml =
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
      '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="457200"/>' +
      '<wp:docPr id="1" name="pic" descr="keep"/>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
    const part = parse(xml);
    const drawing = findDrawing(part.root)!;
    const docPrBefore = anchorOf(part).children.find(
      (c) => c.localName === 'docPr'
    ) as OoxmlElement;
    const docPrFp = canonicalOoxmlFingerprint(docPrBefore);
    const locked = apply(part, {
      op: 'setDrawingLocks',
      drawingNodeId: drawing.id,
      locks: { select: true, move: true, resize: true, changeAspect: true },
    });
    const cleared = apply(locked, {
      op: 'setDrawingLocks',
      drawingNodeId: drawing.id,
      locks: { select: false, move: false, resize: false, changeAspect: false },
    });
    const docPrAfter = anchorOf(cleared).children.find(
      (c) => c.localName === 'docPr'
    ) as OoxmlElement;
    expect(canonicalOoxmlFingerprint(docPrAfter)).toBe(docPrFp);
    expect(anchorOf(cleared).children.some((c) => c.localName === 'cNvGraphicFramePr')).toBe(true);
  });
});
