/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Receiving edits in a document with many shapes stays incremental. The shape singleton rule
// runs on each replica for every shape property element it shows, so a keystroke, and a fill
// change on one shape, must not send the receiver through a full pass over every shape.

import { afterEach, describe, expect, test } from 'bun:test';
import { materializedPassCounts } from '../document/materialize.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';

const harness = createPeerHarness('remote-receive-shapes-cost');
afterEach(() => harness.cleanup());

const NS =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
const SHAPES = 200;

const shape = (id: number) =>
  `<w:drawing ${NS}><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ` +
  `relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset>' +
  '</wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
  `<wp:docPr id="${id}" name="Shape ${id}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData ` +
  'uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/>' +
  '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom ' +
  'prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="75000"/>' +
  '</a:schemeClr></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill>' +
  '<a:prstDash val="dash"/><a:round/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData>' +
  '</a:graphic></wp:anchor></w:drawing>';

const body = () =>
  '<w:p><w:r><w:t>Typing paragraph at the top</w:t></w:r></w:p>' +
  Array.from(
    { length: SHAPES },
    (_, index) => `<w:p><w:r>${shape(index + 1)}<w:t>Anchor ${index}</w:t></w:r></w:p>`
  ).join('') +
  '<w:sectPr/>';

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;

describe('receiving edits beside many shapes', () => {
  test('a remote keystroke stays incremental', async () => {
    const { alice, bob } = await harness.pair(zipDocument(body()));
    const type = (): void =>
      harness.apply(alice, [
        { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 2, text: 'x' },
      ]);
    type();
    const full: number[] = [];
    const times: number[] = [];
    for (let at = 0; at < 15; at += 1) {
      const before = materializedPassCounts().full;
      const started = performance.now();
      type();
      times.push(performance.now() - started);
      full.push(materializedPassCounts().full - before);
    }
    console.log(`[shapes-cost] keystroke round trip median ${median(times).toFixed(3)} ms`);
    expect(full.every((count) => count === 0)).toBe(true);
    harness.expectConverged(alice, bob);
  });

  test('a remote fill change on one shape stays incremental', async () => {
    const { alice, bob } = await harness.pair(zipDocument(body()));
    const drawingIds = (): string[] => {
      const ids: string[] = [];
      const walk = (node: {
        kind: string;
        localName?: string;
        id: string;
        children?: unknown[];
      }) => {
        if (node.kind !== 'textValue' && node.localName === 'drawing') ids.push(node.id);
        for (const child of (node.children ?? []) as (typeof node)[]) walk(child);
      };
      const part = harness.packageOf(alice).parts.get('/word/document.xml')!;
      walk(part.root as never);
      return ids;
    };
    const ids = drawingIds();
    const colors = ['FF0000', '00B050', '0070C0'];
    const fill = (at: number): void =>
      harness.apply(alice, [
        {
          op: 'setShapeFormat',
          drawingNodeId: ids[at % 7]!,
          fill: { type: 'solid', color: colors[at % 3]! },
        } as never,
      ]);
    fill(0);
    const full: number[] = [];
    const times: number[] = [];
    for (let at = 1; at <= 15; at += 1) {
      const before = materializedPassCounts().full;
      const started = performance.now();
      fill(at);
      times.push(performance.now() - started);
      full.push(materializedPassCounts().full - before);
    }
    console.log(`[shapes-cost] fill change round trip median ${median(times).toFixed(3)} ms`);
    expect(full.every((count) => count === 0)).toBe(true);
    harness.expectConverged(alice, bob);
  });
});
