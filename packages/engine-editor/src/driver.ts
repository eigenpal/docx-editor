// The stable, engine- and framework-neutral EditorDriver (comprehensive 4.7). A thin automation
// surface over the production `Editor`, so the SAME browser smoke scenarios can drive the React and
// Vue adapters identically (each adapter exposes one of these on window). It covers load,
// editability, command, query, selection, display snapshot, save, reopen, and dispose — reading the
// engine's positioned display, never a framework's DOM or ProseMirror.

import type { Editor, DocumentSource, EditorCommand, EditorQueries, EditorQueryResults } from '@docx-editor.dev/core-contract/editor';
import type { DisplayPage, DocRange } from '@docx-editor.dev/core-contract/geometry';
import type { ExecResult } from '@docx-editor.dev/core-contract/types';
import { createEditor } from './create-editor.ts';

/** The text a display page shows, in reading order. Layout emits one item per run-part (a maximal
 *  non-space chunk of a run), consuming inter-word spaces, so text is reconstructed from item BOX
 *  geometry: contiguous items on a line (no horizontal gap) are one word and join tightly (a
 *  bold "Hel" + italic "lo" -> "Hello"), a horizontal gap is a consumed space, and a new line is a
 *  newline. This is an approximation of visible text (it cannot recover exact whitespace runs or
 *  empty paragraphs) — fine for the smoke driver's "contains" assertions, not faithful extraction. */
export function pageText(page: DisplayPage): string {
  let out = '';
  let prev: { x: number; y: number; right: number } | null = null;
  for (const item of page.items) {
    if (item.kind !== 'text') continue;
    const b = item.box;
    if (prev) {
      if (Math.abs(b.y - prev.y) >= 1) out += '\n'; // wrapped / next line
      else if (b.x - prev.right > 1) out += ' '; // a consumed inter-word space
      // else: contiguous run-parts of one word — no separator
    }
    out += item.runs.map((r) => r.text).join('');
    prev = { x: b.x, y: b.y, right: b.x + b.width };
  }
  return out;
}

/** The whole display's approximate text: each page's text, pages joined by newlines. */
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
