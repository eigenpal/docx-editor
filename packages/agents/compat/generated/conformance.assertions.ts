// GENERATED FILE — do not edit by hand.
//
// Produced by packages/agents/scripts/generate-conformance.mjs from
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

type Ref_Body_font_3 = () => DocxEditor.Font;
type Auth_Body_font_3 = () => DocxEditor.Font;
type _check_Body_font_3 = IsExact<Ref_Body_font_3, Auth_Body_font_3>;
type _assert_Body_font_3 = Expect<_check_Body_font_3>;

type Ref_Body_font_readonly_4 = { readonly value: DocxEditor.Font };
type Auth_Body_font_readonly_4 = { readonly value: DocxEditor.Font };
type _check_Body_font_readonly_4 = IsExact<Ref_Body_font_readonly_4, Auth_Body_font_readonly_4>;
type _assert_Body_font_readonly_4 = Expect<_check_Body_font_readonly_4>;

type Ref_Body_insertParagraph_5 = (paragraphText: string, insertLocation: "Start" | "End") => DocxEditor.Paragraph;
type Auth_Body_insertParagraph_5 = (paragraphText: string, insertLocation: "Start" | "End") => DocxEditor.Paragraph;
type _check_Body_insertParagraph_5 = IsExact<Ref_Body_insertParagraph_5, Auth_Body_insertParagraph_5>;
type _assert_Body_insertParagraph_5 = Expect<_check_Body_insertParagraph_5>;

type Ref_Body_insertText_6 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Body_insertText_6 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Body_insertText_6 = IsExact<Ref_Body_insertText_6, Auth_Body_insertText_6>;
type _assert_Body_insertText_6 = Expect<_check_Body_insertText_6>;

type Ref_Body_paragraphs_7 = () => DocxEditor.ParagraphCollection;
type Auth_Body_paragraphs_7 = () => DocxEditor.ParagraphCollection;
type _check_Body_paragraphs_7 = IsExact<Ref_Body_paragraphs_7, Auth_Body_paragraphs_7>;
type _assert_Body_paragraphs_7 = Expect<_check_Body_paragraphs_7>;

type Ref_Body_paragraphs_readonly_8 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Body_paragraphs_readonly_8 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Body_paragraphs_readonly_8 = IsExact<Ref_Body_paragraphs_readonly_8, Auth_Body_paragraphs_readonly_8>;
type _assert_Body_paragraphs_readonly_8 = Expect<_check_Body_paragraphs_readonly_8>;

type Ref_Body_search_9 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Body_search_9 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Body_search_9 = IsExact<Ref_Body_search_9, Auth_Body_search_9>;
type _assert_Body_search_9 = Expect<_check_Body_search_9>;

type Ref_Body_style_10 = () => string;
type Auth_Body_style_10 = () => string;
type _check_Body_style_10 = IsExact<Ref_Body_style_10, Auth_Body_style_10>;
type _assert_Body_style_10 = Expect<_check_Body_style_10>;

type Ref_Body_style_readonly_11 = { value: string };
type Auth_Body_style_readonly_11 = { value: string };
type _check_Body_style_readonly_11 = IsExact<Ref_Body_style_readonly_11, Auth_Body_style_readonly_11>;
type _assert_Body_style_readonly_11 = Expect<_check_Body_style_readonly_11>;

type Ref_Body_text_12 = () => string;
type Auth_Body_text_12 = () => string;
type _check_Body_text_12 = IsExact<Ref_Body_text_12, Auth_Body_text_12>;
type _assert_Body_text_12 = Expect<_check_Body_text_12>;

type Ref_Body_text_readonly_13 = { readonly value: string };
type Auth_Body_text_readonly_13 = { readonly value: string };
type _check_Body_text_readonly_13 = IsExact<Ref_Body_text_readonly_13, Auth_Body_text_readonly_13>;
type _assert_Body_text_readonly_13 = Expect<_check_Body_text_readonly_13>;

type Ref_ClientObject_context_14 = () => DocxEditor.ClientRequestContext;
type Auth_ClientObject_context_14 = () => DocxEditor.ClientRequestContext;
type _check_ClientObject_context_14 = IsExact<Ref_ClientObject_context_14, Auth_ClientObject_context_14>;
type _assert_ClientObject_context_14 = Expect<_check_ClientObject_context_14>;

type Ref_ClientObject_context_readonly_15 = { value: DocxEditor.ClientRequestContext };
type Auth_ClientObject_context_readonly_15 = { value: DocxEditor.ClientRequestContext };
type _check_ClientObject_context_readonly_15 = IsExact<Ref_ClientObject_context_readonly_15, Auth_ClientObject_context_readonly_15>;
type _assert_ClientObject_context_readonly_15 = Expect<_check_ClientObject_context_readonly_15>;

type Ref_ClientObject_isNullObject_16 = () => boolean;
type Auth_ClientObject_isNullObject_16 = () => boolean;
type _check_ClientObject_isNullObject_16 = IsExact<Ref_ClientObject_isNullObject_16, Auth_ClientObject_isNullObject_16>;
type _assert_ClientObject_isNullObject_16 = Expect<_check_ClientObject_isNullObject_16>;

type Ref_ClientObject_isNullObject_readonly_17 = { value: boolean };
type Auth_ClientObject_isNullObject_readonly_17 = { value: boolean };
type _check_ClientObject_isNullObject_readonly_17 = IsExact<Ref_ClientObject_isNullObject_readonly_17, Auth_ClientObject_isNullObject_readonly_17>;
type _assert_ClientObject_isNullObject_readonly_17 = Expect<_check_ClientObject_isNullObject_readonly_17>;

type Ref_ContentControl_appearance_18 = () => "BoundingBox" | "Tags" | "Hidden";
type Auth_ContentControl_appearance_18 = () => "BoundingBox" | "Tags" | "Hidden";
type _check_ContentControl_appearance_18 = IsExact<Ref_ContentControl_appearance_18, Auth_ContentControl_appearance_18>;
type _assert_ContentControl_appearance_18 = Expect<_check_ContentControl_appearance_18>;

