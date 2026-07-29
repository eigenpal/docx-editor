import { expect, test } from 'bun:test';
import type { DisplayPage, GlyphFont, GlyphRun } from '@docx-editor.dev/core-contract/contracts/geometry';
import type { InstalledDisplayFonts } from '@docx-editor.dev/core-contract/editor';
import type { VNode } from 'vue';
import { paintDisplay } from '../src/paintDisplay.ts';

const font = {
  id: 'regular',
  identity: `sha256:${'1'.repeat(64)}#0`,
  family: 'Authored Family',
  request: { family: 'Authored Family', weight: 400, style: 'normal' },
  hash: `sha256:${'1'.repeat(64)}`,
  faceIndex: 0,
  byteLength: 12,
  substitution: null,
} as const satisfies GlyphFont;

const run = {
  text: 'abc',
  box: { x: 11, y: 13, width: 37, height: 19 },
  font,
  fontFamily: font.family,
  fontSizeHalfPoints: 27,
  fontSizePx: 18,
  fontWeight: 400,
  fontStyle: 'normal',
  color: { kind: 'hex', value: '123456' },
  direction: 'rtl',
  bidiLevel: 1,
  glyphs: [
    {
      id: 5044,
      cluster: 0,
      originX: 0,
      originY: 0,
      advanceX: 30,
      advanceY: 0,
      offsetX: 2,
      offsetY: 3,
      outline: { path: 'M1,2L3,4Z', unitsPerEm: 1000 },
    },
  ],
  clusters: [],
  fontSpans: [],
  verticalMetrics: { ascent: 14, descent: 5, lineGap: 0, baseline: 14 },
  shaping: { fixedPointScale: 20 },
  producer: {},
} as unknown as GlyphRun;

const page = {
  index: 0,
  box: { x: 0, y: 0, width: 100, height: 100 },
  contentBox: { x: 0, y: 0, width: 100, height: 100 },
  items: [{ kind: 'text', box: run.box, runs: [run] }],
} as unknown as DisplayPage;

test('Vue paints exact glyph outlines and keeps semantic text out of geometry', () => {
  const installed = {
    aliasFor: () => 'DocxFont_exact_regular',
    release: () => {},
  } satisfies InstalledDisplayFonts;
  const pageNode = paintDisplay([page], installed)[0]!;
  const content = (pageNode.children as VNode[])[0]!;
  const painted = (content.children as VNode[])[0]!;
  const style = painted.props!.style as Record<string, unknown>;
  const svg = (painted.children as VNode[])[0]!;
  const path = (svg.children as VNode[])[0]!;
  const semantic = (painted.children as VNode[])[1]!;

  expect(style).toMatchObject({
    left: '11px',
    top: '13px',
    width: '37px',
    height: '19px',
  });
  expect(svg.type).toBe('svg');
  expect(svg.props!['aria-hidden']).toBe('true');
  expect(svg.props!.style).not.toHaveProperty('fontFamily');
  expect(path.props).toMatchObject({
    d: 'M1,2L3,4Z',
    fill: '#123456',
    transform: 'translate(0.13333333333333333 0.8) scale(0.018 -0.018)',
  });
  expect(semantic.children).toBe('abc');
  expect(semantic.props!.style).toMatchObject({
    position: 'absolute',
    width: '1px',
    height: '1px',
    pointerEvents: 'none',
  });
  expect(style).not.toHaveProperty('fontFamily');
});
