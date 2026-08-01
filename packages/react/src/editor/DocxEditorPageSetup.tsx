// The Page Setup dialog as a context-fed part (`DocxEditor.PageSetupDialog`).
//
// Size preset, orientation and margins — the fields Word's dialog and the reference
// Google-Docs chrome expose — read from `usePageSetup()` and written back as ONE
// `setPageSetup` command on Apply, so the whole dialog is a single undo step. The host
// owns visibility (`open`/`onClose`); the engine owns everything else.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { useTranslation } from '../i18n';
import { usePageSetup } from './usePageSetup';

/**
 * Common page sizes in twips, PORTRAIT-normalized (width < height). Matching tolerates
 * ±20 twips and ignores orientation, so a landscape A4 still reads as "A4".
 */
const PAGE_SIZES = [
  { labelKey: 'dialogs.pageSetup.pageSizes.letter' as const, width: 12240, height: 15840 },
  { labelKey: 'dialogs.pageSetup.pageSizes.a4' as const, width: 11906, height: 16838 },
  { labelKey: 'dialogs.pageSetup.pageSizes.legal' as const, width: 12240, height: 20160 },
  { labelKey: 'dialogs.pageSetup.pageSizes.a3' as const, width: 16838, height: 23811 },
  { labelKey: 'dialogs.pageSetup.pageSizes.a5' as const, width: 8391, height: 11906 },
  { labelKey: 'dialogs.pageSetup.pageSizes.b5' as const, width: 9979, height: 14175 },
  { labelKey: 'dialogs.pageSetup.pageSizes.executive' as const, width: 10440, height: 15120 },
] as const;

const TWIPS_PER_INCH = 1440;

const twipsToInches = (twips: number): number => Math.round((twips / TWIPS_PER_INCH) * 100) / 100;
const inchesToTwips = (inches: number): number => Math.round(inches * TWIPS_PER_INCH);

function findPageSizeIndex(w: number, h: number): number {
  const pw = Math.min(w, h);
  const ph = Math.max(w, h);
  return PAGE_SIZES.findIndex(
    (size) => Math.abs(size.width - pw) < 20 && Math.abs(size.height - ph) < 20
  );
}

/** Props for `DocxEditor.PageSetupDialog`. @public */
export interface DocxEditorPageSetupDialogProps {
  /** Whether the dialog is shown. The host owns this state. */
  open: boolean;
  /** Called on Cancel, Escape, overlay click, and after a successful Apply. */
  onClose: () => void;
  className?: string;
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'var(--doc-overlay)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const dialogStyle: CSSProperties = {
  backgroundColor: 'var(--doc-surface)',
  borderRadius: 8,
  boxShadow: '0 4px 20px var(--doc-shadow)',
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
  color: 'var(--doc-text)',
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
  backgroundColor: 'var(--doc-surface)',
  color: 'var(--doc-text)',
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
  backgroundColor: 'var(--doc-surface)',
  color: 'var(--doc-text)',
};

const DEFAULT_WIDTH = 12240;
const DEFAULT_HEIGHT = 15840;
const DEFAULT_MARGIN = 1440;

/**
 * Page Setup dialog: size preset, orientation, margins in inches. Reads the section
 * through `usePageSetup()` and applies the whole form as one undoable command.
 *
 * @public
 */
