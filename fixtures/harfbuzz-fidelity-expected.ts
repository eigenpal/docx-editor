/**
 * Reviewed fidelity vectors for the licensed DejaVu 2.37 fixtures.
 *
 * These values are intentionally handwritten. Regeneration from engine output is
 * prohibited: a shaping, layout, or pagination change must be reviewed against the
 * font files and OOXML fixture before these vectors are edited.
 */
export const FIDELITY_FONT_HASHES = {
  regular: 'sha256:7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954',
  bold: 'sha256:e6476c1b80502924294eed40894c5b18e06c181444ca953e5334262df9c27724',
} as const;

export const FIDELITY_PAGE_SUMMARY = {
  browserPageCount: 2,
  layoutPageCount: 10,
  layoutLinesPerPage: [10, 11, 11, 11, 11, 11, 11, 11, 11, 3],
  layoutLineCount: 101,
  firstWrap: {
    lines: ['Wrapping line 01 with AV office glyph ', 'clusters and fixed vertical metrics.'],
    boxes: [
      [360, 2152, 4566, 280],
      [360, 2432, 4154, 280],
    ],
  },
} as const;

export const FIDELITY_RESOLVED = {
  regular: {
    family: 'DejaVu Sans',
    request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
    size: 24,
    color: { kind: 'hex', value: '202020' },
    bold: false,
    italic: false,
  },
  bold: {
    family: 'DejaVu Sans',
    request: { family: 'DejaVu Sans', weight: 700, style: 'normal' },
    size: 28,
    color: { kind: 'hex', value: 'C00000' },
    bold: true,
    italic: false,
  },
  major: {
    family: 'DejaVu Sans',
    request: { family: 'DejaVu Sans', weight: 700, style: 'normal' },
    size: 40,
    color: { kind: 'hex', value: '202020' },
    bold: true,
    italic: false,
  },
  minor: {
    family: 'DejaVu Sans',
    request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
    size: 32,
    color: { kind: 'hex', value: '202020' },
    bold: false,
    italic: false,
  },
} as const;

export const FIDELITY_SHAPES = {
  regularAV: {
    glyphs: [
      [36, 0, 149],
      [57, 1, 164],
    ],
    clusters: [
      [0, 1, 149],
      [1, 2, 164],
    ],
    verticalMetrics: { ascent: 223, descent: 57, lineGap: 0, baseline: 1700 },
  },
  regularAXV: {
    glyphs: [
      [36, 0, 164],
      [59, 1, 164],
      [57, 2, 164],
    ],
    clusters: [
      [0, 1, 164],
      [1, 2, 164],
      [2, 3, 164],
    ],
    width: 32.8,
  },
  boldAV: {
    glyphs: [
      [37, 0, 213],
      [82, 1, 192],
      [79, 2, 96],
      [71, 3, 200],
      [36, 4, 198],
      [57, 5, 217],
    ],
    clusters: [
      [0, 1, 213],
      [1, 2, 192],
      [2, 3, 96],
      [3, 4, 200],
      [4, 5, 198],
      [5, 6, 217],
    ],
    verticalMetrics: { ascent: 260, descent: 66, lineGap: 0, baseline: 1700 },
  },
  rtl: {
    glyphs: [
      [1390, 3, 149],
      [5366, 1, 143],
      [5293, 0, 201],
    ],
    clusters: [
      [3, 4, 149],
      [1, 3, 143],
      [0, 1, 201],
    ],
    bidiLevel: 1,
    verticalMetrics: { ascent: 223, descent: 57, lineGap: 0, baseline: 3175 },
  },
} as const;
