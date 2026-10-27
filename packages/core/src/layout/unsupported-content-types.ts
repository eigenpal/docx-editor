import type {
  DrawingGraphicKind,
  DrawingSupport,
  DrawingSupportIssue,
  OoxmlElement,
} from '@docx-editor.dev/core/store';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from './drawing-layout.ts';
import type { EquationSpanRecord } from './equation-layout.ts';
import type { LayoutBox } from './semantic-records.ts';

/**
 * One occurrence that a custom component can replace: a placeholder for content the editor
 * cannot render, or, with `includeRenderedDrawings`, a drawing that the editor renders.
 * The drawing fields are present only for drawings.
 *
 * @public
 */
export interface UnsupportedElement {
  /**
   * `drawing` for a drawing that the editor renders, offered only to rules with
   * `includeRenderedDrawings`. Absent for placeholders.
   */
  readonly presentation?: 'drawing';
  /**
   * How completely the editor shows this drawing: `native`, `partial`, or `unrendered`.
   * A drawing placeholder is `unrendered`. Absent for content that is not a drawing.
   */
  readonly support?: DrawingSupport;
  /**
   * The features of this drawing that the editor does not show as authored, read from its
   * own XML. Chart and diagram parts are not read, so an empty list does not prove fidelity.
   */
  readonly drawingIssues?: readonly DrawingSupportIssue[];
  /** The graphic a drawing holds, such as `picture`, `chart`, or `diagram`, from its source. */
  readonly graphicKind?: DrawingGraphicKind;
  /** The node the occurrence comes from, in the editor's current document. */
  readonly nodeId: string;
  /** The part that holds it, such as `/word/document.xml` or `/word/header1.xml`. */
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
   * The layout record of a drawing. Use `graphicKind` to identify the graphic: the record's
   * `placeholderGraphicKind` names the graphic only for placeholders. A chart whose chart part
   * can be read also carries `chart`, whose `shownAs` describes the native presentation.
   * Absent for other content.
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
  /**
   * Also offer drawings that the editor renders, not only placeholders. Text boxes stay
   * editable and are never offered.
   */
  readonly includeRenderedDrawings?: boolean;
  /** Return true to replace this occurrence. Omit to match every offered occurrence. */
  readonly match?: (element: UnsupportedElement) => boolean;
  /** The box to reserve for content that has no layout box of its own, in points. */
  readonly layout?: UnsupportedElementLayout;
}

/**
 * Whether a rule claims an occurrence. Adapters use it to pick the first matching
 * declaration; hosts with their own registration can use it the same way.
 *
 * @public
 */
export function unsupportedElementRuleMatches(
  rule: UnsupportedElementRule,
  element: UnsupportedElement
): boolean {
  return (
    (element.presentation !== 'drawing' || rule.includeRenderedDrawings === true) &&
    (rule.match?.(element) ?? true)
  );
}
