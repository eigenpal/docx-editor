import React, { useEffect, useState } from 'react';
import type { HeadingInfo } from '@eigenpal/docx-core/utils/headingCollector';
import { MaterialSymbol } from './ui/Icons';
import { useTranslation } from '../i18n';

/** @deprecated Use HeadingInfo from utils/headingCollector instead */
export type OutlineHeading = HeadingInfo;

// Outline panel geometry (px). Only the *_RESERVED_SPACE values leak out —
// the editor uses them to size the layout so the centered page never sits
// under the panel or the toggle button.
const OUTLINE_LEFT_OFFSET = 30;
const OUTLINE_WIDTH = 240;
const OUTLINE_PAGE_GAP = 16;
// Matches PagedEditor's VIEWPORT_PADDING_TOP so the panel header lines up
// with the page's top edge.
const OUTLINE_TOP_PADDING = 24;
export const OUTLINE_RESERVED_SPACE = OUTLINE_LEFT_OFFSET + OUTLINE_WIDTH + OUTLINE_PAGE_GAP;

// Toggle-button geometry (when the panel is collapsed): button anchor + icon
// box (~32px including padding) + gap before the page.
export const OUTLINE_BUTTON_LEFT_OFFSET = 48;
const OUTLINE_BUTTON_BOX = 32;
export const OUTLINE_BUTTON_RESERVED_SPACE =
  OUTLINE_BUTTON_LEFT_OFFSET + OUTLINE_BUTTON_BOX + OUTLINE_PAGE_GAP;

interface DocumentOutlineProps {
  headings: HeadingInfo[];
  onHeadingClick: (pmPos: number) => void;
  onClose: () => void;
  topOffset?: number;
  /** Horizontal scroll offset of the editor — outline slides left with the doc. */
  scrollLeft?: number;
}

export const DocumentOutline = React.memo(function DocumentOutline({
  headings,
  onHeadingClick,
  onClose,
  topOffset = 0,
  scrollLeft = 0,
}: DocumentOutlineProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Trigger slide-in on next frame
    requestAnimationFrame(() => setOpen(true));
  }, []);

  return (
    <nav
      className="docx-outline-nav"
      role="navigation"
      aria-label={t('documentOutline.ariaLabel')}
      style={{
        position: 'absolute',
        top: topOffset,
        // Anchor to OUTLINE_LEFT_OFFSET, then slide left by the editor's
        // horizontal scroll so the panel tracks the doc instead of staying
        // pinned to the viewport.
        left: OUTLINE_LEFT_OFFSET - scrollLeft,
        bottom: 0,
        width: OUTLINE_WIDTH,
        paddingTop: OUTLINE_TOP_PADDING,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
        zIndex: 40,
        // Slide-in animation — translate fully off-screen left of its anchor.
        // Only `transform` transitions; horizontal-scroll tracking via `left`
        // is intentionally untransitioned so the panel keeps up with the doc.
        transform: open ? 'translateX(0)' : `translateX(-${OUTLINE_LEFT_OFFSET + OUTLINE_WIDTH}px)`,
        transition: 'transform 0.15s ease-out',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header — back arrow + title */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '16px 16px 12px',
        }}
      >
        <button
          onClick={onClose}
          aria-label={t('documentOutline.closeAriaLabel')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            color: '#444746',
          }}
          title={t('documentOutline.closeTitle')}
        >
          <MaterialSymbol name="arrow_back" size={20} />
        </button>
        <span style={{ fontWeight: 400, fontSize: 14, color: '#1f1f1f', letterSpacing: '0.01em' }}>
          {t('documentOutline.title')}
        </span>
      </div>

      {/* Heading list */}
      <div style={{ overflowY: 'auto', flex: 1, paddingLeft: 20 }}>
        {headings.length === 0 ? (
          <div style={{ padding: '8px 16px', color: '#80868b', fontSize: 13, lineHeight: '20px' }}>
            {t('documentOutline.noHeadings')}
          </div>
        ) : (
          headings.map((heading, index) => (
            <div
              key={`${heading.pmPos}-${index}`}
              style={{
                marginLeft: heading.level * 12,
              }}
            >
              <button
                className="docx-outline-heading-btn"
                onClick={() => onHeadingClick(heading.pmPos)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '5px 12px',
                  fontSize: 13,
                  fontWeight: 400,
                  color: '#1f1f1f',
                  lineHeight: '18px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  borderRadius: 0,
                  letterSpacing: '0.01em',
                }}
                title={heading.text}
              >
                {heading.text}
              </button>
            </div>
          ))
        )}
      </div>
    </nav>
  );
});
