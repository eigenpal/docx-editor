// Two document nodes the library has never heard of: an iceberg and an igloo.
//
// A `defineCustomNode` definition claims a `w:tag` prefix, says how to read attrs back off a
// file, and contributes a rail card. From there the packaged chrome does the rest — chip tint,
// click dispatch, the context menu's Edit/Remove rows, the card anchored at the node's text.
//
// On disk each is a run-level `w:sdt` tagged `igloo:iceberg?depth=412` with the label as its
// content, so Word opens it as ordinary text and nothing is lost either way.
//
// SECURITY: attrs come from a file an attacker controls, so the two numbers are parsed and
// clamped in `fromDocx` — every later surface reads a value already known to be sane.

import { defineCustomNode } from '@docx-editor.dev/pro';
import { makeRandom } from './art/random';

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

/** Metres of berg below the waterline. */
export function depthOf(attrs: Readonly<Record<string, string>>): number {
  return boundedInt(attrs, 'depth', 90, 999);
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
 * `depth` rides in the tag and comes back typed on the chip, the card and the context menu.
 */
export const ICEBERG = defineCustomNode({
  name: 'iceberg',
  tagPrefix: 'igloo',
  label: 'Iceberg',
  // Host-authored, never file data: `CustomNodeChrome` tints the painted chip with it.
  chrome: { color: '#0f6f95' },
  fromDocx: ({ attrs }) => ({ depth: String(depthOf(attrs)) }),
  reviewCard: ({ attrs, text }) => {
    const depth = depthOf(attrs);
    return {
      title: `Iceberg: ${tipHeight(depth)} m up, ${depth} m down`,
      detail: `“${text}” is all of it that surfaced. The other nine tenths are below the line.`,
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
  return kind === 'iceberg' ? { depth: '90' } : { blocks: '7' };
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
