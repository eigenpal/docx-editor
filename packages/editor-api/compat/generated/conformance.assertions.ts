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

type Ref_Body_clear_0 = () => void;
type Auth_Body_clear_0 = () => void;
type _check_Body_clear_0 = IsExact<Ref_Body_clear_0, Auth_Body_clear_0>;
type _assert_Body_clear_0 = Expect<_check_Body_clear_0>;

type Ref_Body_contentControls_1 = () => DocxEditor.ContentControlCollection;
type Auth_Body_contentControls_1 = () => DocxEditor.ContentControlCollection;
type _check_Body_contentControls_1 = IsExact<Ref_Body_contentControls_1, Auth_Body_contentControls_1>;
type _assert_Body_contentControls_1 = Expect<_check_Body_contentControls_1>;

type Ref_Body_contentControls_readonly_2 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Body_contentControls_readonly_2 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Body_contentControls_readonly_2 = IsExact<Ref_Body_contentControls_readonly_2, Auth_Body_contentControls_readonly_2>;
type _assert_Body_contentControls_readonly_2 = Expect<_check_Body_contentControls_readonly_2>;

type Ref_Body_endnotes_3 = () => DocxEditor.NoteItemCollection;
type Auth_Body_endnotes_3 = () => DocxEditor.NoteItemCollection;
type _check_Body_endnotes_3 = IsExact<Ref_Body_endnotes_3, Auth_Body_endnotes_3>;
type _assert_Body_endnotes_3 = Expect<_check_Body_endnotes_3>;

type Ref_Body_endnotes_readonly_4 = { readonly value: DocxEditor.NoteItemCollection };
type Auth_Body_endnotes_readonly_4 = { readonly value: DocxEditor.NoteItemCollection };
type _check_Body_endnotes_readonly_4 = IsExact<Ref_Body_endnotes_readonly_4, Auth_Body_endnotes_readonly_4>;
type _assert_Body_endnotes_readonly_4 = Expect<_check_Body_endnotes_readonly_4>;

type Ref_Body_font_5 = () => DocxEditor.Font;
type Auth_Body_font_5 = () => DocxEditor.Font;
type _check_Body_font_5 = IsExact<Ref_Body_font_5, Auth_Body_font_5>;
type _assert_Body_font_5 = Expect<_check_Body_font_5>;

type Ref_Body_font_readonly_6 = { readonly value: DocxEditor.Font };
type Auth_Body_font_readonly_6 = { readonly value: DocxEditor.Font };
type _check_Body_font_readonly_6 = IsExact<Ref_Body_font_readonly_6, Auth_Body_font_readonly_6>;
type _assert_Body_font_readonly_6 = Expect<_check_Body_font_readonly_6>;

type Ref_Body_footnotes_7 = () => DocxEditor.NoteItemCollection;
type Auth_Body_footnotes_7 = () => DocxEditor.NoteItemCollection;
type _check_Body_footnotes_7 = IsExact<Ref_Body_footnotes_7, Auth_Body_footnotes_7>;
type _assert_Body_footnotes_7 = Expect<_check_Body_footnotes_7>;

type Ref_Body_footnotes_readonly_8 = { readonly value: DocxEditor.NoteItemCollection };
type Auth_Body_footnotes_readonly_8 = { readonly value: DocxEditor.NoteItemCollection };
type _check_Body_footnotes_readonly_8 = IsExact<Ref_Body_footnotes_readonly_8, Auth_Body_footnotes_readonly_8>;
type _assert_Body_footnotes_readonly_8 = Expect<_check_Body_footnotes_readonly_8>;

type Ref_Body_getComments_9 = () => DocxEditor.CommentCollection;
type Auth_Body_getComments_9 = () => DocxEditor.CommentCollection;
type _check_Body_getComments_9 = IsExact<Ref_Body_getComments_9, Auth_Body_getComments_9>;
type _assert_Body_getComments_9 = Expect<_check_Body_getComments_9>;

