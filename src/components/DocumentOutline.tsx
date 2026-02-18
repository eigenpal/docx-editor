import React, { useEffect, useState } from 'react';
import type { HeadingInfo } from '../utils/headingCollector';
import { MaterialSymbol } from './ui/Icons';

/** @deprecated Use HeadingInfo from utils/headingCollector instead */
export type OutlineHeading = HeadingInfo;

interface DocumentOutlineProps {
  headings: HeadingInfo[];
  onHeadingClick: (pmPos: number) => void;
  onClose: () => void;
  topOffset?: number;
}

export const DocumentOutline: React.FC<DocumentOutlineProps> = ({
  headings,
  onHeadingClick,
  onClose,
  topOffset = 0,
}) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Trigger slide-in on next frame
    requestAnimationFrame(() => setOpen(true));
  }, []);

  return (
    <nav
      className="docx-outline-nav"
      role="navigation"
      aria-label="Document outline"
      style={{
        position: 'absolute',
        top: topOffset,
        left: 30,
        bottom: 0,
        width: 240,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
        zIndex: 40,
        // Slide-in animation
        transform: open ? 'translateX(0)' : 'translateX(-270px)',
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
          aria-label="Close outline"
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
          title="Close outline"
        >
          <MaterialSymbol name="arrow_back" size={20} />
        </button>
        <span style={{ fontWeight: 400, fontSize: 14, color: '#1f1f1f', letterSpacing: '0.01em' }}>
          Outline
        </span>
      </div>

      {/* Heading list */}
      <div style={{ overflowY: 'auto', flex: 1, paddingLeft: 20 }}>
        {headings.length === 0 ? (
          <div style={{ padding: '8px 16px', color: '#80868b', fontSize: 13, lineHeight: '20px' }}>
            No headings found. Add headings to your document to see them here.
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
};
