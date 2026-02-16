import React, { useEffect, useState } from 'react';

export interface OutlineHeading {
  text: string;
  level: number;
  pmPos: number;
}

interface DocumentOutlineProps {
  headings: OutlineHeading[];
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
    <div
      className="docx-outline-nav"
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
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            arrow_back
          </span>
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
                onMouseOver={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = '#f1f3f4';
                }}
                onMouseOut={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                }}
                title={heading.text}
              >
                {heading.text}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
