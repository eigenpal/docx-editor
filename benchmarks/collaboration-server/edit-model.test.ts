import { describe, expect, test } from 'bun:test';
import { DEFAULT_EDIT_PROFILE, planEdits } from './edit-model.ts';

describe('planEdits', () => {
  test('gives the same plan for the same seed', () => {
    expect(planEdits(7, 30_000)).toEqual(planEdits(7, 30_000));
    expect(planEdits(7, 30_000)).not.toEqual(planEdits(8, 30_000));
  });

  test('keeps every keystroke inside the duration, in time order', () => {
    const plan = planEdits(1, 60_000);
    for (let index = 1; index < plan.length; index += 1) {
      expect(plan[index]!.at).toBeGreaterThan(plan[index - 1]!.at);
    }
    expect(plan.at(-1)!.at).toBeLessThan(60_000);
  });

  test('types at a human pace on average', () => {
    // Average over many participants so one seed's long pauses do not decide the result.
    const seconds = 120;
    const total = Array.from({ length: 20 }, (_, seed) => planEdits(seed, seconds * 1000).length);
    const perSecond = total.reduce((sum, value) => sum + value, 0) / total.length / seconds;
    expect(perSecond).toBeGreaterThan(2);
    expect(perSecond).toBeLessThan(5);
  });

  test('sends about the configured share of keystrokes to the shared paragraph', () => {
    const plan = planEdits(3, 600_000);
    const share = plan.filter((edit) => edit.shared).length / plan.length;
    expect(share).toBeGreaterThan(DEFAULT_EDIT_PROFILE.sharedParagraphShare - 0.03);
    expect(share).toBeLessThan(DEFAULT_EDIT_PROFILE.sharedParagraphShare + 0.03);
  });
});
