import { describe, expect, test } from 'bun:test';
import { TOOLBAR_COLLAPSE_ORDER, TOOLBAR_PINNED_GROUPS, collapseOrder } from '../toolbar-fit.ts';

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

describe('toolbar collapse policy', () => {
  test('collapseOrder puts undeclared groups first, in reverse bar order', () => {
    const groups = ['history', 'zoom', 'custom', 'text'];
    expect(collapseOrder(groups)).toEqual(['custom', 'zoom', 'text', 'history']);
  });

  test('collapseOrder follows the declared order for known groups', () => {
    expect(collapseOrder([...BAR_GROUPS])).toEqual([...TOOLBAR_COLLAPSE_ORDER]);
  });

  test('pinned review is excluded from collapsible groups at the toolbar layer', () => {
    expect(TOOLBAR_PINNED_GROUPS.has('review')).toBe(true);
    expect(BAR_GROUPS.includes('review' as (typeof BAR_GROUPS)[number])).toBe(false);
  });
});
