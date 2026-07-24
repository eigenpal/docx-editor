// The stable, engine- and framework-neutral EditorDriver (comprehensive 4.7). A thin automation
// surface over the production `Editor`, so the SAME browser smoke scenarios can drive the React and
// Vue adapters identically (each adapter exposes one of these on window). It covers load,
// editability, command, query, selection, display snapshot, save, reopen, and dispose — reading the
// engine's positioned display, never a framework's DOM or ProseMirror.

import type { Editor, DocumentSource, EditorCommand, EditorQueries, EditorQueryResults } from '@docx-editor.dev/core-contract/editor';
import type { DisplayPage, DocRange } from '@docx-editor.dev/core-contract/geometry';
import type { ExecResult } from '@docx-editor.dev/core-contract/types';
import { createEditor } from './create-editor.ts';

/** The text a display page shows, in reading order (its text items' runs joined). */
export function pageText(page: DisplayPage): string {
  let out = '';
  for (const item of page.items) {
    if (item.kind === 'text') out += item.runs.map((r) => r.text).join('');
  }
  return out;
}

/** The whole display's text: each page's text, pages joined by newlines. */
export function displayText(pages: readonly DisplayPage[]): string {
  return pages.map(pageText).join('\n');
}

export interface DisplaySnapshot {
  readonly pageCount: number;
  /** The visible text across all pages (display/reading order). */
  readonly text: string;
}

/** The engine-neutral automation surface both adapters expose for browser smoke tests. */
export interface EditorDriver {
  load(source: DocumentSource): void;
  /** Whether the loaded document is being edited (patchable + edit mode). */
  editable(): boolean;
  exec(command: EditorCommand): ExecResult;
  query<K extends keyof EditorQueries>(query: { type: K } & EditorQueries[K]): EditorQueryResults[K];
  /** The current selection range, or null when collapsed/unavailable. */
  selection(): DocRange | null;
  displaySnapshot(): DisplaySnapshot;
  save(): Promise<ArrayBuffer>;
  /** Prove the round-trip: save to DOCX and reopen headlessly, returning the reopened display text. */
  saveAndReopenText(): Promise<string>;
  dispose(): void;
}

/** A no-op EditorHost for the headless reopen editor (no DOM, no surface — just layout + display). */
function headlessHost() {
  let pages: readonly DisplayPage[] = [];
  return {
    host: {
      getBodyHostEl: () => null,
      getHfHostEl: () => null,
      getPagesContainer: () => null,
      getScrollContainer: () => null,
      scheduleFrame: (cb: () => void) => {
        cb();
        return () => {};
      },
      onDisplay: (next: readonly DisplayPage[]) => {
        pages = next;
      },
    },
    getPages: () => pages,
  };
}

/** Wrap a production `Editor` in the stable driver. */
export function createEditorDriver(editor: Editor): EditorDriver {
  return {
    load: (source) => editor.load(source),
    editable: () => editor.snapshot().editable,
    exec: (command) => editor.exec(command),
    query: (query) => editor.query(query),
    selection: () => editor.snapshot().selection,
    displaySnapshot: () => {
      const pages = editor.getDisplay();
      return { pageCount: pages.length, text: displayText(pages) };
    },
    save: () => editor.save(),
    async saveAndReopenText(): Promise<string> {
      const bytes = await editor.save();
      const { host, getPages } = headlessHost();
      const reopened = createEditor({ host, document: bytes });
      try {
        return displayText(getPages());
      } finally {
        reopened.destroy();
      }
    },
    dispose: () => editor.destroy(),
  };
}
