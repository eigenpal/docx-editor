// The rail's two decisions, in the theme's drawing language. These replace the packaged tick
// and cross through the parts' `icon` prop; nothing else about either button changes.

import { Frost } from './Frost';

/** Accept: let it melt into the document. */
export const IceMelt = (
  <Frost>
    <path d="M5 6h14" />
    <path d="M12 10c2.6 3.2 4.2 5.2 4.2 7.1A4.2 4.2 0 0 1 7.8 17c0-1.9 1.6-3.9 4.2-7Z" />
  </Frost>
);

/** Reject: refreeze it the way it was. */
export const IceRefreeze = (
  <Frost>
    <path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9" />
    <path d="M9 5.5 12 3l3 2.5M9 18.5 12 21l3-2.5" />
  </Frost>
);

/**
 * The collapsed rail's gutter markers, in the theme's line.
 *
 * A FUNCTION of the item, because one `Markers` draws every marker: a single node would put
 * one shape on all of them, which is the thing the packaged part was fixed to stop doing.
 */
export const iceMarker = (item: { kind: string }) => {
  if (item.kind === 'comment') {
    // A breath cloud: someone said something.
    return (
      <Frost>
        <path d="M7 15a3 3 0 0 1 .4-6 4 4 0 0 1 7.5-1.2A3.4 3.4 0 1 1 16 15Z" />
        <path d="M9 19h7" />
      </Frost>
    );
  }
  if (item.kind === 'custom') {
    // A specimen flag. The definition's own glyph is the packaged fallback; the ice theme
    // draws its own so the gutter stays one drawing language.
    return (
      <Frost>
        <path d="M7 21V4l10 3.5L7 11" />
      </Frost>
    );
  }
  // A tracked change: the crystal, the same mark the reject button carries.
  return (
    <Frost>
      <path d="M12 4v16M6 8l12 8M18 8 6 16" />
    </Frost>
  );
};
