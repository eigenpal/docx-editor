/**
 * Footnote & Endnote Properties Dialog
 *
 * Edits position, numbering format, start number, and restart rules.
 */

import React, { useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import type {
  FootnoteProperties,
  EndnoteProperties,
  FootnotePosition,
  EndnotePosition,
  NoteNumberRestart,
  NumberFormat,
} from '@eigenpal/docx-core/types/document';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

export interface FootnotePropertiesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (footnoteProps: FootnoteProperties, endnoteProps: EndnoteProperties) => void;
  footnotePr?: FootnoteProperties;
  endnotePr?: EndnoteProperties;
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
  padding: 24,
  minWidth: 400,
  maxWidth: 500,
};

const sectionStyle: CSSProperties = {
  marginBottom: 16,
  padding: 12,
  border: '1px solid #e0e0e0',
  borderRadius: 4,
};

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#666',
  marginBottom: 4,
};

const selectStyle: CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  border: '1px solid #ccc',
  borderRadius: 4,
  fontSize: 13,
  marginBottom: 8,
};

const inputStyle: CSSProperties = {
  width: 60,
  padding: '4px 8px',
  border: '1px solid #ccc',
  borderRadius: 4,
  fontSize: 13,
  marginBottom: 8,
};

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 16,
};

const buttonStyle: CSSProperties = {
  padding: '6px 16px',
  border: '1px solid #ccc',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
  backgroundColor: 'white',
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  backgroundColor: '#2563eb',
  color: 'white',
  border: '1px solid #2563eb',
};

// ============================================================================
// NUMBER FORMAT OPTIONS
// ============================================================================

const numberFormatOptions: { value: NumberFormat; labelKey: TranslationKey }[] = [
  { value: 'decimal', labelKey: 'dialogs.footnoteProperties.formats.decimal' },
  { value: 'lowerRoman', labelKey: 'dialogs.footnoteProperties.formats.lowerRoman' },
  { value: 'upperRoman', labelKey: 'dialogs.footnoteProperties.formats.upperRoman' },
  { value: 'lowerLetter', labelKey: 'dialogs.footnoteProperties.formats.lowerAlpha' },
  { value: 'upperLetter', labelKey: 'dialogs.footnoteProperties.formats.upperAlpha' },
  { value: 'chicago', labelKey: 'dialogs.footnoteProperties.formats.symbols' },
];

// ============================================================================
// COMPONENT
// ============================================================================

