// FORMCHECKBOX / FORMDROPDOWN legacy form fields (§17.16.5.22, §17.16.5.16).
//
// Their state lives in `w:ffData` under the begin `w:fldChar`, read once at the trust boundary
// by `store/package/field-nodes.ts` (`legacyFormFieldDataOf` — state only, macros never). This
// module decides what that state paints over the field's single reserved atom unit:
//
// - FORMCHECKBOX always renders from ffData — the checked bit is the authority, so a stale
//   cached glyph never wins. ☒ (U+2612) when checked, ☐ (U+2610) when not; an explicit
//   `w:size` overrides the run's font size, `w:sizeAuto` keeps it.
// - FORMDROPDOWN prefers its cached result (what Word last painted) and synthesizes the
//   selected entry only when the cache is empty.
//
// Everything fails closed to the previous behavior (cached text or nothing): an instruction
// without matching ffData state, an empty entry list, an empty selected entry.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import type { LegacyFormFieldData } from '../store/package/field-nodes.ts';
import { parseButtonInstruction, type ButtonFieldSpec } from './field-button.ts';
import { normalizeFieldInstruction } from './field-instruction.ts';
import { parseHyperlinkInstruction, type HyperlinkFieldSpec } from './field-link.ts';
import { parseSymbolInstruction, type SymbolFieldSpec } from './field-symbol.ts';
import { resolveRunStyle, type ResolvedRunStyle, type ThemeFonts } from './run-style.ts';

/** Which legacy form field a complex-field instruction names. */
export type FormFieldKind = 'checkbox' | 'dropdown';

/** BALLOT BOX WITH X — what Word paints for a checked FORMCHECKBOX. */
export const CHECKBOX_CHECKED_GLYPH = '☒';
/** BALLOT BOX — the unchecked FORMCHECKBOX glyph. */
export const CHECKBOX_UNCHECKED_GLYPH = '☐';

/**
 * Recognize a FORMCHECKBOX / FORMDROPDOWN instruction, bounded and normalized like every
 * other allowlisted instruction. Anything else — including an overflowing instruction — is
 * null and stays inert.
 */
export function parseFormFieldInstruction(raw: string): FormFieldKind | null {
  const normalized = normalizeFieldInstruction(raw);
  if (normalized === 'FORMCHECKBOX') return 'checkbox';
  if (normalized === 'FORMDROPDOWN') return 'dropdown';
  return null;
}

/**
 * The instruction-derived specs a pending atomic field captures before the machine's buffer
 * resets. Structural rather than `PendingFieldProjection` so this module needs nothing from
 * the walk's vocabulary.
 */
export interface CapturedInstructionSpecs {
  symbolSpec: SymbolFieldSpec | null;
  linkSpec: HyperlinkFieldSpec | null;
  formSpec: FormFieldKind | null;
  buttonSpec: ButtonFieldSpec | null;
}

/**
 * Capture every instruction-derived spec at once — at the outermost `separate`, or at the
 * no-separate `end`, while the machine still holds the raw instruction. The instructions are
 * mutually exclusive, so the first recognizer that hits wins and the rest stay null.
 */
export function captureInstructionSpecs(pending: CapturedInstructionSpecs, raw: string): void {
  pending.symbolSpec = parseSymbolInstruction(raw);
  if (pending.symbolSpec) return;
  pending.linkSpec = parseHyperlinkInstruction(raw);
  if (pending.linkSpec) return;
  pending.formSpec = parseFormFieldInstruction(raw);
  if (pending.formSpec) return;
  pending.buttonSpec = parseButtonInstruction(raw);
}

/** The synthesized form-field result: text plus the props/style the piece should carry. */
export interface FormFieldGlyph {
  readonly text: string;
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
}

/**
 * Resolve a pending form field to the text it paints, or null to fall through to the
 * existing branches (cached text or nothing).
 *
 * A checkbox synthesizes unconditionally when its ffData state is present — ffData is the
 * state authority and a stale cached glyph must not win. A dropdown defers to a non-empty
 * cached result first. A form instruction whose ffData is missing or of the wrong shape
 * fails closed.
 */
export function formFieldResult(
  pending: {
    readonly formSpec: FormFieldKind | null;
    readonly formData: LegacyFormFieldData | null;
    readonly cachedText: string;
    readonly props: readonly OoxmlProperty[];
    readonly style: ResolvedRunStyle;
  },
  themeFonts?: ThemeFonts
): FormFieldGlyph | null {
  if (pending.formSpec === 'checkbox') {
    if (pending.formData?.kind !== 'checkbox') return null;
    const text = pending.formData.checked ? CHECKBOX_CHECKED_GLYPH : CHECKBOX_UNCHECKED_GLYPH;
    if (pending.formData.sizeHalfPoints === null) {
      return { text, props: pending.props, style: pending.style };
    }
    // Explicit `w:size` is half-points, same unit as `w:sz` — landed as an override on the
    // result-style chain and resolved through the ordinary cascade.
    const props: readonly OoxmlProperty[] = [
      ...pending.props,
      { localName: 'sz', attributes: { val: String(pending.formData.sizeHalfPoints) } },
    ];
    return { text, props, style: resolveRunStyle(props, themeFonts) };
  }
  if (pending.formSpec === 'dropdown') {
    if (pending.cachedText.length > 0) return null;
    if (pending.formData?.kind !== 'dropdown') return null;
    const text = pending.formData.entries[pending.formData.selectedIndex] ?? '';
    if (text.length === 0) return null;
    return { text, props: pending.props, style: pending.style };
  }
  return null;
}
