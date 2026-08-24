'use client';

import {
  DocxEditor as EditorApi,
  type DocxEditorRuntime,
} from '@docx-editor.dev/editor-api/browser';
import { createBrowserAutomationHost, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { AutomationBatchResponse, AutomationHandle } from '@docx-editor.dev/core/automation';
import { createDocumentSchema } from './tools';

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
  return EditorApi.createBrowser(editor, { author: WRITER_AUTHOR });
}

async function readDocument(runtime: DocxEditorRuntime): Promise<ToolResult> {
  const records = await runtime.run(async (context) => {
    const collection = context.document.body.paragraphs;
    collection.load();
    await context.sync();
    const reads = collection.items.map((paragraph) => {
      paragraph.load('uniqueLocalId');
      return paragraph.getText({ projection: 'vanilla' });
    });
    await context.sync();
    return collection.items
      .map((paragraph, index) => ({
        id: paragraph.uniqueLocalId,
        text: reads[index]!.value,
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
  const paragraphIds = await runtime.run(async (context) => {
    context.document.body.replaceParagraphs(blocks.map((block) => block.text));
    await context.sync();

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

  blocks.forEach((block, index) => {
    if (block.list === 'none') return;
    requireExec(
      editor.exec({
        type: 'setSelection',
        anchor: { paraId: paragraphIds[index]! },
      }),
      `select paragraph ${index + 1}`
    );
    requireExec(
      editor.exec({
        type: 'toggleList',
        kind: block.list === 'bullet' ? 'bullet' : 'ordered',
      }),
      `${block.list} list`
    );
  });

  const controls = blocks
    .map((block, index) => (block.contentControl ? index : -1))
    .filter((index) => index >= 0);
  if (controls.length > 0) {
    const host = createBrowserAutomationHost(editor);
    const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
    const body = handleAt(host.execute({ operations: [{ op: 'getBody', document }] }), 0);
    const paragraphs = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0);
    const response = host.execute({
      operations: controls.map((index) => ({
        op: 'insertContentControl' as const,
        span: { paragraph: paragraphs[index]! },
        subtype: 'plainText' as const,
        tag: `writer-field-${index + 1}`,
        title: `Writer field ${index + 1}`,
      })),
    });
    const refusal = response.results.find((result) => result.status === 'error');
    if (refusal?.status === 'error') {
      throw new Error(
        `content control: ${refusal.error.code}: ${refusal.error.detail ?? 'operation refused'}`
      );
    }
  }

  requireExec(editor.exec({ type: 'editHeaderFooter', position: 'header' }), 'open header');
  requireExec(editor.exec({ type: 'insertText', text: title }), 'write header');
  requireExec(editor.exec({ type: 'exitHeaderFooter' }), 'close header');
  requireExec(editor.exec({ type: 'editHeaderFooter', position: 'footer' }), 'open footer');
  requireExec(editor.exec({ type: 'insertText', text: 'Page ' }), 'write footer');
  requireExec(editor.exec({ type: 'insertPageField', field: 'PAGE_X_OF_Y' }), 'insert page field');
  requireExec(editor.exec({ type: 'exitHeaderFooter' }), 'close footer');

  return ok({
    created: true,
    paragraphCount: blocks.length,
    title,
    capabilities: {
      headings: 'editor-api',
      normalParagraphs: 'editor-api',
      bulletsAndNumbering: 'browser editor commands',
      contentControls: 'core automation protocol',
      headerFooterAndPageFields: 'browser editor commands',
      sectionColumns: 'unsupported: no current editor-api or browser editor command',
    },
  });
}

async function selectExactRangeEnd(
  runtime: DocxEditorRuntime,
  paragraphId: string,
  phrase: string
): Promise<void> {
  await runtime.run(async (context) => {
    const hits = context.document.body.search(phrase, {
      matchCase: true,
      projection: 'vanilla',
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
