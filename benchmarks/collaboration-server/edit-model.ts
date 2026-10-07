// A reproducible model of one person typing in a shared document.
//
// People type in bursts: a run of keystrokes at roughly 60 words per minute, then a pause
// to read or think. Most keystrokes insert one character. Some delete, some start a new
// paragraph, and some apply bold. A share of keystrokes lands in one paragraph that every
// participant edits, so the room also carries concurrent edits at the same place.
//
// Every choice comes from a seeded generator. The same seed gives the same session.

export type EditAction = 'type' | 'backspace' | 'enter' | 'bold';

export interface EditProfile {
  /** Mean delay between keystrokes inside a burst, in milliseconds. */
  readonly keystrokeMs: number;
  /** Keystrokes in one burst, inclusive range. */
  readonly burst: readonly [number, number];
  /** Pause between bursts, inclusive range in milliseconds. */
  readonly pauseMs: readonly [number, number];
  /** Share of keystrokes that edit the paragraph all participants share. */
  readonly sharedParagraphShare: number;
  /** Relative weights of each action. */
  readonly mix: Readonly<Record<EditAction, number>>;
}

/** About 60 words per minute in bursts, which averages near 3.5 keystrokes per second. */
export const DEFAULT_EDIT_PROFILE: EditProfile = Object.freeze({
  keystrokeMs: 180,
  burst: [8, 40] as const,
  pauseMs: [500, 4000] as const,
  sharedParagraphShare: 0.1,
  mix: Object.freeze({ type: 88, backspace: 7, enter: 3, bold: 2 }),
});

export interface PlannedEdit {
  /** Milliseconds after the load phase starts. */
  readonly at: number;
  readonly action: EditAction;
  readonly shared: boolean;
  readonly character: string;
  /** A number in [0, 1) for a position in the shared paragraph. */
  readonly position: number;
}

const WORDS =
  'the agreement shall remain in force until either party gives written notice of termination ' +
  'and all obligations accrued before that date survive including payment confidentiality and ' +
  'indemnity for any claim arising from the services delivered under this schedule';

/** Mulberry32: small, fast, and good enough to drive a workload. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random: () => number, [low, high]: readonly [number, number]): number {
  return low + Math.floor(random() * (high - low + 1));
}

function pickAction(random: () => number, mix: EditProfile['mix']): EditAction {
  const entries = Object.entries(mix) as [EditAction, number][];
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [action, weight] of entries) {
    roll -= weight;
    if (roll < 0) return action;
  }
  return 'type';
}

/**
 * Plan every keystroke of one participant for `durationMs`.
 *
 * The first burst starts after a random offset inside the first pause range, so the
 * participants do not all press a key in the same millisecond.
 */
export function planEdits(
  seed: number,
  durationMs: number,
  profile: EditProfile = DEFAULT_EDIT_PROFILE
): PlannedEdit[] {
  const random = seededRandom(seed);
  const edits: PlannedEdit[] = [];
  let at = random() * profile.pauseMs[1];
  let cursor = Math.floor(random() * WORDS.length);
  while (at < durationMs) {
    const keystrokes = between(random, profile.burst);
    for (let index = 0; index < keystrokes && at < durationMs; index += 1) {
      const action = pickAction(random, profile.mix);
      edits.push({
        at,
        action,
        shared: random() < profile.sharedParagraphShare,
        character: WORDS[cursor % WORDS.length] ?? ' ',
        position: random(),
      });
      if (action === 'type') cursor += 1;
      // Jitter each keystroke between half and one and a half times the mean.
      at += profile.keystrokeMs * (0.5 + random());
    }
    at += between(random, profile.pauseMs);
  }
  return edits;
}
