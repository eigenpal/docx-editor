// Where a write LANDS, and WHAT it writes there.
//
// Two questions, because they fail differently and one hides the other.
//
// Where it lands catches the damage: a write aimed at the body while the reader is in a header
// edits content the user cannot see, and a write refused because the gate validated the wrong
// part looks like nothing happened. Asserting on the SAVED PACKAGE rather than a return value
// is deliberate, since a cross-story write reports success and only the bytes disagree.
//
// What it writes catches the subtler half. Increase Indent on a list item DEMOTES it in the
// body (`w:ilvl` 0 to 1, and a level declared in `numbering.xml`) and merely SHIFTS the
// paragraph everywhere else (a bare `w:ind`). Both land in the right part, so a part-identity
// assertion calls that parity when it is two different commands behind one button.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { STORY_KINDS, type StoryKind } from './story-parity-contract.ts';
import { PROBE, PROBE_TEXT } from './story-parity-fixture.ts';
import {
  caretIn,
  changedParts,
  openStory,
  PART_OF_STORY,
  probeParagraphMarkup,
  savedParts,
  selectAcross,
  type OpenStory,
} from './story-parity-harness.ts';

/** One editing gesture, and where the caret has to be for it to mean something. */
interface WriteProbe {
  readonly name: string;
  /** Probe paragraph the caret starts in. */
  readonly paragraphIndex: number;
  readonly run: (open: OpenStory) => void;
  /** The defect that makes this fail today, if it does. */
  readonly knownBroken?: string;
  /**
   * Compare the RESULTING MARKUP across stories, not just which part changed.
   *
   * Only for gestures that rewrite `w:pPr` and leave the paragraph's text alone: the markup is
   * located by that text, so a gesture that edits it has no stable anchor. The text-editing
   * gestures are covered by the part-identity half above, which is the question that matters
   * for them.
   */
  readonly comparesMarkup?: true;
  /** The defect that makes the resulting markup differ between stories, if it does. */
  readonly markupKnownBroken?: string;
}

const WRITES: readonly WriteProbe[] = [
  { name: 'type("X")', paragraphIndex: PROBE.formatted, run: (o) => o.surface.type('X') },
  { name: 'insertTab', paragraphIndex: PROBE.formatted, run: (o) => o.surface.insertTab() },
  {
    name: 'splitParagraph',
    paragraphIndex: PROBE.formatted,
    run: (o) => o.surface.splitParagraph(),
  },
  {
    name: 'deleteBackward',
    paragraphIndex: PROBE.formatted,
    run: (o) => o.surface.deleteBackward(),
  },
  {
    name: 'insertLineBreak',
    paragraphIndex: PROBE.formatted,
    run: (o) => o.surface.insertLineBreak(),
  },
  {
    // Over a RANGE. At a collapsed caret this arms a pending mark and writes nothing, which is
    // correct in every story and so measures nothing here.
    name: 'toggleRunProperty("b") over a range',
    paragraphIndex: PROBE.plain,
    run: (o) => {
      selectAcross(o, PROBE.plain, PROBE.plain, 4);
      o.surface.toggleRunProperty('b');
    },
  },
  {
    name: 'setParagraphProperty("jc", right)',
    paragraphIndex: PROBE.plain,
    run: (o) => o.surface.setParagraphProperty('jc', { val: 'right' }),
    comparesMarkup: true,
  },
  {
    name: 'adjustIndent("increase") on a plain paragraph',
    paragraphIndex: PROBE.plain,
    run: (o) => {
      o.surface.adjustIndent('increase');
    },
    comparesMarkup: true,
  },
  {
    // THE list-item case. In the body this demotes the item through `setListLevel`; outside it
    // `listLevelOf` reads null, so the same button appends a bare `w:ind` instead. Same part,
    // different command.
    name: 'adjustIndent("increase") on a numbered item',
    paragraphIndex: PROBE.numbered,
    run: (o) => {
      o.surface.adjustIndent('increase');
    },
    comparesMarkup: true,
    markupKnownBroken:
      'the body demotes the list level; every other story shifts the paragraph instead',
  },
  {
    name: 'setIndent({ left: 360 })',
    paragraphIndex: PROBE.plain,
    run: (o) => {
      o.surface.setIndent({ left: 360 });
    },
    comparesMarkup: true,
  },
  {
    name: 'toggleList("bullet") on a plain paragraph',
    paragraphIndex: PROBE.plain,
    run: (o) => {
      o.surface.toggleList('bullet');
    },
    comparesMarkup: true,
  },
  {
    // Turning a list OFF. The body removes `w:numPr`; outside it `listKindOf` reads null, so
    // `turningOff` is false and the gesture re-applies the numbering already there, changing
    // nothing while reporting success.
    name: 'toggleList("ordered") on a numbered item',
    paragraphIndex: PROBE.numbered,
    run: (o) => {
      o.surface.toggleList('ordered');
    },
    knownBroken:
      'outside the body the list read is null, so the toggle can only ever turn a list on',
  },
  {
    name: 'clearFormatting over a two-paragraph range',
    paragraphIndex: PROBE.formatted,
    run: (o) => {
      selectAcross(o, PROBE.formatted, PROBE.plain, 4);
      o.surface.clearFormatting();
    },
  },
  {
    name: 'insertTable(2, 2)',
    paragraphIndex: PROBE.plain,
    run: (o) => {
      o.surface.insertTable(2, 2);
    },
    knownBroken: 'canInsertTable validates against the body part, so the op is refused elsewhere',
  },
  {
    // The gate is real (`insertSectionBreak` refuses when the scope is not the body) but the
    // toolbar never learns it, so the control looks live and silently does nothing.
    name: 'insertSectionBreak',
    paragraphIndex: PROBE.plain,
    run: (o) => {
      o.surface.insertSectionBreak();
    },
    knownBroken: 'section breaks are body-only by design, but the refusal is never published',
  },
];

