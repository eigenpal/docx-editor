import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from '../../i18n';

export interface SplitCellDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (rows: number, cols: number) => void;
  initialRows?: number;
  initialCols?: number;
  minRows?: number;
  minCols?: number;
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const dialogStyle: CSSProperties = {
  backgroundColor: 'white',
  borderRadius: 8,
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
  minWidth: 360,
  maxWidth: 440,
  width: '100%',
  margin: 20,
};

const headerStyle: CSSProperties = {
  padding: '16px 20px 12px',
  borderBottom: '1px solid var(--doc-border)',
  fontSize: 16,
  fontWeight: 600,
};

const bodyStyle: CSSProperties = {
  padding: '16px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const labelStyle: CSSProperties = {
  width: 88,
  fontSize: 13,
  color: 'var(--doc-text-muted)',
};

const inputStyle: CSSProperties = {
  flex: 1,
  padding: '6px 8px',
  border: '1px solid var(--doc-border)',
  borderRadius: 4,
  fontSize: 13,
};

const helperStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--doc-text-muted)',
  lineHeight: 1.5,
};

const errorStyle: CSSProperties = {
  ...helperStyle,
  color: 'var(--doc-error)',
};

const footerStyle: CSSProperties = {
  padding: '12px 20px 16px',
  borderTop: '1px solid var(--doc-border)',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

const btnStyle: CSSProperties = {
  padding: '6px 16px',
  fontSize: 13,
  border: '1px solid var(--doc-border)',
  borderRadius: 4,
  cursor: 'pointer',
};

export function SplitCellDialog({
  isOpen,
  onClose,
  onApply,
  initialRows = 1,
  initialCols = 1,
  minRows = 1,
  minCols = 1,
}: SplitCellDialogProps): React.ReactElement | null {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initialRows);
  const [cols, setCols] = useState(initialCols);

  useEffect(() => {
    if (isOpen) {
      setRows(initialRows);
      setCols(initialCols);
    }
  }, [initialCols, initialRows, isOpen]);

  const validationError = useMemo(() => {
    if (rows < minRows || cols < minCols) {
      return t('dialogs.splitCell.minValue', { rows: minRows, cols: minCols });
    }
    if (rows === 1 && cols === 1) {
      return t('dialogs.splitCell.notOneByOne');
    }
    return null;
  }, [cols, minCols, minRows, rows, t]);

  const handleApply = useCallback(() => {
    if (validationError) return;
    onApply(rows, cols);
    onClose();
  }, [cols, onApply, onClose, rows, validationError]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Enter') handleApply();
    },
    [handleApply, onClose]
  );

  if (!isOpen) return null;

  return (
    <div style={overlayStyle} onClick={onClose} onKeyDown={handleKeyDown}>
      <div
        style={dialogStyle}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={t('dialogs.splitCell.title')}
      >
        <div style={headerStyle}>{t('dialogs.splitCell.title')}</div>

        <div style={bodyStyle}>
          <div style={helperStyle}>{t('dialogs.splitCell.description')}</div>

          <div style={rowStyle}>
            <label style={labelStyle}>{t('dialogs.splitCell.rowsLabel')}</label>
            <input
              type="number"
              style={inputStyle}
              min={minRows}
              step={1}
              value={rows}
              onChange={(event) => setRows(Math.max(0, Number(event.target.value) || 0))}
            />
          </div>

          <div style={rowStyle}>
            <label style={labelStyle}>{t('dialogs.splitCell.columnsLabel')}</label>
            <input
              type="number"
              style={inputStyle}
              min={minCols}
              step={1}
              value={cols}
              onChange={(event) => setCols(Math.max(0, Number(event.target.value) || 0))}
            />
          </div>

          <div style={validationError ? errorStyle : helperStyle}>
            {validationError ??
              t('dialogs.splitCell.currentMinimum', { rows: minRows, cols: minCols })}
          </div>
        </div>

        <div style={footerStyle}>
          <button type="button" style={btnStyle} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={{
              ...btnStyle,
              backgroundColor: 'var(--doc-primary)',
              color: 'white',
              borderColor: 'var(--doc-primary)',
              opacity: validationError ? 0.6 : 1,
              cursor: validationError ? 'not-allowed' : 'pointer',
            }}
            disabled={!!validationError}
            onClick={handleApply}
          >
            {t('common.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SplitCellDialog;
