// The two specimens, drawn once.
//
// Shared by the chip popover and the rail card so a berg cannot be nine tenths under water in
// one place and half under it in the other. Pure decoration — the numbers beside them come
// from the node's attrs, which is where the truth lives.

/** A berg at its real proportions: a tenth above the dashed waterline, the rest below. */
export function BergGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 100"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <path d="M52 6 64 26H40z" fill="#f6feff" />
      <path d="M40 26h24l12 60a38 11 0 0 1-48 0z" fill="#c6ebf9" />
      <path d="M40 26h24l6 30-30 6z" fill="#a6dcf2" opacity="0.7" />
      <rect x="0" y="26" width="120" height="74" fill="#12557c" opacity="0.3" />
      <path d="M0 26h120" stroke="#9fdcf4" strokeWidth="1.5" strokeDasharray="5 4" fill="none" />
    </svg>
  );
}

/** A dome with its tunnel, and the courses of block that make it up. */
export function DomeGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 100"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <path d="M8 80a52 46 0 0 1 104 0z" fill="#eefbff" stroke="#8fd4ee" strokeWidth="1.6" />
      <path d="M48 80V62a12 12 0 0 1 24 0v18" fill="#c6ebf9" stroke="#8fd4ee" strokeWidth="1.6" />
      <path
        d="M14 62h92M26 46h68M42 34h36"
        stroke="#8fd4ee"
        strokeWidth="1.2"
        fill="none"
        opacity="0.8"
      />
      <path d="M8 80h104" stroke="#6fbfe0" strokeWidth="1.6" fill="none" />
    </svg>
  );
}