type Ref_ContentControl_appearance_readonly_19 = { value: "BoundingBox" | "Tags" | "Hidden" };
type Auth_ContentControl_appearance_readonly_19 = { value: "BoundingBox" | "Tags" | "Hidden" };
type _check_ContentControl_appearance_readonly_19 = IsExact<Ref_ContentControl_appearance_readonly_19, Auth_ContentControl_appearance_readonly_19>;
type _assert_ContentControl_appearance_readonly_19 = Expect<_check_ContentControl_appearance_readonly_19>;

type Ref_ContentControl_cannotDelete_20 = () => boolean;
type Auth_ContentControl_cannotDelete_20 = () => boolean;
type _check_ContentControl_cannotDelete_20 = IsExact<Ref_ContentControl_cannotDelete_20, Auth_ContentControl_cannotDelete_20>;
type _assert_ContentControl_cannotDelete_20 = Expect<_check_ContentControl_cannotDelete_20>;

type Ref_ContentControl_cannotDelete_readonly_21 = { value: boolean };
type Auth_ContentControl_cannotDelete_readonly_21 = { value: boolean };
type _check_ContentControl_cannotDelete_readonly_21 = IsExact<Ref_ContentControl_cannotDelete_readonly_21, Auth_ContentControl_cannotDelete_readonly_21>;
type _assert_ContentControl_cannotDelete_readonly_21 = Expect<_check_ContentControl_cannotDelete_readonly_21>;

type Ref_ContentControl_cannotEdit_22 = () => boolean;
type Auth_ContentControl_cannotEdit_22 = () => boolean;
type _check_ContentControl_cannotEdit_22 = IsExact<Ref_ContentControl_cannotEdit_22, Auth_ContentControl_cannotEdit_22>;
type _assert_ContentControl_cannotEdit_22 = Expect<_check_ContentControl_cannotEdit_22>;

type Ref_ContentControl_cannotEdit_readonly_23 = { value: boolean };
type Auth_ContentControl_cannotEdit_readonly_23 = { value: boolean };
type _check_ContentControl_cannotEdit_readonly_23 = IsExact<Ref_ContentControl_cannotEdit_readonly_23, Auth_ContentControl_cannotEdit_readonly_23>;
type _assert_ContentControl_cannotEdit_readonly_23 = Expect<_check_ContentControl_cannotEdit_readonly_23>;

type Ref_ContentControl_color_24 = () => string;
type Auth_ContentControl_color_24 = () => string;
type _check_ContentControl_color_24 = IsExact<Ref_ContentControl_color_24, Auth_ContentControl_color_24>;
type _assert_ContentControl_color_24 = Expect<_check_ContentControl_color_24>;

type Ref_ContentControl_color_readonly_25 = { value: string };
type Auth_ContentControl_color_readonly_25 = { value: string };
type _check_ContentControl_color_readonly_25 = IsExact<Ref_ContentControl_color_readonly_25, Auth_ContentControl_color_readonly_25>;
type _assert_ContentControl_color_readonly_25 = Expect<_check_ContentControl_color_readonly_25>;

type Ref_ContentControl_contentControls_26 = () => DocxEditor.ContentControlCollection;
type Auth_ContentControl_contentControls_26 = () => DocxEditor.ContentControlCollection;
type _check_ContentControl_contentControls_26 = IsExact<Ref_ContentControl_contentControls_26, Auth_ContentControl_contentControls_26>;
type _assert_ContentControl_contentControls_26 = Expect<_check_ContentControl_contentControls_26>;

type Ref_ContentControl_contentControls_readonly_27 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_ContentControl_contentControls_readonly_27 = { readonly value: DocxEditor.ContentControlCollection };
type _check_ContentControl_contentControls_readonly_27 = IsExact<Ref_ContentControl_contentControls_readonly_27, Auth_ContentControl_contentControls_readonly_27>;
type _assert_ContentControl_contentControls_readonly_27 = Expect<_check_ContentControl_contentControls_readonly_27>;

type Ref_ContentControl_delete_28 = (keepContent: boolean) => void;
type Auth_ContentControl_delete_28 = (keepContent: boolean) => void;
type _check_ContentControl_delete_28 = IsExact<Ref_ContentControl_delete_28, Auth_ContentControl_delete_28>;
type _assert_ContentControl_delete_28 = Expect<_check_ContentControl_delete_28>;

type Ref_ContentControl_getRange_29 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type Auth_ContentControl_getRange_29 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type _check_ContentControl_getRange_29 = IsExact<Ref_ContentControl_getRange_29, Auth_ContentControl_getRange_29>;
type _assert_ContentControl_getRange_29 = Expect<_check_ContentControl_getRange_29>;

type Ref_ContentControl_id_30 = () => number;
type Auth_ContentControl_id_30 = () => number;
type _check_ContentControl_id_30 = IsExact<Ref_ContentControl_id_30, Auth_ContentControl_id_30>;
type _assert_ContentControl_id_30 = Expect<_check_ContentControl_id_30>;

type Ref_ContentControl_id_readonly_31 = { readonly value: number };
type Auth_ContentControl_id_readonly_31 = { readonly value: number };
type _check_ContentControl_id_readonly_31 = IsExact<Ref_ContentControl_id_readonly_31, Auth_ContentControl_id_readonly_31>;
type _assert_ContentControl_id_readonly_31 = Expect<_check_ContentControl_id_readonly_31>;

type Ref_ContentControl_insertText_32 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_ContentControl_insertText_32 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_ContentControl_insertText_32 = IsExact<Ref_ContentControl_insertText_32, Auth_ContentControl_insertText_32>;
type _assert_ContentControl_insertText_32 = Expect<_check_ContentControl_insertText_32>;

type Ref_ContentControl_paragraphs_33 = () => DocxEditor.ParagraphCollection;
type Auth_ContentControl_paragraphs_33 = () => DocxEditor.ParagraphCollection;
type _check_ContentControl_paragraphs_33 = IsExact<Ref_ContentControl_paragraphs_33, Auth_ContentControl_paragraphs_33>;
type _assert_ContentControl_paragraphs_33 = Expect<_check_ContentControl_paragraphs_33>;

