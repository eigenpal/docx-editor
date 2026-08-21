// What a control REPORTS is the same in every story, unless `story-parity-contract.ts` says it
// may not be.
//
// Reads indexed the body while writes stayed scoped, so a toolbar button in a header reported
// the body's state and then wrote somewhere else. Six call sites were fixed one at a time, each
// after the bug reached a user. This asks the question once, for every control, in every story.
//
// Two things are checked, because the toolbar alone does not cover the reads that matter most.
// `toolbarCommandState` publishes `value` for three slots only, so the font, size, colour and
// style pickers carry no value through it: comparing `value` across stories would be vacuously
// true for every one of them. `getSelectionFormatting` is where those reads actually surface,
// and it gets its own comparison below.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { CHROME_GROUPS, chromeSlotId, type ChromeSlotId } from '../chrome-controls.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import {
  FURNITURE_AND_NOTE_STORIES,
  KNOWN_BROKEN,
  SLOT_PARITY,
  STORY_KINDS,
  type ParityDimension,
  type StoryKind,
} from './story-parity-contract.ts';
import { caretIn, openStory, selectAcross, type OpenStory } from './story-parity-harness.ts';
import { PROBE } from './story-parity-fixture.ts';

const ALL_SLOTS: readonly ChromeSlotId[] = CHROME_GROUPS.flatMap((group) =>
  group.controls.map((control) => chromeSlotId(group, control))
);

/** The observable state of one control, reduced to what the contract compares. */
interface SlotState {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly value: string | undefined;
  readonly reason: string | null;
}

/** One violation, tagged with the dimension it was seen in. */
interface Violation {
  readonly dimension: ParityDimension;
  readonly detail: string;
}

function slotStateOf(open: OpenStory, slot: ChromeSlotId): SlotState {
  const state = toolbarCommandState(open.editor, slot);
  return {
    enabled: state.enabled,
    active: state.active,
    value: state.value,
    reason: state.disabledReason ?? null,
  };
}

type Sweep = Map<StoryKind, Map<ChromeSlotId, SlotState>>;

/**
 * Every slot's state in every story, for one probe paragraph.
 *
 * Mounted once per story and reused across all 54 slots: `toolbarCommandState` is a pure read,
 * and mounting 5 stories x 54 slots would be 270 documents for no extra signal.
 */
function sweep(paragraphIndex: number): Sweep {
  const result: Sweep = new Map();
  for (const story of STORY_KINDS) {
    const open = openStory(story);
    try {
      caretIn(open, paragraphIndex);
      const states = new Map<ChromeSlotId, SlotState>();
      for (const slot of ALL_SLOTS) states.set(slot, slotStateOf(open, slot));
      result.set(story, states);
    } finally {
      open.destroy();
    }
  }
  return result;
}

/** Whether one slot satisfies its declared rule, and in which dimension it does not. */
function violationsOf(slot: ChromeSlotId, states: Sweep): Violation[] {
  const rule = SLOT_PARITY[slot];
  const body = states.get('body')!.get(slot)!;
  const found: Violation[] = [];
  const say = (dimension: ParityDimension, detail: string): void => {
    found.push({ dimension, detail });
  };

  for (const story of FURNITURE_AND_NOTE_STORIES) {
    const here = states.get(story)!.get(slot)!;

    if (rule.parity === 'same') {
      if (here.enabled !== body.enabled) {
        say('enabled', `${story}: enabled ${here.enabled} (body ${body.enabled})`);
      }
      if (here.active !== body.active) {
        say('active', `${story}: active ${here.active} (body ${body.active})`);
      }
      if (here.value !== body.value) {
        say('value', `${story}: value ${here.value} (body ${body.value})`);
      }
      if (here.reason !== body.reason) {
        say('reason', `${story}: reason ${here.reason} (body ${body.reason})`);
      }
      continue;
    }

    const mustBeLive =
      rule.parity === 'furnitureOnly' && (story === 'header' || story === 'footer');
    if (mustBeLive) {
      if (!here.enabled) say('enabled', `${story}: refused (${here.reason}), expected live`);
      continue;
    }
    if (here.enabled) {
      say('enabled', `${story}: enabled, expected refused`);
    } else if (here.reason !== rule.reason) {
      // Asserted in EVERY refusing story, not just the body. A reason checked in one place is
      // how a generic fallback passes for the other four.
      say(
        'reason',
        `${story}: reason ${JSON.stringify(here.reason)}, expected ${JSON.stringify(rule.reason)}`
      );
    }
  }

  if (rule.parity === 'bodyOnly' && !body.enabled) {
    say('enabled', `body: refused (${body.reason}), expected live`);
  }
  if (rule.parity === 'furnitureOnly') {
    if (body.enabled) {
      say('enabled', 'body: enabled, expected refused');
    } else if (body.reason !== rule.reason) {
      say(
        'reason',
        `body: reason ${JSON.stringify(body.reason)}, expected ${JSON.stringify(rule.reason)}`
      );
    }
  }
  return found;
}

const PROBES = [
  { label: 'a centred, indented, bold paragraph', paragraphIndex: PROBE.formatted },
  { label: 'a numbered list item', paragraphIndex: PROBE.numbered },
  { label: 'a bulleted list item', paragraphIndex: PROBE.bulleted },
] as const;

