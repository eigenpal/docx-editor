/**
 * Page setup: the dialog, and the ruler drags that change one margin at a time.
 *
 * PORTED from the legacy hook of the same name. The handler names, the margin-handler
 * factory shape, and the hanging-indent encoding (negative twips mean hanging) are
 * legacy's.
 *
 * Legacy rebuilt the whole document object to change one margin — spreading
 * `package.document.finalSectionProperties` and handing the new tree to
 * `handleDocumentChange`. There is no document tree to rebuild here: `setPageSetup`
 * names the fields that change and leaves the rest alone, which is also why a ruler drag
 * sends exactly one field rather than a whole section record.
 *
 * `setPageSetup`, `setIndent` and `removeTabMark` are all refused by the engine today, so
 * a margin drag snaps back rather than moving the page — the honest outcome, and better
 * than a ruler that appears to work while the document does not change.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';
import type { SectionProperties } from '../../../legacy-core-compat';

export function usePageSetupControls({
  readOnly,
  editorRef,
}: {
  readOnly: boolean;
  editorRef: React.RefObject<Editor | null>;
}) {
  const [showPageSetup, setShowPageSetup] = useState(false);
  const handleOpenPageSetup = useCallback(() => setShowPageSetup(true), []);

  const createMarginHandler = useCallback(
    (property: 'marginLeft' | 'marginRight' | 'marginTop' | 'marginBottom') =>
      (marginTwips: number) => {
        if (readOnly) return;
        editorRef.current?.exec({ type: 'setPageSetup', [property]: marginTwips });
      },
    [readOnly, editorRef]
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
      if (readOnly) return;
      // Only the fields the command carries are forwarded — the rest of legacy's
      // `SectionProperties` (borders, columns, note properties) has no command yet.
      editorRef.current?.exec({
        type: 'setPageSetup',
        ...(props.pageWidth !== undefined ? { pageWidth: props.pageWidth } : {}),
        ...(props.pageHeight !== undefined ? { pageHeight: props.pageHeight } : {}),
        ...(props.marginTop !== undefined ? { marginTop: props.marginTop } : {}),
        ...(props.marginRight !== undefined ? { marginRight: props.marginRight } : {}),
        ...(props.marginBottom !== undefined ? { marginBottom: props.marginBottom } : {}),
        ...(props.marginLeft !== undefined ? { marginLeft: props.marginLeft } : {}),
      });
    },
    [readOnly, editorRef]
  );

  const handleIndentLeftChange = useCallback(
    (twips: number) => {
      editorRef.current?.exec({ type: 'setIndent', left: twips });
    },
    [editorRef]
  );

  const handleIndentRightChange = useCallback(
    (twips: number) => {
      editorRef.current?.exec({ type: 'setIndent', right: twips });
    },
    [editorRef]
  );

  const handleFirstLineIndentChange = useCallback(
    (twips: number) => {
      // Negative twips encode a hanging indent — legacy's convention, kept.
      editorRef.current?.exec(
        twips < 0 ? { type: 'setIndent', hanging: -twips } : { type: 'setIndent', firstLine: twips }
      );
    },
    [editorRef]
  );

  const handleTabMarkRemove = useCallback(
    (positionTwips: number) => {
      editorRef.current?.exec({ type: 'removeTabMark', positionTwips });
    },
    [editorRef]
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
