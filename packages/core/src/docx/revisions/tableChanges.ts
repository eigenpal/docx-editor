import type {
  PropertyChangeInfo,
  Table,
  TableCell,
  TableCellPropertyChange,
  TablePropertyChange,
  TableRow,
  TableRowPropertyChange,
  TableStructuralChangeInfo,
} from '../../types/document';
import {
  createTrackedChangeInfo,
  type ResolvedRevisionMetadata,
  type RevisionMetadataInput,
  resolveRevisionMetadata,
} from './metadata';
import { createRevisionIdAllocator, type RevisionIdAllocator } from './revisionIds';
import { deepEqual } from './utils';

export interface TableChangeRevisionOptions {
  allocator?: RevisionIdAllocator;
  metadata?: RevisionMetadataInput;
  fallbackAuthor?: string;
  rsid?: string;
}

export interface TableStructuralRevisionOptions {
  allocator?: RevisionIdAllocator;
  metadata?: RevisionMetadataInput;
  fallbackAuthor?: string;
}

export function detectTablePropertyChanges(
  previous: Table,
  current: Table,
  options: TableChangeRevisionOptions = {}
): TablePropertyChange[] | undefined {
  if (areEqual(previous.formatting, current.formatting)) {
    return current.propertyChanges;
  }

  const allocator = options.allocator ?? createRevisionIdAllocator(1);
  const metadata = resolveRevisionMetadata(options.metadata, options.fallbackAuthor);
  return [
    {
      type: 'tablePropertyChange',
      info: createPropertyChangeInfo(allocator.next(), metadata, options.rsid),
      previousFormatting: previous.formatting,
      currentFormatting: current.formatting,
    },
  ];
}

export function detectTableRowPropertyChanges(
  previous: TableRow,
  current: TableRow,
  options: TableChangeRevisionOptions = {}
): TableRowPropertyChange[] | undefined {
  if (areEqual(previous.formatting, current.formatting)) {
    return current.propertyChanges;
  }

  const allocator = options.allocator ?? createRevisionIdAllocator(1);
  const metadata = resolveRevisionMetadata(options.metadata, options.fallbackAuthor);
  return [
    {
      type: 'tableRowPropertyChange',
      info: createPropertyChangeInfo(allocator.next(), metadata, options.rsid),
      previousFormatting: previous.formatting,
      currentFormatting: current.formatting,
    },
  ];
}

export function detectTableCellPropertyChanges(
  previous: TableCell,
  current: TableCell,
  options: TableChangeRevisionOptions = {}
): TableCellPropertyChange[] | undefined {
  if (areEqual(previous.formatting, current.formatting)) {
    return current.propertyChanges;
  }

  const allocator = options.allocator ?? createRevisionIdAllocator(1);
  const metadata = resolveRevisionMetadata(options.metadata, options.fallbackAuthor);
  return [
    {
      type: 'tableCellPropertyChange',
      info: createPropertyChangeInfo(allocator.next(), metadata, options.rsid),
      previousFormatting: previous.formatting,
      currentFormatting: current.formatting,
    },
  ];
}

export function withDetectedTablePropertyChanges(
  previous: Table,
  current: Table,
  options: TableChangeRevisionOptions = {}
): Table {
  const propertyChanges = detectTablePropertyChanges(previous, current, options);
  if (!propertyChanges || propertyChanges.length === 0) {
    return current;
  }

  return {
    ...current,
    propertyChanges,
  };
}

export function withDetectedTableRowPropertyChanges(
  previous: TableRow,
  current: TableRow,
  options: TableChangeRevisionOptions = {}
): TableRow {
  const propertyChanges = detectTableRowPropertyChanges(previous, current, options);
  if (!propertyChanges || propertyChanges.length === 0) {
    return current;
  }

  return {
    ...current,
    propertyChanges,
  };
}

export function withDetectedTableCellPropertyChanges(
  previous: TableCell,
  current: TableCell,
  options: TableChangeRevisionOptions = {}
): TableCell {
  const propertyChanges = detectTableCellPropertyChanges(previous, current, options);
  if (!propertyChanges || propertyChanges.length === 0) {
    return current;
  }

  return {
    ...current,
    propertyChanges,
  };
}

export function createTableStructuralChange(
  type: TableStructuralChangeInfo['type'],
  options: TableStructuralRevisionOptions = {}
): TableStructuralChangeInfo {
  const allocator = options.allocator ?? createRevisionIdAllocator(1);
  const metadata = resolveRevisionMetadata(options.metadata, options.fallbackAuthor);

  return {
    type,
    info: createTrackedChangeInfo(allocator.next(), metadata),
  };
}

export function withTableRowStructuralChange(
  row: TableRow,
  type: 'tableRowInsertion' | 'tableRowDeletion',
  options: TableStructuralRevisionOptions = {}
): TableRow {
  return {
    ...row,
    structuralChange: createTableStructuralChange(type, options),
  };
}

export function withTableCellStructuralChange(
  cell: TableCell,
  type: 'tableCellInsertion' | 'tableCellDeletion' | 'tableCellMerge',
  options: TableStructuralRevisionOptions = {}
): TableCell {
  return {
    ...cell,
    structuralChange: createTableStructuralChange(type, options),
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
