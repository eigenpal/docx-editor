// A picked family holds the text in its previous face only while its face is on the way.
import { expect, test } from 'bun:test';
import { createFontPickHold, type PickState } from '../font-pick-hold.ts';

function state(overrides: Partial<Record<keyof PickState, unknown>> = {}) {
  const covered = new Set(['arial']);
  const asked = new Set<string>();
  const base: PickState = {
    dynamic: () => true,
    shaping: () => true,
    covered: (family) => covered.has(family.toLowerCase()),
    served: () => ['Arial', 'Roboto'],
    asked: (family) => asked.has(family.toLowerCase()),
  };
  return { state: { ...base, ...overrides } as PickState, covered, asked };
}

test('a served family with no face yet renders in the previous family until it is covered', () => {
  const { state: s, covered } = state();
  const hold = createFontPickHold(s);
  hold.pick('Roboto', 'Arial');
  expect(hold.family('roboto')).toBe('Arial');
  const base = (family: string) => (family === 'Arial' ? 'alias-arial' : undefined);
  expect(hold.alias(base)('Roboto')).toBe('alias-arial');
  expect(hold.alias(base)('Arial')).toBe('alias-arial');
  hold.release((family) => covered.has(family));
  expect(hold.family('Roboto')).toBe('Arial');
  covered.add('roboto');
  hold.release((family) => covered.has(family));
  expect(hold.family('Roboto')).toBeUndefined();
  expect(hold.alias(base)('Roboto')).toBeUndefined();
});

test('no hold for a family the resolver does not serve, already asked for, or covered', () => {
  const { state: s, asked } = state();
  const hold = createFontPickHold(s);
  hold.pick('Local Only Sans', 'Arial');
  hold.pick('Arial', 'Arial');
  asked.add('roboto');
  hold.pick('Roboto', 'Arial');
  expect(hold.family('Local Only Sans')).toBeUndefined();
  expect(hold.family('Roboto')).toBeUndefined();
});

test('no hold without an on-demand resolver, shaping, a previous face, or a family name', () => {
  for (const overrides of [{ dynamic: () => false }, { shaping: () => false }]) {
    const hold = createFontPickHold(state(overrides).state);
    hold.pick('Roboto', 'Arial');
    expect(hold.family('Roboto')).toBeUndefined();
  }
  const hold = createFontPickHold(state().state);
  hold.pick('Roboto', null);
  hold.pick('Roboto', 'Unloaded Serif');
  hold.pick(42, 'Arial');
  hold.pick('  ', 'Arial');
  expect(hold.family('Roboto')).toBeUndefined();
});

test('a family the resolver was not asked for yet is loading, not substituted', () => {
  const { state: s, asked } = state();
  const hold = createFontPickHold(s);
  expect(hold.loading('Roboto')).toBe(true);
  asked.add('roboto');
  expect(hold.loading('Roboto')).toBe(false);
  expect(createFontPickHold(state({ dynamic: () => false }).state).loading('Roboto')).toBe(false);
});

test('a second pick keeps the first hold, and clear releases every hold', () => {
  const hold = createFontPickHold(state().state);
  hold.pick('Roboto', 'Arial');
  hold.pick('Roboto', 'Calibri');
  expect(hold.family('Roboto')).toBe('Arial');
  hold.clear();
  expect(hold.family('Roboto')).toBeUndefined();
});
