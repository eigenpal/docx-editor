import {
  isDocxEditorError,
  type DocxEditorRuntime,
  type DocxEditorServerRuntime,
} from '@docx-editor.dev/editor-api';
import { DocxEditor as EditorApi } from '@docx-editor.dev/editor-api/browser';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { ZodError } from 'zod';
import { WRITER_TOOLS } from './tools';
import {
  bodyStory,
  invalidate,
  forgetTransientTargets,
  sameBytes,
  stateFor,
  WriterError,
} from './document-access';
import { story as storySchema } from './editing-schemas';
import { inspectDocument } from './inspect-document';
import { editDocument } from './edit-document';
import { createOrInsert } from './create-document';
import { EDITING_COVERAGE } from './coverage';
import { toolRecovery, type ToolRecovery } from './tool-recovery';

export const WRITER_AUTHOR = 'Writer agent';
export interface ToolResult {
  success: boolean;
  output: string;
  code?: string;
  target?: string;
  completedSteps?: readonly string[];
  recovery?: ToolRecovery;
}
export function createWriterRuntime(editor: DocxEditorInstance): DocxEditorRuntime {
  const runtime = EditorApi.createBrowser(editor, {
    author: WRITER_AUTHOR,
    revisionTextView: 'original',
  });
  // Replacement can restart a package revision. Include the public replacement event.
  let generation = 0;
  const unsubscribe = editor.on('change', (change) => {
    if (change.source) generation++;
  });
  versions.set(runtime, () => `${generation}:${editor.getDocumentHandle().revision}`);
  const dispose = runtime.dispose.bind(runtime);
  runtime.dispose = () => {
    unsubscribe();
    versions.delete(runtime);
    dispose();
  };
  return runtime;
}
const versions = new WeakMap<DocxEditorRuntime, () => string>();
const queues = new WeakMap<DocxEditorRuntime, Promise<unknown>>();
const wrappers = new Set([
  'write_story',
  'create_document',
  'format_lists',
  'insert_content_controls',
  'insert_table',
  'write_header_footer',
]);
export type WriterMode = 'direct' | 'suggest';
const calls = new WeakMap<
  DocxEditorRuntime,
  Map<string, { input: string; result: Promise<ToolResult> }>
>();

