// The berg the page rides on, and the berg the context menu is cut from.
//
// Both are SVG rather than CSS shapes because both need the same thing: a jagged silhouette
// with a waterline across it, drawn once and scaled to whatever box it is given. `Iceberg`
// stretches behind the document page; `BergPanel` is the same idea at panel scale, used as
// the context menu's backdrop.
//
// Neither takes a hit test. The page must stay clickable through the backdrop, and the menu
// rows must stay clickable through the panel art.

/** Shared gradient ids. Module-level constants so two instances cannot collide. */
const CROWN_GRADIENT = 'igloo-berg-crown';
const BELOW_GRADIENT = 'igloo-berg-below';

/**
 * The document's berg: a wide crown just above the page's top edge and a submerged mass
 * spreading below it.
 *
 * `preserveAspectRatio="none"` on purpose — the berg is a backdrop stretched to the page
 * box, not an illustration whose proportions carry meaning.
 */
export function Iceberg() {
  return (
    <svg
      className="igloo-berg"
      viewBox="0 0 1000 1400"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={CROWN_GRADIENT} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f4fdff" />
          <stop offset="55%" stopColor="#cfeefc" />
          <stop offset="100%" stopColor="#9fd6ef" />
        </linearGradient>
        <linearGradient id={BELOW_GRADIENT} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7fc4e4" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#2e7ba6" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* The submerged mass, drawn FIRST so the lit crown sits on top of it. Wider than the
          crown, because that is the whole visual joke about icebergs. */}
      <path
        d="M120 250 L40 700 L92 1180 L300 1360 L700 1360 L910 1170 L960 690 L880 250 Z"
        fill={`url(#${BELOW_GRADIENT})`}
      />

      {/* The crown: the part above the waterline. */}
      <path
        d="M300 96 L214 168 L150 132 L96 250 L904 250 L850 140 L784 176 L706 88 L604 150 L500 40 L396 148 Z"
        fill={`url(#${CROWN_GRADIENT})`}
      />

      {/* Facets — a couple of lighter planes so the crown reads as carved rather than flat. */}
      <path d="M500 40 L604 150 L500 250 L396 148 Z" fill="#ffffff" opacity="0.55" />
      <path d="M96 250 L150 132 L214 168 L268 250 Z" fill="#ffffff" opacity="0.3" />

      {/* The waterline. */}
      <path d="M40 250 H960" stroke="#eaf9ff" strokeWidth="4" opacity="0.8" />
    </svg>
  );
}

/**
 * The context menu's backdrop: the same berg language at panel scale.
 *
 * An angled crown along the top edge, a waterline under it, and a body that fills the rest
 * of the panel. Stretches to the panel box, so a menu of four rows and a menu of ten both
 * look cut from one piece of ice.
 */
export function BergPanel() {
  return (
    <svg
      className="igloo-menu__berg"
      viewBox="0 0 300 400"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="igloo-panel-ice" x1="0" y1="0" x2="0.3" y2="1">
          {/* OPAQUE. This is a menu panel, and the document reading through its rows is
              the same legibility problem the chrome panels had — the ice look has to come
              from the colour and the crown, not from letting the page show through. */}
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="45%" stopColor="#eaf8ff" />
          <stop offset="100%" stopColor="#cbe9f8" />
        </linearGradient>
      </defs>
      {/* Body plus crown in one path: the top edge is jagged, the sides and bottom are the
          panel's own rounded box. */}
      <path
        d="M0 34 L46 8 L92 30 L140 2 L196 28 L242 6 L300 32 L300 400 L0 400 Z"
        fill="url(#igloo-panel-ice)"
      />
      <path d="M140 2 L196 28 L140 60 L92 30 Z" fill="#ffffff" opacity="0.7" />
      {/* The waterline, just under the crown. */}
      <path d="M0 62 H300" stroke="#8ecbe8" strokeWidth="1.5" opacity="0.55" />
    </svg>
  );
}
