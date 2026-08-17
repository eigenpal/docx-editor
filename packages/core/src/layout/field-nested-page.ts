// Live evaluation of an allowlisted PAGE-family field nested inside an open complex field's
// atomic cached result.
//
// The paragraph walk in `field-projection.ts` skips such an inner field's cached digits and
// appends the projected per-sheet value when the inner `end` closes — the same semantics
// `collectSimpleFieldDisplay` gives a field nested in a `w:fldSimple` cache, so a `STYLEREF`
// wrapping `PAGE` never stamps the producer's saved sheet number onto every page. This
// tracker owns only that state: which inner field is armed, and whether its cached result was
// seen and whether any of it was visible. Extracted so the walk stays a straight-line reading
// of the field machine.

import type { AllowlistedPageField } from './field-instruction.ts';
import { projectPageFieldValue, type FieldPageContext } from './field-page-furniture.ts';

export interface NestedPageTracker {
  /** True while an armed inner live field is skipping its cached digits. */
  readonly active: boolean;
  /** Arm for one inner field; null disarms (non-allowlisted, or no page context). */
  arm(kind: AllowlistedPageField | null): void;
  /** Disarm and forget (outer begin, any inner end). */
  reset(): void;
  /** Record one piece of the inner field's cached result, visible or not. */
  noteResult(visible: boolean): void;
  /**
   * The live value the closing inner `end` appends, or `''`. An inner cached result that
   * existed but was entirely suppressed appends nothing — the file said this field's result
   * is not shown, and a live number would resurrect it (fldSimple parity).
   */
  liveValue(pageContext: FieldPageContext | undefined): string;
}

export function createNestedPageTracker(): NestedPageTracker {
  let kind: AllowlistedPageField | null = null;
  let seen = false;
  let visible = false;
  return {
    get active(): boolean {
      return kind !== null;
    },
    arm(next: AllowlistedPageField | null): void {
      kind = next;
      seen = false;
      visible = false;
    },
    reset(): void {
      kind = null;
      seen = false;
      visible = false;
    },
    noteResult(wasVisible: boolean): void {
      seen = true;
      if (wasVisible) visible = true;
    },
    liveValue(pageContext: FieldPageContext | undefined): string {
      if (kind === null || !pageContext) return '';
      if (seen && !visible) return '';
      return projectPageFieldValue(kind, pageContext);
    },
  };
}
