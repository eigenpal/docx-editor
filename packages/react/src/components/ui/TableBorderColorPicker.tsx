/**
 * TableBorderColorPicker - Wrapper around AdvancedColorPicker for table border colors.
 *
 * Translates AdvancedColorPicker's ColorValue output to the TableAction format
 * expected by the toolbar's table action handler.
 */

import { useCallback } from 'react';
import type { ColorValue } from '@eigenpal/docx-core/types/document';
import type { Theme } from '@eigenpal/docx-core/types/document';
import type { TableAction } from './TableToolbar';
import { AdvancedColorPicker } from './AdvancedColorPicker';

export interface TableBorderColorPickerProps {
  onAction: (action: TableAction) => void;
  disabled?: boolean;
  theme?: Theme | null;
}

export function TableBorderColorPicker({
  onAction,
  disabled = false,
  theme,
}: TableBorderColorPickerProps) {
  const handleChange = useCallback(
    (color: ColorValue | string) => {
      if (typeof color === 'string') {
        onAction({ type: 'borderColor', color: color.replace(/^#/, '') });
      } else if (color.rgb) {
        onAction({ type: 'borderColor', color: color.rgb.replace(/^#/, '') });
      } else if (color.auto) {
        onAction({ type: 'borderColor', color: '000000' });
      }
    },
    [onAction]
  );

  return (
    <AdvancedColorPicker
      mode="border"
      onChange={handleChange}
      theme={theme}
      disabled={disabled}
      title="Border Color"
    />
  );
}

export default TableBorderColorPicker;
