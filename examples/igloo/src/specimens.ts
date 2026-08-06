// Two document nodes the library has never heard of: an iceberg and an igloo.
//
// A `defineCustomNode` definition claims a `w:tag` prefix, says how to read attrs back off a
// file, and contributes a rail card. From there the packaged chrome does the rest — chip tint,
// click dispatch, the context menu's Edit/Remove rows, the card anchored at the node's text.
//
// On disk each is a run-level `w:sdt` with the label as its content, so Word opens it as
// ordinary text and nothing is lost either way. The two differ in WHERE their number lives, on
// purpose: the igloo's `blocks` rides in the `w:tag`, which is all a small integer needs, and
// the iceberg's `depth` rides in a PAYLOAD — a customXml data part the chip binds to, which is
// where anything past 64 characters has to go and where a real specimen record would be.
//
// SECURITY: both come from a file an attacker controls, so the two numbers are parsed and
// clamped in `fromDocx` — every later surface reads a value already known to be sane. A payload
// with no schema declared arrives as whatever JSON the file held, typed `unknown`, which is the
// honest description of it; clamping is what makes it a number.

import { defineCustomNode } from '@docx-editor.dev/pro';
import { z } from 'zod';
import { makeRandom } from './art/random';

/**
 * A berg's survey record.
 *
 * This is the shape of thing a payload exists for: `depth` alone would fit in a `w:tag`, and
 * `surveyedBy` plus a free-text note would not. Declaring it means every surface reads
 * `data.depth` as a number rather than re-parsing an attribute string.
 */
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

/** One small integer out of untrusted attrs, clamped at the boundary rather than at use. */
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

/** Metres of berg below the waterline, out of the attrs `fromDocx` already clamped. */
export function depthOf(attrs: Readonly<Record<string, string>>): number {
  return boundedInt(attrs, 'depth', 90, 999);
}

/**
 * A berg's record, from wherever this document happens to keep it.
 *
 * `ICEBERG.dataOf` does the real work — it narrows the node to this definition and validates the
 * payload against the schema, so there is no `safeParse` at any call site. This wrapper only
 * adds the fallback for documents written before the payload existed, which still carry
 * `igloo:iceberg?depth=412` in the tag.
 */
export function surveyOf(
  node: { readonly name?: string; readonly attrs?: Readonly<Record<string, string>>; readonly data?: unknown },
): IcebergData {
  return (
    ICEBERG.dataOf(node) ?? { depth: depthOf(node.attrs ?? {}), surveyedBy: '', notes: '' }
  );
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

/** What it is doing outside, in °C. A constant, because the weather here has one setting. */
export const OUTSIDE = -31;

/**
 * The iceberg: nine tenths of it never made it into the paragraph. The document shows the tip;
 * `depth` rides in the PAYLOAD — a customXml data part the chip binds to — and comes back on the
 * chip, the card and the context menu. Its tag carries identity alone.
 */
export const ICEBERG = defineCustomNode({
  name: 'iceberg',
  tagPrefix: 'igloo',
  label: 'Iceberg',
  // Host-authored, never file data: `CustomNodeChrome` tints the painted chip with it.
  chrome: { color: '#0f6f95' },
  schema: IcebergData,
  // What the document SHOWS, from the record. An edit to the depth moves the sentence with it.
  // Nothing to declare for the way back: the payload round-trips through the schema, so `data`
  // arrives as `IcebergData` on every surface — which is the contrast with the igloo below.
  text: (data) => `the tip of a ${data.depth + tipHeight(data.depth)} m berg`,
  reviewCard: ({ attrs, text, data }) => {
    // `data` is already `IcebergData` here — the schema did that. `surveyOf` is only for the
    // older documents that kept the depth in the tag.
    const survey = data ?? surveyOf({ attrs });
    return {
      title: `Iceberg: ${tipHeight(survey.depth)} m up, ${survey.depth} m down`,
      detail: survey.notes
        ? `${survey.notes}${survey.surveyedBy ? ` — ${survey.surveyedBy}` : ''}`
        : `“${text}” is all of it that surfaced. The other nine tenths are below the line.`,
    };
  },
});

/**
 * The igloo: a shelter built one block at a time. Clicking the chip lays another — a real
 * `updateCustomNode` write, so it undoes, redoes and saves like any other edit.
 */
export const IGLOO = defineCustomNode({
  name: 'igloo',
  tagPrefix: 'igloo',
  label: 'Igloo',
  chrome: { color: '#2f9dc7' },
  // No schema and no payload: everything this node knows is one number in the `w:tag`, which is
  // a string→string bag out of a file the sender wrote. THIS is what `fromDocx` is for — clamp
  // it once, here, and every later surface reads a number already known to be sane. Returning
  // `null` instead would leave the control literal, which is how you disown a tag that turns
  // out not to be yours.
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

/** The words the document carries — the label a Word user (and the free tier) sees. */
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

/**
 * What goes in the `w:tag`, which is not everything the specimen knows.
 *
 * The iceberg's depth is written to the payload instead, so its tag carries identity alone —
 * `igloo:iceberg`. That is the shape a real node wants: 64 characters is enough to say WHAT
 * something is and never enough to say what it holds.
 */
export function tagAttrsFor(
  kind: SpecimenKind,
  attrs: Readonly<Record<string, string>>
): Record<string, string> {
  if (kind !== 'iceberg') return { ...attrs };
  const { depth: _depth, ...rest } = attrs;
  return rest;
}

/** What goes in the payload, or undefined for a specimen that carries none. */
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

/**
 * A specimen picked out of the water. Clock-seeded, unlike the sea and the blizzard, which
 * are deterministic so screenshots do not rearrange themselves between runs.
 */
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
