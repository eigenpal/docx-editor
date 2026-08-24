'use client';

import {
  DocxEditor as EditorApi,
  type DocxEditorRuntime,
} from '@docx-editor.dev/editor-api/browser';
import { createBrowserAutomationHost, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { AutomationBatchResponse, AutomationHandle } from '@docx-editor.dev/core/automation';
import {
  createDocumentSchema,
  formatListsSchema,
  insertContentControlsSchema,
  insertTableSchema,
  writeHeaderFooterSchema,
} from './tools';

export const WRITER_AUTHOR = 'Writer agent';

export interface ToolResult {
  success: boolean;
  output: string;
}

function ok(value: unknown): ToolResult {
  return { success: true, output: typeof value === 'string' ? value : JSON.stringify(value) };
}

function fail(message: string): ToolResult {
  return { success: false, output: message };
}

function requireExec(result: ReturnType<DocxEditorInstance['exec']>, operation: string): void {
  if (!result.ok) throw new Error(`${operation}: ${result.code}: ${result.reason}`);
}

function handleAt(response: AutomationBatchResponse, index: number): AutomationHandle {
  const result = response.results[index];
  if (result?.status !== 'ok' || result.value.kind !== 'handle') {
    const detail = result?.status === 'error' ? `${result.error.code}: ${result.error.detail}` : '';
    throw new Error(`automation handle ${index} was unavailable${detail ? `: ${detail}` : ''}`);
  }
  return result.value.handle;
}

function handlesAt(response: AutomationBatchResponse, index: number): readonly AutomationHandle[] {
  const result = response.results[index];
  if (result?.status !== 'ok' || result.value.kind !== 'handles') {
    const detail = result?.status === 'error' ? `${result.error.code}: ${result.error.detail}` : '';
    throw new Error(`automation handles ${index} were unavailable${detail ? `: ${detail}` : ''}`);
  }
  return result.value.handles;
}

export function createWriterRuntime(editor: DocxEditorInstance): DocxEditorRuntime {
  return EditorApi.createBrowser(editor, {
    author: WRITER_AUTHOR,
    revisionTextView: 'vanilla',
  });
}

async function currentParagraphIds(runtime: DocxEditorRuntime): Promise<readonly string[]> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load();
    await context.sync();
    paragraphs.items.forEach((paragraph) => paragraph.load('uniqueLocalId'));
    await context.sync();
    return paragraphs.items.map((paragraph) => paragraph.uniqueLocalId);
  });
}

async function readDocument(runtime: DocxEditorRuntime): Promise<ToolResult> {
  const records = await runtime.run(async (context) => {
    const collection = context.document.body.paragraphs;
    collection.load();
    await context.sync();
    collection.items.forEach((paragraph) => paragraph.load(['uniqueLocalId', 'text']));
    await context.sync();
    return collection.items
      .map((paragraph) => ({
        id: paragraph.uniqueLocalId,
        text: paragraph.text,
      }))
      .filter((paragraph) => paragraph.text.length > 0);
  });
  return ok(records.length > 0 ? records : 'The document is empty.');
}

async function createDocument(
  runtime: DocxEditorRuntime,
  editor: DocxEditorInstance,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = createDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      `create_document input is incomplete: ${parsed.error.issues[0]?.message ?? 'invalid'}`
    );
  }
  const { blocks, title } = parsed.data;
  const host = createBrowserAutomationHost(editor);
  const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
  const body = handleAt(host.execute({ operations: [{ op: 'getBody', document }] }), 0);
  const replacement = host.execute({
    operations: [
      {
        op: 'replaceStoryBlocks',
        body,
        paragraphs: blocks.map((block) => block.text),
      },
    ],
  });
  const replacementResult = replacement.results[0];
  if (replacementResult?.status !== 'ok' || replacementResult.value.kind !== 'applied') {
    const detail =
      replacementResult?.status === 'error'
        ? `${replacementResult.error.code}: ${replacementResult.error.detail}`
        : 'operation returned no applied result';
    throw new Error(`replaceStoryBlocks: ${detail}`);
  }

  const paragraphIds = await runtime.run(async (context) => {
    const collection = context.document.body.paragraphs;
    collection.load();
    await context.sync();
    if (collection.items.length !== blocks.length) {
      throw new Error('fresh document returned an unexpected paragraph count');
    }
    collection.items.forEach((paragraph, index) => {
      paragraph.style = blocks[index]!.style;
    });
    await context.sync();
    collection.items.forEach((paragraph) => paragraph.load('uniqueLocalId'));
    await context.sync();
    return collection.items.map((paragraph) => paragraph.uniqueLocalId);
  });

  return ok({
    created: true,
    paragraphCount: blocks.length,
    title,
    paragraphs: blocks.map((block, index) => ({
      index,
      paragraphId: paragraphIds[index],
      text: block.text,
      style: block.style,
    })),
  });
}

