/**
 * TableCellFillPicker - Wrapper around AdvancedColorPicker for table cell fill/shading.
 *
 * Translates AdvancedColorPicker's output to the TableAction format
 * expected by the toolbar's table action handler.
 */

import { useCallback } from 'react';
import type { ColorValue, Theme } from '@eigenpal/docx-core/types/document';
import type { TableAction } from './TableToolbar';
import { AdvancedColorPicker } from './AdvancedColorPicker';
import { useTranslation } from '../../i18n';

export interface TableCellFillPickerProps {
  onAction: (action: TableAction) => void;
  disabled?: boolean;
  theme?: Theme | null;
  /** Current fill color (RGB hex without #) */
  value?: string;
}

export function TableCellFillPicker({
  onAction,
  disabled = false,
  theme,
  value,
}: TableCellFillPickerProps) {
  const { t } = useTranslation();
  const handleChange = useCallback(
    (color: ColorValue | string) => {
      // highlight mode emits hex strings or 'none'
      if (typeof color === 'string') {
        if (color === 'none') {
          onAction({ type: 'cellFillColor', color: null });
        } else {
          onAction({ type: 'cellFillColor', color: color.replace(/^#/, '') });
        }
      }
    },
    [onAction]
  );

  return (
    <AdvancedColorPicker
      mode="highlight"
      value={value}
      onChange={handleChange}
      theme={theme}
      disabled={disabled}
      title={t('table.cellFillColor')}
      icon="format_color_fill"
      autoLabel={t('colorPicker.noColor')}
    />
  );
}

export default TableCellFillPicker;
