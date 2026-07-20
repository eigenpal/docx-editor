import { useCallback, useMemo, useState } from 'react';
import type { Document, SectionProperties } from '@docx-editor.dev/core/types/document';
import {
  setIndentLeft,
  setIndentRight,
  setIndentFirstLine,
  removeTabMark,
} from '@docx-editor.dev/core/prosemirror/commands';
import type { EditorView } from 'prosemirror-view';

/**
 * Page setup + ruler controls: page-level margin handlers (header/footer
 * page setup dialog + drag in the rulers), paragraph indent handlers, and
 * tab-stop removal. Margin changes go through `handleDocumentChange` so
 * they land in the undo/redo history; indent and tab-stop changes
 * dispatch through the active editor view.
 */
export function usePageSetupControls({
  document,
  readOnly,
  handleDocumentChange,
  getActiveEditorView,
}: {
  document: Document | null;
  readOnly: boolean;
  handleDocumentChange: (doc: Document) => void;
  getActiveEditorView: () => EditorView | null | undefined;
}) {
  const [showPageSetup, setShowPageSetup] = useState(false);
  const handleOpenPageSetup = useCallback(() => setShowPageSetup(true), []);

  const createMarginHandler = useCallback(
    (property: 'marginLeft' | 'marginRight' | 'marginTop' | 'marginBottom') =>
      (marginTwips: number) => {
        if (!document || readOnly) return;
        const newDoc = {
          ...document,
          package: {
            ...document.package,
            document: {
              ...document.package.document,
              finalSectionProperties: {
                ...document.package.document.finalSectionProperties,
                [property]: marginTwips,
              },
            },
          },
        };
        handleDocumentChange(newDoc);
      },
    [document, readOnly, handleDocumentChange]
  );

  const handleLeftMarginChange = useMemo(
    () => createMarginHandler('marginLeft'),
    [createMarginHandler]
  );
  const handleRightMarginChange = useMemo(
    () => createMarginHandler('marginRight'),
    [createMarginHandler]
  );
  const handleTopMarginChange = useMemo(
    () => createMarginHandler('marginTop'),
    [createMarginHandler]
  );
  const handleBottomMarginChange = useMemo(
    () => createMarginHandler('marginBottom'),
    [createMarginHandler]
  );

  const handlePageSetupApply = useCallback(
    (props: Partial<SectionProperties>) => {
      if (!document || readOnly) return;
      const newDoc = {
        ...document,
        package: {
          ...document.package,
          document: {
            ...document.package.document,
            finalSectionProperties: {
              ...document.package.document.finalSectionProperties,
              ...props,
            },
          },
        },
      };
      handleDocumentChange(newDoc);
    },
    [document, readOnly, handleDocumentChange]
  );

  const handleIndentLeftChange = useCallback(
    (twips: number) => {
      const view = getActiveEditorView();
      if (!view) return;
      setIndentLeft(twips)(view.state, view.dispatch);
    },
    [getActiveEditorView]
  );

  const handleIndentRightChange = useCallback(
    (twips: number) => {
      const view = getActiveEditorView();
      if (!view) return;
      setIndentRight(twips)(view.state, view.dispatch);
    },
    [getActiveEditorView]
  );

  const handleFirstLineIndentChange = useCallback(
    (twips: number) => {
      const view = getActiveEditorView();
      if (!view) return;
      // Negative twips encode a hanging indent.
      if (twips < 0) {
        setIndentFirstLine(-twips, true)(view.state, view.dispatch);
      } else {
        setIndentFirstLine(twips, false)(view.state, view.dispatch);
      }
    },
    [getActiveEditorView]
  );

  const handleTabMarkRemove = useCallback(
    (positionTwips: number) => {
      const view = getActiveEditorView();
      if (!view) return;
      removeTabMark(positionTwips)(view.state, view.dispatch);
    },
    [getActiveEditorView]
  );

  return {
    showPageSetup,
    setShowPageSetup,
    handleOpenPageSetup,
    handleLeftMarginChange,
    handleRightMarginChange,
    handleTopMarginChange,
    handleBottomMarginChange,
    handlePageSetupApply,
    handleIndentLeftChange,
    handleIndentRightChange,
    handleFirstLineIndentChange,
    handleTabMarkRemove,
  };
}
