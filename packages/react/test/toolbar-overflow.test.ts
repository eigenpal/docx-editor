import { describe, expect, test } from 'bun:test';
import {
  TOOLBAR_COLLAPSE_ORDER,
  TOOLBAR_OVERFLOW_HYSTERESIS,
  TOOLBAR_PINNED_GROUPS,
  collapseOrder,
  sameOverflow,
  toolbarOverflowGroups,
  type ToolbarFitInput,
} from '../src/editor/toolbar/toolbar-overflow.ts';

function fit(
  available: number,
  widths: Record<string, number>,
  groups: readonly string[],
  order: readonly string[],
  fixed = 0,
  more = 34,
  previous?: ReadonlySet<string>,
  hysteresis?: number
): ReadonlySet<string> {
  const input: ToolbarFitInput = {
    available,
    widths: new Map(Object.entries(widths)),
    groups,
    order,
    fixed,
    more,
    previous,
    hysteresis,
  };
  return toolbarOverflowGroups(input);
}

const BAR_GROUPS = [
  'history',
  'zoom',
  'styles',
  'font',
  'text',
  'script',
  'alignment',
  'list',
  'format',
] as const;

describe('toolbar overflow policy', () => {
  test('collapseOrder puts undeclared groups first, in reverse bar order', () => {
    const groups = ['history', 'zoom', 'custom', 'text'];
    expect(collapseOrder(groups)).toEqual(['custom', 'zoom', 'text', 'history']);
  });

  test('collapseOrder follows the declared order for known groups', () => {
    expect(collapseOrder([...BAR_GROUPS])).toEqual([...TOOLBAR_COLLAPSE_ORDER]);
  });

  test('an unmeasured bar overflows nothing', () => {
    expect(fit(0, { zoom: 100 }, ['zoom'], TOOLBAR_COLLAPSE_ORDER).size).toBe(0);
    expect(fit(-10, { zoom: 100 }, ['zoom'], TOOLBAR_COLLAPSE_ORDER).size).toBe(0);
  });

  test('collapses in declared order, zoom first', () => {
    const widths = Object.fromEntries(BAR_GROUPS.map((id) => [id, 100]));
    const order = collapseOrder(BAR_GROUPS);
    const overflow = fit(400, widths, BAR_GROUPS, order, 120, 34);
    expect(overflow.has('zoom')).toBe(true);
    expect(overflow.has('history')).toBe(false);
    expect(overflow.has('text')).toBe(false);
    expect([...overflow][0]).toBe('zoom');
  });

  test('accounts for the More trigger width once overflow is needed', () => {
    const widths = { keep: 100, drop: 50 };
    const groups = ['keep', 'drop'];
    const order = ['drop', 'keep'];
    expect(fit(150, widths, groups, order, 0, 34).size).toBe(0);
    expect(fit(149, widths, groups, order, 0, 34)).toEqual(new Set(['drop']));
  });

  test('hysteresis keeps a group in overflow until surplus clears the slack', () => {
    const widths = { keep: 100, drop: 100 };
    const groups = ['keep', 'drop'];
    const order = ['drop', 'keep'];
    const previous = new Set(['drop']);
    expect(fit(200, widths, groups, order, 0, 34, previous, TOOLBAR_OVERFLOW_HYSTERESIS)).toEqual(
      previous
    );
    expect(fit(224, widths, groups, order, 0, 34, previous, TOOLBAR_OVERFLOW_HYSTERESIS).size).toBe(
      0
    );
  });

  test('pinned review is excluded from collapsible groups at the toolbar layer', () => {
    expect(TOOLBAR_PINNED_GROUPS.has('review')).toBe(true);
    expect(BAR_GROUPS.includes('review' as (typeof BAR_GROUPS)[number])).toBe(false);
  });

  test('sameOverflow compares set contents', () => {
    const a = new Set(['zoom']);
    const b = new Set(['zoom']);
    expect(sameOverflow(a, b)).toBe(true);
    expect(sameOverflow(a, new Set(['text']))).toBe(false);
    expect(sameOverflow(a, a)).toBe(true);
  });
});