type Ref_Body_insertFileFromBase64_10 = (base64File: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Body_insertFileFromBase64_10 = (base64File: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Body_insertFileFromBase64_10 = IsExact<Ref_Body_insertFileFromBase64_10, Auth_Body_insertFileFromBase64_10>;
type _assert_Body_insertFileFromBase64_10 = Expect<_check_Body_insertFileFromBase64_10>;

type Ref_Body_insertParagraph_11 = (paragraphText: string, insertLocation: "Start" | "End") => DocxEditor.Paragraph;
type Auth_Body_insertParagraph_11 = (paragraphText: string, insertLocation: "Start" | "End") => DocxEditor.Paragraph;
type _check_Body_insertParagraph_11 = IsExact<Ref_Body_insertParagraph_11, Auth_Body_insertParagraph_11>;
type _assert_Body_insertParagraph_11 = Expect<_check_Body_insertParagraph_11>;

type Ref_Body_insertText_12 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Body_insertText_12 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Body_insertText_12 = IsExact<Ref_Body_insertText_12, Auth_Body_insertText_12>;
type _assert_Body_insertText_12 = Expect<_check_Body_insertText_12>;

type Ref_Body_lists_13 = () => DocxEditor.ListCollection;
type Auth_Body_lists_13 = () => DocxEditor.ListCollection;
type _check_Body_lists_13 = IsExact<Ref_Body_lists_13, Auth_Body_lists_13>;
type _assert_Body_lists_13 = Expect<_check_Body_lists_13>;

type Ref_Body_lists_readonly_14 = { readonly value: DocxEditor.ListCollection };
type Auth_Body_lists_readonly_14 = { readonly value: DocxEditor.ListCollection };
type _check_Body_lists_readonly_14 = IsExact<Ref_Body_lists_readonly_14, Auth_Body_lists_readonly_14>;
type _assert_Body_lists_readonly_14 = Expect<_check_Body_lists_readonly_14>;

type Ref_Body_paragraphs_15 = () => DocxEditor.ParagraphCollection;
type Auth_Body_paragraphs_15 = () => DocxEditor.ParagraphCollection;
type _check_Body_paragraphs_15 = IsExact<Ref_Body_paragraphs_15, Auth_Body_paragraphs_15>;
type _assert_Body_paragraphs_15 = Expect<_check_Body_paragraphs_15>;

type Ref_Body_paragraphs_readonly_16 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Body_paragraphs_readonly_16 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Body_paragraphs_readonly_16 = IsExact<Ref_Body_paragraphs_readonly_16, Auth_Body_paragraphs_readonly_16>;
type _assert_Body_paragraphs_readonly_16 = Expect<_check_Body_paragraphs_readonly_16>;

type Ref_Body_search_17 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Body_search_17 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Body_search_17 = IsExact<Ref_Body_search_17, Auth_Body_search_17>;
type _assert_Body_search_17 = Expect<_check_Body_search_17>;

type Ref_Body_style_18 = () => string;
type Auth_Body_style_18 = () => string;
type _check_Body_style_18 = IsExact<Ref_Body_style_18, Auth_Body_style_18>;
type _assert_Body_style_18 = Expect<_check_Body_style_18>;

type Ref_Body_style_readonly_19 = { value: string };
type Auth_Body_style_readonly_19 = { value: string };
type _check_Body_style_readonly_19 = IsExact<Ref_Body_style_readonly_19, Auth_Body_style_readonly_19>;
type _assert_Body_style_readonly_19 = Expect<_check_Body_style_readonly_19>;

type Ref_Body_text_20 = () => string;
type Auth_Body_text_20 = () => string;
type _check_Body_text_20 = IsExact<Ref_Body_text_20, Auth_Body_text_20>;
type _assert_Body_text_20 = Expect<_check_Body_text_20>;

type Ref_Body_text_readonly_21 = { readonly value: string };
type Auth_Body_text_readonly_21 = { readonly value: string };
type _check_Body_text_readonly_21 = IsExact<Ref_Body_text_readonly_21, Auth_Body_text_readonly_21>;
type _assert_Body_text_readonly_21 = Expect<_check_Body_text_readonly_21>;

type Ref_Bookmark_delete_22 = () => void;
type Auth_Bookmark_delete_22 = () => void;
type _check_Bookmark_delete_22 = IsExact<Ref_Bookmark_delete_22, Auth_Bookmark_delete_22>;
type _assert_Bookmark_delete_22 = Expect<_check_Bookmark_delete_22>;

type Ref_Bookmark_name_23 = () => string;
type Auth_Bookmark_name_23 = () => string;
type _check_Bookmark_name_23 = IsExact<Ref_Bookmark_name_23, Auth_Bookmark_name_23>;
type _assert_Bookmark_name_23 = Expect<_check_Bookmark_name_23>;

type Ref_Bookmark_name_readonly_24 = { readonly value: string };
type Auth_Bookmark_name_readonly_24 = { readonly value: string };
type _check_Bookmark_name_readonly_24 = IsExact<Ref_Bookmark_name_readonly_24, Auth_Bookmark_name_readonly_24>;
type _assert_Bookmark_name_readonly_24 = Expect<_check_Bookmark_name_readonly_24>;

type Ref_Bookmark_range_25 = () => DocxEditor.Range;
type Auth_Bookmark_range_25 = () => DocxEditor.Range;
type _check_Bookmark_range_25 = IsExact<Ref_Bookmark_range_25, Auth_Bookmark_range_25>;
type _assert_Bookmark_range_25 = Expect<_check_Bookmark_range_25>;

type Ref_Bookmark_range_readonly_26 = { readonly value: DocxEditor.Range };
type Auth_Bookmark_range_readonly_26 = { readonly value: DocxEditor.Range };
type _check_Bookmark_range_readonly_26 = IsExact<Ref_Bookmark_range_readonly_26, Auth_Bookmark_range_readonly_26>;
type _assert_Bookmark_range_readonly_26 = Expect<_check_Bookmark_range_readonly_26>;

type Ref_Bookmark_select_27 = () => void;
type Auth_Bookmark_select_27 = () => void;
type _check_Bookmark_select_27 = IsExact<Ref_Bookmark_select_27, Auth_Bookmark_select_27>;
type _assert_Bookmark_select_27 = Expect<_check_Bookmark_select_27>;

type Ref_BookmarkCollection_items_28 = () => DocxEditor.Bookmark[];
type Auth_BookmarkCollection_items_28 = () => DocxEditor.Bookmark[];
type _check_BookmarkCollection_items_28 = IsExact<Ref_BookmarkCollection_items_28, Auth_BookmarkCollection_items_28>;
type _assert_BookmarkCollection_items_28 = Expect<_check_BookmarkCollection_items_28>;

type Ref_BookmarkCollection_items_readonly_29 = { readonly value: DocxEditor.Bookmark[] };
type Auth_BookmarkCollection_items_readonly_29 = { readonly value: DocxEditor.Bookmark[] };
type _check_BookmarkCollection_items_readonly_29 = IsExact<Ref_BookmarkCollection_items_readonly_29, Auth_BookmarkCollection_items_readonly_29>;
type _assert_BookmarkCollection_items_readonly_29 = Expect<_check_BookmarkCollection_items_readonly_29>;

type Ref_BorderUniversal_color_30 = () => string;
type Auth_BorderUniversal_color_30 = () => string;
type _check_BorderUniversal_color_30 = IsExact<Ref_BorderUniversal_color_30, Auth_BorderUniversal_color_30>;
type _assert_BorderUniversal_color_30 = Expect<_check_BorderUniversal_color_30>;

type Ref_BorderUniversal_color_readonly_31 = { value: string };
type Auth_BorderUniversal_color_readonly_31 = { value: string };
type _check_BorderUniversal_color_readonly_31 = IsExact<Ref_BorderUniversal_color_readonly_31, Auth_BorderUniversal_color_readonly_31>;
type _assert_BorderUniversal_color_readonly_31 = Expect<_check_BorderUniversal_color_readonly_31>;

type Ref_BorderUniversal_colorIndex_32 = () => "Auto" | "Black" | "Blue" | "Turquoise" | "BrightGreen" | "Pink" | "Red" | "Yellow" | "White" | "DarkBlue" | "Teal" | "Green" | "Violet" | "DarkRed" | "DarkYellow" | "Gray50" | "Gray25" | "ClassicRed" | "ClassicBlue" | "ByAuthor";
type Auth_BorderUniversal_colorIndex_32 = () => "Auto" | "Black" | "Blue" | "Turquoise" | "BrightGreen" | "Pink" | "Red" | "Yellow" | "White" | "DarkBlue" | "Teal" | "Green" | "Violet" | "DarkRed" | "DarkYellow" | "Gray50" | "Gray25" | "ClassicRed" | "ClassicBlue" | "ByAuthor";
type _check_BorderUniversal_colorIndex_32 = IsExact<Ref_BorderUniversal_colorIndex_32, Auth_BorderUniversal_colorIndex_32>;
type _assert_BorderUniversal_colorIndex_32 = Expect<_check_BorderUniversal_colorIndex_32>;

type Ref_BorderUniversal_colorIndex_readonly_33 = { value: "Auto" | "Black" | "Blue" | "Turquoise" | "BrightGreen" | "Pink" | "Red" | "Yellow" | "White" | "DarkBlue" | "Teal" | "Green" | "Violet" | "DarkRed" | "DarkYellow" | "Gray50" | "Gray25" | "ClassicRed" | "ClassicBlue" | "ByAuthor" };
type Auth_BorderUniversal_colorIndex_readonly_33 = { value: "Auto" | "Black" | "Blue" | "Turquoise" | "BrightGreen" | "Pink" | "Red" | "Yellow" | "White" | "DarkBlue" | "Teal" | "Green" | "Violet" | "DarkRed" | "DarkYellow" | "Gray50" | "Gray25" | "ClassicRed" | "ClassicBlue" | "ByAuthor" };
type _check_BorderUniversal_colorIndex_readonly_33 = IsExact<Ref_BorderUniversal_colorIndex_readonly_33, Auth_BorderUniversal_colorIndex_readonly_33>;
type _assert_BorderUniversal_colorIndex_readonly_33 = Expect<_check_BorderUniversal_colorIndex_readonly_33>;

type Ref_BorderUniversal_inside_34 = () => boolean;
type Auth_BorderUniversal_inside_34 = () => boolean;
type _check_BorderUniversal_inside_34 = IsExact<Ref_BorderUniversal_inside_34, Auth_BorderUniversal_inside_34>;
type _assert_BorderUniversal_inside_34 = Expect<_check_BorderUniversal_inside_34>;

type Ref_BorderUniversal_inside_readonly_35 = { readonly value: boolean };
type Auth_BorderUniversal_inside_readonly_35 = { readonly value: boolean };
type _check_BorderUniversal_inside_readonly_35 = IsExact<Ref_BorderUniversal_inside_readonly_35, Auth_BorderUniversal_inside_readonly_35>;
type _assert_BorderUniversal_inside_readonly_35 = Expect<_check_BorderUniversal_inside_readonly_35>;

type Ref_BorderUniversal_isVisible_36 = () => boolean;
type Auth_BorderUniversal_isVisible_36 = () => boolean;
type _check_BorderUniversal_isVisible_36 = IsExact<Ref_BorderUniversal_isVisible_36, Auth_BorderUniversal_isVisible_36>;
type _assert_BorderUniversal_isVisible_36 = Expect<_check_BorderUniversal_isVisible_36>;

type Ref_BorderUniversal_isVisible_readonly_37 = { value: boolean };
type Auth_BorderUniversal_isVisible_readonly_37 = { value: boolean };
type _check_BorderUniversal_isVisible_readonly_37 = IsExact<Ref_BorderUniversal_isVisible_readonly_37, Auth_BorderUniversal_isVisible_readonly_37>;
type _assert_BorderUniversal_isVisible_readonly_37 = Expect<_check_BorderUniversal_isVisible_readonly_37>;

type Ref_BorderUniversal_lineStyle_38 = () => "None" | "Single" | "Dot" | "DashSmallGap" | "DashLargeGap" | "DashDot" | "DashDotDot" | "Double" | "Triple" | "ThinThickSmallGap" | "ThickThinSmallGap" | "ThinThickThinSmallGap" | "ThinThickMedGap" | "ThickThinMedGap" | "ThinThickThinMedGap" | "ThinThickLargeGap" | "ThickThinLargeGap" | "ThinThickThinLargeGap" | "SingleWavy" | "DoubleWavy" | "DashDotStroked" | "Emboss3D" | "Engrave3D" | "Outset" | "Inset";
type Auth_BorderUniversal_lineStyle_38 = () => "None" | "Single" | "Dot" | "DashSmallGap" | "DashLargeGap" | "DashDot" | "DashDotDot" | "Double" | "Triple" | "ThinThickSmallGap" | "ThickThinSmallGap" | "ThinThickThinSmallGap" | "ThinThickMedGap" | "ThickThinMedGap" | "ThinThickThinMedGap" | "ThinThickLargeGap" | "ThickThinLargeGap" | "ThinThickThinLargeGap" | "SingleWavy" | "DoubleWavy" | "DashDotStroked" | "Emboss3D" | "Engrave3D" | "Outset" | "Inset";
type _check_BorderUniversal_lineStyle_38 = IsExact<Ref_BorderUniversal_lineStyle_38, Auth_BorderUniversal_lineStyle_38>;
type _assert_BorderUniversal_lineStyle_38 = Expect<_check_BorderUniversal_lineStyle_38>;

type Ref_BorderUniversal_lineStyle_readonly_39 = { value: "None" | "Single" | "Dot" | "DashSmallGap" | "DashLargeGap" | "DashDot" | "DashDotDot" | "Double" | "Triple" | "ThinThickSmallGap" | "ThickThinSmallGap" | "ThinThickThinSmallGap" | "ThinThickMedGap" | "ThickThinMedGap" | "ThinThickThinMedGap" | "ThinThickLargeGap" | "ThickThinLargeGap" | "ThinThickThinLargeGap" | "SingleWavy" | "DoubleWavy" | "DashDotStroked" | "Emboss3D" | "Engrave3D" | "Outset" | "Inset" };
type Auth_BorderUniversal_lineStyle_readonly_39 = { value: "None" | "Single" | "Dot" | "DashSmallGap" | "DashLargeGap" | "DashDot" | "DashDotDot" | "Double" | "Triple" | "ThinThickSmallGap" | "ThickThinSmallGap" | "ThinThickThinSmallGap" | "ThinThickMedGap" | "ThickThinMedGap" | "ThinThickThinMedGap" | "ThinThickLargeGap" | "ThickThinLargeGap" | "ThinThickThinLargeGap" | "SingleWavy" | "DoubleWavy" | "DashDotStroked" | "Emboss3D" | "Engrave3D" | "Outset" | "Inset" };
type _check_BorderUniversal_lineStyle_readonly_39 = IsExact<Ref_BorderUniversal_lineStyle_readonly_39, Auth_BorderUniversal_lineStyle_readonly_39>;
type _assert_BorderUniversal_lineStyle_readonly_39 = Expect<_check_BorderUniversal_lineStyle_readonly_39>;

type Ref_BorderUniversal_lineWidth_40 = () => "Pt025" | "Pt050" | "Pt075" | "Pt100" | "Pt150" | "Pt225" | "Pt300" | "Pt450" | "Pt600";
type Auth_BorderUniversal_lineWidth_40 = () => "Pt025" | "Pt050" | "Pt075" | "Pt100" | "Pt150" | "Pt225" | "Pt300" | "Pt450" | "Pt600";
type _check_BorderUniversal_lineWidth_40 = IsExact<Ref_BorderUniversal_lineWidth_40, Auth_BorderUniversal_lineWidth_40>;
type _assert_BorderUniversal_lineWidth_40 = Expect<_check_BorderUniversal_lineWidth_40>;

type Ref_BorderUniversal_lineWidth_readonly_41 = { value: "Pt025" | "Pt050" | "Pt075" | "Pt100" | "Pt150" | "Pt225" | "Pt300" | "Pt450" | "Pt600" };
type Auth_BorderUniversal_lineWidth_readonly_41 = { value: "Pt025" | "Pt050" | "Pt075" | "Pt100" | "Pt150" | "Pt225" | "Pt300" | "Pt450" | "Pt600" };
type _check_BorderUniversal_lineWidth_readonly_41 = IsExact<Ref_BorderUniversal_lineWidth_readonly_41, Auth_BorderUniversal_lineWidth_readonly_41>;
type _assert_BorderUniversal_lineWidth_readonly_41 = Expect<_check_BorderUniversal_lineWidth_readonly_41>;

type Ref_BorderUniversalCollection_items_42 = () => DocxEditor.BorderUniversal[];
type Auth_BorderUniversalCollection_items_42 = () => DocxEditor.BorderUniversal[];
type _check_BorderUniversalCollection_items_42 = IsExact<Ref_BorderUniversalCollection_items_42, Auth_BorderUniversalCollection_items_42>;
type _assert_BorderUniversalCollection_items_42 = Expect<_check_BorderUniversalCollection_items_42>;

type Ref_BorderUniversalCollection_items_readonly_43 = { readonly value: DocxEditor.BorderUniversal[] };
type Auth_BorderUniversalCollection_items_readonly_43 = { readonly value: DocxEditor.BorderUniversal[] };
type _check_BorderUniversalCollection_items_readonly_43 = IsExact<Ref_BorderUniversalCollection_items_readonly_43, Auth_BorderUniversalCollection_items_readonly_43>;
type _assert_BorderUniversalCollection_items_readonly_43 = Expect<_check_BorderUniversalCollection_items_readonly_43>;

type Ref_ClientObject_context_44 = () => DocxEditor.ClientRequestContext;
type Auth_ClientObject_context_44 = () => DocxEditor.ClientRequestContext;
type _check_ClientObject_context_44 = IsExact<Ref_ClientObject_context_44, Auth_ClientObject_context_44>;
type _assert_ClientObject_context_44 = Expect<_check_ClientObject_context_44>;

type Ref_ClientObject_context_readonly_45 = { value: DocxEditor.ClientRequestContext };
type Auth_ClientObject_context_readonly_45 = { value: DocxEditor.ClientRequestContext };
type _check_ClientObject_context_readonly_45 = IsExact<Ref_ClientObject_context_readonly_45, Auth_ClientObject_context_readonly_45>;
type _assert_ClientObject_context_readonly_45 = Expect<_check_ClientObject_context_readonly_45>;

type Ref_ClientObject_isNullObject_46 = () => boolean;
type Auth_ClientObject_isNullObject_46 = () => boolean;
type _check_ClientObject_isNullObject_46 = IsExact<Ref_ClientObject_isNullObject_46, Auth_ClientObject_isNullObject_46>;
type _assert_ClientObject_isNullObject_46 = Expect<_check_ClientObject_isNullObject_46>;

type Ref_ClientObject_isNullObject_readonly_47 = { value: boolean };
type Auth_ClientObject_isNullObject_readonly_47 = { value: boolean };
type _check_ClientObject_isNullObject_readonly_47 = IsExact<Ref_ClientObject_isNullObject_readonly_47, Auth_ClientObject_isNullObject_readonly_47>;
type _assert_ClientObject_isNullObject_readonly_47 = Expect<_check_ClientObject_isNullObject_readonly_47>;

type Ref_Comment_authorName_48 = () => string;
type Auth_Comment_authorName_48 = () => string;
type _check_Comment_authorName_48 = IsExact<Ref_Comment_authorName_48, Auth_Comment_authorName_48>;
type _assert_Comment_authorName_48 = Expect<_check_Comment_authorName_48>;

type Ref_Comment_authorName_readonly_49 = { readonly value: string };
type Auth_Comment_authorName_readonly_49 = { readonly value: string };
type _check_Comment_authorName_readonly_49 = IsExact<Ref_Comment_authorName_readonly_49, Auth_Comment_authorName_readonly_49>;
type _assert_Comment_authorName_readonly_49 = Expect<_check_Comment_authorName_readonly_49>;

type Ref_Comment_content_50 = () => string;
type Auth_Comment_content_50 = () => string;
type _check_Comment_content_50 = IsExact<Ref_Comment_content_50, Auth_Comment_content_50>;
type _assert_Comment_content_50 = Expect<_check_Comment_content_50>;

type Ref_Comment_content_readonly_51 = { value: string };
type Auth_Comment_content_readonly_51 = { value: string };
type _check_Comment_content_readonly_51 = IsExact<Ref_Comment_content_readonly_51, Auth_Comment_content_readonly_51>;
type _assert_Comment_content_readonly_51 = Expect<_check_Comment_content_readonly_51>;

type Ref_Comment_creationDate_52 = () => Date;
type Auth_Comment_creationDate_52 = () => Date;
type _check_Comment_creationDate_52 = IsExact<Ref_Comment_creationDate_52, Auth_Comment_creationDate_52>;
type _assert_Comment_creationDate_52 = Expect<_check_Comment_creationDate_52>;

type Ref_Comment_creationDate_readonly_53 = { readonly value: Date };
type Auth_Comment_creationDate_readonly_53 = { readonly value: Date };
type _check_Comment_creationDate_readonly_53 = IsExact<Ref_Comment_creationDate_readonly_53, Auth_Comment_creationDate_readonly_53>;
type _assert_Comment_creationDate_readonly_53 = Expect<_check_Comment_creationDate_readonly_53>;

type Ref_Comment_delete_54 = () => void;
type Auth_Comment_delete_54 = () => void;
type _check_Comment_delete_54 = IsExact<Ref_Comment_delete_54, Auth_Comment_delete_54>;
type _assert_Comment_delete_54 = Expect<_check_Comment_delete_54>;

type Ref_Comment_getRange_55 = () => DocxEditor.Range;
type Auth_Comment_getRange_55 = () => DocxEditor.Range;
type _check_Comment_getRange_55 = IsExact<Ref_Comment_getRange_55, Auth_Comment_getRange_55>;
type _assert_Comment_getRange_55 = Expect<_check_Comment_getRange_55>;

type Ref_Comment_id_56 = () => string;
type Auth_Comment_id_56 = () => string;
type _check_Comment_id_56 = IsExact<Ref_Comment_id_56, Auth_Comment_id_56>;
type _assert_Comment_id_56 = Expect<_check_Comment_id_56>;

type Ref_Comment_id_readonly_57 = { readonly value: string };
type Auth_Comment_id_readonly_57 = { readonly value: string };
type _check_Comment_id_readonly_57 = IsExact<Ref_Comment_id_readonly_57, Auth_Comment_id_readonly_57>;
type _assert_Comment_id_readonly_57 = Expect<_check_Comment_id_readonly_57>;

type Ref_Comment_replies_58 = () => DocxEditor.CommentReplyCollection;
type Auth_Comment_replies_58 = () => DocxEditor.CommentReplyCollection;
type _check_Comment_replies_58 = IsExact<Ref_Comment_replies_58, Auth_Comment_replies_58>;
type _assert_Comment_replies_58 = Expect<_check_Comment_replies_58>;

type Ref_Comment_replies_readonly_59 = { readonly value: DocxEditor.CommentReplyCollection };
type Auth_Comment_replies_readonly_59 = { readonly value: DocxEditor.CommentReplyCollection };
type _check_Comment_replies_readonly_59 = IsExact<Ref_Comment_replies_readonly_59, Auth_Comment_replies_readonly_59>;
type _assert_Comment_replies_readonly_59 = Expect<_check_Comment_replies_readonly_59>;

type Ref_Comment_reply_60 = (replyText: string) => DocxEditor.CommentReply;
type Auth_Comment_reply_60 = (replyText: string) => DocxEditor.CommentReply;
type _check_Comment_reply_60 = IsExact<Ref_Comment_reply_60, Auth_Comment_reply_60>;
type _assert_Comment_reply_60 = Expect<_check_Comment_reply_60>;

type Ref_Comment_resolved_61 = () => boolean;
type Auth_Comment_resolved_61 = () => boolean;
type _check_Comment_resolved_61 = IsExact<Ref_Comment_resolved_61, Auth_Comment_resolved_61>;
type _assert_Comment_resolved_61 = Expect<_check_Comment_resolved_61>;

type Ref_Comment_resolved_readonly_62 = { value: boolean };
type Auth_Comment_resolved_readonly_62 = { value: boolean };
type _check_Comment_resolved_readonly_62 = IsExact<Ref_Comment_resolved_readonly_62, Auth_Comment_resolved_readonly_62>;
type _assert_Comment_resolved_readonly_62 = Expect<_check_Comment_resolved_readonly_62>;

type Ref_CommentCollection_getFirst_63 = () => DocxEditor.Comment;
type Auth_CommentCollection_getFirst_63 = () => DocxEditor.Comment;
type _check_CommentCollection_getFirst_63 = IsExact<Ref_CommentCollection_getFirst_63, Auth_CommentCollection_getFirst_63>;
type _assert_CommentCollection_getFirst_63 = Expect<_check_CommentCollection_getFirst_63>;

type Ref_CommentCollection_items_64 = () => DocxEditor.Comment[];
type Auth_CommentCollection_items_64 = () => DocxEditor.Comment[];
type _check_CommentCollection_items_64 = IsExact<Ref_CommentCollection_items_64, Auth_CommentCollection_items_64>;
type _assert_CommentCollection_items_64 = Expect<_check_CommentCollection_items_64>;

type Ref_CommentCollection_items_readonly_65 = { readonly value: DocxEditor.Comment[] };
type Auth_CommentCollection_items_readonly_65 = { readonly value: DocxEditor.Comment[] };
type _check_CommentCollection_items_readonly_65 = IsExact<Ref_CommentCollection_items_readonly_65, Auth_CommentCollection_items_readonly_65>;
type _assert_CommentCollection_items_readonly_65 = Expect<_check_CommentCollection_items_readonly_65>;

type Ref_CommentReply_authorName_66 = () => string;
type Auth_CommentReply_authorName_66 = () => string;
type _check_CommentReply_authorName_66 = IsExact<Ref_CommentReply_authorName_66, Auth_CommentReply_authorName_66>;
type _assert_CommentReply_authorName_66 = Expect<_check_CommentReply_authorName_66>;

type Ref_CommentReply_authorName_readonly_67 = { readonly value: string };
type Auth_CommentReply_authorName_readonly_67 = { readonly value: string };
type _check_CommentReply_authorName_readonly_67 = IsExact<Ref_CommentReply_authorName_readonly_67, Auth_CommentReply_authorName_readonly_67>;
type _assert_CommentReply_authorName_readonly_67 = Expect<_check_CommentReply_authorName_readonly_67>;

type Ref_CommentReply_content_68 = () => string;
type Auth_CommentReply_content_68 = () => string;
type _check_CommentReply_content_68 = IsExact<Ref_CommentReply_content_68, Auth_CommentReply_content_68>;
type _assert_CommentReply_content_68 = Expect<_check_CommentReply_content_68>;

type Ref_CommentReply_content_readonly_69 = { value: string };
type Auth_CommentReply_content_readonly_69 = { value: string };
type _check_CommentReply_content_readonly_69 = IsExact<Ref_CommentReply_content_readonly_69, Auth_CommentReply_content_readonly_69>;
type _assert_CommentReply_content_readonly_69 = Expect<_check_CommentReply_content_readonly_69>;

type Ref_CommentReply_creationDate_70 = () => Date;
type Auth_CommentReply_creationDate_70 = () => Date;
type _check_CommentReply_creationDate_70 = IsExact<Ref_CommentReply_creationDate_70, Auth_CommentReply_creationDate_70>;
type _assert_CommentReply_creationDate_70 = Expect<_check_CommentReply_creationDate_70>;

type Ref_CommentReply_creationDate_readonly_71 = { readonly value: Date };
type Auth_CommentReply_creationDate_readonly_71 = { readonly value: Date };
type _check_CommentReply_creationDate_readonly_71 = IsExact<Ref_CommentReply_creationDate_readonly_71, Auth_CommentReply_creationDate_readonly_71>;
type _assert_CommentReply_creationDate_readonly_71 = Expect<_check_CommentReply_creationDate_readonly_71>;

type Ref_CommentReply_delete_72 = () => void;
type Auth_CommentReply_delete_72 = () => void;
type _check_CommentReply_delete_72 = IsExact<Ref_CommentReply_delete_72, Auth_CommentReply_delete_72>;
type _assert_CommentReply_delete_72 = Expect<_check_CommentReply_delete_72>;

type Ref_CommentReply_id_73 = () => string;
type Auth_CommentReply_id_73 = () => string;
type _check_CommentReply_id_73 = IsExact<Ref_CommentReply_id_73, Auth_CommentReply_id_73>;
type _assert_CommentReply_id_73 = Expect<_check_CommentReply_id_73>;

type Ref_CommentReply_id_readonly_74 = { readonly value: string };
type Auth_CommentReply_id_readonly_74 = { readonly value: string };
type _check_CommentReply_id_readonly_74 = IsExact<Ref_CommentReply_id_readonly_74, Auth_CommentReply_id_readonly_74>;
type _assert_CommentReply_id_readonly_74 = Expect<_check_CommentReply_id_readonly_74>;

type Ref_CommentReplyCollection_getFirst_75 = () => DocxEditor.CommentReply;
type Auth_CommentReplyCollection_getFirst_75 = () => DocxEditor.CommentReply;
type _check_CommentReplyCollection_getFirst_75 = IsExact<Ref_CommentReplyCollection_getFirst_75, Auth_CommentReplyCollection_getFirst_75>;
type _assert_CommentReplyCollection_getFirst_75 = Expect<_check_CommentReplyCollection_getFirst_75>;

type Ref_CommentReplyCollection_items_76 = () => DocxEditor.CommentReply[];
type Auth_CommentReplyCollection_items_76 = () => DocxEditor.CommentReply[];
type _check_CommentReplyCollection_items_76 = IsExact<Ref_CommentReplyCollection_items_76, Auth_CommentReplyCollection_items_76>;
type _assert_CommentReplyCollection_items_76 = Expect<_check_CommentReplyCollection_items_76>;

type Ref_CommentReplyCollection_items_readonly_77 = { readonly value: DocxEditor.CommentReply[] };
type Auth_CommentReplyCollection_items_readonly_77 = { readonly value: DocxEditor.CommentReply[] };
type _check_CommentReplyCollection_items_readonly_77 = IsExact<Ref_CommentReplyCollection_items_readonly_77, Auth_CommentReplyCollection_items_readonly_77>;
type _assert_CommentReplyCollection_items_readonly_77 = Expect<_check_CommentReplyCollection_items_readonly_77>;

type Ref_ContentControl_cannotDelete_78 = () => boolean;
type Auth_ContentControl_cannotDelete_78 = () => boolean;
type _check_ContentControl_cannotDelete_78 = IsExact<Ref_ContentControl_cannotDelete_78, Auth_ContentControl_cannotDelete_78>;
type _assert_ContentControl_cannotDelete_78 = Expect<_check_ContentControl_cannotDelete_78>;

type Ref_ContentControl_cannotDelete_readonly_79 = { value: boolean };
type Auth_ContentControl_cannotDelete_readonly_79 = { value: boolean };
type _check_ContentControl_cannotDelete_readonly_79 = IsExact<Ref_ContentControl_cannotDelete_readonly_79, Auth_ContentControl_cannotDelete_readonly_79>;
type _assert_ContentControl_cannotDelete_readonly_79 = Expect<_check_ContentControl_cannotDelete_readonly_79>;

type Ref_ContentControl_cannotEdit_80 = () => boolean;
type Auth_ContentControl_cannotEdit_80 = () => boolean;
type _check_ContentControl_cannotEdit_80 = IsExact<Ref_ContentControl_cannotEdit_80, Auth_ContentControl_cannotEdit_80>;
type _assert_ContentControl_cannotEdit_80 = Expect<_check_ContentControl_cannotEdit_80>;

type Ref_ContentControl_cannotEdit_readonly_81 = { value: boolean };
type Auth_ContentControl_cannotEdit_readonly_81 = { value: boolean };
type _check_ContentControl_cannotEdit_readonly_81 = IsExact<Ref_ContentControl_cannotEdit_readonly_81, Auth_ContentControl_cannotEdit_readonly_81>;
type _assert_ContentControl_cannotEdit_readonly_81 = Expect<_check_ContentControl_cannotEdit_readonly_81>;

type Ref_ContentControl_contentControls_82 = () => DocxEditor.ContentControlCollection;
type Auth_ContentControl_contentControls_82 = () => DocxEditor.ContentControlCollection;
type _check_ContentControl_contentControls_82 = IsExact<Ref_ContentControl_contentControls_82, Auth_ContentControl_contentControls_82>;
type _assert_ContentControl_contentControls_82 = Expect<_check_ContentControl_contentControls_82>;

type Ref_ContentControl_contentControls_readonly_83 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_ContentControl_contentControls_readonly_83 = { readonly value: DocxEditor.ContentControlCollection };
type _check_ContentControl_contentControls_readonly_83 = IsExact<Ref_ContentControl_contentControls_readonly_83, Auth_ContentControl_contentControls_readonly_83>;
type _assert_ContentControl_contentControls_readonly_83 = Expect<_check_ContentControl_contentControls_readonly_83>;

type Ref_ContentControl_delete_84 = (keepContent: boolean) => void;
type Auth_ContentControl_delete_84 = (keepContent: boolean) => void;
type _check_ContentControl_delete_84 = IsExact<Ref_ContentControl_delete_84, Auth_ContentControl_delete_84>;
type _assert_ContentControl_delete_84 = Expect<_check_ContentControl_delete_84>;

type Ref_ContentControl_getRange_85 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type Auth_ContentControl_getRange_85 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type _check_ContentControl_getRange_85 = IsExact<Ref_ContentControl_getRange_85, Auth_ContentControl_getRange_85>;
type _assert_ContentControl_getRange_85 = Expect<_check_ContentControl_getRange_85>;

type Ref_ContentControl_insertText_86 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_ContentControl_insertText_86 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_ContentControl_insertText_86 = IsExact<Ref_ContentControl_insertText_86, Auth_ContentControl_insertText_86>;
type _assert_ContentControl_insertText_86 = Expect<_check_ContentControl_insertText_86>;

type Ref_ContentControl_paragraphs_87 = () => DocxEditor.ParagraphCollection;
type Auth_ContentControl_paragraphs_87 = () => DocxEditor.ParagraphCollection;
type _check_ContentControl_paragraphs_87 = IsExact<Ref_ContentControl_paragraphs_87, Auth_ContentControl_paragraphs_87>;
type _assert_ContentControl_paragraphs_87 = Expect<_check_ContentControl_paragraphs_87>;

type Ref_ContentControl_paragraphs_readonly_88 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_ContentControl_paragraphs_readonly_88 = { readonly value: DocxEditor.ParagraphCollection };
type _check_ContentControl_paragraphs_readonly_88 = IsExact<Ref_ContentControl_paragraphs_readonly_88, Auth_ContentControl_paragraphs_readonly_88>;
type _assert_ContentControl_paragraphs_readonly_88 = Expect<_check_ContentControl_paragraphs_readonly_88>;

type Ref_ContentControl_tag_89 = () => string;
type Auth_ContentControl_tag_89 = () => string;
type _check_ContentControl_tag_89 = IsExact<Ref_ContentControl_tag_89, Auth_ContentControl_tag_89>;
type _assert_ContentControl_tag_89 = Expect<_check_ContentControl_tag_89>;

type Ref_ContentControl_tag_readonly_90 = { value: string };
type Auth_ContentControl_tag_readonly_90 = { value: string };
type _check_ContentControl_tag_readonly_90 = IsExact<Ref_ContentControl_tag_readonly_90, Auth_ContentControl_tag_readonly_90>;
type _assert_ContentControl_tag_readonly_90 = Expect<_check_ContentControl_tag_readonly_90>;

type Ref_ContentControl_text_91 = () => string;
type Auth_ContentControl_text_91 = () => string;
type _check_ContentControl_text_91 = IsExact<Ref_ContentControl_text_91, Auth_ContentControl_text_91>;
type _assert_ContentControl_text_91 = Expect<_check_ContentControl_text_91>;

type Ref_ContentControl_text_readonly_92 = { readonly value: string };
type Auth_ContentControl_text_readonly_92 = { readonly value: string };
type _check_ContentControl_text_readonly_92 = IsExact<Ref_ContentControl_text_readonly_92, Auth_ContentControl_text_readonly_92>;
type _assert_ContentControl_text_readonly_92 = Expect<_check_ContentControl_text_readonly_92>;

type Ref_ContentControl_title_93 = () => string;
type Auth_ContentControl_title_93 = () => string;
type _check_ContentControl_title_93 = IsExact<Ref_ContentControl_title_93, Auth_ContentControl_title_93>;
type _assert_ContentControl_title_93 = Expect<_check_ContentControl_title_93>;

type Ref_ContentControl_title_readonly_94 = { value: string };
type Auth_ContentControl_title_readonly_94 = { value: string };
type _check_ContentControl_title_readonly_94 = IsExact<Ref_ContentControl_title_readonly_94, Auth_ContentControl_title_readonly_94>;
type _assert_ContentControl_title_readonly_94 = Expect<_check_ContentControl_title_readonly_94>;

type Ref_ContentControlCollection_getById_95 = (id: number) => DocxEditor.ContentControl;
type Auth_ContentControlCollection_getById_95 = (id: number) => DocxEditor.ContentControl;
type _check_ContentControlCollection_getById_95 = IsExact<Ref_ContentControlCollection_getById_95, Auth_ContentControlCollection_getById_95>;
type _assert_ContentControlCollection_getById_95 = Expect<_check_ContentControlCollection_getById_95>;

type Ref_ContentControlCollection_items_96 = () => DocxEditor.ContentControl[];
type Auth_ContentControlCollection_items_96 = () => DocxEditor.ContentControl[];
type _check_ContentControlCollection_items_96 = IsExact<Ref_ContentControlCollection_items_96, Auth_ContentControlCollection_items_96>;
type _assert_ContentControlCollection_items_96 = Expect<_check_ContentControlCollection_items_96>;

type Ref_ContentControlCollection_items_readonly_97 = { readonly value: DocxEditor.ContentControl[] };
type Auth_ContentControlCollection_items_readonly_97 = { readonly value: DocxEditor.ContentControl[] };
type _check_ContentControlCollection_items_readonly_97 = IsExact<Ref_ContentControlCollection_items_readonly_97, Auth_ContentControlCollection_items_readonly_97>;
type _assert_ContentControlCollection_items_readonly_97 = Expect<_check_ContentControlCollection_items_readonly_97>;

type Ref_Document_body_98 = () => DocxEditor.Body;
type Auth_Document_body_98 = () => DocxEditor.Body;
type _check_Document_body_98 = IsExact<Ref_Document_body_98, Auth_Document_body_98>;
type _assert_Document_body_98 = Expect<_check_Document_body_98>;

type Ref_Document_body_readonly_99 = { readonly value: DocxEditor.Body };
type Auth_Document_body_readonly_99 = { readonly value: DocxEditor.Body };
type _check_Document_body_readonly_99 = IsExact<Ref_Document_body_readonly_99, Auth_Document_body_readonly_99>;
type _assert_Document_body_readonly_99 = Expect<_check_Document_body_readonly_99>;

type Ref_Document_changeTrackingMode_100 = () => "Off" | "TrackAll" | "TrackMineOnly";
type Auth_Document_changeTrackingMode_100 = () => "Off" | "TrackAll" | "TrackMineOnly";
type _check_Document_changeTrackingMode_100 = IsExact<Ref_Document_changeTrackingMode_100, Auth_Document_changeTrackingMode_100>;
type _assert_Document_changeTrackingMode_100 = Expect<_check_Document_changeTrackingMode_100>;

type Ref_Document_changeTrackingMode_readonly_101 = { value: "Off" | "TrackAll" | "TrackMineOnly" };
type Auth_Document_changeTrackingMode_readonly_101 = { value: "Off" | "TrackAll" | "TrackMineOnly" };
type _check_Document_changeTrackingMode_readonly_101 = IsExact<Ref_Document_changeTrackingMode_readonly_101, Auth_Document_changeTrackingMode_readonly_101>;
type _assert_Document_changeTrackingMode_readonly_101 = Expect<_check_Document_changeTrackingMode_readonly_101>;

type Ref_Document_comments_102 = () => DocxEditor.CommentCollection;
type Auth_Document_comments_102 = () => DocxEditor.CommentCollection;
type _check_Document_comments_102 = IsExact<Ref_Document_comments_102, Auth_Document_comments_102>;
type _assert_Document_comments_102 = Expect<_check_Document_comments_102>;

type Ref_Document_comments_readonly_103 = { readonly value: DocxEditor.CommentCollection };
type Auth_Document_comments_readonly_103 = { readonly value: DocxEditor.CommentCollection };
type _check_Document_comments_readonly_103 = IsExact<Ref_Document_comments_readonly_103, Auth_Document_comments_readonly_103>;
type _assert_Document_comments_readonly_103 = Expect<_check_Document_comments_readonly_103>;

type Ref_Document_compare_104 = (filePath: string, documentCompareOptions?: DocxEditor.DocumentCompareOptions) => void;
type Auth_Document_compare_104 = (filePath: string, documentCompareOptions?: DocxEditor.DocumentCompareOptions) => void;
type _check_Document_compare_104 = IsExact<Ref_Document_compare_104, Auth_Document_compare_104>;
type _assert_Document_compare_104 = Expect<_check_Document_compare_104>;

type Ref_Document_compareFromBase64_105 = (base64File: string, documentCompareOptions?: DocxEditor.DocumentCompareOptions) => void;
type Auth_Document_compareFromBase64_105 = (base64File: string, documentCompareOptions?: DocxEditor.DocumentCompareOptions) => void;
type _check_Document_compareFromBase64_105 = IsExact<Ref_Document_compareFromBase64_105, Auth_Document_compareFromBase64_105>;
type _assert_Document_compareFromBase64_105 = Expect<_check_Document_compareFromBase64_105>;

type Ref_Document_contentControls_106 = () => DocxEditor.ContentControlCollection;
type Auth_Document_contentControls_106 = () => DocxEditor.ContentControlCollection;
type _check_Document_contentControls_106 = IsExact<Ref_Document_contentControls_106, Auth_Document_contentControls_106>;
type _assert_Document_contentControls_106 = Expect<_check_Document_contentControls_106>;

type Ref_Document_contentControls_readonly_107 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Document_contentControls_readonly_107 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Document_contentControls_readonly_107 = IsExact<Ref_Document_contentControls_readonly_107, Auth_Document_contentControls_readonly_107>;
type _assert_Document_contentControls_readonly_107 = Expect<_check_Document_contentControls_readonly_107>;

type Ref_Document_deleteBookmark_108 = (name: string) => void;
type Auth_Document_deleteBookmark_108 = (name: string) => void;
type _check_Document_deleteBookmark_108 = IsExact<Ref_Document_deleteBookmark_108, Auth_Document_deleteBookmark_108>;
type _assert_Document_deleteBookmark_108 = Expect<_check_Document_deleteBookmark_108>;

type Ref_Document_getBookmarkRange_109 = (name: string) => DocxEditor.Range;
type Auth_Document_getBookmarkRange_109 = (name: string) => DocxEditor.Range;
type _check_Document_getBookmarkRange_109 = IsExact<Ref_Document_getBookmarkRange_109, Auth_Document_getBookmarkRange_109>;
type _assert_Document_getBookmarkRange_109 = Expect<_check_Document_getBookmarkRange_109>;

type Ref_Document_getBookmarkRangeOrNullObject_110 = (name: string) => DocxEditor.Range;
type Auth_Document_getBookmarkRangeOrNullObject_110 = (name: string) => DocxEditor.Range;
type _check_Document_getBookmarkRangeOrNullObject_110 = IsExact<Ref_Document_getBookmarkRangeOrNullObject_110, Auth_Document_getBookmarkRangeOrNullObject_110>;
type _assert_Document_getBookmarkRangeOrNullObject_110 = Expect<_check_Document_getBookmarkRangeOrNullObject_110>;

type Ref_Document_getStyles_111 = () => DocxEditor.StyleCollection;
type Auth_Document_getStyles_111 = () => DocxEditor.StyleCollection;
type _check_Document_getStyles_111 = IsExact<Ref_Document_getStyles_111, Auth_Document_getStyles_111>;
type _assert_Document_getStyles_111 = Expect<_check_Document_getStyles_111>;

type Ref_Document_paragraphs_112 = () => DocxEditor.ParagraphCollection;
type Auth_Document_paragraphs_112 = () => DocxEditor.ParagraphCollection;
type _check_Document_paragraphs_112 = IsExact<Ref_Document_paragraphs_112, Auth_Document_paragraphs_112>;
type _assert_Document_paragraphs_112 = Expect<_check_Document_paragraphs_112>;

type Ref_Document_paragraphs_readonly_113 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Document_paragraphs_readonly_113 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Document_paragraphs_readonly_113 = IsExact<Ref_Document_paragraphs_readonly_113, Auth_Document_paragraphs_readonly_113>;
type _assert_Document_paragraphs_readonly_113 = Expect<_check_Document_paragraphs_readonly_113>;

type Ref_Document_properties_114 = () => DocxEditor.DocumentProperties;
type Auth_Document_properties_114 = () => DocxEditor.DocumentProperties;
type _check_Document_properties_114 = IsExact<Ref_Document_properties_114, Auth_Document_properties_114>;
type _assert_Document_properties_114 = Expect<_check_Document_properties_114>;

type Ref_Document_properties_readonly_115 = { readonly value: DocxEditor.DocumentProperties };
type Auth_Document_properties_readonly_115 = { readonly value: DocxEditor.DocumentProperties };
type _check_Document_properties_readonly_115 = IsExact<Ref_Document_properties_readonly_115, Auth_Document_properties_readonly_115>;
type _assert_Document_properties_readonly_115 = Expect<_check_Document_properties_readonly_115>;

type Ref_Document_removeDocumentInformation_116 = (removeDocInfoType: DocxEditor.RemoveDocInfoType) => void;
type Auth_Document_removeDocumentInformation_116 = (removeDocInfoType: DocxEditor.RemoveDocInfoType) => void;
type _check_Document_removeDocumentInformation_116 = IsExact<Ref_Document_removeDocumentInformation_116, Auth_Document_removeDocumentInformation_116>;
type _assert_Document_removeDocumentInformation_116 = Expect<_check_Document_removeDocumentInformation_116>;

type Ref_Document_removeDocumentInformation_117 = (removeDocInfoType: "Comments" | "Revisions" | "Versions" | "RemovePersonalInformation" | "EmailHeader" | "RoutingSlip" | "SendForReview" | "DocumentProperties" | "Template" | "DocumentWorkspace" | "InkAnnotations" | "DocumentServerProperties" | "DocumentManagementPolicy" | "ContentType" | "TaskpaneWebExtensions" | "AtMentions" | "DocumentTasks" | "DocumentIntelligence" | "CommentReactions" | "All") => void;
type Auth_Document_removeDocumentInformation_117 = (removeDocInfoType: "Comments" | "Revisions" | "Versions" | "RemovePersonalInformation" | "EmailHeader" | "RoutingSlip" | "SendForReview" | "DocumentProperties" | "Template" | "DocumentWorkspace" | "InkAnnotations" | "DocumentServerProperties" | "DocumentManagementPolicy" | "ContentType" | "TaskpaneWebExtensions" | "AtMentions" | "DocumentTasks" | "DocumentIntelligence" | "CommentReactions" | "All") => void;
type _check_Document_removeDocumentInformation_117 = IsExact<Ref_Document_removeDocumentInformation_117, Auth_Document_removeDocumentInformation_117>;
type _assert_Document_removeDocumentInformation_117 = Expect<_check_Document_removeDocumentInformation_117>;

type Ref_Document_revisions_118 = () => DocxEditor.RevisionCollection;
type Auth_Document_revisions_118 = () => DocxEditor.RevisionCollection;
type _check_Document_revisions_118 = IsExact<Ref_Document_revisions_118, Auth_Document_revisions_118>;
type _assert_Document_revisions_118 = Expect<_check_Document_revisions_118>;

type Ref_Document_revisions_readonly_119 = { readonly value: DocxEditor.RevisionCollection };
type Auth_Document_revisions_readonly_119 = { readonly value: DocxEditor.RevisionCollection };
type _check_Document_revisions_readonly_119 = IsExact<Ref_Document_revisions_readonly_119, Auth_Document_revisions_readonly_119>;
type _assert_Document_revisions_readonly_119 = Expect<_check_Document_revisions_readonly_119>;

type Ref_Document_sections_120 = () => DocxEditor.SectionCollection;
type Auth_Document_sections_120 = () => DocxEditor.SectionCollection;
type _check_Document_sections_120 = IsExact<Ref_Document_sections_120, Auth_Document_sections_120>;
type _assert_Document_sections_120 = Expect<_check_Document_sections_120>;

type Ref_Document_sections_readonly_121 = { readonly value: DocxEditor.SectionCollection };
type Auth_Document_sections_readonly_121 = { readonly value: DocxEditor.SectionCollection };
type _check_Document_sections_readonly_121 = IsExact<Ref_Document_sections_readonly_121, Auth_Document_sections_readonly_121>;
type _assert_Document_sections_readonly_121 = Expect<_check_Document_sections_readonly_121>;

type Ref_DocumentProperties_author_122 = () => string;
type Auth_DocumentProperties_author_122 = () => string;
type _check_DocumentProperties_author_122 = IsExact<Ref_DocumentProperties_author_122, Auth_DocumentProperties_author_122>;
type _assert_DocumentProperties_author_122 = Expect<_check_DocumentProperties_author_122>;

type Ref_DocumentProperties_author_readonly_123 = { value: string };
type Auth_DocumentProperties_author_readonly_123 = { value: string };
type _check_DocumentProperties_author_readonly_123 = IsExact<Ref_DocumentProperties_author_readonly_123, Auth_DocumentProperties_author_readonly_123>;
type _assert_DocumentProperties_author_readonly_123 = Expect<_check_DocumentProperties_author_readonly_123>;

type Ref_DocumentProperties_category_124 = () => string;
type Auth_DocumentProperties_category_124 = () => string;
type _check_DocumentProperties_category_124 = IsExact<Ref_DocumentProperties_category_124, Auth_DocumentProperties_category_124>;
type _assert_DocumentProperties_category_124 = Expect<_check_DocumentProperties_category_124>;

type Ref_DocumentProperties_category_readonly_125 = { value: string };
type Auth_DocumentProperties_category_readonly_125 = { value: string };
type _check_DocumentProperties_category_readonly_125 = IsExact<Ref_DocumentProperties_category_readonly_125, Auth_DocumentProperties_category_readonly_125>;
type _assert_DocumentProperties_category_readonly_125 = Expect<_check_DocumentProperties_category_readonly_125>;

type Ref_DocumentProperties_comments_126 = () => string;
type Auth_DocumentProperties_comments_126 = () => string;
type _check_DocumentProperties_comments_126 = IsExact<Ref_DocumentProperties_comments_126, Auth_DocumentProperties_comments_126>;
type _assert_DocumentProperties_comments_126 = Expect<_check_DocumentProperties_comments_126>;

type Ref_DocumentProperties_comments_readonly_127 = { value: string };
type Auth_DocumentProperties_comments_readonly_127 = { value: string };
type _check_DocumentProperties_comments_readonly_127 = IsExact<Ref_DocumentProperties_comments_readonly_127, Auth_DocumentProperties_comments_readonly_127>;
type _assert_DocumentProperties_comments_readonly_127 = Expect<_check_DocumentProperties_comments_readonly_127>;

type Ref_DocumentProperties_keywords_128 = () => string;
type Auth_DocumentProperties_keywords_128 = () => string;
type _check_DocumentProperties_keywords_128 = IsExact<Ref_DocumentProperties_keywords_128, Auth_DocumentProperties_keywords_128>;
type _assert_DocumentProperties_keywords_128 = Expect<_check_DocumentProperties_keywords_128>;

type Ref_DocumentProperties_keywords_readonly_129 = { value: string };
type Auth_DocumentProperties_keywords_readonly_129 = { value: string };
type _check_DocumentProperties_keywords_readonly_129 = IsExact<Ref_DocumentProperties_keywords_readonly_129, Auth_DocumentProperties_keywords_readonly_129>;
type _assert_DocumentProperties_keywords_readonly_129 = Expect<_check_DocumentProperties_keywords_readonly_129>;

type Ref_DocumentProperties_lastAuthor_130 = () => string;
type Auth_DocumentProperties_lastAuthor_130 = () => string;
type _check_DocumentProperties_lastAuthor_130 = IsExact<Ref_DocumentProperties_lastAuthor_130, Auth_DocumentProperties_lastAuthor_130>;
type _assert_DocumentProperties_lastAuthor_130 = Expect<_check_DocumentProperties_lastAuthor_130>;

type Ref_DocumentProperties_lastAuthor_readonly_131 = { readonly value: string };
type Auth_DocumentProperties_lastAuthor_readonly_131 = { readonly value: string };
type _check_DocumentProperties_lastAuthor_readonly_131 = IsExact<Ref_DocumentProperties_lastAuthor_readonly_131, Auth_DocumentProperties_lastAuthor_readonly_131>;
type _assert_DocumentProperties_lastAuthor_readonly_131 = Expect<_check_DocumentProperties_lastAuthor_readonly_131>;

type Ref_DocumentProperties_subject_132 = () => string;
type Auth_DocumentProperties_subject_132 = () => string;
type _check_DocumentProperties_subject_132 = IsExact<Ref_DocumentProperties_subject_132, Auth_DocumentProperties_subject_132>;
type _assert_DocumentProperties_subject_132 = Expect<_check_DocumentProperties_subject_132>;

type Ref_DocumentProperties_subject_readonly_133 = { value: string };
type Auth_DocumentProperties_subject_readonly_133 = { value: string };
type _check_DocumentProperties_subject_readonly_133 = IsExact<Ref_DocumentProperties_subject_readonly_133, Auth_DocumentProperties_subject_readonly_133>;
type _assert_DocumentProperties_subject_readonly_133 = Expect<_check_DocumentProperties_subject_readonly_133>;

type Ref_DocumentProperties_title_134 = () => string;
type Auth_DocumentProperties_title_134 = () => string;
type _check_DocumentProperties_title_134 = IsExact<Ref_DocumentProperties_title_134, Auth_DocumentProperties_title_134>;
type _assert_DocumentProperties_title_134 = Expect<_check_DocumentProperties_title_134>;

type Ref_DocumentProperties_title_readonly_135 = { value: string };
type Auth_DocumentProperties_title_readonly_135 = { value: string };
type _check_DocumentProperties_title_readonly_135 = IsExact<Ref_DocumentProperties_title_readonly_135, Auth_DocumentProperties_title_readonly_135>;
type _assert_DocumentProperties_title_readonly_135 = Expect<_check_DocumentProperties_title_readonly_135>;

type Ref_Font_bold_136 = () => boolean;
type Auth_Font_bold_136 = () => boolean;
type _check_Font_bold_136 = IsExact<Ref_Font_bold_136, Auth_Font_bold_136>;
type _assert_Font_bold_136 = Expect<_check_Font_bold_136>;

type Ref_Font_bold_readonly_137 = { value: boolean };
type Auth_Font_bold_readonly_137 = { value: boolean };
type _check_Font_bold_readonly_137 = IsExact<Ref_Font_bold_readonly_137, Auth_Font_bold_readonly_137>;
type _assert_Font_bold_readonly_137 = Expect<_check_Font_bold_readonly_137>;

type Ref_Font_color_138 = () => string;
type Auth_Font_color_138 = () => string;
type _check_Font_color_138 = IsExact<Ref_Font_color_138, Auth_Font_color_138>;
type _assert_Font_color_138 = Expect<_check_Font_color_138>;

type Ref_Font_color_readonly_139 = { value: string };
type Auth_Font_color_readonly_139 = { value: string };
type _check_Font_color_readonly_139 = IsExact<Ref_Font_color_readonly_139, Auth_Font_color_readonly_139>;
type _assert_Font_color_readonly_139 = Expect<_check_Font_color_readonly_139>;

type Ref_Font_italic_140 = () => boolean;
type Auth_Font_italic_140 = () => boolean;
type _check_Font_italic_140 = IsExact<Ref_Font_italic_140, Auth_Font_italic_140>;
type _assert_Font_italic_140 = Expect<_check_Font_italic_140>;

type Ref_Font_italic_readonly_141 = { value: boolean };
type Auth_Font_italic_readonly_141 = { value: boolean };
type _check_Font_italic_readonly_141 = IsExact<Ref_Font_italic_readonly_141, Auth_Font_italic_readonly_141>;
type _assert_Font_italic_readonly_141 = Expect<_check_Font_italic_readonly_141>;

type Ref_Font_name_142 = () => string;
type Auth_Font_name_142 = () => string;
type _check_Font_name_142 = IsExact<Ref_Font_name_142, Auth_Font_name_142>;
type _assert_Font_name_142 = Expect<_check_Font_name_142>;

type Ref_Font_name_readonly_143 = { value: string };
type Auth_Font_name_readonly_143 = { value: string };
type _check_Font_name_readonly_143 = IsExact<Ref_Font_name_readonly_143, Auth_Font_name_readonly_143>;
type _assert_Font_name_readonly_143 = Expect<_check_Font_name_readonly_143>;

type Ref_Font_size_144 = () => number;
type Auth_Font_size_144 = () => number;
type _check_Font_size_144 = IsExact<Ref_Font_size_144, Auth_Font_size_144>;
type _assert_Font_size_144 = Expect<_check_Font_size_144>;

type Ref_Font_size_readonly_145 = { value: number };
type Auth_Font_size_readonly_145 = { value: number };
type _check_Font_size_readonly_145 = IsExact<Ref_Font_size_readonly_145, Auth_Font_size_readonly_145>;
type _assert_Font_size_readonly_145 = Expect<_check_Font_size_readonly_145>;

type Ref_List_getLevelParagraphs_146 = (level: number) => DocxEditor.ParagraphCollection;
type Auth_List_getLevelParagraphs_146 = (level: number) => DocxEditor.ParagraphCollection;
type _check_List_getLevelParagraphs_146 = IsExact<Ref_List_getLevelParagraphs_146, Auth_List_getLevelParagraphs_146>;
type _assert_List_getLevelParagraphs_146 = Expect<_check_List_getLevelParagraphs_146>;

type Ref_List_id_147 = () => number;
type Auth_List_id_147 = () => number;
type _check_List_id_147 = IsExact<Ref_List_id_147, Auth_List_id_147>;
type _assert_List_id_147 = Expect<_check_List_id_147>;

type Ref_List_id_readonly_148 = { readonly value: number };
type Auth_List_id_readonly_148 = { readonly value: number };
type _check_List_id_readonly_148 = IsExact<Ref_List_id_readonly_148, Auth_List_id_readonly_148>;
type _assert_List_id_readonly_148 = Expect<_check_List_id_readonly_148>;

type Ref_List_insertParagraph_149 = (paragraphText: string, insertLocation: "Start" | "End" | "Before" | "After") => DocxEditor.Paragraph;
type Auth_List_insertParagraph_149 = (paragraphText: string, insertLocation: "Start" | "End" | "Before" | "After") => DocxEditor.Paragraph;
type _check_List_insertParagraph_149 = IsExact<Ref_List_insertParagraph_149, Auth_List_insertParagraph_149>;
type _assert_List_insertParagraph_149 = Expect<_check_List_insertParagraph_149>;

type Ref_List_paragraphs_150 = () => DocxEditor.ParagraphCollection;
type Auth_List_paragraphs_150 = () => DocxEditor.ParagraphCollection;
type _check_List_paragraphs_150 = IsExact<Ref_List_paragraphs_150, Auth_List_paragraphs_150>;
type _assert_List_paragraphs_150 = Expect<_check_List_paragraphs_150>;

type Ref_List_paragraphs_readonly_151 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_List_paragraphs_readonly_151 = { readonly value: DocxEditor.ParagraphCollection };
type _check_List_paragraphs_readonly_151 = IsExact<Ref_List_paragraphs_readonly_151, Auth_List_paragraphs_readonly_151>;
type _assert_List_paragraphs_readonly_151 = Expect<_check_List_paragraphs_readonly_151>;

type Ref_ListCollection_getById_152 = (id: number) => DocxEditor.List;
type Auth_ListCollection_getById_152 = (id: number) => DocxEditor.List;
type _check_ListCollection_getById_152 = IsExact<Ref_ListCollection_getById_152, Auth_ListCollection_getById_152>;
type _assert_ListCollection_getById_152 = Expect<_check_ListCollection_getById_152>;

type Ref_ListCollection_getFirst_153 = () => DocxEditor.List;
type Auth_ListCollection_getFirst_153 = () => DocxEditor.List;
type _check_ListCollection_getFirst_153 = IsExact<Ref_ListCollection_getFirst_153, Auth_ListCollection_getFirst_153>;
type _assert_ListCollection_getFirst_153 = Expect<_check_ListCollection_getFirst_153>;

type Ref_ListCollection_items_154 = () => DocxEditor.List[];
type Auth_ListCollection_items_154 = () => DocxEditor.List[];
type _check_ListCollection_items_154 = IsExact<Ref_ListCollection_items_154, Auth_ListCollection_items_154>;
type _assert_ListCollection_items_154 = Expect<_check_ListCollection_items_154>;

type Ref_ListCollection_items_readonly_155 = { readonly value: DocxEditor.List[] };
type Auth_ListCollection_items_readonly_155 = { readonly value: DocxEditor.List[] };
type _check_ListCollection_items_readonly_155 = IsExact<Ref_ListCollection_items_readonly_155, Auth_ListCollection_items_readonly_155>;
type _assert_ListCollection_items_readonly_155 = Expect<_check_ListCollection_items_readonly_155>;

type Ref_ListItem_level_156 = () => number;
type Auth_ListItem_level_156 = () => number;
type _check_ListItem_level_156 = IsExact<Ref_ListItem_level_156, Auth_ListItem_level_156>;
type _assert_ListItem_level_156 = Expect<_check_ListItem_level_156>;

type Ref_ListItem_level_readonly_157 = { value: number };
type Auth_ListItem_level_readonly_157 = { value: number };
type _check_ListItem_level_readonly_157 = IsExact<Ref_ListItem_level_readonly_157, Auth_ListItem_level_readonly_157>;
type _assert_ListItem_level_readonly_157 = Expect<_check_ListItem_level_readonly_157>;

type Ref_NoteItem_body_158 = () => DocxEditor.Body;
type Auth_NoteItem_body_158 = () => DocxEditor.Body;
type _check_NoteItem_body_158 = IsExact<Ref_NoteItem_body_158, Auth_NoteItem_body_158>;
type _assert_NoteItem_body_158 = Expect<_check_NoteItem_body_158>;

type Ref_NoteItem_body_readonly_159 = { readonly value: DocxEditor.Body };
type Auth_NoteItem_body_readonly_159 = { readonly value: DocxEditor.Body };
type _check_NoteItem_body_readonly_159 = IsExact<Ref_NoteItem_body_readonly_159, Auth_NoteItem_body_readonly_159>;
type _assert_NoteItem_body_readonly_159 = Expect<_check_NoteItem_body_readonly_159>;

type Ref_NoteItem_delete_160 = () => void;
type Auth_NoteItem_delete_160 = () => void;
type _check_NoteItem_delete_160 = IsExact<Ref_NoteItem_delete_160, Auth_NoteItem_delete_160>;
type _assert_NoteItem_delete_160 = Expect<_check_NoteItem_delete_160>;

type Ref_NoteItem_getNext_161 = () => DocxEditor.NoteItem;
type Auth_NoteItem_getNext_161 = () => DocxEditor.NoteItem;
type _check_NoteItem_getNext_161 = IsExact<Ref_NoteItem_getNext_161, Auth_NoteItem_getNext_161>;
type _assert_NoteItem_getNext_161 = Expect<_check_NoteItem_getNext_161>;

type Ref_NoteItem_type_162 = () => "Footnote" | "Endnote";
type Auth_NoteItem_type_162 = () => "Footnote" | "Endnote";
type _check_NoteItem_type_162 = IsExact<Ref_NoteItem_type_162, Auth_NoteItem_type_162>;
type _assert_NoteItem_type_162 = Expect<_check_NoteItem_type_162>;

type Ref_NoteItem_type_readonly_163 = { readonly value: "Footnote" | "Endnote" };
type Auth_NoteItem_type_readonly_163 = { readonly value: "Footnote" | "Endnote" };
type _check_NoteItem_type_readonly_163 = IsExact<Ref_NoteItem_type_readonly_163, Auth_NoteItem_type_readonly_163>;
type _assert_NoteItem_type_readonly_163 = Expect<_check_NoteItem_type_readonly_163>;

type Ref_NoteItemCollection_getFirst_164 = () => DocxEditor.NoteItem;
type Auth_NoteItemCollection_getFirst_164 = () => DocxEditor.NoteItem;
type _check_NoteItemCollection_getFirst_164 = IsExact<Ref_NoteItemCollection_getFirst_164, Auth_NoteItemCollection_getFirst_164>;
type _assert_NoteItemCollection_getFirst_164 = Expect<_check_NoteItemCollection_getFirst_164>;

type Ref_NoteItemCollection_items_165 = () => DocxEditor.NoteItem[];
type Auth_NoteItemCollection_items_165 = () => DocxEditor.NoteItem[];
type _check_NoteItemCollection_items_165 = IsExact<Ref_NoteItemCollection_items_165, Auth_NoteItemCollection_items_165>;
type _assert_NoteItemCollection_items_165 = Expect<_check_NoteItemCollection_items_165>;

type Ref_NoteItemCollection_items_readonly_166 = { readonly value: DocxEditor.NoteItem[] };
type Auth_NoteItemCollection_items_readonly_166 = { readonly value: DocxEditor.NoteItem[] };
type _check_NoteItemCollection_items_readonly_166 = IsExact<Ref_NoteItemCollection_items_readonly_166, Auth_NoteItemCollection_items_readonly_166>;
type _assert_NoteItemCollection_items_readonly_166 = Expect<_check_NoteItemCollection_items_readonly_166>;

type Ref_PageSetup_bottomMargin_167 = () => number;
type Auth_PageSetup_bottomMargin_167 = () => number;
type _check_PageSetup_bottomMargin_167 = IsExact<Ref_PageSetup_bottomMargin_167, Auth_PageSetup_bottomMargin_167>;
type _assert_PageSetup_bottomMargin_167 = Expect<_check_PageSetup_bottomMargin_167>;

type Ref_PageSetup_bottomMargin_readonly_168 = { value: number };
type Auth_PageSetup_bottomMargin_readonly_168 = { value: number };
type _check_PageSetup_bottomMargin_readonly_168 = IsExact<Ref_PageSetup_bottomMargin_readonly_168, Auth_PageSetup_bottomMargin_readonly_168>;
type _assert_PageSetup_bottomMargin_readonly_168 = Expect<_check_PageSetup_bottomMargin_readonly_168>;

type Ref_PageSetup_leftMargin_169 = () => number;
type Auth_PageSetup_leftMargin_169 = () => number;
type _check_PageSetup_leftMargin_169 = IsExact<Ref_PageSetup_leftMargin_169, Auth_PageSetup_leftMargin_169>;
type _assert_PageSetup_leftMargin_169 = Expect<_check_PageSetup_leftMargin_169>;

type Ref_PageSetup_leftMargin_readonly_170 = { value: number };
type Auth_PageSetup_leftMargin_readonly_170 = { value: number };
type _check_PageSetup_leftMargin_readonly_170 = IsExact<Ref_PageSetup_leftMargin_readonly_170, Auth_PageSetup_leftMargin_readonly_170>;
type _assert_PageSetup_leftMargin_readonly_170 = Expect<_check_PageSetup_leftMargin_readonly_170>;

type Ref_PageSetup_orientation_171 = () => "Portrait" | "Landscape";
type Auth_PageSetup_orientation_171 = () => "Portrait" | "Landscape";
type _check_PageSetup_orientation_171 = IsExact<Ref_PageSetup_orientation_171, Auth_PageSetup_orientation_171>;
type _assert_PageSetup_orientation_171 = Expect<_check_PageSetup_orientation_171>;

type Ref_PageSetup_orientation_readonly_172 = { value: "Portrait" | "Landscape" };
type Auth_PageSetup_orientation_readonly_172 = { value: "Portrait" | "Landscape" };
type _check_PageSetup_orientation_readonly_172 = IsExact<Ref_PageSetup_orientation_readonly_172, Auth_PageSetup_orientation_readonly_172>;
type _assert_PageSetup_orientation_readonly_172 = Expect<_check_PageSetup_orientation_readonly_172>;

type Ref_PageSetup_pageHeight_173 = () => number;
type Auth_PageSetup_pageHeight_173 = () => number;
type _check_PageSetup_pageHeight_173 = IsExact<Ref_PageSetup_pageHeight_173, Auth_PageSetup_pageHeight_173>;
type _assert_PageSetup_pageHeight_173 = Expect<_check_PageSetup_pageHeight_173>;

type Ref_PageSetup_pageHeight_readonly_174 = { value: number };
type Auth_PageSetup_pageHeight_readonly_174 = { value: number };
type _check_PageSetup_pageHeight_readonly_174 = IsExact<Ref_PageSetup_pageHeight_readonly_174, Auth_PageSetup_pageHeight_readonly_174>;
type _assert_PageSetup_pageHeight_readonly_174 = Expect<_check_PageSetup_pageHeight_readonly_174>;

type Ref_PageSetup_pageWidth_175 = () => number;
type Auth_PageSetup_pageWidth_175 = () => number;
type _check_PageSetup_pageWidth_175 = IsExact<Ref_PageSetup_pageWidth_175, Auth_PageSetup_pageWidth_175>;
type _assert_PageSetup_pageWidth_175 = Expect<_check_PageSetup_pageWidth_175>;

type Ref_PageSetup_pageWidth_readonly_176 = { value: number };
type Auth_PageSetup_pageWidth_readonly_176 = { value: number };
type _check_PageSetup_pageWidth_readonly_176 = IsExact<Ref_PageSetup_pageWidth_readonly_176, Auth_PageSetup_pageWidth_readonly_176>;
type _assert_PageSetup_pageWidth_readonly_176 = Expect<_check_PageSetup_pageWidth_readonly_176>;

type Ref_PageSetup_rightMargin_177 = () => number;
type Auth_PageSetup_rightMargin_177 = () => number;
type _check_PageSetup_rightMargin_177 = IsExact<Ref_PageSetup_rightMargin_177, Auth_PageSetup_rightMargin_177>;
type _assert_PageSetup_rightMargin_177 = Expect<_check_PageSetup_rightMargin_177>;

type Ref_PageSetup_rightMargin_readonly_178 = { value: number };
type Auth_PageSetup_rightMargin_readonly_178 = { value: number };
type _check_PageSetup_rightMargin_readonly_178 = IsExact<Ref_PageSetup_rightMargin_readonly_178, Auth_PageSetup_rightMargin_readonly_178>;
type _assert_PageSetup_rightMargin_readonly_178 = Expect<_check_PageSetup_rightMargin_readonly_178>;

type Ref_PageSetup_topMargin_179 = () => number;
type Auth_PageSetup_topMargin_179 = () => number;
type _check_PageSetup_topMargin_179 = IsExact<Ref_PageSetup_topMargin_179, Auth_PageSetup_topMargin_179>;
type _assert_PageSetup_topMargin_179 = Expect<_check_PageSetup_topMargin_179>;

type Ref_PageSetup_topMargin_readonly_180 = { value: number };
type Auth_PageSetup_topMargin_readonly_180 = { value: number };
type _check_PageSetup_topMargin_readonly_180 = IsExact<Ref_PageSetup_topMargin_readonly_180, Auth_PageSetup_topMargin_readonly_180>;
type _assert_PageSetup_topMargin_readonly_180 = Expect<_check_PageSetup_topMargin_readonly_180>;

type Ref_Paragraph_alignment_181 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type Auth_Paragraph_alignment_181 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type _check_Paragraph_alignment_181 = IsExact<Ref_Paragraph_alignment_181, Auth_Paragraph_alignment_181>;
type _assert_Paragraph_alignment_181 = Expect<_check_Paragraph_alignment_181>;

type Ref_Paragraph_alignment_readonly_182 = { value: "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified" };
type Auth_Paragraph_alignment_readonly_182 = { value: "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified" };
type _check_Paragraph_alignment_readonly_182 = IsExact<Ref_Paragraph_alignment_readonly_182, Auth_Paragraph_alignment_readonly_182>;
type _assert_Paragraph_alignment_readonly_182 = Expect<_check_Paragraph_alignment_readonly_182>;

type Ref_Paragraph_borders_183 = () => DocxEditor.BorderUniversalCollection;
type Auth_Paragraph_borders_183 = () => DocxEditor.BorderUniversalCollection;
type _check_Paragraph_borders_183 = IsExact<Ref_Paragraph_borders_183, Auth_Paragraph_borders_183>;
type _assert_Paragraph_borders_183 = Expect<_check_Paragraph_borders_183>;

type Ref_Paragraph_borders_readonly_184 = { readonly value: DocxEditor.BorderUniversalCollection };
type Auth_Paragraph_borders_readonly_184 = { readonly value: DocxEditor.BorderUniversalCollection };
type _check_Paragraph_borders_readonly_184 = IsExact<Ref_Paragraph_borders_readonly_184, Auth_Paragraph_borders_readonly_184>;
type _assert_Paragraph_borders_readonly_184 = Expect<_check_Paragraph_borders_readonly_184>;

type Ref_Paragraph_clear_185 = () => void;
type Auth_Paragraph_clear_185 = () => void;
type _check_Paragraph_clear_185 = IsExact<Ref_Paragraph_clear_185, Auth_Paragraph_clear_185>;
type _assert_Paragraph_clear_185 = Expect<_check_Paragraph_clear_185>;

type Ref_Paragraph_contentControls_186 = () => DocxEditor.ContentControlCollection;
type Auth_Paragraph_contentControls_186 = () => DocxEditor.ContentControlCollection;
type _check_Paragraph_contentControls_186 = IsExact<Ref_Paragraph_contentControls_186, Auth_Paragraph_contentControls_186>;
type _assert_Paragraph_contentControls_186 = Expect<_check_Paragraph_contentControls_186>;

type Ref_Paragraph_contentControls_readonly_187 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Paragraph_contentControls_readonly_187 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Paragraph_contentControls_readonly_187 = IsExact<Ref_Paragraph_contentControls_readonly_187, Auth_Paragraph_contentControls_readonly_187>;
type _assert_Paragraph_contentControls_readonly_187 = Expect<_check_Paragraph_contentControls_readonly_187>;

type Ref_Paragraph_delete_188 = () => void;
type Auth_Paragraph_delete_188 = () => void;
type _check_Paragraph_delete_188 = IsExact<Ref_Paragraph_delete_188, Auth_Paragraph_delete_188>;
type _assert_Paragraph_delete_188 = Expect<_check_Paragraph_delete_188>;

type Ref_Paragraph_firstLineIndent_189 = () => number;
type Auth_Paragraph_firstLineIndent_189 = () => number;
type _check_Paragraph_firstLineIndent_189 = IsExact<Ref_Paragraph_firstLineIndent_189, Auth_Paragraph_firstLineIndent_189>;
type _assert_Paragraph_firstLineIndent_189 = Expect<_check_Paragraph_firstLineIndent_189>;

type Ref_Paragraph_firstLineIndent_readonly_190 = { value: number };
type Auth_Paragraph_firstLineIndent_readonly_190 = { value: number };
type _check_Paragraph_firstLineIndent_readonly_190 = IsExact<Ref_Paragraph_firstLineIndent_readonly_190, Auth_Paragraph_firstLineIndent_readonly_190>;
type _assert_Paragraph_firstLineIndent_readonly_190 = Expect<_check_Paragraph_firstLineIndent_readonly_190>;

type Ref_Paragraph_font_191 = () => DocxEditor.Font;
type Auth_Paragraph_font_191 = () => DocxEditor.Font;
type _check_Paragraph_font_191 = IsExact<Ref_Paragraph_font_191, Auth_Paragraph_font_191>;
type _assert_Paragraph_font_191 = Expect<_check_Paragraph_font_191>;

type Ref_Paragraph_font_readonly_192 = { readonly value: DocxEditor.Font };
type Auth_Paragraph_font_readonly_192 = { readonly value: DocxEditor.Font };
type _check_Paragraph_font_readonly_192 = IsExact<Ref_Paragraph_font_readonly_192, Auth_Paragraph_font_readonly_192>;
type _assert_Paragraph_font_readonly_192 = Expect<_check_Paragraph_font_readonly_192>;

type Ref_Paragraph_getReviewedText_193 = (changeTrackingVersion?: DocxEditor.ChangeTrackingVersion) => DocxEditor.ClientResult<string>;
type Auth_Paragraph_getReviewedText_193 = (changeTrackingVersion?: DocxEditor.ChangeTrackingVersion) => DocxEditor.ClientResult<string>;
type _check_Paragraph_getReviewedText_193 = IsExact<Ref_Paragraph_getReviewedText_193, Auth_Paragraph_getReviewedText_193>;
type _assert_Paragraph_getReviewedText_193 = Expect<_check_Paragraph_getReviewedText_193>;

type Ref_Paragraph_getReviewedText_194 = (changeTrackingVersion?: "Original" | "Current") => DocxEditor.ClientResult<string>;
type Auth_Paragraph_getReviewedText_194 = (changeTrackingVersion?: "Original" | "Current") => DocxEditor.ClientResult<string>;
type _check_Paragraph_getReviewedText_194 = IsExact<Ref_Paragraph_getReviewedText_194, Auth_Paragraph_getReviewedText_194>;
type _assert_Paragraph_getReviewedText_194 = Expect<_check_Paragraph_getReviewedText_194>;

type Ref_Paragraph_getTextRanges_195 = (endingMarks: string[], trimSpacing?: boolean) => DocxEditor.RangeCollection;
type Auth_Paragraph_getTextRanges_195 = (endingMarks: string[], trimSpacing?: boolean) => DocxEditor.RangeCollection;
type _check_Paragraph_getTextRanges_195 = IsExact<Ref_Paragraph_getTextRanges_195, Auth_Paragraph_getTextRanges_195>;
type _assert_Paragraph_getTextRanges_195 = Expect<_check_Paragraph_getTextRanges_195>;

type Ref_Paragraph_insertParagraph_196 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Paragraph_insertParagraph_196 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Paragraph_insertParagraph_196 = IsExact<Ref_Paragraph_insertParagraph_196, Auth_Paragraph_insertParagraph_196>;
type _assert_Paragraph_insertParagraph_196 = Expect<_check_Paragraph_insertParagraph_196>;

type Ref_Paragraph_insertText_197 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Paragraph_insertText_197 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Paragraph_insertText_197 = IsExact<Ref_Paragraph_insertText_197, Auth_Paragraph_insertText_197>;
type _assert_Paragraph_insertText_197 = Expect<_check_Paragraph_insertText_197>;

type Ref_Paragraph_leftIndent_198 = () => number;
type Auth_Paragraph_leftIndent_198 = () => number;
type _check_Paragraph_leftIndent_198 = IsExact<Ref_Paragraph_leftIndent_198, Auth_Paragraph_leftIndent_198>;
type _assert_Paragraph_leftIndent_198 = Expect<_check_Paragraph_leftIndent_198>;

type Ref_Paragraph_leftIndent_readonly_199 = { value: number };
type Auth_Paragraph_leftIndent_readonly_199 = { value: number };
type _check_Paragraph_leftIndent_readonly_199 = IsExact<Ref_Paragraph_leftIndent_readonly_199, Auth_Paragraph_leftIndent_readonly_199>;
type _assert_Paragraph_leftIndent_readonly_199 = Expect<_check_Paragraph_leftIndent_readonly_199>;

type Ref_Paragraph_lineSpacing_200 = () => number;
type Auth_Paragraph_lineSpacing_200 = () => number;
type _check_Paragraph_lineSpacing_200 = IsExact<Ref_Paragraph_lineSpacing_200, Auth_Paragraph_lineSpacing_200>;
type _assert_Paragraph_lineSpacing_200 = Expect<_check_Paragraph_lineSpacing_200>;

type Ref_Paragraph_lineSpacing_readonly_201 = { value: number };
type Auth_Paragraph_lineSpacing_readonly_201 = { value: number };
type _check_Paragraph_lineSpacing_readonly_201 = IsExact<Ref_Paragraph_lineSpacing_readonly_201, Auth_Paragraph_lineSpacing_readonly_201>;
type _assert_Paragraph_lineSpacing_readonly_201 = Expect<_check_Paragraph_lineSpacing_readonly_201>;

type Ref_Paragraph_list_202 = () => DocxEditor.List;
type Auth_Paragraph_list_202 = () => DocxEditor.List;
type _check_Paragraph_list_202 = IsExact<Ref_Paragraph_list_202, Auth_Paragraph_list_202>;
type _assert_Paragraph_list_202 = Expect<_check_Paragraph_list_202>;

type Ref_Paragraph_list_readonly_203 = { readonly value: DocxEditor.List };
type Auth_Paragraph_list_readonly_203 = { readonly value: DocxEditor.List };
type _check_Paragraph_list_readonly_203 = IsExact<Ref_Paragraph_list_readonly_203, Auth_Paragraph_list_readonly_203>;
type _assert_Paragraph_list_readonly_203 = Expect<_check_Paragraph_list_readonly_203>;

type Ref_Paragraph_listItem_204 = () => DocxEditor.ListItem;
type Auth_Paragraph_listItem_204 = () => DocxEditor.ListItem;
type _check_Paragraph_listItem_204 = IsExact<Ref_Paragraph_listItem_204, Auth_Paragraph_listItem_204>;
type _assert_Paragraph_listItem_204 = Expect<_check_Paragraph_listItem_204>;

type Ref_Paragraph_listItem_readonly_205 = { readonly value: DocxEditor.ListItem };
type Auth_Paragraph_listItem_readonly_205 = { readonly value: DocxEditor.ListItem };
type _check_Paragraph_listItem_readonly_205 = IsExact<Ref_Paragraph_listItem_readonly_205, Auth_Paragraph_listItem_readonly_205>;
type _assert_Paragraph_listItem_readonly_205 = Expect<_check_Paragraph_listItem_readonly_205>;

type Ref_Paragraph_rightIndent_206 = () => number;
type Auth_Paragraph_rightIndent_206 = () => number;
type _check_Paragraph_rightIndent_206 = IsExact<Ref_Paragraph_rightIndent_206, Auth_Paragraph_rightIndent_206>;
type _assert_Paragraph_rightIndent_206 = Expect<_check_Paragraph_rightIndent_206>;

type Ref_Paragraph_rightIndent_readonly_207 = { value: number };
type Auth_Paragraph_rightIndent_readonly_207 = { value: number };
type _check_Paragraph_rightIndent_readonly_207 = IsExact<Ref_Paragraph_rightIndent_readonly_207, Auth_Paragraph_rightIndent_readonly_207>;
type _assert_Paragraph_rightIndent_readonly_207 = Expect<_check_Paragraph_rightIndent_readonly_207>;

type Ref_Paragraph_search_208 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Paragraph_search_208 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Paragraph_search_208 = IsExact<Ref_Paragraph_search_208, Auth_Paragraph_search_208>;
type _assert_Paragraph_search_208 = Expect<_check_Paragraph_search_208>;

type Ref_Paragraph_spaceAfter_209 = () => number;
type Auth_Paragraph_spaceAfter_209 = () => number;
type _check_Paragraph_spaceAfter_209 = IsExact<Ref_Paragraph_spaceAfter_209, Auth_Paragraph_spaceAfter_209>;
type _assert_Paragraph_spaceAfter_209 = Expect<_check_Paragraph_spaceAfter_209>;

type Ref_Paragraph_spaceAfter_readonly_210 = { value: number };
type Auth_Paragraph_spaceAfter_readonly_210 = { value: number };
type _check_Paragraph_spaceAfter_readonly_210 = IsExact<Ref_Paragraph_spaceAfter_readonly_210, Auth_Paragraph_spaceAfter_readonly_210>;
type _assert_Paragraph_spaceAfter_readonly_210 = Expect<_check_Paragraph_spaceAfter_readonly_210>;

type Ref_Paragraph_spaceBefore_211 = () => number;
type Auth_Paragraph_spaceBefore_211 = () => number;
type _check_Paragraph_spaceBefore_211 = IsExact<Ref_Paragraph_spaceBefore_211, Auth_Paragraph_spaceBefore_211>;
type _assert_Paragraph_spaceBefore_211 = Expect<_check_Paragraph_spaceBefore_211>;

type Ref_Paragraph_spaceBefore_readonly_212 = { value: number };
type Auth_Paragraph_spaceBefore_readonly_212 = { value: number };
type _check_Paragraph_spaceBefore_readonly_212 = IsExact<Ref_Paragraph_spaceBefore_readonly_212, Auth_Paragraph_spaceBefore_readonly_212>;
type _assert_Paragraph_spaceBefore_readonly_212 = Expect<_check_Paragraph_spaceBefore_readonly_212>;

type Ref_Paragraph_split_213 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type Auth_Paragraph_split_213 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type _check_Paragraph_split_213 = IsExact<Ref_Paragraph_split_213, Auth_Paragraph_split_213>;
type _assert_Paragraph_split_213 = Expect<_check_Paragraph_split_213>;

type Ref_Paragraph_style_214 = () => string;
type Auth_Paragraph_style_214 = () => string;
type _check_Paragraph_style_214 = IsExact<Ref_Paragraph_style_214, Auth_Paragraph_style_214>;
type _assert_Paragraph_style_214 = Expect<_check_Paragraph_style_214>;

type Ref_Paragraph_style_readonly_215 = { value: string };
type Auth_Paragraph_style_readonly_215 = { value: string };
type _check_Paragraph_style_readonly_215 = IsExact<Ref_Paragraph_style_readonly_215, Auth_Paragraph_style_readonly_215>;
type _assert_Paragraph_style_readonly_215 = Expect<_check_Paragraph_style_readonly_215>;

type Ref_Paragraph_text_216 = () => string;
type Auth_Paragraph_text_216 = () => string;
type _check_Paragraph_text_216 = IsExact<Ref_Paragraph_text_216, Auth_Paragraph_text_216>;
type _assert_Paragraph_text_216 = Expect<_check_Paragraph_text_216>;

type Ref_Paragraph_text_readonly_217 = { readonly value: string };
type Auth_Paragraph_text_readonly_217 = { readonly value: string };
type _check_Paragraph_text_readonly_217 = IsExact<Ref_Paragraph_text_readonly_217, Auth_Paragraph_text_readonly_217>;
type _assert_Paragraph_text_readonly_217 = Expect<_check_Paragraph_text_readonly_217>;

type Ref_ParagraphCollection_getFirst_218 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getFirst_218 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getFirst_218 = IsExact<Ref_ParagraphCollection_getFirst_218, Auth_ParagraphCollection_getFirst_218>;
type _assert_ParagraphCollection_getFirst_218 = Expect<_check_ParagraphCollection_getFirst_218>;

type Ref_ParagraphCollection_getLast_219 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getLast_219 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getLast_219 = IsExact<Ref_ParagraphCollection_getLast_219, Auth_ParagraphCollection_getLast_219>;
type _assert_ParagraphCollection_getLast_219 = Expect<_check_ParagraphCollection_getLast_219>;

type Ref_ParagraphCollection_items_220 = () => DocxEditor.Paragraph[];
type Auth_ParagraphCollection_items_220 = () => DocxEditor.Paragraph[];
type _check_ParagraphCollection_items_220 = IsExact<Ref_ParagraphCollection_items_220, Auth_ParagraphCollection_items_220>;
type _assert_ParagraphCollection_items_220 = Expect<_check_ParagraphCollection_items_220>;

type Ref_ParagraphCollection_items_readonly_221 = { readonly value: DocxEditor.Paragraph[] };
type Auth_ParagraphCollection_items_readonly_221 = { readonly value: DocxEditor.Paragraph[] };
type _check_ParagraphCollection_items_readonly_221 = IsExact<Ref_ParagraphCollection_items_readonly_221, Auth_ParagraphCollection_items_readonly_221>;
type _assert_ParagraphCollection_items_readonly_221 = Expect<_check_ParagraphCollection_items_readonly_221>;

type Ref_Range_bookmarks_222 = () => DocxEditor.BookmarkCollection;
type Auth_Range_bookmarks_222 = () => DocxEditor.BookmarkCollection;
type _check_Range_bookmarks_222 = IsExact<Ref_Range_bookmarks_222, Auth_Range_bookmarks_222>;
type _assert_Range_bookmarks_222 = Expect<_check_Range_bookmarks_222>;

type Ref_Range_bookmarks_readonly_223 = { readonly value: DocxEditor.BookmarkCollection };
type Auth_Range_bookmarks_readonly_223 = { readonly value: DocxEditor.BookmarkCollection };
type _check_Range_bookmarks_readonly_223 = IsExact<Ref_Range_bookmarks_readonly_223, Auth_Range_bookmarks_readonly_223>;
type _assert_Range_bookmarks_readonly_223 = Expect<_check_Range_bookmarks_readonly_223>;

type Ref_Range_clear_224 = () => void;
type Auth_Range_clear_224 = () => void;
type _check_Range_clear_224 = IsExact<Ref_Range_clear_224, Auth_Range_clear_224>;
type _assert_Range_clear_224 = Expect<_check_Range_clear_224>;

type Ref_Range_contentControls_225 = () => DocxEditor.ContentControlCollection;
type Auth_Range_contentControls_225 = () => DocxEditor.ContentControlCollection;
type _check_Range_contentControls_225 = IsExact<Ref_Range_contentControls_225, Auth_Range_contentControls_225>;
type _assert_Range_contentControls_225 = Expect<_check_Range_contentControls_225>;

type Ref_Range_contentControls_readonly_226 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Range_contentControls_readonly_226 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Range_contentControls_readonly_226 = IsExact<Ref_Range_contentControls_readonly_226, Auth_Range_contentControls_readonly_226>;
type _assert_Range_contentControls_readonly_226 = Expect<_check_Range_contentControls_readonly_226>;

type Ref_Range_delete_227 = () => void;
type Auth_Range_delete_227 = () => void;
type _check_Range_delete_227 = IsExact<Ref_Range_delete_227, Auth_Range_delete_227>;
type _assert_Range_delete_227 = Expect<_check_Range_delete_227>;

type Ref_Range_expandTo_228 = (range: DocxEditor.Range) => DocxEditor.Range;
type Auth_Range_expandTo_228 = (range: DocxEditor.Range) => DocxEditor.Range;
type _check_Range_expandTo_228 = IsExact<Ref_Range_expandTo_228, Auth_Range_expandTo_228>;
type _assert_Range_expandTo_228 = Expect<_check_Range_expandTo_228>;

type Ref_Range_font_229 = () => DocxEditor.Font;
type Auth_Range_font_229 = () => DocxEditor.Font;
type _check_Range_font_229 = IsExact<Ref_Range_font_229, Auth_Range_font_229>;
type _assert_Range_font_229 = Expect<_check_Range_font_229>;

type Ref_Range_font_readonly_230 = { readonly value: DocxEditor.Font };
type Auth_Range_font_readonly_230 = { readonly value: DocxEditor.Font };
type _check_Range_font_readonly_230 = IsExact<Ref_Range_font_readonly_230, Auth_Range_font_readonly_230>;
type _assert_Range_font_readonly_230 = Expect<_check_Range_font_readonly_230>;

type Ref_Range_getBookmarks_231 = (includeHidden?: boolean, includeAdjacent?: boolean) => DocxEditor.ClientResult<string[]>;
type Auth_Range_getBookmarks_231 = (includeHidden?: boolean, includeAdjacent?: boolean) => DocxEditor.ClientResult<string[]>;
type _check_Range_getBookmarks_231 = IsExact<Ref_Range_getBookmarks_231, Auth_Range_getBookmarks_231>;
type _assert_Range_getBookmarks_231 = Expect<_check_Range_getBookmarks_231>;

type Ref_Range_getRange_232 = (rangeLocation?: "Whole" | "Start" | "End" | "After" | "Content") => DocxEditor.Range;
type Auth_Range_getRange_232 = (rangeLocation?: "Whole" | "Start" | "End" | "After" | "Content") => DocxEditor.Range;
type _check_Range_getRange_232 = IsExact<Ref_Range_getRange_232, Auth_Range_getRange_232>;
type _assert_Range_getRange_232 = Expect<_check_Range_getRange_232>;

type Ref_Range_getReviewedText_233 = (changeTrackingVersion?: DocxEditor.ChangeTrackingVersion) => DocxEditor.ClientResult<string>;
type Auth_Range_getReviewedText_233 = (changeTrackingVersion?: DocxEditor.ChangeTrackingVersion) => DocxEditor.ClientResult<string>;
type _check_Range_getReviewedText_233 = IsExact<Ref_Range_getReviewedText_233, Auth_Range_getReviewedText_233>;
type _assert_Range_getReviewedText_233 = Expect<_check_Range_getReviewedText_233>;

type Ref_Range_getReviewedText_234 = (changeTrackingVersion?: "Original" | "Current") => DocxEditor.ClientResult<string>;
type Auth_Range_getReviewedText_234 = (changeTrackingVersion?: "Original" | "Current") => DocxEditor.ClientResult<string>;
type _check_Range_getReviewedText_234 = IsExact<Ref_Range_getReviewedText_234, Auth_Range_getReviewedText_234>;
type _assert_Range_getReviewedText_234 = Expect<_check_Range_getReviewedText_234>;

type Ref_Range_getTextRanges_235 = (endingMarks: string[], trimSpacing?: boolean) => DocxEditor.RangeCollection;
type Auth_Range_getTextRanges_235 = (endingMarks: string[], trimSpacing?: boolean) => DocxEditor.RangeCollection;
type _check_Range_getTextRanges_235 = IsExact<Ref_Range_getTextRanges_235, Auth_Range_getTextRanges_235>;
type _assert_Range_getTextRanges_235 = Expect<_check_Range_getTextRanges_235>;

type Ref_Range_hyperlink_236 = () => string;
type Auth_Range_hyperlink_236 = () => string;
type _check_Range_hyperlink_236 = IsExact<Ref_Range_hyperlink_236, Auth_Range_hyperlink_236>;
type _assert_Range_hyperlink_236 = Expect<_check_Range_hyperlink_236>;

type Ref_Range_hyperlink_readonly_237 = { value: string };
type Auth_Range_hyperlink_readonly_237 = { value: string };
type _check_Range_hyperlink_readonly_237 = IsExact<Ref_Range_hyperlink_readonly_237, Auth_Range_hyperlink_readonly_237>;
type _assert_Range_hyperlink_readonly_237 = Expect<_check_Range_hyperlink_readonly_237>;

type Ref_Range_insertBookmark_238 = (name: string) => void;
type Auth_Range_insertBookmark_238 = (name: string) => void;
type _check_Range_insertBookmark_238 = IsExact<Ref_Range_insertBookmark_238, Auth_Range_insertBookmark_238>;
type _assert_Range_insertBookmark_238 = Expect<_check_Range_insertBookmark_238>;

type Ref_Range_insertComment_239 = (commentText: string) => DocxEditor.Comment;
type Auth_Range_insertComment_239 = (commentText: string) => DocxEditor.Comment;
type _check_Range_insertComment_239 = IsExact<Ref_Range_insertComment_239, Auth_Range_insertComment_239>;
type _assert_Range_insertComment_239 = Expect<_check_Range_insertComment_239>;

type Ref_Range_insertParagraph_240 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Range_insertParagraph_240 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Range_insertParagraph_240 = IsExact<Ref_Range_insertParagraph_240, Auth_Range_insertParagraph_240>;
type _assert_Range_insertParagraph_240 = Expect<_check_Range_insertParagraph_240>;

type Ref_Range_insertText_241 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type Auth_Range_insertText_241 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type _check_Range_insertText_241 = IsExact<Ref_Range_insertText_241, Auth_Range_insertText_241>;
type _assert_Range_insertText_241 = Expect<_check_Range_insertText_241>;

type Ref_Range_paragraphs_242 = () => DocxEditor.ParagraphCollection;
type Auth_Range_paragraphs_242 = () => DocxEditor.ParagraphCollection;
type _check_Range_paragraphs_242 = IsExact<Ref_Range_paragraphs_242, Auth_Range_paragraphs_242>;
type _assert_Range_paragraphs_242 = Expect<_check_Range_paragraphs_242>;

type Ref_Range_paragraphs_readonly_243 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Range_paragraphs_readonly_243 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Range_paragraphs_readonly_243 = IsExact<Ref_Range_paragraphs_readonly_243, Auth_Range_paragraphs_readonly_243>;
type _assert_Range_paragraphs_readonly_243 = Expect<_check_Range_paragraphs_readonly_243>;

type Ref_Range_revisions_244 = () => DocxEditor.RevisionCollection;
type Auth_Range_revisions_244 = () => DocxEditor.RevisionCollection;
type _check_Range_revisions_244 = IsExact<Ref_Range_revisions_244, Auth_Range_revisions_244>;
type _assert_Range_revisions_244 = Expect<_check_Range_revisions_244>;

type Ref_Range_revisions_readonly_245 = { readonly value: DocxEditor.RevisionCollection };
type Auth_Range_revisions_readonly_245 = { readonly value: DocxEditor.RevisionCollection };
type _check_Range_revisions_readonly_245 = IsExact<Ref_Range_revisions_readonly_245, Auth_Range_revisions_readonly_245>;
type _assert_Range_revisions_readonly_245 = Expect<_check_Range_revisions_readonly_245>;

type Ref_Range_search_246 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Range_search_246 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Range_search_246 = IsExact<Ref_Range_search_246, Auth_Range_search_246>;
type _assert_Range_search_246 = Expect<_check_Range_search_246>;

type Ref_Range_select_247 = (selectionMode?: DocxEditor.SelectionMode) => void;
type Auth_Range_select_247 = (selectionMode?: DocxEditor.SelectionMode) => void;
type _check_Range_select_247 = IsExact<Ref_Range_select_247, Auth_Range_select_247>;
type _assert_Range_select_247 = Expect<_check_Range_select_247>;

type Ref_Range_select_248 = (selectionMode?: "Select" | "Start" | "End") => void;
type Auth_Range_select_248 = (selectionMode?: "Select" | "Start" | "End") => void;
type _check_Range_select_248 = IsExact<Ref_Range_select_248, Auth_Range_select_248>;
type _assert_Range_select_248 = Expect<_check_Range_select_248>;

type Ref_Range_style_249 = () => string;
type Auth_Range_style_249 = () => string;
type _check_Range_style_249 = IsExact<Ref_Range_style_249, Auth_Range_style_249>;
type _assert_Range_style_249 = Expect<_check_Range_style_249>;

type Ref_Range_style_readonly_250 = { value: string };
type Auth_Range_style_readonly_250 = { value: string };
type _check_Range_style_readonly_250 = IsExact<Ref_Range_style_readonly_250, Auth_Range_style_readonly_250>;
type _assert_Range_style_readonly_250 = Expect<_check_Range_style_readonly_250>;

type Ref_Range_text_251 = () => string;
type Auth_Range_text_251 = () => string;
type _check_Range_text_251 = IsExact<Ref_Range_text_251, Auth_Range_text_251>;
type _assert_Range_text_251 = Expect<_check_Range_text_251>;

type Ref_Range_text_readonly_252 = { readonly value: string };
type Auth_Range_text_readonly_252 = { readonly value: string };
type _check_Range_text_readonly_252 = IsExact<Ref_Range_text_readonly_252, Auth_Range_text_readonly_252>;
type _assert_Range_text_readonly_252 = Expect<_check_Range_text_readonly_252>;

type Ref_RangeCollection_getFirst_253 = () => DocxEditor.Range;
type Auth_RangeCollection_getFirst_253 = () => DocxEditor.Range;
type _check_RangeCollection_getFirst_253 = IsExact<Ref_RangeCollection_getFirst_253, Auth_RangeCollection_getFirst_253>;
type _assert_RangeCollection_getFirst_253 = Expect<_check_RangeCollection_getFirst_253>;

type Ref_RangeCollection_items_254 = () => DocxEditor.Range[];
type Auth_RangeCollection_items_254 = () => DocxEditor.Range[];
type _check_RangeCollection_items_254 = IsExact<Ref_RangeCollection_items_254, Auth_RangeCollection_items_254>;
type _assert_RangeCollection_items_254 = Expect<_check_RangeCollection_items_254>;

type Ref_RangeCollection_items_readonly_255 = { readonly value: DocxEditor.Range[] };
type Auth_RangeCollection_items_readonly_255 = { readonly value: DocxEditor.Range[] };
type _check_RangeCollection_items_readonly_255 = IsExact<Ref_RangeCollection_items_readonly_255, Auth_RangeCollection_items_readonly_255>;
type _assert_RangeCollection_items_readonly_255 = Expect<_check_RangeCollection_items_readonly_255>;

type Ref_RequestContext_document_256 = () => DocxEditor.Document;
type Auth_RequestContext_document_256 = () => DocxEditor.Document;
type _check_RequestContext_document_256 = IsExact<Ref_RequestContext_document_256, Auth_RequestContext_document_256>;
type _assert_RequestContext_document_256 = Expect<_check_RequestContext_document_256>;

type Ref_RequestContext_document_readonly_257 = { readonly value: DocxEditor.Document };
type Auth_RequestContext_document_readonly_257 = { readonly value: DocxEditor.Document };
type _check_RequestContext_document_readonly_257 = IsExact<Ref_RequestContext_document_readonly_257, Auth_RequestContext_document_readonly_257>;
type _assert_RequestContext_document_readonly_257 = Expect<_check_RequestContext_document_readonly_257>;

type Ref_Revision_accept_258 = () => void;
type Auth_Revision_accept_258 = () => void;
type _check_Revision_accept_258 = IsExact<Ref_Revision_accept_258, Auth_Revision_accept_258>;
type _assert_Revision_accept_258 = Expect<_check_Revision_accept_258>;

type Ref_Revision_author_259 = () => string;
type Auth_Revision_author_259 = () => string;
type _check_Revision_author_259 = IsExact<Ref_Revision_author_259, Auth_Revision_author_259>;
type _assert_Revision_author_259 = Expect<_check_Revision_author_259>;

type Ref_Revision_author_readonly_260 = { readonly value: string };
type Auth_Revision_author_readonly_260 = { readonly value: string };
type _check_Revision_author_readonly_260 = IsExact<Ref_Revision_author_readonly_260, Auth_Revision_author_readonly_260>;
type _assert_Revision_author_readonly_260 = Expect<_check_Revision_author_readonly_260>;

type Ref_Revision_date_261 = () => Date;
type Auth_Revision_date_261 = () => Date;
type _check_Revision_date_261 = IsExact<Ref_Revision_date_261, Auth_Revision_date_261>;
type _assert_Revision_date_261 = Expect<_check_Revision_date_261>;

type Ref_Revision_date_readonly_262 = { readonly value: Date };
type Auth_Revision_date_readonly_262 = { readonly value: Date };
type _check_Revision_date_readonly_262 = IsExact<Ref_Revision_date_readonly_262, Auth_Revision_date_readonly_262>;
type _assert_Revision_date_readonly_262 = Expect<_check_Revision_date_readonly_262>;

type Ref_Revision_range_263 = () => DocxEditor.Range;
type Auth_Revision_range_263 = () => DocxEditor.Range;
type _check_Revision_range_263 = IsExact<Ref_Revision_range_263, Auth_Revision_range_263>;
type _assert_Revision_range_263 = Expect<_check_Revision_range_263>;

type Ref_Revision_range_readonly_264 = { readonly value: DocxEditor.Range };
type Auth_Revision_range_readonly_264 = { readonly value: DocxEditor.Range };
type _check_Revision_range_readonly_264 = IsExact<Ref_Revision_range_readonly_264, Auth_Revision_range_readonly_264>;
type _assert_Revision_range_readonly_264 = Expect<_check_Revision_range_readonly_264>;

type Ref_Revision_reject_265 = () => void;
type Auth_Revision_reject_265 = () => void;
type _check_Revision_reject_265 = IsExact<Ref_Revision_reject_265, Auth_Revision_reject_265>;
type _assert_Revision_reject_265 = Expect<_check_Revision_reject_265>;

type Ref_Revision_type_266 = () => "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete";
type Auth_Revision_type_266 = () => "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete";
type _check_Revision_type_266 = IsExact<Ref_Revision_type_266, Auth_Revision_type_266>;
type _assert_Revision_type_266 = Expect<_check_Revision_type_266>;

type Ref_Revision_type_readonly_267 = { readonly value: "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete" };
type Auth_Revision_type_readonly_267 = { readonly value: "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete" };
type _check_Revision_type_readonly_267 = IsExact<Ref_Revision_type_readonly_267, Auth_Revision_type_readonly_267>;
type _assert_Revision_type_readonly_267 = Expect<_check_Revision_type_readonly_267>;

type Ref_RevisionCollection_acceptAll_268 = () => void;
type Auth_RevisionCollection_acceptAll_268 = () => void;
type _check_RevisionCollection_acceptAll_268 = IsExact<Ref_RevisionCollection_acceptAll_268, Auth_RevisionCollection_acceptAll_268>;
type _assert_RevisionCollection_acceptAll_268 = Expect<_check_RevisionCollection_acceptAll_268>;

type Ref_RevisionCollection_items_269 = () => DocxEditor.Revision[];
type Auth_RevisionCollection_items_269 = () => DocxEditor.Revision[];
type _check_RevisionCollection_items_269 = IsExact<Ref_RevisionCollection_items_269, Auth_RevisionCollection_items_269>;
type _assert_RevisionCollection_items_269 = Expect<_check_RevisionCollection_items_269>;

type Ref_RevisionCollection_items_readonly_270 = { readonly value: DocxEditor.Revision[] };
type Auth_RevisionCollection_items_readonly_270 = { readonly value: DocxEditor.Revision[] };
type _check_RevisionCollection_items_readonly_270 = IsExact<Ref_RevisionCollection_items_readonly_270, Auth_RevisionCollection_items_readonly_270>;
type _assert_RevisionCollection_items_readonly_270 = Expect<_check_RevisionCollection_items_readonly_270>;

type Ref_RevisionCollection_rejectAll_271 = () => void;
type Auth_RevisionCollection_rejectAll_271 = () => void;
type _check_RevisionCollection_rejectAll_271 = IsExact<Ref_RevisionCollection_rejectAll_271, Auth_RevisionCollection_rejectAll_271>;
type _assert_RevisionCollection_rejectAll_271 = Expect<_check_RevisionCollection_rejectAll_271>;

type Ref_SearchOptions_ignorePunct_272 = () => boolean;
type Auth_SearchOptions_ignorePunct_272 = () => boolean;
type _check_SearchOptions_ignorePunct_272 = IsExact<Ref_SearchOptions_ignorePunct_272, Auth_SearchOptions_ignorePunct_272>;
type _assert_SearchOptions_ignorePunct_272 = Expect<_check_SearchOptions_ignorePunct_272>;

type Ref_SearchOptions_ignorePunct_readonly_273 = { value: boolean };
type Auth_SearchOptions_ignorePunct_readonly_273 = { value: boolean };
type _check_SearchOptions_ignorePunct_readonly_273 = IsExact<Ref_SearchOptions_ignorePunct_readonly_273, Auth_SearchOptions_ignorePunct_readonly_273>;
type _assert_SearchOptions_ignorePunct_readonly_273 = Expect<_check_SearchOptions_ignorePunct_readonly_273>;

type Ref_SearchOptions_ignoreSpace_274 = () => boolean;
type Auth_SearchOptions_ignoreSpace_274 = () => boolean;
type _check_SearchOptions_ignoreSpace_274 = IsExact<Ref_SearchOptions_ignoreSpace_274, Auth_SearchOptions_ignoreSpace_274>;
type _assert_SearchOptions_ignoreSpace_274 = Expect<_check_SearchOptions_ignoreSpace_274>;

type Ref_SearchOptions_ignoreSpace_readonly_275 = { value: boolean };
type Auth_SearchOptions_ignoreSpace_readonly_275 = { value: boolean };
type _check_SearchOptions_ignoreSpace_readonly_275 = IsExact<Ref_SearchOptions_ignoreSpace_readonly_275, Auth_SearchOptions_ignoreSpace_readonly_275>;
type _assert_SearchOptions_ignoreSpace_readonly_275 = Expect<_check_SearchOptions_ignoreSpace_readonly_275>;

type Ref_SearchOptions_matchCase_276 = () => boolean;
type Auth_SearchOptions_matchCase_276 = () => boolean;
type _check_SearchOptions_matchCase_276 = IsExact<Ref_SearchOptions_matchCase_276, Auth_SearchOptions_matchCase_276>;
type _assert_SearchOptions_matchCase_276 = Expect<_check_SearchOptions_matchCase_276>;

type Ref_SearchOptions_matchCase_readonly_277 = { value: boolean };
type Auth_SearchOptions_matchCase_readonly_277 = { value: boolean };
type _check_SearchOptions_matchCase_readonly_277 = IsExact<Ref_SearchOptions_matchCase_readonly_277, Auth_SearchOptions_matchCase_readonly_277>;
type _assert_SearchOptions_matchCase_readonly_277 = Expect<_check_SearchOptions_matchCase_readonly_277>;

type Ref_SearchOptions_matchWholeWord_278 = () => boolean;
type Auth_SearchOptions_matchWholeWord_278 = () => boolean;
type _check_SearchOptions_matchWholeWord_278 = IsExact<Ref_SearchOptions_matchWholeWord_278, Auth_SearchOptions_matchWholeWord_278>;
type _assert_SearchOptions_matchWholeWord_278 = Expect<_check_SearchOptions_matchWholeWord_278>;

type Ref_SearchOptions_matchWholeWord_readonly_279 = { value: boolean };
type Auth_SearchOptions_matchWholeWord_readonly_279 = { value: boolean };
type _check_SearchOptions_matchWholeWord_readonly_279 = IsExact<Ref_SearchOptions_matchWholeWord_readonly_279, Auth_SearchOptions_matchWholeWord_readonly_279>;
type _assert_SearchOptions_matchWholeWord_readonly_279 = Expect<_check_SearchOptions_matchWholeWord_readonly_279>;

type Ref_SearchOptions_matchWildcards_280 = () => boolean;
type Auth_SearchOptions_matchWildcards_280 = () => boolean;
type _check_SearchOptions_matchWildcards_280 = IsExact<Ref_SearchOptions_matchWildcards_280, Auth_SearchOptions_matchWildcards_280>;
type _assert_SearchOptions_matchWildcards_280 = Expect<_check_SearchOptions_matchWildcards_280>;

type Ref_SearchOptions_matchWildcards_readonly_281 = { value: boolean };
type Auth_SearchOptions_matchWildcards_readonly_281 = { value: boolean };
type _check_SearchOptions_matchWildcards_readonly_281 = IsExact<Ref_SearchOptions_matchWildcards_readonly_281, Auth_SearchOptions_matchWildcards_readonly_281>;
type _assert_SearchOptions_matchWildcards_readonly_281 = Expect<_check_SearchOptions_matchWildcards_readonly_281>;

type Ref_Section_body_282 = () => DocxEditor.Body;
type Auth_Section_body_282 = () => DocxEditor.Body;
type _check_Section_body_282 = IsExact<Ref_Section_body_282, Auth_Section_body_282>;
type _assert_Section_body_282 = Expect<_check_Section_body_282>;

type Ref_Section_body_readonly_283 = { readonly value: DocxEditor.Body };
type Auth_Section_body_readonly_283 = { readonly value: DocxEditor.Body };
type _check_Section_body_readonly_283 = IsExact<Ref_Section_body_readonly_283, Auth_Section_body_readonly_283>;
type _assert_Section_body_readonly_283 = Expect<_check_Section_body_readonly_283>;

type Ref_Section_getFooter_284 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type Auth_Section_getFooter_284 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type _check_Section_getFooter_284 = IsExact<Ref_Section_getFooter_284, Auth_Section_getFooter_284>;
type _assert_Section_getFooter_284 = Expect<_check_Section_getFooter_284>;

type Ref_Section_getFooter_285 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type Auth_Section_getFooter_285 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type _check_Section_getFooter_285 = IsExact<Ref_Section_getFooter_285, Auth_Section_getFooter_285>;
type _assert_Section_getFooter_285 = Expect<_check_Section_getFooter_285>;

type Ref_Section_getHeader_286 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type Auth_Section_getHeader_286 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type _check_Section_getHeader_286 = IsExact<Ref_Section_getHeader_286, Auth_Section_getHeader_286>;
type _assert_Section_getHeader_286 = Expect<_check_Section_getHeader_286>;

type Ref_Section_getHeader_287 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type Auth_Section_getHeader_287 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type _check_Section_getHeader_287 = IsExact<Ref_Section_getHeader_287, Auth_Section_getHeader_287>;
type _assert_Section_getHeader_287 = Expect<_check_Section_getHeader_287>;

type Ref_Section_getNext_288 = () => DocxEditor.Section;
type Auth_Section_getNext_288 = () => DocxEditor.Section;
type _check_Section_getNext_288 = IsExact<Ref_Section_getNext_288, Auth_Section_getNext_288>;
type _assert_Section_getNext_288 = Expect<_check_Section_getNext_288>;

type Ref_Section_pageSetup_289 = () => DocxEditor.PageSetup;
type Auth_Section_pageSetup_289 = () => DocxEditor.PageSetup;
type _check_Section_pageSetup_289 = IsExact<Ref_Section_pageSetup_289, Auth_Section_pageSetup_289>;
type _assert_Section_pageSetup_289 = Expect<_check_Section_pageSetup_289>;

type Ref_Section_pageSetup_readonly_290 = { readonly value: DocxEditor.PageSetup };
type Auth_Section_pageSetup_readonly_290 = { readonly value: DocxEditor.PageSetup };
type _check_Section_pageSetup_readonly_290 = IsExact<Ref_Section_pageSetup_readonly_290, Auth_Section_pageSetup_readonly_290>;
type _assert_Section_pageSetup_readonly_290 = Expect<_check_Section_pageSetup_readonly_290>;

type Ref_SectionCollection_getFirst_291 = () => DocxEditor.Section;
type Auth_SectionCollection_getFirst_291 = () => DocxEditor.Section;
type _check_SectionCollection_getFirst_291 = IsExact<Ref_SectionCollection_getFirst_291, Auth_SectionCollection_getFirst_291>;
type _assert_SectionCollection_getFirst_291 = Expect<_check_SectionCollection_getFirst_291>;

type Ref_SectionCollection_items_292 = () => DocxEditor.Section[];
type Auth_SectionCollection_items_292 = () => DocxEditor.Section[];
type _check_SectionCollection_items_292 = IsExact<Ref_SectionCollection_items_292, Auth_SectionCollection_items_292>;
type _assert_SectionCollection_items_292 = Expect<_check_SectionCollection_items_292>;

type Ref_SectionCollection_items_readonly_293 = { readonly value: DocxEditor.Section[] };
type Auth_SectionCollection_items_readonly_293 = { readonly value: DocxEditor.Section[] };
type _check_SectionCollection_items_readonly_293 = IsExact<Ref_SectionCollection_items_readonly_293, Auth_SectionCollection_items_readonly_293>;
type _assert_SectionCollection_items_readonly_293 = Expect<_check_SectionCollection_items_readonly_293>;

type Ref_Style_baseStyle_294 = () => string;
type Auth_Style_baseStyle_294 = () => string;
type _check_Style_baseStyle_294 = IsExact<Ref_Style_baseStyle_294, Auth_Style_baseStyle_294>;
type _assert_Style_baseStyle_294 = Expect<_check_Style_baseStyle_294>;

type Ref_Style_baseStyle_readonly_295 = { value: string };
type Auth_Style_baseStyle_readonly_295 = { value: string };
type _check_Style_baseStyle_readonly_295 = IsExact<Ref_Style_baseStyle_readonly_295, Auth_Style_baseStyle_readonly_295>;
type _assert_Style_baseStyle_readonly_295 = Expect<_check_Style_baseStyle_readonly_295>;

type Ref_Style_builtIn_296 = () => boolean;
type Auth_Style_builtIn_296 = () => boolean;
type _check_Style_builtIn_296 = IsExact<Ref_Style_builtIn_296, Auth_Style_builtIn_296>;
type _assert_Style_builtIn_296 = Expect<_check_Style_builtIn_296>;

type Ref_Style_builtIn_readonly_297 = { readonly value: boolean };
type Auth_Style_builtIn_readonly_297 = { readonly value: boolean };
type _check_Style_builtIn_readonly_297 = IsExact<Ref_Style_builtIn_readonly_297, Auth_Style_builtIn_readonly_297>;
type _assert_Style_builtIn_readonly_297 = Expect<_check_Style_builtIn_readonly_297>;

type Ref_Style_linked_298 = () => boolean;
type Auth_Style_linked_298 = () => boolean;
type _check_Style_linked_298 = IsExact<Ref_Style_linked_298, Auth_Style_linked_298>;
type _assert_Style_linked_298 = Expect<_check_Style_linked_298>;

type Ref_Style_linked_readonly_299 = { readonly value: boolean };
type Auth_Style_linked_readonly_299 = { readonly value: boolean };
type _check_Style_linked_readonly_299 = IsExact<Ref_Style_linked_readonly_299, Auth_Style_linked_readonly_299>;
type _assert_Style_linked_readonly_299 = Expect<_check_Style_linked_readonly_299>;

type Ref_Style_nameLocal_300 = () => string;
type Auth_Style_nameLocal_300 = () => string;
type _check_Style_nameLocal_300 = IsExact<Ref_Style_nameLocal_300, Auth_Style_nameLocal_300>;
type _assert_Style_nameLocal_300 = Expect<_check_Style_nameLocal_300>;

type Ref_Style_nameLocal_readonly_301 = { readonly value: string };
type Auth_Style_nameLocal_readonly_301 = { readonly value: string };
type _check_Style_nameLocal_readonly_301 = IsExact<Ref_Style_nameLocal_readonly_301, Auth_Style_nameLocal_readonly_301>;
type _assert_Style_nameLocal_readonly_301 = Expect<_check_Style_nameLocal_readonly_301>;

type Ref_Style_nextParagraphStyle_302 = () => string;
type Auth_Style_nextParagraphStyle_302 = () => string;
type _check_Style_nextParagraphStyle_302 = IsExact<Ref_Style_nextParagraphStyle_302, Auth_Style_nextParagraphStyle_302>;
type _assert_Style_nextParagraphStyle_302 = Expect<_check_Style_nextParagraphStyle_302>;

type Ref_Style_nextParagraphStyle_readonly_303 = { value: string };
type Auth_Style_nextParagraphStyle_readonly_303 = { value: string };
type _check_Style_nextParagraphStyle_readonly_303 = IsExact<Ref_Style_nextParagraphStyle_readonly_303, Auth_Style_nextParagraphStyle_readonly_303>;
type _assert_Style_nextParagraphStyle_readonly_303 = Expect<_check_Style_nextParagraphStyle_readonly_303>;

type Ref_Style_priority_304 = () => number;
type Auth_Style_priority_304 = () => number;
type _check_Style_priority_304 = IsExact<Ref_Style_priority_304, Auth_Style_priority_304>;
type _assert_Style_priority_304 = Expect<_check_Style_priority_304>;

type Ref_Style_priority_readonly_305 = { value: number };
type Auth_Style_priority_readonly_305 = { value: number };
type _check_Style_priority_readonly_305 = IsExact<Ref_Style_priority_readonly_305, Auth_Style_priority_readonly_305>;
type _assert_Style_priority_readonly_305 = Expect<_check_Style_priority_readonly_305>;

type Ref_Style_quickStyle_306 = () => boolean;
type Auth_Style_quickStyle_306 = () => boolean;
type _check_Style_quickStyle_306 = IsExact<Ref_Style_quickStyle_306, Auth_Style_quickStyle_306>;
type _assert_Style_quickStyle_306 = Expect<_check_Style_quickStyle_306>;

type Ref_Style_quickStyle_readonly_307 = { value: boolean };
type Auth_Style_quickStyle_readonly_307 = { value: boolean };
type _check_Style_quickStyle_readonly_307 = IsExact<Ref_Style_quickStyle_readonly_307, Auth_Style_quickStyle_readonly_307>;
type _assert_Style_quickStyle_readonly_307 = Expect<_check_Style_quickStyle_readonly_307>;

type Ref_Style_type_308 = () => "Character" | "List" | "Paragraph" | "Table";
type Auth_Style_type_308 = () => "Character" | "List" | "Paragraph" | "Table";
type _check_Style_type_308 = IsExact<Ref_Style_type_308, Auth_Style_type_308>;
type _assert_Style_type_308 = Expect<_check_Style_type_308>;

type Ref_Style_type_readonly_309 = { readonly value: "Character" | "List" | "Paragraph" | "Table" };
type Auth_Style_type_readonly_309 = { readonly value: "Character" | "List" | "Paragraph" | "Table" };
type _check_Style_type_readonly_309 = IsExact<Ref_Style_type_readonly_309, Auth_Style_type_readonly_309>;
type _assert_Style_type_readonly_309 = Expect<_check_Style_type_readonly_309>;

type Ref_Style_unhideWhenUsed_310 = () => boolean;
type Auth_Style_unhideWhenUsed_310 = () => boolean;
type _check_Style_unhideWhenUsed_310 = IsExact<Ref_Style_unhideWhenUsed_310, Auth_Style_unhideWhenUsed_310>;
type _assert_Style_unhideWhenUsed_310 = Expect<_check_Style_unhideWhenUsed_310>;

type Ref_Style_unhideWhenUsed_readonly_311 = { value: boolean };
type Auth_Style_unhideWhenUsed_readonly_311 = { value: boolean };
type _check_Style_unhideWhenUsed_readonly_311 = IsExact<Ref_Style_unhideWhenUsed_readonly_311, Auth_Style_unhideWhenUsed_readonly_311>;
type _assert_Style_unhideWhenUsed_readonly_311 = Expect<_check_Style_unhideWhenUsed_readonly_311>;

type Ref_Style_visibility_312 = () => boolean;
type Auth_Style_visibility_312 = () => boolean;
type _check_Style_visibility_312 = IsExact<Ref_Style_visibility_312, Auth_Style_visibility_312>;
type _assert_Style_visibility_312 = Expect<_check_Style_visibility_312>;

type Ref_Style_visibility_readonly_313 = { value: boolean };
type Auth_Style_visibility_readonly_313 = { value: boolean };
type _check_Style_visibility_readonly_313 = IsExact<Ref_Style_visibility_readonly_313, Auth_Style_visibility_readonly_313>;
type _assert_Style_visibility_readonly_313 = Expect<_check_Style_visibility_readonly_313>;

type Ref_StyleCollection_getByNameOrNullObject_314 = (name: string) => DocxEditor.Style;
type Auth_StyleCollection_getByNameOrNullObject_314 = (name: string) => DocxEditor.Style;
type _check_StyleCollection_getByNameOrNullObject_314 = IsExact<Ref_StyleCollection_getByNameOrNullObject_314, Auth_StyleCollection_getByNameOrNullObject_314>;
type _assert_StyleCollection_getByNameOrNullObject_314 = Expect<_check_StyleCollection_getByNameOrNullObject_314>;

type Ref_StyleCollection_getCount_315 = () => DocxEditor.ClientResult<number>;
type Auth_StyleCollection_getCount_315 = () => DocxEditor.ClientResult<number>;
type _check_StyleCollection_getCount_315 = IsExact<Ref_StyleCollection_getCount_315, Auth_StyleCollection_getCount_315>;
type _assert_StyleCollection_getCount_315 = Expect<_check_StyleCollection_getCount_315>;

type Ref_StyleCollection_items_316 = () => DocxEditor.Style[];
type Auth_StyleCollection_items_316 = () => DocxEditor.Style[];
type _check_StyleCollection_items_316 = IsExact<Ref_StyleCollection_items_316, Auth_StyleCollection_items_316>;
type _assert_StyleCollection_items_316 = Expect<_check_StyleCollection_items_316>;

type Ref_StyleCollection_items_readonly_317 = { readonly value: DocxEditor.Style[] };
type Auth_StyleCollection_items_readonly_317 = { readonly value: DocxEditor.Style[] };
type _check_StyleCollection_items_readonly_317 = IsExact<Ref_StyleCollection_items_readonly_317, Auth_StyleCollection_items_readonly_317>;
type _assert_StyleCollection_items_readonly_317 = Expect<_check_StyleCollection_items_readonly_317>;

type Ref_run_318 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_318 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_318 = IsExact<Ref_run_318, Auth_run_318>;
type _assert_run_318 = Expect<_check_run_318>;

type Ref_run_319 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_319 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_319 = IsExact<Ref_run_319, Auth_run_319>;
type _assert_run_319 = Expect<_check_run_319>;

type Ref_run_320 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_320 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_320 = IsExact<Ref_run_320, Auth_run_320>;
type _assert_run_320 = Expect<_check_run_320>;

