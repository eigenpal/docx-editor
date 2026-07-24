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
import { type DisplayPage } from '../geometry';
import {
  type InteractionFrame,
  type InteractionFrameId,
  type SelectionGeometryOptions,
  type SemanticHitTarget,
  type SemanticTarget,
} from '../interaction';
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
declare const target: SemanticTarget;
declare const frame: InteractionFrame;
const frameId: InteractionFrameId = frame.id;
const pages: readonly DisplayPage[] = [];
void target;
void frameId;
declare const extension: Extension;
declare const tool: McpToolDefinition;
declare const pluginContext: PluginContext;
const rendered: RenderedPage | null = pluginContext.getRenderedPage(1);
const handlerResult: Promise<unknown> = tool.handler({}, {} as McpContext);
void pages;
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

  // Geometry queries are typed and never expose an editing engine's positions.
  const frame: InteractionFrame = editor.getInteractionFrame();
  const firstPage: number | undefined = frame.display[0]?.index;
  const scrollGap: number = editor.getScrollGeometry().pageGapPx;
  const rectCount: number = editor.getSelectionRects().length;
  const caretX: number | undefined = editor.getCaretRect()?.x;
  const hit: SemanticHitTarget | null = editor.hitTest({ x: 10, y: 20 });
  const hitFrame: InteractionFrameId | undefined = hit?.frameId;
  const pointer = editor.resolvePointer({ x: 10, y: 20 });
  const viewportOptions: SelectionGeometryOptions = { visiblePageIndices: [0] };
  const filteredRects: number = editor.getSelectionRects(undefined, viewportOptions).length;
  const filteredGeometry = editor.getSelectionGeometry(undefined, viewportOptions);
  if (!pointer.ok) {
    const code: string = pointer.code;
    void code;
  }
  void firstPage;
  void scrollGap;
  void rectCount;
  void caretX;
  void hitFrame;
  void filteredRects;
  void filteredGeometry;

  const focus = editor.focus();
  if (focus.ok) {
    void focus.value;
  } else {
    const focusCode: string = focus.code;
    void focusCode;
  }

  const dispatch = editor.dispatchInteraction({ kind: 'focus', frameId: frame.id });
  void dispatch.hostEffects.length;
  if (!dispatch.outcome.ok) {
    const dispatchCode: string = dispatch.outcome.code;
    void dispatchCode;
  }

  const a11y = editor.getAccessibilityObservation();
  void a11y.owner;
  void a11y.entries.length;

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
