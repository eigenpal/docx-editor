import type { ToolResult } from './run-tool';
import { parseWriterInput, STREAM_ARRAYS, type WriterPart, type StreamTool } from './stream-input';

type Execute = (
  name: StreamTool,
  input: Record<string, unknown>,
  callId: string,
  appendDraft: boolean,
  draftPreviousList: boolean,
  signal: AbortSignal
) => Promise<ToolResult>;
interface Pending {
  name: StreamTool;
  inputs: Record<string, unknown>[];
  queue: Promise<void>;
  result?: ToolResult;
  completed: string[];
  stopped: boolean;
  abort: AbortController;
}
const refused = (message: string): ToolResult => ({
  success: false,
  code: 'InvalidArgument',
  output: message,
});

/** Keep each call's applied prefix and final result. A final tool call never repeats that prefix. */
export class WriterStreamEdits {
  private readonly calls = new Map<string, Pending>();

  constructor(
    private readonly execute: Execute,
    private readonly progress: (callId: string, count: number) => void = () => {}
  ) {}

  push(part: WriterPart) {
    let call = this.calls.get(part.toolCallId);
    if (!call) {
      call = {
        name: part.toolName,
        inputs: [],
        queue: Promise.resolve(),
        completed: [],
        stopped: false,
        abort: new AbortController(),
      };
      this.calls.set(part.toolCallId, call);
    }
    const current = call;
    if (current.stopped) return;
    if (
      current.name !== part.toolName ||
      !Number.isSafeInteger(part.index) ||
      part.index < 0 ||
      part.index > current.inputs.length
    ) {
      current.stopped = true;
      current.abort.abort();
      current.result = refused(
        'The streamed edit sequence is incomplete. Read again before continuing.'
      );
      return;
    }
    let input: Record<string, unknown>;
    try {
      input = parseWriterInput(part.toolName, part.input);
    } catch (error) {
      current.stopped = true;
      current.abort.abort();
      current.result = refused(String(error));
      return;
    }
    if (part.index < current.inputs.length) {
      if (JSON.stringify(current.inputs[part.index]) !== JSON.stringify(input)) {
        current.stopped = true;
        current.abort.abort();
        current.result = refused('A streamed edit cannot change an applied part.');
      }
      return;
    }
    current.inputs.push(input);
    current.queue = current.queue.then(async () => {
      if (current.stopped) return;
      try {
        const result = await this.execute(
          part.toolName,
          input,
          `${part.toolCallId}:part:${part.index}`,
          part.toolName === 'create_document' && part.index > 0,
          part.toolName === 'create_document' &&
            part.index > 0 &&
            (current.inputs[part.index - 1]?.blocks as { kind: string }[])[0]?.kind === 'list',
          current.abort.signal
        );
        current.completed.push(...(result.completedSteps ?? []));
        if (current.stopped) return;
        current.result = result;
        if (!result.success) current.stopped = true;
        else this.progress(part.toolCallId, part.index + 1);
      } catch (error) {
        current.stopped = true;
        current.result = { success: false, code: 'OperationFailed', output: String(error) };
      }
    });
  }

  async finish(callId: string, name: string, input: unknown): Promise<ToolResult | undefined> {
    const call = this.calls.get(callId);
    if (!call) return undefined;
    await call.queue;
    if (call.stopped) return { ...call.result!, completedSteps: call.completed };
    try {
      if (name !== call.name) return refused('The streamed tool name changed.');
      const final = parseWriterInput(call.name, input);
      const array = STREAM_ARRAYS[call.name];
      const items = final[array] as unknown[];
      if (items.length !== call.inputs.length)
        return {
          ...refused('Some streamed parts are missing. Earlier edits remain committed.'),
          completedSteps: call.completed,
        };
      for (let i = 0; i < items.length; i++) {
        const expected = parseWriterInput(call.name, { ...final, [array]: [items[i]] });
        if (JSON.stringify(expected) !== JSON.stringify(call.inputs[i]))
          return {
            ...refused('Final input differs from an applied part. Earlier edits remain committed.'),
            completedSteps: call.completed,
          };
      }
      const result = call.result!;
      const output = JSON.parse(result.output);
      if (call.name === 'edit_text') output.edited = items.length;
      if (call.name === 'insert_content_controls') output.inserted = items.length;
      return { ...result, output: JSON.stringify(output), completedSteps: call.completed };
    } catch (error) {
      return { ...refused(String(error)), completedSteps: call.completed };
    }
  }

  stop() {
    for (const call of this.calls.values()) {
      call.stopped = true;
      call.abort.abort();
      call.result = {
        success: false,
        code: 'Cancelled',
        output: 'Generation stopped. Earlier edits remain committed.',
      };
    }
  }
}
