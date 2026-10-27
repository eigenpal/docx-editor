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
   * own XML. Chart and diagram parts, inherited theme effects, and image bytes are not read,
   * so an empty list does not prove fidelity.
   * Never holds `unplaced-drawing` or `projection-diagnostic`, which only a report lists.
   */
  readonly drawingIssues?: readonly DrawingSupportIssue[];
  /**
   * The graphic a drawing holds, such as `picture`, `chart`, or `diagram`, from its source.
   * Note: `textbox` names every DrawingML shape, with or without text, and `shape` names only
   * legacy VML drawings.
   */
  readonly graphicKind?: DrawingGraphicKind;
  /** The node the occurrence comes from, in the editor's current document. */
  readonly nodeId: string;
  /** The part that holds it, such as `/word/document.xml` or `/word/header1.xml`. */
  readonly ownerPartName: string;
  /** The namespace of the source element, such as the WordprocessingML namespace. */
  readonly namespaceUri: string | null;
  /** The local name of the source element, such as `drawing` or `AlternateContent`. */
  readonly localName: string;
  /**
   * Lossless canonical source. Treat this value as read-only and untrusted. It stays the same
   * object until the content itself changes, so use it as the dependency of work you derive
   * from the content, such as a preview request. Every editor edit to a drawing gives a new
   * object, including a replaced picture, which gets a new relationship. The editor does not
   * edit chart data, diagram data, or the theme, so `source` alone tells you when to ask for a
   * new preview. A component usually stays mounted when its occurrence changes and receives
   * the new element; it remounts when the occurrence moves to another page or scrolls back
   * into view. Keep previews outside the component, for example in a `WeakMap` keyed on
   * `source`, so a remount reuses them. Cache the `Blob` or bytes rather than an object URL:
   * create the URL in the effect, and revoke it and clear the image in the cleanup. Never
   * `null` for an occurrence in the editor; only a standalone painter without a source lookup
   * gives `null`.
   */
  readonly source: OoxmlElement | null;
  /** `inline` inside a line of text, or `block` between paragraphs. */
  readonly placement: 'inline' | 'block';
  /** The text of the built-in placeholder. */
  readonly label: string;
  /**
   * Reserved geometry in document points, when the element has been laid out. Always present
   * for a drawing, and it includes the effect extent, as the page of
   * `createDrawingPreviewPackage` does.
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
  /** Width in points: finite, positive, and at most 100,000. */
  readonly width: number;
  /** Height in points: finite, positive, and at most 100,000. */
  readonly height: number;
}
/** The first matching registration renders each unsupported element. @public */
export interface UnsupportedElementRule {
  /**
   * Also offer drawings that the editor renders without some features (`support` is
   * `partial`). Default `false`. Use it so a component can fill the gap, for example with an
   * image from your own renderer. Fully supported drawings are never offered, and neither are
   * shapes with text that the editor edits; a partial shape without text is offered. Hidden
   * drawings and drawings without a layout position have no box, so they are never offered
   * either.
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
