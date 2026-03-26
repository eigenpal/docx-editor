import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { MaterialSymbol } from './MaterialSymbol';

export interface RibbonNumberStepperProps {
  label: string;
  value?: number;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange?: (value: number) => void;
  ariaLabel?: string;
  width?: number;
}

const containerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 96,
  height: 30,
};

const labelStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--doc-text-muted, #6b7280)',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  minWidth: 40,
};

const controlStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  border: '1px solid var(--doc-border, #d1d5db)',
  borderRadius: 4,
  padding: '0 2px',
  background: 'white',
  height: 24,
};

const buttonStyle: CSSProperties = {
  width: 14,
  height: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  borderRadius: 2,
  color: 'var(--doc-text, #374151)',
};

const buttonDisabledStyle: CSSProperties = {
  ...buttonStyle,
  opacity: 0.4,
  cursor: 'default',
};

const inputStyle: CSSProperties = {
  width: 24,
  border: 'none',
  outline: 'none',
  textAlign: 'right',
  fontSize: 11,
  color: 'var(--doc-text, #374151)',
  background: 'transparent',
};

const unitStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--doc-text-muted, #6b7280)',
  paddingRight: 2,
  minWidth: 12,
  textAlign: 'left',
};

const stepperStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 1,
  borderLeft: '1px solid var(--doc-border, #d1d5db)',
  paddingLeft: 2,
  height: '100%',
};

function countDecimals(step: number) {
  const stepString = step.toString();
  const dotIndex = stepString.indexOf('.');
  return dotIndex >= 0 ? stepString.length - dotIndex - 1 : 0;
}

export function RibbonNumberStepper({
  label,
  value,
  unit,
  step = 1,
  min = 0,
  max,
  disabled = false,
  onChange,
  ariaLabel,
  width,
}: RibbonNumberStepperProps) {
  const decimals = useMemo(() => countDecimals(step), [step]);
  const formatValue = useCallback(
    (nextValue?: number) => {
      if (nextValue === undefined || Number.isNaN(nextValue)) return '';
      return decimals > 0 ? nextValue.toFixed(decimals) : Math.round(nextValue).toString();
    },
    [decimals]
  );

  const [inputValue, setInputValue] = useState(() => formatValue(value));

  useEffect(() => {
    setInputValue(formatValue(value));
  }, [formatValue, value]);

  const clampValue = useCallback(
    (next: number) => {
      let result = next;
      if (min !== undefined) result = Math.max(min, result);
      if (max !== undefined) result = Math.min(max, result);
      return result;
    },
    [min, max]
  );

  const normalizeValue = useCallback(
    (next: number) => {
      if (!step) return next;
      const rounded = Math.round(next / step) * step;
      return Number(rounded.toFixed(decimals));
    },
    [step, decimals]
  );

  const commitValue = useCallback(
    (raw: string) => {
      const parsed = Number.parseFloat(raw);
      if (Number.isNaN(parsed)) return;
      const next = normalizeValue(clampValue(parsed));
      onChange?.(next);
      setInputValue(formatValue(next));
    },
    [clampValue, formatValue, normalizeValue, onChange]
  );

  const handleDecrease = useCallback(() => {
    if (disabled) return;
    const current = value ?? 0;
    const next = normalizeValue(clampValue(current - step));
    onChange?.(next);
  }, [disabled, value, step, clampValue, normalizeValue, onChange]);

  const handleIncrease = useCallback(() => {
    if (disabled) return;
    const current = value ?? 0;
    const next = normalizeValue(clampValue(current + step));
    onChange?.(next);
  }, [disabled, value, step, clampValue, normalizeValue, onChange]);

  return (
    <div
      style={{
        ...containerStyle,
        minWidth: width ?? containerStyle.minWidth,
        width: width ?? containerStyle.minWidth,
      }}
    >
      <span style={labelStyle}>{label}</span>
      <div style={controlStyle}>
        <input
          aria-label={ariaLabel ?? label}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={() => commitValue(inputValue)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitValue(inputValue);
            } else if (e.key === 'Escape') {
              setInputValue(formatValue(value));
            }
          }}
          inputMode="decimal"
          style={inputStyle}
          disabled={disabled}
        />
        {unit && <span style={unitStyle}>{unit}</span>}
        <div style={stepperStyle}>
          <button
            type="button"
            aria-label={`Increase ${ariaLabel ?? label}`}
            style={disabled ? buttonDisabledStyle : buttonStyle}
            onClick={handleIncrease}
            onMouseDown={(e) => e.preventDefault()}
            disabled={disabled}
          >
            <MaterialSymbol name="keyboard_arrow_up" size={12} />
          </button>
          <button
            type="button"
            aria-label={`Decrease ${ariaLabel ?? label}`}
            style={disabled ? buttonDisabledStyle : buttonStyle}
            onClick={handleDecrease}
            onMouseDown={(e) => e.preventDefault()}
            disabled={disabled}
          >
            <MaterialSymbol name="keyboard_arrow_down" size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