export function FootnotePropertiesDialog({
  isOpen,
  onClose,
  onApply,
  footnotePr,
  endnotePr,
}: FootnotePropertiesDialogProps): React.ReactElement | null {
  const { t } = useTranslation();
  const [fnPosition, setFnPosition] = useState<FootnotePosition>(
    footnotePr?.position ?? 'pageBottom'
  );
  const [fnNumFmt, setFnNumFmt] = useState<NumberFormat>(footnotePr?.numFmt ?? 'decimal');
  const [fnNumStart, setFnNumStart] = useState<number>(footnotePr?.numStart ?? 1);
  const [fnRestart, setFnRestart] = useState<NoteNumberRestart>(
    footnotePr?.numRestart ?? 'continuous'
  );

  const [enPosition, setEnPosition] = useState<EndnotePosition>(endnotePr?.position ?? 'docEnd');
  const [enNumFmt, setEnNumFmt] = useState<NumberFormat>(endnotePr?.numFmt ?? 'lowerRoman');
  const [enNumStart, setEnNumStart] = useState<number>(endnotePr?.numStart ?? 1);
  const [enRestart, setEnRestart] = useState<NoteNumberRestart>(
    endnotePr?.numRestart ?? 'continuous'
  );

  const handleApply = useCallback(() => {
    onApply(
      { position: fnPosition, numFmt: fnNumFmt, numStart: fnNumStart, numRestart: fnRestart },
      { position: enPosition, numFmt: enNumFmt, numStart: enNumStart, numRestart: enRestart }
    );
    onClose();
  }, [
    fnPosition,
    fnNumFmt,
    fnNumStart,
    fnRestart,
    enPosition,
    enNumFmt,
    enNumStart,
    enRestart,
    onApply,
    onClose,
  ]);

  if (!isOpen) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>
          {t('dialogs.footnoteProperties.title')}
        </h3>

        {/* Footnote section */}
        <div style={sectionStyle}>
          <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>
            {t('dialogs.footnoteProperties.footnotes')}
          </h4>

          <label style={labelStyle}>{t('dialogs.footnoteProperties.position')}</label>
          <select
            style={selectStyle}
            value={fnPosition}
            onChange={(e) => setFnPosition(e.target.value as FootnotePosition)}
          >
            <option value="pageBottom">
              {t('dialogs.footnoteProperties.footnotePositions.bottomOfPage')}
            </option>
            <option value="beneathText">
              {t('dialogs.footnoteProperties.footnotePositions.belowText')}
            </option>
          </select>

          <label style={labelStyle}>{t('dialogs.footnoteProperties.numberFormat')}</label>
          <select
            style={selectStyle}
            value={fnNumFmt}
            onChange={(e) => setFnNumFmt(e.target.value as NumberFormat)}
          >
            {numberFormatOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div>
              <label style={labelStyle}>{t('dialogs.footnoteProperties.startAt')}</label>
              <input
                type="number"
                min={1}
                style={inputStyle}
                value={fnNumStart}
                onChange={(e) => setFnNumStart(parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t('dialogs.footnoteProperties.numbering')}</label>
              <select
                style={selectStyle}
                value={fnRestart}
                onChange={(e) => setFnRestart(e.target.value as NoteNumberRestart)}
              >
                <option value="continuous">
                  {t('dialogs.footnoteProperties.numberingOptions.continuous')}
                </option>
                <option value="eachSect">
                  {t('dialogs.footnoteProperties.numberingOptions.restartSection')}
                </option>
                <option value="eachPage">
                  {t('dialogs.footnoteProperties.numberingOptions.restartPage')}
                </option>
              </select>
            </div>
          </div>
        </div>

        {/* Endnote section */}
        <div style={sectionStyle}>
          <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>
            {t('dialogs.footnoteProperties.endnotes')}
          </h4>

          <label style={labelStyle}>{t('dialogs.footnoteProperties.position')}</label>
          <select
            style={selectStyle}
            value={enPosition}
            onChange={(e) => setEnPosition(e.target.value as EndnotePosition)}
          >
            <option value="docEnd">
              {t('dialogs.footnoteProperties.endnotePositions.endOfDocument')}
            </option>
            <option value="sectEnd">
              {t('dialogs.footnoteProperties.endnotePositions.endOfSection')}
            </option>
          </select>

          <label style={labelStyle}>{t('dialogs.footnoteProperties.numberFormat')}</label>
          <select
            style={selectStyle}
            value={enNumFmt}
            onChange={(e) => setEnNumFmt(e.target.value as NumberFormat)}
          >
            {numberFormatOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div>
              <label style={labelStyle}>{t('dialogs.footnoteProperties.startAt')}</label>
              <input
                type="number"
                min={1}
                style={inputStyle}
                value={enNumStart}
                onChange={(e) => setEnNumStart(parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t('dialogs.footnoteProperties.numbering')}</label>
              <select
                style={selectStyle}
                value={enRestart}
                onChange={(e) => setEnRestart(e.target.value as NoteNumberRestart)}
              >
                <option value="continuous">
                  {t('dialogs.footnoteProperties.numberingOptions.continuous')}
                </option>
                <option value="eachSect">
                  {t('dialogs.footnoteProperties.numberingOptions.restartSection')}
                </option>
              </select>
            </div>
          </div>
        </div>

        <div style={buttonRowStyle}>
          <button style={buttonStyle} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button style={primaryButtonStyle} onClick={handleApply}>
            {t('common.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
