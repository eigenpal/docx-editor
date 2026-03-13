import { describe, it, expect } from 'bun:test';
import { ribbonConfig, type RibbonItem } from './ribbonConfig';
import { ribbonIcons } from './ribbonIcons';

function collectIcons(items: RibbonItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.type === 'button' && item.icon) {
      ids.push(item.icon);
    }
  }
  return ids;
}

describe('ribbonIcons', () => {
  it('covers all icon ids referenced in ribbon config', () => {
    const iconIds = new Set<string>();
    for (const tab of ribbonConfig.tabs) {
      for (const group of tab.groups) {
        for (const icon of collectIcons(group.items)) {
          iconIds.add(icon);
        }
      }
    }

    for (const iconId of iconIds) {
      expect(ribbonIcons[iconId]).toBeDefined();
      expect(ribbonIcons[iconId]?.material).toBeTruthy();
    }
  });
});