function formatLists(editor: DocxEditorInstance, input: Record<string, unknown>): ToolResult {
  const parsed = formatListsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      `format_lists input is incomplete: ${parsed.error.issues[0]?.message ?? 'invalid'}`
    );
  }
  const bulletCount = parsed.data.items.filter((item) => item.kind === 'bullet').length;
  const numberedCount = parsed.data.items.length - bulletCount;
  if (bulletCount < 2 || numberedCount < 2) {
    return fail('format_lists requires at least two bullet items and two numbered items.');
  }
  parsed.data.items.forEach((item) => {
    requireExec(
      editor.exec({ type: 'setSelection', anchor: { paraId: item.paragraphId } }),
      `select list paragraph ${item.paragraphId}`
    );
    requireExec(
      editor.exec({
        type: 'toggleList',
        kind: item.kind === 'bullet' ? 'bullet' : 'ordered',
      }),
      `${item.kind} list`
    );
  });
  return ok({ formatted: parsed.data.items.length, bullets: bulletCount, numbered: numberedCount });
}

async function insertContentControls(
  runtime: DocxEditorRuntime,
  editor: DocxEditorInstance,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = insertContentControlsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      `insert_content_controls input is incomplete: ${parsed.error.issues[0]?.message ?? 'invalid'}`
    );
  }
  const host = createBrowserAutomationHost(editor);
  const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
  const body = handleAt(host.execute({ operations: [{ op: 'getBody', document }] }), 0);
  const paragraphIds = await currentParagraphIds(runtime);
  const paragraphHandles = handlesAt(
    host.execute({ operations: [{ op: 'getParagraphs', body }] }),
    0
  );
  const byId = new Map(paragraphIds.map((id, index) => [id, paragraphHandles[index]!]));
  const response = host.execute({
    operations: parsed.data.fields.map((field) => {
      const paragraph = byId.get(field.paragraphId);
      if (!paragraph) throw new Error(`paragraph ${field.paragraphId} is unavailable`);
      return {
        op: 'insertContentControl' as const,
        span: { paragraph },
        subtype: 'plainText' as const,
        tag: field.tag,
        title: field.title,
      };
    }),
  });
  const refusal = response.results.find((result) => result.status === 'error');
  if (refusal?.status === 'error') {
    throw new Error(
      `content control: ${refusal.error.code}: ${refusal.error.detail ?? 'operation refused'}`
    );
  }
  return ok({
    inserted: parsed.data.fields.length,
    fields: parsed.data.fields.map(({ tag, title }) => ({ tag, title })),
  });
}

async function insertTable(
  runtime: DocxEditorRuntime,
  editor: DocxEditorInstance,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = insertTableSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      `insert_table input is incomplete: ${parsed.error.issues[0]?.message ?? 'invalid'}`
    );
  }
  const before = new Set(await currentParagraphIds(runtime));
  const rows = parsed.data.rows.length;
  const cols = parsed.data.rows[0]!.length;
  requireExec(
    editor.exec({
      type: 'setSelection',
      anchor: { paraId: parsed.data.beforeParagraphId },
    }),
    `select table anchor ${parsed.data.beforeParagraphId}`
  );
  requireExec(editor.exec({ type: 'insertTable', rows, cols }), 'insert table');

  const cellParagraphIds = (await currentParagraphIds(runtime)).filter((id) => !before.has(id));
  const cellTexts = parsed.data.rows.flat();
  if (cellParagraphIds.length !== cellTexts.length) {
    throw new Error(
      `insertTable created ${cellParagraphIds.length} cell paragraphs for ${cellTexts.length} cells`
    );
  }
  cellTexts.forEach((text, index) => {
    requireExec(
      editor.exec({ type: 'setSelection', anchor: { paraId: cellParagraphIds[index]! } }),
      `select table cell ${index + 1}`
    );
    requireExec(editor.exec({ type: 'insertText', text }), `write table cell ${index + 1}`);
  });
  return ok({ inserted: true, rows, columns: cols, cells: cellTexts.length });
}

