/**
 * Page Setup Dialog
 *
 * Modal for editing page layout properties:
 * - Page size (Letter, A4, Legal, etc.)
 * - Orientation (portrait/landscape)
 * - Margins (top, bottom, left, right) in inches
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { SectionProperties } from '@eigenpal/docx-core/types/document';
import { TWIPS_PER_INCH } from '@eigenpal/docx-core/utils/units';

/** Common page sizes in twips (width x height in portrait orientation) */
const PAGE_SIZES = [
  { label: 'Letter (8.5" × 11")', width: 12240, height: 15840 },
  { label: 'A4 (8.27" × 11.69")', width: 11906, height: 16838 },
  { label: 'Legal (8.5" × 14")', width: 12240, height: 20160 },
  { label: 'A3 (11.69" × 16.54")', width: 16838, height: 23811 },
  { label: 'A5 (5.83" × 8.27")', width: 8391, height: 11906 },
  { label: 'B5 (6.93" × 9.84")', width: 9979, height: 14175 },
  { label: 'Executive (7.25" × 10.5")', width: 10440, height: 15120 },
] as const;

// ============================================================================
// TYPES
// ============================================================================

export interface PageSetupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (props: Partial<SectionProperties>) => void;
  currentProps?: SectionProperties;
}

// ============================================================================
// HELPERS
// ============================================================================

function twipsToInches(twips: number): number {
  return Math.round((twips / TWIPS_PER_INCH) * 100) / 100;
}

function inchesToTwips(inches: number): number {
  return Math.round(inches * TWIPS_PER_INCH);
}

/** Find matching page size preset, ignoring orientation */
function findPageSizeIndex(w: number, h: number): number {
  // Normalize to portrait (smaller dimension = width)
  const pw = Math.min(w, h);
  const ph = Math.max(w, h);
  return PAGE_SIZES.findIndex((s) => Math.abs(s.width - pw) < 20 && Math.abs(s.height - ph) < 20);
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
  minWidth: 400,
  maxWidth: 480,
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
  gap: 14,
};

const sectionLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--doc-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const labelStyle: CSSProperties = {
  width: 80,
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

const selectStyle: CSSProperties = {
  ...inputStyle,
};

const unitStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--doc-text-muted)',
  width: 16,
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

// Default Word values (Letter, 1" margins)
const DEFAULT_WIDTH = 12240;
const DEFAULT_HEIGHT = 15840;
const DEFAULT_MARGIN = 1440;

