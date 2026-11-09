// The tabs of the demo side panel, shared by the React and Vue examples.

export type DemoPanelTab = 'chart' | 'settings';

export const DEMO_PANEL_TABS: readonly {
  readonly id: DemoPanelTab;
  readonly icon: 'chart' | 'settings';
}[] = [
  { id: 'chart', icon: 'chart' },
  { id: 'settings', icon: 'settings' },
];

/**
 * The tab that a key moves to in a row of `count` tabs, or null for another key. The arrow
 * keys follow the reading direction, so in a right-to-left interface Left moves forward.
 */
export function nextDemoTab(
  key: string,
  index: number,
  count: number,
  rtl: boolean
): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
  const back = rtl ? 'ArrowRight' : 'ArrowLeft';
  if (key === forward) return (index + 1) % count;
  if (key === back) return (index - 1 + count) % count;
  return null;
}

/** Whether the demo starts with the panel open: only where it fits beside a full page. */
export function demoPanelFits(): boolean {
  return typeof window !== 'undefined' && window.innerWidth >= 1280;
}
