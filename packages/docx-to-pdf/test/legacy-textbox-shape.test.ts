/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The shape of a legacy VML text box in the PDF: outline geometry, the centred outline, dash
// patterns, the shadow outside the shape, and turned boxes and stories. Each expectation
// restates the operators a measured rendering of the same construct writes.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

const FAMILY = 'DejaVu Sans';
const fontBytes = new Uint8Array(
  readFileSync(
    new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
  )
);
const source = createFontSource(fontBytes, { family: FAMILY, weight: 400, style: 'normal' });
if ('failure' in source) throw new Error(JSON.stringify(source.failure));
const fontSource = source.source;

const VML =
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';
const POS =
  'position:absolute;margin-left:144pt;margin-top:200pt;width:200pt;height:100pt;z-index:1;' +
  'mso-position-horizontal-relative:page;mso-position-vertical-relative:page';
// A US Letter page is 792 pt tall; PDF space runs up from its bottom.
const PAGE_HEIGHT = 792;

function shape(host: string, attrs: string, style = POS, kids = '', textbox = ''): string {
  return (
    `<w:p><w:r><w:t>Anchor</w:t></w:r><w:r><w:pict ${VML}><${host} style="${style}" ${attrs}>${kids}` +
    `<v:textbox${textbox}><w:txbxContent><w:p><w:r><w:t>Story</w:t></w:r></w:p></w:txbxContent>` +
    `</v:textbox></${host}></w:pict></w:r></w:p>`
  );
}

async function operators(body: string): Promise<string> {
  const result = await exportPdf(docx(body), {
    useSystemFonts: false,
    fidelityPolicy: 'strict',
    fonts: { sources: [fontSource], defaultFont: { family: FAMILY, sizeHalfPoints: 22 } },
  });
  const parsed = await PDFDocument.load(result.bytes);
  return parsed.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    )
    .join('\n');
}

test('a stroked text box strokes its outline centred on the box edge', async () => {
  const ops = await operators(shape('v:rect', 'filled="f" strokeweight="3pt"'));
  expect(ops).toContain(`3 w 144 ${PAGE_HEIGHT - 300} 200 100 re S`);
});

test('an oval strokes an ellipse that starts at its left middle', async () => {
  const ops = await operators(shape('v:oval', 'filled="f"'));
  expect(ops).toContain(`144 ${PAGE_HEIGHT - 250} m`);
  expect(ops).toMatch(/ c h S/);
});

test('a dashed outline writes its pattern in outline widths', async () => {
  const dashed = await operators(
    shape('v:rect', 'filled="f" strokeweight="1pt"', POS, '<v:stroke dashstyle="dash"/>')
  );
  expect(dashed).toContain('[4 3] 0 d');
  const dotted = await operators(
    shape('v:rect', 'filled="f" strokeweight="1pt"', POS, '<v:stroke dashstyle="shortdashdotdot"/>')
  );
  expect(dotted).toContain('[3 1 1 1 1 1] 0 d');
});

test('a shadow paints the shape again at its offset', async () => {
  const ops = await operators(
    shape('v:rect', 'fillcolor="#ffd966"', POS, '<v:shadow on="t" offset="6pt,-4pt"/>')
  );
  expect(ops).not.toContain('W* n');
  expect(ops).toContain('1 0 0 1 6 4 cm');
  // The default shadow colour is mid grey.
  expect(ops).toContain('0.501961 0.501961 0.501961 rg');
});

test('an obscured shadow is the silhouette, cut out where the shape stands', async () => {
  const ops = await operators(
    shape('v:oval', 'filled="f"', POS, '<v:shadow on="t" obscured="t" offset="6pt,6pt"/>')
  );
  expect(ops).toContain('W* n');
  // The silhouette fills even though the shape does not, and the text casts no shadow.
  expect(ops).toMatch(/0\.501961 0\.501961 0\.501961 rg [^f]* f/);
  expect(ops).not.toContain('/ActualText <FEFF>');
});

test('an inset pen on the outline keeps the outline inside the box', async () => {
  const ops = await operators(
    shape('v:rect', 'filled="f"', POS, '<v:stroke weight="6pt" insetpen="t"/>')
  );
  expect(ops).toContain(`6 w 147 ${PAGE_HEIGHT - 297} 194 94 re S`);
});

test('the text shadow of an unfilled shape is ink that extracts as nothing', async () => {
  const ops = await operators(shape('v:rect', 'filled="f"', POS, '<v:shadow on="t"/>'));
  // "Story" once as text, and once as a shadow copy whose actual text is empty.
  expect(ops.match(/\/ActualText <FEFF00530074006f00720079>/g)).toHaveLength(1);
  // The whole copy sits in an empty actual-text span, so lines without their own read empty.
  expect(ops).toContain('/Span << /ActualText <FEFF> >> BDC');
  expect(ops.match(/\/ActualText <FEFF>/g)).toHaveLength(2);
});

test('a quarter-turned box turns its outline and keeps its text upright', async () => {
  const ops = await operators(shape('v:rect', 'filled="f"', `${POS};rotation:90`));
  const turns = ops.match(/(-?[\d.]+ ){6}cm/g) ?? [];
  expect(turns.some((turn) => turn.startsWith('0 -1 1 0 '))).toBe(true);
  expect(turns.filter((turn) => turn.startsWith('0 -1 1 0 '))).toHaveLength(1);
});

test('vertical text turns its story a quarter clockwise', async () => {
  const ops = await operators(
    shape('v:rect', 'filled="f"', POS, '', ' style="layout-flow:vertical"')
  );
  expect(ops).toMatch(/0 -1 1 0 -?[\d.]+ -?[\d.]+ cm/);
});
