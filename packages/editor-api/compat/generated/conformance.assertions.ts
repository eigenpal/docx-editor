// GENERATED FILE — do not edit by hand.
//
// Produced by packages/editor-api/scripts/generate-conformance.mjs from
// compat/reference/word.reference.json (upstream-derived facts, never
// upstream source) and compat/docxeditor/declarations.ts (DocxEditor's
// own, independently authored public interfaces).
//
// Each `_assert_*` alias fails to compile — via IsExact's bidirectional
// `extends` check, not one-directional structural `extends` — the moment a
// selected Word.* overload (per compat/manifest.json) stops having an exact
// structural match in DocxEditor's own declarations. Referencing `DocxEditor.*`
// names also means a typo'd or unexported authored type name fails here as a
// real "Cannot find name" compiler error, not just a silent textual mismatch.

import type { IsExact, Expect } from '../docxeditor/type-assert';
import type { DocxEditor } from '../docxeditor/declarations';

type Ref_Annotation_critiqueAnnotation_0 = () => DocxEditor.CritiqueAnnotation;
type Auth_Annotation_critiqueAnnotation_0 = () => DocxEditor.CritiqueAnnotation;
type _check_Annotation_critiqueAnnotation_0 = IsExact<Ref_Annotation_critiqueAnnotation_0, Auth_Annotation_critiqueAnnotation_0>;
type _assert_Annotation_critiqueAnnotation_0 = Expect<_check_Annotation_critiqueAnnotation_0>;

type Ref_Annotation_critiqueAnnotation_readonly_1 = { readonly value: DocxEditor.CritiqueAnnotation };
type Auth_Annotation_critiqueAnnotation_readonly_1 = { readonly value: DocxEditor.CritiqueAnnotation };
type _check_Annotation_critiqueAnnotation_readonly_1 = IsExact<Ref_Annotation_critiqueAnnotation_readonly_1, Auth_Annotation_critiqueAnnotation_readonly_1>;
type _assert_Annotation_critiqueAnnotation_readonly_1 = Expect<_check_Annotation_critiqueAnnotation_readonly_1>;

type Ref_Annotation_delete_2 = () => void;
type Auth_Annotation_delete_2 = () => void;
type _check_Annotation_delete_2 = IsExact<Ref_Annotation_delete_2, Auth_Annotation_delete_2>;
type _assert_Annotation_delete_2 = Expect<_check_Annotation_delete_2>;

type Ref_Annotation_id_3 = () => string;
type Auth_Annotation_id_3 = () => string;
type _check_Annotation_id_3 = IsExact<Ref_Annotation_id_3, Auth_Annotation_id_3>;
type _assert_Annotation_id_3 = Expect<_check_Annotation_id_3>;

type Ref_Annotation_id_readonly_4 = { readonly value: string };
type Auth_Annotation_id_readonly_4 = { readonly value: string };
type _check_Annotation_id_readonly_4 = IsExact<Ref_Annotation_id_readonly_4, Auth_Annotation_id_readonly_4>;
type _assert_Annotation_id_readonly_4 = Expect<_check_Annotation_id_readonly_4>;

type Ref_Annotation_state_5 = () => "Created" | "Accepted" | "Rejected";
type Auth_Annotation_state_5 = () => "Created" | "Accepted" | "Rejected";
type _check_Annotation_state_5 = IsExact<Ref_Annotation_state_5, Auth_Annotation_state_5>;
type _assert_Annotation_state_5 = Expect<_check_Annotation_state_5>;

type Ref_Annotation_state_readonly_6 = { readonly value: "Created" | "Accepted" | "Rejected" };
type Auth_Annotation_state_readonly_6 = { readonly value: "Created" | "Accepted" | "Rejected" };
type _check_Annotation_state_readonly_6 = IsExact<Ref_Annotation_state_readonly_6, Auth_Annotation_state_readonly_6>;
type _assert_Annotation_state_readonly_6 = Expect<_check_Annotation_state_readonly_6>;

type Ref_AnnotationCollection_getFirst_7 = () => DocxEditor.Annotation;
type Auth_AnnotationCollection_getFirst_7 = () => DocxEditor.Annotation;
type _check_AnnotationCollection_getFirst_7 = IsExact<Ref_AnnotationCollection_getFirst_7, Auth_AnnotationCollection_getFirst_7>;
type _assert_AnnotationCollection_getFirst_7 = Expect<_check_AnnotationCollection_getFirst_7>;

type Ref_AnnotationCollection_getFirstOrNullObject_8 = () => DocxEditor.Annotation;
type Auth_AnnotationCollection_getFirstOrNullObject_8 = () => DocxEditor.Annotation;
type _check_AnnotationCollection_getFirstOrNullObject_8 = IsExact<Ref_AnnotationCollection_getFirstOrNullObject_8, Auth_AnnotationCollection_getFirstOrNullObject_8>;
type _assert_AnnotationCollection_getFirstOrNullObject_8 = Expect<_check_AnnotationCollection_getFirstOrNullObject_8>;

type Ref_AnnotationCollection_items_9 = () => DocxEditor.Annotation[];
type Auth_AnnotationCollection_items_9 = () => DocxEditor.Annotation[];
type _check_AnnotationCollection_items_9 = IsExact<Ref_AnnotationCollection_items_9, Auth_AnnotationCollection_items_9>;
type _assert_AnnotationCollection_items_9 = Expect<_check_AnnotationCollection_items_9>;

type Ref_AnnotationCollection_items_readonly_10 = { readonly value: DocxEditor.Annotation[] };
type Auth_AnnotationCollection_items_readonly_10 = { readonly value: DocxEditor.Annotation[] };
type _check_AnnotationCollection_items_readonly_10 = IsExact<Ref_AnnotationCollection_items_readonly_10, Auth_AnnotationCollection_items_readonly_10>;
type _assert_AnnotationCollection_items_readonly_10 = Expect<_check_AnnotationCollection_items_readonly_10>;

type Ref_AnnotationSet_critiques_11 = () => DocxEditor.Critique[];
type Auth_AnnotationSet_critiques_11 = () => DocxEditor.Critique[];
type _check_AnnotationSet_critiques_11 = IsExact<Ref_AnnotationSet_critiques_11, Auth_AnnotationSet_critiques_11>;
type _assert_AnnotationSet_critiques_11 = Expect<_check_AnnotationSet_critiques_11>;

type Ref_AnnotationSet_critiques_readonly_12 = { value: DocxEditor.Critique[] };
type Auth_AnnotationSet_critiques_readonly_12 = { value: DocxEditor.Critique[] };
type _check_AnnotationSet_critiques_readonly_12 = IsExact<Ref_AnnotationSet_critiques_readonly_12, Auth_AnnotationSet_critiques_readonly_12>;
type _assert_AnnotationSet_critiques_readonly_12 = Expect<_check_AnnotationSet_critiques_readonly_12>;

type Ref_Body_clear_13 = () => void;
type Auth_Body_clear_13 = () => void;
type _check_Body_clear_13 = IsExact<Ref_Body_clear_13, Auth_Body_clear_13>;
type _assert_Body_clear_13 = Expect<_check_Body_clear_13>;

type Ref_Body_contentControls_14 = () => DocxEditor.ContentControlCollection;
type Auth_Body_contentControls_14 = () => DocxEditor.ContentControlCollection;
type _check_Body_contentControls_14 = IsExact<Ref_Body_contentControls_14, Auth_Body_contentControls_14>;
type _assert_Body_contentControls_14 = Expect<_check_Body_contentControls_14>;

type Ref_Body_contentControls_readonly_15 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Body_contentControls_readonly_15 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Body_contentControls_readonly_15 = IsExact<Ref_Body_contentControls_readonly_15, Auth_Body_contentControls_readonly_15>;
type _assert_Body_contentControls_readonly_15 = Expect<_check_Body_contentControls_readonly_15>;

type Ref_Body_endnotes_16 = () => DocxEditor.NoteItemCollection;
type Auth_Body_endnotes_16 = () => DocxEditor.NoteItemCollection;
type _check_Body_endnotes_16 = IsExact<Ref_Body_endnotes_16, Auth_Body_endnotes_16>;
type _assert_Body_endnotes_16 = Expect<_check_Body_endnotes_16>;

type Ref_Body_endnotes_readonly_17 = { readonly value: DocxEditor.NoteItemCollection };
type Auth_Body_endnotes_readonly_17 = { readonly value: DocxEditor.NoteItemCollection };
type _check_Body_endnotes_readonly_17 = IsExact<Ref_Body_endnotes_readonly_17, Auth_Body_endnotes_readonly_17>;
type _assert_Body_endnotes_readonly_17 = Expect<_check_Body_endnotes_readonly_17>;

type Ref_Body_font_18 = () => DocxEditor.Font;
type Auth_Body_font_18 = () => DocxEditor.Font;
type _check_Body_font_18 = IsExact<Ref_Body_font_18, Auth_Body_font_18>;
type _assert_Body_font_18 = Expect<_check_Body_font_18>;

type Ref_Body_font_readonly_19 = { readonly value: DocxEditor.Font };
type Auth_Body_font_readonly_19 = { readonly value: DocxEditor.Font };
type _check_Body_font_readonly_19 = IsExact<Ref_Body_font_readonly_19, Auth_Body_font_readonly_19>;
type _assert_Body_font_readonly_19 = Expect<_check_Body_font_readonly_19>;

type Ref_Body_footnotes_20 = () => DocxEditor.NoteItemCollection;
type Auth_Body_footnotes_20 = () => DocxEditor.NoteItemCollection;
type _check_Body_footnotes_20 = IsExact<Ref_Body_footnotes_20, Auth_Body_footnotes_20>;
type _assert_Body_footnotes_20 = Expect<_check_Body_footnotes_20>;

type Ref_Body_footnotes_readonly_21 = { readonly value: DocxEditor.NoteItemCollection };
type Auth_Body_footnotes_readonly_21 = { readonly value: DocxEditor.NoteItemCollection };
type _check_Body_footnotes_readonly_21 = IsExact<Ref_Body_footnotes_readonly_21, Auth_Body_footnotes_readonly_21>;
type _assert_Body_footnotes_readonly_21 = Expect<_check_Body_footnotes_readonly_21>;

type Ref_Body_getComments_22 = () => DocxEditor.CommentCollection;
type Auth_Body_getComments_22 = () => DocxEditor.CommentCollection;
type _check_Body_getComments_22 = IsExact<Ref_Body_getComments_22, Auth_Body_getComments_22>;
type _assert_Body_getComments_22 = Expect<_check_Body_getComments_22>;

