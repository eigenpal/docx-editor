/**
 * Watermark Dialog Component
 *
 * Modal mirroring MS Word's "Design → Watermark": choose No watermark, a
 * Picture watermark (image + scale + washout), or a Text watermark (preset or
 * custom text, font, size, color, diagonal/horizontal layout, semitransparent).
 * On Apply it returns a `Watermark` (or `null` to remove); the host applies it
 * to the document via `setDocumentWatermark`.
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { Watermark } from '@eigenpal/docx-editor-core/types/document';
import {
  pictureWatermarkDisplayEmu,
  DEFAULT_WATERMARK_PRESETS,
} from '@eigenpal/docx-editor-core/types/document';
import { useTranslation } from '../../i18n';

export interface WatermarkDialogProps {
  /** Whether the dialog is open. */
  isOpen: boolean;
  /** Close without applying. */
  onClose: () => void;
  /** Apply the watermark, or `null` to remove it. */
  onApply: (watermark: Watermark | null) => void;
  /** The document's current watermark (for editing). */
  current?: Watermark;
  /**
   * Text-watermark presets offered in the preset dropdown. Defaults to the
   * MS Word phrases (`DEFAULT_WATERMARK_PRESETS`). Pass an empty array to hide
   * the preset dropdown entirely.
   */
  presets?: readonly string[];
}

type Mode = 'none' | 'picture' | 'text';

const FONTS = ['Calibri', 'Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New'];

// Styling mirrors PageSetupDialog so the dialogs read identically.
const OVERLAY: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'var(--doc-overlay)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const CONTENT: CSSProperties = {
  backgroundColor: 'var(--doc-surface)',
  borderRadius: 8,
  boxShadow: '0 4px 20px var(--doc-shadow)',
  minWidth: 400,
  maxWidth: 480,
  width: '100%',
  margin: 20,
};

const HEADER: CSSProperties = {
  padding: '16px 20px 12px',
  borderBottom: '1px solid var(--doc-border)',
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--doc-text)',
};
const BODY: CSSProperties = {
  padding: '16px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};
const SUBFORM: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};
const RADIO_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};
const LABEL: CSSProperties = {
  width: 80,
  fontSize: 13,
  color: 'var(--doc-text-muted)',
};
const INLINE_LABEL: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  color: 'var(--doc-text)',
};
const INPUT: CSSProperties = {
  flex: 1,
  padding: '6px 8px',
  border: '1px solid var(--doc-border)',
  borderRadius: 4,
  fontSize: 13,
};
const FOOTER: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '12px 20px 16px',
  borderTop: '1px solid var(--doc-border)',
};
const BTN_BASE: CSSProperties = {
  padding: '6px 16px',
  fontSize: 13,
  border: '1px solid var(--doc-border)',
  borderRadius: 4,
  cursor: 'pointer',
};
const PRIMARY_BTN: CSSProperties = {
  ...BTN_BASE,
  backgroundColor: 'var(--doc-primary)',
  color: 'var(--doc-on-primary)',
  borderColor: 'var(--doc-primary)',
};
const SECONDARY_BTN: CSSProperties = { ...BTN_BASE };

