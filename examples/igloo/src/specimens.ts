// Two document nodes the library has never heard of: an iceberg and an igloo.
//
// `defineCustomNode` from `@docx-editor.dev/pro` is the whole mechanism. A definition claims
// a `w:tag` prefix, says how to read attrs back off a file, and contributes a card to the
// review rail — and from there the packaged chrome does the rest: the chip is tinted and
// clickable, the right-click menu grows Edit/Remove rows, and each node gets a rail card
// anchored at its own text. None of that is written here.
//
// What lives ON DISK is a run-level `w:sdt` whose tag is `igloo:iceberg?depth=412`, with the
// label as its literal content. Word opens the file and shows the label; this editor
// recognizes the tag and shows a specimen. Nothing is lost either way, which is the point of
// hanging the identity on a content control rather than on markup only we understand.
//
// SECURITY. Every attr arrives from a `.docx` an attacker controls end to end, so the two
// numbers this demo cares about are parsed and CLAMPED at the recognition boundary rather
// than at the point of use — `fromDocx` returns the normalized attrs, so the rail card, the
// chip popover and the context menu all read a value that is already known to be sane.

import { defineCustomNode } from '@docx-editor.dev/pro';
import { makeRandom } from './art/random';

/** Which specimen: the discriminator the demo's own UI switches on. */
export type SpecimenKind = 'iceberg' | 'igloo';

/**
 * Where a specimen goes.
 *
 * The caret a menu row captured when it was chosen, or null for "wherever the selection is
 * when the write runs" — which is what `insertCustomNode` does with no `at`.
 */
export type SpecimenAt = { readonly paragraphId: string; readonly offset: number } | null;

/**
 * One small integer out of untrusted attrs.
 *
 * `Number.parseInt` on file data can return anything, including `NaN` and values large
 * enough to be silly in a `.repeat()` or a loop bound. This demo only draws with them, but
 * clamping at the boundary is the habit worth showing: the value every later surface reads
 * is already inside its range.
 */
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
 * The iceberg: nine tenths of it never made it into the paragraph.
 *
 * The document shows the tip. `depth` rides in the tag, comes back typed on the chip click,
 * the hover, the rail card and the context menu — one attrs vocabulary across all four,
 * because `fromDocx` normalized it once.
 */
export const ICEBERG = defineCustomNode({
  name: 'iceberg',
  tagPrefix: 'igloo',
  label: 'Iceberg',
  // HOST-authored, never file data: `CustomNodeChrome` tints the painted chip with it.
  chrome: { color: '#0f6f95' },
  fromDocx: ({ attrs }) => ({ depth: String(depthOf(attrs)) }),
  reviewCard: ({ attrs, text }) => {
    const depth = depthOf(attrs);
    return {
      title: `Iceberg — ${tipHeight(depth)} m up, ${depth} m down`,
      detail: `“${text}” is all of it that surfaced. The other nine tenths are below the line.`,
    };
  },
});

/**
 * The igloo: a shelter built one block at a time.
 *
 * Clicking the chip lays another block — a real `updateCustomNode` write, so it undoes,
 * redoes and saves back to the file like any other edit. The card tracks how warm that has
 * made it in there.
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
      title: `Igloo — ${blocks} blocks`,
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
 * A specimen picked out of the water.
 *
 * Seeded from the clock rather than from the fixed seed the sea and the blizzard share —
 * those are deterministic so screenshots do not rearrange themselves between runs, but this
 * one only ever fires because somebody asked for a surprise.
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
