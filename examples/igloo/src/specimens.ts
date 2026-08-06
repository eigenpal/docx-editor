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
  text: (data) => `the tip of a ${data.depth + tipHeight(data.depth)} m berg`,
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

/** The words the document carries. */
export function labelFor(kind: SpecimenKind, attrs: Readonly<Record<string, string>>): string {
  return kind === 'iceberg'
    ? `the tip of a ${depthOf(attrs) + tipHeight(depthOf(attrs))} m berg`
    : `an igloo of ${blocksOf(attrs)} blocks`;
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
  if (kind !== 'iceberg') return undefined;
  return {
    depth: depthOf(attrs),
    surveyedBy: attrs['surveyedBy'] ?? '',
    notes: attrs['notes'] ?? '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// One at random
// ─────────────────────────────────────────────────────────────────────────────

/** Tips worth surfacing. Short on purpose: this string becomes document text. */
const TIPS = [
  'the tip of it',
  'the bit you can see',
  'what surfaced',
  'the part above water',
  'the visible tenth',
];

export interface RandomSpecimen {
  readonly kind: SpecimenKind;
  readonly attrs: Record<string, string>;
  readonly label: string;
}

/** A specimen picked out of the water. Clock-seeded, unlike the deterministic sea and blizzard. */
export function randomSpecimen(seed = Date.now()): RandomSpecimen {
  const random = makeRandom(seed);
  const kind: SpecimenKind = random() < 0.5 ? 'iceberg' : 'igloo';
  if (kind === 'igloo') {
    const blocks = 3 + Math.floor(random() * 18);
    const attrs = { blocks: String(blocks) };
    return { kind, attrs, label: labelFor('igloo', attrs) };
  }
  const depth = 40 + Math.floor(random() * 400);
  return {
    kind,
    attrs: { depth: String(depth) },
    label: TIPS[Math.floor(random() * TIPS.length)]!,
  };
}