export function WatermarkDialog({
  isOpen,
  onClose,
  onApply,
  current,
  presets = DEFAULT_WATERMARK_PRESETS,
}: WatermarkDialogProps): React.ReactElement | null {
  const { t } = useTranslation();

  const [mode, setMode] = useState<Mode>('none');
  // Text — seed with the first preset (falling back to Word's default phrase).
  const [text, setText] = useState(presets[0] ?? 'CONFIDENTIAL');
  const [font, setFont] = useState('Calibri');
  const [autoSize, setAutoSize] = useState(true);
  const [fontSize, setFontSize] = useState(54);
  const [color, setColor] = useState('#C0C0C0');
  const [layout, setLayout] = useState<'diagonal' | 'horizontal'>('diagonal');
  const [semitransparent, setSemitransparent] = useState(true);
  // Picture
  const [pictureUrl, setPictureUrl] = useState<string | undefined>(undefined);
  // Display dimensions (EMUs) for the picked image, preserving aspect ratio.
  const [pictureDims, setPictureDims] = useState<
    { widthEmu: number; heightEmu: number } | undefined
  >(undefined);
  const [scale, setScale] = useState(100);
  const [washout, setWashout] = useState(true);

  // Seed the form from the current watermark each time the dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    if (current?.kind === 'text') {
      setMode('text');
      setText(current.text);
      setFont(current.font || 'Calibri');
      setAutoSize(current.fontSize === undefined);
      if (current.fontSize !== undefined) setFontSize(current.fontSize);
      setColor(current.color || '#C0C0C0');
      setLayout(current.layout);
      setSemitransparent(current.semitransparent);
    } else if (current?.kind === 'picture') {
      setMode('picture');
      setPictureUrl(current.dataUrl);
      setPictureDims(
        current.widthEmu !== undefined && current.heightEmu !== undefined
          ? { widthEmu: current.widthEmu, heightEmu: current.heightEmu }
          : undefined
      );
      setScale(Math.round((current.scale || 1) * 100));
      setWashout(current.washout);
    } else {
      setMode('none');
    }
  }, [isOpen, current]);

  const handlePickFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : undefined;
      setPictureUrl(url);
      setPictureDims(undefined);
      if (!url) return;
      // Measure the natural size so the watermark keeps the image's aspect ratio.
      const img = new Image();
      img.onload = () =>
        setPictureDims(pictureWatermarkDisplayEmu(img.naturalWidth, img.naturalHeight));
      img.src = url;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleApply = useCallback(() => {
    if (mode === 'none') {
      onApply(null);
    } else if (mode === 'text') {
      onApply({
        kind: 'text',
        text,
        font,
        color,
        semitransparent,
        layout,
        fontSize: autoSize ? undefined : fontSize,
      });
    } else {
      if (!pictureUrl) return;
      onApply({
        kind: 'picture',
        dataUrl: pictureUrl,
        scale: scale / 100,
        washout,
        ...(pictureDims ?? {}),
      });
    }
    onClose();
  }, [
    mode,
    text,
    font,
    color,
    semitransparent,
    layout,
    autoSize,
    fontSize,
    pictureUrl,
    pictureDims,
    scale,
    washout,
    onApply,
    onClose,
  ]);

  if (!isOpen) return null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };
  const applyDisabled = mode === 'picture' && !pictureUrl;

  return (
    <div style={OVERLAY} onClick={onClose} onMouseDown={stop} onKeyDown={handleKeyDown}>
      <div
        style={CONTENT}
        onClick={stop}
        onMouseDown={stop}
        role="dialog"
        aria-label={t('dialogs.watermark.title')}
      >
        <div style={HEADER}>{t('dialogs.watermark.title')}</div>

        <div style={BODY}>
          <div style={RADIO_ROW}>
            <input
              type="radio"
              id="wm-none"
              checked={mode === 'none'}
              onChange={() => setMode('none')}
            />
            <label htmlFor="wm-none" style={INLINE_LABEL}>
              {t('dialogs.watermark.noWatermark')}
            </label>
          </div>

          <div style={RADIO_ROW}>
            <input
              type="radio"
              id="wm-picture"
              checked={mode === 'picture'}
              onChange={() => setMode('picture')}
            />
            <label htmlFor="wm-picture" style={INLINE_LABEL}>
              {t('dialogs.watermark.picture')}
            </label>
          </div>
          {mode === 'picture' && (
            <div style={SUBFORM}>
              <div style={ROW}>
                <input type="file" accept="image/*" onChange={handlePickFile} />
              </div>
              {pictureUrl && (
                <div style={ROW}>
                  <img src={pictureUrl} alt="" style={{ maxHeight: '60px', maxWidth: '120px' }} />
                </div>
              )}
              <div style={ROW}>
                <span style={LABEL}>{t('dialogs.watermark.scale')}</span>
                <input
                  type="number"
                  min={10}
                  max={500}
                  value={scale}
                  onChange={(e) => setScale(Number(e.target.value))}
                  style={{ ...INPUT, flex: 'unset', width: 80 }}
                />
                <span style={{ fontSize: 11, color: 'var(--doc-text-muted)' }}>%</span>
              </div>
              <label style={INLINE_LABEL}>
                <input
                  type="checkbox"
                  checked={washout}
                  onChange={(e) => setWashout(e.target.checked)}
                />
                {t('dialogs.watermark.washout')}
              </label>
            </div>
          )}

          <div style={RADIO_ROW}>
            <input
              type="radio"
              id="wm-text"
              checked={mode === 'text'}
              onChange={() => setMode('text')}
            />
            <label htmlFor="wm-text" style={INLINE_LABEL}>
              {t('dialogs.watermark.text')}
            </label>
          </div>
          {mode === 'text' && (
            <div style={SUBFORM}>
              {presets.length > 0 && (
                <div style={ROW}>
                  <span style={LABEL}>{t('dialogs.watermark.presetLabel')}</span>
                  <select
                    style={INPUT}
                    value={presets.includes(text) ? text : ''}
                    onChange={(e) => e.target.value && setText(e.target.value)}
                  >
                    <option value="">—</option>
                    {presets.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div style={ROW}>
                <span style={LABEL}>{t('dialogs.watermark.textLabel')}</span>
                <input style={INPUT} value={text} onChange={(e) => setText(e.target.value)} />
              </div>
              <div style={ROW}>
                <span style={LABEL}>{t('dialogs.watermark.fontLabel')}</span>
                <select style={INPUT} value={font} onChange={(e) => setFont(e.target.value)}>
                  {FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div style={ROW}>
                <span style={LABEL}>{t('dialogs.watermark.sizeLabel')}</span>
                <label style={INLINE_LABEL}>
                  <input
                    type="checkbox"
                    checked={autoSize}
                    onChange={(e) => setAutoSize(e.target.checked)}
                  />
                  {t('dialogs.watermark.sizeAuto')}
                </label>
                {!autoSize && (
                  <input
                    type="number"
                    min={8}
                    max={200}
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    style={{ ...INPUT, flex: 'unset', width: 70 }}
                  />
                )}
              </div>
              <div style={ROW}>
                <span style={LABEL}>{t('dialogs.watermark.colorLabel')}</span>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </div>
              <div style={ROW}>
                <span style={LABEL}>{t('dialogs.watermark.layoutLabel')}</span>
                <label style={INLINE_LABEL}>
                  <input
                    type="radio"
                    name="wm-layout"
                    checked={layout === 'diagonal'}
                    onChange={() => setLayout('diagonal')}
                  />
                  {t('dialogs.watermark.diagonal')}
                </label>
                <label style={INLINE_LABEL}>
                  <input
                    type="radio"
                    name="wm-layout"
                    checked={layout === 'horizontal'}
                    onChange={() => setLayout('horizontal')}
                  />
                  {t('dialogs.watermark.horizontal')}
                </label>
              </div>
              <label style={INLINE_LABEL}>
                <input
                  type="checkbox"
                  checked={semitransparent}
                  onChange={(e) => setSemitransparent(e.target.checked)}
                />
                {t('dialogs.watermark.semitransparent')}
              </label>
            </div>
          )}
        </div>

        <div style={FOOTER}>
          <button style={SECONDARY_BTN} onClick={onClose}>
            {t('dialogs.watermark.cancelButton')}
          </button>
          <button
            style={{
              ...PRIMARY_BTN,
              ...(applyDisabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
            }}
            onClick={handleApply}
            disabled={applyDisabled}
          >
            {t('dialogs.watermark.applyButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
