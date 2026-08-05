// Icons for the context menu's rows.
//
// Split from `icons.tsx` so the toolbar's set and the menu's set can each stay a short,
// scannable file — the same reason `icon-base.tsx` is split out of the library's own
// `Icons.tsx`. Same drawing language: 1.6px strokes on a 24-box, no fills.

import type { ReactNode } from 'react';
import { Frost } from './Frost';

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

/** Iceberg: the tip above a dashed waterline, and the bulk under it. */
export const IceBerg = (
  <Frost>
    <path d="M11 3 15 9H7z" />
    <path d="M7 9h8l3 10H4z" />
    <path d="M2 9h20" strokeDasharray="2.5 2" />
  </Frost>
);

/** Igloo: the dome with its tunnel. */
export const IceDome = (
  <Frost>
    <path d="M3 17a9 9 0 0 1 18 0z" />
    <path d="M9.5 17v-3.5a2.5 2.5 0 0 1 5 0V17" />
    <path d="M3 17h18M6 12h12" />
  </Frost>
);

/** Whatever the water gives you: a die, thrown. */
export const IceLottery = (
  <Frost>
    <path d="M5 6.5 12 3l7 3.5v9L12 19l-7-3.5z" />
    <circle cx="9.5" cy="9.5" r="0.9" />
    <circle cx="14.5" cy="12.5" r="0.9" />
  </Frost>
);

// ─────────────────────────────────────────────────────────────────────────────
// Menu-bar trigger icons
// ─────────────────────────────────────────────────────────────────────────────
//
// Smaller than the row icons (16 vs 18) because they sit inline with a text label rather
// than in a reserved icon column, and a glyph matching the cap height reads as part of the
// word instead of competing with it.

function Trigger({ children }: { children: ReactNode }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// Named for the MENU each one sits on, not for a theme word. The bar keeps File, Format,
// Insert and Help — a menu bar is navigation, and those four names are the one part of an
// editor a user arrives already knowing. The glyph is where the theme goes.

/** File: a flag planted on a summit. */
export const IceFile = (
  <Trigger>
    <path d="M7 21V4l10 3-10 3" />
    <path d="M4 21h9" />
  </Trigger>
);

/** Format: a chisel edge over a shaped block. */
export const IceFormat = (
  <Trigger>
    <path d="m14 4 6 6-9 9H5v-6z" />
    <path d="M3 21h18" />
  </Trigger>
);

/** Insert: something dropping into a layer. */
export const IceInsert = (
  <Trigger>
    <path d="M12 3v10M8.5 9.5 12 13l3.5-3.5" />
    <path d="M4 17h16v4H4z" />
  </Trigger>
);

/** Help: a field manual. */
export const IceGuide = (
  <Trigger>
    <path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z" />
    <path d="M9 8h6M9 12h6" />
  </Trigger>
);

/** Igloo: the dome itself. */
export const IceIgloo = (
  <Trigger>
    <path d="M2 18a10 10 0 0 1 20 0z" />
    <path d="M9 18v-4a3 3 0 0 1 6 0v4" />
    <path d="M2 18h20" />
  </Trigger>
);
