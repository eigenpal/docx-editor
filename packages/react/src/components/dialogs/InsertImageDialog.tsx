/**
 * Insert Image Dialog Component
 *
 * Modal dialog for inserting images into the document.
 * Supports file upload with preview and basic sizing options.
 *
 * Features:
 * - File input for image selection
 * - Drag and drop support
 * - Image preview
 * - Width/height controls with aspect ratio lock
 * - Alt text input
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { CSSProperties, DragEvent, ChangeEvent } from 'react';
import { useTranslation } from '../../i18n';
import { MaterialSymbol } from '../ui/Icons';
import { useAspectLockedSize } from '../../hooks/useAspectLockedSize';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Image data for insertion
 */
export interface ImageData {
  /** Base64 data URL or external URL */
  src: string;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Alt text for accessibility */
  alt?: string;
  /** Original file name */
  fileName?: string;
  /** MIME type */
  mimeType?: string;
}

/**
 * Props for InsertImageDialog
 */
export interface InsertImageDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when image is inserted */
  onInsert: (data: ImageData) => void;
  /** Maximum width in pixels (default: 800) */
  maxWidth?: number;
  /** Maximum height in pixels (default: 600) */
  maxHeight?: number;
  /** Accepted file types (default: image/*) */
  accept?: string;
  /** Additional CSS class */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
}

// ============================================================================
// STYLES
// ============================================================================

const DIALOG_OVERLAY_STYLE: CSSProperties = {
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

const DIALOG_CONTENT_STYLE: CSSProperties = {
  backgroundColor: 'var(--doc-surface)',
  borderRadius: '8px',
  boxShadow: '0 4px 20px var(--doc-shadow)',
  minWidth: '450px',
  maxWidth: '600px',
  width: '100%',
  margin: '20px',
  maxHeight: '90vh',
  overflow: 'auto',
};

const DIALOG_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px 20px',
  borderBottom: '1px solid var(--doc-border)',
};

const DIALOG_TITLE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 600,
  color: 'var(--doc-text)',
};

const CLOSE_BUTTON_STYLE: CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: '20px',
  cursor: 'pointer',
  color: 'var(--doc-text-muted)',
  padding: '4px 8px',
  lineHeight: 1,
};

const DIALOG_BODY_STYLE: CSSProperties = {
  padding: '20px',
};

const DROP_ZONE_STYLE: CSSProperties = {
  border: '2px dashed var(--doc-border-input)',
  borderRadius: '8px',
  padding: '40px 20px',
  textAlign: 'center',
  cursor: 'pointer',
  transition: 'border-color 0.2s, background-color 0.2s',
  marginBottom: '16px',
};

const DROP_ZONE_ACTIVE_STYLE: CSSProperties = {
  ...DROP_ZONE_STYLE,
  borderColor: 'var(--doc-primary)',
  backgroundColor: 'var(--doc-primary-light)',
};

const DROP_ZONE_WITH_IMAGE_STYLE: CSSProperties = {
  ...DROP_ZONE_STYLE,
  padding: '20px',
  borderStyle: 'solid',
  borderColor: 'var(--doc-primary)',
};

const PREVIEW_CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  maxHeight: '250px',
  overflow: 'hidden',
};

const PREVIEW_IMAGE_STYLE: CSSProperties = {
  maxWidth: '100%',
  maxHeight: '250px',
  objectFit: 'contain',
  borderRadius: '4px',
};

const DROP_ZONE_ICON_STYLE: CSSProperties = {
  fontSize: '48px',
  color: 'var(--doc-text-placeholder)',
  marginBottom: '12px',
};

const DROP_ZONE_TEXT_STYLE: CSSProperties = {
  fontSize: '14px',
  color: 'var(--doc-text-muted)',
  marginBottom: '8px',
};

const DROP_ZONE_SUBTEXT_STYLE: CSSProperties = {
  fontSize: '12px',
  color: 'var(--doc-text-placeholder)',
};

const FORM_GROUP_STYLE: CSSProperties = {
  marginBottom: '16px',
};

const LABEL_STYLE: CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--doc-text)',
};

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--doc-border-input)',
  borderRadius: '4px',
  fontSize: '14px',
  boxSizing: 'border-box',
};

const SIZE_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '16px',
};

const SIZE_INPUT_STYLE: CSSProperties = {
  width: '100px',
  padding: '6px 8px',
  border: '1px solid var(--doc-border-input)',
  borderRadius: '4px',
  fontSize: '14px',
};

const INLINE_LABEL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '14px',
  color: 'var(--doc-text)',
  fontWeight: 500,
};

const LOCK_LABEL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '13px',
  color: 'var(--doc-text-muted)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const DIALOG_FOOTER_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '12px',
  padding: '16px 20px',
  borderTop: '1px solid var(--doc-border)',
};

const BUTTON_BASE_STYLE: CSSProperties = {
  padding: '10px 20px',
  borderRadius: '4px',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
  border: 'none',
};

const PRIMARY_BUTTON_STYLE: CSSProperties = {
  ...BUTTON_BASE_STYLE,
  backgroundColor: 'var(--doc-primary)',
  color: 'var(--doc-on-primary)',
};

