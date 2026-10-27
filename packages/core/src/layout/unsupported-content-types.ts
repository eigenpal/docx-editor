import type { DrawingSupportIssue } from '../store/package/drawing-support-issues.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from './drawing-layout.ts';
import type { EquationSpanRecord } from './equation-layout.ts';
import type { LayoutBox } from './semantic-records.ts';

/** Source metadata for placeholders and opt-in drawing previews. @public */
export interface UnsupportedElement {
  /** Absent for existing placeholders; `drawing` identifies an opt-in rendered graphic. */
  readonly presentation?: 'drawing';
  /** Known explicit source limitations; an empty list does not prove full fidelity. */
  readonly drawingIssues?: readonly DrawingSupportIssue[];
  readonly nodeId: string;
  readonly ownerPartName: string;
  readonly namespaceUri: string | null;
  readonly localName: string;
  /** Lossless canonical source. Treat this value as read-only and untrusted. */
  readonly source: OoxmlElement | null;
  readonly placement: 'inline' | 'block';
  /** The text of the built-in placeholder. */
  readonly label: string;
  /** Reserved geometry in document points, when the element has been laid out. */
  readonly bounds?: LayoutBox;
  /**
   * The layout record of a drawing offered for custom presentation. Its
   * `placeholderGraphicKind` names the kind of graphic, such as `chart` or `diagram`. A chart
   * whose chart part can be read also carries `chart`. Its `shownAs` describes the native
   * presentation, before customization. Absent for other content.
   */
  readonly drawing?: InlineDrawingRecord | AnchoredDrawingRecord;
  /** The layout record of an equation shown as the built-in placeholder. */
  readonly equation?: EquationSpanRecord;
}
/** Dimensions reserved before pagination, in document points. @public */
export interface UnsupportedElementLayout {
  readonly width: number;
  readonly height: number;
}
/** The first matching registration renders each unsupported element. @public */
export interface UnsupportedElementRule {
  /** Also offer rendered graphics. Text-box stories remain editable and are excluded. */
  readonly includeRenderedDrawings?: boolean;
  readonly match?: (element: UnsupportedElement) => boolean;
  readonly layout?: UnsupportedElementLayout;
}

/** Match a custom presentation without changing the default placeholder-only scope. @public */
export function unsupportedElementRuleMatches(
  rule: UnsupportedElementRule,
  element: UnsupportedElement
): boolean {
  return (
    (element.presentation !== 'drawing' || rule.includeRenderedDrawings === true) &&
    (rule.match?.(element) ?? true)
  );
}