type Ref_Body_insertFileFromBase64_23 = (base64File: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Body_insertFileFromBase64_23 = (base64File: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Body_insertFileFromBase64_23 = IsExact<Ref_Body_insertFileFromBase64_23, Auth_Body_insertFileFromBase64_23>;
type _assert_Body_insertFileFromBase64_23 = Expect<_check_Body_insertFileFromBase64_23>;

type Ref_Body_insertParagraph_24 = (paragraphText: string, insertLocation: "Start" | "End") => DocxEditor.Paragraph;
type Auth_Body_insertParagraph_24 = (paragraphText: string, insertLocation: "Start" | "End") => DocxEditor.Paragraph;
type _check_Body_insertParagraph_24 = IsExact<Ref_Body_insertParagraph_24, Auth_Body_insertParagraph_24>;
type _assert_Body_insertParagraph_24 = Expect<_check_Body_insertParagraph_24>;

type Ref_Body_insertText_25 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Body_insertText_25 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Body_insertText_25 = IsExact<Ref_Body_insertText_25, Auth_Body_insertText_25>;
type _assert_Body_insertText_25 = Expect<_check_Body_insertText_25>;

type Ref_Body_lists_26 = () => DocxEditor.ListCollection;
type Auth_Body_lists_26 = () => DocxEditor.ListCollection;
type _check_Body_lists_26 = IsExact<Ref_Body_lists_26, Auth_Body_lists_26>;
type _assert_Body_lists_26 = Expect<_check_Body_lists_26>;

type Ref_Body_lists_readonly_27 = { readonly value: DocxEditor.ListCollection };
type Auth_Body_lists_readonly_27 = { readonly value: DocxEditor.ListCollection };
type _check_Body_lists_readonly_27 = IsExact<Ref_Body_lists_readonly_27, Auth_Body_lists_readonly_27>;
type _assert_Body_lists_readonly_27 = Expect<_check_Body_lists_readonly_27>;

type Ref_Body_paragraphs_28 = () => DocxEditor.ParagraphCollection;
type Auth_Body_paragraphs_28 = () => DocxEditor.ParagraphCollection;
type _check_Body_paragraphs_28 = IsExact<Ref_Body_paragraphs_28, Auth_Body_paragraphs_28>;
type _assert_Body_paragraphs_28 = Expect<_check_Body_paragraphs_28>;

type Ref_Body_paragraphs_readonly_29 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Body_paragraphs_readonly_29 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Body_paragraphs_readonly_29 = IsExact<Ref_Body_paragraphs_readonly_29, Auth_Body_paragraphs_readonly_29>;
type _assert_Body_paragraphs_readonly_29 = Expect<_check_Body_paragraphs_readonly_29>;

type Ref_Body_search_30 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Body_search_30 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Body_search_30 = IsExact<Ref_Body_search_30, Auth_Body_search_30>;
type _assert_Body_search_30 = Expect<_check_Body_search_30>;

type Ref_Body_style_31 = () => string;
type Auth_Body_style_31 = () => string;
type _check_Body_style_31 = IsExact<Ref_Body_style_31, Auth_Body_style_31>;
type _assert_Body_style_31 = Expect<_check_Body_style_31>;

type Ref_Body_style_readonly_32 = { value: string };
type Auth_Body_style_readonly_32 = { value: string };
type _check_Body_style_readonly_32 = IsExact<Ref_Body_style_readonly_32, Auth_Body_style_readonly_32>;
type _assert_Body_style_readonly_32 = Expect<_check_Body_style_readonly_32>;

type Ref_Body_text_33 = () => string;
type Auth_Body_text_33 = () => string;
type _check_Body_text_33 = IsExact<Ref_Body_text_33, Auth_Body_text_33>;
type _assert_Body_text_33 = Expect<_check_Body_text_33>;

type Ref_Body_text_readonly_34 = { readonly value: string };
type Auth_Body_text_readonly_34 = { readonly value: string };
type _check_Body_text_readonly_34 = IsExact<Ref_Body_text_readonly_34, Auth_Body_text_readonly_34>;
type _assert_Body_text_readonly_34 = Expect<_check_Body_text_readonly_34>;

type Ref_Bookmark_delete_35 = () => void;
type Auth_Bookmark_delete_35 = () => void;
type _check_Bookmark_delete_35 = IsExact<Ref_Bookmark_delete_35, Auth_Bookmark_delete_35>;
type _assert_Bookmark_delete_35 = Expect<_check_Bookmark_delete_35>;

type Ref_Bookmark_name_36 = () => string;
type Auth_Bookmark_name_36 = () => string;
type _check_Bookmark_name_36 = IsExact<Ref_Bookmark_name_36, Auth_Bookmark_name_36>;
type _assert_Bookmark_name_36 = Expect<_check_Bookmark_name_36>;

type Ref_Bookmark_name_readonly_37 = { readonly value: string };
type Auth_Bookmark_name_readonly_37 = { readonly value: string };
type _check_Bookmark_name_readonly_37 = IsExact<Ref_Bookmark_name_readonly_37, Auth_Bookmark_name_readonly_37>;
type _assert_Bookmark_name_readonly_37 = Expect<_check_Bookmark_name_readonly_37>;

type Ref_Bookmark_range_38 = () => DocxEditor.Range;
type Auth_Bookmark_range_38 = () => DocxEditor.Range;
type _check_Bookmark_range_38 = IsExact<Ref_Bookmark_range_38, Auth_Bookmark_range_38>;
type _assert_Bookmark_range_38 = Expect<_check_Bookmark_range_38>;

type Ref_Bookmark_range_readonly_39 = { readonly value: DocxEditor.Range };
type Auth_Bookmark_range_readonly_39 = { readonly value: DocxEditor.Range };
type _check_Bookmark_range_readonly_39 = IsExact<Ref_Bookmark_range_readonly_39, Auth_Bookmark_range_readonly_39>;
type _assert_Bookmark_range_readonly_39 = Expect<_check_Bookmark_range_readonly_39>;

type Ref_Bookmark_select_40 = () => void;
type Auth_Bookmark_select_40 = () => void;
type _check_Bookmark_select_40 = IsExact<Ref_Bookmark_select_40, Auth_Bookmark_select_40>;
type _assert_Bookmark_select_40 = Expect<_check_Bookmark_select_40>;

type Ref_BookmarkCollection_items_41 = () => DocxEditor.Bookmark[];
type Auth_BookmarkCollection_items_41 = () => DocxEditor.Bookmark[];
type _check_BookmarkCollection_items_41 = IsExact<Ref_BookmarkCollection_items_41, Auth_BookmarkCollection_items_41>;
type _assert_BookmarkCollection_items_41 = Expect<_check_BookmarkCollection_items_41>;

type Ref_BookmarkCollection_items_readonly_42 = { readonly value: DocxEditor.Bookmark[] };
type Auth_BookmarkCollection_items_readonly_42 = { readonly value: DocxEditor.Bookmark[] };
type _check_BookmarkCollection_items_readonly_42 = IsExact<Ref_BookmarkCollection_items_readonly_42, Auth_BookmarkCollection_items_readonly_42>;
type _assert_BookmarkCollection_items_readonly_42 = Expect<_check_BookmarkCollection_items_readonly_42>;

type Ref_BorderUniversal_color_43 = () => string;
type Auth_BorderUniversal_color_43 = () => string;
type _check_BorderUniversal_color_43 = IsExact<Ref_BorderUniversal_color_43, Auth_BorderUniversal_color_43>;
type _assert_BorderUniversal_color_43 = Expect<_check_BorderUniversal_color_43>;

type Ref_BorderUniversal_color_readonly_44 = { value: string };
type Auth_BorderUniversal_color_readonly_44 = { value: string };
type _check_BorderUniversal_color_readonly_44 = IsExact<Ref_BorderUniversal_color_readonly_44, Auth_BorderUniversal_color_readonly_44>;
type _assert_BorderUniversal_color_readonly_44 = Expect<_check_BorderUniversal_color_readonly_44>;

type Ref_BorderUniversal_colorIndex_45 = () => "Auto" | "Black" | "Blue" | "Turquoise" | "BrightGreen" | "Pink" | "Red" | "Yellow" | "White" | "DarkBlue" | "Teal" | "Green" | "Violet" | "DarkRed" | "DarkYellow" | "Gray50" | "Gray25" | "ClassicRed" | "ClassicBlue" | "ByAuthor";
type Auth_BorderUniversal_colorIndex_45 = () => "Auto" | "Black" | "Blue" | "Turquoise" | "BrightGreen" | "Pink" | "Red" | "Yellow" | "White" | "DarkBlue" | "Teal" | "Green" | "Violet" | "DarkRed" | "DarkYellow" | "Gray50" | "Gray25" | "ClassicRed" | "ClassicBlue" | "ByAuthor";
type _check_BorderUniversal_colorIndex_45 = IsExact<Ref_BorderUniversal_colorIndex_45, Auth_BorderUniversal_colorIndex_45>;
type _assert_BorderUniversal_colorIndex_45 = Expect<_check_BorderUniversal_colorIndex_45>;

type Ref_BorderUniversal_colorIndex_readonly_46 = { value: "Auto" | "Black" | "Blue" | "Turquoise" | "BrightGreen" | "Pink" | "Red" | "Yellow" | "White" | "DarkBlue" | "Teal" | "Green" | "Violet" | "DarkRed" | "DarkYellow" | "Gray50" | "Gray25" | "ClassicRed" | "ClassicBlue" | "ByAuthor" };
type Auth_BorderUniversal_colorIndex_readonly_46 = { value: "Auto" | "Black" | "Blue" | "Turquoise" | "BrightGreen" | "Pink" | "Red" | "Yellow" | "White" | "DarkBlue" | "Teal" | "Green" | "Violet" | "DarkRed" | "DarkYellow" | "Gray50" | "Gray25" | "ClassicRed" | "ClassicBlue" | "ByAuthor" };
type _check_BorderUniversal_colorIndex_readonly_46 = IsExact<Ref_BorderUniversal_colorIndex_readonly_46, Auth_BorderUniversal_colorIndex_readonly_46>;
type _assert_BorderUniversal_colorIndex_readonly_46 = Expect<_check_BorderUniversal_colorIndex_readonly_46>;

type Ref_BorderUniversal_inside_47 = () => boolean;
type Auth_BorderUniversal_inside_47 = () => boolean;
type _check_BorderUniversal_inside_47 = IsExact<Ref_BorderUniversal_inside_47, Auth_BorderUniversal_inside_47>;
type _assert_BorderUniversal_inside_47 = Expect<_check_BorderUniversal_inside_47>;

type Ref_BorderUniversal_inside_readonly_48 = { readonly value: boolean };
type Auth_BorderUniversal_inside_readonly_48 = { readonly value: boolean };
type _check_BorderUniversal_inside_readonly_48 = IsExact<Ref_BorderUniversal_inside_readonly_48, Auth_BorderUniversal_inside_readonly_48>;
type _assert_BorderUniversal_inside_readonly_48 = Expect<_check_BorderUniversal_inside_readonly_48>;

type Ref_BorderUniversal_isVisible_49 = () => boolean;
type Auth_BorderUniversal_isVisible_49 = () => boolean;
type _check_BorderUniversal_isVisible_49 = IsExact<Ref_BorderUniversal_isVisible_49, Auth_BorderUniversal_isVisible_49>;
type _assert_BorderUniversal_isVisible_49 = Expect<_check_BorderUniversal_isVisible_49>;

type Ref_BorderUniversal_isVisible_readonly_50 = { value: boolean };
type Auth_BorderUniversal_isVisible_readonly_50 = { value: boolean };
type _check_BorderUniversal_isVisible_readonly_50 = IsExact<Ref_BorderUniversal_isVisible_readonly_50, Auth_BorderUniversal_isVisible_readonly_50>;
type _assert_BorderUniversal_isVisible_readonly_50 = Expect<_check_BorderUniversal_isVisible_readonly_50>;

type Ref_BorderUniversal_lineStyle_51 = () => "None" | "Single" | "Dot" | "DashSmallGap" | "DashLargeGap" | "DashDot" | "DashDotDot" | "Double" | "Triple" | "ThinThickSmallGap" | "ThickThinSmallGap" | "ThinThickThinSmallGap" | "ThinThickMedGap" | "ThickThinMedGap" | "ThinThickThinMedGap" | "ThinThickLargeGap" | "ThickThinLargeGap" | "ThinThickThinLargeGap" | "SingleWavy" | "DoubleWavy" | "DashDotStroked" | "Emboss3D" | "Engrave3D" | "Outset" | "Inset";
type Auth_BorderUniversal_lineStyle_51 = () => "None" | "Single" | "Dot" | "DashSmallGap" | "DashLargeGap" | "DashDot" | "DashDotDot" | "Double" | "Triple" | "ThinThickSmallGap" | "ThickThinSmallGap" | "ThinThickThinSmallGap" | "ThinThickMedGap" | "ThickThinMedGap" | "ThinThickThinMedGap" | "ThinThickLargeGap" | "ThickThinLargeGap" | "ThinThickThinLargeGap" | "SingleWavy" | "DoubleWavy" | "DashDotStroked" | "Emboss3D" | "Engrave3D" | "Outset" | "Inset";
type _check_BorderUniversal_lineStyle_51 = IsExact<Ref_BorderUniversal_lineStyle_51, Auth_BorderUniversal_lineStyle_51>;
type _assert_BorderUniversal_lineStyle_51 = Expect<_check_BorderUniversal_lineStyle_51>;

type Ref_BorderUniversal_lineStyle_readonly_52 = { value: "None" | "Single" | "Dot" | "DashSmallGap" | "DashLargeGap" | "DashDot" | "DashDotDot" | "Double" | "Triple" | "ThinThickSmallGap" | "ThickThinSmallGap" | "ThinThickThinSmallGap" | "ThinThickMedGap" | "ThickThinMedGap" | "ThinThickThinMedGap" | "ThinThickLargeGap" | "ThickThinLargeGap" | "ThinThickThinLargeGap" | "SingleWavy" | "DoubleWavy" | "DashDotStroked" | "Emboss3D" | "Engrave3D" | "Outset" | "Inset" };
type Auth_BorderUniversal_lineStyle_readonly_52 = { value: "None" | "Single" | "Dot" | "DashSmallGap" | "DashLargeGap" | "DashDot" | "DashDotDot" | "Double" | "Triple" | "ThinThickSmallGap" | "ThickThinSmallGap" | "ThinThickThinSmallGap" | "ThinThickMedGap" | "ThickThinMedGap" | "ThinThickThinMedGap" | "ThinThickLargeGap" | "ThickThinLargeGap" | "ThinThickThinLargeGap" | "SingleWavy" | "DoubleWavy" | "DashDotStroked" | "Emboss3D" | "Engrave3D" | "Outset" | "Inset" };
type _check_BorderUniversal_lineStyle_readonly_52 = IsExact<Ref_BorderUniversal_lineStyle_readonly_52, Auth_BorderUniversal_lineStyle_readonly_52>;
type _assert_BorderUniversal_lineStyle_readonly_52 = Expect<_check_BorderUniversal_lineStyle_readonly_52>;

type Ref_BorderUniversal_lineWidth_53 = () => "Pt025" | "Pt050" | "Pt075" | "Pt100" | "Pt150" | "Pt225" | "Pt300" | "Pt450" | "Pt600";
type Auth_BorderUniversal_lineWidth_53 = () => "Pt025" | "Pt050" | "Pt075" | "Pt100" | "Pt150" | "Pt225" | "Pt300" | "Pt450" | "Pt600";
type _check_BorderUniversal_lineWidth_53 = IsExact<Ref_BorderUniversal_lineWidth_53, Auth_BorderUniversal_lineWidth_53>;
type _assert_BorderUniversal_lineWidth_53 = Expect<_check_BorderUniversal_lineWidth_53>;

type Ref_BorderUniversal_lineWidth_readonly_54 = { value: "Pt025" | "Pt050" | "Pt075" | "Pt100" | "Pt150" | "Pt225" | "Pt300" | "Pt450" | "Pt600" };
type Auth_BorderUniversal_lineWidth_readonly_54 = { value: "Pt025" | "Pt050" | "Pt075" | "Pt100" | "Pt150" | "Pt225" | "Pt300" | "Pt450" | "Pt600" };
type _check_BorderUniversal_lineWidth_readonly_54 = IsExact<Ref_BorderUniversal_lineWidth_readonly_54, Auth_BorderUniversal_lineWidth_readonly_54>;
type _assert_BorderUniversal_lineWidth_readonly_54 = Expect<_check_BorderUniversal_lineWidth_readonly_54>;

type Ref_BorderUniversalCollection_items_55 = () => DocxEditor.BorderUniversal[];
type Auth_BorderUniversalCollection_items_55 = () => DocxEditor.BorderUniversal[];
type _check_BorderUniversalCollection_items_55 = IsExact<Ref_BorderUniversalCollection_items_55, Auth_BorderUniversalCollection_items_55>;
type _assert_BorderUniversalCollection_items_55 = Expect<_check_BorderUniversalCollection_items_55>;

type Ref_BorderUniversalCollection_items_readonly_56 = { readonly value: DocxEditor.BorderUniversal[] };
type Auth_BorderUniversalCollection_items_readonly_56 = { readonly value: DocxEditor.BorderUniversal[] };
type _check_BorderUniversalCollection_items_readonly_56 = IsExact<Ref_BorderUniversalCollection_items_readonly_56, Auth_BorderUniversalCollection_items_readonly_56>;
type _assert_BorderUniversalCollection_items_readonly_56 = Expect<_check_BorderUniversalCollection_items_readonly_56>;

type Ref_ClientObject_context_57 = () => DocxEditor.ClientRequestContext;
type Auth_ClientObject_context_57 = () => DocxEditor.ClientRequestContext;
type _check_ClientObject_context_57 = IsExact<Ref_ClientObject_context_57, Auth_ClientObject_context_57>;
type _assert_ClientObject_context_57 = Expect<_check_ClientObject_context_57>;

type Ref_ClientObject_context_readonly_58 = { value: DocxEditor.ClientRequestContext };
type Auth_ClientObject_context_readonly_58 = { value: DocxEditor.ClientRequestContext };
type _check_ClientObject_context_readonly_58 = IsExact<Ref_ClientObject_context_readonly_58, Auth_ClientObject_context_readonly_58>;
type _assert_ClientObject_context_readonly_58 = Expect<_check_ClientObject_context_readonly_58>;

type Ref_ClientObject_isNullObject_59 = () => boolean;
type Auth_ClientObject_isNullObject_59 = () => boolean;
type _check_ClientObject_isNullObject_59 = IsExact<Ref_ClientObject_isNullObject_59, Auth_ClientObject_isNullObject_59>;
type _assert_ClientObject_isNullObject_59 = Expect<_check_ClientObject_isNullObject_59>;

type Ref_ClientObject_isNullObject_readonly_60 = { value: boolean };
type Auth_ClientObject_isNullObject_readonly_60 = { value: boolean };
type _check_ClientObject_isNullObject_readonly_60 = IsExact<Ref_ClientObject_isNullObject_readonly_60, Auth_ClientObject_isNullObject_readonly_60>;
type _assert_ClientObject_isNullObject_readonly_60 = Expect<_check_ClientObject_isNullObject_readonly_60>;

type Ref_Comment_authorName_61 = () => string;
type Auth_Comment_authorName_61 = () => string;
type _check_Comment_authorName_61 = IsExact<Ref_Comment_authorName_61, Auth_Comment_authorName_61>;
type _assert_Comment_authorName_61 = Expect<_check_Comment_authorName_61>;

type Ref_Comment_authorName_readonly_62 = { readonly value: string };
type Auth_Comment_authorName_readonly_62 = { readonly value: string };
type _check_Comment_authorName_readonly_62 = IsExact<Ref_Comment_authorName_readonly_62, Auth_Comment_authorName_readonly_62>;
type _assert_Comment_authorName_readonly_62 = Expect<_check_Comment_authorName_readonly_62>;

type Ref_Comment_content_63 = () => string;
type Auth_Comment_content_63 = () => string;
type _check_Comment_content_63 = IsExact<Ref_Comment_content_63, Auth_Comment_content_63>;
type _assert_Comment_content_63 = Expect<_check_Comment_content_63>;

type Ref_Comment_content_readonly_64 = { value: string };
type Auth_Comment_content_readonly_64 = { value: string };
type _check_Comment_content_readonly_64 = IsExact<Ref_Comment_content_readonly_64, Auth_Comment_content_readonly_64>;
type _assert_Comment_content_readonly_64 = Expect<_check_Comment_content_readonly_64>;

type Ref_Comment_creationDate_65 = () => Date;
type Auth_Comment_creationDate_65 = () => Date;
type _check_Comment_creationDate_65 = IsExact<Ref_Comment_creationDate_65, Auth_Comment_creationDate_65>;
type _assert_Comment_creationDate_65 = Expect<_check_Comment_creationDate_65>;

type Ref_Comment_creationDate_readonly_66 = { readonly value: Date };
type Auth_Comment_creationDate_readonly_66 = { readonly value: Date };
type _check_Comment_creationDate_readonly_66 = IsExact<Ref_Comment_creationDate_readonly_66, Auth_Comment_creationDate_readonly_66>;
type _assert_Comment_creationDate_readonly_66 = Expect<_check_Comment_creationDate_readonly_66>;

type Ref_Comment_delete_67 = () => void;
type Auth_Comment_delete_67 = () => void;
type _check_Comment_delete_67 = IsExact<Ref_Comment_delete_67, Auth_Comment_delete_67>;
type _assert_Comment_delete_67 = Expect<_check_Comment_delete_67>;

type Ref_Comment_getRange_68 = () => DocxEditor.Range;
type Auth_Comment_getRange_68 = () => DocxEditor.Range;
type _check_Comment_getRange_68 = IsExact<Ref_Comment_getRange_68, Auth_Comment_getRange_68>;
type _assert_Comment_getRange_68 = Expect<_check_Comment_getRange_68>;

type Ref_Comment_id_69 = () => string;
type Auth_Comment_id_69 = () => string;
type _check_Comment_id_69 = IsExact<Ref_Comment_id_69, Auth_Comment_id_69>;
type _assert_Comment_id_69 = Expect<_check_Comment_id_69>;

type Ref_Comment_id_readonly_70 = { readonly value: string };
type Auth_Comment_id_readonly_70 = { readonly value: string };
type _check_Comment_id_readonly_70 = IsExact<Ref_Comment_id_readonly_70, Auth_Comment_id_readonly_70>;
type _assert_Comment_id_readonly_70 = Expect<_check_Comment_id_readonly_70>;

type Ref_Comment_replies_71 = () => DocxEditor.CommentReplyCollection;
type Auth_Comment_replies_71 = () => DocxEditor.CommentReplyCollection;
type _check_Comment_replies_71 = IsExact<Ref_Comment_replies_71, Auth_Comment_replies_71>;
type _assert_Comment_replies_71 = Expect<_check_Comment_replies_71>;

type Ref_Comment_replies_readonly_72 = { readonly value: DocxEditor.CommentReplyCollection };
type Auth_Comment_replies_readonly_72 = { readonly value: DocxEditor.CommentReplyCollection };
type _check_Comment_replies_readonly_72 = IsExact<Ref_Comment_replies_readonly_72, Auth_Comment_replies_readonly_72>;
type _assert_Comment_replies_readonly_72 = Expect<_check_Comment_replies_readonly_72>;

type Ref_Comment_reply_73 = (replyText: string) => DocxEditor.CommentReply;
type Auth_Comment_reply_73 = (replyText: string) => DocxEditor.CommentReply;
type _check_Comment_reply_73 = IsExact<Ref_Comment_reply_73, Auth_Comment_reply_73>;
type _assert_Comment_reply_73 = Expect<_check_Comment_reply_73>;

type Ref_Comment_resolved_74 = () => boolean;
type Auth_Comment_resolved_74 = () => boolean;
type _check_Comment_resolved_74 = IsExact<Ref_Comment_resolved_74, Auth_Comment_resolved_74>;
type _assert_Comment_resolved_74 = Expect<_check_Comment_resolved_74>;

type Ref_Comment_resolved_readonly_75 = { value: boolean };
type Auth_Comment_resolved_readonly_75 = { value: boolean };
type _check_Comment_resolved_readonly_75 = IsExact<Ref_Comment_resolved_readonly_75, Auth_Comment_resolved_readonly_75>;
type _assert_Comment_resolved_readonly_75 = Expect<_check_Comment_resolved_readonly_75>;

type Ref_CommentCollection_getFirst_76 = () => DocxEditor.Comment;
type Auth_CommentCollection_getFirst_76 = () => DocxEditor.Comment;
type _check_CommentCollection_getFirst_76 = IsExact<Ref_CommentCollection_getFirst_76, Auth_CommentCollection_getFirst_76>;
type _assert_CommentCollection_getFirst_76 = Expect<_check_CommentCollection_getFirst_76>;

type Ref_CommentCollection_items_77 = () => DocxEditor.Comment[];
type Auth_CommentCollection_items_77 = () => DocxEditor.Comment[];
type _check_CommentCollection_items_77 = IsExact<Ref_CommentCollection_items_77, Auth_CommentCollection_items_77>;
type _assert_CommentCollection_items_77 = Expect<_check_CommentCollection_items_77>;

type Ref_CommentCollection_items_readonly_78 = { readonly value: DocxEditor.Comment[] };
type Auth_CommentCollection_items_readonly_78 = { readonly value: DocxEditor.Comment[] };
type _check_CommentCollection_items_readonly_78 = IsExact<Ref_CommentCollection_items_readonly_78, Auth_CommentCollection_items_readonly_78>;
type _assert_CommentCollection_items_readonly_78 = Expect<_check_CommentCollection_items_readonly_78>;

type Ref_CommentReply_authorName_79 = () => string;
type Auth_CommentReply_authorName_79 = () => string;
type _check_CommentReply_authorName_79 = IsExact<Ref_CommentReply_authorName_79, Auth_CommentReply_authorName_79>;
type _assert_CommentReply_authorName_79 = Expect<_check_CommentReply_authorName_79>;

type Ref_CommentReply_authorName_readonly_80 = { readonly value: string };
type Auth_CommentReply_authorName_readonly_80 = { readonly value: string };
type _check_CommentReply_authorName_readonly_80 = IsExact<Ref_CommentReply_authorName_readonly_80, Auth_CommentReply_authorName_readonly_80>;
type _assert_CommentReply_authorName_readonly_80 = Expect<_check_CommentReply_authorName_readonly_80>;

type Ref_CommentReply_content_81 = () => string;
type Auth_CommentReply_content_81 = () => string;
type _check_CommentReply_content_81 = IsExact<Ref_CommentReply_content_81, Auth_CommentReply_content_81>;
type _assert_CommentReply_content_81 = Expect<_check_CommentReply_content_81>;

type Ref_CommentReply_content_readonly_82 = { value: string };
type Auth_CommentReply_content_readonly_82 = { value: string };
type _check_CommentReply_content_readonly_82 = IsExact<Ref_CommentReply_content_readonly_82, Auth_CommentReply_content_readonly_82>;
type _assert_CommentReply_content_readonly_82 = Expect<_check_CommentReply_content_readonly_82>;

type Ref_CommentReply_creationDate_83 = () => Date;
type Auth_CommentReply_creationDate_83 = () => Date;
type _check_CommentReply_creationDate_83 = IsExact<Ref_CommentReply_creationDate_83, Auth_CommentReply_creationDate_83>;
type _assert_CommentReply_creationDate_83 = Expect<_check_CommentReply_creationDate_83>;

type Ref_CommentReply_creationDate_readonly_84 = { readonly value: Date };
type Auth_CommentReply_creationDate_readonly_84 = { readonly value: Date };
type _check_CommentReply_creationDate_readonly_84 = IsExact<Ref_CommentReply_creationDate_readonly_84, Auth_CommentReply_creationDate_readonly_84>;
type _assert_CommentReply_creationDate_readonly_84 = Expect<_check_CommentReply_creationDate_readonly_84>;

type Ref_CommentReply_delete_85 = () => void;
type Auth_CommentReply_delete_85 = () => void;
type _check_CommentReply_delete_85 = IsExact<Ref_CommentReply_delete_85, Auth_CommentReply_delete_85>;
type _assert_CommentReply_delete_85 = Expect<_check_CommentReply_delete_85>;

type Ref_CommentReply_id_86 = () => string;
type Auth_CommentReply_id_86 = () => string;
type _check_CommentReply_id_86 = IsExact<Ref_CommentReply_id_86, Auth_CommentReply_id_86>;
type _assert_CommentReply_id_86 = Expect<_check_CommentReply_id_86>;

type Ref_CommentReply_id_readonly_87 = { readonly value: string };
type Auth_CommentReply_id_readonly_87 = { readonly value: string };
type _check_CommentReply_id_readonly_87 = IsExact<Ref_CommentReply_id_readonly_87, Auth_CommentReply_id_readonly_87>;
type _assert_CommentReply_id_readonly_87 = Expect<_check_CommentReply_id_readonly_87>;

type Ref_CommentReplyCollection_getFirst_88 = () => DocxEditor.CommentReply;
type Auth_CommentReplyCollection_getFirst_88 = () => DocxEditor.CommentReply;
type _check_CommentReplyCollection_getFirst_88 = IsExact<Ref_CommentReplyCollection_getFirst_88, Auth_CommentReplyCollection_getFirst_88>;
type _assert_CommentReplyCollection_getFirst_88 = Expect<_check_CommentReplyCollection_getFirst_88>;

type Ref_CommentReplyCollection_items_89 = () => DocxEditor.CommentReply[];
type Auth_CommentReplyCollection_items_89 = () => DocxEditor.CommentReply[];
type _check_CommentReplyCollection_items_89 = IsExact<Ref_CommentReplyCollection_items_89, Auth_CommentReplyCollection_items_89>;
type _assert_CommentReplyCollection_items_89 = Expect<_check_CommentReplyCollection_items_89>;

type Ref_CommentReplyCollection_items_readonly_90 = { readonly value: DocxEditor.CommentReply[] };
type Auth_CommentReplyCollection_items_readonly_90 = { readonly value: DocxEditor.CommentReply[] };
type _check_CommentReplyCollection_items_readonly_90 = IsExact<Ref_CommentReplyCollection_items_readonly_90, Auth_CommentReplyCollection_items_readonly_90>;
type _assert_CommentReplyCollection_items_readonly_90 = Expect<_check_CommentReplyCollection_items_readonly_90>;

type Ref_ContentControl_cannotDelete_91 = () => boolean;
type Auth_ContentControl_cannotDelete_91 = () => boolean;
type _check_ContentControl_cannotDelete_91 = IsExact<Ref_ContentControl_cannotDelete_91, Auth_ContentControl_cannotDelete_91>;
type _assert_ContentControl_cannotDelete_91 = Expect<_check_ContentControl_cannotDelete_91>;

type Ref_ContentControl_cannotDelete_readonly_92 = { value: boolean };
type Auth_ContentControl_cannotDelete_readonly_92 = { value: boolean };
type _check_ContentControl_cannotDelete_readonly_92 = IsExact<Ref_ContentControl_cannotDelete_readonly_92, Auth_ContentControl_cannotDelete_readonly_92>;
type _assert_ContentControl_cannotDelete_readonly_92 = Expect<_check_ContentControl_cannotDelete_readonly_92>;

type Ref_ContentControl_cannotEdit_93 = () => boolean;
type Auth_ContentControl_cannotEdit_93 = () => boolean;
type _check_ContentControl_cannotEdit_93 = IsExact<Ref_ContentControl_cannotEdit_93, Auth_ContentControl_cannotEdit_93>;
type _assert_ContentControl_cannotEdit_93 = Expect<_check_ContentControl_cannotEdit_93>;

type Ref_ContentControl_cannotEdit_readonly_94 = { value: boolean };
type Auth_ContentControl_cannotEdit_readonly_94 = { value: boolean };
type _check_ContentControl_cannotEdit_readonly_94 = IsExact<Ref_ContentControl_cannotEdit_readonly_94, Auth_ContentControl_cannotEdit_readonly_94>;
type _assert_ContentControl_cannotEdit_readonly_94 = Expect<_check_ContentControl_cannotEdit_readonly_94>;

type Ref_ContentControl_contentControls_95 = () => DocxEditor.ContentControlCollection;
type Auth_ContentControl_contentControls_95 = () => DocxEditor.ContentControlCollection;
type _check_ContentControl_contentControls_95 = IsExact<Ref_ContentControl_contentControls_95, Auth_ContentControl_contentControls_95>;
type _assert_ContentControl_contentControls_95 = Expect<_check_ContentControl_contentControls_95>;

type Ref_ContentControl_contentControls_readonly_96 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_ContentControl_contentControls_readonly_96 = { readonly value: DocxEditor.ContentControlCollection };
type _check_ContentControl_contentControls_readonly_96 = IsExact<Ref_ContentControl_contentControls_readonly_96, Auth_ContentControl_contentControls_readonly_96>;
type _assert_ContentControl_contentControls_readonly_96 = Expect<_check_ContentControl_contentControls_readonly_96>;

type Ref_ContentControl_delete_97 = (keepContent: boolean) => void;
type Auth_ContentControl_delete_97 = (keepContent: boolean) => void;
type _check_ContentControl_delete_97 = IsExact<Ref_ContentControl_delete_97, Auth_ContentControl_delete_97>;
type _assert_ContentControl_delete_97 = Expect<_check_ContentControl_delete_97>;

type Ref_ContentControl_getRange_98 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type Auth_ContentControl_getRange_98 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type _check_ContentControl_getRange_98 = IsExact<Ref_ContentControl_getRange_98, Auth_ContentControl_getRange_98>;
type _assert_ContentControl_getRange_98 = Expect<_check_ContentControl_getRange_98>;

type Ref_ContentControl_insertText_99 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_ContentControl_insertText_99 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_ContentControl_insertText_99 = IsExact<Ref_ContentControl_insertText_99, Auth_ContentControl_insertText_99>;
type _assert_ContentControl_insertText_99 = Expect<_check_ContentControl_insertText_99>;

type Ref_ContentControl_paragraphs_100 = () => DocxEditor.ParagraphCollection;
type Auth_ContentControl_paragraphs_100 = () => DocxEditor.ParagraphCollection;
type _check_ContentControl_paragraphs_100 = IsExact<Ref_ContentControl_paragraphs_100, Auth_ContentControl_paragraphs_100>;
type _assert_ContentControl_paragraphs_100 = Expect<_check_ContentControl_paragraphs_100>;

type Ref_ContentControl_paragraphs_readonly_101 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_ContentControl_paragraphs_readonly_101 = { readonly value: DocxEditor.ParagraphCollection };
type _check_ContentControl_paragraphs_readonly_101 = IsExact<Ref_ContentControl_paragraphs_readonly_101, Auth_ContentControl_paragraphs_readonly_101>;
type _assert_ContentControl_paragraphs_readonly_101 = Expect<_check_ContentControl_paragraphs_readonly_101>;

type Ref_ContentControl_tag_102 = () => string;
type Auth_ContentControl_tag_102 = () => string;
type _check_ContentControl_tag_102 = IsExact<Ref_ContentControl_tag_102, Auth_ContentControl_tag_102>;
type _assert_ContentControl_tag_102 = Expect<_check_ContentControl_tag_102>;

type Ref_ContentControl_tag_readonly_103 = { value: string };
type Auth_ContentControl_tag_readonly_103 = { value: string };
type _check_ContentControl_tag_readonly_103 = IsExact<Ref_ContentControl_tag_readonly_103, Auth_ContentControl_tag_readonly_103>;
type _assert_ContentControl_tag_readonly_103 = Expect<_check_ContentControl_tag_readonly_103>;

type Ref_ContentControl_text_104 = () => string;
type Auth_ContentControl_text_104 = () => string;
type _check_ContentControl_text_104 = IsExact<Ref_ContentControl_text_104, Auth_ContentControl_text_104>;
type _assert_ContentControl_text_104 = Expect<_check_ContentControl_text_104>;

type Ref_ContentControl_text_readonly_105 = { readonly value: string };
type Auth_ContentControl_text_readonly_105 = { readonly value: string };
type _check_ContentControl_text_readonly_105 = IsExact<Ref_ContentControl_text_readonly_105, Auth_ContentControl_text_readonly_105>;
type _assert_ContentControl_text_readonly_105 = Expect<_check_ContentControl_text_readonly_105>;

type Ref_ContentControl_title_106 = () => string;
type Auth_ContentControl_title_106 = () => string;
type _check_ContentControl_title_106 = IsExact<Ref_ContentControl_title_106, Auth_ContentControl_title_106>;
type _assert_ContentControl_title_106 = Expect<_check_ContentControl_title_106>;

type Ref_ContentControl_title_readonly_107 = { value: string };
type Auth_ContentControl_title_readonly_107 = { value: string };
type _check_ContentControl_title_readonly_107 = IsExact<Ref_ContentControl_title_readonly_107, Auth_ContentControl_title_readonly_107>;
type _assert_ContentControl_title_readonly_107 = Expect<_check_ContentControl_title_readonly_107>;

type Ref_ContentControlCollection_getById_108 = (id: number) => DocxEditor.ContentControl;
type Auth_ContentControlCollection_getById_108 = (id: number) => DocxEditor.ContentControl;
type _check_ContentControlCollection_getById_108 = IsExact<Ref_ContentControlCollection_getById_108, Auth_ContentControlCollection_getById_108>;
type _assert_ContentControlCollection_getById_108 = Expect<_check_ContentControlCollection_getById_108>;

type Ref_ContentControlCollection_items_109 = () => DocxEditor.ContentControl[];
type Auth_ContentControlCollection_items_109 = () => DocxEditor.ContentControl[];
type _check_ContentControlCollection_items_109 = IsExact<Ref_ContentControlCollection_items_109, Auth_ContentControlCollection_items_109>;
type _assert_ContentControlCollection_items_109 = Expect<_check_ContentControlCollection_items_109>;

type Ref_ContentControlCollection_items_readonly_110 = { readonly value: DocxEditor.ContentControl[] };
type Auth_ContentControlCollection_items_readonly_110 = { readonly value: DocxEditor.ContentControl[] };
type _check_ContentControlCollection_items_readonly_110 = IsExact<Ref_ContentControlCollection_items_readonly_110, Auth_ContentControlCollection_items_readonly_110>;
type _assert_ContentControlCollection_items_readonly_110 = Expect<_check_ContentControlCollection_items_readonly_110>;

type Ref_Critique_colorScheme_111 = () => "Red" | "Green" | "Blue" | "Lavender" | "Berry";
type Auth_Critique_colorScheme_111 = () => "Red" | "Green" | "Blue" | "Lavender" | "Berry";
type _check_Critique_colorScheme_111 = IsExact<Ref_Critique_colorScheme_111, Auth_Critique_colorScheme_111>;
type _assert_Critique_colorScheme_111 = Expect<_check_Critique_colorScheme_111>;

type Ref_Critique_colorScheme_readonly_112 = { value: "Red" | "Green" | "Blue" | "Lavender" | "Berry" };
type Auth_Critique_colorScheme_readonly_112 = { value: "Red" | "Green" | "Blue" | "Lavender" | "Berry" };
type _check_Critique_colorScheme_readonly_112 = IsExact<Ref_Critique_colorScheme_readonly_112, Auth_Critique_colorScheme_readonly_112>;
type _assert_Critique_colorScheme_readonly_112 = Expect<_check_Critique_colorScheme_readonly_112>;

type Ref_Critique_length_113 = () => number;
type Auth_Critique_length_113 = () => number;
type _check_Critique_length_113 = IsExact<Ref_Critique_length_113, Auth_Critique_length_113>;
type _assert_Critique_length_113 = Expect<_check_Critique_length_113>;

type Ref_Critique_length_readonly_114 = { value: number };
type Auth_Critique_length_readonly_114 = { value: number };
type _check_Critique_length_readonly_114 = IsExact<Ref_Critique_length_readonly_114, Auth_Critique_length_readonly_114>;
type _assert_Critique_length_readonly_114 = Expect<_check_Critique_length_readonly_114>;

type Ref_Critique_popupOptions_115 = () => DocxEditor.CritiquePopupOptions;
type Auth_Critique_popupOptions_115 = () => DocxEditor.CritiquePopupOptions;
type _check_Critique_popupOptions_115 = IsExact<Ref_Critique_popupOptions_115, Auth_Critique_popupOptions_115>;
type _assert_Critique_popupOptions_115 = Expect<_check_Critique_popupOptions_115>;

type Ref_Critique_popupOptions_readonly_116 = { value: DocxEditor.CritiquePopupOptions };
type Auth_Critique_popupOptions_readonly_116 = { value: DocxEditor.CritiquePopupOptions };
type _check_Critique_popupOptions_readonly_116 = IsExact<Ref_Critique_popupOptions_readonly_116, Auth_Critique_popupOptions_readonly_116>;
type _assert_Critique_popupOptions_readonly_116 = Expect<_check_Critique_popupOptions_readonly_116>;

type Ref_Critique_start_117 = () => number;
type Auth_Critique_start_117 = () => number;
type _check_Critique_start_117 = IsExact<Ref_Critique_start_117, Auth_Critique_start_117>;
type _assert_Critique_start_117 = Expect<_check_Critique_start_117>;

type Ref_Critique_start_readonly_118 = { value: number };
type Auth_Critique_start_readonly_118 = { value: number };
type _check_Critique_start_readonly_118 = IsExact<Ref_Critique_start_readonly_118, Auth_Critique_start_readonly_118>;
type _assert_Critique_start_readonly_118 = Expect<_check_Critique_start_readonly_118>;

type Ref_CritiqueAnnotation_accept_119 = () => void;
type Auth_CritiqueAnnotation_accept_119 = () => void;
type _check_CritiqueAnnotation_accept_119 = IsExact<Ref_CritiqueAnnotation_accept_119, Auth_CritiqueAnnotation_accept_119>;
type _assert_CritiqueAnnotation_accept_119 = Expect<_check_CritiqueAnnotation_accept_119>;

type Ref_CritiqueAnnotation_critique_120 = () => DocxEditor.Critique;
type Auth_CritiqueAnnotation_critique_120 = () => DocxEditor.Critique;
type _check_CritiqueAnnotation_critique_120 = IsExact<Ref_CritiqueAnnotation_critique_120, Auth_CritiqueAnnotation_critique_120>;
type _assert_CritiqueAnnotation_critique_120 = Expect<_check_CritiqueAnnotation_critique_120>;

type Ref_CritiqueAnnotation_critique_readonly_121 = { readonly value: DocxEditor.Critique };
type Auth_CritiqueAnnotation_critique_readonly_121 = { readonly value: DocxEditor.Critique };
type _check_CritiqueAnnotation_critique_readonly_121 = IsExact<Ref_CritiqueAnnotation_critique_readonly_121, Auth_CritiqueAnnotation_critique_readonly_121>;
type _assert_CritiqueAnnotation_critique_readonly_121 = Expect<_check_CritiqueAnnotation_critique_readonly_121>;

type Ref_CritiqueAnnotation_range_122 = () => DocxEditor.Range;
type Auth_CritiqueAnnotation_range_122 = () => DocxEditor.Range;
type _check_CritiqueAnnotation_range_122 = IsExact<Ref_CritiqueAnnotation_range_122, Auth_CritiqueAnnotation_range_122>;
type _assert_CritiqueAnnotation_range_122 = Expect<_check_CritiqueAnnotation_range_122>;

type Ref_CritiqueAnnotation_range_readonly_123 = { readonly value: DocxEditor.Range };
type Auth_CritiqueAnnotation_range_readonly_123 = { readonly value: DocxEditor.Range };
type _check_CritiqueAnnotation_range_readonly_123 = IsExact<Ref_CritiqueAnnotation_range_readonly_123, Auth_CritiqueAnnotation_range_readonly_123>;
type _assert_CritiqueAnnotation_range_readonly_123 = Expect<_check_CritiqueAnnotation_range_readonly_123>;

type Ref_CritiqueAnnotation_reject_124 = () => void;
type Auth_CritiqueAnnotation_reject_124 = () => void;
type _check_CritiqueAnnotation_reject_124 = IsExact<Ref_CritiqueAnnotation_reject_124, Auth_CritiqueAnnotation_reject_124>;
type _assert_CritiqueAnnotation_reject_124 = Expect<_check_CritiqueAnnotation_reject_124>;

type Ref_CritiquePopupOptions_brandingTextResourceId_125 = () => string;
type Auth_CritiquePopupOptions_brandingTextResourceId_125 = () => string;
type _check_CritiquePopupOptions_brandingTextResourceId_125 = IsExact<Ref_CritiquePopupOptions_brandingTextResourceId_125, Auth_CritiquePopupOptions_brandingTextResourceId_125>;
type _assert_CritiquePopupOptions_brandingTextResourceId_125 = Expect<_check_CritiquePopupOptions_brandingTextResourceId_125>;

type Ref_CritiquePopupOptions_brandingTextResourceId_readonly_126 = { value: string };
type Auth_CritiquePopupOptions_brandingTextResourceId_readonly_126 = { value: string };
type _check_CritiquePopupOptions_brandingTextResourceId_readonly_126 = IsExact<Ref_CritiquePopupOptions_brandingTextResourceId_readonly_126, Auth_CritiquePopupOptions_brandingTextResourceId_readonly_126>;
type _assert_CritiquePopupOptions_brandingTextResourceId_readonly_126 = Expect<_check_CritiquePopupOptions_brandingTextResourceId_readonly_126>;

type Ref_CritiquePopupOptions_subtitleResourceId_127 = () => string;
type Auth_CritiquePopupOptions_subtitleResourceId_127 = () => string;
type _check_CritiquePopupOptions_subtitleResourceId_127 = IsExact<Ref_CritiquePopupOptions_subtitleResourceId_127, Auth_CritiquePopupOptions_subtitleResourceId_127>;
type _assert_CritiquePopupOptions_subtitleResourceId_127 = Expect<_check_CritiquePopupOptions_subtitleResourceId_127>;

type Ref_CritiquePopupOptions_subtitleResourceId_readonly_128 = { value: string };
type Auth_CritiquePopupOptions_subtitleResourceId_readonly_128 = { value: string };
type _check_CritiquePopupOptions_subtitleResourceId_readonly_128 = IsExact<Ref_CritiquePopupOptions_subtitleResourceId_readonly_128, Auth_CritiquePopupOptions_subtitleResourceId_readonly_128>;
type _assert_CritiquePopupOptions_subtitleResourceId_readonly_128 = Expect<_check_CritiquePopupOptions_subtitleResourceId_readonly_128>;

type Ref_CritiquePopupOptions_suggestions_129 = () => string[];
type Auth_CritiquePopupOptions_suggestions_129 = () => string[];
type _check_CritiquePopupOptions_suggestions_129 = IsExact<Ref_CritiquePopupOptions_suggestions_129, Auth_CritiquePopupOptions_suggestions_129>;
type _assert_CritiquePopupOptions_suggestions_129 = Expect<_check_CritiquePopupOptions_suggestions_129>;

type Ref_CritiquePopupOptions_suggestions_readonly_130 = { value: string[] };
type Auth_CritiquePopupOptions_suggestions_readonly_130 = { value: string[] };
type _check_CritiquePopupOptions_suggestions_readonly_130 = IsExact<Ref_CritiquePopupOptions_suggestions_readonly_130, Auth_CritiquePopupOptions_suggestions_readonly_130>;
type _assert_CritiquePopupOptions_suggestions_readonly_130 = Expect<_check_CritiquePopupOptions_suggestions_readonly_130>;

type Ref_CritiquePopupOptions_titleResourceId_131 = () => string;
type Auth_CritiquePopupOptions_titleResourceId_131 = () => string;
type _check_CritiquePopupOptions_titleResourceId_131 = IsExact<Ref_CritiquePopupOptions_titleResourceId_131, Auth_CritiquePopupOptions_titleResourceId_131>;
type _assert_CritiquePopupOptions_titleResourceId_131 = Expect<_check_CritiquePopupOptions_titleResourceId_131>;

type Ref_CritiquePopupOptions_titleResourceId_readonly_132 = { value: string };
type Auth_CritiquePopupOptions_titleResourceId_readonly_132 = { value: string };
type _check_CritiquePopupOptions_titleResourceId_readonly_132 = IsExact<Ref_CritiquePopupOptions_titleResourceId_readonly_132, Auth_CritiquePopupOptions_titleResourceId_readonly_132>;
type _assert_CritiquePopupOptions_titleResourceId_readonly_132 = Expect<_check_CritiquePopupOptions_titleResourceId_readonly_132>;

type Ref_Document_body_133 = () => DocxEditor.Body;
type Auth_Document_body_133 = () => DocxEditor.Body;
type _check_Document_body_133 = IsExact<Ref_Document_body_133, Auth_Document_body_133>;
type _assert_Document_body_133 = Expect<_check_Document_body_133>;

type Ref_Document_body_readonly_134 = { readonly value: DocxEditor.Body };
type Auth_Document_body_readonly_134 = { readonly value: DocxEditor.Body };
type _check_Document_body_readonly_134 = IsExact<Ref_Document_body_readonly_134, Auth_Document_body_readonly_134>;
type _assert_Document_body_readonly_134 = Expect<_check_Document_body_readonly_134>;

type Ref_Document_changeTrackingMode_135 = () => "Off" | "TrackAll" | "TrackMineOnly";
type Auth_Document_changeTrackingMode_135 = () => "Off" | "TrackAll" | "TrackMineOnly";
type _check_Document_changeTrackingMode_135 = IsExact<Ref_Document_changeTrackingMode_135, Auth_Document_changeTrackingMode_135>;
type _assert_Document_changeTrackingMode_135 = Expect<_check_Document_changeTrackingMode_135>;

type Ref_Document_changeTrackingMode_readonly_136 = { value: "Off" | "TrackAll" | "TrackMineOnly" };
type Auth_Document_changeTrackingMode_readonly_136 = { value: "Off" | "TrackAll" | "TrackMineOnly" };
type _check_Document_changeTrackingMode_readonly_136 = IsExact<Ref_Document_changeTrackingMode_readonly_136, Auth_Document_changeTrackingMode_readonly_136>;
type _assert_Document_changeTrackingMode_readonly_136 = Expect<_check_Document_changeTrackingMode_readonly_136>;

type Ref_Document_comments_137 = () => DocxEditor.CommentCollection;
type Auth_Document_comments_137 = () => DocxEditor.CommentCollection;
type _check_Document_comments_137 = IsExact<Ref_Document_comments_137, Auth_Document_comments_137>;
type _assert_Document_comments_137 = Expect<_check_Document_comments_137>;

type Ref_Document_comments_readonly_138 = { readonly value: DocxEditor.CommentCollection };
type Auth_Document_comments_readonly_138 = { readonly value: DocxEditor.CommentCollection };
type _check_Document_comments_readonly_138 = IsExact<Ref_Document_comments_readonly_138, Auth_Document_comments_readonly_138>;
type _assert_Document_comments_readonly_138 = Expect<_check_Document_comments_readonly_138>;

type Ref_Document_compare_139 = (filePath: string, documentCompareOptions?: DocxEditor.DocumentCompareOptions) => void;
type Auth_Document_compare_139 = (filePath: string, documentCompareOptions?: DocxEditor.DocumentCompareOptions) => void;
type _check_Document_compare_139 = IsExact<Ref_Document_compare_139, Auth_Document_compare_139>;
type _assert_Document_compare_139 = Expect<_check_Document_compare_139>;

type Ref_Document_compareFromBase64_140 = (base64File: string, documentCompareOptions?: DocxEditor.DocumentCompareOptions) => void;
type Auth_Document_compareFromBase64_140 = (base64File: string, documentCompareOptions?: DocxEditor.DocumentCompareOptions) => void;
type _check_Document_compareFromBase64_140 = IsExact<Ref_Document_compareFromBase64_140, Auth_Document_compareFromBase64_140>;
type _assert_Document_compareFromBase64_140 = Expect<_check_Document_compareFromBase64_140>;

type Ref_Document_contentControls_141 = () => DocxEditor.ContentControlCollection;
type Auth_Document_contentControls_141 = () => DocxEditor.ContentControlCollection;
type _check_Document_contentControls_141 = IsExact<Ref_Document_contentControls_141, Auth_Document_contentControls_141>;
type _assert_Document_contentControls_141 = Expect<_check_Document_contentControls_141>;

type Ref_Document_contentControls_readonly_142 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Document_contentControls_readonly_142 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Document_contentControls_readonly_142 = IsExact<Ref_Document_contentControls_readonly_142, Auth_Document_contentControls_readonly_142>;
type _assert_Document_contentControls_readonly_142 = Expect<_check_Document_contentControls_readonly_142>;

type Ref_Document_deleteBookmark_143 = (name: string) => void;
type Auth_Document_deleteBookmark_143 = (name: string) => void;
type _check_Document_deleteBookmark_143 = IsExact<Ref_Document_deleteBookmark_143, Auth_Document_deleteBookmark_143>;
type _assert_Document_deleteBookmark_143 = Expect<_check_Document_deleteBookmark_143>;

type Ref_Document_getAnnotationById_144 = (id: string) => DocxEditor.Annotation;
type Auth_Document_getAnnotationById_144 = (id: string) => DocxEditor.Annotation;
type _check_Document_getAnnotationById_144 = IsExact<Ref_Document_getAnnotationById_144, Auth_Document_getAnnotationById_144>;
type _assert_Document_getAnnotationById_144 = Expect<_check_Document_getAnnotationById_144>;

type Ref_Document_getBookmarkRange_145 = (name: string) => DocxEditor.Range;
type Auth_Document_getBookmarkRange_145 = (name: string) => DocxEditor.Range;
type _check_Document_getBookmarkRange_145 = IsExact<Ref_Document_getBookmarkRange_145, Auth_Document_getBookmarkRange_145>;
type _assert_Document_getBookmarkRange_145 = Expect<_check_Document_getBookmarkRange_145>;

type Ref_Document_getBookmarkRangeOrNullObject_146 = (name: string) => DocxEditor.Range;
type Auth_Document_getBookmarkRangeOrNullObject_146 = (name: string) => DocxEditor.Range;
type _check_Document_getBookmarkRangeOrNullObject_146 = IsExact<Ref_Document_getBookmarkRangeOrNullObject_146, Auth_Document_getBookmarkRangeOrNullObject_146>;
type _assert_Document_getBookmarkRangeOrNullObject_146 = Expect<_check_Document_getBookmarkRangeOrNullObject_146>;

type Ref_Document_getStyles_147 = () => DocxEditor.StyleCollection;
type Auth_Document_getStyles_147 = () => DocxEditor.StyleCollection;
type _check_Document_getStyles_147 = IsExact<Ref_Document_getStyles_147, Auth_Document_getStyles_147>;
type _assert_Document_getStyles_147 = Expect<_check_Document_getStyles_147>;

type Ref_Document_paragraphs_148 = () => DocxEditor.ParagraphCollection;
type Auth_Document_paragraphs_148 = () => DocxEditor.ParagraphCollection;
type _check_Document_paragraphs_148 = IsExact<Ref_Document_paragraphs_148, Auth_Document_paragraphs_148>;
type _assert_Document_paragraphs_148 = Expect<_check_Document_paragraphs_148>;

type Ref_Document_paragraphs_readonly_149 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Document_paragraphs_readonly_149 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Document_paragraphs_readonly_149 = IsExact<Ref_Document_paragraphs_readonly_149, Auth_Document_paragraphs_readonly_149>;
type _assert_Document_paragraphs_readonly_149 = Expect<_check_Document_paragraphs_readonly_149>;

type Ref_Document_properties_150 = () => DocxEditor.DocumentProperties;
type Auth_Document_properties_150 = () => DocxEditor.DocumentProperties;
type _check_Document_properties_150 = IsExact<Ref_Document_properties_150, Auth_Document_properties_150>;
type _assert_Document_properties_150 = Expect<_check_Document_properties_150>;

type Ref_Document_properties_readonly_151 = { readonly value: DocxEditor.DocumentProperties };
type Auth_Document_properties_readonly_151 = { readonly value: DocxEditor.DocumentProperties };
type _check_Document_properties_readonly_151 = IsExact<Ref_Document_properties_readonly_151, Auth_Document_properties_readonly_151>;
type _assert_Document_properties_readonly_151 = Expect<_check_Document_properties_readonly_151>;

type Ref_Document_removeDocumentInformation_152 = (removeDocInfoType: DocxEditor.RemoveDocInfoType) => void;
type Auth_Document_removeDocumentInformation_152 = (removeDocInfoType: DocxEditor.RemoveDocInfoType) => void;
type _check_Document_removeDocumentInformation_152 = IsExact<Ref_Document_removeDocumentInformation_152, Auth_Document_removeDocumentInformation_152>;
type _assert_Document_removeDocumentInformation_152 = Expect<_check_Document_removeDocumentInformation_152>;

type Ref_Document_removeDocumentInformation_153 = (removeDocInfoType: "Comments" | "Revisions" | "Versions" | "RemovePersonalInformation" | "EmailHeader" | "RoutingSlip" | "SendForReview" | "DocumentProperties" | "Template" | "DocumentWorkspace" | "InkAnnotations" | "DocumentServerProperties" | "DocumentManagementPolicy" | "ContentType" | "TaskpaneWebExtensions" | "AtMentions" | "DocumentTasks" | "DocumentIntelligence" | "CommentReactions" | "All") => void;
type Auth_Document_removeDocumentInformation_153 = (removeDocInfoType: "Comments" | "Revisions" | "Versions" | "RemovePersonalInformation" | "EmailHeader" | "RoutingSlip" | "SendForReview" | "DocumentProperties" | "Template" | "DocumentWorkspace" | "InkAnnotations" | "DocumentServerProperties" | "DocumentManagementPolicy" | "ContentType" | "TaskpaneWebExtensions" | "AtMentions" | "DocumentTasks" | "DocumentIntelligence" | "CommentReactions" | "All") => void;
type _check_Document_removeDocumentInformation_153 = IsExact<Ref_Document_removeDocumentInformation_153, Auth_Document_removeDocumentInformation_153>;
type _assert_Document_removeDocumentInformation_153 = Expect<_check_Document_removeDocumentInformation_153>;

type Ref_Document_revisions_154 = () => DocxEditor.RevisionCollection;
type Auth_Document_revisions_154 = () => DocxEditor.RevisionCollection;
type _check_Document_revisions_154 = IsExact<Ref_Document_revisions_154, Auth_Document_revisions_154>;
type _assert_Document_revisions_154 = Expect<_check_Document_revisions_154>;

type Ref_Document_revisions_readonly_155 = { readonly value: DocxEditor.RevisionCollection };
type Auth_Document_revisions_readonly_155 = { readonly value: DocxEditor.RevisionCollection };
type _check_Document_revisions_readonly_155 = IsExact<Ref_Document_revisions_readonly_155, Auth_Document_revisions_readonly_155>;
type _assert_Document_revisions_readonly_155 = Expect<_check_Document_revisions_readonly_155>;

type Ref_Document_sections_156 = () => DocxEditor.SectionCollection;
type Auth_Document_sections_156 = () => DocxEditor.SectionCollection;
type _check_Document_sections_156 = IsExact<Ref_Document_sections_156, Auth_Document_sections_156>;
type _assert_Document_sections_156 = Expect<_check_Document_sections_156>;

type Ref_Document_sections_readonly_157 = { readonly value: DocxEditor.SectionCollection };
type Auth_Document_sections_readonly_157 = { readonly value: DocxEditor.SectionCollection };
type _check_Document_sections_readonly_157 = IsExact<Ref_Document_sections_readonly_157, Auth_Document_sections_readonly_157>;
type _assert_Document_sections_readonly_157 = Expect<_check_Document_sections_readonly_157>;

type Ref_DocumentProperties_author_158 = () => string;
type Auth_DocumentProperties_author_158 = () => string;
type _check_DocumentProperties_author_158 = IsExact<Ref_DocumentProperties_author_158, Auth_DocumentProperties_author_158>;
type _assert_DocumentProperties_author_158 = Expect<_check_DocumentProperties_author_158>;

type Ref_DocumentProperties_author_readonly_159 = { value: string };
type Auth_DocumentProperties_author_readonly_159 = { value: string };
type _check_DocumentProperties_author_readonly_159 = IsExact<Ref_DocumentProperties_author_readonly_159, Auth_DocumentProperties_author_readonly_159>;
type _assert_DocumentProperties_author_readonly_159 = Expect<_check_DocumentProperties_author_readonly_159>;

type Ref_DocumentProperties_category_160 = () => string;
type Auth_DocumentProperties_category_160 = () => string;
type _check_DocumentProperties_category_160 = IsExact<Ref_DocumentProperties_category_160, Auth_DocumentProperties_category_160>;
type _assert_DocumentProperties_category_160 = Expect<_check_DocumentProperties_category_160>;

type Ref_DocumentProperties_category_readonly_161 = { value: string };
type Auth_DocumentProperties_category_readonly_161 = { value: string };
type _check_DocumentProperties_category_readonly_161 = IsExact<Ref_DocumentProperties_category_readonly_161, Auth_DocumentProperties_category_readonly_161>;
type _assert_DocumentProperties_category_readonly_161 = Expect<_check_DocumentProperties_category_readonly_161>;

type Ref_DocumentProperties_comments_162 = () => string;
type Auth_DocumentProperties_comments_162 = () => string;
type _check_DocumentProperties_comments_162 = IsExact<Ref_DocumentProperties_comments_162, Auth_DocumentProperties_comments_162>;
type _assert_DocumentProperties_comments_162 = Expect<_check_DocumentProperties_comments_162>;

type Ref_DocumentProperties_comments_readonly_163 = { value: string };
type Auth_DocumentProperties_comments_readonly_163 = { value: string };
type _check_DocumentProperties_comments_readonly_163 = IsExact<Ref_DocumentProperties_comments_readonly_163, Auth_DocumentProperties_comments_readonly_163>;
type _assert_DocumentProperties_comments_readonly_163 = Expect<_check_DocumentProperties_comments_readonly_163>;

type Ref_DocumentProperties_keywords_164 = () => string;
type Auth_DocumentProperties_keywords_164 = () => string;
type _check_DocumentProperties_keywords_164 = IsExact<Ref_DocumentProperties_keywords_164, Auth_DocumentProperties_keywords_164>;
type _assert_DocumentProperties_keywords_164 = Expect<_check_DocumentProperties_keywords_164>;

type Ref_DocumentProperties_keywords_readonly_165 = { value: string };
type Auth_DocumentProperties_keywords_readonly_165 = { value: string };
type _check_DocumentProperties_keywords_readonly_165 = IsExact<Ref_DocumentProperties_keywords_readonly_165, Auth_DocumentProperties_keywords_readonly_165>;
type _assert_DocumentProperties_keywords_readonly_165 = Expect<_check_DocumentProperties_keywords_readonly_165>;

type Ref_DocumentProperties_lastAuthor_166 = () => string;
type Auth_DocumentProperties_lastAuthor_166 = () => string;
type _check_DocumentProperties_lastAuthor_166 = IsExact<Ref_DocumentProperties_lastAuthor_166, Auth_DocumentProperties_lastAuthor_166>;
type _assert_DocumentProperties_lastAuthor_166 = Expect<_check_DocumentProperties_lastAuthor_166>;

type Ref_DocumentProperties_lastAuthor_readonly_167 = { readonly value: string };
type Auth_DocumentProperties_lastAuthor_readonly_167 = { readonly value: string };
type _check_DocumentProperties_lastAuthor_readonly_167 = IsExact<Ref_DocumentProperties_lastAuthor_readonly_167, Auth_DocumentProperties_lastAuthor_readonly_167>;
type _assert_DocumentProperties_lastAuthor_readonly_167 = Expect<_check_DocumentProperties_lastAuthor_readonly_167>;

type Ref_DocumentProperties_subject_168 = () => string;
type Auth_DocumentProperties_subject_168 = () => string;
type _check_DocumentProperties_subject_168 = IsExact<Ref_DocumentProperties_subject_168, Auth_DocumentProperties_subject_168>;
type _assert_DocumentProperties_subject_168 = Expect<_check_DocumentProperties_subject_168>;

type Ref_DocumentProperties_subject_readonly_169 = { value: string };
type Auth_DocumentProperties_subject_readonly_169 = { value: string };
type _check_DocumentProperties_subject_readonly_169 = IsExact<Ref_DocumentProperties_subject_readonly_169, Auth_DocumentProperties_subject_readonly_169>;
type _assert_DocumentProperties_subject_readonly_169 = Expect<_check_DocumentProperties_subject_readonly_169>;

type Ref_DocumentProperties_title_170 = () => string;
type Auth_DocumentProperties_title_170 = () => string;
type _check_DocumentProperties_title_170 = IsExact<Ref_DocumentProperties_title_170, Auth_DocumentProperties_title_170>;
type _assert_DocumentProperties_title_170 = Expect<_check_DocumentProperties_title_170>;

type Ref_DocumentProperties_title_readonly_171 = { value: string };
type Auth_DocumentProperties_title_readonly_171 = { value: string };
type _check_DocumentProperties_title_readonly_171 = IsExact<Ref_DocumentProperties_title_readonly_171, Auth_DocumentProperties_title_readonly_171>;
type _assert_DocumentProperties_title_readonly_171 = Expect<_check_DocumentProperties_title_readonly_171>;

type Ref_Font_bold_172 = () => boolean;
type Auth_Font_bold_172 = () => boolean;
type _check_Font_bold_172 = IsExact<Ref_Font_bold_172, Auth_Font_bold_172>;
type _assert_Font_bold_172 = Expect<_check_Font_bold_172>;

type Ref_Font_bold_readonly_173 = { value: boolean };
type Auth_Font_bold_readonly_173 = { value: boolean };
type _check_Font_bold_readonly_173 = IsExact<Ref_Font_bold_readonly_173, Auth_Font_bold_readonly_173>;
type _assert_Font_bold_readonly_173 = Expect<_check_Font_bold_readonly_173>;

type Ref_Font_color_174 = () => string;
type Auth_Font_color_174 = () => string;
type _check_Font_color_174 = IsExact<Ref_Font_color_174, Auth_Font_color_174>;
type _assert_Font_color_174 = Expect<_check_Font_color_174>;

type Ref_Font_color_readonly_175 = { value: string };
type Auth_Font_color_readonly_175 = { value: string };
type _check_Font_color_readonly_175 = IsExact<Ref_Font_color_readonly_175, Auth_Font_color_readonly_175>;
type _assert_Font_color_readonly_175 = Expect<_check_Font_color_readonly_175>;

type Ref_Font_italic_176 = () => boolean;
type Auth_Font_italic_176 = () => boolean;
type _check_Font_italic_176 = IsExact<Ref_Font_italic_176, Auth_Font_italic_176>;
type _assert_Font_italic_176 = Expect<_check_Font_italic_176>;

type Ref_Font_italic_readonly_177 = { value: boolean };
type Auth_Font_italic_readonly_177 = { value: boolean };
type _check_Font_italic_readonly_177 = IsExact<Ref_Font_italic_readonly_177, Auth_Font_italic_readonly_177>;
type _assert_Font_italic_readonly_177 = Expect<_check_Font_italic_readonly_177>;

type Ref_Font_name_178 = () => string;
type Auth_Font_name_178 = () => string;
type _check_Font_name_178 = IsExact<Ref_Font_name_178, Auth_Font_name_178>;
type _assert_Font_name_178 = Expect<_check_Font_name_178>;

type Ref_Font_name_readonly_179 = { value: string };
type Auth_Font_name_readonly_179 = { value: string };
type _check_Font_name_readonly_179 = IsExact<Ref_Font_name_readonly_179, Auth_Font_name_readonly_179>;
type _assert_Font_name_readonly_179 = Expect<_check_Font_name_readonly_179>;

type Ref_Font_size_180 = () => number;
type Auth_Font_size_180 = () => number;
type _check_Font_size_180 = IsExact<Ref_Font_size_180, Auth_Font_size_180>;
type _assert_Font_size_180 = Expect<_check_Font_size_180>;

type Ref_Font_size_readonly_181 = { value: number };
type Auth_Font_size_readonly_181 = { value: number };
type _check_Font_size_readonly_181 = IsExact<Ref_Font_size_readonly_181, Auth_Font_size_readonly_181>;
type _assert_Font_size_readonly_181 = Expect<_check_Font_size_readonly_181>;

type Ref_List_getLevelParagraphs_182 = (level: number) => DocxEditor.ParagraphCollection;
type Auth_List_getLevelParagraphs_182 = (level: number) => DocxEditor.ParagraphCollection;
type _check_List_getLevelParagraphs_182 = IsExact<Ref_List_getLevelParagraphs_182, Auth_List_getLevelParagraphs_182>;
type _assert_List_getLevelParagraphs_182 = Expect<_check_List_getLevelParagraphs_182>;

type Ref_List_id_183 = () => number;
type Auth_List_id_183 = () => number;
type _check_List_id_183 = IsExact<Ref_List_id_183, Auth_List_id_183>;
type _assert_List_id_183 = Expect<_check_List_id_183>;

type Ref_List_id_readonly_184 = { readonly value: number };
type Auth_List_id_readonly_184 = { readonly value: number };
type _check_List_id_readonly_184 = IsExact<Ref_List_id_readonly_184, Auth_List_id_readonly_184>;
type _assert_List_id_readonly_184 = Expect<_check_List_id_readonly_184>;

type Ref_List_insertParagraph_185 = (paragraphText: string, insertLocation: "Start" | "End" | "Before" | "After") => DocxEditor.Paragraph;
type Auth_List_insertParagraph_185 = (paragraphText: string, insertLocation: "Start" | "End" | "Before" | "After") => DocxEditor.Paragraph;
type _check_List_insertParagraph_185 = IsExact<Ref_List_insertParagraph_185, Auth_List_insertParagraph_185>;
type _assert_List_insertParagraph_185 = Expect<_check_List_insertParagraph_185>;

type Ref_List_paragraphs_186 = () => DocxEditor.ParagraphCollection;
type Auth_List_paragraphs_186 = () => DocxEditor.ParagraphCollection;
type _check_List_paragraphs_186 = IsExact<Ref_List_paragraphs_186, Auth_List_paragraphs_186>;
type _assert_List_paragraphs_186 = Expect<_check_List_paragraphs_186>;

type Ref_List_paragraphs_readonly_187 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_List_paragraphs_readonly_187 = { readonly value: DocxEditor.ParagraphCollection };
type _check_List_paragraphs_readonly_187 = IsExact<Ref_List_paragraphs_readonly_187, Auth_List_paragraphs_readonly_187>;
type _assert_List_paragraphs_readonly_187 = Expect<_check_List_paragraphs_readonly_187>;

type Ref_ListCollection_getById_188 = (id: number) => DocxEditor.List;
type Auth_ListCollection_getById_188 = (id: number) => DocxEditor.List;
type _check_ListCollection_getById_188 = IsExact<Ref_ListCollection_getById_188, Auth_ListCollection_getById_188>;
type _assert_ListCollection_getById_188 = Expect<_check_ListCollection_getById_188>;

type Ref_ListCollection_getFirst_189 = () => DocxEditor.List;
type Auth_ListCollection_getFirst_189 = () => DocxEditor.List;
type _check_ListCollection_getFirst_189 = IsExact<Ref_ListCollection_getFirst_189, Auth_ListCollection_getFirst_189>;
type _assert_ListCollection_getFirst_189 = Expect<_check_ListCollection_getFirst_189>;

type Ref_ListCollection_items_190 = () => DocxEditor.List[];
type Auth_ListCollection_items_190 = () => DocxEditor.List[];
type _check_ListCollection_items_190 = IsExact<Ref_ListCollection_items_190, Auth_ListCollection_items_190>;
type _assert_ListCollection_items_190 = Expect<_check_ListCollection_items_190>;

type Ref_ListCollection_items_readonly_191 = { readonly value: DocxEditor.List[] };
type Auth_ListCollection_items_readonly_191 = { readonly value: DocxEditor.List[] };
type _check_ListCollection_items_readonly_191 = IsExact<Ref_ListCollection_items_readonly_191, Auth_ListCollection_items_readonly_191>;
type _assert_ListCollection_items_readonly_191 = Expect<_check_ListCollection_items_readonly_191>;

type Ref_ListItem_level_192 = () => number;
type Auth_ListItem_level_192 = () => number;
type _check_ListItem_level_192 = IsExact<Ref_ListItem_level_192, Auth_ListItem_level_192>;
type _assert_ListItem_level_192 = Expect<_check_ListItem_level_192>;

type Ref_ListItem_level_readonly_193 = { value: number };
type Auth_ListItem_level_readonly_193 = { value: number };
type _check_ListItem_level_readonly_193 = IsExact<Ref_ListItem_level_readonly_193, Auth_ListItem_level_readonly_193>;
type _assert_ListItem_level_readonly_193 = Expect<_check_ListItem_level_readonly_193>;

type Ref_NoteItem_body_194 = () => DocxEditor.Body;
type Auth_NoteItem_body_194 = () => DocxEditor.Body;
type _check_NoteItem_body_194 = IsExact<Ref_NoteItem_body_194, Auth_NoteItem_body_194>;
type _assert_NoteItem_body_194 = Expect<_check_NoteItem_body_194>;

type Ref_NoteItem_body_readonly_195 = { readonly value: DocxEditor.Body };
type Auth_NoteItem_body_readonly_195 = { readonly value: DocxEditor.Body };
type _check_NoteItem_body_readonly_195 = IsExact<Ref_NoteItem_body_readonly_195, Auth_NoteItem_body_readonly_195>;
type _assert_NoteItem_body_readonly_195 = Expect<_check_NoteItem_body_readonly_195>;

type Ref_NoteItem_delete_196 = () => void;
type Auth_NoteItem_delete_196 = () => void;
type _check_NoteItem_delete_196 = IsExact<Ref_NoteItem_delete_196, Auth_NoteItem_delete_196>;
type _assert_NoteItem_delete_196 = Expect<_check_NoteItem_delete_196>;

type Ref_NoteItem_getNext_197 = () => DocxEditor.NoteItem;
type Auth_NoteItem_getNext_197 = () => DocxEditor.NoteItem;
type _check_NoteItem_getNext_197 = IsExact<Ref_NoteItem_getNext_197, Auth_NoteItem_getNext_197>;
type _assert_NoteItem_getNext_197 = Expect<_check_NoteItem_getNext_197>;

type Ref_NoteItem_type_198 = () => "Footnote" | "Endnote";
type Auth_NoteItem_type_198 = () => "Footnote" | "Endnote";
type _check_NoteItem_type_198 = IsExact<Ref_NoteItem_type_198, Auth_NoteItem_type_198>;
type _assert_NoteItem_type_198 = Expect<_check_NoteItem_type_198>;

type Ref_NoteItem_type_readonly_199 = { readonly value: "Footnote" | "Endnote" };
type Auth_NoteItem_type_readonly_199 = { readonly value: "Footnote" | "Endnote" };
type _check_NoteItem_type_readonly_199 = IsExact<Ref_NoteItem_type_readonly_199, Auth_NoteItem_type_readonly_199>;
type _assert_NoteItem_type_readonly_199 = Expect<_check_NoteItem_type_readonly_199>;

type Ref_NoteItemCollection_getFirst_200 = () => DocxEditor.NoteItem;
type Auth_NoteItemCollection_getFirst_200 = () => DocxEditor.NoteItem;
type _check_NoteItemCollection_getFirst_200 = IsExact<Ref_NoteItemCollection_getFirst_200, Auth_NoteItemCollection_getFirst_200>;
type _assert_NoteItemCollection_getFirst_200 = Expect<_check_NoteItemCollection_getFirst_200>;

type Ref_NoteItemCollection_items_201 = () => DocxEditor.NoteItem[];
type Auth_NoteItemCollection_items_201 = () => DocxEditor.NoteItem[];
type _check_NoteItemCollection_items_201 = IsExact<Ref_NoteItemCollection_items_201, Auth_NoteItemCollection_items_201>;
type _assert_NoteItemCollection_items_201 = Expect<_check_NoteItemCollection_items_201>;

type Ref_NoteItemCollection_items_readonly_202 = { readonly value: DocxEditor.NoteItem[] };
type Auth_NoteItemCollection_items_readonly_202 = { readonly value: DocxEditor.NoteItem[] };
type _check_NoteItemCollection_items_readonly_202 = IsExact<Ref_NoteItemCollection_items_readonly_202, Auth_NoteItemCollection_items_readonly_202>;
type _assert_NoteItemCollection_items_readonly_202 = Expect<_check_NoteItemCollection_items_readonly_202>;

type Ref_PageSetup_bottomMargin_203 = () => number;
type Auth_PageSetup_bottomMargin_203 = () => number;
type _check_PageSetup_bottomMargin_203 = IsExact<Ref_PageSetup_bottomMargin_203, Auth_PageSetup_bottomMargin_203>;
type _assert_PageSetup_bottomMargin_203 = Expect<_check_PageSetup_bottomMargin_203>;

type Ref_PageSetup_bottomMargin_readonly_204 = { value: number };
type Auth_PageSetup_bottomMargin_readonly_204 = { value: number };
type _check_PageSetup_bottomMargin_readonly_204 = IsExact<Ref_PageSetup_bottomMargin_readonly_204, Auth_PageSetup_bottomMargin_readonly_204>;
type _assert_PageSetup_bottomMargin_readonly_204 = Expect<_check_PageSetup_bottomMargin_readonly_204>;

type Ref_PageSetup_leftMargin_205 = () => number;
type Auth_PageSetup_leftMargin_205 = () => number;
type _check_PageSetup_leftMargin_205 = IsExact<Ref_PageSetup_leftMargin_205, Auth_PageSetup_leftMargin_205>;
type _assert_PageSetup_leftMargin_205 = Expect<_check_PageSetup_leftMargin_205>;

type Ref_PageSetup_leftMargin_readonly_206 = { value: number };
type Auth_PageSetup_leftMargin_readonly_206 = { value: number };
type _check_PageSetup_leftMargin_readonly_206 = IsExact<Ref_PageSetup_leftMargin_readonly_206, Auth_PageSetup_leftMargin_readonly_206>;
type _assert_PageSetup_leftMargin_readonly_206 = Expect<_check_PageSetup_leftMargin_readonly_206>;

type Ref_PageSetup_orientation_207 = () => "Portrait" | "Landscape";
type Auth_PageSetup_orientation_207 = () => "Portrait" | "Landscape";
type _check_PageSetup_orientation_207 = IsExact<Ref_PageSetup_orientation_207, Auth_PageSetup_orientation_207>;
type _assert_PageSetup_orientation_207 = Expect<_check_PageSetup_orientation_207>;

type Ref_PageSetup_orientation_readonly_208 = { value: "Portrait" | "Landscape" };
type Auth_PageSetup_orientation_readonly_208 = { value: "Portrait" | "Landscape" };
type _check_PageSetup_orientation_readonly_208 = IsExact<Ref_PageSetup_orientation_readonly_208, Auth_PageSetup_orientation_readonly_208>;
type _assert_PageSetup_orientation_readonly_208 = Expect<_check_PageSetup_orientation_readonly_208>;

type Ref_PageSetup_pageHeight_209 = () => number;
type Auth_PageSetup_pageHeight_209 = () => number;
type _check_PageSetup_pageHeight_209 = IsExact<Ref_PageSetup_pageHeight_209, Auth_PageSetup_pageHeight_209>;
type _assert_PageSetup_pageHeight_209 = Expect<_check_PageSetup_pageHeight_209>;

type Ref_PageSetup_pageHeight_readonly_210 = { value: number };
type Auth_PageSetup_pageHeight_readonly_210 = { value: number };
type _check_PageSetup_pageHeight_readonly_210 = IsExact<Ref_PageSetup_pageHeight_readonly_210, Auth_PageSetup_pageHeight_readonly_210>;
type _assert_PageSetup_pageHeight_readonly_210 = Expect<_check_PageSetup_pageHeight_readonly_210>;

type Ref_PageSetup_pageWidth_211 = () => number;
type Auth_PageSetup_pageWidth_211 = () => number;
type _check_PageSetup_pageWidth_211 = IsExact<Ref_PageSetup_pageWidth_211, Auth_PageSetup_pageWidth_211>;
type _assert_PageSetup_pageWidth_211 = Expect<_check_PageSetup_pageWidth_211>;

type Ref_PageSetup_pageWidth_readonly_212 = { value: number };
type Auth_PageSetup_pageWidth_readonly_212 = { value: number };
type _check_PageSetup_pageWidth_readonly_212 = IsExact<Ref_PageSetup_pageWidth_readonly_212, Auth_PageSetup_pageWidth_readonly_212>;
type _assert_PageSetup_pageWidth_readonly_212 = Expect<_check_PageSetup_pageWidth_readonly_212>;

type Ref_PageSetup_rightMargin_213 = () => number;
type Auth_PageSetup_rightMargin_213 = () => number;
type _check_PageSetup_rightMargin_213 = IsExact<Ref_PageSetup_rightMargin_213, Auth_PageSetup_rightMargin_213>;
type _assert_PageSetup_rightMargin_213 = Expect<_check_PageSetup_rightMargin_213>;

type Ref_PageSetup_rightMargin_readonly_214 = { value: number };
type Auth_PageSetup_rightMargin_readonly_214 = { value: number };
type _check_PageSetup_rightMargin_readonly_214 = IsExact<Ref_PageSetup_rightMargin_readonly_214, Auth_PageSetup_rightMargin_readonly_214>;
type _assert_PageSetup_rightMargin_readonly_214 = Expect<_check_PageSetup_rightMargin_readonly_214>;

type Ref_PageSetup_topMargin_215 = () => number;
type Auth_PageSetup_topMargin_215 = () => number;
type _check_PageSetup_topMargin_215 = IsExact<Ref_PageSetup_topMargin_215, Auth_PageSetup_topMargin_215>;
type _assert_PageSetup_topMargin_215 = Expect<_check_PageSetup_topMargin_215>;

type Ref_PageSetup_topMargin_readonly_216 = { value: number };
type Auth_PageSetup_topMargin_readonly_216 = { value: number };
type _check_PageSetup_topMargin_readonly_216 = IsExact<Ref_PageSetup_topMargin_readonly_216, Auth_PageSetup_topMargin_readonly_216>;
type _assert_PageSetup_topMargin_readonly_216 = Expect<_check_PageSetup_topMargin_readonly_216>;

type Ref_Paragraph_alignment_217 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type Auth_Paragraph_alignment_217 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type _check_Paragraph_alignment_217 = IsExact<Ref_Paragraph_alignment_217, Auth_Paragraph_alignment_217>;
type _assert_Paragraph_alignment_217 = Expect<_check_Paragraph_alignment_217>;

type Ref_Paragraph_alignment_readonly_218 = { value: "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified" };
type Auth_Paragraph_alignment_readonly_218 = { value: "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified" };
type _check_Paragraph_alignment_readonly_218 = IsExact<Ref_Paragraph_alignment_readonly_218, Auth_Paragraph_alignment_readonly_218>;
type _assert_Paragraph_alignment_readonly_218 = Expect<_check_Paragraph_alignment_readonly_218>;

type Ref_Paragraph_borders_219 = () => DocxEditor.BorderUniversalCollection;
type Auth_Paragraph_borders_219 = () => DocxEditor.BorderUniversalCollection;
type _check_Paragraph_borders_219 = IsExact<Ref_Paragraph_borders_219, Auth_Paragraph_borders_219>;
type _assert_Paragraph_borders_219 = Expect<_check_Paragraph_borders_219>;

type Ref_Paragraph_borders_readonly_220 = { readonly value: DocxEditor.BorderUniversalCollection };
type Auth_Paragraph_borders_readonly_220 = { readonly value: DocxEditor.BorderUniversalCollection };
type _check_Paragraph_borders_readonly_220 = IsExact<Ref_Paragraph_borders_readonly_220, Auth_Paragraph_borders_readonly_220>;
type _assert_Paragraph_borders_readonly_220 = Expect<_check_Paragraph_borders_readonly_220>;

type Ref_Paragraph_clear_221 = () => void;
type Auth_Paragraph_clear_221 = () => void;
type _check_Paragraph_clear_221 = IsExact<Ref_Paragraph_clear_221, Auth_Paragraph_clear_221>;
type _assert_Paragraph_clear_221 = Expect<_check_Paragraph_clear_221>;

type Ref_Paragraph_contentControls_222 = () => DocxEditor.ContentControlCollection;
type Auth_Paragraph_contentControls_222 = () => DocxEditor.ContentControlCollection;
type _check_Paragraph_contentControls_222 = IsExact<Ref_Paragraph_contentControls_222, Auth_Paragraph_contentControls_222>;
type _assert_Paragraph_contentControls_222 = Expect<_check_Paragraph_contentControls_222>;

type Ref_Paragraph_contentControls_readonly_223 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Paragraph_contentControls_readonly_223 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Paragraph_contentControls_readonly_223 = IsExact<Ref_Paragraph_contentControls_readonly_223, Auth_Paragraph_contentControls_readonly_223>;
type _assert_Paragraph_contentControls_readonly_223 = Expect<_check_Paragraph_contentControls_readonly_223>;

type Ref_Paragraph_delete_224 = () => void;
type Auth_Paragraph_delete_224 = () => void;
type _check_Paragraph_delete_224 = IsExact<Ref_Paragraph_delete_224, Auth_Paragraph_delete_224>;
type _assert_Paragraph_delete_224 = Expect<_check_Paragraph_delete_224>;

type Ref_Paragraph_firstLineIndent_225 = () => number;
type Auth_Paragraph_firstLineIndent_225 = () => number;
type _check_Paragraph_firstLineIndent_225 = IsExact<Ref_Paragraph_firstLineIndent_225, Auth_Paragraph_firstLineIndent_225>;
type _assert_Paragraph_firstLineIndent_225 = Expect<_check_Paragraph_firstLineIndent_225>;

type Ref_Paragraph_firstLineIndent_readonly_226 = { value: number };
type Auth_Paragraph_firstLineIndent_readonly_226 = { value: number };
type _check_Paragraph_firstLineIndent_readonly_226 = IsExact<Ref_Paragraph_firstLineIndent_readonly_226, Auth_Paragraph_firstLineIndent_readonly_226>;
type _assert_Paragraph_firstLineIndent_readonly_226 = Expect<_check_Paragraph_firstLineIndent_readonly_226>;

type Ref_Paragraph_font_227 = () => DocxEditor.Font;
type Auth_Paragraph_font_227 = () => DocxEditor.Font;
type _check_Paragraph_font_227 = IsExact<Ref_Paragraph_font_227, Auth_Paragraph_font_227>;
type _assert_Paragraph_font_227 = Expect<_check_Paragraph_font_227>;

type Ref_Paragraph_font_readonly_228 = { readonly value: DocxEditor.Font };
type Auth_Paragraph_font_readonly_228 = { readonly value: DocxEditor.Font };
type _check_Paragraph_font_readonly_228 = IsExact<Ref_Paragraph_font_readonly_228, Auth_Paragraph_font_readonly_228>;
type _assert_Paragraph_font_readonly_228 = Expect<_check_Paragraph_font_readonly_228>;

type Ref_Paragraph_getAnnotations_229 = () => DocxEditor.AnnotationCollection;
type Auth_Paragraph_getAnnotations_229 = () => DocxEditor.AnnotationCollection;
type _check_Paragraph_getAnnotations_229 = IsExact<Ref_Paragraph_getAnnotations_229, Auth_Paragraph_getAnnotations_229>;
type _assert_Paragraph_getAnnotations_229 = Expect<_check_Paragraph_getAnnotations_229>;

type Ref_Paragraph_getReviewedText_230 = (changeTrackingVersion?: DocxEditor.ChangeTrackingVersion) => DocxEditor.ClientResult<string>;
type Auth_Paragraph_getReviewedText_230 = (changeTrackingVersion?: DocxEditor.ChangeTrackingVersion) => DocxEditor.ClientResult<string>;
type _check_Paragraph_getReviewedText_230 = IsExact<Ref_Paragraph_getReviewedText_230, Auth_Paragraph_getReviewedText_230>;
type _assert_Paragraph_getReviewedText_230 = Expect<_check_Paragraph_getReviewedText_230>;

type Ref_Paragraph_getReviewedText_231 = (changeTrackingVersion?: "Original" | "Current") => DocxEditor.ClientResult<string>;
type Auth_Paragraph_getReviewedText_231 = (changeTrackingVersion?: "Original" | "Current") => DocxEditor.ClientResult<string>;
type _check_Paragraph_getReviewedText_231 = IsExact<Ref_Paragraph_getReviewedText_231, Auth_Paragraph_getReviewedText_231>;
type _assert_Paragraph_getReviewedText_231 = Expect<_check_Paragraph_getReviewedText_231>;

type Ref_Paragraph_getTextRanges_232 = (endingMarks: string[], trimSpacing?: boolean) => DocxEditor.RangeCollection;
type Auth_Paragraph_getTextRanges_232 = (endingMarks: string[], trimSpacing?: boolean) => DocxEditor.RangeCollection;
type _check_Paragraph_getTextRanges_232 = IsExact<Ref_Paragraph_getTextRanges_232, Auth_Paragraph_getTextRanges_232>;
type _assert_Paragraph_getTextRanges_232 = Expect<_check_Paragraph_getTextRanges_232>;

type Ref_Paragraph_insertAnnotations_233 = (annotations: DocxEditor.AnnotationSet) => DocxEditor.ClientResult<string[]>;
type Auth_Paragraph_insertAnnotations_233 = (annotations: DocxEditor.AnnotationSet) => DocxEditor.ClientResult<string[]>;
type _check_Paragraph_insertAnnotations_233 = IsExact<Ref_Paragraph_insertAnnotations_233, Auth_Paragraph_insertAnnotations_233>;
type _assert_Paragraph_insertAnnotations_233 = Expect<_check_Paragraph_insertAnnotations_233>;

type Ref_Paragraph_insertParagraph_234 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Paragraph_insertParagraph_234 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Paragraph_insertParagraph_234 = IsExact<Ref_Paragraph_insertParagraph_234, Auth_Paragraph_insertParagraph_234>;
type _assert_Paragraph_insertParagraph_234 = Expect<_check_Paragraph_insertParagraph_234>;

type Ref_Paragraph_insertText_235 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Paragraph_insertText_235 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Paragraph_insertText_235 = IsExact<Ref_Paragraph_insertText_235, Auth_Paragraph_insertText_235>;
type _assert_Paragraph_insertText_235 = Expect<_check_Paragraph_insertText_235>;

type Ref_Paragraph_leftIndent_236 = () => number;
type Auth_Paragraph_leftIndent_236 = () => number;
type _check_Paragraph_leftIndent_236 = IsExact<Ref_Paragraph_leftIndent_236, Auth_Paragraph_leftIndent_236>;
type _assert_Paragraph_leftIndent_236 = Expect<_check_Paragraph_leftIndent_236>;

type Ref_Paragraph_leftIndent_readonly_237 = { value: number };
type Auth_Paragraph_leftIndent_readonly_237 = { value: number };
type _check_Paragraph_leftIndent_readonly_237 = IsExact<Ref_Paragraph_leftIndent_readonly_237, Auth_Paragraph_leftIndent_readonly_237>;
type _assert_Paragraph_leftIndent_readonly_237 = Expect<_check_Paragraph_leftIndent_readonly_237>;

type Ref_Paragraph_lineSpacing_238 = () => number;
type Auth_Paragraph_lineSpacing_238 = () => number;
type _check_Paragraph_lineSpacing_238 = IsExact<Ref_Paragraph_lineSpacing_238, Auth_Paragraph_lineSpacing_238>;
type _assert_Paragraph_lineSpacing_238 = Expect<_check_Paragraph_lineSpacing_238>;

type Ref_Paragraph_lineSpacing_readonly_239 = { value: number };
type Auth_Paragraph_lineSpacing_readonly_239 = { value: number };
type _check_Paragraph_lineSpacing_readonly_239 = IsExact<Ref_Paragraph_lineSpacing_readonly_239, Auth_Paragraph_lineSpacing_readonly_239>;
type _assert_Paragraph_lineSpacing_readonly_239 = Expect<_check_Paragraph_lineSpacing_readonly_239>;

type Ref_Paragraph_list_240 = () => DocxEditor.List;
type Auth_Paragraph_list_240 = () => DocxEditor.List;
type _check_Paragraph_list_240 = IsExact<Ref_Paragraph_list_240, Auth_Paragraph_list_240>;
type _assert_Paragraph_list_240 = Expect<_check_Paragraph_list_240>;

type Ref_Paragraph_list_readonly_241 = { readonly value: DocxEditor.List };
type Auth_Paragraph_list_readonly_241 = { readonly value: DocxEditor.List };
type _check_Paragraph_list_readonly_241 = IsExact<Ref_Paragraph_list_readonly_241, Auth_Paragraph_list_readonly_241>;
type _assert_Paragraph_list_readonly_241 = Expect<_check_Paragraph_list_readonly_241>;

type Ref_Paragraph_listItem_242 = () => DocxEditor.ListItem;
type Auth_Paragraph_listItem_242 = () => DocxEditor.ListItem;
type _check_Paragraph_listItem_242 = IsExact<Ref_Paragraph_listItem_242, Auth_Paragraph_listItem_242>;
type _assert_Paragraph_listItem_242 = Expect<_check_Paragraph_listItem_242>;

type Ref_Paragraph_listItem_readonly_243 = { readonly value: DocxEditor.ListItem };
type Auth_Paragraph_listItem_readonly_243 = { readonly value: DocxEditor.ListItem };
type _check_Paragraph_listItem_readonly_243 = IsExact<Ref_Paragraph_listItem_readonly_243, Auth_Paragraph_listItem_readonly_243>;
type _assert_Paragraph_listItem_readonly_243 = Expect<_check_Paragraph_listItem_readonly_243>;

type Ref_Paragraph_rightIndent_244 = () => number;
type Auth_Paragraph_rightIndent_244 = () => number;
type _check_Paragraph_rightIndent_244 = IsExact<Ref_Paragraph_rightIndent_244, Auth_Paragraph_rightIndent_244>;
type _assert_Paragraph_rightIndent_244 = Expect<_check_Paragraph_rightIndent_244>;

type Ref_Paragraph_rightIndent_readonly_245 = { value: number };
type Auth_Paragraph_rightIndent_readonly_245 = { value: number };
type _check_Paragraph_rightIndent_readonly_245 = IsExact<Ref_Paragraph_rightIndent_readonly_245, Auth_Paragraph_rightIndent_readonly_245>;
type _assert_Paragraph_rightIndent_readonly_245 = Expect<_check_Paragraph_rightIndent_readonly_245>;

type Ref_Paragraph_search_246 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Paragraph_search_246 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Paragraph_search_246 = IsExact<Ref_Paragraph_search_246, Auth_Paragraph_search_246>;
type _assert_Paragraph_search_246 = Expect<_check_Paragraph_search_246>;

type Ref_Paragraph_spaceAfter_247 = () => number;
type Auth_Paragraph_spaceAfter_247 = () => number;
type _check_Paragraph_spaceAfter_247 = IsExact<Ref_Paragraph_spaceAfter_247, Auth_Paragraph_spaceAfter_247>;
type _assert_Paragraph_spaceAfter_247 = Expect<_check_Paragraph_spaceAfter_247>;

type Ref_Paragraph_spaceAfter_readonly_248 = { value: number };
type Auth_Paragraph_spaceAfter_readonly_248 = { value: number };
type _check_Paragraph_spaceAfter_readonly_248 = IsExact<Ref_Paragraph_spaceAfter_readonly_248, Auth_Paragraph_spaceAfter_readonly_248>;
type _assert_Paragraph_spaceAfter_readonly_248 = Expect<_check_Paragraph_spaceAfter_readonly_248>;

type Ref_Paragraph_spaceBefore_249 = () => number;
type Auth_Paragraph_spaceBefore_249 = () => number;
type _check_Paragraph_spaceBefore_249 = IsExact<Ref_Paragraph_spaceBefore_249, Auth_Paragraph_spaceBefore_249>;
type _assert_Paragraph_spaceBefore_249 = Expect<_check_Paragraph_spaceBefore_249>;

type Ref_Paragraph_spaceBefore_readonly_250 = { value: number };
type Auth_Paragraph_spaceBefore_readonly_250 = { value: number };
type _check_Paragraph_spaceBefore_readonly_250 = IsExact<Ref_Paragraph_spaceBefore_readonly_250, Auth_Paragraph_spaceBefore_readonly_250>;
type _assert_Paragraph_spaceBefore_readonly_250 = Expect<_check_Paragraph_spaceBefore_readonly_250>;

type Ref_Paragraph_split_251 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type Auth_Paragraph_split_251 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type _check_Paragraph_split_251 = IsExact<Ref_Paragraph_split_251, Auth_Paragraph_split_251>;
type _assert_Paragraph_split_251 = Expect<_check_Paragraph_split_251>;

type Ref_Paragraph_style_252 = () => string;
type Auth_Paragraph_style_252 = () => string;
type _check_Paragraph_style_252 = IsExact<Ref_Paragraph_style_252, Auth_Paragraph_style_252>;
type _assert_Paragraph_style_252 = Expect<_check_Paragraph_style_252>;

type Ref_Paragraph_style_readonly_253 = { value: string };
type Auth_Paragraph_style_readonly_253 = { value: string };
type _check_Paragraph_style_readonly_253 = IsExact<Ref_Paragraph_style_readonly_253, Auth_Paragraph_style_readonly_253>;
type _assert_Paragraph_style_readonly_253 = Expect<_check_Paragraph_style_readonly_253>;

type Ref_Paragraph_text_254 = () => string;
type Auth_Paragraph_text_254 = () => string;
type _check_Paragraph_text_254 = IsExact<Ref_Paragraph_text_254, Auth_Paragraph_text_254>;
type _assert_Paragraph_text_254 = Expect<_check_Paragraph_text_254>;

type Ref_Paragraph_text_readonly_255 = { readonly value: string };
type Auth_Paragraph_text_readonly_255 = { readonly value: string };
type _check_Paragraph_text_readonly_255 = IsExact<Ref_Paragraph_text_readonly_255, Auth_Paragraph_text_readonly_255>;
type _assert_Paragraph_text_readonly_255 = Expect<_check_Paragraph_text_readonly_255>;

type Ref_ParagraphCollection_getFirst_256 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getFirst_256 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getFirst_256 = IsExact<Ref_ParagraphCollection_getFirst_256, Auth_ParagraphCollection_getFirst_256>;
type _assert_ParagraphCollection_getFirst_256 = Expect<_check_ParagraphCollection_getFirst_256>;

type Ref_ParagraphCollection_getLast_257 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getLast_257 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getLast_257 = IsExact<Ref_ParagraphCollection_getLast_257, Auth_ParagraphCollection_getLast_257>;
type _assert_ParagraphCollection_getLast_257 = Expect<_check_ParagraphCollection_getLast_257>;

type Ref_ParagraphCollection_items_258 = () => DocxEditor.Paragraph[];
type Auth_ParagraphCollection_items_258 = () => DocxEditor.Paragraph[];
type _check_ParagraphCollection_items_258 = IsExact<Ref_ParagraphCollection_items_258, Auth_ParagraphCollection_items_258>;
type _assert_ParagraphCollection_items_258 = Expect<_check_ParagraphCollection_items_258>;

type Ref_ParagraphCollection_items_readonly_259 = { readonly value: DocxEditor.Paragraph[] };
type Auth_ParagraphCollection_items_readonly_259 = { readonly value: DocxEditor.Paragraph[] };
type _check_ParagraphCollection_items_readonly_259 = IsExact<Ref_ParagraphCollection_items_readonly_259, Auth_ParagraphCollection_items_readonly_259>;
type _assert_ParagraphCollection_items_readonly_259 = Expect<_check_ParagraphCollection_items_readonly_259>;

type Ref_Range_bookmarks_260 = () => DocxEditor.BookmarkCollection;
type Auth_Range_bookmarks_260 = () => DocxEditor.BookmarkCollection;
type _check_Range_bookmarks_260 = IsExact<Ref_Range_bookmarks_260, Auth_Range_bookmarks_260>;
type _assert_Range_bookmarks_260 = Expect<_check_Range_bookmarks_260>;

type Ref_Range_bookmarks_readonly_261 = { readonly value: DocxEditor.BookmarkCollection };
type Auth_Range_bookmarks_readonly_261 = { readonly value: DocxEditor.BookmarkCollection };
type _check_Range_bookmarks_readonly_261 = IsExact<Ref_Range_bookmarks_readonly_261, Auth_Range_bookmarks_readonly_261>;
type _assert_Range_bookmarks_readonly_261 = Expect<_check_Range_bookmarks_readonly_261>;

type Ref_Range_clear_262 = () => void;
type Auth_Range_clear_262 = () => void;
type _check_Range_clear_262 = IsExact<Ref_Range_clear_262, Auth_Range_clear_262>;
type _assert_Range_clear_262 = Expect<_check_Range_clear_262>;

type Ref_Range_contentControls_263 = () => DocxEditor.ContentControlCollection;
type Auth_Range_contentControls_263 = () => DocxEditor.ContentControlCollection;
type _check_Range_contentControls_263 = IsExact<Ref_Range_contentControls_263, Auth_Range_contentControls_263>;
type _assert_Range_contentControls_263 = Expect<_check_Range_contentControls_263>;

type Ref_Range_contentControls_readonly_264 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Range_contentControls_readonly_264 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Range_contentControls_readonly_264 = IsExact<Ref_Range_contentControls_readonly_264, Auth_Range_contentControls_readonly_264>;
type _assert_Range_contentControls_readonly_264 = Expect<_check_Range_contentControls_readonly_264>;

type Ref_Range_delete_265 = () => void;
type Auth_Range_delete_265 = () => void;
type _check_Range_delete_265 = IsExact<Ref_Range_delete_265, Auth_Range_delete_265>;
type _assert_Range_delete_265 = Expect<_check_Range_delete_265>;

type Ref_Range_expandTo_266 = (range: DocxEditor.Range) => DocxEditor.Range;
type Auth_Range_expandTo_266 = (range: DocxEditor.Range) => DocxEditor.Range;
type _check_Range_expandTo_266 = IsExact<Ref_Range_expandTo_266, Auth_Range_expandTo_266>;
type _assert_Range_expandTo_266 = Expect<_check_Range_expandTo_266>;

type Ref_Range_font_267 = () => DocxEditor.Font;
type Auth_Range_font_267 = () => DocxEditor.Font;
type _check_Range_font_267 = IsExact<Ref_Range_font_267, Auth_Range_font_267>;
type _assert_Range_font_267 = Expect<_check_Range_font_267>;

type Ref_Range_font_readonly_268 = { readonly value: DocxEditor.Font };
type Auth_Range_font_readonly_268 = { readonly value: DocxEditor.Font };
type _check_Range_font_readonly_268 = IsExact<Ref_Range_font_readonly_268, Auth_Range_font_readonly_268>;
type _assert_Range_font_readonly_268 = Expect<_check_Range_font_readonly_268>;

type Ref_Range_getBookmarks_269 = (includeHidden?: boolean, includeAdjacent?: boolean) => DocxEditor.ClientResult<string[]>;
type Auth_Range_getBookmarks_269 = (includeHidden?: boolean, includeAdjacent?: boolean) => DocxEditor.ClientResult<string[]>;
type _check_Range_getBookmarks_269 = IsExact<Ref_Range_getBookmarks_269, Auth_Range_getBookmarks_269>;
type _assert_Range_getBookmarks_269 = Expect<_check_Range_getBookmarks_269>;

type Ref_Range_getRange_270 = (rangeLocation?: "Whole" | "Start" | "End" | "After" | "Content") => DocxEditor.Range;
type Auth_Range_getRange_270 = (rangeLocation?: "Whole" | "Start" | "End" | "After" | "Content") => DocxEditor.Range;
type _check_Range_getRange_270 = IsExact<Ref_Range_getRange_270, Auth_Range_getRange_270>;
type _assert_Range_getRange_270 = Expect<_check_Range_getRange_270>;

type Ref_Range_getReviewedText_271 = (changeTrackingVersion?: DocxEditor.ChangeTrackingVersion) => DocxEditor.ClientResult<string>;
type Auth_Range_getReviewedText_271 = (changeTrackingVersion?: DocxEditor.ChangeTrackingVersion) => DocxEditor.ClientResult<string>;
type _check_Range_getReviewedText_271 = IsExact<Ref_Range_getReviewedText_271, Auth_Range_getReviewedText_271>;
type _assert_Range_getReviewedText_271 = Expect<_check_Range_getReviewedText_271>;

type Ref_Range_getReviewedText_272 = (changeTrackingVersion?: "Original" | "Current") => DocxEditor.ClientResult<string>;
type Auth_Range_getReviewedText_272 = (changeTrackingVersion?: "Original" | "Current") => DocxEditor.ClientResult<string>;
type _check_Range_getReviewedText_272 = IsExact<Ref_Range_getReviewedText_272, Auth_Range_getReviewedText_272>;
type _assert_Range_getReviewedText_272 = Expect<_check_Range_getReviewedText_272>;

type Ref_Range_getTextRanges_273 = (endingMarks: string[], trimSpacing?: boolean) => DocxEditor.RangeCollection;
type Auth_Range_getTextRanges_273 = (endingMarks: string[], trimSpacing?: boolean) => DocxEditor.RangeCollection;
type _check_Range_getTextRanges_273 = IsExact<Ref_Range_getTextRanges_273, Auth_Range_getTextRanges_273>;
type _assert_Range_getTextRanges_273 = Expect<_check_Range_getTextRanges_273>;

type Ref_Range_hyperlink_274 = () => string;
type Auth_Range_hyperlink_274 = () => string;
type _check_Range_hyperlink_274 = IsExact<Ref_Range_hyperlink_274, Auth_Range_hyperlink_274>;
type _assert_Range_hyperlink_274 = Expect<_check_Range_hyperlink_274>;

type Ref_Range_hyperlink_readonly_275 = { value: string };
type Auth_Range_hyperlink_readonly_275 = { value: string };
type _check_Range_hyperlink_readonly_275 = IsExact<Ref_Range_hyperlink_readonly_275, Auth_Range_hyperlink_readonly_275>;
type _assert_Range_hyperlink_readonly_275 = Expect<_check_Range_hyperlink_readonly_275>;

type Ref_Range_insertBookmark_276 = (name: string) => void;
type Auth_Range_insertBookmark_276 = (name: string) => void;
type _check_Range_insertBookmark_276 = IsExact<Ref_Range_insertBookmark_276, Auth_Range_insertBookmark_276>;
type _assert_Range_insertBookmark_276 = Expect<_check_Range_insertBookmark_276>;

type Ref_Range_insertComment_277 = (commentText: string) => DocxEditor.Comment;
type Auth_Range_insertComment_277 = (commentText: string) => DocxEditor.Comment;
type _check_Range_insertComment_277 = IsExact<Ref_Range_insertComment_277, Auth_Range_insertComment_277>;
type _assert_Range_insertComment_277 = Expect<_check_Range_insertComment_277>;

type Ref_Range_insertParagraph_278 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Range_insertParagraph_278 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Range_insertParagraph_278 = IsExact<Ref_Range_insertParagraph_278, Auth_Range_insertParagraph_278>;
type _assert_Range_insertParagraph_278 = Expect<_check_Range_insertParagraph_278>;

type Ref_Range_insertText_279 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type Auth_Range_insertText_279 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type _check_Range_insertText_279 = IsExact<Ref_Range_insertText_279, Auth_Range_insertText_279>;
type _assert_Range_insertText_279 = Expect<_check_Range_insertText_279>;

type Ref_Range_paragraphs_280 = () => DocxEditor.ParagraphCollection;
type Auth_Range_paragraphs_280 = () => DocxEditor.ParagraphCollection;
type _check_Range_paragraphs_280 = IsExact<Ref_Range_paragraphs_280, Auth_Range_paragraphs_280>;
type _assert_Range_paragraphs_280 = Expect<_check_Range_paragraphs_280>;

type Ref_Range_paragraphs_readonly_281 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Range_paragraphs_readonly_281 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Range_paragraphs_readonly_281 = IsExact<Ref_Range_paragraphs_readonly_281, Auth_Range_paragraphs_readonly_281>;
type _assert_Range_paragraphs_readonly_281 = Expect<_check_Range_paragraphs_readonly_281>;

type Ref_Range_revisions_282 = () => DocxEditor.RevisionCollection;
type Auth_Range_revisions_282 = () => DocxEditor.RevisionCollection;
type _check_Range_revisions_282 = IsExact<Ref_Range_revisions_282, Auth_Range_revisions_282>;
type _assert_Range_revisions_282 = Expect<_check_Range_revisions_282>;

type Ref_Range_revisions_readonly_283 = { readonly value: DocxEditor.RevisionCollection };
type Auth_Range_revisions_readonly_283 = { readonly value: DocxEditor.RevisionCollection };
type _check_Range_revisions_readonly_283 = IsExact<Ref_Range_revisions_readonly_283, Auth_Range_revisions_readonly_283>;
type _assert_Range_revisions_readonly_283 = Expect<_check_Range_revisions_readonly_283>;

type Ref_Range_search_284 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Range_search_284 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Range_search_284 = IsExact<Ref_Range_search_284, Auth_Range_search_284>;
type _assert_Range_search_284 = Expect<_check_Range_search_284>;

type Ref_Range_select_285 = (selectionMode?: DocxEditor.SelectionMode) => void;
type Auth_Range_select_285 = (selectionMode?: DocxEditor.SelectionMode) => void;
type _check_Range_select_285 = IsExact<Ref_Range_select_285, Auth_Range_select_285>;
type _assert_Range_select_285 = Expect<_check_Range_select_285>;

type Ref_Range_select_286 = (selectionMode?: "Select" | "Start" | "End") => void;
type Auth_Range_select_286 = (selectionMode?: "Select" | "Start" | "End") => void;
type _check_Range_select_286 = IsExact<Ref_Range_select_286, Auth_Range_select_286>;
type _assert_Range_select_286 = Expect<_check_Range_select_286>;

type Ref_Range_style_287 = () => string;
type Auth_Range_style_287 = () => string;
type _check_Range_style_287 = IsExact<Ref_Range_style_287, Auth_Range_style_287>;
type _assert_Range_style_287 = Expect<_check_Range_style_287>;

type Ref_Range_style_readonly_288 = { value: string };
type Auth_Range_style_readonly_288 = { value: string };
type _check_Range_style_readonly_288 = IsExact<Ref_Range_style_readonly_288, Auth_Range_style_readonly_288>;
type _assert_Range_style_readonly_288 = Expect<_check_Range_style_readonly_288>;

type Ref_Range_text_289 = () => string;
type Auth_Range_text_289 = () => string;
type _check_Range_text_289 = IsExact<Ref_Range_text_289, Auth_Range_text_289>;
type _assert_Range_text_289 = Expect<_check_Range_text_289>;

type Ref_Range_text_readonly_290 = { readonly value: string };
type Auth_Range_text_readonly_290 = { readonly value: string };
type _check_Range_text_readonly_290 = IsExact<Ref_Range_text_readonly_290, Auth_Range_text_readonly_290>;
type _assert_Range_text_readonly_290 = Expect<_check_Range_text_readonly_290>;

type Ref_RangeCollection_getFirst_291 = () => DocxEditor.Range;
type Auth_RangeCollection_getFirst_291 = () => DocxEditor.Range;
type _check_RangeCollection_getFirst_291 = IsExact<Ref_RangeCollection_getFirst_291, Auth_RangeCollection_getFirst_291>;
type _assert_RangeCollection_getFirst_291 = Expect<_check_RangeCollection_getFirst_291>;

type Ref_RangeCollection_items_292 = () => DocxEditor.Range[];
type Auth_RangeCollection_items_292 = () => DocxEditor.Range[];
type _check_RangeCollection_items_292 = IsExact<Ref_RangeCollection_items_292, Auth_RangeCollection_items_292>;
type _assert_RangeCollection_items_292 = Expect<_check_RangeCollection_items_292>;

type Ref_RangeCollection_items_readonly_293 = { readonly value: DocxEditor.Range[] };
type Auth_RangeCollection_items_readonly_293 = { readonly value: DocxEditor.Range[] };
type _check_RangeCollection_items_readonly_293 = IsExact<Ref_RangeCollection_items_readonly_293, Auth_RangeCollection_items_readonly_293>;
type _assert_RangeCollection_items_readonly_293 = Expect<_check_RangeCollection_items_readonly_293>;

type Ref_RequestContext_document_294 = () => DocxEditor.Document;
type Auth_RequestContext_document_294 = () => DocxEditor.Document;
type _check_RequestContext_document_294 = IsExact<Ref_RequestContext_document_294, Auth_RequestContext_document_294>;
type _assert_RequestContext_document_294 = Expect<_check_RequestContext_document_294>;

type Ref_RequestContext_document_readonly_295 = { readonly value: DocxEditor.Document };
type Auth_RequestContext_document_readonly_295 = { readonly value: DocxEditor.Document };
type _check_RequestContext_document_readonly_295 = IsExact<Ref_RequestContext_document_readonly_295, Auth_RequestContext_document_readonly_295>;
type _assert_RequestContext_document_readonly_295 = Expect<_check_RequestContext_document_readonly_295>;

type Ref_Revision_accept_296 = () => void;
type Auth_Revision_accept_296 = () => void;
type _check_Revision_accept_296 = IsExact<Ref_Revision_accept_296, Auth_Revision_accept_296>;
type _assert_Revision_accept_296 = Expect<_check_Revision_accept_296>;

type Ref_Revision_author_297 = () => string;
type Auth_Revision_author_297 = () => string;
type _check_Revision_author_297 = IsExact<Ref_Revision_author_297, Auth_Revision_author_297>;
type _assert_Revision_author_297 = Expect<_check_Revision_author_297>;

type Ref_Revision_author_readonly_298 = { readonly value: string };
type Auth_Revision_author_readonly_298 = { readonly value: string };
type _check_Revision_author_readonly_298 = IsExact<Ref_Revision_author_readonly_298, Auth_Revision_author_readonly_298>;
type _assert_Revision_author_readonly_298 = Expect<_check_Revision_author_readonly_298>;

type Ref_Revision_date_299 = () => Date;
type Auth_Revision_date_299 = () => Date;
type _check_Revision_date_299 = IsExact<Ref_Revision_date_299, Auth_Revision_date_299>;
type _assert_Revision_date_299 = Expect<_check_Revision_date_299>;

type Ref_Revision_date_readonly_300 = { readonly value: Date };
type Auth_Revision_date_readonly_300 = { readonly value: Date };
type _check_Revision_date_readonly_300 = IsExact<Ref_Revision_date_readonly_300, Auth_Revision_date_readonly_300>;
type _assert_Revision_date_readonly_300 = Expect<_check_Revision_date_readonly_300>;

type Ref_Revision_range_301 = () => DocxEditor.Range;
type Auth_Revision_range_301 = () => DocxEditor.Range;
type _check_Revision_range_301 = IsExact<Ref_Revision_range_301, Auth_Revision_range_301>;
type _assert_Revision_range_301 = Expect<_check_Revision_range_301>;

type Ref_Revision_range_readonly_302 = { readonly value: DocxEditor.Range };
type Auth_Revision_range_readonly_302 = { readonly value: DocxEditor.Range };
type _check_Revision_range_readonly_302 = IsExact<Ref_Revision_range_readonly_302, Auth_Revision_range_readonly_302>;
type _assert_Revision_range_readonly_302 = Expect<_check_Revision_range_readonly_302>;

type Ref_Revision_reject_303 = () => void;
type Auth_Revision_reject_303 = () => void;
type _check_Revision_reject_303 = IsExact<Ref_Revision_reject_303, Auth_Revision_reject_303>;
type _assert_Revision_reject_303 = Expect<_check_Revision_reject_303>;

type Ref_Revision_type_304 = () => "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete";
type Auth_Revision_type_304 = () => "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete";
type _check_Revision_type_304 = IsExact<Ref_Revision_type_304, Auth_Revision_type_304>;
type _assert_Revision_type_304 = Expect<_check_Revision_type_304>;

type Ref_Revision_type_readonly_305 = { readonly value: "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete" };
type Auth_Revision_type_readonly_305 = { readonly value: "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete" };
type _check_Revision_type_readonly_305 = IsExact<Ref_Revision_type_readonly_305, Auth_Revision_type_readonly_305>;
type _assert_Revision_type_readonly_305 = Expect<_check_Revision_type_readonly_305>;

type Ref_RevisionCollection_acceptAll_306 = () => void;
type Auth_RevisionCollection_acceptAll_306 = () => void;
type _check_RevisionCollection_acceptAll_306 = IsExact<Ref_RevisionCollection_acceptAll_306, Auth_RevisionCollection_acceptAll_306>;
type _assert_RevisionCollection_acceptAll_306 = Expect<_check_RevisionCollection_acceptAll_306>;

type Ref_RevisionCollection_items_307 = () => DocxEditor.Revision[];
type Auth_RevisionCollection_items_307 = () => DocxEditor.Revision[];
type _check_RevisionCollection_items_307 = IsExact<Ref_RevisionCollection_items_307, Auth_RevisionCollection_items_307>;
type _assert_RevisionCollection_items_307 = Expect<_check_RevisionCollection_items_307>;

type Ref_RevisionCollection_items_readonly_308 = { readonly value: DocxEditor.Revision[] };
type Auth_RevisionCollection_items_readonly_308 = { readonly value: DocxEditor.Revision[] };
type _check_RevisionCollection_items_readonly_308 = IsExact<Ref_RevisionCollection_items_readonly_308, Auth_RevisionCollection_items_readonly_308>;
type _assert_RevisionCollection_items_readonly_308 = Expect<_check_RevisionCollection_items_readonly_308>;

type Ref_RevisionCollection_rejectAll_309 = () => void;
type Auth_RevisionCollection_rejectAll_309 = () => void;
type _check_RevisionCollection_rejectAll_309 = IsExact<Ref_RevisionCollection_rejectAll_309, Auth_RevisionCollection_rejectAll_309>;
type _assert_RevisionCollection_rejectAll_309 = Expect<_check_RevisionCollection_rejectAll_309>;

type Ref_SearchOptions_ignorePunct_310 = () => boolean;
type Auth_SearchOptions_ignorePunct_310 = () => boolean;
type _check_SearchOptions_ignorePunct_310 = IsExact<Ref_SearchOptions_ignorePunct_310, Auth_SearchOptions_ignorePunct_310>;
type _assert_SearchOptions_ignorePunct_310 = Expect<_check_SearchOptions_ignorePunct_310>;

type Ref_SearchOptions_ignorePunct_readonly_311 = { value: boolean };
type Auth_SearchOptions_ignorePunct_readonly_311 = { value: boolean };
type _check_SearchOptions_ignorePunct_readonly_311 = IsExact<Ref_SearchOptions_ignorePunct_readonly_311, Auth_SearchOptions_ignorePunct_readonly_311>;
type _assert_SearchOptions_ignorePunct_readonly_311 = Expect<_check_SearchOptions_ignorePunct_readonly_311>;

type Ref_SearchOptions_ignoreSpace_312 = () => boolean;
type Auth_SearchOptions_ignoreSpace_312 = () => boolean;
type _check_SearchOptions_ignoreSpace_312 = IsExact<Ref_SearchOptions_ignoreSpace_312, Auth_SearchOptions_ignoreSpace_312>;
type _assert_SearchOptions_ignoreSpace_312 = Expect<_check_SearchOptions_ignoreSpace_312>;

type Ref_SearchOptions_ignoreSpace_readonly_313 = { value: boolean };
type Auth_SearchOptions_ignoreSpace_readonly_313 = { value: boolean };
type _check_SearchOptions_ignoreSpace_readonly_313 = IsExact<Ref_SearchOptions_ignoreSpace_readonly_313, Auth_SearchOptions_ignoreSpace_readonly_313>;
type _assert_SearchOptions_ignoreSpace_readonly_313 = Expect<_check_SearchOptions_ignoreSpace_readonly_313>;

type Ref_SearchOptions_matchCase_314 = () => boolean;
type Auth_SearchOptions_matchCase_314 = () => boolean;
type _check_SearchOptions_matchCase_314 = IsExact<Ref_SearchOptions_matchCase_314, Auth_SearchOptions_matchCase_314>;
type _assert_SearchOptions_matchCase_314 = Expect<_check_SearchOptions_matchCase_314>;

type Ref_SearchOptions_matchCase_readonly_315 = { value: boolean };
type Auth_SearchOptions_matchCase_readonly_315 = { value: boolean };
type _check_SearchOptions_matchCase_readonly_315 = IsExact<Ref_SearchOptions_matchCase_readonly_315, Auth_SearchOptions_matchCase_readonly_315>;
type _assert_SearchOptions_matchCase_readonly_315 = Expect<_check_SearchOptions_matchCase_readonly_315>;

type Ref_SearchOptions_matchWholeWord_316 = () => boolean;
type Auth_SearchOptions_matchWholeWord_316 = () => boolean;
type _check_SearchOptions_matchWholeWord_316 = IsExact<Ref_SearchOptions_matchWholeWord_316, Auth_SearchOptions_matchWholeWord_316>;
type _assert_SearchOptions_matchWholeWord_316 = Expect<_check_SearchOptions_matchWholeWord_316>;

type Ref_SearchOptions_matchWholeWord_readonly_317 = { value: boolean };
type Auth_SearchOptions_matchWholeWord_readonly_317 = { value: boolean };
type _check_SearchOptions_matchWholeWord_readonly_317 = IsExact<Ref_SearchOptions_matchWholeWord_readonly_317, Auth_SearchOptions_matchWholeWord_readonly_317>;
type _assert_SearchOptions_matchWholeWord_readonly_317 = Expect<_check_SearchOptions_matchWholeWord_readonly_317>;

type Ref_SearchOptions_matchWildcards_318 = () => boolean;
type Auth_SearchOptions_matchWildcards_318 = () => boolean;
type _check_SearchOptions_matchWildcards_318 = IsExact<Ref_SearchOptions_matchWildcards_318, Auth_SearchOptions_matchWildcards_318>;
type _assert_SearchOptions_matchWildcards_318 = Expect<_check_SearchOptions_matchWildcards_318>;

type Ref_SearchOptions_matchWildcards_readonly_319 = { value: boolean };
type Auth_SearchOptions_matchWildcards_readonly_319 = { value: boolean };
type _check_SearchOptions_matchWildcards_readonly_319 = IsExact<Ref_SearchOptions_matchWildcards_readonly_319, Auth_SearchOptions_matchWildcards_readonly_319>;
type _assert_SearchOptions_matchWildcards_readonly_319 = Expect<_check_SearchOptions_matchWildcards_readonly_319>;

type Ref_Section_body_320 = () => DocxEditor.Body;
type Auth_Section_body_320 = () => DocxEditor.Body;
type _check_Section_body_320 = IsExact<Ref_Section_body_320, Auth_Section_body_320>;
type _assert_Section_body_320 = Expect<_check_Section_body_320>;

type Ref_Section_body_readonly_321 = { readonly value: DocxEditor.Body };
type Auth_Section_body_readonly_321 = { readonly value: DocxEditor.Body };
type _check_Section_body_readonly_321 = IsExact<Ref_Section_body_readonly_321, Auth_Section_body_readonly_321>;
type _assert_Section_body_readonly_321 = Expect<_check_Section_body_readonly_321>;

type Ref_Section_getFooter_322 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type Auth_Section_getFooter_322 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type _check_Section_getFooter_322 = IsExact<Ref_Section_getFooter_322, Auth_Section_getFooter_322>;
type _assert_Section_getFooter_322 = Expect<_check_Section_getFooter_322>;

type Ref_Section_getFooter_323 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type Auth_Section_getFooter_323 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type _check_Section_getFooter_323 = IsExact<Ref_Section_getFooter_323, Auth_Section_getFooter_323>;
type _assert_Section_getFooter_323 = Expect<_check_Section_getFooter_323>;

type Ref_Section_getHeader_324 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type Auth_Section_getHeader_324 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type _check_Section_getHeader_324 = IsExact<Ref_Section_getHeader_324, Auth_Section_getHeader_324>;
type _assert_Section_getHeader_324 = Expect<_check_Section_getHeader_324>;

type Ref_Section_getHeader_325 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type Auth_Section_getHeader_325 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type _check_Section_getHeader_325 = IsExact<Ref_Section_getHeader_325, Auth_Section_getHeader_325>;
type _assert_Section_getHeader_325 = Expect<_check_Section_getHeader_325>;

type Ref_Section_getNext_326 = () => DocxEditor.Section;
type Auth_Section_getNext_326 = () => DocxEditor.Section;
type _check_Section_getNext_326 = IsExact<Ref_Section_getNext_326, Auth_Section_getNext_326>;
type _assert_Section_getNext_326 = Expect<_check_Section_getNext_326>;

type Ref_Section_pageSetup_327 = () => DocxEditor.PageSetup;
type Auth_Section_pageSetup_327 = () => DocxEditor.PageSetup;
type _check_Section_pageSetup_327 = IsExact<Ref_Section_pageSetup_327, Auth_Section_pageSetup_327>;
type _assert_Section_pageSetup_327 = Expect<_check_Section_pageSetup_327>;

type Ref_Section_pageSetup_readonly_328 = { readonly value: DocxEditor.PageSetup };
type Auth_Section_pageSetup_readonly_328 = { readonly value: DocxEditor.PageSetup };
type _check_Section_pageSetup_readonly_328 = IsExact<Ref_Section_pageSetup_readonly_328, Auth_Section_pageSetup_readonly_328>;
type _assert_Section_pageSetup_readonly_328 = Expect<_check_Section_pageSetup_readonly_328>;

type Ref_SectionCollection_getFirst_329 = () => DocxEditor.Section;
type Auth_SectionCollection_getFirst_329 = () => DocxEditor.Section;
type _check_SectionCollection_getFirst_329 = IsExact<Ref_SectionCollection_getFirst_329, Auth_SectionCollection_getFirst_329>;
type _assert_SectionCollection_getFirst_329 = Expect<_check_SectionCollection_getFirst_329>;

type Ref_SectionCollection_items_330 = () => DocxEditor.Section[];
type Auth_SectionCollection_items_330 = () => DocxEditor.Section[];
type _check_SectionCollection_items_330 = IsExact<Ref_SectionCollection_items_330, Auth_SectionCollection_items_330>;
type _assert_SectionCollection_items_330 = Expect<_check_SectionCollection_items_330>;

type Ref_SectionCollection_items_readonly_331 = { readonly value: DocxEditor.Section[] };
type Auth_SectionCollection_items_readonly_331 = { readonly value: DocxEditor.Section[] };
type _check_SectionCollection_items_readonly_331 = IsExact<Ref_SectionCollection_items_readonly_331, Auth_SectionCollection_items_readonly_331>;
type _assert_SectionCollection_items_readonly_331 = Expect<_check_SectionCollection_items_readonly_331>;

type Ref_Style_baseStyle_332 = () => string;
type Auth_Style_baseStyle_332 = () => string;
type _check_Style_baseStyle_332 = IsExact<Ref_Style_baseStyle_332, Auth_Style_baseStyle_332>;
type _assert_Style_baseStyle_332 = Expect<_check_Style_baseStyle_332>;

type Ref_Style_baseStyle_readonly_333 = { value: string };
type Auth_Style_baseStyle_readonly_333 = { value: string };
type _check_Style_baseStyle_readonly_333 = IsExact<Ref_Style_baseStyle_readonly_333, Auth_Style_baseStyle_readonly_333>;
type _assert_Style_baseStyle_readonly_333 = Expect<_check_Style_baseStyle_readonly_333>;

type Ref_Style_builtIn_334 = () => boolean;
type Auth_Style_builtIn_334 = () => boolean;
type _check_Style_builtIn_334 = IsExact<Ref_Style_builtIn_334, Auth_Style_builtIn_334>;
type _assert_Style_builtIn_334 = Expect<_check_Style_builtIn_334>;

type Ref_Style_builtIn_readonly_335 = { readonly value: boolean };
type Auth_Style_builtIn_readonly_335 = { readonly value: boolean };
type _check_Style_builtIn_readonly_335 = IsExact<Ref_Style_builtIn_readonly_335, Auth_Style_builtIn_readonly_335>;
type _assert_Style_builtIn_readonly_335 = Expect<_check_Style_builtIn_readonly_335>;

type Ref_Style_linked_336 = () => boolean;
type Auth_Style_linked_336 = () => boolean;
type _check_Style_linked_336 = IsExact<Ref_Style_linked_336, Auth_Style_linked_336>;
type _assert_Style_linked_336 = Expect<_check_Style_linked_336>;

type Ref_Style_linked_readonly_337 = { readonly value: boolean };
type Auth_Style_linked_readonly_337 = { readonly value: boolean };
type _check_Style_linked_readonly_337 = IsExact<Ref_Style_linked_readonly_337, Auth_Style_linked_readonly_337>;
type _assert_Style_linked_readonly_337 = Expect<_check_Style_linked_readonly_337>;

type Ref_Style_nameLocal_338 = () => string;
type Auth_Style_nameLocal_338 = () => string;
type _check_Style_nameLocal_338 = IsExact<Ref_Style_nameLocal_338, Auth_Style_nameLocal_338>;
type _assert_Style_nameLocal_338 = Expect<_check_Style_nameLocal_338>;

type Ref_Style_nameLocal_readonly_339 = { readonly value: string };
type Auth_Style_nameLocal_readonly_339 = { readonly value: string };
type _check_Style_nameLocal_readonly_339 = IsExact<Ref_Style_nameLocal_readonly_339, Auth_Style_nameLocal_readonly_339>;
type _assert_Style_nameLocal_readonly_339 = Expect<_check_Style_nameLocal_readonly_339>;

type Ref_Style_nextParagraphStyle_340 = () => string;
type Auth_Style_nextParagraphStyle_340 = () => string;
type _check_Style_nextParagraphStyle_340 = IsExact<Ref_Style_nextParagraphStyle_340, Auth_Style_nextParagraphStyle_340>;
type _assert_Style_nextParagraphStyle_340 = Expect<_check_Style_nextParagraphStyle_340>;

type Ref_Style_nextParagraphStyle_readonly_341 = { value: string };
type Auth_Style_nextParagraphStyle_readonly_341 = { value: string };
type _check_Style_nextParagraphStyle_readonly_341 = IsExact<Ref_Style_nextParagraphStyle_readonly_341, Auth_Style_nextParagraphStyle_readonly_341>;
type _assert_Style_nextParagraphStyle_readonly_341 = Expect<_check_Style_nextParagraphStyle_readonly_341>;

type Ref_Style_priority_342 = () => number;
type Auth_Style_priority_342 = () => number;
type _check_Style_priority_342 = IsExact<Ref_Style_priority_342, Auth_Style_priority_342>;
type _assert_Style_priority_342 = Expect<_check_Style_priority_342>;

type Ref_Style_priority_readonly_343 = { value: number };
type Auth_Style_priority_readonly_343 = { value: number };
type _check_Style_priority_readonly_343 = IsExact<Ref_Style_priority_readonly_343, Auth_Style_priority_readonly_343>;
type _assert_Style_priority_readonly_343 = Expect<_check_Style_priority_readonly_343>;

type Ref_Style_quickStyle_344 = () => boolean;
type Auth_Style_quickStyle_344 = () => boolean;
type _check_Style_quickStyle_344 = IsExact<Ref_Style_quickStyle_344, Auth_Style_quickStyle_344>;
type _assert_Style_quickStyle_344 = Expect<_check_Style_quickStyle_344>;

type Ref_Style_quickStyle_readonly_345 = { value: boolean };
type Auth_Style_quickStyle_readonly_345 = { value: boolean };
type _check_Style_quickStyle_readonly_345 = IsExact<Ref_Style_quickStyle_readonly_345, Auth_Style_quickStyle_readonly_345>;
type _assert_Style_quickStyle_readonly_345 = Expect<_check_Style_quickStyle_readonly_345>;

type Ref_Style_type_346 = () => "Character" | "List" | "Paragraph" | "Table";
type Auth_Style_type_346 = () => "Character" | "List" | "Paragraph" | "Table";
type _check_Style_type_346 = IsExact<Ref_Style_type_346, Auth_Style_type_346>;
type _assert_Style_type_346 = Expect<_check_Style_type_346>;

type Ref_Style_type_readonly_347 = { readonly value: "Character" | "List" | "Paragraph" | "Table" };
type Auth_Style_type_readonly_347 = { readonly value: "Character" | "List" | "Paragraph" | "Table" };
type _check_Style_type_readonly_347 = IsExact<Ref_Style_type_readonly_347, Auth_Style_type_readonly_347>;
type _assert_Style_type_readonly_347 = Expect<_check_Style_type_readonly_347>;

type Ref_Style_unhideWhenUsed_348 = () => boolean;
type Auth_Style_unhideWhenUsed_348 = () => boolean;
type _check_Style_unhideWhenUsed_348 = IsExact<Ref_Style_unhideWhenUsed_348, Auth_Style_unhideWhenUsed_348>;
type _assert_Style_unhideWhenUsed_348 = Expect<_check_Style_unhideWhenUsed_348>;

type Ref_Style_unhideWhenUsed_readonly_349 = { value: boolean };
type Auth_Style_unhideWhenUsed_readonly_349 = { value: boolean };
type _check_Style_unhideWhenUsed_readonly_349 = IsExact<Ref_Style_unhideWhenUsed_readonly_349, Auth_Style_unhideWhenUsed_readonly_349>;
type _assert_Style_unhideWhenUsed_readonly_349 = Expect<_check_Style_unhideWhenUsed_readonly_349>;

type Ref_Style_visibility_350 = () => boolean;
type Auth_Style_visibility_350 = () => boolean;
type _check_Style_visibility_350 = IsExact<Ref_Style_visibility_350, Auth_Style_visibility_350>;
type _assert_Style_visibility_350 = Expect<_check_Style_visibility_350>;

type Ref_Style_visibility_readonly_351 = { value: boolean };
type Auth_Style_visibility_readonly_351 = { value: boolean };
type _check_Style_visibility_readonly_351 = IsExact<Ref_Style_visibility_readonly_351, Auth_Style_visibility_readonly_351>;
type _assert_Style_visibility_readonly_351 = Expect<_check_Style_visibility_readonly_351>;

type Ref_StyleCollection_getByNameOrNullObject_352 = (name: string) => DocxEditor.Style;
type Auth_StyleCollection_getByNameOrNullObject_352 = (name: string) => DocxEditor.Style;
type _check_StyleCollection_getByNameOrNullObject_352 = IsExact<Ref_StyleCollection_getByNameOrNullObject_352, Auth_StyleCollection_getByNameOrNullObject_352>;
type _assert_StyleCollection_getByNameOrNullObject_352 = Expect<_check_StyleCollection_getByNameOrNullObject_352>;

type Ref_StyleCollection_getCount_353 = () => DocxEditor.ClientResult<number>;
type Auth_StyleCollection_getCount_353 = () => DocxEditor.ClientResult<number>;
type _check_StyleCollection_getCount_353 = IsExact<Ref_StyleCollection_getCount_353, Auth_StyleCollection_getCount_353>;
type _assert_StyleCollection_getCount_353 = Expect<_check_StyleCollection_getCount_353>;

type Ref_StyleCollection_items_354 = () => DocxEditor.Style[];
type Auth_StyleCollection_items_354 = () => DocxEditor.Style[];
type _check_StyleCollection_items_354 = IsExact<Ref_StyleCollection_items_354, Auth_StyleCollection_items_354>;
type _assert_StyleCollection_items_354 = Expect<_check_StyleCollection_items_354>;

type Ref_StyleCollection_items_readonly_355 = { readonly value: DocxEditor.Style[] };
type Auth_StyleCollection_items_readonly_355 = { readonly value: DocxEditor.Style[] };
type _check_StyleCollection_items_readonly_355 = IsExact<Ref_StyleCollection_items_readonly_355, Auth_StyleCollection_items_readonly_355>;
type _assert_StyleCollection_items_readonly_355 = Expect<_check_StyleCollection_items_readonly_355>;

type Ref_run_356 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_356 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_356 = IsExact<Ref_run_356, Auth_run_356>;
type _assert_run_356 = Expect<_check_run_356>;

type Ref_run_357 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_357 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_357 = IsExact<Ref_run_357, Auth_run_357>;
type _assert_run_357 = Expect<_check_run_357>;

type Ref_run_358 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_358 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_358 = IsExact<Ref_run_358, Auth_run_358>;
type _assert_run_358 = Expect<_check_run_358>;

