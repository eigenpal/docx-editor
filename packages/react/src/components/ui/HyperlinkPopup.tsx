/**
 * HyperlinkPopup Component
 *
 * Google Docs-style floating popup that appears when clicking on a hyperlink.
 * View mode: shows URL, copy, edit, and unlink buttons.
 * Edit mode: shows text + URL inputs with Apply button.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

export interface HyperlinkPopupData {
  /** The hyperlink URL */
  href: string;
  /** Display text of the hyperlink */
  displayText: string;
  /** Tooltip if any */
  tooltip?: string;
  /** Bounding rect of the anchor element (for positioning) */
  anchorRect: DOMRect;
}

export interface HyperlinkPopupProps {
  /** Popup data (null = hidden) */
  data: HyperlinkPopupData | null;
  /** Called when user wants to navigate to the link */
  onNavigate: (href: string) => void;
  /** Called when user wants to copy the URL */
  onCopy: (href: string) => void;
  /** Called when user saves edits (text, url) */
  onEdit: (displayText: string, href: string) => void;
  /** Called when user unlinks */
  onRemove: () => void;
  /** Called when popup should close */
  onClose: () => void;
  /** Whether the editor is read-only */
  readOnly?: boolean;
}

// ============================================================================
// STYLES
// ============================================================================

const BASE_POPUP_STYLE: CSSProperties = {
  position: 'fixed',
  zIndex: 10000,
  background: 'white',
  borderRadius: '8px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.08)',
  border: '1px solid #dadce0',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: '14px',
};

const POPUP_STYLE: CSSProperties = {
  ...BASE_POPUP_STYLE,
  padding: '8px 12px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  maxWidth: '400px',
};

const EDIT_POPUP_STYLE: CSSProperties = {
  ...BASE_POPUP_STYLE,
  padding: '12px',
  width: '320px',
};

const ICON_STYLE: CSSProperties = {
  width: '20px',
  height: '20px',
  flexShrink: 0,
  color: '#5f6368',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const URL_LINK_STYLE: CSSProperties = {
  color: '#1a73e8',
  textDecoration: 'none',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '220px',
  fontSize: '14px',
  lineHeight: '20px',
  cursor: 'pointer',
};

const ICON_BUTTON_STYLE: CSSProperties = {
  width: '28px',
  height: '28px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  color: '#5f6368',
  padding: 0,
  flexShrink: 0,
};

const SEPARATOR_STYLE: CSSProperties = {
  width: '1px',
  height: '20px',
  background: '#dadce0',
  flexShrink: 0,
};

const EDIT_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '8px',
};

const EDIT_INPUT_STYLE: CSSProperties = {
  flex: 1,
  padding: '6px 8px',
  border: '1px solid #dadce0',
  borderRadius: '4px',
  fontSize: '14px',
  outline: 'none',
  lineHeight: '20px',
};

const APPLY_BUTTON_STYLE: CSSProperties = {
  color: '#1a73e8',
  fontWeight: 600,
  fontSize: '14px',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  padding: '6px 12px',
  borderRadius: '4px',
  flexShrink: 0,
};

// ============================================================================
// SVG ICONS
// ============================================================================

