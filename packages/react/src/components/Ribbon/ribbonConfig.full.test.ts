import { describe, it, expect } from 'bun:test';
import { ribbonConfig } from './ribbonConfig';

describe('ribbonConfig (full)', () => {
  it('includes all primary tabs', () => {
    const labels = ribbonConfig.tabs.map((t) => t.label);
    expect(labels).toContain('Home');
    expect(labels).toContain('Insert');
    expect(labels).toContain('Layout');
    expect(labels).toContain('Review');
    expect(labels).toContain('View');
    expect(labels).toContain('References');
    expect(labels).toContain('Developer');
    expect(labels).toContain('Table Design');
    expect(labels).toContain('Table Layout');
    expect(labels).toContain('Header & Footer');
    expect(labels).toContain('Picture Format');
  });
});
