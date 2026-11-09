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

/** The tabs that the panel shows: the Chart tab only while a chart is selected. */
export function visibleDemoTabs(chartSelected: boolean): typeof DEMO_PANEL_TABS {
  return chartSelected ? DEMO_PANEL_TABS : DEMO_PANEL_TABS.filter((entry) => entry.id !== 'chart');
}

/** The tab that the panel shows: Settings when the chosen tab is Chart and no chart is selected. */
export function shownDemoTab(tab: DemoPanelTab, chartSelected: boolean): DemoPanelTab {
  return tab === 'chart' && !chartSelected ? 'settings' : tab;
}