export function PageSetupDialog({
  isOpen,
  onClose,
  onApply,
  currentProps,
}: PageSetupDialogProps): React.ReactElement | null {
  const [pageWidth, setPageWidth] = useState(DEFAULT_WIDTH);
  const [pageHeight, setPageHeight] = useState(DEFAULT_HEIGHT);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [marginTop, setMarginTop] = useState(DEFAULT_MARGIN);
  const [marginBottom, setMarginBottom] = useState(DEFAULT_MARGIN);
  const [marginLeft, setMarginLeft] = useState(DEFAULT_MARGIN);
  const [marginRight, setMarginRight] = useState(DEFAULT_MARGIN);

  useEffect(() => {
    if (!isOpen) return;
    const w = currentProps?.pageWidth || DEFAULT_WIDTH;
    const h = currentProps?.pageHeight || DEFAULT_HEIGHT;
    const orient = currentProps?.orientation || (w > h ? 'landscape' : 'portrait');
    setPageWidth(w);
    setPageHeight(h);
    setOrientation(orient);
    setMarginTop(currentProps?.marginTop ?? DEFAULT_MARGIN);
    setMarginBottom(currentProps?.marginBottom ?? DEFAULT_MARGIN);
    setMarginLeft(currentProps?.marginLeft ?? DEFAULT_MARGIN);
    setMarginRight(currentProps?.marginRight ?? DEFAULT_MARGIN);
  }, [isOpen, currentProps]);

  const handlePageSizeChange = useCallback(
    (index: number) => {
      if (index < 0) return;
      const size = PAGE_SIZES[index];
      if (orientation === 'landscape') {
        setPageWidth(size.height);
        setPageHeight(size.width);
      } else {
        setPageWidth(size.width);
        setPageHeight(size.height);
      }
    },
    [orientation]
  );

  const handleOrientationChange = useCallback(
    (newOrientation: 'portrait' | 'landscape') => {
      if (newOrientation === orientation) return;
      setOrientation(newOrientation);
      // Swap width and height
      setPageWidth(pageHeight);
      setPageHeight(pageWidth);
    },
    [orientation, pageWidth, pageHeight]
  );

  const handleApply = useCallback(() => {
    onApply({
      pageWidth,
      pageHeight,
      orientation,
      marginTop,
      marginBottom,
      marginLeft,
      marginRight,
    });
    onClose();
  }, [
    pageWidth,
    pageHeight,
    orientation,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    onApply,
    onClose,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter') handleApply();
    },
    [onClose, handleApply]
  );

  if (!isOpen) return null;

  const sizeIndex = findPageSizeIndex(pageWidth, pageHeight);

  return (
    <div style={overlayStyle} onClick={onClose} onKeyDown={handleKeyDown}>
      <div
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Page setup"
      >
        <div style={headerStyle}>Page Setup</div>

        <div style={bodyStyle}>
          {/* Page size section */}
          <div style={sectionLabelStyle}>Page Size</div>

          <div style={rowStyle}>
            <label style={labelStyle}>Size</label>
            <select
              style={selectStyle}
              value={sizeIndex}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            >
              {PAGE_SIZES.map((size, i) => (
                <option key={size.label} value={i}>
                  {size.label}
                </option>
              ))}
              {sizeIndex < 0 && <option value={-1}>Custom</option>}
            </select>
          </div>

          <div style={rowStyle}>
            <label style={labelStyle}>Orientation</label>
            <select
              style={selectStyle}
              value={orientation}
              onChange={(e) => handleOrientationChange(e.target.value as 'portrait' | 'landscape')}
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </div>

          {/* Margins section */}
          <div style={{ ...sectionLabelStyle, marginTop: 4 }}>Margins</div>

          <div style={rowStyle}>
            <label style={labelStyle}>Top</label>
            <input
              type="number"
              style={inputStyle}
              min={0}
              max={10}
              step={0.1}
              value={twipsToInches(marginTop)}
              onChange={(e) => setMarginTop(inchesToTwips(Number(e.target.value) || 0))}
            />
            <span style={unitStyle}>in</span>
          </div>

          <div style={rowStyle}>
            <label style={labelStyle}>Bottom</label>
            <input
              type="number"
              style={inputStyle}
              min={0}
              max={10}
              step={0.1}
              value={twipsToInches(marginBottom)}
              onChange={(e) => setMarginBottom(inchesToTwips(Number(e.target.value) || 0))}
            />
            <span style={unitStyle}>in</span>
          </div>

          <div style={rowStyle}>
            <label style={labelStyle}>Left</label>
            <input
              type="number"
              style={inputStyle}
              min={0}
              max={10}
              step={0.1}
              value={twipsToInches(marginLeft)}
              onChange={(e) => setMarginLeft(inchesToTwips(Number(e.target.value) || 0))}
            />
            <span style={unitStyle}>in</span>
          </div>

          <div style={rowStyle}>
            <label style={labelStyle}>Right</label>
            <input
              type="number"
              style={inputStyle}
              min={0}
              max={10}
              step={0.1}
              value={twipsToInches(marginRight)}
              onChange={(e) => setMarginRight(inchesToTwips(Number(e.target.value) || 0))}
            />
            <span style={unitStyle}>in</span>
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
              backgroundColor: 'var(--doc-primary)',
              color: 'white',
              borderColor: 'var(--doc-primary)',
            }}
            onClick={handleApply}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
