import { resolvedNoteText as resolvedNoteStoryText } from '../store/store/resolved-note-text.ts';
import type { AutomationStoryReads } from './reads.ts';

export function resolvedNoteText(
  reads: AutomationStoryReads,
  displayMode: 'proposed' | 'original'
): string {
  return resolvedNoteStoryText(reads.root, displayMode);
}
