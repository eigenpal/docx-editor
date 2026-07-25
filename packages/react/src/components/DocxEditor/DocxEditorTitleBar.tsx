// Document title chrome (interactive-paginated-editing M4.3).
// Shared adapter presentation and compatibility behavior.
// legacy title bar carried a file menu, sharing, account chrome, and document
// mutation paths. None of that has a greenfield contract.
//
// Title ownership is deliberately the SHELL's, not the engine's (M4.0): there
// is no `Editor` title contract, so the title lives in host state and this
// component is a controlled input over it. It must never be presented as if it
// were persisted into the document.

import type { ChangeEvent, ReactNode } from 'react';

export interface DocxEditorTitleBarProps {
  readonly title: string;
  readonly onTitleChange?: (title: string) => void;
  /** Right-hand slot for host actions (save, download). */
  readonly actions?: ReactNode;
  readonly readOnly?: boolean;
}

export function DocxEditorTitleBar({
  title,
  onTitleChange,
  actions,
  readOnly,
}: DocxEditorTitleBarProps): ReactNode {
  const editable = !readOnly && typeof onTitleChange === 'function';
  return (
    <div className="ep-shell__title-bar" data-testid="document-title-bar">
      <input
        className="ep-shell__title-input"
        data-testid="document-title"
        value={title}
        readOnly={!editable}
        aria-label="Document title"
        onChange={(event: ChangeEvent<HTMLInputElement>) => onTitleChange?.(event.target.value)}
      />
      {actions ? <div className="ep-shell__title-actions">{actions}</div> : null}
    </div>
  );
}