type Ref_ContentControl_paragraphs_readonly_34 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_ContentControl_paragraphs_readonly_34 = { readonly value: DocxEditor.ParagraphCollection };
type _check_ContentControl_paragraphs_readonly_34 = IsExact<Ref_ContentControl_paragraphs_readonly_34, Auth_ContentControl_paragraphs_readonly_34>;
type _assert_ContentControl_paragraphs_readonly_34 = Expect<_check_ContentControl_paragraphs_readonly_34>;

type Ref_ContentControl_placeholderText_35 = () => string;
type Auth_ContentControl_placeholderText_35 = () => string;
type _check_ContentControl_placeholderText_35 = IsExact<Ref_ContentControl_placeholderText_35, Auth_ContentControl_placeholderText_35>;
type _assert_ContentControl_placeholderText_35 = Expect<_check_ContentControl_placeholderText_35>;

type Ref_ContentControl_placeholderText_readonly_36 = { value: string };
type Auth_ContentControl_placeholderText_readonly_36 = { value: string };
type _check_ContentControl_placeholderText_readonly_36 = IsExact<Ref_ContentControl_placeholderText_readonly_36, Auth_ContentControl_placeholderText_readonly_36>;
type _assert_ContentControl_placeholderText_readonly_36 = Expect<_check_ContentControl_placeholderText_readonly_36>;

type Ref_ContentControl_subtype_37 = () => "Unknown" | "RichTextInline" | "RichTextParagraphs" | "RichTextTableCell" | "RichTextTableRow" | "RichTextTable" | "PlainTextInline" | "PlainTextParagraph" | "Picture" | "BuildingBlockGallery" | "CheckBox" | "ComboBox" | "DropDownList" | "DatePicker" | "RepeatingSection" | "RichText" | "PlainText" | "Group";
type Auth_ContentControl_subtype_37 = () => "Unknown" | "RichTextInline" | "RichTextParagraphs" | "RichTextTableCell" | "RichTextTableRow" | "RichTextTable" | "PlainTextInline" | "PlainTextParagraph" | "Picture" | "BuildingBlockGallery" | "CheckBox" | "ComboBox" | "DropDownList" | "DatePicker" | "RepeatingSection" | "RichText" | "PlainText" | "Group";
type _check_ContentControl_subtype_37 = IsExact<Ref_ContentControl_subtype_37, Auth_ContentControl_subtype_37>;
type _assert_ContentControl_subtype_37 = Expect<_check_ContentControl_subtype_37>;

type Ref_ContentControl_subtype_readonly_38 = { readonly value: "Unknown" | "RichTextInline" | "RichTextParagraphs" | "RichTextTableCell" | "RichTextTableRow" | "RichTextTable" | "PlainTextInline" | "PlainTextParagraph" | "Picture" | "BuildingBlockGallery" | "CheckBox" | "ComboBox" | "DropDownList" | "DatePicker" | "RepeatingSection" | "RichText" | "PlainText" | "Group" };
type Auth_ContentControl_subtype_readonly_38 = { readonly value: "Unknown" | "RichTextInline" | "RichTextParagraphs" | "RichTextTableCell" | "RichTextTableRow" | "RichTextTable" | "PlainTextInline" | "PlainTextParagraph" | "Picture" | "BuildingBlockGallery" | "CheckBox" | "ComboBox" | "DropDownList" | "DatePicker" | "RepeatingSection" | "RichText" | "PlainText" | "Group" };
type _check_ContentControl_subtype_readonly_38 = IsExact<Ref_ContentControl_subtype_readonly_38, Auth_ContentControl_subtype_readonly_38>;
type _assert_ContentControl_subtype_readonly_38 = Expect<_check_ContentControl_subtype_readonly_38>;

type Ref_ContentControl_tag_39 = () => string;
type Auth_ContentControl_tag_39 = () => string;
type _check_ContentControl_tag_39 = IsExact<Ref_ContentControl_tag_39, Auth_ContentControl_tag_39>;
type _assert_ContentControl_tag_39 = Expect<_check_ContentControl_tag_39>;

type Ref_ContentControl_tag_readonly_40 = { value: string };
type Auth_ContentControl_tag_readonly_40 = { value: string };
type _check_ContentControl_tag_readonly_40 = IsExact<Ref_ContentControl_tag_readonly_40, Auth_ContentControl_tag_readonly_40>;
type _assert_ContentControl_tag_readonly_40 = Expect<_check_ContentControl_tag_readonly_40>;

type Ref_ContentControl_text_41 = () => string;
type Auth_ContentControl_text_41 = () => string;
type _check_ContentControl_text_41 = IsExact<Ref_ContentControl_text_41, Auth_ContentControl_text_41>;
type _assert_ContentControl_text_41 = Expect<_check_ContentControl_text_41>;

type Ref_ContentControl_text_readonly_42 = { readonly value: string };
type Auth_ContentControl_text_readonly_42 = { readonly value: string };
type _check_ContentControl_text_readonly_42 = IsExact<Ref_ContentControl_text_readonly_42, Auth_ContentControl_text_readonly_42>;
type _assert_ContentControl_text_readonly_42 = Expect<_check_ContentControl_text_readonly_42>;

type Ref_ContentControl_title_43 = () => string;
type Auth_ContentControl_title_43 = () => string;
type _check_ContentControl_title_43 = IsExact<Ref_ContentControl_title_43, Auth_ContentControl_title_43>;
type _assert_ContentControl_title_43 = Expect<_check_ContentControl_title_43>;

type Ref_ContentControl_title_readonly_44 = { value: string };
type Auth_ContentControl_title_readonly_44 = { value: string };
type _check_ContentControl_title_readonly_44 = IsExact<Ref_ContentControl_title_readonly_44, Auth_ContentControl_title_readonly_44>;
type _assert_ContentControl_title_readonly_44 = Expect<_check_ContentControl_title_readonly_44>;

type Ref_ContentControlCollection_getById_45 = (id: number) => DocxEditor.ContentControl;
type Auth_ContentControlCollection_getById_45 = (id: number) => DocxEditor.ContentControl;
type _check_ContentControlCollection_getById_45 = IsExact<Ref_ContentControlCollection_getById_45, Auth_ContentControlCollection_getById_45>;
type _assert_ContentControlCollection_getById_45 = Expect<_check_ContentControlCollection_getById_45>;

