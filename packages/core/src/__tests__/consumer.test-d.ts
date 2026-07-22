/**
 * Consumer-side type test.
 *
 * The package typechecking on its own proves only that the declarations are
 * internally consistent. It does not prove a consumer can construct a command,
 * read a query result, or narrow a result. Every check below is written the way
 * an adapter would write it, and each one caught a real defect when added.
 */

import { parseDocx, queryDoc, applyEdits, type DocEdit } from '../index';
import {
  createEditor,
  type Editor,
  type EditorCommand,
  type EditorHost,
  type EditorSnapshot,
} from '../editor';
import { type DocPoint, type SelectionBox } from '../geometry';
import { type McpContext, type McpToolDefinition } from '../mcp';
import { type Extension, type PluginContext, type RenderedPage } from '../plugin';
import type { DocAnchor, DocxDocument } from '../types';

// A no-arg command must be constructible. `Record<string, never>` made this
// impossible: the `type` discriminant collided with the index signature.
const undoCmd: EditorCommand = { type: 'undo' };
const redoCmd: EditorCommand = { type: 'redo' };
const deleteRowCmd: EditorCommand = { type: 'deleteRow' };

// Commands with arguments.
const boldCmd: EditorCommand = { type: 'toggleMark', mark: 'bold' };
const tableCmd: EditorCommand = { type: 'insertTable', rows: 3, cols: 4 };

// Declaration-only public entries must resolve for a consumer without exposing
// any ProseMirror-facing types.
declare const point: DocPoint;
const pmPos: number = point.pmPos;
const boxes: readonly SelectionBox[] = [];
declare const extension: Extension;
declare const tool: McpToolDefinition;
declare const pluginContext: PluginContext;
const rendered: RenderedPage | null = pluginContext.getRenderedPage(1);
const handlerResult: Promise<unknown> = tool.handler({}, {} as McpContext);
void pmPos;
void boxes;
void extension;
void rendered;
void handlerResult;

// A minimal host. Everything optional is omitted on purpose: a host that
// implements only the required members must still typecheck.
const host: EditorHost = {
  getBodyHostEl: () => null,
  getHfHostEl: () => null,
  getPagesContainer: () => null,
  getScrollContainer: () => null,
  scheduleFrame: (cb) => {
    cb();
    return () => {};
  },
  measureBlocks: () => [],
};

export function exercise(editor: Editor, doc: DocxDocument): void {
  // Writes return a result that narrows.
  const result = editor.exec(boldCmd);
  if (result.ok) {
    const changed: boolean = result.changed;
    void changed;
  } else {
    const code: string = result.code;
    void code;
  }

  // `can` is a dry run and must not report `changed`.
  const dry = editor.can(tableCmd);
  if (dry.ok) {
    // @ts-expect-error a dry run changes nothing, so `changed` must not exist
    void dry.changed;
  }

  // Query results must be typed per query, not `unknown`.
  const text: string = editor.query({ type: 'selectedText' });
  const inToc: boolean = editor.query({ type: 'isInsideToc', pos: 0 });
  const table = editor.query({ type: 'tableContext' });
  const rows: number | undefined = table?.rows;
  void text;
  void inToc;
  void rows;

  // Snapshot payloads must carry real shapes.
  const snap: EditorSnapshot = editor.snapshot();
  const bold: boolean | undefined = snap.formatting?.bold;
  void bold;

  // Document-layer queries are typed the same way.
  const paras = queryDoc(doc, { type: 'paragraphs' });
  const first: string | undefined = paras[0]?.text;
  void first;

  // Batch edits return one result per edit.
  const anchor: DocAnchor = { paraId: 'A1B2C3D4', search: 'hello' };
  const edits: DocEdit[] = [{ type: 'insertText', target: anchor, text: 'x' }];
  const applied = applyEdits(doc, edits);
  const n: number = applied.results.length;
  void n;

  void undoCmd;
  void redoCmd;
  void deleteRowCmd;
}

// Async-declared functions must return a rejected promise, not throw
// synchronously, or a caller's `.catch` never runs.
export async function exerciseAsync(buffer: ArrayBuffer): Promise<void> {
  await parseDocx(buffer).catch(() => undefined);
}

export function build(): Editor {
  return createEditor({ host });
}
