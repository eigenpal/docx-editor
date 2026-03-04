import type {
  Paragraph,
  ParagraphPropertyChange,
  PropertyChangeInfo,
  Run,
  RunPropertyChange,
} from '../../types/document';
import {
  createTrackedChangeInfo,
  type ResolvedRevisionMetadata,
  type RevisionMetadataInput,
  resolveRevisionMetadata,
} from './metadata';
import { createRevisionIdAllocator, type RevisionIdAllocator } from './revisionIds';
import { deepEqual } from './utils';

export interface PropertyChangeRevisionOptions {
  allocator?: RevisionIdAllocator;
  metadata?: RevisionMetadataInput;
  fallbackAuthor?: string;
  rsid?: string;
}

export function detectRunPropertyChanges(
  previous: Run,
  current: Run,
  options: PropertyChangeRevisionOptions = {}
): RunPropertyChange[] | undefined {
  if (areEqual(previous.formatting, current.formatting)) {
    return current.propertyChanges;
  }

  const allocator = options.allocator ?? createRevisionIdAllocator(1);
  const metadata = resolveRevisionMetadata(options.metadata, options.fallbackAuthor);

  return [
    {
      type: 'runPropertyChange',
      info: createPropertyChangeInfo(allocator.next(), metadata, options.rsid),
      previousFormatting: previous.formatting,
      currentFormatting: current.formatting,
    },
  ];
}

export function detectParagraphPropertyChanges(
  previous: Paragraph,
  current: Paragraph,
  options: PropertyChangeRevisionOptions = {}
): ParagraphPropertyChange[] | undefined {
  if (areEqual(previous.formatting, current.formatting)) {
    return current.propertyChanges;
  }

  const allocator = options.allocator ?? createRevisionIdAllocator(1);
  const metadata = resolveRevisionMetadata(options.metadata, options.fallbackAuthor);

  return [
    {
      type: 'paragraphPropertyChange',
      info: createPropertyChangeInfo(allocator.next(), metadata, options.rsid),
      previousFormatting: previous.formatting,
      currentFormatting: current.formatting,
    },
  ];
}

export function withDetectedRunPropertyChanges(
  previous: Run,
  current: Run,
  options: PropertyChangeRevisionOptions = {}
): Run {
  const propertyChanges = detectRunPropertyChanges(previous, current, options);
  if (!propertyChanges || propertyChanges.length === 0) {
    return current;
  }
  return {
    ...current,
    propertyChanges,
  };
}

export function withDetectedParagraphPropertyChanges(
  previous: Paragraph,
  current: Paragraph,
  options: PropertyChangeRevisionOptions = {}
): Paragraph {
  const propertyChanges = detectParagraphPropertyChanges(previous, current, options);
  if (!propertyChanges || propertyChanges.length === 0) {
    return current;
  }
  return {
    ...current,
    propertyChanges,
  };
}

function createPropertyChangeInfo(
  id: number,
  metadata: ResolvedRevisionMetadata,
  rsid?: string
): PropertyChangeInfo {
  const base = createTrackedChangeInfo(id, metadata);
  if (rsid && rsid.trim().length > 0) {
    return {
      ...base,
      rsid,
    };
  }
  return base;
}

function areEqual(left: unknown, right: unknown): boolean {
  return deepEqual(left ?? null, right ?? null);
}
