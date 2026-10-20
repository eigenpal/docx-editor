// Insert › Watermark. Kept in its own file, so the menu parts file stays under its line cap.

import { defineComponent } from 'vue';
import { chromeProbeForSlot } from '@docx-editor.dev/core/editor';
import { useEditorCommand } from '../useEditorCommand';
import { chromeControlForSlot, chromeIcon } from '../toolbar/ToolbarButton';
import { useMenuContext, useMenuLabel } from './menu-context';
import { MenuRow, menuRowSlot } from './parts';

/**
 * The Watermark dialog, from the Insert menu. The Vue twin of the React row.
 *
 * Same shape as page setup: no fixed command to dispatch, so the row asks through the
 * slot's probe and is disabled with the engine's own words on a document it cannot rewrite.
 */
const MenuWatermarkImpl = defineComponent({
  name: 'MenuWatermarkImpl',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const command = useEditorCommand(chromeProbeForSlot('insert.watermark')!);
    const menuContext = useMenuContext();
    const label = useMenuLabel();
    return () => {
      if (props.hidden) return null;
      const context = menuContext.value;
      const engineReason = command.disabledReason.value;
      const control = chromeControlForSlot('insert.watermark');
      const text = label(control?.labelKey ?? 'toolbar.watermark');
      const enabled = command.isEnabled.value && !!context.onWatermarkDialog;
      return (
        <MenuRow
          {...menuRowSlot('insert.watermark')}
          icon={chromeIcon(control?.paths) ?? undefined}
          disabled={!enabled}
          {...(engineReason ? { title: engineReason } : {})}
          selectHandler={() => {
            context.onWatermarkDialog?.();
            context.setOpenMenu(null);
          }}
          {...(props.className ? { className: props.className } : {})}
        >
          {{ default: () => text }}
        </MenuRow>
      );
    };
  },
});

/** Insert › Watermark, so a host can hide it or place it elsewhere by name. @public */
export const MenuWatermark = Object.assign(MenuWatermarkImpl, {
  docxSlot: 'insert.watermark' as const,
});
