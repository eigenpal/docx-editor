import type { DocumentProperties, OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { FieldCodeRange } from './field-code-toc.ts';
import type { BodyPageFieldContext, FieldPageContext } from './field-page-furniture.ts';
import type {
  FieldLinkProjector,
  HyperlinkProjector,
  MutableChangeSite,
  MutableModelRange,
} from './field-pieces.ts';
import type { RefFieldContext } from './field-ref.ts';
import type { RunPropertyCascader } from './field-run-text.ts';
import type { NoteMarkContext } from './note-projection.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import type { ThemeFonts } from './run-style.ts';
import type { TocLinkRange } from './toc-link-formatting.ts';

/**
 * What the display walk projects one paragraph with. @internal
 *
 * `tocLinkStyleRanges` is required: every walk states the TOC link ranges, so a new walk cannot
 * skip the TOC rule and still compile. Outside a TOC, pass `undefined`.
 */
export interface DisplayWalkInput {
  readonly paragraph: OoxmlNode;
  /** Run properties the paragraph style and defaults supply. Absent means none. */
  readonly inheritedRunProperties?: readonly OoxmlProperty[];
  readonly pageContext?: FieldPageContext;
  readonly cascadeRuns?: RunPropertyCascader;
  readonly projectLink?: HyperlinkProjector;
  readonly noteMarks?: NoteMarkContext;
  /** Absent means the default revision display mode. */
  readonly displayMode?: RevisionDisplayMode;
  /** Collects the model ranges that removed content leaves without a piece. */
  readonly deletedRanges?: MutableModelRange[];
  readonly inlineDrawingLayout?: InlineDrawingLayoutContext;
  readonly themeFonts?: ThemeFonts;
  readonly projectFieldLink?: FieldLinkProjector;
  readonly documentProperties?: DocumentProperties;
  /** Absent or `false` paints cached page-field results. */
  readonly bodyPageFields?: BodyPageFieldContext | false;
  readonly refFields?: RefFieldContext;
  readonly authorFilter?: RevisionAuthorFilter;
  readonly showFieldCodes?: boolean;
  readonly fieldCodeRanges?: readonly FieldCodeRange[];
  /** This paragraph's TOC link ranges, or `undefined` outside a TOC. */
  readonly tocLinkStyleRanges: readonly TocLinkRange[] | undefined;
  /** Collects the change sites that removed content leaves. */
  readonly changeSites?: MutableChangeSite[];
}
