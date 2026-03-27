/**
 * TableMergeButton - Toggle button for merge/split cells
 */

import React, { useCallback } from 'react';
import { MaterialSymbol } from './MaterialSymbol';
import { Button } from './Button';
import { Tooltip } from './Tooltip';
import { cn } from '../../lib/utils';
import type { TableAction } from './TableToolbar';
import { useTranslation } from '../../i18n';

export interface TableMergeButtonProps {
  onAction: (action: TableAction) => void;
  disabled?: boolean;
  canMerge?: boolean;
  canSplit?: boolean;
}

export function TableMergeButton({
  onAction,
  disabled = false,
  canMerge = false,
  canSplit = false,
}: TableMergeButtonProps) {
  const { t } = useTranslation();
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleMerge = useCallback(() => {
    if (canMerge) onAction('mergeCells');
  }, [onAction, canMerge]);

  const handleSplit = useCallback(() => {
    if (canSplit) onAction('splitCell');
  }, [onAction, canSplit]);

  const mergeButton = (
    <Tooltip content={t('table.mergeCells')}>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(
          'text-slate-500 hover:text-slate-900 hover:bg-slate-100/80',
          (disabled || !canMerge) && 'opacity-30 cursor-not-allowed'
        )}
        onMouseDown={handleMouseDown}
        onClick={handleMerge}
        disabled={disabled || !canMerge}
        aria-label={t('table.mergeCells')}
        data-testid="toolbar-table-merge"
      >
        <MaterialSymbol name="call_merge" size={20} />
      </Button>
    </Tooltip>
  );

  const splitButton = (
    <Tooltip content={t('table.splitCell')}>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(
          'text-slate-500 hover:text-slate-900 hover:bg-slate-100/80',
          (disabled || !canSplit) && 'opacity-30 cursor-not-allowed'
        )}
        onMouseDown={handleMouseDown}
        onClick={handleSplit}
        disabled={disabled || !canSplit}
        aria-label={t('table.splitCell')}
        data-testid="toolbar-table-split"
      >
        <MaterialSymbol name="call_split" size={20} />
      </Button>
    </Tooltip>
  );

  return (
    <>
      {mergeButton}
      {splitButton}
    </>
  );
}

export default TableMergeButton;
