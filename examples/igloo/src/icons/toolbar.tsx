// The demo's own icon set.
//
// Every toolbar control here is drawn by the HOST, not by the registry — which is the point
// being demonstrated: `DocxEditor.Toolbar.Bold` and friends take an `icon` prop, so a
// product with its own icon language never has to accept ours.
//
// Deliberately a different drawing language from the packaged Material Symbols: 1.6px
// strokes on a 24-box, round caps, no fills. A host swapping icons wants its own look, and
// a demo that swapped them for near-identical glyphs would not show that anything happened.

import { Frost } from './Frost';

export const IceUndo = (
  <Frost>
    <path d="M4 8h10a5 5 0 0 1 0 10H8" />
    <path d="M8 4 4 8l4 4" />
  </Frost>
);

export const IceRedo = (
  <Frost>
    <path d="M20 8H10a5 5 0 0 0 0 10h6" />
    <path d="m16 4 4 4-4 4" />
  </Frost>
);

export const IceBold = (
  <Frost>
    <path d="M7 5h6.5a3.5 3.5 0 0 1 0 7H7z" />
    <path d="M7 12h7.5a3.5 3.5 0 0 1 0 7H7z" />
  </Frost>
);

export const IceItalic = (
  <Frost>
    <path d="M15 4h-5M14 20H9M14 4 10 20" />
  </Frost>
);

export const IceUnderline = (
  <Frost>
    <path d="M7 4v6a5 5 0 0 0 10 0V4M5 20h14" />
  </Frost>
);

export const IceStrike = (
  <Frost>
    <path d="M5 12h14M8 7a4 4 0 0 1 8 0M8 16a4 4 0 0 0 8 0" />
  </Frost>
);

export const IceAlignLeft = (
  <Frost>
    <path d="M4 6h16M4 11h9M4 16h13M4 21h7" />
  </Frost>
);

export const IceAlignCenter = (
  <Frost>
    <path d="M4 6h16M7 11h10M5 16h14M8 21h8" />
  </Frost>
);

export const IceAlignRight = (
  <Frost>
    <path d="M4 6h16M11 11h9M7 16h13M13 21h7" />
  </Frost>
);

export const IceBullets = (
  <Frost>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1.2" />
    <circle cx="4.5" cy="12" r="1.2" />
    <circle cx="4.5" cy="18" r="1.2" />
  </Frost>
);

export const IceNumbers = (
  <Frost>
    <path d="M9 6h11M9 12h11M9 18h11M3.5 4.5 5 4v4M3.5 16.5h2l-2 3h2" />
  </Frost>
);

export const IceLink = (
  <Frost>
    <path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.4 6.4" />
    <path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.4-1.4" />
  </Frost>
);

export const IceClear = (
  <Frost>
    <path d="M6 5h13M11 5 8.5 19M13 12l6 6M19 12l-6 6" />
  </Frost>
);

/** Freeze: a snowflake. Highlights the selected passage (see `frost.ts`). */
export const IceFreeze = (
  <Frost>
    <path d="M12 2v20M4 7l16 10M20 7 4 17" />
    <path d="M12 6 9.5 4M12 6l2.5-2M12 18l-2.5 2M12 18l2.5 2" />
  </Frost>
);

/** Blizzard: a cloud with fall lines. Pure decoration the engine knows nothing about. */
export const IceBlizzard = (
  <Frost>
    <path d="M7 13a3.5 3.5 0 0 1 .5-7 5 5 0 0 1 9.3 1.4A3 3 0 0 1 17 13z" />
    <path d="M8 17v1M12 16v3M16 17v1" />
  </Frost>
);

// The context menu's own icons live in `menu-icons.tsx`, so each file stays short and
// scannable — the same split the library makes between `Icons.tsx` and `icon-base.tsx`.

// ─────────────────────────────────────────────────────────────────────────────
// The split colour controls
// ─────────────────────────────────────────────────────────────────────────────
//
// Only the GLYPH is replaced. The colour bar under it is the library's and still paints the
// live value, so these stay readable at a glance — which is the whole reason the control is
// shaped this way. Both drop the baseline the packaged icons sit on, because the bar already
// draws one.

/**
 * A CORNER of a snowflake, in ice blue.
 *
 * Six arms from a centre that sits just outside the top-right of the box, so the SVG
 * viewport clips it and what shows is the corner of a much larger flake rather than a small
 * whole one. Blue on purpose: it is the only part of these icons that does not inherit
 * `currentColor`, which is what keeps it reading as ice against the glyph it garnishes
 * rather than as another stroke of it.
 *
 * `--doc-accent` rather than a literal, so it tracks the theme like everything else here.
 */
const SnowflakeCorner = (
  <g stroke="var(--doc-accent)" strokeWidth="1.5">
    <path d="M14.5 3h13" />
    <path d="m17.75 -2.63 6.5 11.26" />
    <path d="m17.75 8.63 6.5-11.26" />
  </g>
);

/** Font colour: the "A", under a corner of ice. */
export const IceFontColor = (
  <Frost>
    <path d="M3 17.5 8.5 6 14 17.5" />
    <path d="M5.3 13.2h6.4" />
    {SnowflakeCorner}
  </Frost>
);

/** Highlight: a marker, under a corner of ice. */
export const IceHighlight = (
  <Frost>
    <path d="m10 4.8 4.2 4.2-6.3 6.3H3.7v-4.2z" />
    <path d="M3 19h10.5" />
    {SnowflakeCorner}
  </Frost>
);
