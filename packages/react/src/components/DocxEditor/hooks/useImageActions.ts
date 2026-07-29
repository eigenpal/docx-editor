/**
 * Image toolbar actions and the dialogs behind them, plus footnote properties.
 *
 * PORTED from the legacy hook of the same name. The handler names, the dialog open
 * flags, and the transform vocabulary (`rotateCW`/`rotateCCW`/`flipH`/`flipV`) are
 * legacy's.
 *
 * Legacy did the work in the adapter by reading and rewriting the image node's
 * attributes — parsing a CSS `transform` string with a regex, toggling `scaleX(-1)` /
 * `scaleY(-1)`, accumulating rotation modulo 360, then writing the string back. That
 * belongs in the engine, not here: the adapter would be deciding what a rotation MEANS
 * in the saved package. So `transformImage` names the action and the engine composes the
 * result, which is also why this file has no regex.
 *
 * Every command below is refused today (`getSelectedImage` is a stub returning null), so
 * the buttons and dialogs are present and do nothing rather than being absent.
 */
import { useCallback, useState } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';
import type { ImageLayoutTarget } from '../../../legacy-core-compat';
import type { ImagePositionData } from '../../dialogs/ImagePositionDialog';
import type { ImagePropertiesData } from '../../dialogs/ImagePropertiesDialog';
import type { EndnoteProperties, FootnoteProperties } from '../../../legacy-core-compat';

export function useImageActions({ editorRef }: { editorRef: React.RefObject<Editor | null> }) {
  const [imagePositionOpen, setImagePositionOpen] = useState(false);
  const [imagePropsOpen, setImagePropsOpen] = useState(false);
  const [footnotePropsOpen, setFootnotePropsOpen] = useState(false);

  const handleImageWrapType = useCallback(
    (value: string) => {
      editorRef.current?.exec({
        type: 'setImageWrapType',
        target: value as ImageLayoutTarget,
      });
    },
    [editorRef]
  );

  const handleImageTransform = useCallback(
    (action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV') => {
      editorRef.current?.exec({ type: 'transformImage', action });
    },
    [editorRef]
  );

  const handleApplyImagePosition = useCallback(
    (data: ImagePositionData) => {
      // The dialog nests each axis as `{ relativeTo, posOffset, align }`; the command
      // takes the offset and the anchor separately. `align` (Word's "Alignment" radio,
      // e.g. centred relative to the page) has no field on the command and is dropped
      // rather than converted into an offset that would be a guess.
      editorRef.current?.exec({
        type: 'setImagePosition',
        ...(data.horizontal?.posOffset !== undefined
          ? { horizontalEmu: data.horizontal.posOffset }
          : {}),
        ...(data.vertical?.posOffset !== undefined ? { verticalEmu: data.vertical.posOffset } : {}),
        ...(data.horizontal?.relativeTo ? { relativeToH: data.horizontal.relativeTo } : {}),
        ...(data.vertical?.relativeTo ? { relativeToV: data.vertical.relativeTo } : {}),
      });
      setImagePositionOpen(false);
    },
    [editorRef]
  );

  const handleOpenImageProperties = useCallback(() => setImagePropsOpen(true), []);

  const handleApplyImageProperties = useCallback(
    (data: ImagePropertiesData) => {
      editorRef.current?.exec({
        type: 'setImageProperties',
        ...(data.width !== undefined ? { widthEmu: data.width } : {}),
        ...(data.height !== undefined ? { heightEmu: data.height } : {}),
        ...(data.alt !== undefined ? { alt: data.alt } : {}),
        ...(data.borderWidth !== undefined ? { borderWidthEmu: data.borderWidth } : {}),
        ...(data.borderColor
          ? { borderColor: { kind: 'hex' as const, value: data.borderColor.replace(/^#/, '') } }
          : {}),
      });
      setImagePropsOpen(false);
    },
    [editorRef]
  );

  const handleApplyFootnoteProperties = useCallback(
    (footnotePr: FootnoteProperties, endnotePr: EndnoteProperties) => {
      // Legacy rebuilt the section record and pushed a whole new document. The command
      // names the two property groups and the engine owns where they live.
      editorRef.current?.exec({
        type: 'setNoteProperties',
        footnote: footnotePr as Record<string, never>,
        endnote: endnotePr as Record<string, never>,
      });
      setFootnotePropsOpen(false);
    },
    [editorRef]
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