/** Serialize model calls. All mutation paths use the public document API. */
export async function runWriterTool(
  runtime: DocxEditorRuntime,
  editor: DocxEditorInstance | null,
  name: string,
  input: Record<string, unknown>,
  mode?: WriterMode,
  callId?: string,
  options?: { appendDraft?: boolean; draftPreviousList?: boolean; signal?: AbortSignal }
): Promise<ToolResult> {
  const known = calls.get(runtime) ?? new Map();
  const key = JSON.stringify({ name, input, mode, options });
  if (callId && known.has(callId)) {
    const previous = known.get(callId)!;
    return previous.input === key
      ? previous.result
      : {
          success: false,
          code: 'InvalidArgument',
          output: 'A tool call ID cannot identify two different edits.',
        };
  }
  const pending = queues.get(runtime) ?? Promise.resolve();
  const task = pending
    .catch(() => {})
    .then(() =>
      execute(
        runtime,
        name,
        input,
        mode,
        async () =>
          editor
            ? new Uint8Array(await editor.save())
            : (runtime as DocxEditorServerRuntime).save(),
        options?.appendDraft,
        options?.draftPreviousList,
        editor ? versions.get(runtime) : undefined,
        options?.signal
      )
    );
  queues.set(runtime, task);
  if (callId) {
    known.set(callId, { input: key, result: task });
    calls.set(runtime, known);
  }
  return task;
}
async function execute(
  runtime: DocxEditorRuntime,
  name: string,
  input: Record<string, unknown>,
  mode: WriterMode | undefined,
  save: () => Promise<Uint8Array>,
  appendDraft = false,
  draftPreviousList = false,
  revision?: () => string,
  signal?: AbortSignal
): Promise<ToolResult> {
  const state = stateFor(runtime);
  state.completed = [];
  try {
    const assertActive = () => {
      if (signal?.aborted)
        throw new WriterError('Cancelled', 'Generation stopped. Earlier edits remain committed.');
    };
    assertActive();
    if (!Object.hasOwn(WRITER_TOOLS, name))
      throw new WriterError('InvalidArgument', `Unknown tool: ${name}`);
    if (name === 'discover_capabilities')
      return {
        success: true,
        output: JSON.stringify({
          tools: EDITING_COVERAGE,
          mode: mode ?? 'runtime',
          hosts: runtime.capabilities,
          controls: {
            create: ['PlainText', 'RichText', 'DatePicker'],
            unsupportedCreation: ['DropDownList', 'ComboBox', 'CheckBox'],
          },
          tracking:
            'Text, paragraph insertion, fonts, paragraph formatting, styles, and list membership can be tracked. New list definitions can be configured while their membership is proposed. Complete table insertion, table value replacement, row additions, and partial row deletions support native revisions. An author can configure a complete proposed table while it has no foreign revisions. Existing table properties and columns require direct edits. Tracked table value replacement and ranges across paragraphs refuse in collaboration. Existing list-definition changes, page layout, and control structure require direct edits.',
          limits: [
            'Read before editing. Re-read object indexes after edits.',
            'No HTML or Markdown interpretation.',
            'Merged tables and protected or bound controls can refuse.',
            'Text insertion supports text-like controls. Date and other typed controls require their native value UI.',
            'PAGE/NUMPAGES calculation requires host pagination.',
            'Section columns and new style definitions are unsupported.',
            'Only PAGE and NUMPAGES field creation is supported. TOC creation and evaluation are unsupported.',
            'One write batch targets one story. Separate body, header, and footer edits.',
          ],
        }),
      };
    const read = name === 'read_document' || name === 'inspect_document';
    const capturedRevision = revision?.();
    const before = await save();
    if (revision && revision() !== capturedRevision)
      throw new WriterError('StaleDocument', 'The document changed during capture. Read again.');
    if (
      revision
        ? state.browserVersion !== undefined && state.browserVersion !== capturedRevision
        : state.bytes && !sameBytes(state.bytes, before)
    ) {
      invalidate(state);
      if (!read)
        throw new WriterError(
          'StaleDocument',
          'The document changed outside this agent. Read again and reconsider the edit.'
        );
    }
    if (revision) state.browserVersion = capturedRevision;
    else state.bytes = before;
    if (!read) {
      // Later target loads can advance the context's read revision. Check the
      // application's inspection baseline before publishing each write.
      let baselineRevision = capturedRevision;
      state.beforeCommit = async () => {
        assertActive();
        const unchanged = revision
          ? revision() === baselineRevision
          : state.bytes && sameBytes(state.bytes, await save());
        assertActive();
        if (!unchanged)
          throw new WriterError(
            'StaleDocument',
            'The document changed during editing. Read again and reconsider the remaining edits.'
          );
      };
      state.afterCommit = async () => {
        if (revision) state.browserVersion = baselineRevision = revision();
        else state.bytes = await save();
      };
    }
    let result: unknown;
    if (read) {
      const snapshot = await inspectDocument(
        runtime,
        name === 'read_document' ? { ...input, area: 'paragraphs', story: bodyStory } : input
      );
      result = snapshot;
    } else {
      // Mode belongs to the application. The model cannot turn tracking off after a refusal.
      if (mode)
        await runtime.run(async (context) => {
          context.document.changeTrackingMode = mode === 'suggest' ? 'TrackMineOnly' : 'Off';
          await context.sync();
        });
      if (wrappers.has(name))
        result = await createOrInsert(runtime, name, input, appendDraft, draftPreviousList);
      else result = await editDocument(runtime, name, input);
      const editedStory =
        name === 'edit_text' || name === 'format_document'
          ? storySchema.parse(input.story)
          : undefined;
      // A header-only edit cannot move footer or main-body paragraph targets.
      // Clear all headers together because sections can share linked content.
      forgetTransientTargets(state, editedStory?.kind === 'body' ? undefined : editedStory?.kind);
      state.inspected.clear();
    }
    // The browser's public version replaces a second ZIP serialization. Capture at
    // entry still commits pending form input and validates its value before editing.
    const after = revision ? undefined : await save();
    if (read && (revision ? revision() !== capturedRevision : !sameBytes(before, after!))) {
      invalidate(state);
      throw new WriterError('StaleDocument', 'The document changed during inspection. Read again.');
    }
    if (!read) await state.beforeCommit?.();
    if (revision) state.browserVersion = revision();
    else state.bytes = after;
    const output = JSON.stringify(result);
    if (output.length > 128000)
      throw new WriterError(
        'ResultTooLarge',
        'The result exceeds 128 KB. Inspect fewer items or a smaller document.'
      );
    return { success: true, output, completedSteps: [...state.completed] };
  } catch (error) {
    // Earlier syncs can have committed. Do not advertise rollback or blindly replay the tool.
    const code = isDocxEditorError(error)
      ? error.code
      : error instanceof WriterError
        ? error.code
        : error instanceof ZodError
          ? 'InvalidArgument'
          : 'OperationFailed';
    const target = isDocxEditorError(error) ? error.target : undefined;
    invalidate(state);
    // Keep the baseline after a refusal. Only a fresh inspection can acknowledge
    // an external edit; repeating a whole-story replacement must still refuse.
    return {
      success: false,
      code,
      target,
      output: error instanceof Error ? error.message : String(error),
      recovery: toolRecovery(code, state.completed.length > 0),
      completedSteps: [...state.completed],
    };
  } finally {
    state.beforeCommit = undefined;
    state.afterCommit = undefined;
  }
}
