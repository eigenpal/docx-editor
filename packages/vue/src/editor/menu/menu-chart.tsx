// The Insert > Chart row: a submenu of chart types when the engine can insert a chart, a plain
// disabled row with the engine's reason when it cannot. A pick inserts the chart, closes the
// menu bar, and asks the host to show the Chart pane without the focus.

import { defineComponent, type PropType } from 'vue';
import {
  CHART_INSERT_CHOICES,
  chartTypeIconPaths,
  chartTypeLabelKey,
  type ChromeMenuItemEntry,
} from '@docx-editor.dev/core/editor';
import { useEditorValueCommand } from '../useEditorValueCommand';
import { chromeControlForSlot, chromeIcon } from '../toolbar/ToolbarButton';
import { useMenuContext, useMenuLabel } from './menu-context';
import { MenuItem, MenuRow } from './parts';
import { MenuSubmenu } from './menu-flyouts';

/** The Insert > Chart row of the menu bar. */
export const MenuChartPicker = defineComponent({
  name: 'MenuChartPicker',
  props: {
    entry: { type: Object as PropType<ChromeMenuItemEntry>, required: true },
  },
  setup(props) {
    const command = useEditorValueCommand('insert.chart');
    const menuContext = useMenuContext();
    const label = useMenuLabel();
    const control = chromeControlForSlot(props.entry.slot);
    return () => {
      if (!command.isEnabled.value)
        return (
          <MenuItem
            slotId={props.entry.slot}
            {...(props.entry.labelKey ? { labelKey: props.entry.labelKey } : {})}
          />
        );
      return (
        <MenuSubmenu
          labelKey={props.entry.labelKey ?? control?.labelKey ?? props.entry.slot}
          paths={control?.paths}
        >
          {{
            default: () =>
              CHART_INSERT_CHOICES.map((type) => (
                <MenuRow
                  key={type}
                  rowSlot={props.entry.slot}
                  data-value={type}
                  icon={chromeIcon(chartTypeIconPaths(type)) ?? undefined}
                  onSelect={() => {
                    command.execute(type);
                    menuContext.value.setOpenMenu(null);
                  }}
                >
                  {{ default: () => label(chartTypeLabelKey(type)) }}
                </MenuRow>
              )),
          }}
        </MenuSubmenu>
      );
    };
  },
});