type Ref_ContentControlCollection_items_46 = () => DocxEditor.ContentControl[];
type Auth_ContentControlCollection_items_46 = () => DocxEditor.ContentControl[];
type _check_ContentControlCollection_items_46 = IsExact<Ref_ContentControlCollection_items_46, Auth_ContentControlCollection_items_46>;
type _assert_ContentControlCollection_items_46 = Expect<_check_ContentControlCollection_items_46>;

type Ref_ContentControlCollection_items_readonly_47 = { readonly value: DocxEditor.ContentControl[] };
type Auth_ContentControlCollection_items_readonly_47 = { readonly value: DocxEditor.ContentControl[] };
type _check_ContentControlCollection_items_readonly_47 = IsExact<Ref_ContentControlCollection_items_readonly_47, Auth_ContentControlCollection_items_readonly_47>;
type _assert_ContentControlCollection_items_readonly_47 = Expect<_check_ContentControlCollection_items_readonly_47>;

type Ref_Document_body_48 = () => DocxEditor.Body;
type Auth_Document_body_48 = () => DocxEditor.Body;
type _check_Document_body_48 = IsExact<Ref_Document_body_48, Auth_Document_body_48>;
type _assert_Document_body_48 = Expect<_check_Document_body_48>;

type Ref_Document_body_readonly_49 = { readonly value: DocxEditor.Body };
type Auth_Document_body_readonly_49 = { readonly value: DocxEditor.Body };
type _check_Document_body_readonly_49 = IsExact<Ref_Document_body_readonly_49, Auth_Document_body_readonly_49>;
type _assert_Document_body_readonly_49 = Expect<_check_Document_body_readonly_49>;

type Ref_Document_contentControls_50 = () => DocxEditor.ContentControlCollection;
type Auth_Document_contentControls_50 = () => DocxEditor.ContentControlCollection;
type _check_Document_contentControls_50 = IsExact<Ref_Document_contentControls_50, Auth_Document_contentControls_50>;
type _assert_Document_contentControls_50 = Expect<_check_Document_contentControls_50>;

type Ref_Document_contentControls_readonly_51 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Document_contentControls_readonly_51 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Document_contentControls_readonly_51 = IsExact<Ref_Document_contentControls_readonly_51, Auth_Document_contentControls_readonly_51>;
type _assert_Document_contentControls_readonly_51 = Expect<_check_Document_contentControls_readonly_51>;

type Ref_Document_paragraphs_52 = () => DocxEditor.ParagraphCollection;
type Auth_Document_paragraphs_52 = () => DocxEditor.ParagraphCollection;
type _check_Document_paragraphs_52 = IsExact<Ref_Document_paragraphs_52, Auth_Document_paragraphs_52>;
type _assert_Document_paragraphs_52 = Expect<_check_Document_paragraphs_52>;

type Ref_Document_paragraphs_readonly_53 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Document_paragraphs_readonly_53 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Document_paragraphs_readonly_53 = IsExact<Ref_Document_paragraphs_readonly_53, Auth_Document_paragraphs_readonly_53>;
type _assert_Document_paragraphs_readonly_53 = Expect<_check_Document_paragraphs_readonly_53>;

type Ref_Font_bold_54 = () => boolean;
type Auth_Font_bold_54 = () => boolean;
type _check_Font_bold_54 = IsExact<Ref_Font_bold_54, Auth_Font_bold_54>;
type _assert_Font_bold_54 = Expect<_check_Font_bold_54>;

type Ref_Font_bold_readonly_55 = { value: boolean };
type Auth_Font_bold_readonly_55 = { value: boolean };
type _check_Font_bold_readonly_55 = IsExact<Ref_Font_bold_readonly_55, Auth_Font_bold_readonly_55>;
type _assert_Font_bold_readonly_55 = Expect<_check_Font_bold_readonly_55>;

type Ref_Font_color_56 = () => string;
type Auth_Font_color_56 = () => string;
type _check_Font_color_56 = IsExact<Ref_Font_color_56, Auth_Font_color_56>;
type _assert_Font_color_56 = Expect<_check_Font_color_56>;

type Ref_Font_color_readonly_57 = { value: string };
type Auth_Font_color_readonly_57 = { value: string };
type _check_Font_color_readonly_57 = IsExact<Ref_Font_color_readonly_57, Auth_Font_color_readonly_57>;
type _assert_Font_color_readonly_57 = Expect<_check_Font_color_readonly_57>;

type Ref_Font_italic_58 = () => boolean;
type Auth_Font_italic_58 = () => boolean;
type _check_Font_italic_58 = IsExact<Ref_Font_italic_58, Auth_Font_italic_58>;
type _assert_Font_italic_58 = Expect<_check_Font_italic_58>;

type Ref_Font_italic_readonly_59 = { value: boolean };
type Auth_Font_italic_readonly_59 = { value: boolean };
type _check_Font_italic_readonly_59 = IsExact<Ref_Font_italic_readonly_59, Auth_Font_italic_readonly_59>;
type _assert_Font_italic_readonly_59 = Expect<_check_Font_italic_readonly_59>;

type Ref_Font_name_60 = () => string;
type Auth_Font_name_60 = () => string;
type _check_Font_name_60 = IsExact<Ref_Font_name_60, Auth_Font_name_60>;
type _assert_Font_name_60 = Expect<_check_Font_name_60>;

type Ref_Font_name_readonly_61 = { value: string };
type Auth_Font_name_readonly_61 = { value: string };
type _check_Font_name_readonly_61 = IsExact<Ref_Font_name_readonly_61, Auth_Font_name_readonly_61>;
type _assert_Font_name_readonly_61 = Expect<_check_Font_name_readonly_61>;

type Ref_Font_size_62 = () => number;
type Auth_Font_size_62 = () => number;
type _check_Font_size_62 = IsExact<Ref_Font_size_62, Auth_Font_size_62>;
type _assert_Font_size_62 = Expect<_check_Font_size_62>;

type Ref_Font_size_readonly_63 = { value: number };
type Auth_Font_size_readonly_63 = { value: number };
type _check_Font_size_readonly_63 = IsExact<Ref_Font_size_readonly_63, Auth_Font_size_readonly_63>;
type _assert_Font_size_readonly_63 = Expect<_check_Font_size_readonly_63>;

