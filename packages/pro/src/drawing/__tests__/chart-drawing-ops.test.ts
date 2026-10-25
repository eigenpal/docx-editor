/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// With the drawing module installed, a wrapped chart draws, and the store still treats it as
// a chart: picture edits refuse with `chart-drawing` on the wrapper, the drawn Choice and the
// saved fallback, and a delete removes the wrapper with both branches. The drawn chart keeps
// the picture saved in its fallback for an output that exports it.

import { expect, test } from 'bun:test';
import { indexInlineDrawingProjectionsInPart } from '../../../../core/src/store/package/drawing-projection.ts';
import { packageDrawingProjectionContext } from '../../../../core/src/store/package/drawing-projection-context.ts';
import {
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../../../../core/src/store/package/ooxml-tree.ts';
import { applyTreeOp, validateTreeOp } from '../../../../core/src/store/store/tree-ops.ts';
import type { TreeDocOp } from '../../../../core/src/store/store/tree-op-types.ts';
import {
  chartexPackage,
  classicBarChartSpace,
  waterfallChartSpace,
} from '../../../../core/src/store/__tests__/chartex-fixture.ts';
import { installDrawing } from '../index.ts';

installDrawing();

function drawnChart(classic: boolean) {
  const pkg = chartexPackage(
    classic ? classicBarChartSpace('Net') : waterfallChartSpace({ title: 'Net' }),
    { classic, alternateContent: true }
  );
  const part = pkg.parts.get('/word/document.xml')!;
  const [[atomId, projection]] = [
    ...indexInlineDrawingProjectionsInPart(
      part,
      packageDrawingProjectionContext(pkg, part.name)
    ).entries(),
  ];
  return { part, atomId: atomId!, projection: projection! };
}

function branchIds(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'Choice' || node.localName === 'Fallback') {
      for (const child of node.children) if (child.kind !== 'textValue') ids.push(child.id);
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return ids;
}

function editsFor(drawingNodeId: string): readonly TreeDocOp[] {
  return [
    { op: 'resizeDrawing', drawingNodeId, extentEmu: { cx: 914400, cy: 457200 } },
    { op: 'cropDrawing', drawingNodeId, crop: { left: 1000, top: 0, right: 0, bottom: 0 } },
    {
      op: 'positionDrawing',
      drawingNodeId,
      position: { mode: 'simple', horizontalEmu: 0, verticalEmu: 0 },
    },
    { op: 'setDrawingWrap', drawingNodeId, wrap: 'square' },
    { op: 'replaceDrawingResource', drawingNodeId, relationshipId: 'rId1' },
    { op: 'setDrawingMetadata', drawingNodeId, title: 'T', description: 'D' },
    { op: 'setDrawingLocks', drawingNodeId, locks: { resize: true } },
    { op: 'transformDrawing', drawingNodeId, action: 'rotateCW' },
  ];
}

for (const classic of [false, true]) {
  test(`${classic ? 'classic' : 'chartex'}: a drawn wrapped chart is a chart to the store`, () => {
    const { part, atomId, projection } = drawnChart(classic);
    expect(projection.vectorShape).not.toBeNull();
    expect(projection.picture).toBeNull();
    expect(projection.chartSummary).toEqual({
      title: 'Net',
      plotTypes: [classic ? 'bar' : 'waterfall'],
      shownAs: 'chart',
    });
    expect(projection.chartFallbackPicture?.embeddedRelationshipId).toBe('rId11');
    const ids = [atomId, projection.drawingNodeId, ...branchIds(part)];
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      for (const op of editsFor(id)) {
        expect([op.op, validateTreeOp(part, op)]).toEqual([op.op, 'chart-drawing']);
      }
      const result = applyTreeOp(part, { op: 'deleteDrawing', drawingNodeId: id });
      if (!result.ok) throw new Error(result.reason);
      const xml = String(serializeOoxmlPart(result.part));
      expect(xml).not.toContain('AlternateContent');
      expect(xml).not.toContain('w:drawing');
      expect(result.effect.deleted).toEqual([atomId]);
    }
  });
}