function writeHeaderFooter(editor: DocxEditorInstance, input: Record<string, unknown>): ToolResult {
  const parsed = writeHeaderFooterSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      `write_header_footer input is incomplete: ${parsed.error.issues[0]?.message ?? 'invalid'}`
    );
  }
  requireExec(editor.exec({ type: 'editHeaderFooter', position: 'header' }), 'open header');
  requireExec(editor.exec({ type: 'insertText', text: parsed.data.header }), 'write header');
  requireExec(editor.exec({ type: 'exitHeaderFooter' }), 'close header');
  requireExec(editor.exec({ type: 'editHeaderFooter', position: 'footer' }), 'open footer');
  requireExec(editor.exec({ type: 'insertText', text: parsed.data.footerPrefix }), 'write footer');
  requireExec(editor.exec({ type: 'insertPageField', field: 'PAGE_X_OF_Y' }), 'insert page field');
  requireExec(editor.exec({ type: 'exitHeaderFooter' }), 'close footer');
  return ok({ header: parsed.data.header, footer: `${parsed.data.footerPrefix}X of Y` });
}

async function selectExactRangeEnd(
  runtime: DocxEditorRuntime,
  paragraphId: string,
  phrase: string
): Promise<void> {
  await runtime.run(async (context) => {
    const hits = context.document.body.search(phrase, {
      matchCase: true,
    });
    hits.load();
    await context.sync();
    const ownerCollections = hits.items.map((hit) => hit.paragraphs);
    ownerCollections.forEach((owners) => owners.load());
    await context.sync();
    const owners = ownerCollections.map((collection) => collection.items[0]);
    owners.forEach((owner) => owner?.load('uniqueLocalId'));
    await context.sync();
    const matches = hits.items.filter((_, index) => owners[index]?.uniqueLocalId === paragraphId);
    if (matches.length === 0) {
      throw new Error(`phrase "${phrase}" was not found in paragraph ${paragraphId}`);
    }
    if (matches.length > 1) {
      throw new Error(`phrase "${phrase}" is ambiguous in paragraph ${paragraphId}`);
    }
    matches[0]!.select('End');
    await context.sync();
  });
}

async function proposeInsertion(
  runtime: DocxEditorRuntime,
  editor: DocxEditorInstance,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const paragraphId = String(input.paragraphId ?? '');
  const after = String(input.after ?? '');
  const text = String(input.text ?? '');
  if (!paragraphId || !after || !text) return fail('paragraphId, after, and text are required.');
  await selectExactRangeEnd(runtime, paragraphId, after);
  requireExec(
    editor.exec({ type: 'proposeInsertion', text, author: WRITER_AUTHOR }),
    'proposeInsertion'
  );
  return ok(`Suggested insertion after "${after}".`);
}

function proposeReplacement(
  editor: DocxEditorInstance,
  input: Record<string, unknown>
): ToolResult {
  const paragraphId = String(input.paragraphId ?? '');
  const search = String(input.search ?? '');
  const replaceWith = String(input.replaceWith ?? '');
  if (!paragraphId || !search) return fail('paragraphId and search are required.');
  requireExec(
    editor.exec({
      type: 'proposeReplacement',
      target: { paraId: paragraphId, search },
      replaceWith,
      author: WRITER_AUTHOR,
    }),
    'proposeReplacement'
  );
  return ok(`Suggested replacement for "${search}".`);
}

function proposeDeletion(editor: DocxEditorInstance, input: Record<string, unknown>): ToolResult {
  const paragraphId = String(input.paragraphId ?? '');
  const search = String(input.search ?? '');
  if (!paragraphId || !search) return fail('paragraphId and search are required.');
  requireExec(
    editor.exec({
      type: 'proposeDeletion',
      target: { paraId: paragraphId, search },
      author: WRITER_AUTHOR,
    }),
    'proposeDeletion'
  );
  return ok(`Suggested deletion of "${search}".`);
}

export async function runWriterTool(
  runtime: DocxEditorRuntime,
  editor: DocxEditorInstance,
  name: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'read_document':
        return readDocument(runtime);
      case 'create_document':
        return createDocument(runtime, editor, input);
      case 'format_lists':
        return formatLists(editor, input);
      case 'insert_table':
        return insertTable(runtime, editor, input);
      case 'insert_content_controls':
        return insertContentControls(runtime, editor, input);
      case 'write_header_footer':
        return writeHeaderFooter(editor, input);
      case 'propose_replacement':
        return proposeReplacement(editor, input);
      case 'propose_insertion':
        return proposeInsertion(runtime, editor, input);
      case 'propose_deletion':
        return proposeDeletion(editor, input);
      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