type Ref_Paragraph_alignment_64 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type Auth_Paragraph_alignment_64 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type _check_Paragraph_alignment_64 = IsExact<Ref_Paragraph_alignment_64, Auth_Paragraph_alignment_64>;
type _assert_Paragraph_alignment_64 = Expect<_check_Paragraph_alignment_64>;

type Ref_Paragraph_alignment_readonly_65 = { value: "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified" };
type Auth_Paragraph_alignment_readonly_65 = { value: "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified" };
type _check_Paragraph_alignment_readonly_65 = IsExact<Ref_Paragraph_alignment_readonly_65, Auth_Paragraph_alignment_readonly_65>;
type _assert_Paragraph_alignment_readonly_65 = Expect<_check_Paragraph_alignment_readonly_65>;

type Ref_Paragraph_clear_66 = () => void;
type Auth_Paragraph_clear_66 = () => void;
type _check_Paragraph_clear_66 = IsExact<Ref_Paragraph_clear_66, Auth_Paragraph_clear_66>;
type _assert_Paragraph_clear_66 = Expect<_check_Paragraph_clear_66>;

type Ref_Paragraph_contentControls_67 = () => DocxEditor.ContentControlCollection;
type Auth_Paragraph_contentControls_67 = () => DocxEditor.ContentControlCollection;
type _check_Paragraph_contentControls_67 = IsExact<Ref_Paragraph_contentControls_67, Auth_Paragraph_contentControls_67>;
type _assert_Paragraph_contentControls_67 = Expect<_check_Paragraph_contentControls_67>;

type Ref_Paragraph_contentControls_readonly_68 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Paragraph_contentControls_readonly_68 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Paragraph_contentControls_readonly_68 = IsExact<Ref_Paragraph_contentControls_readonly_68, Auth_Paragraph_contentControls_readonly_68>;
type _assert_Paragraph_contentControls_readonly_68 = Expect<_check_Paragraph_contentControls_readonly_68>;

type Ref_Paragraph_delete_69 = () => void;
type Auth_Paragraph_delete_69 = () => void;
type _check_Paragraph_delete_69 = IsExact<Ref_Paragraph_delete_69, Auth_Paragraph_delete_69>;
type _assert_Paragraph_delete_69 = Expect<_check_Paragraph_delete_69>;

type Ref_Paragraph_firstLineIndent_70 = () => number;
type Auth_Paragraph_firstLineIndent_70 = () => number;
type _check_Paragraph_firstLineIndent_70 = IsExact<Ref_Paragraph_firstLineIndent_70, Auth_Paragraph_firstLineIndent_70>;
type _assert_Paragraph_firstLineIndent_70 = Expect<_check_Paragraph_firstLineIndent_70>;

type Ref_Paragraph_firstLineIndent_readonly_71 = { value: number };
type Auth_Paragraph_firstLineIndent_readonly_71 = { value: number };
type _check_Paragraph_firstLineIndent_readonly_71 = IsExact<Ref_Paragraph_firstLineIndent_readonly_71, Auth_Paragraph_firstLineIndent_readonly_71>;
type _assert_Paragraph_firstLineIndent_readonly_71 = Expect<_check_Paragraph_firstLineIndent_readonly_71>;

type Ref_Paragraph_font_72 = () => DocxEditor.Font;
type Auth_Paragraph_font_72 = () => DocxEditor.Font;
type _check_Paragraph_font_72 = IsExact<Ref_Paragraph_font_72, Auth_Paragraph_font_72>;
type _assert_Paragraph_font_72 = Expect<_check_Paragraph_font_72>;

type Ref_Paragraph_font_readonly_73 = { readonly value: DocxEditor.Font };
type Auth_Paragraph_font_readonly_73 = { readonly value: DocxEditor.Font };
type _check_Paragraph_font_readonly_73 = IsExact<Ref_Paragraph_font_readonly_73, Auth_Paragraph_font_readonly_73>;
type _assert_Paragraph_font_readonly_73 = Expect<_check_Paragraph_font_readonly_73>;

type Ref_Paragraph_insertParagraph_74 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Paragraph_insertParagraph_74 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Paragraph_insertParagraph_74 = IsExact<Ref_Paragraph_insertParagraph_74, Auth_Paragraph_insertParagraph_74>;
type _assert_Paragraph_insertParagraph_74 = Expect<_check_Paragraph_insertParagraph_74>;

type Ref_Paragraph_insertText_75 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Paragraph_insertText_75 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Paragraph_insertText_75 = IsExact<Ref_Paragraph_insertText_75, Auth_Paragraph_insertText_75>;
type _assert_Paragraph_insertText_75 = Expect<_check_Paragraph_insertText_75>;

type Ref_Paragraph_leftIndent_76 = () => number;
type Auth_Paragraph_leftIndent_76 = () => number;
type _check_Paragraph_leftIndent_76 = IsExact<Ref_Paragraph_leftIndent_76, Auth_Paragraph_leftIndent_76>;
type _assert_Paragraph_leftIndent_76 = Expect<_check_Paragraph_leftIndent_76>;

type Ref_Paragraph_leftIndent_readonly_77 = { value: number };
type Auth_Paragraph_leftIndent_readonly_77 = { value: number };
type _check_Paragraph_leftIndent_readonly_77 = IsExact<Ref_Paragraph_leftIndent_readonly_77, Auth_Paragraph_leftIndent_readonly_77>;
type _assert_Paragraph_leftIndent_readonly_77 = Expect<_check_Paragraph_leftIndent_readonly_77>;

type Ref_Paragraph_lineSpacing_78 = () => number;
type Auth_Paragraph_lineSpacing_78 = () => number;
type _check_Paragraph_lineSpacing_78 = IsExact<Ref_Paragraph_lineSpacing_78, Auth_Paragraph_lineSpacing_78>;
type _assert_Paragraph_lineSpacing_78 = Expect<_check_Paragraph_lineSpacing_78>;

