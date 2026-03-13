import { describe, it, expect } from 'bun:test';
import { ribbonConfig } from './ribbonConfig';

describe('ribbonConfig', () => {
  it('includes Home and Insert tabs', () => {
    const labels = ribbonConfig.tabs.map((tab) => tab.label);
    expect(labels).toContain('Home');
    expect(labels).toContain('Insert');
  });
});
