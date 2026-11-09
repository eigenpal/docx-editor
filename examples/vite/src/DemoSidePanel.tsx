// The side panel of the demo: a card beside the pages with two tabs, Chart and Settings. The
// Chart tab holds the library's `DocxEditor.ChartPane`. Insert > Chart and Edit chart ask for
// it through `usePaneRequest`; the pane itself moves the focus when Edit chart asks for it.
// The Vue example has the same panel (`examples/vue/src/DemoSidePanel.vue`).
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { DocxEditor, useDocxEditor, usePaneRequest } from '@docx-editor.dev/react';
import { exampleText as t } from '../../shared/example-text';
import { DEMO_PANEL_TABS, nextDemoTab, type DemoPanelTab } from '../../shared/demo-tabs';
import { DemoIcon } from './DemoIcon';

/** Opens the panel on the Chart tab when the chrome asks for the Chart pane. */
export function useChartPaneRequests(open: (tab: DemoPanelTab) => void): void {
  usePaneRequest((request) => {
    if (request.pane === 'chart') open('chart');
  });
}

export interface DemoSidePanelProps {
  readonly tab: DemoPanelTab;
  readonly onTabChange: (tab: DemoPanelTab) => void;
  readonly onClose: () => void;
  /** The body of the Settings tab. */
  readonly settings: ReactNode;
}

export function DemoSidePanel({ tab, onTabChange, onClose, settings }: DemoSidePanelProps) {
  const editor = useDocxEditor();
  const id = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const close = () => {
    onClose();
    editor?.focus();
  };
  // The arrow keys, Home, and End move between the tabs, and the focused tab opens.
  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = DEMO_PANEL_TABS.findIndex((entry) => entry.id === tab);
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const next = nextDemoTab(event.key, index, DEMO_PANEL_TABS.length, rtl);
    if (next === null) return;
    event.preventDefault();
    onTabChange(DEMO_PANEL_TABS[next]!.id);
    tabsRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <aside
      id="demo-side-panel"
      className="demo-panel"
      aria-label={t('demoPanel.label')}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        close();
      }}
    >
      <div className="demo-panel__head">
        <div
          ref={tabsRef}
          className="demo-tabs"
          role="tablist"
          aria-label={t('demoPanel.tabs')}
          onKeyDown={onTabsKeyDown}
        >
          {DEMO_PANEL_TABS.map((entry) => {
            const selected = entry.id === tab;
            const label = t(`demoPanel.${entry.id}`);
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`${id}-tab-${entry.id}`}
                aria-selected={selected}
                // Only the open tab's panel is mounted, so only it names one.
                aria-controls={selected ? `${id}-panel-${entry.id}` : undefined}
                aria-label={label}
                title={selected ? undefined : label}
                tabIndex={selected ? 0 : -1}
                className="demo-tabs__tab"
                onClick={() => onTabChange(entry.id)}
              >
                <DemoIcon name={entry.icon} />
                <span className="demo-tabs__label">{label}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="demo-header-action demo-header-action--icon"
          aria-label={t('demoPanel.close')}
          title={t('demoPanel.close')}
          onClick={close}
        >
          <DemoIcon name="close" />
        </button>
      </div>
      <div
        className="demo-panel__body"
        role="tabpanel"
        id={`${id}-panel-${tab}`}
        aria-labelledby={`${id}-tab-${tab}`}
      >
        {tab === 'chart' ? <DocxEditor.ChartPane /> : settings}
      </div>
    </aside>
  );
}
