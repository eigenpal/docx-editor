// A chart in `mc:AlternateContent` that shows its saved fallback picture: picture edits on the
// fallback refuse, a delete removes the chart and its fallback together, a hidden chart stays
// hidden whatever its fallback shows, and every chart drawing carries its summary.

import { afterEach, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { indexInlineDrawingProjectionsInPart } from '../package/drawing-projection.ts';
import { packageDrawingProjectionContext } from '../package/drawing-projection-context.ts';
import { drawingRenderers, installDrawingRenderers } from '../package/drawing-renderers.ts';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import { serializeOoxmlPart, type OoxmlPart } from '../package/ooxml-tree.ts';
import { applyTreeOp, validateTreeOp } from '../store/tree-ops.ts';
import type { TreeDocOp } from '../store/tree-op-types.ts';
import { chartexDocx, chartexPackage, waterfallChartSpace } from './chartex-fixture.ts';

const before = drawingRenderers();
afterEach(() => installDrawingRenderers({ chart: before.chart }));

/** A renderer that draws any chart as one empty vector shape. */
function installStubChartRenderer(): void {
  installDrawingRenderers({
    chart: (_anchor, extent) => ({
      vectorShape: {
        extentEmu: { cx: extent.cx, cy: extent.cy },
        subpathsEmu: [],
        fillHex: null,
        strokeHex: null,
        strokeWidthEmu: 0,
        components: [
          {
            subpathsEmu: [
              [
                { x: 0, y: 0 },
                { x: extent.cx, y: 0 },
                { x: 0, y: extent.cy },
              ],
            ],
            fillHex: 'FF0000',
            fillAlpha: 1,
            strokeHex: null,
            strokeAlpha: 1,
            strokeWidthEmu: 0,
          },
        ],
      },
      groupTextboxes: null,
    }),
  });
}

function wrappedChart(): { part: OoxmlPart; atomId: string; fallbackId: string } {
  const pkg = chartexPackage(waterfallChartSpace({ title: 'Net' }), { alternateContent: true });
  const part = pkg.parts.get('/word/document.xml')!;
  const [[atomId, projection]] = [...indexInlineDrawingProjectionsInPart(part).entries()];
  return { part, atomId: atomId!, fallbackId: projection!.drawingNodeId };
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

test('every picture edit on a chart fallback refuses, by wrapper or fallback id', () => {
  const { part, atomId, fallbackId } = wrappedChart();
  expect(fallbackId).not.toBe(atomId);
  for (const id of [atomId, fallbackId]) {
    for (const op of editsFor(id)) {
      expect([op.op, validateTreeOp(part, op)]).toEqual([op.op, 'chart-fallback']);
      const result = applyTreeOp(part, op);
      expect(result.ok ? null : result.reason).toBe('chart-fallback');
    }
  }
});

test('deleting a chart fallback removes the chart and its fallback together', () => {
  const { part, atomId, fallbackId } = wrappedChart();
  for (const id of [atomId, fallbackId]) {
    expect(validateTreeOp(part, { op: 'deleteDrawing', drawingNodeId: id })).toBeNull();
    const result = applyTreeOp(part, { op: 'deleteDrawing', drawingNodeId: id });
    if (!result.ok) throw new Error(result.reason);
    const xml = String(serializeOoxmlPart(result.part));
    expect(xml).not.toContain('AlternateContent');
    expect(xml).not.toContain('cx:chart');
    expect(xml).not.toContain('rId11');
    expect(result.effect.deleted).toEqual([atomId]);
  }
});

test('a rendered chart keeps its own refusal; it is not a fallback', () => {
  installStubChartRenderer();
  const pkg = chartexPackage(waterfallChartSpace(), { alternateContent: true });
  const part = pkg.parts.get('/word/document.xml')!;
  const index = indexInlineDrawingProjectionsInPart(
    part,
    packageDrawingProjectionContext(pkg, part.name)
  );
  const [[atomId, projection]] = [...index.entries()];
  expect(projection!.vectorShape).not.toBeNull();
  expect(projection!.chartSummary?.plotTypes).toEqual(['waterfall']);
  // A drawn chart is no picture, so picture edits refuse as for any other chart.
  for (const op of editsFor(atomId!)) {
    expect(validateTreeOp(part, op)).not.toBe('chart-fallback');
    expect(validateTreeOp(part, op)).not.toBeNull();
  }
});

test('a projection that asks for undrawn charts shows the fallback with the summary', () => {
  installStubChartRenderer();
  const pkg = chartexPackage(waterfallChartSpace({ title: 'Net' }), { alternateContent: true });
  const part = pkg.parts.get('/word/document.xml')!;
  const [projection] = indexInlineDrawingProjectionsInPart(
    part,
    packageDrawingProjectionContext(pkg, part.name, { drawCharts: false })
  ).values();
  expect(projection!.vectorShape).toBeNull();
  expect(projection!.picture?.embeddedRelationshipId).toBe('rId11');
  expect(projection!.chartSummary).toEqual({ title: 'Net', plotTypes: ['waterfall'] });
});

test('a hidden chart stays hidden when its fallback picture is visible', () => {
  const files = unzipSync(chartexDocx(waterfallChartSpace(), { alternateContent: true }));
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']!).replace(
      '<wp:docPr id="1" name="Chart 1"/>',
      '<wp:docPr id="1" name="Chart 1" hidden="1"/>'
    )
  );
  const loaded = readOoxmlPackage(zipSync(files));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get('/word/document.xml')!;
  const [projection] = indexInlineDrawingProjectionsInPart(
    part,
    packageDrawingProjectionContext(loaded.package, part.name)
  ).values();
  expect(projection!.hidden).toBe(true);
  expect(projection!.picture).toBeNull();
  expect(projection!.docPrId).toBe(1);
});
