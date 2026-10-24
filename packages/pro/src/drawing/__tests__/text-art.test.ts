/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// WordArt: VML text paths outside a watermark, projected through the installed text art
// renderer, and the typed model it reads them into.

import { describe, expect, test } from 'bun:test';
import {
  projectDrawingsInPart,
  type DrawingProjection,
} from '../../../../core/src/store/package/drawing-projection.ts';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '../../../../core/src/store/package/ooxml-tree.ts';
import { legacyTextArt } from '../../../../core/src/store/package/legacy-vml-text-art.ts';
import { installDrawing } from '../index.ts';
import { readLegacyTextArtModel } from '../text-art-model.ts';
import { legacyTextArtRenderer } from '../text-art-projection.ts';

installDrawing();

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:w10="urn:schemas-microsoft-com:office:word"';

const FLOATING =
  'position:absolute;margin-left:0;margin-top:0;width:412.4pt;height:247.45pt;rotation:315;' +
  'z-index:-251657216;mso-position-horizontal:center;mso-position-horizontal-relative:margin;' +
  'mso-position-vertical:center;mso-position-vertical-relative:margin';

function part(run: string): OoxmlPart {
  const loaded = readOoxmlPart(
    `<w:document ${NS}><w:body><w:p><w:r>${run}</w:r></w:p></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part;
}

const projected = (run: string): readonly DrawingProjection[] => projectDrawingsInPart(part(run));

function wordArt(
  options: { style?: string; attributes?: string; children?: string; path?: string } = {}
): string {
  return (
    `<w:pict><v:shape id="art" type="#_x0000_t136" style="${options.style ?? FLOATING}" ` +
    `${options.attributes ?? 'fillcolor="silver" stroked="f"'}>` +
    `${options.children ?? '<v:fill opacity=".5"/>'}` +
    `${options.path ?? '<v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt" string="DRAFT"/>'}` +
    '<w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict>'
  );
}

/** The `v:shape` of a run. */
function shapeOf(run: string): OoxmlElement {
  const stack: OoxmlElement[] = [part(run).root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.localName === 'shape') return node;
    for (const child of node.children) if (child.kind !== 'textValue') stack.push(child);
  }
  throw new Error('no shape');
}

describe('WordArt', () => {
  test('a floating text path projects its text, turned and translucent', () => {
    const [art] = projected(wordArt());
    expect(art?.textArt).toEqual({
      text: 'DRAFT',
      fontFamily: 'Calibri',
      bold: false,
      italic: false,
      fillHex: 'C0C0C0',
      fillAlpha: 0.5,
      strokeHex: null,
      strokeAlpha: 1,
      strokeWidthPt: 0,
      rotationDegrees: 315,
    });
    expect(art?.legacyGraphic).toBeUndefined();
  });

  test('text art on the line reads its trim, kerning and a switched-off shadow', () => {
    const [art] = projected(
      '<w:pict><v:shape id="title" type="#_x0000_t136" style="width:238.8pt;height:27.6pt" ' +
        'fillcolor="black" strokecolor="#c90"><v:shadow color="#868686"/>' +
        '<v:textpath style="font-family:&quot;Cambria&quot;;font-size:24pt;font-weight:bold;' +
        'v-text-kern:t" trim="t" fitpath="t" string="Title"/></v:shape></w:pict>'
    );
    expect(art?.kind).toBe('inline');
    expect(art?.textArt).toMatchObject({
      text: 'Title',
      fontFamily: 'Cambria',
      bold: true,
      fillHex: '000000',
      strokeHex: 'CC9900',
      trim: true,
    });
  });

  test('markup outside the subset is refused rather than approximated', () => {
    const refused = [
      wordArt({ children: '<v:fill type="gradient" color2="red" angle="45"/>' }),
      wordArt({ children: '<v:fill type="gradientRadial" color2="red"/>' }),
      wordArt({ children: '<v:shadow on="t" type="perspective"/>' }),
      wordArt({ path: '<v:textpath style="font-family:Calibri;v-rotate-letters:t" string="X"/>' }),
      wordArt({ path: '<v:textpath style="font-family:Calibri" string="two&#10;lines"/>' }),
      wordArt({ path: '<v:textpath style="font-family:Calibri" string="   "/>' }),
      wordArt({ children: '<v:fill opacity="2"/>' }),
      wordArt({ style: FLOATING.replace('rotation:315', 'rotation:x') }),
    ];
    for (const run of refused) expect(projected(run)).toEqual([]);
  });

  test('the projection agrees with the watermark reader over the shared subset', () => {
    const runs = [
      wordArt(),
      wordArt({ attributes: 'fillcolor="#1F4E79" strokecolor="red" strokeweight="1pt"' }),
      wordArt({ children: '<v:fill opacity="25%"/><v:stroke weight="2pt" color="navy"/>' }),
      wordArt({
        path: '<v:textpath style="font-family:Arial;font-style:italic" string="Copy" trim="t"/>',
      }),
    ];
    for (const run of runs) {
      const shape = shapeOf(run);
      expect(legacyTextArtRenderer(shape)).toEqual(legacyTextArt(shape));
    }
  });
});

describe('the text art model', () => {
  test('fields keep their raw attribute values and source node ids', () => {
    const shape = shapeOf(wordArt({ children: '<v:fill opacity=".5" color="red"/>' }));
    const model = readLegacyTextArtModel(shape)!;
    expect(model.shape).toMatchObject({
      nodeId: shape.id,
      type: '#_x0000_t136',
      fillcolor: 'silver',
      stroked: 'f',
    });
    expect(model.fills).toEqual([
      expect.objectContaining({ opacity: '.5', color: 'red', otherAttributes: [] }),
    ]);
    const path = model.textPaths[0]!;
    expect(path.string).toBe('DRAFT');
    expect(path.style?.get('font-size')).toBe('1pt');
    expect(path.nodeId).not.toBe(shape.id);
    // The wrap is kept, not modelled.
    expect(model.others.map((other) => other.localName)).toEqual(['wrap']);
  });

  test('a shape of another type has no text art model', () => {
    const shape = shapeOf(
      '<w:pict><v:shape type="#_x0000_t75" style="width:10pt;height:10pt"/></w:pict>'
    );
    expect(readLegacyTextArtModel(shape)).toBeNull();
  });
});