type Ref_Paragraph_lineSpacing_readonly_79 = { value: number };
type Auth_Paragraph_lineSpacing_readonly_79 = { value: number };
type _check_Paragraph_lineSpacing_readonly_79 = IsExact<Ref_Paragraph_lineSpacing_readonly_79, Auth_Paragraph_lineSpacing_readonly_79>;
type _assert_Paragraph_lineSpacing_readonly_79 = Expect<_check_Paragraph_lineSpacing_readonly_79>;

type Ref_Paragraph_rightIndent_80 = () => number;
type Auth_Paragraph_rightIndent_80 = () => number;
type _check_Paragraph_rightIndent_80 = IsExact<Ref_Paragraph_rightIndent_80, Auth_Paragraph_rightIndent_80>;
type _assert_Paragraph_rightIndent_80 = Expect<_check_Paragraph_rightIndent_80>;

type Ref_Paragraph_rightIndent_readonly_81 = { value: number };
type Auth_Paragraph_rightIndent_readonly_81 = { value: number };
type _check_Paragraph_rightIndent_readonly_81 = IsExact<Ref_Paragraph_rightIndent_readonly_81, Auth_Paragraph_rightIndent_readonly_81>;
type _assert_Paragraph_rightIndent_readonly_81 = Expect<_check_Paragraph_rightIndent_readonly_81>;

type Ref_Paragraph_spaceAfter_82 = () => number;
type Auth_Paragraph_spaceAfter_82 = () => number;
type _check_Paragraph_spaceAfter_82 = IsExact<Ref_Paragraph_spaceAfter_82, Auth_Paragraph_spaceAfter_82>;
type _assert_Paragraph_spaceAfter_82 = Expect<_check_Paragraph_spaceAfter_82>;

type Ref_Paragraph_spaceAfter_readonly_83 = { value: number };
type Auth_Paragraph_spaceAfter_readonly_83 = { value: number };
type _check_Paragraph_spaceAfter_readonly_83 = IsExact<Ref_Paragraph_spaceAfter_readonly_83, Auth_Paragraph_spaceAfter_readonly_83>;
type _assert_Paragraph_spaceAfter_readonly_83 = Expect<_check_Paragraph_spaceAfter_readonly_83>;

type Ref_Paragraph_spaceBefore_84 = () => number;
type Auth_Paragraph_spaceBefore_84 = () => number;
type _check_Paragraph_spaceBefore_84 = IsExact<Ref_Paragraph_spaceBefore_84, Auth_Paragraph_spaceBefore_84>;
type _assert_Paragraph_spaceBefore_84 = Expect<_check_Paragraph_spaceBefore_84>;

type Ref_Paragraph_spaceBefore_readonly_85 = { value: number };
type Auth_Paragraph_spaceBefore_readonly_85 = { value: number };
type _check_Paragraph_spaceBefore_readonly_85 = IsExact<Ref_Paragraph_spaceBefore_readonly_85, Auth_Paragraph_spaceBefore_readonly_85>;
type _assert_Paragraph_spaceBefore_readonly_85 = Expect<_check_Paragraph_spaceBefore_readonly_85>;

type Ref_Paragraph_split_86 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type Auth_Paragraph_split_86 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type _check_Paragraph_split_86 = IsExact<Ref_Paragraph_split_86, Auth_Paragraph_split_86>;
type _assert_Paragraph_split_86 = Expect<_check_Paragraph_split_86>;

type Ref_Paragraph_style_87 = () => string;
type Auth_Paragraph_style_87 = () => string;
type _check_Paragraph_style_87 = IsExact<Ref_Paragraph_style_87, Auth_Paragraph_style_87>;
type _assert_Paragraph_style_87 = Expect<_check_Paragraph_style_87>;

type Ref_Paragraph_style_readonly_88 = { value: string };
type Auth_Paragraph_style_readonly_88 = { value: string };
type _check_Paragraph_style_readonly_88 = IsExact<Ref_Paragraph_style_readonly_88, Auth_Paragraph_style_readonly_88>;
type _assert_Paragraph_style_readonly_88 = Expect<_check_Paragraph_style_readonly_88>;

type Ref_Paragraph_text_89 = () => string;
type Auth_Paragraph_text_89 = () => string;
type _check_Paragraph_text_89 = IsExact<Ref_Paragraph_text_89, Auth_Paragraph_text_89>;
type _assert_Paragraph_text_89 = Expect<_check_Paragraph_text_89>;

type Ref_Paragraph_text_readonly_90 = { readonly value: string };
type Auth_Paragraph_text_readonly_90 = { readonly value: string };
type _check_Paragraph_text_readonly_90 = IsExact<Ref_Paragraph_text_readonly_90, Auth_Paragraph_text_readonly_90>;
type _assert_Paragraph_text_readonly_90 = Expect<_check_Paragraph_text_readonly_90>;

type Ref_ParagraphCollection_getFirst_91 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getFirst_91 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getFirst_91 = IsExact<Ref_ParagraphCollection_getFirst_91, Auth_ParagraphCollection_getFirst_91>;
type _assert_ParagraphCollection_getFirst_91 = Expect<_check_ParagraphCollection_getFirst_91>;

type Ref_ParagraphCollection_getLast_92 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getLast_92 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getLast_92 = IsExact<Ref_ParagraphCollection_getLast_92, Auth_ParagraphCollection_getLast_92>;
type _assert_ParagraphCollection_getLast_92 = Expect<_check_ParagraphCollection_getLast_92>;

type Ref_ParagraphCollection_items_93 = () => DocxEditor.Paragraph[];
type Auth_ParagraphCollection_items_93 = () => DocxEditor.Paragraph[];
type _check_ParagraphCollection_items_93 = IsExact<Ref_ParagraphCollection_items_93, Auth_ParagraphCollection_items_93>;
type _assert_ParagraphCollection_items_93 = Expect<_check_ParagraphCollection_items_93>;

type Ref_ParagraphCollection_items_readonly_94 = { readonly value: DocxEditor.Paragraph[] };
type Auth_ParagraphCollection_items_readonly_94 = { readonly value: DocxEditor.Paragraph[] };
type _check_ParagraphCollection_items_readonly_94 = IsExact<Ref_ParagraphCollection_items_readonly_94, Auth_ParagraphCollection_items_readonly_94>;
type _assert_ParagraphCollection_items_readonly_94 = Expect<_check_ParagraphCollection_items_readonly_94>;

