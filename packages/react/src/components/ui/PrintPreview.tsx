/**
 * Print Utilities
 *
 * Provides print functionality with:
 * - Print button component for toolbar
 * - Print-specific CSS styles
 * - Browser print dialog trigger
 * - Page range utilities
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from '../../i18n';

// Print data helpers are framework-agnostic and live in core as the single
// source of truth; re-export them so the React API surface is unchanged.
// Only the React-specific JSX (PrintButton, PrintStyles) is defined here.
export {
  type PrintOptions,
  getDefaultPrintOptions,
  triggerPrint,
  openPrintWindow,
  parsePageRange,
  formatPageRange,
  isPrintSupported,
} from '@eigenpal/docx-editor-core';

// ============================================================================
// TYPES
// ============================================================================

/**
 * PrintButton props
 */
export interface PrintButtonProps {
  /** Callback when print is triggered */
  onPrint: () => void;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Button label */
  label?: string;
  /** Additional CSS class */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Show icon */
  showIcon?: boolean;
  /** Compact mode */
  compact?: boolean;
}

// ============================================================================
// PRINT BUTTON COMPONENT
// ============================================================================

/**
 * PrintButton - Standalone print button for toolbar
 */
export function PrintButton({
  onPrint,
  disabled = false,
  label: labelProp,
  className = '',
  style,
  showIcon = true,
  compact = false,
}: PrintButtonProps): React.ReactElement {
  const { t } = useTranslation();
  const label = labelProp ?? t('print.label');
  const buttonStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: compact ? '4px' : '6px',
    padding: compact ? '4px 8px' : '6px 12px',
    fontSize: compact ? '13px' : '14px',
    backgroundColor: 'var(--doc-surface)',
    border: '1px solid var(--doc-border)',
    borderRadius: '4px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    color: disabled ? 'var(--doc-text-muted)' : 'var(--doc-text)',
    opacity: disabled ? 0.6 : 1,
    transition: 'background-color 0.15s, border-color 0.15s',
    ...style,
  };

  return (
    <button
      className={`docx-print-button ${className}`.trim()}
      style={buttonStyle}
      onClick={onPrint}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {showIcon && <PrintIcon size={compact ? 14 : 16} />}
      {!compact && <span>{label}</span>}
    </button>
  );
}

// ============================================================================
// PRINT STYLES COMPONENT
// ============================================================================

/**
 * PrintStyles - Injects print-specific CSS
 */
export function PrintStyles(): React.ReactElement {
  return (
    <style>
      {`
        @media print {
          /* Hide everything except print content */
          body * {
            visibility: hidden;
          }

          .docx-print-pages,
          .docx-print-pages * {
            visibility: visible;
          }

          .docx-print-pages {
            position: absolute;
            left: 0;
            top: 0;
          }

          /* Remove shadows and margins in print */
          .docx-print-page {
            box-shadow: none !important;
            margin: 0 !important;
            page-break-after: always;
            page-break-inside: avoid;
          }

          /* Ensure images print */
          img {
            max-width: 100%;
            page-break-inside: avoid;
          }

          /* Ensure tables don't break badly */
          table {
            page-break-inside: avoid;
          }

          tr {
            page-break-inside: avoid;
          }

          /* Keep headings with content */
          h1, h2, h3, h4, h5, h6 {
            page-break-after: avoid;
          }

          /* Avoid orphan lines */
          p {
            orphans: 3;
            widows: 3;
          }
        }

        @page {
          margin: 0;
          size: auto;
        }
      `}
    </style>
  );
}

// ============================================================================
// ICONS
// ============================================================================

interface IconProps {
  size?: number;
}

function PrintIcon({ size = 18 }: IconProps): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}
