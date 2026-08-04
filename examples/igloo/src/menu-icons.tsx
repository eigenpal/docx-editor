// Icons for the context menu's rows.
//
// Split from `icons.tsx` so the toolbar's set and the menu's set can each stay a short,
// scannable file — the same reason `icon-base.tsx` is split out of the library's own
// `Icons.tsx`. Same drawing language: 1.6px strokes on a 24-box, no fills.

import { Frost } from './frost-svg';

/** Cut: an ice saw. */
export const IceCut = (
  <Frost>
    <path d="M4 18 18 4M6 20l2-2M4 14l2 2" />
    <circle cx="5" cy="19" r="1.6" />
    <path d="m14 14 6 6M20 4l-6 6" />
  </Frost>
);

/** Copy: two stacked floes. */
export const IceCopy = (
  <Frost>
    <path d="M9 9h11v11H9z" />
    <path d="M15 5H4v11h1" />
  </Frost>
);

/** Frost: a snowflake over a line of text. Named apart from the toolbar's `IceFreeze`,
 *  which drives read-only mode rather than highlighting a passage. */
export const IceFrost = (
  <Frost>
    <path d="M12 2v12M7 5l10 6M17 5 7 11" />
    <path d="M4 20h16" />
  </Frost>
);

/** Thaw: a drop falling from a line. */
export const IceThaw = (
  <Frost>
    <path d="M4 5h16" />
    <path d="M12 9c2.5 3 4 5 4 6.8A4 4 0 0 1 8 15.8C8 14 9.5 12 12 9Z" />
  </Frost>
);

/** Ice core: the sample tube the comment row logs into. */
export const IceCore = (
  <Frost>
    <path d="M9 3h6v15a3 3 0 0 1-6 0z" />
    <path d="M9 9h6M9 14h6" />
  </Frost>
);

/** Carve: a chisel. */
export const IceCarve = (
  <Frost>
    <path d="m4 20 3-1 10-10-2-2L5 17z" />
    <path d="m15 5 2-2 4 4-2 2z" />
  </Frost>
);
