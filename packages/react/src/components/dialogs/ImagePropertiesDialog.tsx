/**
 * Image Properties Dialog
 *
 * Modal for editing image properties:
 * - Alt text for accessibility
 * - Border/outline style, color, and width
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from '../../i18n';
import { useAspectLockedSize } from '../../hooks/useAspectLockedSize';

// ============================================================================
// TYPES
// ============================================================================

export interface ImagePropertiesData {
  alt?: string;
  borderWidth?: number;
  borderColor?: string;
  borderKind?: string;
  width?: number;
  height?: number;
}

export interface ImagePropertiesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (data: ImagePropertiesData) => void;
  currentData?: ImagePropertiesData;
}

// ============================================================================
// STYLES
// ============================================================================

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
  minWidth: 380,
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
  gap: 16,
};

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const sectionLabelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--doc-text)',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const labelStyle: CSSProperties = {
  width: 60,
  fontSize: 12,
  color: 'var(--doc-text-muted)',
};

const inputStyle: CSSProperties = {
  flex: 1,
  padding: '4px 6px',
  border: '1px solid var(--doc-border)',
  borderRadius: 4,
  fontSize: 12,
};

const selectStyle: CSSProperties = {
  ...inputStyle,
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 60,
  resize: 'vertical' as const,
  fontFamily: 'inherit',
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

// ============================================================================
// COMPONENT
// ============================================================================

export function ImagePropertiesDialog({
  isOpen,
  onClose,
  onApply,
  currentData,
}: ImagePropertiesDialogProps): React.ReactElement | null {
  const { t } = useTranslation();
  const [alt, setAlt] = useState('');
  const [borderWidth, setBorderWidth] = useState(0);
  const [borderColor, setBorderColor] = useState('#000000');
  const [borderKind, setBorderKind] = useState('solid');
  const { width, height, lockAspect, setLockAspect, handleWidthChange, handleHeightChange, seed } =
    useAspectLockedSize();

  // Snapshot-on-open: seed fields once when the dialog opens. We deliberately do
  // NOT depend on `currentData` here — the parent rebuilds it as a fresh object
  // each render, which would clobber whatever the user has typed.
  useEffect(() => {
    if (!isOpen) return;
    setAlt(currentData?.alt ?? '');
    setBorderWidth(currentData?.borderWidth ?? 0);
    setBorderColor(currentData?.borderColor ?? '#000000');
    setBorderKind(currentData?.borderKind ?? 'solid');
    seed(currentData?.width, currentData?.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleApply = useCallback(() => {
    onApply({
      alt: alt || undefined,
      borderWidth: borderWidth > 0 ? borderWidth : undefined,
      borderColor: borderWidth > 0 ? borderColor : undefined,
      borderKind: borderWidth > 0 ? borderKind : undefined,
      width: typeof width === 'number' && width > 0 ? width : undefined,
      height: typeof height === 'number' && height > 0 ? height : undefined,
    });
    onClose();
  }, [alt, borderWidth, borderColor, borderKind, width, height, onApply, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && !e.shiftKey) handleApply();
    },
    [onClose, handleApply]
  );

  if (!isOpen) return null;

  return (
    <div style={overlayStyle} onClick={onClose} onKeyDown={handleKeyDown}>
      <div
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('dialogs.imageProperties.title')}
      >
        <div style={headerStyle}>{t('dialogs.imageProperties.title')}</div>

        <div style={bodyStyle}>
          {/* Alt Text */}
          <div style={sectionStyle}>
            <div style={sectionLabelStyle}>{t('dialogs.imageProperties.altText')}</div>
            <textarea
              style={textareaStyle}
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder={t('dialogs.imageProperties.altTextPlaceholder')}
            />
          </div>

          <div style={sectionStyle}>
            <div style={sectionLabelStyle}>{t('dialogs.imageProperties.dimensions')}</div>
            <div style={rowStyle}>
              <label style={labelStyle}>{t('dialogs.imageProperties.widthLabel')}</label>
              <input
                type="number"
                style={{ ...inputStyle, maxWidth: 100 }}
                min={1}
                step={1}
                value={width}
                onChange={(e) => handleWidthChange(e.target.value)}
              />
              <span style={{ fontSize: 12, color: 'var(--doc-text-muted)' }}>{t('common.px')}</span>
            </div>
            <div style={rowStyle}>
              <label style={labelStyle}>{t('dialogs.imageProperties.heightLabel')}</label>
              <input
                type="number"
                style={{ ...inputStyle, maxWidth: 100 }}
                min={1}
                step={1}
                value={height}
                onChange={(e) => handleHeightChange(e.target.value)}
              />
              <span style={{ fontSize: 12, color: 'var(--doc-text-muted)' }}>{t('common.px')}</span>
            </div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--doc-text-muted)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={lockAspect}
                onChange={(e) => setLockAspect(e.target.checked)}
              />
              {t('dialogs.imageProperties.lockAspectRatio')}
            </label>
          </div>

          {/* Border / Outline */}
          <div style={sectionStyle}>
            <div style={sectionLabelStyle}>{t('dialogs.imageProperties.border')}</div>
            <div style={rowStyle}>
              <label style={labelStyle}>{t('dialogs.imageProperties.width')}</label>
              <input
                type="number"
                style={{ ...inputStyle, maxWidth: 80 }}
                min={0}
                max={20}
                step={0.5}
                value={borderWidth}
                onChange={(e) => setBorderWidth(Number(e.target.value) || 0)}
              />
              <span style={{ fontSize: 12, color: 'var(--doc-text-muted)' }}>{t('common.px')}</span>
            </div>
            <div style={rowStyle}>
              <label style={labelStyle}>{t('dialogs.imageProperties.style')}</label>
              <select
                style={selectStyle}
                value={borderKind}
                onChange={(e) => setBorderKind(e.target.value)}
              >
                <option value="solid">{t('dialogs.imageProperties.borderKinds.solid')}</option>
                <option value="dashed">{t('dialogs.imageProperties.borderKinds.dashed')}</option>
                <option value="dotted">{t('dialogs.imageProperties.borderKinds.dotted')}</option>
                <option value="double">{t('dialogs.imageProperties.borderKinds.double')}</option>
                <option value="groove">{t('dialogs.imageProperties.borderKinds.groove')}</option>
                <option value="ridge">{t('dialogs.imageProperties.borderKinds.ridge')}</option>
                <option value="inset">{t('dialogs.imageProperties.borderKinds.inset')}</option>
                <option value="outset">{t('dialogs.imageProperties.borderKinds.outset')}</option>
              </select>
            </div>
            <div style={rowStyle}>
              <label style={labelStyle}>{t('dialogs.imageProperties.color')}</label>
              <input
                type="color"
                value={borderColor}
                onChange={(e) => setBorderColor(e.target.value)}
                style={{
                  width: 32,
                  height: 24,
                  padding: 0,
                  border: '1px solid var(--doc-border)',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              />
              <input
                type="text"
                style={{ ...inputStyle, maxWidth: 90 }}
                value={borderColor}
                onChange={(e) => setBorderColor(e.target.value)}
              />
            </div>
            {borderWidth > 0 && (
              <div
                style={{
                  marginTop: 4,
                  padding: 8,
                  border: `${borderWidth}px ${borderKind} ${borderColor}`,
                  borderRadius: 4,
                  fontSize: 11,
                  color: 'var(--doc-text-muted)',
                  textAlign: 'center',
                }}
              >
                {t('dialogs.imageProperties.preview')}
              </div>
            )}
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
            }}
            onClick={handleApply}
          >
            {t('common.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
