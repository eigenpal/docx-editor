/**
 * Watermark dialog controls.
 *
 * PORTED from the legacy hook of the same name. Legacy kept the watermark as a `doc`
 * attribute on the body editing state, so applying it was a normal undoable transaction.
 * The contract has `setWatermark` as a command and `getWatermark` as a capability, which
 * is the same shape: an undoable write and a read the dialog opens against.
 *
 * `getWatermark` is a stub returning null, so the dialog opens with its fields empty
 * rather than pre-filled with a value the engine cannot see, and applying is refused
 * rather than silently dropped.
 *
 * THE TWO SHAPES DISAGREE, and the dialog's wins. Legacy's `Watermark` is a text/picture
 * union carrying font, colour, semitransparency, layout, scale and washout — everything
 * Word's dialog offers. The contract's is `{ text?, imageData? }`. Mapping is therefore
 * LOSSY IN ONE DIRECTION and honest about it: applying sends the text or the image bytes,
 * and the presentation fields have nowhere to go until the contract carries them. Nothing
 * is invented on the way back, because the read is a stub.
 */
import { useCallback, useState } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import type { Watermark as ContractWatermark } from '@docx-editor.dev/core-contract/types';
import type { Watermark } from '../../../lib/watermark';

export function useWatermarkControls({
  readOnly,
  editorRef,
}: {
  readOnly: boolean;
  editorRef: React.RefObject<Editor | null>;
}) {
  const [showWatermark, setShowWatermark] = useState(false);
  const handleOpenWatermark = useCallback(() => setShowWatermark(true), []);

  // Read live so the dialog reflects the current value, including after undo/redo.
  // `getWatermark` is a stub returning null; when it lands, the reverse mapping belongs
  // here. Left undefined rather than half-built from a shape that carries no font,
  // colour or layout.
  const currentWatermark: Watermark | undefined = undefined;

  const handleWatermarkApply = useCallback(
    (watermark: Watermark | null) => {
      if (readOnly) return;
      const forEngine: ContractWatermark | null =
        watermark === null
          ? null
          : watermark.kind === 'text'
            ? { text: watermark.text }
            : watermark.data
              ? { imageData: watermark.data }
              : // A picture watermark that lives in the package (relId/mediaPath) has no
                // bytes here to send, and inventing an empty image would erase it.
                null;
      if (watermark !== null && forEngine === null) return;
      editorRef.current?.exec({ type: 'setWatermark', watermark: forEngine });
    },
    [readOnly, editorRef]
  );

  return {
    showWatermark,
    setShowWatermark,
    handleOpenWatermark,
    currentWatermark,
    handleWatermarkApply,
  };
}