type Ref_Range_contentControls_95 = () => DocxEditor.ContentControlCollection;
type Auth_Range_contentControls_95 = () => DocxEditor.ContentControlCollection;
type _check_Range_contentControls_95 = IsExact<Ref_Range_contentControls_95, Auth_Range_contentControls_95>;
type _assert_Range_contentControls_95 = Expect<_check_Range_contentControls_95>;

type Ref_Range_contentControls_readonly_96 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Range_contentControls_readonly_96 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Range_contentControls_readonly_96 = IsExact<Ref_Range_contentControls_readonly_96, Auth_Range_contentControls_readonly_96>;
type _assert_Range_contentControls_readonly_96 = Expect<_check_Range_contentControls_readonly_96>;

type Ref_Range_font_97 = () => DocxEditor.Font;
type Auth_Range_font_97 = () => DocxEditor.Font;
type _check_Range_font_97 = IsExact<Ref_Range_font_97, Auth_Range_font_97>;
type _assert_Range_font_97 = Expect<_check_Range_font_97>;

type Ref_Range_font_readonly_98 = { readonly value: DocxEditor.Font };
type Auth_Range_font_readonly_98 = { readonly value: DocxEditor.Font };
type _check_Range_font_readonly_98 = IsExact<Ref_Range_font_readonly_98, Auth_Range_font_readonly_98>;
type _assert_Range_font_readonly_98 = Expect<_check_Range_font_readonly_98>;

type Ref_Range_insertParagraph_99 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Range_insertParagraph_99 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Range_insertParagraph_99 = IsExact<Ref_Range_insertParagraph_99, Auth_Range_insertParagraph_99>;
type _assert_Range_insertParagraph_99 = Expect<_check_Range_insertParagraph_99>;

type Ref_Range_insertText_100 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type Auth_Range_insertText_100 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type _check_Range_insertText_100 = IsExact<Ref_Range_insertText_100, Auth_Range_insertText_100>;
type _assert_Range_insertText_100 = Expect<_check_Range_insertText_100>;

type Ref_Range_paragraphs_101 = () => DocxEditor.ParagraphCollection;
type Auth_Range_paragraphs_101 = () => DocxEditor.ParagraphCollection;
type _check_Range_paragraphs_101 = IsExact<Ref_Range_paragraphs_101, Auth_Range_paragraphs_101>;
type _assert_Range_paragraphs_101 = Expect<_check_Range_paragraphs_101>;

type Ref_Range_paragraphs_readonly_102 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Range_paragraphs_readonly_102 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Range_paragraphs_readonly_102 = IsExact<Ref_Range_paragraphs_readonly_102, Auth_Range_paragraphs_readonly_102>;
type _assert_Range_paragraphs_readonly_102 = Expect<_check_Range_paragraphs_readonly_102>;

type Ref_Range_search_103 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Range_search_103 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Range_search_103 = IsExact<Ref_Range_search_103, Auth_Range_search_103>;
type _assert_Range_search_103 = Expect<_check_Range_search_103>;

type Ref_Range_select_104 = (selectionMode?: DocxEditor.SelectionMode) => void;
type Auth_Range_select_104 = (selectionMode?: DocxEditor.SelectionMode) => void;
type _check_Range_select_104 = IsExact<Ref_Range_select_104, Auth_Range_select_104>;
type _assert_Range_select_104 = Expect<_check_Range_select_104>;

type Ref_Range_select_105 = (selectionMode?: "Select" | "Start" | "End") => void;
type Auth_Range_select_105 = (selectionMode?: "Select" | "Start" | "End") => void;
type _check_Range_select_105 = IsExact<Ref_Range_select_105, Auth_Range_select_105>;
type _assert_Range_select_105 = Expect<_check_Range_select_105>;

type Ref_Range_style_106 = () => string;
type Auth_Range_style_106 = () => string;
type _check_Range_style_106 = IsExact<Ref_Range_style_106, Auth_Range_style_106>;
type _assert_Range_style_106 = Expect<_check_Range_style_106>;

type Ref_Range_style_readonly_107 = { value: string };
type Auth_Range_style_readonly_107 = { value: string };
type _check_Range_style_readonly_107 = IsExact<Ref_Range_style_readonly_107, Auth_Range_style_readonly_107>;
type _assert_Range_style_readonly_107 = Expect<_check_Range_style_readonly_107>;

type Ref_Range_text_108 = () => string;
type Auth_Range_text_108 = () => string;
type _check_Range_text_108 = IsExact<Ref_Range_text_108, Auth_Range_text_108>;
type _assert_Range_text_108 = Expect<_check_Range_text_108>;

type Ref_Range_text_readonly_109 = { readonly value: string };
type Auth_Range_text_readonly_109 = { readonly value: string };
type _check_Range_text_readonly_109 = IsExact<Ref_Range_text_readonly_109, Auth_Range_text_readonly_109>;
type _assert_Range_text_readonly_109 = Expect<_check_Range_text_readonly_109>;

type Ref_RangeCollection_getFirst_110 = () => DocxEditor.Range;
type Auth_RangeCollection_getFirst_110 = () => DocxEditor.Range;
type _check_RangeCollection_getFirst_110 = IsExact<Ref_RangeCollection_getFirst_110, Auth_RangeCollection_getFirst_110>;
type _assert_RangeCollection_getFirst_110 = Expect<_check_RangeCollection_getFirst_110>;

type Ref_RangeCollection_items_111 = () => DocxEditor.Range[];
type Auth_RangeCollection_items_111 = () => DocxEditor.Range[];
type _check_RangeCollection_items_111 = IsExact<Ref_RangeCollection_items_111, Auth_RangeCollection_items_111>;
type _assert_RangeCollection_items_111 = Expect<_check_RangeCollection_items_111>;

type Ref_RangeCollection_items_readonly_112 = { readonly value: DocxEditor.Range[] };
type Auth_RangeCollection_items_readonly_112 = { readonly value: DocxEditor.Range[] };
type _check_RangeCollection_items_readonly_112 = IsExact<Ref_RangeCollection_items_readonly_112, Auth_RangeCollection_items_readonly_112>;
type _assert_RangeCollection_items_readonly_112 = Expect<_check_RangeCollection_items_readonly_112>;

