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
 * cannot render, or, with `includePartial`, a drawing that the editor renders without some
 * features. The drawing fields are present only for drawings.
 *
 * @public
 */
export interface UnsupportedElement {
  /**
   * How completely the editor shows this drawing: `unrendered` for a placeholder, or
   * `partial` for a drawing that renders without some features, offered only with
   * `includePartial`. Absent for content that is not a drawing.
   */
  readonly support?: Exclude<DrawingSupport, 'native'>;
  /**
   * The features of this drawing that the editor does not show as authored, read from its
   * own XML. Chart and diagram parts are not read, so an empty list does not prove fidelity.
   * Never holds `unplaced-drawing` or `projection-diagnostic`, which only a report lists.
   */
  readonly drawingIssues?: readonly DrawingSupportIssue[];
  /**
   * The graphic a drawing holds, such as `picture`, `chart`, or `diagram`, from its source.
   * `textbox` names any DrawingML shape, with or without text, after its markup.
   */
  readonly graphicKind?: DrawingGraphicKind;
  /** The node the occurrence comes from, in the editor's current document. */
  readonly nodeId: string;
  /** The part that holds it, such as `/word/document.xml` or `/word/header1.xml`. */
  readonly ownerPartName: string;
  readonly namespaceUri: string | null;
  readonly localName: string;
  /**
   * Lossless canonical source. Treat this value as read-only and untrusted. It stays the same
   * object until the content itself changes, so use it as the dependency of work you derive
   * from the content, such as a preview request. A change in a related part only, such as
   * chart data, an image, or the theme, keeps the same object.
   */
  readonly source: OoxmlElement | null;
  readonly placement: 'inline' | 'block';
  /** The text of the built-in placeholder. */
  readonly label: string;
  /**
   * Reserved geometry in document points, when the element has been laid out. For a drawing,
   * it includes the effect extent, as the page of `createDrawingPreviewPackage` does.
   */
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
   * Also offer drawings that the editor renders without some features (`support` is
   * `partial`), so a component can fill the gap, for example with an image from your own
   * renderer. Fully supported drawings are never offered, and neither are shapes whose text
   * the editor edits.
   */
  readonly includePartial?: boolean;
  /**
   * Return true to replace this occurrence. Omit to match every offered occurrence. Offered
   * occurrences also include equations and other content that is not a drawing; test
   * `element.drawing` to match drawings only.
   */
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
    (element.support !== 'partial' || rule.includePartial === true) &&
    (rule.match?.(element) ?? true)
  );
}
