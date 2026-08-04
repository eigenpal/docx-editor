// The one SVG wrapper every Igloo icon renders through.
//
// Shared rather than copied into each icon file — the same shape the library uses, where
// `components/ui/icon-base.tsx` holds one `SvgIcon` that `Icons.tsx` imports. Splitting the
// icon CONSTANTS across files keeps each list short; duplicating the wrapper would just be
// two definitions to keep in step.
//
// Deliberately a different drawing language from the packaged Material Symbols: 1.6px
// strokes on a 24-box, round caps, no fills. A host swapping icons wants its own look, and
// a demo that swapped them for near-identical glyphs would not show that anything happened.

import type { ReactNode } from 'react';

export function Frost({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
