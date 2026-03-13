import { describe, it, expect } from 'bun:test';
import { buildSpellcheckMenuItems } from './menu-utils';

describe('spellcheck menu utils', () => {
  it('builds suggestion items with actions', () => {
    const items = buildSpellcheckMenuItems(['world']);
    expect(items[0].label).toBe('world');
    expect(items[0].action).toBe('replace');
  });
});