type Ref_RequestContext_document_113 = () => DocxEditor.Document;
type Auth_RequestContext_document_113 = () => DocxEditor.Document;
type _check_RequestContext_document_113 = IsExact<Ref_RequestContext_document_113, Auth_RequestContext_document_113>;
type _assert_RequestContext_document_113 = Expect<_check_RequestContext_document_113>;

type Ref_RequestContext_document_readonly_114 = { readonly value: DocxEditor.Document };
type Auth_RequestContext_document_readonly_114 = { readonly value: DocxEditor.Document };
type _check_RequestContext_document_readonly_114 = IsExact<Ref_RequestContext_document_readonly_114, Auth_RequestContext_document_readonly_114>;
type _assert_RequestContext_document_readonly_114 = Expect<_check_RequestContext_document_readonly_114>;

type Ref_SearchOptions_ignorePunct_115 = () => boolean;
type Auth_SearchOptions_ignorePunct_115 = () => boolean;
type _check_SearchOptions_ignorePunct_115 = IsExact<Ref_SearchOptions_ignorePunct_115, Auth_SearchOptions_ignorePunct_115>;
type _assert_SearchOptions_ignorePunct_115 = Expect<_check_SearchOptions_ignorePunct_115>;

type Ref_SearchOptions_ignorePunct_readonly_116 = { value: boolean };
type Auth_SearchOptions_ignorePunct_readonly_116 = { value: boolean };
type _check_SearchOptions_ignorePunct_readonly_116 = IsExact<Ref_SearchOptions_ignorePunct_readonly_116, Auth_SearchOptions_ignorePunct_readonly_116>;
type _assert_SearchOptions_ignorePunct_readonly_116 = Expect<_check_SearchOptions_ignorePunct_readonly_116>;

type Ref_SearchOptions_ignoreSpace_117 = () => boolean;
type Auth_SearchOptions_ignoreSpace_117 = () => boolean;
type _check_SearchOptions_ignoreSpace_117 = IsExact<Ref_SearchOptions_ignoreSpace_117, Auth_SearchOptions_ignoreSpace_117>;
type _assert_SearchOptions_ignoreSpace_117 = Expect<_check_SearchOptions_ignoreSpace_117>;

type Ref_SearchOptions_ignoreSpace_readonly_118 = { value: boolean };
type Auth_SearchOptions_ignoreSpace_readonly_118 = { value: boolean };
type _check_SearchOptions_ignoreSpace_readonly_118 = IsExact<Ref_SearchOptions_ignoreSpace_readonly_118, Auth_SearchOptions_ignoreSpace_readonly_118>;
type _assert_SearchOptions_ignoreSpace_readonly_118 = Expect<_check_SearchOptions_ignoreSpace_readonly_118>;

type Ref_SearchOptions_matchCase_119 = () => boolean;
type Auth_SearchOptions_matchCase_119 = () => boolean;
type _check_SearchOptions_matchCase_119 = IsExact<Ref_SearchOptions_matchCase_119, Auth_SearchOptions_matchCase_119>;
type _assert_SearchOptions_matchCase_119 = Expect<_check_SearchOptions_matchCase_119>;

type Ref_SearchOptions_matchCase_readonly_120 = { value: boolean };
type Auth_SearchOptions_matchCase_readonly_120 = { value: boolean };
type _check_SearchOptions_matchCase_readonly_120 = IsExact<Ref_SearchOptions_matchCase_readonly_120, Auth_SearchOptions_matchCase_readonly_120>;
type _assert_SearchOptions_matchCase_readonly_120 = Expect<_check_SearchOptions_matchCase_readonly_120>;

type Ref_SearchOptions_matchWholeWord_121 = () => boolean;
type Auth_SearchOptions_matchWholeWord_121 = () => boolean;
type _check_SearchOptions_matchWholeWord_121 = IsExact<Ref_SearchOptions_matchWholeWord_121, Auth_SearchOptions_matchWholeWord_121>;
type _assert_SearchOptions_matchWholeWord_121 = Expect<_check_SearchOptions_matchWholeWord_121>;

type Ref_SearchOptions_matchWholeWord_readonly_122 = { value: boolean };
type Auth_SearchOptions_matchWholeWord_readonly_122 = { value: boolean };
type _check_SearchOptions_matchWholeWord_readonly_122 = IsExact<Ref_SearchOptions_matchWholeWord_readonly_122, Auth_SearchOptions_matchWholeWord_readonly_122>;
type _assert_SearchOptions_matchWholeWord_readonly_122 = Expect<_check_SearchOptions_matchWholeWord_readonly_122>;

type Ref_SearchOptions_matchWildcards_123 = () => boolean;
type Auth_SearchOptions_matchWildcards_123 = () => boolean;
type _check_SearchOptions_matchWildcards_123 = IsExact<Ref_SearchOptions_matchWildcards_123, Auth_SearchOptions_matchWildcards_123>;
type _assert_SearchOptions_matchWildcards_123 = Expect<_check_SearchOptions_matchWildcards_123>;

type Ref_SearchOptions_matchWildcards_readonly_124 = { value: boolean };
type Auth_SearchOptions_matchWildcards_readonly_124 = { value: boolean };
type _check_SearchOptions_matchWildcards_readonly_124 = IsExact<Ref_SearchOptions_matchWildcards_readonly_124, Auth_SearchOptions_matchWildcards_readonly_124>;
type _assert_SearchOptions_matchWildcards_readonly_124 = Expect<_check_SearchOptions_matchWildcards_readonly_124>;

type Ref_run_125 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_125 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_125 = IsExact<Ref_run_125, Auth_run_125>;
type _assert_run_125 = Expect<_check_run_125>;

type Ref_run_126 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_126 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_126 = IsExact<Ref_run_126, Auth_run_126>;
type _assert_run_126 = Expect<_check_run_126>;

type Ref_run_127 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_127 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_127 = IsExact<Ref_run_127, Auth_run_127>;
type _assert_run_127 = Expect<_check_run_127>;

