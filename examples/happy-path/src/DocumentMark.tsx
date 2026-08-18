// A sheet of paper with a folded corner, sitting left of the document's name.
//
// The fold fills in when the document has edits that are not saved yet, so the
// strip answers "is my work safe?" without anyone having to read a word. That
// question is the one every document tool has to answer, which is why this is
// the piece of host chrome worth drawing rather than a logo.
//
// `aria-hidden`: the state is announced by the text beside it, which is a live
// region. Two announcements of one fact is worse than one.

interface DocumentMarkProps {
  /** Whether the document has changes the host has not saved. */
  readonly dirty: boolean;
}

export function DocumentMark({ dirty }: DocumentMarkProps) {
  return (
    <svg
      className="happy-mark"
      data-state={dirty ? 'dirty' : 'clean'}
      viewBox="0 0 17 22"
      aria-hidden="true"
      focusable="false"
    >
      {/* The sheet, cut away at the top-right so the fold sits in the notch. */}
      <path
        className="happy-mark__sheet"
        d="M0.5 2.5a2 2 0 0 1 2-2H10l6.5 6.5v12.5a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2Z"
      />
      {/* The fold. */}
      <path className="happy-mark__fold" d="M10 0.5V7h6.5Z" />
      <line className="happy-mark__rule" x1="4" y1="12" x2="13" y2="12" />
      <line className="happy-mark__rule" x1="4" y1="15" x2="13" y2="15" />
      <line className="happy-mark__rule" x1="4" y1="18" x2="10" y2="18" />
    </svg>
  );
}
