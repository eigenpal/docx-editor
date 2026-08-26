// The synthesis dispatch for one committed atomic complex field: given the pending state and the
// document-global context, decide the single glyph run the field's reserved model unit paints.
//
// Split out of `field-projection.ts` (against the file-size cap) as a self-contained decision:
// it reads the pending field and returns text/props/style, and owns none of the walk's closure
// machinery. The caller keeps offset ownership, visibility guards, link/attribution carry and
// the actual `push`.
//
// Branch order (mutually exclusive keywords, cached result winning where Word trusts it):
//   1. SYMBOL — synthesized glyph wins over any stale cached text.
//   2. legacy form field — checkbox from ffData state, dropdown from the selected entry.
//   3. allowlisted PAGE-family — live value from the page context.
//   4. cached result — a non-empty cache is what Word last painted; it wins over synthesis.
//   5. empty cache only (and no hidden-but-present result): a document-property value, else a
//      MACROBUTTON / GOTOBUTTON display.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import type { DocumentProperties } from '@docx-editor.dev/core/store';
import { docPropertyValue } from './field-doc-property.ts';
import { formFieldResult } from './field-form.ts';
import {
  pageFieldPlaceholder,
  projectPageFieldValue,
  type BodyPageFieldContext,
  type FieldPageContext,
} from './field-page-furniture.ts';
import type { AllowlistedPageField } from './field-instruction.ts';
import type { PendingFieldProjection } from './field-pieces.ts';
import { symbolFieldGlyph } from './field-symbol.ts';
import type { ResolvedRunStyle, ThemeFonts } from './run-style.ts';

/** The one glyph run a synthesized atomic field paints over its reserved model unit. */
export interface AtomicFieldSynthesis {
  readonly text: string;
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
  /**
   * Present when this is a BODY page-field placeholder: {@link text} is the measurement digit and
   * document finalize substitutes the real value for this kind. The caller carries the marker onto
   * the span. Absent for the live header/footer value and every other synthesis.
   */
  readonly pageField?: {
    readonly kind: AllowlistedPageField;
    /** The field's `\#` numeric picture, carried to the substitute pass. */
    readonly picture?: string;
  };
}

/** Document-global inputs the synthesis reads, none of them per-run. */
export interface AtomicSynthesisContext {
  readonly pageContext?: FieldPageContext;
  readonly themeFonts?: ThemeFonts;
  readonly documentProperties?: DocumentProperties;
  /**
   * True in BODY flow, where an empty-cache PAGE/NUMPAGES/SECTIONPAGES paints a placeholder for
   * document finalize to substitute. Absent/false in headers, footers, notes and text boxes,
   * which keep their live path or deferral — a placeholder there would never be substituted.
   */
  readonly bodyPageFields?: BodyPageFieldContext | false;
}

/**
 * Resolve what a committed atomic field paints, or null for nothing (an empty result, an
 * unresolvable spec, or a missing property — the model unit stays, painting no glyph).
 *
 * The caller has already answered outer visibility (`w:vanish`, a revision the mode hides), so
 * this never re-checks it; it only chooses the glyph run.
 */
export function synthesizeAtomicField(
  pending: PendingFieldProjection,
  ctx: AtomicSynthesisContext
): AtomicFieldSynthesis | null {
  // SYMBOL renders from its instruction — Word never trusts a cached result for it.
  if (pending.symbolSpec) {
    const glyph = symbolFieldGlyph(pending.symbolSpec, pending.props, ctx.themeFonts);
    if (glyph) return { text: glyph.text, props: glyph.props, style: glyph.style };
  }
  // A legacy form field renders from its ffData state (checkbox always; dropdown when empty).
  const form = formFieldResult(pending, ctx.themeFonts);
  if (form) return { text: form.text, props: form.props, style: form.style };

  if (pending.kind && ctx.pageContext) {
    return {
      text: projectPageFieldValue(pending.kind, ctx.pageContext, pending.picture ?? undefined),
      props: pending.props,
      style: pending.style,
    };
  }
  // A non-empty cached result is what Word last painted; it wins over synthesis.
  if (pending.cachedText.length > 0) {
    return { text: pending.cachedText, props: pending.props, style: pending.style };
  }
  // Empty cache: synthesize. A result that existed but was hidden stays hidden.
  if (!pending.sawResultContent) {
    // A BODY page field (no page context): paint a placeholder now and record the kind so
    // document finalize substitutes the page's real value. Gated on `bodyPageFields` because
    // headers/footers took the live branch above, and notes / text boxes have no substitute pass.
    if (pending.kind && ctx.bodyPageFields) {
      const picture = pending.picture ?? undefined;
      return {
        text: pageFieldPlaceholder(picture, ctx.bodyPageFields.format),
        props: pending.props,
        style: pending.style,
        pageField: {
          kind: pending.kind,
          ...(picture !== undefined ? { picture } : {}),
        },
      };
    }
    if (pending.docPropertySpec) {
      const value = docPropertyValue(pending.docPropertySpec, ctx.documentProperties);
      if (value !== null) return { text: value, props: pending.props, style: pending.style };
    }
    // MACROBUTTON / GOTOBUTTON display their text; the macro / target never runs.
    if (pending.buttonSpec) {
      return { text: pending.buttonSpec.display, props: pending.props, style: pending.style };
    }
  }
  return null;
}