const SECONDARY_BUTTON_STYLE: CSSProperties = {
  ...BUTTON_BASE_STYLE,
  backgroundColor: 'var(--doc-bg-subtle)',
  color: 'var(--doc-text)',
  border: '1px solid var(--doc-border-input)',
};

const DISABLED_BUTTON_STYLE: CSSProperties = {
  ...BUTTON_BASE_STYLE,
  backgroundColor: 'var(--doc-border-input)',
  color: 'var(--doc-text-muted)',
  cursor: 'not-allowed',
};

// ============================================================================
// ICONS
// ============================================================================

function ImageIcon(): React.ReactElement {
  return (
    <span style={{ color: 'var(--doc-text-placeholder)' }}>
      <MaterialSymbol name="image" size={48} />
    </span>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * InsertImageDialog - Modal for inserting images with preview and sizing
 */
export function InsertImageDialog({
  isOpen,
  onClose,
  onInsert,
  maxWidth = 800,
  maxHeight = 600,
  accept = 'image/*',
  className,
  style,
}: InsertImageDialogProps): React.ReactElement | null {
  const { t } = useTranslation();

  // State
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const {
    width,
    height,
    lockAspect: aspectLocked,
    setLockAspect: setAspectLocked,
    handleWidthChange,
    handleHeightChange,
    seed: seedAspect,
  } = useAspectLockedSize();
  const [altText, setAltText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setImageData(null);
      setIsDragging(false);
      seedAspect(null, null);
      setAltText('');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /**
   * Process a file and load image data
   */
  const processFile = useCallback(
    (file: File) => {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError(t('dialogs.insertImage.invalidFile'));
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError(t('dialogs.insertImage.fileTooLarge'));
        return;
      }

      setError(null);

      const reader = new FileReader();
      reader.onload = (e) => {
        const src = e.target?.result as string;

        // Load image to get dimensions
        const img = new Image();
        img.onload = () => {
          let w = img.width;
          let h = img.height;

          // Scale down if exceeds max dimensions
          if (w > maxWidth || h > maxHeight) {
            const scaleW = maxWidth / w;
            const scaleH = maxHeight / h;
            const scale = Math.min(scaleW, scaleH);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }

          seedAspect(w, h);
          setImageData({
            src,
            width: w,
            height: h,
            fileName: file.name,
            mimeType: file.type,
          });
        };
        img.src = src;
      };

      reader.onerror = () => {
        setError('Failed to read image file');
      };

      reader.readAsDataURL(file);
    },
    [maxWidth, maxHeight]
  );

  /**
   * Handle file input change
   */
  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile]
  );

  /**
   * Handle drop zone click
   */
  const handleDropZoneClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /**
   * Handle drag over
   */
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  /**
   * Handle drag leave
   */
  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  /**
   * Handle drop
   */
  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files?.[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile]
  );

  /**
   * Handle insert
   */
  const handleInsert = useCallback(() => {
    if (imageData && typeof width === 'number' && typeof height === 'number') {
      onInsert({
        ...imageData,
        width,
        height,
        alt: altText || undefined,
      });
    }
  }, [imageData, width, height, altText, onInsert]);

  /**
   * Handle keyboard events
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter' && imageData && !e.shiftKey) {
        e.preventDefault();
        handleInsert();
      }
    },
    [onClose, imageData, handleInsert]
  );

  /**
   * Handle overlay click
   */
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  /**
   * Clear current image
   */
  const handleClear = useCallback(() => {
    setImageData(null);
    seedAspect(null, null);
    setAltText('');
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [seedAspect]);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  const canInsert =
    imageData !== null &&
    typeof width === 'number' &&
    width > 0 &&
    typeof height === 'number' &&
    height > 0;

  // Get drop zone style
  const getDropZoneStyle = (): CSSProperties => {
    if (imageData) return DROP_ZONE_WITH_IMAGE_STYLE;
    if (isDragging) return DROP_ZONE_ACTIVE_STYLE;
    return DROP_ZONE_STYLE;
  };

  return (
    <div
      className={`docx-insert-image-dialog-overlay ${className || ''}`}
      style={{ ...DIALOG_OVERLAY_STYLE, ...style }}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="insert-image-dialog-title"
    >
      <div
        ref={dialogRef}
        className="docx-insert-image-dialog"
        style={DIALOG_CONTENT_STYLE}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="docx-insert-image-dialog-header" style={DIALOG_HEADER_STYLE}>
          <h2 id="insert-image-dialog-title" style={DIALOG_TITLE_STYLE}>
            {t('dialogs.insertImage.title')}
          </h2>
          <button
            type="button"
            className="docx-insert-image-dialog-close"
            style={CLOSE_BUTTON_STYLE}
            onClick={onClose}
            aria-label={t('common.closeDialog')}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="docx-insert-image-dialog-body" style={DIALOG_BODY_STYLE}>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          {/* Drop zone / Preview */}
          <div
            className="docx-insert-image-dropzone"
            style={getDropZoneStyle()}
            onClick={handleDropZoneClick}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            aria-label={t('dialogs.insertImage.uploadAriaLabel')}
          >
            {imageData ? (
              <div style={PREVIEW_CONTAINER_STYLE}>
                <img src={imageData.src} alt={altText || 'Preview'} style={PREVIEW_IMAGE_STYLE} />
              </div>
            ) : (
              <>
                <div style={DROP_ZONE_ICON_STYLE}>
                  <ImageIcon />
                </div>
                <div style={DROP_ZONE_TEXT_STYLE}>{t('dialogs.insertImage.uploadText')}</div>
                <div style={DROP_ZONE_SUBTEXT_STYLE}>{t('dialogs.insertImage.uploadSubtext')}</div>
              </>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div
              style={{
                color: 'var(--doc-error)',
                fontSize: '14px',
                marginBottom: '16px',
                textAlign: 'center',
              }}
            >
              {error}
            </div>
          )}

          {imageData && (
            <>
              <div style={SIZE_ROW_STYLE}>
                <label style={INLINE_LABEL_STYLE}>
                  {t('dialogs.insertImage.widthLabel')}
                  <input
                    type="number"
                    value={width}
                    onChange={(e) => handleWidthChange(e.target.value)}
                    min={1}
                    max={maxWidth}
                    style={SIZE_INPUT_STYLE}
                  />
                </label>
                <label style={INLINE_LABEL_STYLE}>
                  {t('dialogs.insertImage.heightLabel')}
                  <input
                    type="number"
                    value={height}
                    onChange={(e) => handleHeightChange(e.target.value)}
                    min={1}
                    max={maxHeight}
                    style={SIZE_INPUT_STYLE}
                  />
                </label>
                <label style={LOCK_LABEL_STYLE}>
                  <input
                    type="checkbox"
                    checked={aspectLocked}
                    onChange={(e) => setAspectLocked(e.target.checked)}
                  />
                  {aspectLocked
                    ? t('dialogs.insertImage.aspectRatioLocked')
                    : t('dialogs.insertImage.aspectRatioUnlocked')}
                </label>
              </div>

              <div style={FORM_GROUP_STYLE}>
                <label htmlFor="insert-image-alt" style={LABEL_STYLE}>
                  {t('dialogs.insertImage.altTextLabel')}
                </label>
                <input
                  id="insert-image-alt"
                  type="text"
                  value={altText}
                  onChange={(e) => setAltText(e.target.value)}
                  placeholder={t('dialogs.insertImage.altTextPlaceholder')}
                  style={INPUT_STYLE}
                />
              </div>
            </>
          )}
        </div>

        <div className="docx-insert-image-dialog-footer" style={DIALOG_FOOTER_STYLE}>
          {(() => {
            const hasImage = imageData !== null;
            return (
              <button
                type="button"
                className="docx-insert-image-dialog-clear"
                style={SECONDARY_BUTTON_STYLE}
                onClick={hasImage ? handleClear : onClose}
              >
                {hasImage ? t('common.clear') : t('common.cancel')}
              </button>
            );
          })()}
          <button
            type="button"
            className="docx-insert-image-dialog-insert"
            style={canInsert ? PRIMARY_BUTTON_STYLE : DISABLED_BUTTON_STYLE}
            onClick={handleInsert}
            disabled={!canInsert}
          >
            {t('dialogs.insertImage.insertButton')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for managing Insert Image dialog state
 */
export function useInsertImageDialog(): {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
} {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  return { isOpen, open, close, toggle };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if a file is a valid image
 */
export function isValidImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * Get supported image extensions
 */
export function getSupportedImageExtensions(): string[] {
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
}

/**
 * Get accept string for file input
 */
export function getImageAcceptString(): string {
  return 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml';
}

/**
 * Calculate scaled dimensions to fit within bounds
 */
export function calculateFitDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
    return { width: originalWidth, height: originalHeight };
  }

  const scaleX = maxWidth / originalWidth;
  const scaleY = maxHeight / originalHeight;
  const scale = Math.min(scaleX, scaleY);

  return {
    width: Math.round(originalWidth * scale),
    height: Math.round(originalHeight * scale),
  };
}

/**
 * Convert data URL to Blob
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  // Extract the MIME type with index math rather than a regex: a data URL
  // header like `data:<mime>;base64` has the type between the first `:` and
  // the next `;`. A `/:(.*?);/` match retried at every `:` and scanned to the
  // end on each try, which backtracks quadratically on hostile input.
  const header = parts[0];
  const colon = header.indexOf(':');
  let mime = 'image/png';
  if (colon !== -1) {
    const semi = header.indexOf(';', colon + 1);
    const candidate = header.slice(colon + 1, semi === -1 ? undefined : semi);
    // Only accept a well-formed `type/subtype`; otherwise keep the fallback so
    // a malformed header (no `;` and no `/`) can't yield a junk Blob type.
    if (candidate.includes('/')) mime = candidate;
  }
  const binaryString = atob(parts[1]);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

/**
 * Get image dimensions from a data URL
 */
export function getImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default InsertImageDialog;
