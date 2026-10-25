import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from './drawing-layout.ts';
import type { EquationSpanRecord } from './equation-layout.ts';
import type { LayoutBox } from './semantic-records.ts';

/** Source metadata for content the engine cannot render. @public */
export interface UnsupportedElement {
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
   * The layout record of a drawing shown as the built-in placeholder. Its
   * `placeholderGraphicKind` names the kind of graphic, such as `chart` or `diagram`. A chart
   * whose chart part can be read also carries `chart`, whose `shownAs` is always `placeholder`
   * here, because only a placeholder reaches a declaration. Absent for other content.
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
  readonly match?: (element: UnsupportedElement) => boolean;
  readonly layout?: UnsupportedElementLayout;
}
