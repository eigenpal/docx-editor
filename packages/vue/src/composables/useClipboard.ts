/**
 * Vue port of packages/react/src/hooks/useClipboard.ts. Wraps the
 * framework-agnostic clipboard helpers in core. Same surface as the
 * React hook but without the React-specific useRef wrappers.
 */
import { ref } from 'vue';
import {
  copyRuns,
  parseClipboardHtml,
  runsToClipboardContent,
  type ParsedClipboardContent,
} from '@eigenpal/docx-editor-core/utils';
import {
  getSelectionRuns,
  createSelectionFromDOM,
  type ClipboardSelection,
  type Theme,
} from '@eigenpal/docx-editor-core';

export { getSelectionRuns, createSelectionFromDOM, runsToClipboardContent };
export type { ClipboardSelection };

export interface UseClipboardOptions {
  onCopy?: (selection: ClipboardSelection) => void;
  onCut?: (selection: ClipboardSelection) => void;
  onPaste?: (content: ParsedClipboardContent, asPlainText: boolean) => void;
  cleanWordFormatting?: boolean;
  editable?: boolean;
  onError?: (error: Error) => void;
  theme?: Theme | null;
}

export function useClipboard(options: UseClipboardOptions = {}) {
  const {
    onCopy,
    onCut,
    onPaste,
    cleanWordFormatting = true,
    editable = true,
    onError,
    theme,
  } = options;

  const isProcessing = ref(false);
  const lastPastedContent = ref<ParsedClipboardContent | null>(null);

  async function copy(selection: ClipboardSelection): Promise<boolean> {
    if (isProcessing.value) return false;
    isProcessing.value = true;
    try {
      const ok = await copyRuns(selection.runs, { onError, theme });
      if (ok) onCopy?.(selection);
      return ok;
    } finally {
      isProcessing.value = false;
    }
  }

  async function cut(selection: ClipboardSelection): Promise<boolean> {
    if (isProcessing.value || !editable) return false;
    isProcessing.value = true;
    try {
      const ok = await copyRuns(selection.runs, { onError, theme });
      if (ok) onCut?.(selection);
      return ok;
    } finally {
      isProcessing.value = false;
    }
  }

  async function paste(asPlainText = false): Promise<ParsedClipboardContent | null> {
    if (isProcessing.value || !editable) return null;
    isProcessing.value = true;
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        let html = '';
        let plainText = '';
        for (const item of items) {
          if (item.types.includes('text/html')) {
            html = await (await item.getType('text/html')).text();
          }
          if (item.types.includes('text/plain')) {
            plainText = await (await item.getType('text/plain')).text();
          }
        }
        if (asPlainText) html = '';
        const content = parseClipboardHtml(html, plainText, cleanWordFormatting);
        lastPastedContent.value = content;
        onPaste?.(content, asPlainText);
        return content;
      }
      return null;
    } catch (e) {
      onError?.(e instanceof Error ? e : new Error(String(e)));
      return null;
    } finally {
      isProcessing.value = false;
    }
  }

  return {
    copy,
    cut,
    paste,
    isProcessing,
    lastPastedContent,
  };
}
