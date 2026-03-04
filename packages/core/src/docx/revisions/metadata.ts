import type { TrackedChangeInfo } from '../../types/document';

export const DEFAULT_TRACK_CHANGES_AUTHOR = 'Unknown';

export interface RevisionMetadataInput {
  author?: string | null;
  date?: string | Date | null;
}

export interface ResolvedRevisionMetadata {
  author: string;
  date: string;
}

export function normalizeRevisionAuthor(
  author: string | null | undefined,
  fallbackAuthor = DEFAULT_TRACK_CHANGES_AUTHOR
): string {
  if (typeof author !== 'string') {
    return fallbackAuthor;
  }
  const trimmed = author.trim();
  return trimmed.length > 0 ? trimmed : fallbackAuthor;
}

export function normalizeRevisionDate(
  date: string | Date | null | undefined,
  now = new Date()
): string {
  if (date instanceof Date) {
    return date.toISOString();
  }
  if (typeof date === 'string' && date.trim().length > 0) {
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return now.toISOString();
}

export function resolveRevisionMetadata(
  input: RevisionMetadataInput = {},
  fallbackAuthor = DEFAULT_TRACK_CHANGES_AUTHOR,
  now = new Date()
): ResolvedRevisionMetadata {
  return {
    author: normalizeRevisionAuthor(input.author, fallbackAuthor),
    date: normalizeRevisionDate(input.date, now),
  };
}

export function createTrackedChangeInfo(
  id: number,
  input: RevisionMetadataInput = {},
  fallbackAuthor = DEFAULT_TRACK_CHANGES_AUTHOR,
  now = new Date()
): TrackedChangeInfo {
  if (!Number.isInteger(id) || id < 0) {
    throw new Error('tracked change id must be a non-negative integer');
  }
  const metadata = resolveRevisionMetadata(input, fallbackAuthor, now);
  return {
    id,
    author: metadata.author,
    date: metadata.date,
  };
}
