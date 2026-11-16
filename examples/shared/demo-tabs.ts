// The tabs of the demo side panel, shared by the React and Vue examples.

export type DemoPanelTab = 'chart' | 'shape' | 'settings';

export const DEMO_PANEL_TABS: readonly {
  readonly id: DemoPanelTab;
  readonly icon: 'chart' | 'shape' | 'settings';
}[] = [
  { id: 'chart', icon: 'chart' },
  { id: 'shape', icon: 'shape' },
  { id: 'settings', icon: 'settings' },
];

/** What the selection holds: a chart shows the Chart tab, a shape the Format shape tab. */
export interface DemoSelection {
  readonly chart: boolean;
  readonly shape: boolean;
}

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

/** The tabs that the panel shows: Chart while a chart is selected, Format shape for a shape. */
export function visibleDemoTabs(selection: DemoSelection): typeof DEMO_PANEL_TABS {
  return DEMO_PANEL_TABS.filter((entry) => entry.id === 'settings' || selection[entry.id]);
}

/** The tab that the panel shows: Settings when the chosen tab's selection is gone. */
export function shownDemoTab(tab: DemoPanelTab, selection: DemoSelection): DemoPanelTab {
  return tab === 'settings' || selection[tab] ? tab : 'settings';
}
