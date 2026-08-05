// Playwright bridge for drawing authoring flows (`?drawingsE2e=1`).
// Mirrors the tree harness pattern: exposes a tiny window API, not a demo surface.

import { useEffect } from 'react';
import { useDocxEditor } from '@docx-editor.dev/react';
import { selectedDrawingOverlayTargetOf } from '@docx-editor.dev/core/editor';

declare global {
  interface Window {
    __docxDrawingsE2e?: {
      selectDrawing(paragraphIndex: number, offset?: number): void;
      overlayTarget(): {
        x: number;
        y: number;
        width: number;
        height: number;
        widthEmu: number;
        heightEmu: number;
      } | null;
      selectedImage(): {
        wrap: string;
        description: string | null;
        widthEmu: number;
        heightEmu: number;
        verticalEmu: number | null;
      } | null;
      paintedDrawingCount(): number;
    };
  }
}

export function DrawingsE2eBridge(): null {
  const editor = useDocxEditor();

  useEffect(() => {
    const enabled = new URLSearchParams(location.search).get('drawingsE2e') === '1';
    if (!enabled || !editor?.surface) {
      delete window.__docxDrawingsE2e;
      return undefined;
    }
    window.__docxDrawingsE2e = {
      selectDrawing(paragraphIndex, offset = 1) {
        const paragraphId = editor.surface!.session.paragraphIds()[paragraphIndex];
        if (!paragraphId) throw new Error(`missing paragraph ${paragraphIndex}`);
        editor.surface!.setSelection({
          anchor: { paragraphId, offset },
          head: { paragraphId, offset },
        });
      },
      overlayTarget() {
        const target = selectedDrawingOverlayTargetOf(editor.surface);
        if (!target) return null;
        return {
          x: target.x,
          y: target.y,
          width: target.width,
          height: target.height,
          widthEmu: target.widthEmu,
          heightEmu: target.heightEmu,
        };
      },
      selectedImage() {
        const image = editor.getSelectedImage();
        if (!image) return null;
        return {
          wrap: image.wrap,
          description: image.description,
          widthEmu: image.widthEmu,
          heightEmu: image.heightEmu,
          verticalEmu: image.position?.verticalEmu ?? null,
        };
      },
      paintedDrawingCount() {
        return document.querySelectorAll('.docx-drawing-ready, .docx-drawing-placeholder').length;
      },
    };
    return () => {
      delete window.__docxDrawingsE2e;
    };
  }, [editor]);

  return null;
}