describe('the story-parity contract', () => {
  test('every chrome slot declares a rule', () => {
    const declared = new Set(Object.keys(SLOT_PARITY));
    expect(ALL_SLOTS.filter((slot) => !declared.has(slot))).toEqual([]);
    expect([...declared].filter((slot) => !ALL_SLOTS.includes(slot as ChromeSlotId))).toEqual([]);
  });

  test('every known-broken entry names a real slot', () => {
    const unknown = Object.keys(KNOWN_BROKEN).filter(
      (slot) => !ALL_SLOTS.includes(slot as ChromeSlotId)
    );
    expect(unknown).toEqual([]);
  });

  // The guard is not vacuous: if the sweep saw nothing, every comparison below would pass by
  // examining nothing at all. At least one slot has to be live somewhere, and at least one has
  // to report an active state, or the fixture has stopped exercising the engine.
  test('the sweep is not vacuous', () => {
    const states = sweep(PROBE.formatted);
    const all = STORY_KINDS.flatMap((story) => [...states.get(story)!.values()]);
    expect(all.filter((state) => state.enabled).length).toBeGreaterThan(0);
    expect(all.filter((state) => state.active).length).toBeGreaterThan(0);
  });

  const sweeps = PROBES.map((probe) => ({ ...probe, states: sweep(probe.paragraphIndex) }));

  for (const { label, states } of sweeps) {
    describe(`with the caret in ${label}`, () => {
      for (const slot of ALL_SLOTS) {
        // A known-broken slot may violate here. That it STILL does is asserted once, across
        // every probe, below: a defect that shows on one paragraph shape must not force a
        // per-probe excuse.
        if (KNOWN_BROKEN[slot]) continue;
        test(slot, () => {
          expect(violationsOf(slot, states).map((violation) => violation.detail)).toEqual([]);
        });
      }
    });
  }

  // The list cannot rot into excuses nobody rechecks. A slot that starts satisfying the
  // contract has to come off it, and this fails until it does. Scoped to the DECLARED
  // dimension, so an entry cannot be kept alive by an unrelated regression.
  for (const [slot, entry] of Object.entries(KNOWN_BROKEN) as [
    ChromeSlotId,
    { dimension: ParityDimension },
  ][]) {
    test(`${slot} still diverges in '${entry.dimension}' (known broken)`, () => {
      const seen = sweeps.flatMap(({ states }) => violationsOf(slot, states));
      const inDimension = seen.filter((violation) => violation.dimension === entry.dimension);
      expect(
        inDimension.map((violation) => violation.detail).length,
        `${slot} no longer diverges in '${entry.dimension}': drop it from KNOWN_BROKEN`
      ).toBeGreaterThan(0);
    });
  }
});

// The cascade reads the toolbar sweep cannot see. `getSelectionFormatting` is what the font,
// size, colour, style, spacing and indent chrome renders from, and it is the read that was
// broken in a header for the longest: a centred, indented paragraph reported left and zero.
describe('selection formatting is the same in every story', () => {
  const formattingIn = (paragraphIndex: number, range?: boolean) => {
    const byStory = new Map<StoryKind, unknown>();
    for (const story of STORY_KINDS) {
      const open = openStory(story);
      try {
        if (range) selectAcross(open, PROBE.formatted, PROBE.plain, 4);
        else caretIn(open, paragraphIndex);
        byStory.set(story, open.editor.getSelectionFormatting());
      } finally {
        open.destroy();
      }
    }
    return byStory;
  };

  for (const { label, paragraphIndex, range, knownBroken } of [
    { label: 'at a caret in a centred, indented, bold paragraph', paragraphIndex: PROBE.formatted },
    { label: 'at a caret in a plain paragraph', paragraphIndex: PROBE.plain },
    { label: 'at a caret in a numbered list item', paragraphIndex: PROBE.numbered },
    {
      // A MULTI-PARAGRAPH selection takes a different path from a caret: `spansInSelection`
      // orders its endpoints through `orderPositions`, which falls back to the body's document
      // order. Outside the body both endpoints rank -1, the walk gives up, and the run
      // properties come back short: measured, the body reports `fontSizeHalfPoints` and a
      // header omits it entirely. So the size box empties when you select two paragraphs in a
      // header, and Bold cannot be toggled off there.
      label: 'over a two-paragraph range',
      paragraphIndex: PROBE.formatted,
      range: true,
      knownBroken:
        'run properties over a multi-paragraph range order through the body document order',
    },
  ] as const) {
    test(`${label}${knownBroken ? ' (known broken)' : ''}`, () => {
      const byStory = formattingIn(paragraphIndex, range);
      const body = JSON.stringify(byStory.get('body'));
      // Not vacuous: the body read has to carry something before comparing to it means anything.
      expect(body).not.toBe('null');
      expect(body).not.toBe('{}');
      const differing = FURNITURE_AND_NOTE_STORIES.filter(
        (story) => JSON.stringify(byStory.get(story)) !== body
      );
      if (knownBroken) {
        expect(
          differing.length,
          'selection formatting now agrees in every story: drop the knownBroken'
        ).toBeGreaterThan(0);
        return;
      }
      for (const story of differing) {
        expect(JSON.stringify(byStory.get(story)), `${story} disagrees with the body`).toBe(body);
      }
    });
  }
});
