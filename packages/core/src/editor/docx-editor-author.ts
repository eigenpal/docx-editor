/** Normalize an editor author for storage and comparison. */
export function normalizeEditorAuthor(author: string | undefined): string | undefined {
  return author?.trim() || undefined;
}

/** Initials from a name, for a revision — `CT_TrackChange` carries no `@w:initials`. */
export function initialsOfAuthor(author: string): string {
  const words = author.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}