export function DocxEditorPageSetupDialog({
  open,
  onClose,
  className,
}: DocxEditorPageSetupDialogProps): ReactElement | null {
  const { t } = useTranslation();
  const { pageSetup, isEnabled, apply } = usePageSetup();
  const [pageWidth, setPageWidth] = useState(DEFAULT_WIDTH);
  const [pageHeight, setPageHeight] = useState(DEFAULT_HEIGHT);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [marginTop, setMarginTop] = useState(DEFAULT_MARGIN);
  const [marginBottom, setMarginBottom] = useState(DEFAULT_MARGIN);
  const [marginLeft, setMarginLeft] = useState(DEFAULT_MARGIN);
  const [marginRight, setMarginRight] = useState(DEFAULT_MARGIN);
  const [scope, setScope] = useState<'document' | 'section'>('document');
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Seed the form from the document when the dialog OPENS — not on every section tick,
  // or a concurrent edit would fight the user's typing. `'loading'` covers a dialog
  // mounted open before the document finishes loading: the first non-null section
  // re-seeds once, so Apply can never stamp placeholder defaults over a real document.
  const seeded = useRef<'no' | 'loading' | 'yes'>('no');
  useEffect(() => {
    if (!open) {
      seeded.current = 'no';
      return;
    }
    if (seeded.current === 'yes' || (seeded.current === 'loading' && pageSetup === null)) return;
    setPageWidth(pageSetup?.pageWidthTwips ?? DEFAULT_WIDTH);
    setPageHeight(pageSetup?.pageHeightTwips ?? DEFAULT_HEIGHT);
    setOrientation(pageSetup?.orientation ?? 'portrait');
    setMarginTop(pageSetup?.marginsTwips.top ?? DEFAULT_MARGIN);
    setMarginBottom(pageSetup?.marginsTwips.bottom ?? DEFAULT_MARGIN);
    setMarginLeft(pageSetup?.marginsTwips.left ?? DEFAULT_MARGIN);
    setMarginRight(pageSetup?.marginsTwips.right ?? DEFAULT_MARGIN);
    setScope('document');
    seeded.current = pageSetup === null ? 'loading' : 'yes';
  }, [open, pageSetup]);

  // Focus the panel on open so Escape works before any field is clicked.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const handlePageSizeChange = useCallback(
    (index: number) => {
      const size = PAGE_SIZES[index];
      if (!size) return;
      // Presets are portrait-normalized; the current orientation decides the stored order.
      setPageWidth(orientation === 'landscape' ? size.height : size.width);
      setPageHeight(orientation === 'landscape' ? size.width : size.height);
    },
    [orientation]
  );

  const handleOrientationChange = useCallback(
    (next: 'portrait' | 'landscape') => {
      if (next === orientation) return;
      setOrientation(next);
      setPageWidth(pageHeight);
      setPageHeight(pageWidth);
    },
    [orientation, pageWidth, pageHeight]
  );

  const handleApply = useCallback(() => {
    // A refused write (margins that swallow the page) keeps the dialog OPEN: `apply`
    // is honest about op-layer rejections, so closing here would claim success.
    const accepted = apply({
      pageWidthTwips: pageWidth,
      pageHeightTwips: pageHeight,
      orientation,
      marginTopTwips: marginTop,
      marginRightTwips: marginRight,
      marginBottomTwips: marginBottom,
      marginLeftTwips: marginLeft,
      scope,
    });
    if (accepted) onClose();
  }, [
    apply,
    pageWidth,
    pageHeight,
    orientation,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    scope,
    onClose,
  ]);

  if (!open) return null;

  const sizeIndex = findPageSizeIndex(pageWidth, pageHeight);

  const marginRow = (
    labelKey: 'top' | 'bottom' | 'left' | 'right',
    value: number,
    set: (twips: number) => void
  ) => (
    <div style={rowStyle}>
      <label style={labelStyle}>{t(`dialogs.pageSetup.${labelKey}`)}</label>
      <input
        type="number"
        style={inputStyle}
        min={0}
        max={22}
        step={0.1}
        value={twipsToInches(value)}
        onChange={(event) => set(Math.max(0, inchesToTwips(Number(event.target.value) || 0)))}
        aria-label={t(`dialogs.pageSetup.${labelKey}`)}
      />
      <span style={unitStyle}>in</span>
    </div>
  );

  return (
    <div
      className={className}
      style={overlayStyle}
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Enter') handleApply();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        style={dialogStyle}
        onClick={(event) => event.stopPropagation()}
        // A mousedown that reaches the painted pages moves the caret; the inputs still
        // need theirs, and stopping propagation (not preventing default) gives them that.
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('dialogs.pageSetup.title')}
      >
        <div style={headerStyle}>{t('dialogs.pageSetup.title')}</div>

        <div style={bodyStyle}>
          <div style={sectionLabelStyle}>{t('dialogs.pageSetup.pageSize')}</div>

          <div style={rowStyle}>
            <label style={labelStyle}>{t('dialogs.pageSetup.sizeLabel')}</label>
            <select
              style={inputStyle}
              value={sizeIndex}
              onChange={(event) => handlePageSizeChange(Number(event.target.value))}
              aria-label={t('dialogs.pageSetup.sizeLabel')}
            >
              {PAGE_SIZES.map((size, index) => (
                <option key={size.labelKey} value={index}>
                  {t(size.labelKey)}
                </option>
              ))}
              {sizeIndex < 0 && <option value={-1}>{t('dialogs.pageSetup.custom')}</option>}
            </select>
          </div>

          <div style={rowStyle}>
            <label style={labelStyle}>{t('dialogs.pageSetup.orientation')}</label>
            <select
              style={inputStyle}
              value={orientation}
              onChange={(event) =>
                handleOrientationChange(event.target.value as 'portrait' | 'landscape')
              }
              aria-label={t('dialogs.pageSetup.orientation')}
            >
              <option value="portrait">{t('dialogs.pageSetup.portrait')}</option>
              <option value="landscape">{t('dialogs.pageSetup.landscape')}</option>
            </select>
          </div>

          <div style={{ ...sectionLabelStyle, marginTop: 4 }}>{t('dialogs.pageSetup.margins')}</div>
          {marginRow('top', marginTop, setMarginTop)}
          {marginRow('bottom', marginBottom, setMarginBottom)}
          {marginRow('left', marginLeft, setMarginLeft)}
          {marginRow('right', marginRight, setMarginRight)}

          <div style={rowStyle}>
            <label style={labelStyle}>{t('dialogs.pageSetup.applyTo')}</label>
            <select
              style={inputStyle}
              value={scope}
              onChange={(event) => setScope(event.target.value as 'document' | 'section')}
              aria-label={t('dialogs.pageSetup.applyTo')}
            >
              <option value="document">{t('dialogs.pageSetup.applyToDocument')}</option>
              <option value="section">{t('dialogs.pageSetup.applyToSection')}</option>
            </select>
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
              color: 'var(--doc-on-primary)',
              borderColor: 'var(--doc-primary)',
              opacity: isEnabled ? 1 : 0.5,
            }}
            disabled={!isEnabled}
            onClick={handleApply}
          >
            {t('common.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
