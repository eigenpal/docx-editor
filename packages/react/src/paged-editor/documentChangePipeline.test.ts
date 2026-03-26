import { describe, it, expect } from 'bun:test';
import { schema } from '@eigenpal/docx-core/prosemirror/schema';
import { createDocumentChangePipeline } from './documentChangePipeline';
import type { Document } from '@eigenpal/docx-core/types/document';

function buildPmDocJson(text: string) {
  return schema.node('doc', null, [schema.node('paragraph', null, schema.text(text))]).toJSON();
}

function extractText(document: Document): string {
  const blocks = document.package.document.content ?? [];
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type !== 'paragraph') continue;
    for (const paraPart of block.content ?? []) {
      if (paraPart.type !== 'run') continue;
      for (const runPart of paraPart.content ?? []) {
        if (runPart.type === 'text') {
          parts.push(runPart.text ?? '');
        }
      }
    }
  }
  return parts.join('');
}

describe('documentChangePipeline', () => {
  it('debounces and only emits latest change', async () => {
    const baseDoc = { package: { document: { content: [] } } } as Document;
    const emitted: Document[] = [];
    const pipeline = createDocumentChangePipeline({
      baseDocument: baseDoc,
      enabledWorker: false,
      onEmit: (doc) => emitted.push(doc),
    });

    pipeline.enqueue({
      pmDocJson: buildPmDocJson('one'),
      docSize: 10,
      blockCount: 1,
      lastKeyInterval: 50,
      expectedBlockCount: 1,
      dirtyIndices: [0],
    });
    pipeline.enqueue({
      pmDocJson: buildPmDocJson('two'),
      docSize: 10,
      blockCount: 1,
      lastKeyInterval: 50,
      expectedBlockCount: 1,
      dirtyIndices: [0],
    });

    const result = await pipeline.flushForTest();
    expect(result).not.toBeNull();
    if (result) {
      expect(extractText(result)).toBe('two');
    }
    expect(emitted.length).toBe(1);
  });
});
