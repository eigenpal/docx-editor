// Two custom nodes, showing the two places one can keep what it knows.
//
// The ICEBERG carries a survey record, so it declares a `schema` and a `text` — that is the whole
// definition, and `data` comes back typed everywhere. The IGLOO carries one integer, which fits
// in the `w:tag`; with no schema its attrs are untrusted strings, and `fromDocx` is where they
// get clamped.

import { defineCustomNode } from '@docx-editor.dev/pro';
import { z } from 'zod';
import { makeRandom } from './art/random';

/** A berg's survey record. `depth` would fit in a tag; the note is why the payload exists. */
export const IcebergData = z.object({
  /** Metres below the waterline. */
  depth: z.number().int().min(1).max(999),
  surveyedBy: z.string().max(80),
  /** Free text, and the field that could never have ridden in the tag. */
  notes: z.string().max(600),
});
export type IcebergData = z.infer<typeof IcebergData>;

/** Which specimen: the discriminator the demo's own UI switches on. */
export type SpecimenKind = 'iceberg' | 'igloo';

/** Where a specimen goes: a captured caret, or null for wherever the selection is. */
export type SpecimenAt = { readonly paragraphId: string; readonly offset: number } | null;

/** One small integer out of untrusted attrs, clamped once. */
function boundedInt(
  attrs: Readonly<Record<string, string>>,
  key: string,
  fallback: number,
  max: number
): number {
  const parsed = Number.parseInt(attrs[key] ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

/** Metres below the waterline, out of the dialog's string-keyed form state. */
export function depthOf(attrs: Readonly<Record<string, string>>): number {
  return boundedInt(attrs, 'depth', 90, 999);
}

/** The words a berg puts in the paragraph. The definition's `text` is this function. */
export function bergText(data: IcebergData): string {
  return `the tip of a ${data.depth + tipHeight(data.depth)} m berg`;
}

/** The words an igloo puts in the paragraph. Editable, unlike the berg's. */
export function iglooText(attrs: Readonly<Record<string, string>>): string {
  return `an igloo of ${blocksOf(attrs)} blocks`;
}

/** A berg with no record at all — what a node the schema rejects falls back to. */
const UNSURVEYED: IcebergData = { depth: 90, surveyedBy: '', notes: '' };

/** A berg's record. `dataOf` narrows and validates, so no surface writes a `safeParse`. */
export function surveyOf(node: { readonly name?: string; readonly data?: unknown }): IcebergData {
  return ICEBERG.dataOf(node) ?? UNSURVEYED;
}

/** Blocks laid so far. */
export function blocksOf(attrs: Readonly<Record<string, string>>): number {
  return boundedInt(attrs, 'blocks', 7, 999);
}

/** The tenth of a berg that made it above the water, in metres. */
export function tipHeight(depth: number): number {
  return Math.max(1, Math.round(depth / 9));
}

/** Inside an igloo: every block laid is a degree kept. Outside is always {@link OUTSIDE}. */
export function insideTemperature(blocks: number): number {
  return Math.min(-1, -22 + blocks);
}

/** Outside, in °C. The weather here has one setting. */
export const OUTSIDE = -31;

/** The iceberg: nine tenths of it never made it into the paragraph. Its record is a payload. */
export const ICEBERG = defineCustomNode({
  name: 'iceberg',
  tagPrefix: 'igloo',
  label: 'Iceberg',
  chrome: { color: '#0f6f95' },
  schema: IcebergData,
  // Nothing to declare for the way back: the payload round-trips through the schema.
  text: bergText,
  reviewCard: ({ text, data }) => {
    // Optional: a file can carry a node whose payload is missing or malformed.
    const survey = data ?? UNSURVEYED;
    return {
      title: `Iceberg: ${tipHeight(survey.depth)} m up, ${survey.depth} m down`,
      detail: survey.notes
        ? `${survey.notes}${survey.surveyedBy ? ` — ${survey.surveyedBy}` : ''}`
        : `“${text}” is all of it that surfaced. The other nine tenths are below the line.`,
    };
  },
});

/** The igloo: clicking the chip lays another block, which is a real `updateCustomNode` write. */
export const IGLOO = defineCustomNode({
  name: 'igloo',
  tagPrefix: 'igloo',
  label: 'Igloo',
  chrome: { color: '#2f9dc7' },
  // No schema, so attrs are untrusted strings. `fromDocx` clamps them once; `null` would leave
  // the control literal.
  fromDocx: ({ attrs }) => ({ blocks: String(blocksOf(attrs)) }),
  reviewCard: ({ attrs }) => {
    const blocks = blocksOf(attrs);
    return {
      title: `Igloo: ${blocks} blocks`,
      detail: `${insideTemperature(blocks)} °C in here, ${OUTSIDE} °C out there. Click it to lay another.`,
    };
  },
});

/** Registered once on the Root; every pro surface defaults to these. */
export const SPECIMENS = [ICEBERG, IGLOO] as const;

export function definitionOf(kind: SpecimenKind) {
  return kind === 'iceberg' ? ICEBERG : IGLOO;
}

/**
 * The words the document will carry. For the igloo that is a default the writer may overtype;
 * for the berg it is what `text` derives, so the dialog shows it and nobody types it.
 */
export function textFor(kind: SpecimenKind, attrs: Readonly<Record<string, string>>): string {
  return kind === 'iceberg' ? bergText(surveyAttrs(attrs)) : iglooText(attrs);
}

/** The berg's record, out of the dialog's string-keyed form state. */
function surveyAttrs(attrs: Readonly<Record<string, string>>): IcebergData {
  return {
    depth: depthOf(attrs),
    surveyedBy: attrs['surveyedBy'] ?? '',
    notes: attrs['notes'] ?? '',
  };
}

/** What a fresh specimen of each kind carries before anyone edits it. */
export function defaultAttrs(kind: SpecimenKind): Record<string, string> {
  return kind === 'iceberg'
    ? { depth: '90', surveyedBy: 'R. Amundsen', notes: 'Calved off the shelf overnight.' }
    : { blocks: '7' };
}

/** The payload a specimen carries. The igloo has none — its number rides in the tag. */
export function payloadFor(
  kind: SpecimenKind,
  attrs: Readonly<Record<string, string>>
): IcebergData | undefined {
  return kind === 'iceberg' ? surveyAttrs(attrs) : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// One at random
// ─────────────────────────────────────────────────────────────────────────────

const SURVEYORS = ['R. Amundsen', 'F. Nansen', 'M. Boyd', 'A. Tabei', 'E. Shackleton'];

/** Field notes. Free text is the whole reason the berg needs a payload. */
const NOTES = [
  'Calved off the shelf overnight.',
  'Rolled twice on approach; keel is longer than it looks.',
  'Meltwater channels down the north face.',
  'Grounded on the bank, holding through the ebb.',
  'Blue ice at the waterline — old, and dense with it.',
];

export interface RandomSpecimen {
  readonly kind: SpecimenKind;
  readonly attrs: Record<string, string>;
}

/** A specimen picked out of the water. Clock-seeded, unlike the deterministic sea and blizzard. */
export function randomSpecimen(seed = Date.now()): RandomSpecimen {
  const random = makeRandom(seed);
  const pick = (from: readonly string[]): string => from[Math.floor(random() * from.length)]!;
  if (random() < 0.5) {
    return { kind: 'igloo', attrs: { blocks: String(3 + Math.floor(random() * 18)) } };
  }
  return {
    kind: 'iceberg',
    attrs: {
      depth: String(40 + Math.floor(random() * 400)),
      surveyedBy: pick(SURVEYORS),
      notes: pick(NOTES),
    },
  };
}
