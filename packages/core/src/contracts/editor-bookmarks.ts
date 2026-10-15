/**
 * Which kind of story a bookmark is in: the main text, a header or footer, or a note.
 *
 * @public
 */
export type BookmarkStory = 'body' | 'headerFooter' | 'note';

/**
 * One bookmark, as the `bookmarks` query lists it.
 *
 * @public
 */
export interface BookmarkSummary {
  /** The name as the document writes it. Names compare without case. */
  readonly name: string;
  /** Whether the name starts with an underscore. Hidden bookmarks mark application targets. */
  readonly hidden: boolean;
  /** The story the bookmark starts in. */
  readonly story: BookmarkStory;
  /**
   * Position in document order: the main text first, then headers, footers and notes. Sort by
   * this value to list bookmarks by location.
   */
  readonly order: number;
  /** Whether the bookmark marks a point rather than a range of text. */
  readonly empty: boolean;
  /** Whether the start of the selection is inside the bookmark, edges included. */
  readonly atSelection: boolean;
  /**
   * How many other places carry the same name. Usually 0. Collaborators who add one name while
   * offline can leave copies; the list, Go To and links use this bookmark, the first in
   * document order. Adding the name again at this bookmark keeps it and removes the copies.
   */
  readonly duplicates: number;
}

/**
 * The bookmark commands an editor accepts.
 *
 * @public
 */
export interface EditorBookmarkCommands {
  /**
   * Bookmark the selection under `name`, or the caret position when the selection is
   * collapsed. A bookmark that already has the name, compared without case, moves here, also
   * from another story, in one undo step. Two collaborators who add one name offline both keep
   * their bookmark; every replica reads the first in document order until the next write of the
   * name, which replaces or removes both.
   * Refused with `invalidArgs` for a name that does not start with a letter, holds a
   * character other than a letter, a digit or an underscore, or has more than 40 characters.
   */
  insertBookmark: { name: string };
  /** Remove the bookmark with this name, compared without case. The text stays. */
  deleteBookmark: { name: string };
  /** Select the bookmark's text, or put the caret at a point bookmark, and scroll to it. */
  goToBookmark: { name: string };
  /** Show or hide bracket marks at bookmarks. A view command: the document does not change. */
  toggleBookmarks: Record<never, never>;
  /**
   * Open the Bookmark dialog the host registered, the same request the Insert menu and
   * Ctrl/Cmd+Shift+F5 send. Allowed in a read-only document, where Go To still works.
   * Refused with `unsupported` while no host shows a bookmark dialog, for example when the
   * `bookmark` popup is `false`.
   */
  openBookmarkDialog: Record<never, never>;
}
