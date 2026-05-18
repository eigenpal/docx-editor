import { useCallback, useState } from 'react';
import type {
  Document,
  FootnoteProperties,
  EndnoteProperties,
} from '@eigenpal/docx-editor-core/types/document';
import { setImageWrapType } from '@eigenpal/docx-editor-core/prosemirror/commands';
import {
  captureInlinePositionEmu,
  toolbarValueToLayoutTarget,
} from '@eigenpal/docx-editor-core/layout-painter';
import type { EditorView } from 'prosemirror-view';
import type { ImagePositionData } from '../../dialogs/ImagePositionDialog';
import type { ImagePropertiesData } from '../../dialogs/ImagePropertiesDialog';

/** Minimal shape the hook needs from the parent's selection-tracker state. */
interface ImageContext {
  pos: number;
}

/**
 * Image-related dialogs and toolbar actions:
 *  - wrap type (inline ↔ float-wrap variants) via setImageWrapType
 *  - 90° rotate + horizontal/vertical flip via transform attr
 *  - position dialog (horizontal/vertical anchor + distFrom* offsets)
 *  - properties dialog (alt text, border, width/height)
 *  - footnote/endnote properties dialog (footnote numbering/format)
 *
 * Owns the open/closed state for each dialog; the JSX consumer reads the
 * `*Open` flags + the apply/cancel callbacks. `pmImageContext` comes
 * from the parent's selection-tracker state because it's set by the
 * image right-click flow.
 */
export function useImageActions({
  document,
  pmImageContext,
  zoom,
  getActiveEditorView,
  focusActiveEditor,
  pushDocument,
}: {
  document: Document | null;
  pmImageContext: ImageContext | null | undefined;
  zoom: number;
  getActiveEditorView: () => EditorView | null | undefined;
  focusActiveEditor: () => void;
  pushDocument: (doc: Document) => void;
}) {
  const [imagePositionOpen, setImagePositionOpen] = useState(false);
  const [imagePropsOpen, setImagePropsOpen] = useState(false);
  const [footnotePropsOpen, setFootnotePropsOpen] = useState(false);

  const handleImageWrapType = useCallback(
    (toolbarValue: string) => {
      const view = getActiveEditorView();
      if (!view || !pmImageContext) return;
      const pos = pmImageContext.pos;
      const node = view.state.doc.nodeAt(pos);
      if (!node || node.type.name !== 'image') return;

      // The toolbar and the right-click menu share `setImageWrapType` and its
      // `resolveAnchorAttrs` taxonomy. `toolbarValueToLayoutTarget` lives in
      // core so the Vue adapter doesn't have to duplicate it.
      const target = toolbarValueToLayoutTarget(toolbarValue);
      if (!target) return;

      // For inline → anchor, capture the inline glyph's rendered offset so the
      // new float lands at the same X/Y (Word's behavior). The core helper
      // handles the zoom + EMU conversion uniformly.
      let opts: { initialPositionEmu?: { horizontalEmu: number; verticalEmu: number } } | undefined;
      if (node.attrs.wrapType === 'inline' && target !== 'inline') {
        const inlineEl = window.document.querySelector(
          `.layout-run-image[data-doc-from="${pos}"]`
        ) as HTMLElement | null;
        const captured = inlineEl ? captureInlinePositionEmu(inlineEl, zoom) : undefined;
        if (captured) opts = { initialPositionEmu: captured };
      }

      setImageWrapType(pos, target, opts)(view.state, view.dispatch);
      focusActiveEditor();
    },
    [getActiveEditorView, focusActiveEditor, pmImageContext, zoom]
  );

  const handleImageTransform = useCallback(
    (action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV') => {
      const view = getActiveEditorView();
      if (!view || !pmImageContext) return;

      const pos = pmImageContext.pos;
      const node = view.state.doc.nodeAt(pos);
      if (!node || node.type.name !== 'image') return;

      const currentTransform = (node.attrs.transform as string) || '';
      const rotateMatch = currentTransform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
      let rotation = rotateMatch ? parseFloat(rotateMatch[1]) : 0;
      let hasFlipH = /scaleX\(-1\)/.test(currentTransform);
      let hasFlipV = /scaleY\(-1\)/.test(currentTransform);

      switch (action) {
        case 'rotateCW':
          rotation = (rotation + 90) % 360;
          break;
        case 'rotateCCW':
          rotation = (rotation - 90 + 360) % 360;
          break;
        case 'flipH':
          hasFlipH = !hasFlipH;
          break;
        case 'flipV':
          hasFlipV = !hasFlipV;
          break;
      }

      const parts: string[] = [];
      if (rotation !== 0) parts.push(`rotate(${rotation}deg)`);
      if (hasFlipH) parts.push('scaleX(-1)');
      if (hasFlipV) parts.push('scaleY(-1)');
      const newTransform = parts.length > 0 ? parts.join(' ') : null;

      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        transform: newTransform,
      });
      view.dispatch(tr.scrollIntoView());
      focusActiveEditor();
    },
    [getActiveEditorView, focusActiveEditor, pmImageContext]
  );

  const handleApplyImagePosition = useCallback(
    (data: ImagePositionData) => {
      const view = getActiveEditorView();
      if (!view || !pmImageContext) return;

      const pos = pmImageContext.pos;
      const node = view.state.doc.nodeAt(pos);
      if (!node || node.type.name !== 'image') return;

      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        position: {
          horizontal: data.horizontal,
          vertical: data.vertical,
        },
        distTop: data.distTop ?? node.attrs.distTop,
        distBottom: data.distBottom ?? node.attrs.distBottom,
        distLeft: data.distLeft ?? node.attrs.distLeft,
        distRight: data.distRight ?? node.attrs.distRight,
      });
      view.dispatch(tr.scrollIntoView());
      focusActiveEditor();
    },
    [getActiveEditorView, focusActiveEditor, pmImageContext]
  );

  const handleOpenImageProperties = useCallback(() => {
    setImagePropsOpen(true);
  }, []);

  const handleApplyImageProperties = useCallback(
    (data: ImagePropertiesData) => {
      const view = getActiveEditorView();
      if (!view || !pmImageContext) return;

      const pos = pmImageContext.pos;
      const node = view.state.doc.nodeAt(pos);
      if (!node || node.type.name !== 'image') return;

      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        alt: data.alt ?? null,
        borderWidth: data.borderWidth ?? null,
        borderColor: data.borderColor ?? null,
        borderKind: data.borderKind ?? null,
        width: data.width ?? null,
        height: data.height ?? null,
      });
      view.dispatch(tr.scrollIntoView());
      focusActiveEditor();
    },
    [getActiveEditorView, focusActiveEditor, pmImageContext]
  );

  const handleApplyFootnoteProperties = useCallback(
    (footnotePr: FootnoteProperties, endnotePr: EndnoteProperties) => {
      if (!document?.package) return;
      const newDoc = {
        ...document.package.document,
        finalSectionProperties: {
          ...document.package.document.finalSectionProperties,
          footnotePr,
          endnotePr,
        },
      };
      pushDocument({
        ...document,
        package: {
          ...document.package,
          document: newDoc,
        },
      });
    },
    [document, pushDocument]
  );

  return {
    imagePositionOpen,
    setImagePositionOpen,
    imagePropsOpen,
    setImagePropsOpen,
    footnotePropsOpen,
    setFootnotePropsOpen,
    handleImageWrapType,
    handleImageTransform,
    handleApplyImagePosition,
    handleOpenImageProperties,
    handleApplyImageProperties,
    handleApplyFootnoteProperties,
  };
}
