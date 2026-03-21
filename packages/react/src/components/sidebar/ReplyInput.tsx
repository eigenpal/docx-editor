import { useState } from 'react';
import { submitButtonStyle, CANCEL_BUTTON_STYLE } from './cardUtils';

const ACTIVE_INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  border: '1px solid #1a73e8',
  borderRadius: 20,
  outline: 'none',
  fontSize: 14,
  padding: '8px 16px',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
  color: '#202124',
};

const INACTIVE_INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  border: '1px solid #dadce0',
  borderRadius: 20,
  outline: 'none',
  fontSize: 14,
  padding: '8px 16px',
  fontFamily: 'inherit',
  color: '#80868b',
  cursor: 'text',
  backgroundColor: '#fff',
  boxSizing: 'border-box',
};

export interface ReplyInputProps {
  onSubmit: (text: string) => void;
}

export function ReplyInput({ onSubmit }: ReplyInputProps) {
  const [active, setActive] = useState(false);
  const [text, setText] = useState('');

  if (!active) {
    return (
      <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 12 }}>
        <input
          readOnly
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setActive(true);
          }}
          placeholder="Reply or add others with @"
          style={INACTIVE_INPUT_STYLE}
        />
      </div>
    );
  }

  const trimmed = text.trim();

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 12 }}>
      <input
        ref={(el) => el?.focus({ preventScroll: true })}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            if (trimmed) onSubmit(trimmed);
            setText('');
            setActive(false);
          }
          if (e.key === 'Escape') {
            setActive(false);
            setText('');
          }
        }}
        placeholder="Reply or add others with @"
        style={ACTIVE_INPUT_STYLE}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setActive(false);
            setText('');
          }}
          style={CANCEL_BUTTON_STYLE}
        >
          Cancel
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (trimmed) onSubmit(trimmed);
            setText('');
            setActive(false);
          }}
          disabled={!trimmed}
          style={submitButtonStyle(!!trimmed)}
        >
          Reply
        </button>
      </div>
    </div>
  );
}