describe('a write lands in the story the caret is in', () => {
  for (const probe of WRITES) {
    for (const story of STORY_KINDS) {
      const expectRefused = Boolean(probe.knownBroken) && story !== 'body';
      const label = `${probe.name} in the ${story}${expectRefused ? ' (known broken)' : ''}`;

      test(label, async () => {
        const open = openStory(story);
        try {
          caretIn(open, probe.paragraphIndex);
          const before = await savedParts(open);
          probe.run(open);
          const after = await savedParts(open);
          const changed = changedParts(before, after);
          const ownPart = PART_OF_STORY[story];

          if (expectRefused) {
            // Refused outside the body today. Assert it STAYS refused, so the entry cannot rot
            // once the defect is fixed.
            expect(
              changed,
              `${probe.name} now writes in the ${story}: drop its knownBroken`
            ).toEqual([]);
            return;
          }

          // The gesture did something...
          expect(changed, `${probe.name} changed nothing in the ${story}`).not.toEqual([]);
          // ...to this story's part...
          expect(changed).toContain(ownPart);
          // ...and to no other story's.
          const foreign = changed.filter(
            (name) => name !== ownPart && Object.values(PART_OF_STORY).includes(name)
          );
          expect(foreign, `${probe.name} in the ${story} also wrote ${foreign.join(', ')}`).toEqual(
            []
          );
        } finally {
          open.destroy();
        }
      });
    }
  }
});

describe('a write puts the same markup in every story', () => {
  for (const probe of WRITES) {
    if (!probe.comparesMarkup) continue;
    // A gesture refused outside the body writes nothing there, so there is no markup to compare.
    if (probe.knownBroken) continue;
    const broken = probe.markupKnownBroken;

    test(`${probe.name}${broken ? ' (known broken)' : ''}`, async () => {
      const text = PROBE_TEXT[probe.paragraphIndex]!;
      const markupByStory = new Map<StoryKind, string>();
      for (const story of STORY_KINDS) {
        const open = openStory(story);
        try {
          caretIn(open, probe.paragraphIndex);
          probe.run(open);
          const parts = await savedParts(open);
          markupByStory.set(story, probeParagraphMarkup(parts.get(PART_OF_STORY[story])!, text));
        } finally {
          open.destroy();
        }
      }

      const body = markupByStory.get('body')!;
      const differing = STORY_KINDS.filter(
        (story) => story !== 'body' && markupByStory.get(story) !== body
      );

      if (broken) {
        expect(
          differing.length,
          `${probe.name} now writes the same markup everywhere: drop its markupKnownBroken`
        ).toBeGreaterThan(0);
        return;
      }
      for (const story of differing) {
        expect(markupByStory.get(story), `${story} differs from the body`).toBe(body);
      }
    });
  }
});
