import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

export type ParagraphNumberRow = {
  id: string;
  label: string;
  ariaLabel: string;
  value: number;
  unit: string;
  step: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange?: (value: number) => void;
};

export interface ParagraphNumberGroupProps {
  title: string;
  rows: ParagraphNumberRow[];
  disabled?: boolean;
  width?: number;
}

const groupStyle: CSSProperties = {
  display: 'grid',
  gridTemplateRows: 'auto repeat(2, 22px)',
  rowGap: 4,
  alignContent: 'start',
  height: '100%',
  minWidth: 120,
  paddingTop: 2,
};

const titleStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--doc-text-muted, #6b7280)',
  fontWeight: 600,
  letterSpacing: '0.2px',
  textTransform: 'none',
};

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '36px 1fr 16px',
  alignItems: 'center',
  gap: 4,
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--doc-text, #374151)',
};

const inputStyle: CSSProperties = {
  height: 22,
  border: '1px solid var(--doc-border, #d1d5db)',
  borderRadius: 4,
  padding: '0 4px',
  fontSize: 11,
  color: 'var(--doc-text, #374151)',
  textAlign: 'right',
  background: 'white',
  width: '100%',
};

const unitStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--doc-text-muted, #6b7280)',
  textAlign: 'left',
};

function countDecimals(step: number) {
  const stepString = step.toString();
  const dotIndex = stepString.indexOf('.');
  return dotIndex >= 0 ? stepString.length - dotIndex - 1 : 0;
}

function ParagraphNumberRowInput({ row, disabled }: { row: ParagraphNumberRow; disabled: boolean }) {
  const decimals = useMemo(() => countDecimals(row.step), [row.step]);
  const formatValue = useCallback(
    (value: number) => (decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString()),
    [decimals]
  );

  const [inputValue, setInputValue] = useState(() => formatValue(row.value));

  useEffect(() => {
    setInputValue(formatValue(row.value));
  }, [formatValue, row.value]);

  const clampValue = useCallback(
    (next: number) => {
      let result = next;
      if (row.min !== undefined) result = Math.max(row.min, result);
      if (row.max !== undefined) result = Math.min(row.max, result);
      return result;
    },
    [row.max, row.min]
  );

  const commitValue = useCallback(
    (raw: string) => {
      const parsed = Number.parseFloat(raw);
      if (Number.isNaN(parsed)) {
        setInputValue(formatValue(row.value));
        return;
      }
      const next = clampValue(parsed);
      row.onChange?.(next);
      setInputValue(formatValue(next));
    },
    [clampValue, formatValue, row]
  );

  const handleChange = useCallback(
    (value: string) => {
      setInputValue(value);
      const parsed = Number.parseFloat(value);
      if (!Number.isNaN(parsed)) {
        row.onChange?.(clampValue(parsed));
      }
    },
    [clampValue, row]
  );

  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{row.label}</span>
      <input
        type="number"
        aria-label={row.ariaLabel}
        value={inputValue}
        step={row.step}
        min={row.min}
        max={row.max}
        inputMode="decimal"
        style={inputStyle}
        disabled={disabled || row.disabled}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={(e) => commitValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitValue((e.target as HTMLInputElement).value);
          } else if (e.key === 'Escape') {
            setInputValue(formatValue(row.value));
          }
        }}
      />
      <span style={unitStyle}>{row.unit}</span>
    </div>
  );
}

export function ParagraphNumberGroup({
  title,
  rows,
  disabled = false,
  width,
}: ParagraphNumberGroupProps) {
  return (
    <div
      style={{
        ...groupStyle,
        minWidth: width ?? groupStyle.minWidth,
        width: width ?? groupStyle.minWidth,
      }}
    >
      <span style={titleStyle}>{title}</span>
      {rows.map((row) => (
        <ParagraphNumberRowInput key={row.id} row={row} disabled={disabled} />
      ))}
    </div>
  );
}
