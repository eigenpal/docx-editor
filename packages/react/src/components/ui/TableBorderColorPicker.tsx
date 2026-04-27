/**
 * TableBorderColorPicker - Wrapper around ColorPicker for table border colors.
 *
 * Translates ColorPicker's ColorValue output to the TableAction format
 * expected by the toolbar's table action handler.
 */

import { useCallback } from 'react';
import type { ColorValue } from '@eigenpal/docx-core/types/document';
import type { Theme } from '@eigenpal/docx-core/types/document';
import type { TableAction } from './TableToolbar';
import { ColorPicker } from './ColorPicker';
import { useTranslation } from '../../i18n';

export interface TableBorderColorPickerProps {
  onAction: (action: TableAction) => void;
  disabled?: boolean;
  theme?: Theme | null;
  /** Current border color (RGB hex without #) */
  value?: string;
}

export function TableBorderColorPicker({
  onAction,
  disabled = false,
  theme,
  value,
}: TableBorderColorPickerProps) {
  const { t } = useTranslation();
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
    <ColorPicker
      mode="border"
      value={value}
      onChange={handleChange}
      theme={theme}
      disabled={disabled}
      title={t('table.borderColor')}
    />
  );
}

export default TableBorderColorPicker;
