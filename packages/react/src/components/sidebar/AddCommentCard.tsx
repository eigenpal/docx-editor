import { useState } from 'react';
import type { SidebarItemRenderProps } from '../../plugin-api/types';
import { submitButtonStyle, CANCEL_BUTTON_STYLE } from './cardUtils';
import { useTranslation } from '../../i18n';

export interface AddCommentCardProps extends SidebarItemRenderProps {
  onSubmit?: (text: string) => void;
  onCancel?: () => void;
}

export function AddCommentCard({ measureRef, onSubmit, onCancel }: AddCommentCardProps) {
  const [text, setText] = useState('');
  const { t } = useTranslation();

  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit?.(text.trim());
      setText('');
    }
  };

  return (
    <div
      ref={measureRef}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: 'var(--doc-surface)',
        boxShadow: '0 1px 3px var(--doc-shadow-strong), 0 4px 8px 3px var(--doc-shadow)',
        zIndex: 50,
      }}
    >
      <textarea
        ref={(el) => el?.focus({ preventScroll: true })}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
          if (e.key === 'Escape') {
            onCancel?.();
            setText('');
          }
        }}
        placeholder={t('comments.addComment')}
        style={{
          width: '100%',
          border: '1px solid var(--doc-primary)',
          borderRadius: 20,
          outline: 'none',
          resize: 'none',
          fontSize: 14,
          lineHeight: '20px',
          padding: '8px 16px',
          fontFamily: 'inherit',
          minHeight: 40,
          boxSizing: 'border-box',
          color: 'var(--doc-text)',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button
          onClick={() => {
            onCancel?.();
            setText('');
          }}
          style={CANCEL_BUTTON_STYLE}
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          style={submitButtonStyle(!!text.trim())}
        >
          {t('common.comment')}
        </button>
      </div>
    </div>
  );
}
