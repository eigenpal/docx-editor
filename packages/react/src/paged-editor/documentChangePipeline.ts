import { Node as PMNode } from 'prosemirror-model';
import { schema } from '@eigenpal/docx-core/prosemirror/schema';
import type { Document, Paragraph, Table } from '@eigenpal/docx-core/types/document';
import {
  fromProseDoc,
  buildTrackedChangeCounts,
  convertTopLevelNode,
} from '@eigenpal/docx-core/prosemirror/conversion/fromProseDoc';
import { mergeDocumentBlocks } from '@eigenpal/docx-core/prosemirror/conversion/mergeDocumentBlocks';
import { computeDebounceDelay } from './documentChangeScheduler';
import { createWorkerClient } from './pmDocumentWorkerClient';

export type PipelineInput = {
  pmDocJson: unknown;
  docSize: number;
  blockCount: number;
  lastKeyInterval: number;
  dirtyIndices?: number[];
  expectedBlockCount?: number;
};

export type DocumentChangePipeline = {
  enqueue: (input: PipelineInput) => void;
  flushForTest: () => Promise<Document | null>;
  dispose: () => void;
  setBaseDocument: (doc: Document | null) => void;
};

type PipelineOptions = {
  baseDocument: Document | null;
  enabledWorker: boolean;
  onEmit: (document: Document) => void;
};

function canIncremental(
  baseDocument: Document | null,
  input: PipelineInput
): baseDocument is Document {
  if (!baseDocument) return false;
  if (!Array.isArray(input.dirtyIndices) || input.dirtyIndices.length === 0) return false;
  if (typeof input.expectedBlockCount !== 'number') return false;
  const baseCount = baseDocument.package.document.content?.length ?? 0;
  return baseCount === input.expectedBlockCount;
}

function convertIncremental(
  pmDoc: PMNode,
  baseDocument: Document,
  dirtyIndices: number[],
  expectedBlockCount: number
): Document {
  const counts = buildTrackedChangeCounts(pmDoc);
  const updates = new Map<number, Paragraph | Table>();
  for (const index of dirtyIndices) {
    const node = pmDoc.child(index);
    updates.set(index, convertTopLevelNode(node, counts));
  }
  return mergeDocumentBlocks(baseDocument, updates, expectedBlockCount);
}

function convertOnMainThread(baseDocument: Document | null, input: PipelineInput): Document | null {
  const pmDoc = PMNode.fromJSON(schema, input.pmDocJson);
  if (canIncremental(baseDocument, input)) {
    return convertIncremental(
      pmDoc,
      baseDocument,
      input.dirtyIndices ?? [],
      input.expectedBlockCount ?? 0
    );
  }
  return fromProseDoc(pmDoc, baseDocument ?? undefined);
}

export function createDocumentChangePipeline(options: PipelineOptions): DocumentChangePipeline {
  let baseDocument = options.baseDocument;
  let pendingInput: PipelineInput | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let latestVersion = 0;
  const workerClient = createWorkerClient({ enabled: options.enabledWorker });

  const clearTimers = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  };

  const runConversion = async (): Promise<Document | null> => {
    if (!pendingInput) return null;
    const input = pendingInput;
    pendingInput = null;
    const versionAtStart = latestVersion;

    const mode = canIncremental(baseDocument, input) ? 'incremental' : 'full';
    const workerResult = options.enabledWorker
      ? await workerClient.convert({
          mode,
          pmDocJson: input.pmDocJson,
          baseDocument,
          dirtyIndices: input.dirtyIndices,
          expectedBlockCount: input.expectedBlockCount,
        })
      : null;

    if (versionAtStart !== latestVersion) {
      return null;
    }

    const document = workerResult?.document ?? convertOnMainThread(baseDocument, input);
    if (document) {
      baseDocument = document;
      options.onEmit(document);
    }

    return document;
  };

  const enqueue = (input: PipelineInput) => {
    pendingInput = input;
    latestVersion += 1;
    clearTimers();

    const delay = computeDebounceDelay({
      docSize: input.docSize,
      blockCount: input.blockCount,
      lastKeyInterval: input.lastKeyInterval,
    });

    timer = setTimeout(runConversion, delay);
    maxWaitTimer = setTimeout(runConversion, 1000);
  };

  const flushForTest = async () => {
    clearTimers();
    return await runConversion();
  };

  const dispose = () => {
    clearTimers();
    workerClient.dispose();
    pendingInput = null;
  };

  const setBaseDocument = (doc: Document | null) => {
    baseDocument = doc;
  };

  return { enqueue, flushForTest, dispose, setBaseDocument };
}
