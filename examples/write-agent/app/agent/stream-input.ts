import type { z } from 'zod';
import { WRITER_TOOLS } from './tools';

export const STREAM_ARRAYS = {
  create_document: 'blocks',
  edit_text: 'edits',
  insert_content_controls: 'fields',
} as const;
export type StreamTool = keyof typeof STREAM_ARRAYS;
export interface WriterPart {
  toolCallId: string;
  toolName: StreamTool;
  index: number;
  input: Record<string, unknown>;
}

export function parseWriterInput(name: StreamTool, input: unknown) {
  return (WRITER_TOOLS[name].inputSchema as z.ZodType<Record<string, unknown>>).parse(input);
}

/** Read complete array objects only. Never repair unfinished JSON into a document edit. */
export class WriterInputStream {
  private text = '';
  private offset = 0;
  private depth = 0;
  private stringStart = -1;
  private escaped = false;
  private lastString = '';
  private array = false;
  private itemStart = -1;
  private metadata: Record<string, unknown> = {};
  private count = 0;
  private ended = false;

  constructor(private readonly name: StreamTool) {}

  push(delta: string): Record<string, unknown>[] {
    if (this.ended) return [];
    if (this.text.length + delta.length > 1_048_576) {
      this.ended = true;
      return [];
    }
    this.text += delta;
    const inputs: Record<string, unknown>[] = [];
    try {
      for (; this.offset < this.text.length; this.offset++) {
        const char = this.text[this.offset]!;
        if (this.stringStart >= 0) {
          if (this.escaped) this.escaped = false;
          else if (char === '\\') this.escaped = true;
          else if (char === '"') {
            if (this.depth === 1)
              this.lastString = JSON.parse(this.text.slice(this.stringStart, this.offset + 1));
            this.stringStart = -1;
          }
          continue;
        }
        if (char === '"') this.stringStart = this.offset;
        else if (char === '{' || char === '[') {
          if (char === '[' && this.depth === 1 && this.lastString === STREAM_ARRAYS[this.name]) {
            // Required metadata must precede the array. Otherwise execute the final input normally.
            this.metadata = JSON.parse(`${this.text.slice(0, this.offset)}[]}`);
            this.array = true;
          } else if (char === '{' && this.array && this.depth === 2) this.itemStart = this.offset;
          this.depth++;
        } else if (char === '}' || char === ']') {
          if (char === '}' && this.array && this.depth === 3 && this.itemStart >= 0) {
            const item = JSON.parse(this.text.slice(this.itemStart, this.offset + 1));
            const input = parseWriterInput(this.name, {
              ...this.metadata,
              [STREAM_ARRAYS[this.name]]: [item],
            });
            if (++this.count > (this.name === 'edit_text' ? 40 : 200)) {
              this.ended = true;
              break;
            }
            inputs.push(input);
            this.itemStart = -1;
          }
          if (char === ']' && this.array && this.depth === 2) {
            this.ended = true;
            break;
          }
          this.depth--;
        }
      }
    } catch {
      // Earlier valid items stay committed. The complete tool input still receives validation.
      this.ended = true;
    }
    return inputs;
  }
}
