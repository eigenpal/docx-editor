// Which packaged face stands in for which Word family, and how each one is named on disk.
//
// This lives apart from `index.ts` so the CI width-fidelity gate can IMPORT the table
// rather than restate its numbers. A gate that repeats a `lineMetrics` literal asserts
// that its own literal round-trips; only reading the shipped plan can catch a wrong one.

/** The common Word families this package can stand in for. */
export type WordDefaultFamily =
  | 'Calibri'
  | 'Cambria'
  | 'Times New Roman'
  | 'Arial'
  | 'Courier New'
  | 'Century Gothic';

/** One Word family's packaged substitute: the face, its filenames, and its line box. */
export interface FamilyPlan {
  readonly substitute: string;
  readonly filePrefix: string;
  readonly extension?: 'otf';
  /**
   * Word's line box for the REQUESTED family, as em ratios, when the substitute's own
   * vertical metrics differ. Omitted means the substitute's `hhea` already agrees.
   */
  readonly lineMetrics?: {
    readonly heightEm: number;
    readonly baselineEm: number;
  };
}

export const FAMILY_PLANS: ReadonlyMap<WordDefaultFamily, FamilyPlan> = new Map([
  ['Calibri', { substitute: 'Carlito', filePrefix: 'Carlito' }],
  ['Cambria', { substitute: 'Caladea', filePrefix: 'Caladea' }],
  ['Times New Roman', { substitute: 'Liberation Serif', filePrefix: 'LiberationSerif' }],
  ['Arial', { substitute: 'Liberation Sans', filePrefix: 'LiberationSans' }],
  ['Courier New', { substitute: 'Liberation Mono', filePrefix: 'LiberationMono' }],
  [
    'Century Gothic',
    {
      substitute: 'TeX Gyre Adventor',
      filePrefix: 'TeXGyreAdventor',
      extension: 'otf',
      // Century Gothic's own ascent/descent, read from Word's PDF export. Adventor's
      // `hhea` is taller, so without this a Century Gothic line paginates ~3% short.
      lineMetrics: { heightEm: 1.19140625, baselineEm: 0.97119140625 },
    },
  ],
]);

export const FACES: readonly {
  readonly suffix: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}[] = [
  { suffix: 'Regular', weight: 400, style: 'normal' },
  { suffix: 'Bold', weight: 700, style: 'normal' },
  { suffix: 'Italic', weight: 400, style: 'italic' },
  { suffix: 'BoldItalic', weight: 700, style: 'italic' },
];

/** The asset filename for one face of one plan. */
export const planFaceFile = (plan: FamilyPlan, suffix: string): string =>
  `${plan.filePrefix}-${suffix}.${plan.extension ?? 'ttf'}`;

/**
 * Families this package substitutes for that the pinned Google catalog CANNOT serve, so
 * `googleFonts()` loads their packaged bytes instead of ranking a distant candidate.
 *
 * Calibri, Cambria, Times New Roman and Courier New are absent because the catalog has
 * metric-compatible answers for them (Carlito, Caladea, Tinos, Cousine). Arial's would be
 * Arimo, which google/fonts now ships variable-only.
 */
export const PACKAGED_ONLY_FAMILIES: readonly WordDefaultFamily[] = Object.freeze([
  'Century Gothic',
]);
