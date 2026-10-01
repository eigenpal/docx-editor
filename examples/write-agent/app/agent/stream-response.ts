import { TransformStream as ServerTransformStream } from 'node:stream/web';
import type { UIMessageChunk } from 'ai';
import { STREAM_ARRAYS, WriterInputStream, type StreamTool, type WriterPart } from './stream-input';

/** Add transient application events beside the SDK's normal tool stream. */
export function streamWriterParts() {
  // Node and DOM declarations differ for BYOB readers; the Web Streams runtime is shared.
  const WebTransformStream = ServerTransformStream as unknown as typeof TransformStream;
  const streams = new Map<string, { name: StreamTool; parser: WriterInputStream; index: number }>();
  return new WebTransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      if (chunk.type === 'tool-input-start' && Object.hasOwn(STREAM_ARRAYS, chunk.toolName)) {
        const name = chunk.toolName as StreamTool;
        streams.set(chunk.toolCallId, { name, parser: new WriterInputStream(name), index: 0 });
      } else if (chunk.type === 'tool-input-delta') {
        const stream = streams.get(chunk.toolCallId);
        if (!stream) return;
        for (const input of stream.parser.push(chunk.inputTextDelta)) {
          const data: WriterPart = {
            toolCallId: chunk.toolCallId,
            toolName: stream.name,
            index: stream.index++,
            input,
          };
          controller.enqueue({ type: 'data-writer-part', data, transient: true });
        }
      } else if (chunk.type === 'tool-input-available' || chunk.type === 'tool-input-error')
        streams.delete(chunk.toolCallId);
    },
  });
}
