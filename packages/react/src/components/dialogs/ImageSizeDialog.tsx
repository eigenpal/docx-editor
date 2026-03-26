import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { applyLockedDimensionChange } from './imageSizeUtils';

export type ImageSizeDialogFocusTarget = 'width' | 'height' | 'lock';

export interface ImageSizeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (size: { width: number; height: number }) => void;
  initialWidth?: number;
  initialHeight?: number;
  initialLock?: boolean;
  autoFocus?: ImageSizeDialogFocusTarget;
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
  maxWidth: 420,
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
  gap: 10,
};

const labelStyle: CSSProperties = {
  width: 64,
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

const unitStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--doc-text-muted)',
  width: 20,
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

const lockButtonStyle: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 4,
  border: '1px solid var(--doc-border)',
  backgroundColor: 'white',
  fontSize: 12,
  cursor: 'pointer',
};

const lockButtonActiveStyle: CSSProperties = {
  ...lockButtonStyle,
  backgroundColor: 'var(--doc-primary)',
  borderColor: 'var(--doc-primary)',
  color: 'white',
};

export function ImageSizeDialog({
  isOpen,
  onClose,
  onApply,
  initialWidth = 0,
  initialHeight = 0,
  initialLock = true,
  autoFocus,
}: ImageSizeDialogProps): React.ReactElement | null {
  const [width, setWidth] = useState(initialWidth);
  const [height, setHeight] = useState(initialHeight);
  const [lockAspect, setLockAspect] = useState(initialLock);
  const [ratio, setRatio] = useState(0);
  const widthRef = useRef<HTMLInputElement>(null);
  const heightRef = useRef<HTMLInputElement>(null);
  const lockRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setWidth(initialWidth);
    setHeight(initialHeight);
    setLockAspect(initialLock);
    if (initialWidth > 0 && initialHeight > 0) {
      setRatio(initialWidth / initialHeight);
    } else {
      setRatio(0);
    }
  }, [isOpen, initialWidth, initialHeight, initialLock]);

  useEffect(() => {
    if (!isOpen) return;
    let target: HTMLElement | null = null;
    if (autoFocus === 'width') target = widthRef.current;
    if (autoFocus === 'height') target = heightRef.current;
    if (autoFocus === 'lock') target = lockRef.current;
    if (!target) return;
    target.focus({ preventScroll: true });
    if (target instanceof HTMLInputElement) {
      target.select();
    }
  }, [isOpen, autoFocus]);

  const handleWidthChange = useCallback(
    (value: number) => {
      const next = applyLockedDimensionChange({
        width,
        height,
        ratio,
        lock: lockAspect,
        changed: 'width',
        value,
      });
      setWidth(next.width);
      setHeight(next.height);
    },
    [width, height, ratio, lockAspect]
  );

  const handleHeightChange = useCallback(
    (value: number) => {
      const next = applyLockedDimensionChange({
        width,
        height,
        ratio,
        lock: lockAspect,
        changed: 'height',
        value,
      });
      setWidth(next.width);
      setHeight(next.height);
    },
    [width, height, ratio, lockAspect]
  );

  const handleToggleLock = useCallback(() => {
    setLockAspect((prev) => {
      const next = !prev;
      if (next && width > 0 && height > 0) {
        setRatio(width / height);
      }
      return next;
    });
  }, [width, height]);

  const canApply = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

  if (!isOpen) return null;

  return (
    <div style={overlayStyle} onClick={onClose} role="presentation">
      <div
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Image size"
        data-testid="image-size-dialog"
      >
        <div style={headerStyle}>Image Size</div>
        <div style={bodyStyle}>
          <div style={rowStyle}>
            <label style={labelStyle}>Width</label>
            <input
              type="number"
              style={inputStyle}
              min={1}
              step={1}
              value={width || ''}
              onChange={(e) => handleWidthChange(Number(e.target.value) || 0)}
              data-testid="image-size-width"
              ref={widthRef}
            />
            <span style={unitStyle}>px</span>
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>Height</label>
            <input
              type="number"
              style={inputStyle}
              min={1}
              step={1}
              value={height || ''}
              onChange={(e) => handleHeightChange(Number(e.target.value) || 0)}
              data-testid="image-size-height"
              ref={heightRef}
            />
            <span style={unitStyle}>px</span>
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>Lock</label>
            <button
              type="button"
              onClick={handleToggleLock}
              style={lockAspect ? lockButtonActiveStyle : lockButtonStyle}
              aria-pressed={lockAspect}
              data-testid="image-size-lock"
              ref={lockRef}
            >
              {lockAspect ? 'On' : 'Off'}
            </button>
          </div>
        </div>
        <div style={footerStyle}>
          <button type="button" style={btnStyle} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            style={{
              ...btnStyle,
              backgroundColor: canApply ? 'var(--doc-primary)' : 'var(--doc-border)',
              color: canApply ? 'white' : 'var(--doc-text-muted)',
              borderColor: canApply ? 'var(--doc-primary)' : 'var(--doc-border)',
              cursor: canApply ? 'pointer' : 'not-allowed',
            }}
            onClick={() => {
              if (canApply) onApply({ width, height });
            }}
            disabled={!canApply}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImageSizeDialog;
