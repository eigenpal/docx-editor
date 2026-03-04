import type { Deletion, Insertion, ParagraphContent, Run } from '../../types/document';
import {
  createTrackedChangeInfo,
  type RevisionMetadataInput,
  type ResolvedRevisionMetadata,
  resolveRevisionMetadata,
} from './metadata';
import { createRevisionIdAllocator, type RevisionIdAllocator } from './revisionIds';
import { diffRuns } from './runDiff';

export interface ParagraphRevisionizeOptions {
  allocator?: RevisionIdAllocator;
  insertionMetadata?: RevisionMetadataInput;
  deletionMetadata?: RevisionMetadataInput;
  fallbackAuthor?: string;
}

export function revisionizeParagraphRuns(
  previousRuns: Run[],
  currentRuns: Run[],
  options: ParagraphRevisionizeOptions = {}
): ParagraphContent[] {
  const allocator = options.allocator ?? createRevisionIdAllocator(1);
  const insertionMeta = resolveRevisionMetadata(options.insertionMetadata, options.fallbackAuthor);
  const deletionMeta = resolveRevisionMetadata(options.deletionMetadata, options.fallbackAuthor);

  const chunks = diffRuns(previousRuns, currentRuns);
  const content: ParagraphContent[] = [];

  for (const chunk of chunks) {
    if (chunk.runs.length === 0) continue;

    if (chunk.kind === 'equal') {
      content.push(...chunk.runs);
      continue;
    }

    if (chunk.kind === 'insert') {
      appendTrackedChange(
        content,
        createInsertion(chunk.runs, allocator, insertionMeta),
        'insertion'
      );
      continue;
    }

    appendTrackedChange(content, createDeletion(chunk.runs, allocator, deletionMeta), 'deletion');
  }

  return content;
}

function appendTrackedChange(
  content: ParagraphContent[],
  change: Insertion | Deletion,
  type: 'insertion' | 'deletion'
): void {
  const last = content[content.length - 1];
  if (last && last.type === type) {
    last.content.push(...change.content);
    return;
  }
  content.push(change);
}

function createInsertion(
  runs: Run[],
  allocator: RevisionIdAllocator,
  metadata: ResolvedRevisionMetadata
): Insertion {
  return {
    type: 'insertion',
    info: createTrackedChangeInfo(allocator.next(), metadata),
    content: runs,
  };
}

function createDeletion(
  runs: Run[],
  allocator: RevisionIdAllocator,
  metadata: ResolvedRevisionMetadata
): Deletion {
  return {
    type: 'deletion',
    info: createTrackedChangeInfo(allocator.next(), metadata),
    content: runs,
  };
}
