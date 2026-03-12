/**
 * EditorToolbar — Google Docs-style 2-level compound component.
 *
 * Usage:
 *   <EditorToolbar {...toolbarProps}>
 *     <EditorToolbar.TitleBar>
 *       <EditorToolbar.Logo><MyIcon /></EditorToolbar.Logo>
 *       <EditorToolbar.DocumentName value={name} onChange={setName} />
 *       <EditorToolbar.MenuBar />
 *       <EditorToolbar.TitleBarRight>
 *         <button>Save</button>
 *       </EditorToolbar.TitleBarRight>
 *     </EditorToolbar.TitleBar>
 *     <EditorToolbar.FormattingBar />
 *   </EditorToolbar>
 */

import type { ReactNode } from 'react';
import { EditorToolbarContext } from './EditorToolbarContext';
import type { EditorToolbarProps } from './EditorToolbarContext';
import { TitleBar, Logo, DocumentName, MenuBar, TitleBarRight } from './TitleBar';
import type { TitleBarProps, LogoProps, DocumentNameProps, TitleBarRightProps } from './TitleBar';
import { FormattingBar } from './FormattingBar';
import type { FormattingBarProps } from './FormattingBar';
import { cn } from '../lib/utils';

// ============================================================================
// Main compound component
// ============================================================================

interface EditorToolbarComponent {
  (props: EditorToolbarProps & { children: ReactNode }): React.JSX.Element;
  TitleBar: typeof TitleBar;
  Logo: typeof Logo;
  DocumentName: typeof DocumentName;
  MenuBar: typeof MenuBar;
  TitleBarRight: typeof TitleBarRight;
  FormattingBar: typeof FormattingBar;
}

function EditorToolbarBase({
  children,
  className,
  ...toolbarProps
}: EditorToolbarProps & { children: ReactNode }) {
  return (
    <EditorToolbarContext.Provider value={toolbarProps}>
      <div
        className={cn('flex flex-col bg-white shadow-sm flex-shrink-0', className)}
        data-testid="editor-toolbar"
      >
        {children}
      </div>
    </EditorToolbarContext.Provider>
  );
}

// Attach sub-components as static properties
const EditorToolbar = EditorToolbarBase as EditorToolbarComponent;
EditorToolbar.TitleBar = TitleBar;
EditorToolbar.Logo = Logo;
EditorToolbar.DocumentName = DocumentName;
EditorToolbar.MenuBar = MenuBar;
EditorToolbar.TitleBarRight = TitleBarRight;
EditorToolbar.FormattingBar = FormattingBar;

export { EditorToolbar };
export type {
  EditorToolbarProps,
  TitleBarProps,
  LogoProps,
  DocumentNameProps,
  TitleBarRightProps,
  FormattingBarProps,
};