const SVG_PROPS = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function GlobeIcon() {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg {...SVG_PROPS}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function UnlinkIcon() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M18.84 12.25l1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
      <path d="M5.17 11.75l-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
      <line x1="8" y1="2" x2="8" y2="5" />
      <line x1="2" y1="8" x2="5" y2="8" />
      <line x1="16" y1="19" x2="16" y2="22" />
      <line x1="19" y1="16" x2="22" y2="16" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg {...SVG_PROPS}>
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" />
      <line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

// ============================================================================
// ICON BUTTON HELPER
// ============================================================================

function PopupIconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="ep-hyperlink-popup__icon-btn"
      style={ICON_BUTTON_STYLE}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export function HyperlinkPopup({
  data,
  onNavigate,
  onCopy,
  onEdit,
  onRemove,
  onClose,
  readOnly,
}: HyperlinkPopupProps): React.ReactElement | null {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [editText, setEditText] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const popupRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  // Reset state when data changes
  useEffect(() => {
    if (data) {
      setMode('view');
      setEditText(data.displayText);
      setEditUrl(data.href);
    }
  }, [data]);

  // Focus text input when entering edit mode
  useEffect(() => {
    if (mode === 'edit') {
      requestAnimationFrame(() => {
        textInputRef.current?.focus();
        textInputRef.current?.select();
      });
    }
  }, [mode]);

  // Close on outside click
  useEffect(() => {
    if (!data) return;

    let aborted = false;
    const handleMouseDown = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Defer so the click that opened the popup doesn't immediately close it
    const timer = setTimeout(() => {
      if (!aborted) document.addEventListener('mousedown', handleMouseDown);
    }, 0);

    return () => {
      aborted = true;
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [data, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!data) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mode === 'edit') {
          setMode('view');
        } else {
          onClose();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [data, mode, onClose]);

  const handleCopy = useCallback(() => {
    if (!data) return;
    onCopy(data.href);
    toast('Link copied to clipboard');
  }, [data, onCopy]);

  const handleEditClick = useCallback(() => {
    if (!data) return;
    // Reset fields in case user previously edited and pressed Escape
    setEditText(data.displayText);
    setEditUrl(data.href);
    setMode('edit');
  }, [data]);

  const handleApply = useCallback(() => {
    const trimmedUrl = editUrl.trim();
    if (!trimmedUrl) return;
    onEdit(editText.trim() || trimmedUrl, trimmedUrl);
  }, [editText, editUrl, onEdit]);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleApply();
      }
    },
    [handleApply]
  );

  if (!data) return null;

  // Calculate position: below the anchor element
  const { anchorRect } = data;
  const popupTop = anchorRect.bottom + 4;
  const popupLeft = anchorRect.left;

  if (mode === 'edit') {
    return (
      <div
        ref={popupRef}
        className="ep-hyperlink-popup ep-hyperlink-popup--edit"
        style={{
          ...EDIT_POPUP_STYLE,
          top: popupTop,
          left: popupLeft,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Text field */}
        <div style={EDIT_ROW_STYLE}>
          <span style={ICON_STYLE}>
            <TextIcon />
          </span>
          <input
            ref={textInputRef}
            type="text"
            style={EDIT_INPUT_STYLE}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={handleEditKeyDown}
            placeholder={t('hyperlinkPopup.displayTextPlaceholder')}
            onFocus={(e) => (e.target.style.borderColor = '#1a73e8')}
            onBlur={(e) => (e.target.style.borderColor = '#dadce0')}
          />
        </div>

        {/* URL field + Apply */}
        <div style={{ ...EDIT_ROW_STYLE, marginBottom: 0 }}>
          <span style={ICON_STYLE}>
            <LinkIcon />
          </span>
          <input
            type="text"
            style={EDIT_INPUT_STYLE}
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            onKeyDown={handleEditKeyDown}
            placeholder={t('hyperlinkPopup.urlPlaceholder')}
            onFocus={(e) => (e.target.style.borderColor = '#1a73e8')}
            onBlur={(e) => (e.target.style.borderColor = '#dadce0')}
          />
          <button
            type="button"
            style={{
              ...APPLY_BUTTON_STYLE,
              opacity: editUrl.trim() ? 1 : 0.5,
              cursor: editUrl.trim() ? 'pointer' : 'default',
            }}
            onClick={handleApply}
            disabled={!editUrl.trim()}
          >
            {t('common.apply')}
          </button>
        </div>
      </div>
    );
  }

  // View mode
  return (
    <div
      ref={popupRef}
      className="ep-hyperlink-popup"
      style={{
        ...POPUP_STYLE,
        top: popupTop,
        left: popupLeft,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Globe icon */}
      <span style={ICON_STYLE}>
        <GlobeIcon />
      </span>

      {/* Clickable URL */}
      <a
        href={data.href}
        style={URL_LINK_STYLE}
        title={data.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          onNavigate(data.href);
        }}
      >
        {data.href}
      </a>

      <span style={SEPARATOR_STYLE} />

      {/* Copy button */}
      <PopupIconButton title={t('hyperlinkPopup.copyLink')} onClick={handleCopy}>
        <CopyIcon />
      </PopupIconButton>

      {!readOnly && (
        <>
          <PopupIconButton title={t('hyperlinkPopup.editLink')} onClick={handleEditClick}>
            <EditIcon />
          </PopupIconButton>

          <PopupIconButton title={t('hyperlinkPopup.removeLink')} onClick={onRemove}>
            <UnlinkIcon />
          </PopupIconButton>
        </>
      )}
    </div>
  );
}

export default HyperlinkPopup;
