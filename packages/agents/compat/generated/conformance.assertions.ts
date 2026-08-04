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

type Ref_Body_font_2 = () => DocxEditor.Font;
type Auth_Body_font_2 = () => DocxEditor.Font;
type _check_Body_font_2 = IsExact<Ref_Body_font_2, Auth_Body_font_2>;
type _assert_Body_font_2 = Expect<_check_Body_font_2>;

type Ref_Body_getComments_3 = () => DocxEditor.CommentCollection;
type Auth_Body_getComments_3 = () => DocxEditor.CommentCollection;
type _check_Body_getComments_3 = IsExact<Ref_Body_getComments_3, Auth_Body_getComments_3>;
type _assert_Body_getComments_3 = Expect<_check_Body_getComments_3>;

type Ref_Body_insertParagraph_4 = (paragraphText: string, insertLocation: "Start" | "End") => DocxEditor.Paragraph;
type Auth_Body_insertParagraph_4 = (paragraphText: string, insertLocation: "Start" | "End") => DocxEditor.Paragraph;
type _check_Body_insertParagraph_4 = IsExact<Ref_Body_insertParagraph_4, Auth_Body_insertParagraph_4>;
type _assert_Body_insertParagraph_4 = Expect<_check_Body_insertParagraph_4>;

type Ref_Body_insertText_5 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Body_insertText_5 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Body_insertText_5 = IsExact<Ref_Body_insertText_5, Auth_Body_insertText_5>;
type _assert_Body_insertText_5 = Expect<_check_Body_insertText_5>;

type Ref_Body_lists_6 = () => DocxEditor.ListCollection;
type Auth_Body_lists_6 = () => DocxEditor.ListCollection;
type _check_Body_lists_6 = IsExact<Ref_Body_lists_6, Auth_Body_lists_6>;
type _assert_Body_lists_6 = Expect<_check_Body_lists_6>;

type Ref_Body_paragraphs_7 = () => DocxEditor.ParagraphCollection;
type Auth_Body_paragraphs_7 = () => DocxEditor.ParagraphCollection;
type _check_Body_paragraphs_7 = IsExact<Ref_Body_paragraphs_7, Auth_Body_paragraphs_7>;
type _assert_Body_paragraphs_7 = Expect<_check_Body_paragraphs_7>;

type Ref_Body_search_8 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Body_search_8 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Body_search_8 = IsExact<Ref_Body_search_8, Auth_Body_search_8>;
type _assert_Body_search_8 = Expect<_check_Body_search_8>;

type Ref_Body_style_9 = () => string;
type Auth_Body_style_9 = () => string;
type _check_Body_style_9 = IsExact<Ref_Body_style_9, Auth_Body_style_9>;
type _assert_Body_style_9 = Expect<_check_Body_style_9>;

type Ref_Body_text_10 = () => string;
type Auth_Body_text_10 = () => string;
type _check_Body_text_10 = IsExact<Ref_Body_text_10, Auth_Body_text_10>;
type _assert_Body_text_10 = Expect<_check_Body_text_10>;

type Ref_Bookmark_delete_11 = () => void;
type Auth_Bookmark_delete_11 = () => void;
type _check_Bookmark_delete_11 = IsExact<Ref_Bookmark_delete_11, Auth_Bookmark_delete_11>;
type _assert_Bookmark_delete_11 = Expect<_check_Bookmark_delete_11>;

type Ref_Bookmark_end_12 = () => number;
type Auth_Bookmark_end_12 = () => number;
type _check_Bookmark_end_12 = IsExact<Ref_Bookmark_end_12, Auth_Bookmark_end_12>;
type _assert_Bookmark_end_12 = Expect<_check_Bookmark_end_12>;

type Ref_Bookmark_name_13 = () => string;
type Auth_Bookmark_name_13 = () => string;
type _check_Bookmark_name_13 = IsExact<Ref_Bookmark_name_13, Auth_Bookmark_name_13>;
type _assert_Bookmark_name_13 = Expect<_check_Bookmark_name_13>;

type Ref_Bookmark_range_14 = () => DocxEditor.Range;
type Auth_Bookmark_range_14 = () => DocxEditor.Range;
type _check_Bookmark_range_14 = IsExact<Ref_Bookmark_range_14, Auth_Bookmark_range_14>;
type _assert_Bookmark_range_14 = Expect<_check_Bookmark_range_14>;

type Ref_Bookmark_select_15 = () => void;
type Auth_Bookmark_select_15 = () => void;
type _check_Bookmark_select_15 = IsExact<Ref_Bookmark_select_15, Auth_Bookmark_select_15>;
type _assert_Bookmark_select_15 = Expect<_check_Bookmark_select_15>;

type Ref_Bookmark_start_16 = () => number;
type Auth_Bookmark_start_16 = () => number;
type _check_Bookmark_start_16 = IsExact<Ref_Bookmark_start_16, Auth_Bookmark_start_16>;
type _assert_Bookmark_start_16 = Expect<_check_Bookmark_start_16>;

type Ref_BookmarkCollection_items_17 = () => DocxEditor.Bookmark[];
type Auth_BookmarkCollection_items_17 = () => DocxEditor.Bookmark[];
type _check_BookmarkCollection_items_17 = IsExact<Ref_BookmarkCollection_items_17, Auth_BookmarkCollection_items_17>;
type _assert_BookmarkCollection_items_17 = Expect<_check_BookmarkCollection_items_17>;

type Ref_ClientObject_context_18 = () => DocxEditor.ClientRequestContext;
type Auth_ClientObject_context_18 = () => DocxEditor.ClientRequestContext;
type _check_ClientObject_context_18 = IsExact<Ref_ClientObject_context_18, Auth_ClientObject_context_18>;
type _assert_ClientObject_context_18 = Expect<_check_ClientObject_context_18>;

type Ref_ClientObject_isNullObject_19 = () => boolean;
type Auth_ClientObject_isNullObject_19 = () => boolean;
type _check_ClientObject_isNullObject_19 = IsExact<Ref_ClientObject_isNullObject_19, Auth_ClientObject_isNullObject_19>;
type _assert_ClientObject_isNullObject_19 = Expect<_check_ClientObject_isNullObject_19>;

type Ref_Comment_authorEmail_20 = () => string;
type Auth_Comment_authorEmail_20 = () => string;
type _check_Comment_authorEmail_20 = IsExact<Ref_Comment_authorEmail_20, Auth_Comment_authorEmail_20>;
type _assert_Comment_authorEmail_20 = Expect<_check_Comment_authorEmail_20>;

type Ref_Comment_authorName_21 = () => string;
type Auth_Comment_authorName_21 = () => string;
type _check_Comment_authorName_21 = IsExact<Ref_Comment_authorName_21, Auth_Comment_authorName_21>;
type _assert_Comment_authorName_21 = Expect<_check_Comment_authorName_21>;

type Ref_Comment_content_22 = () => string;
type Auth_Comment_content_22 = () => string;
type _check_Comment_content_22 = IsExact<Ref_Comment_content_22, Auth_Comment_content_22>;
type _assert_Comment_content_22 = Expect<_check_Comment_content_22>;

type Ref_Comment_creationDate_23 = () => Date;
type Auth_Comment_creationDate_23 = () => Date;
type _check_Comment_creationDate_23 = IsExact<Ref_Comment_creationDate_23, Auth_Comment_creationDate_23>;
type _assert_Comment_creationDate_23 = Expect<_check_Comment_creationDate_23>;

type Ref_Comment_delete_24 = () => void;
type Auth_Comment_delete_24 = () => void;
type _check_Comment_delete_24 = IsExact<Ref_Comment_delete_24, Auth_Comment_delete_24>;
type _assert_Comment_delete_24 = Expect<_check_Comment_delete_24>;

type Ref_Comment_getRange_25 = () => DocxEditor.Range;
type Auth_Comment_getRange_25 = () => DocxEditor.Range;
type _check_Comment_getRange_25 = IsExact<Ref_Comment_getRange_25, Auth_Comment_getRange_25>;
type _assert_Comment_getRange_25 = Expect<_check_Comment_getRange_25>;

type Ref_Comment_id_26 = () => string;
type Auth_Comment_id_26 = () => string;
type _check_Comment_id_26 = IsExact<Ref_Comment_id_26, Auth_Comment_id_26>;
type _assert_Comment_id_26 = Expect<_check_Comment_id_26>;

type Ref_Comment_replies_27 = () => DocxEditor.CommentReplyCollection;
type Auth_Comment_replies_27 = () => DocxEditor.CommentReplyCollection;
type _check_Comment_replies_27 = IsExact<Ref_Comment_replies_27, Auth_Comment_replies_27>;
type _assert_Comment_replies_27 = Expect<_check_Comment_replies_27>;

type Ref_Comment_reply_28 = (replyText: string) => DocxEditor.CommentReply;
type Auth_Comment_reply_28 = (replyText: string) => DocxEditor.CommentReply;
type _check_Comment_reply_28 = IsExact<Ref_Comment_reply_28, Auth_Comment_reply_28>;
type _assert_Comment_reply_28 = Expect<_check_Comment_reply_28>;

type Ref_Comment_resolved_29 = () => boolean;
type Auth_Comment_resolved_29 = () => boolean;
type _check_Comment_resolved_29 = IsExact<Ref_Comment_resolved_29, Auth_Comment_resolved_29>;
type _assert_Comment_resolved_29 = Expect<_check_Comment_resolved_29>;

type Ref_CommentCollection_getFirst_30 = () => DocxEditor.Comment;
type Auth_CommentCollection_getFirst_30 = () => DocxEditor.Comment;
type _check_CommentCollection_getFirst_30 = IsExact<Ref_CommentCollection_getFirst_30, Auth_CommentCollection_getFirst_30>;
type _assert_CommentCollection_getFirst_30 = Expect<_check_CommentCollection_getFirst_30>;

type Ref_CommentCollection_items_31 = () => DocxEditor.Comment[];
type Auth_CommentCollection_items_31 = () => DocxEditor.Comment[];
type _check_CommentCollection_items_31 = IsExact<Ref_CommentCollection_items_31, Auth_CommentCollection_items_31>;
type _assert_CommentCollection_items_31 = Expect<_check_CommentCollection_items_31>;

type Ref_CommentReply_authorEmail_32 = () => string;
type Auth_CommentReply_authorEmail_32 = () => string;
type _check_CommentReply_authorEmail_32 = IsExact<Ref_CommentReply_authorEmail_32, Auth_CommentReply_authorEmail_32>;
type _assert_CommentReply_authorEmail_32 = Expect<_check_CommentReply_authorEmail_32>;

type Ref_CommentReply_authorName_33 = () => string;
type Auth_CommentReply_authorName_33 = () => string;
type _check_CommentReply_authorName_33 = IsExact<Ref_CommentReply_authorName_33, Auth_CommentReply_authorName_33>;
type _assert_CommentReply_authorName_33 = Expect<_check_CommentReply_authorName_33>;

type Ref_CommentReply_content_34 = () => string;
type Auth_CommentReply_content_34 = () => string;
type _check_CommentReply_content_34 = IsExact<Ref_CommentReply_content_34, Auth_CommentReply_content_34>;
type _assert_CommentReply_content_34 = Expect<_check_CommentReply_content_34>;

type Ref_CommentReply_creationDate_35 = () => Date;
type Auth_CommentReply_creationDate_35 = () => Date;
type _check_CommentReply_creationDate_35 = IsExact<Ref_CommentReply_creationDate_35, Auth_CommentReply_creationDate_35>;
type _assert_CommentReply_creationDate_35 = Expect<_check_CommentReply_creationDate_35>;

type Ref_CommentReply_delete_36 = () => void;
type Auth_CommentReply_delete_36 = () => void;
type _check_CommentReply_delete_36 = IsExact<Ref_CommentReply_delete_36, Auth_CommentReply_delete_36>;
type _assert_CommentReply_delete_36 = Expect<_check_CommentReply_delete_36>;

type Ref_CommentReply_id_37 = () => string;
type Auth_CommentReply_id_37 = () => string;
type _check_CommentReply_id_37 = IsExact<Ref_CommentReply_id_37, Auth_CommentReply_id_37>;
type _assert_CommentReply_id_37 = Expect<_check_CommentReply_id_37>;

type Ref_CommentReplyCollection_getFirst_38 = () => DocxEditor.CommentReply;
type Auth_CommentReplyCollection_getFirst_38 = () => DocxEditor.CommentReply;
type _check_CommentReplyCollection_getFirst_38 = IsExact<Ref_CommentReplyCollection_getFirst_38, Auth_CommentReplyCollection_getFirst_38>;
type _assert_CommentReplyCollection_getFirst_38 = Expect<_check_CommentReplyCollection_getFirst_38>;

type Ref_CommentReplyCollection_items_39 = () => DocxEditor.CommentReply[];
type Auth_CommentReplyCollection_items_39 = () => DocxEditor.CommentReply[];
type _check_CommentReplyCollection_items_39 = IsExact<Ref_CommentReplyCollection_items_39, Auth_CommentReplyCollection_items_39>;
type _assert_CommentReplyCollection_items_39 = Expect<_check_CommentReplyCollection_items_39>;

type Ref_ContentControl_appearance_40 = () => "BoundingBox" | "Tags" | "Hidden";
type Auth_ContentControl_appearance_40 = () => "BoundingBox" | "Tags" | "Hidden";
type _check_ContentControl_appearance_40 = IsExact<Ref_ContentControl_appearance_40, Auth_ContentControl_appearance_40>;
type _assert_ContentControl_appearance_40 = Expect<_check_ContentControl_appearance_40>;

type Ref_ContentControl_cannotDelete_41 = () => boolean;
type Auth_ContentControl_cannotDelete_41 = () => boolean;
type _check_ContentControl_cannotDelete_41 = IsExact<Ref_ContentControl_cannotDelete_41, Auth_ContentControl_cannotDelete_41>;
type _assert_ContentControl_cannotDelete_41 = Expect<_check_ContentControl_cannotDelete_41>;

type Ref_ContentControl_cannotEdit_42 = () => boolean;
type Auth_ContentControl_cannotEdit_42 = () => boolean;
type _check_ContentControl_cannotEdit_42 = IsExact<Ref_ContentControl_cannotEdit_42, Auth_ContentControl_cannotEdit_42>;
type _assert_ContentControl_cannotEdit_42 = Expect<_check_ContentControl_cannotEdit_42>;

type Ref_ContentControl_color_43 = () => string;
type Auth_ContentControl_color_43 = () => string;
type _check_ContentControl_color_43 = IsExact<Ref_ContentControl_color_43, Auth_ContentControl_color_43>;
type _assert_ContentControl_color_43 = Expect<_check_ContentControl_color_43>;

type Ref_ContentControl_contentControls_44 = () => DocxEditor.ContentControlCollection;
type Auth_ContentControl_contentControls_44 = () => DocxEditor.ContentControlCollection;
type _check_ContentControl_contentControls_44 = IsExact<Ref_ContentControl_contentControls_44, Auth_ContentControl_contentControls_44>;
type _assert_ContentControl_contentControls_44 = Expect<_check_ContentControl_contentControls_44>;

type Ref_ContentControl_delete_45 = (keepContent: boolean) => void;
type Auth_ContentControl_delete_45 = (keepContent: boolean) => void;
type _check_ContentControl_delete_45 = IsExact<Ref_ContentControl_delete_45, Auth_ContentControl_delete_45>;
type _assert_ContentControl_delete_45 = Expect<_check_ContentControl_delete_45>;

type Ref_ContentControl_getRange_46 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type Auth_ContentControl_getRange_46 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type _check_ContentControl_getRange_46 = IsExact<Ref_ContentControl_getRange_46, Auth_ContentControl_getRange_46>;
type _assert_ContentControl_getRange_46 = Expect<_check_ContentControl_getRange_46>;

type Ref_ContentControl_id_47 = () => number;
type Auth_ContentControl_id_47 = () => number;
type _check_ContentControl_id_47 = IsExact<Ref_ContentControl_id_47, Auth_ContentControl_id_47>;
type _assert_ContentControl_id_47 = Expect<_check_ContentControl_id_47>;

type Ref_ContentControl_insertText_48 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_ContentControl_insertText_48 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_ContentControl_insertText_48 = IsExact<Ref_ContentControl_insertText_48, Auth_ContentControl_insertText_48>;
type _assert_ContentControl_insertText_48 = Expect<_check_ContentControl_insertText_48>;

type Ref_ContentControl_paragraphs_49 = () => DocxEditor.ParagraphCollection;
type Auth_ContentControl_paragraphs_49 = () => DocxEditor.ParagraphCollection;
type _check_ContentControl_paragraphs_49 = IsExact<Ref_ContentControl_paragraphs_49, Auth_ContentControl_paragraphs_49>;
type _assert_ContentControl_paragraphs_49 = Expect<_check_ContentControl_paragraphs_49>;

type Ref_ContentControl_placeholderText_50 = () => string;
type Auth_ContentControl_placeholderText_50 = () => string;
type _check_ContentControl_placeholderText_50 = IsExact<Ref_ContentControl_placeholderText_50, Auth_ContentControl_placeholderText_50>;
type _assert_ContentControl_placeholderText_50 = Expect<_check_ContentControl_placeholderText_50>;

type Ref_ContentControl_subtype_51 = () => "Unknown" | "RichTextInline" | "RichTextParagraphs" | "RichTextTableCell" | "RichTextTableRow" | "RichTextTable" | "PlainTextInline" | "PlainTextParagraph" | "Picture" | "BuildingBlockGallery" | "CheckBox" | "ComboBox" | "DropDownList" | "DatePicker" | "RepeatingSection" | "RichText" | "PlainText" | "Group";
type Auth_ContentControl_subtype_51 = () => "Unknown" | "RichTextInline" | "RichTextParagraphs" | "RichTextTableCell" | "RichTextTableRow" | "RichTextTable" | "PlainTextInline" | "PlainTextParagraph" | "Picture" | "BuildingBlockGallery" | "CheckBox" | "ComboBox" | "DropDownList" | "DatePicker" | "RepeatingSection" | "RichText" | "PlainText" | "Group";
type _check_ContentControl_subtype_51 = IsExact<Ref_ContentControl_subtype_51, Auth_ContentControl_subtype_51>;
type _assert_ContentControl_subtype_51 = Expect<_check_ContentControl_subtype_51>;

type Ref_ContentControl_tag_52 = () => string;
type Auth_ContentControl_tag_52 = () => string;
type _check_ContentControl_tag_52 = IsExact<Ref_ContentControl_tag_52, Auth_ContentControl_tag_52>;
type _assert_ContentControl_tag_52 = Expect<_check_ContentControl_tag_52>;

type Ref_ContentControl_text_53 = () => string;
type Auth_ContentControl_text_53 = () => string;
type _check_ContentControl_text_53 = IsExact<Ref_ContentControl_text_53, Auth_ContentControl_text_53>;
type _assert_ContentControl_text_53 = Expect<_check_ContentControl_text_53>;

type Ref_ContentControl_title_54 = () => string;
type Auth_ContentControl_title_54 = () => string;
type _check_ContentControl_title_54 = IsExact<Ref_ContentControl_title_54, Auth_ContentControl_title_54>;
type _assert_ContentControl_title_54 = Expect<_check_ContentControl_title_54>;

type Ref_ContentControlCollection_getById_55 = (id: number) => DocxEditor.ContentControl;
type Auth_ContentControlCollection_getById_55 = (id: number) => DocxEditor.ContentControl;
type _check_ContentControlCollection_getById_55 = IsExact<Ref_ContentControlCollection_getById_55, Auth_ContentControlCollection_getById_55>;
type _assert_ContentControlCollection_getById_55 = Expect<_check_ContentControlCollection_getById_55>;

type Ref_ContentControlCollection_items_56 = () => DocxEditor.ContentControl[];
type Auth_ContentControlCollection_items_56 = () => DocxEditor.ContentControl[];
type _check_ContentControlCollection_items_56 = IsExact<Ref_ContentControlCollection_items_56, Auth_ContentControlCollection_items_56>;
type _assert_ContentControlCollection_items_56 = Expect<_check_ContentControlCollection_items_56>;

type Ref_Document_body_57 = () => DocxEditor.Body;
type Auth_Document_body_57 = () => DocxEditor.Body;
type _check_Document_body_57 = IsExact<Ref_Document_body_57, Auth_Document_body_57>;
type _assert_Document_body_57 = Expect<_check_Document_body_57>;

type Ref_Document_comments_58 = () => DocxEditor.CommentCollection;
type Auth_Document_comments_58 = () => DocxEditor.CommentCollection;
type _check_Document_comments_58 = IsExact<Ref_Document_comments_58, Auth_Document_comments_58>;
type _assert_Document_comments_58 = Expect<_check_Document_comments_58>;

type Ref_Document_contentControls_59 = () => DocxEditor.ContentControlCollection;
type Auth_Document_contentControls_59 = () => DocxEditor.ContentControlCollection;
type _check_Document_contentControls_59 = IsExact<Ref_Document_contentControls_59, Auth_Document_contentControls_59>;
type _assert_Document_contentControls_59 = Expect<_check_Document_contentControls_59>;

type Ref_Document_paragraphs_60 = () => DocxEditor.ParagraphCollection;
type Auth_Document_paragraphs_60 = () => DocxEditor.ParagraphCollection;
type _check_Document_paragraphs_60 = IsExact<Ref_Document_paragraphs_60, Auth_Document_paragraphs_60>;
type _assert_Document_paragraphs_60 = Expect<_check_Document_paragraphs_60>;

type Ref_Document_sections_61 = () => DocxEditor.SectionCollection;
type Auth_Document_sections_61 = () => DocxEditor.SectionCollection;
type _check_Document_sections_61 = IsExact<Ref_Document_sections_61, Auth_Document_sections_61>;
type _assert_Document_sections_61 = Expect<_check_Document_sections_61>;

type Ref_Font_bold_62 = () => boolean;
type Auth_Font_bold_62 = () => boolean;
type _check_Font_bold_62 = IsExact<Ref_Font_bold_62, Auth_Font_bold_62>;
type _assert_Font_bold_62 = Expect<_check_Font_bold_62>;

type Ref_Font_color_63 = () => string;
type Auth_Font_color_63 = () => string;
type _check_Font_color_63 = IsExact<Ref_Font_color_63, Auth_Font_color_63>;
type _assert_Font_color_63 = Expect<_check_Font_color_63>;

type Ref_Font_highlightColor_64 = () => string;
type Auth_Font_highlightColor_64 = () => string;
type _check_Font_highlightColor_64 = IsExact<Ref_Font_highlightColor_64, Auth_Font_highlightColor_64>;
type _assert_Font_highlightColor_64 = Expect<_check_Font_highlightColor_64>;

type Ref_Font_italic_65 = () => boolean;
type Auth_Font_italic_65 = () => boolean;
type _check_Font_italic_65 = IsExact<Ref_Font_italic_65, Auth_Font_italic_65>;
type _assert_Font_italic_65 = Expect<_check_Font_italic_65>;

type Ref_Font_name_66 = () => string;
type Auth_Font_name_66 = () => string;
type _check_Font_name_66 = IsExact<Ref_Font_name_66, Auth_Font_name_66>;
type _assert_Font_name_66 = Expect<_check_Font_name_66>;

type Ref_Font_size_67 = () => number;
type Auth_Font_size_67 = () => number;
type _check_Font_size_67 = IsExact<Ref_Font_size_67, Auth_Font_size_67>;
type _assert_Font_size_67 = Expect<_check_Font_size_67>;

type Ref_List_getLevelParagraphs_68 = (level: number) => DocxEditor.ParagraphCollection;
type Auth_List_getLevelParagraphs_68 = (level: number) => DocxEditor.ParagraphCollection;
type _check_List_getLevelParagraphs_68 = IsExact<Ref_List_getLevelParagraphs_68, Auth_List_getLevelParagraphs_68>;
type _assert_List_getLevelParagraphs_68 = Expect<_check_List_getLevelParagraphs_68>;

type Ref_List_id_69 = () => number;
type Auth_List_id_69 = () => number;
type _check_List_id_69 = IsExact<Ref_List_id_69, Auth_List_id_69>;
type _assert_List_id_69 = Expect<_check_List_id_69>;

type Ref_List_insertParagraph_70 = (paragraphText: string, insertLocation: "Start" | "End" | "Before" | "After") => DocxEditor.Paragraph;
type Auth_List_insertParagraph_70 = (paragraphText: string, insertLocation: "Start" | "End" | "Before" | "After") => DocxEditor.Paragraph;
type _check_List_insertParagraph_70 = IsExact<Ref_List_insertParagraph_70, Auth_List_insertParagraph_70>;
type _assert_List_insertParagraph_70 = Expect<_check_List_insertParagraph_70>;

type Ref_List_paragraphs_71 = () => DocxEditor.ParagraphCollection;
type Auth_List_paragraphs_71 = () => DocxEditor.ParagraphCollection;
type _check_List_paragraphs_71 = IsExact<Ref_List_paragraphs_71, Auth_List_paragraphs_71>;
type _assert_List_paragraphs_71 = Expect<_check_List_paragraphs_71>;

type Ref_ListCollection_getById_72 = (id: number) => DocxEditor.List;
type Auth_ListCollection_getById_72 = (id: number) => DocxEditor.List;
type _check_ListCollection_getById_72 = IsExact<Ref_ListCollection_getById_72, Auth_ListCollection_getById_72>;
type _assert_ListCollection_getById_72 = Expect<_check_ListCollection_getById_72>;

type Ref_ListCollection_getFirst_73 = () => DocxEditor.List;
type Auth_ListCollection_getFirst_73 = () => DocxEditor.List;
type _check_ListCollection_getFirst_73 = IsExact<Ref_ListCollection_getFirst_73, Auth_ListCollection_getFirst_73>;
type _assert_ListCollection_getFirst_73 = Expect<_check_ListCollection_getFirst_73>;

type Ref_ListCollection_items_74 = () => DocxEditor.List[];
type Auth_ListCollection_items_74 = () => DocxEditor.List[];
type _check_ListCollection_items_74 = IsExact<Ref_ListCollection_items_74, Auth_ListCollection_items_74>;
type _assert_ListCollection_items_74 = Expect<_check_ListCollection_items_74>;

type Ref_ListItem_level_75 = () => number;
type Auth_ListItem_level_75 = () => number;
type _check_ListItem_level_75 = IsExact<Ref_ListItem_level_75, Auth_ListItem_level_75>;
type _assert_ListItem_level_75 = Expect<_check_ListItem_level_75>;

type Ref_ListItem_listString_76 = () => string;
type Auth_ListItem_listString_76 = () => string;
type _check_ListItem_listString_76 = IsExact<Ref_ListItem_listString_76, Auth_ListItem_listString_76>;
type _assert_ListItem_listString_76 = Expect<_check_ListItem_listString_76>;

type Ref_ListItem_siblingIndex_77 = () => number;
type Auth_ListItem_siblingIndex_77 = () => number;
type _check_ListItem_siblingIndex_77 = IsExact<Ref_ListItem_siblingIndex_77, Auth_ListItem_siblingIndex_77>;
type _assert_ListItem_siblingIndex_77 = Expect<_check_ListItem_siblingIndex_77>;

type Ref_NoteItem_body_78 = () => DocxEditor.Body;
type Auth_NoteItem_body_78 = () => DocxEditor.Body;
type _check_NoteItem_body_78 = IsExact<Ref_NoteItem_body_78, Auth_NoteItem_body_78>;
type _assert_NoteItem_body_78 = Expect<_check_NoteItem_body_78>;

type Ref_NoteItem_delete_79 = () => void;
type Auth_NoteItem_delete_79 = () => void;
type _check_NoteItem_delete_79 = IsExact<Ref_NoteItem_delete_79, Auth_NoteItem_delete_79>;
type _assert_NoteItem_delete_79 = Expect<_check_NoteItem_delete_79>;

type Ref_NoteItem_getNext_80 = () => DocxEditor.NoteItem;
type Auth_NoteItem_getNext_80 = () => DocxEditor.NoteItem;
type _check_NoteItem_getNext_80 = IsExact<Ref_NoteItem_getNext_80, Auth_NoteItem_getNext_80>;
type _assert_NoteItem_getNext_80 = Expect<_check_NoteItem_getNext_80>;

type Ref_NoteItem_type_81 = () => "Footnote" | "Endnote";
type Auth_NoteItem_type_81 = () => "Footnote" | "Endnote";
type _check_NoteItem_type_81 = IsExact<Ref_NoteItem_type_81, Auth_NoteItem_type_81>;
type _assert_NoteItem_type_81 = Expect<_check_NoteItem_type_81>;

type Ref_PageSetup_bottomMargin_82 = () => number;
type Auth_PageSetup_bottomMargin_82 = () => number;
type _check_PageSetup_bottomMargin_82 = IsExact<Ref_PageSetup_bottomMargin_82, Auth_PageSetup_bottomMargin_82>;
type _assert_PageSetup_bottomMargin_82 = Expect<_check_PageSetup_bottomMargin_82>;

type Ref_PageSetup_leftMargin_83 = () => number;
type Auth_PageSetup_leftMargin_83 = () => number;
type _check_PageSetup_leftMargin_83 = IsExact<Ref_PageSetup_leftMargin_83, Auth_PageSetup_leftMargin_83>;
type _assert_PageSetup_leftMargin_83 = Expect<_check_PageSetup_leftMargin_83>;

type Ref_PageSetup_orientation_84 = () => "Portrait" | "Landscape";
type Auth_PageSetup_orientation_84 = () => "Portrait" | "Landscape";
type _check_PageSetup_orientation_84 = IsExact<Ref_PageSetup_orientation_84, Auth_PageSetup_orientation_84>;
type _assert_PageSetup_orientation_84 = Expect<_check_PageSetup_orientation_84>;

type Ref_PageSetup_pageHeight_85 = () => number;
type Auth_PageSetup_pageHeight_85 = () => number;
type _check_PageSetup_pageHeight_85 = IsExact<Ref_PageSetup_pageHeight_85, Auth_PageSetup_pageHeight_85>;
type _assert_PageSetup_pageHeight_85 = Expect<_check_PageSetup_pageHeight_85>;

type Ref_PageSetup_pageWidth_86 = () => number;
type Auth_PageSetup_pageWidth_86 = () => number;
type _check_PageSetup_pageWidth_86 = IsExact<Ref_PageSetup_pageWidth_86, Auth_PageSetup_pageWidth_86>;
type _assert_PageSetup_pageWidth_86 = Expect<_check_PageSetup_pageWidth_86>;

type Ref_PageSetup_rightMargin_87 = () => number;
type Auth_PageSetup_rightMargin_87 = () => number;
type _check_PageSetup_rightMargin_87 = IsExact<Ref_PageSetup_rightMargin_87, Auth_PageSetup_rightMargin_87>;
type _assert_PageSetup_rightMargin_87 = Expect<_check_PageSetup_rightMargin_87>;

type Ref_PageSetup_topMargin_88 = () => number;
type Auth_PageSetup_topMargin_88 = () => number;
type _check_PageSetup_topMargin_88 = IsExact<Ref_PageSetup_topMargin_88, Auth_PageSetup_topMargin_88>;
type _assert_PageSetup_topMargin_88 = Expect<_check_PageSetup_topMargin_88>;

type Ref_Paragraph_alignment_89 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type Auth_Paragraph_alignment_89 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type _check_Paragraph_alignment_89 = IsExact<Ref_Paragraph_alignment_89, Auth_Paragraph_alignment_89>;
type _assert_Paragraph_alignment_89 = Expect<_check_Paragraph_alignment_89>;

type Ref_Paragraph_clear_90 = () => void;
type Auth_Paragraph_clear_90 = () => void;
type _check_Paragraph_clear_90 = IsExact<Ref_Paragraph_clear_90, Auth_Paragraph_clear_90>;
type _assert_Paragraph_clear_90 = Expect<_check_Paragraph_clear_90>;

type Ref_Paragraph_contentControls_91 = () => DocxEditor.ContentControlCollection;
type Auth_Paragraph_contentControls_91 = () => DocxEditor.ContentControlCollection;
type _check_Paragraph_contentControls_91 = IsExact<Ref_Paragraph_contentControls_91, Auth_Paragraph_contentControls_91>;
type _assert_Paragraph_contentControls_91 = Expect<_check_Paragraph_contentControls_91>;

type Ref_Paragraph_delete_92 = () => void;
type Auth_Paragraph_delete_92 = () => void;
type _check_Paragraph_delete_92 = IsExact<Ref_Paragraph_delete_92, Auth_Paragraph_delete_92>;
type _assert_Paragraph_delete_92 = Expect<_check_Paragraph_delete_92>;

type Ref_Paragraph_firstLineIndent_93 = () => number;
type Auth_Paragraph_firstLineIndent_93 = () => number;
type _check_Paragraph_firstLineIndent_93 = IsExact<Ref_Paragraph_firstLineIndent_93, Auth_Paragraph_firstLineIndent_93>;
type _assert_Paragraph_firstLineIndent_93 = Expect<_check_Paragraph_firstLineIndent_93>;

type Ref_Paragraph_font_94 = () => DocxEditor.Font;
type Auth_Paragraph_font_94 = () => DocxEditor.Font;
type _check_Paragraph_font_94 = IsExact<Ref_Paragraph_font_94, Auth_Paragraph_font_94>;
type _assert_Paragraph_font_94 = Expect<_check_Paragraph_font_94>;

type Ref_Paragraph_insertParagraph_95 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Paragraph_insertParagraph_95 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Paragraph_insertParagraph_95 = IsExact<Ref_Paragraph_insertParagraph_95, Auth_Paragraph_insertParagraph_95>;
type _assert_Paragraph_insertParagraph_95 = Expect<_check_Paragraph_insertParagraph_95>;

type Ref_Paragraph_insertText_96 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Paragraph_insertText_96 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Paragraph_insertText_96 = IsExact<Ref_Paragraph_insertText_96, Auth_Paragraph_insertText_96>;
type _assert_Paragraph_insertText_96 = Expect<_check_Paragraph_insertText_96>;

type Ref_Paragraph_leftIndent_97 = () => number;
type Auth_Paragraph_leftIndent_97 = () => number;
type _check_Paragraph_leftIndent_97 = IsExact<Ref_Paragraph_leftIndent_97, Auth_Paragraph_leftIndent_97>;
type _assert_Paragraph_leftIndent_97 = Expect<_check_Paragraph_leftIndent_97>;

type Ref_Paragraph_lineSpacing_98 = () => number;
type Auth_Paragraph_lineSpacing_98 = () => number;
type _check_Paragraph_lineSpacing_98 = IsExact<Ref_Paragraph_lineSpacing_98, Auth_Paragraph_lineSpacing_98>;
type _assert_Paragraph_lineSpacing_98 = Expect<_check_Paragraph_lineSpacing_98>;

type Ref_Paragraph_list_99 = () => DocxEditor.List;
type Auth_Paragraph_list_99 = () => DocxEditor.List;
type _check_Paragraph_list_99 = IsExact<Ref_Paragraph_list_99, Auth_Paragraph_list_99>;
type _assert_Paragraph_list_99 = Expect<_check_Paragraph_list_99>;

type Ref_Paragraph_listItem_100 = () => DocxEditor.ListItem;
type Auth_Paragraph_listItem_100 = () => DocxEditor.ListItem;
type _check_Paragraph_listItem_100 = IsExact<Ref_Paragraph_listItem_100, Auth_Paragraph_listItem_100>;
type _assert_Paragraph_listItem_100 = Expect<_check_Paragraph_listItem_100>;

type Ref_Paragraph_rightIndent_101 = () => number;
type Auth_Paragraph_rightIndent_101 = () => number;
type _check_Paragraph_rightIndent_101 = IsExact<Ref_Paragraph_rightIndent_101, Auth_Paragraph_rightIndent_101>;
type _assert_Paragraph_rightIndent_101 = Expect<_check_Paragraph_rightIndent_101>;

type Ref_Paragraph_spaceAfter_102 = () => number;
type Auth_Paragraph_spaceAfter_102 = () => number;
type _check_Paragraph_spaceAfter_102 = IsExact<Ref_Paragraph_spaceAfter_102, Auth_Paragraph_spaceAfter_102>;
type _assert_Paragraph_spaceAfter_102 = Expect<_check_Paragraph_spaceAfter_102>;

type Ref_Paragraph_spaceBefore_103 = () => number;
type Auth_Paragraph_spaceBefore_103 = () => number;
type _check_Paragraph_spaceBefore_103 = IsExact<Ref_Paragraph_spaceBefore_103, Auth_Paragraph_spaceBefore_103>;
type _assert_Paragraph_spaceBefore_103 = Expect<_check_Paragraph_spaceBefore_103>;

type Ref_Paragraph_split_104 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type Auth_Paragraph_split_104 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type _check_Paragraph_split_104 = IsExact<Ref_Paragraph_split_104, Auth_Paragraph_split_104>;
type _assert_Paragraph_split_104 = Expect<_check_Paragraph_split_104>;

type Ref_Paragraph_style_105 = () => string;
type Auth_Paragraph_style_105 = () => string;
type _check_Paragraph_style_105 = IsExact<Ref_Paragraph_style_105, Auth_Paragraph_style_105>;
type _assert_Paragraph_style_105 = Expect<_check_Paragraph_style_105>;

type Ref_Paragraph_text_106 = () => string;
type Auth_Paragraph_text_106 = () => string;
type _check_Paragraph_text_106 = IsExact<Ref_Paragraph_text_106, Auth_Paragraph_text_106>;
type _assert_Paragraph_text_106 = Expect<_check_Paragraph_text_106>;

type Ref_ParagraphCollection_getFirst_107 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getFirst_107 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getFirst_107 = IsExact<Ref_ParagraphCollection_getFirst_107, Auth_ParagraphCollection_getFirst_107>;
type _assert_ParagraphCollection_getFirst_107 = Expect<_check_ParagraphCollection_getFirst_107>;

type Ref_ParagraphCollection_getLast_108 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getLast_108 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getLast_108 = IsExact<Ref_ParagraphCollection_getLast_108, Auth_ParagraphCollection_getLast_108>;
type _assert_ParagraphCollection_getLast_108 = Expect<_check_ParagraphCollection_getLast_108>;

type Ref_ParagraphCollection_items_109 = () => DocxEditor.Paragraph[];
type Auth_ParagraphCollection_items_109 = () => DocxEditor.Paragraph[];
type _check_ParagraphCollection_items_109 = IsExact<Ref_ParagraphCollection_items_109, Auth_ParagraphCollection_items_109>;
type _assert_ParagraphCollection_items_109 = Expect<_check_ParagraphCollection_items_109>;

type Ref_ParagraphFormat_alignment_110 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type Auth_ParagraphFormat_alignment_110 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type _check_ParagraphFormat_alignment_110 = IsExact<Ref_ParagraphFormat_alignment_110, Auth_ParagraphFormat_alignment_110>;
type _assert_ParagraphFormat_alignment_110 = Expect<_check_ParagraphFormat_alignment_110>;

type Ref_ParagraphFormat_firstLineIndent_111 = () => number;
type Auth_ParagraphFormat_firstLineIndent_111 = () => number;
type _check_ParagraphFormat_firstLineIndent_111 = IsExact<Ref_ParagraphFormat_firstLineIndent_111, Auth_ParagraphFormat_firstLineIndent_111>;
type _assert_ParagraphFormat_firstLineIndent_111 = Expect<_check_ParagraphFormat_firstLineIndent_111>;

type Ref_ParagraphFormat_leftIndent_112 = () => number;
type Auth_ParagraphFormat_leftIndent_112 = () => number;
type _check_ParagraphFormat_leftIndent_112 = IsExact<Ref_ParagraphFormat_leftIndent_112, Auth_ParagraphFormat_leftIndent_112>;
type _assert_ParagraphFormat_leftIndent_112 = Expect<_check_ParagraphFormat_leftIndent_112>;

type Ref_ParagraphFormat_lineSpacing_113 = () => number;
type Auth_ParagraphFormat_lineSpacing_113 = () => number;
type _check_ParagraphFormat_lineSpacing_113 = IsExact<Ref_ParagraphFormat_lineSpacing_113, Auth_ParagraphFormat_lineSpacing_113>;
type _assert_ParagraphFormat_lineSpacing_113 = Expect<_check_ParagraphFormat_lineSpacing_113>;

type Ref_ParagraphFormat_rightIndent_114 = () => number;
type Auth_ParagraphFormat_rightIndent_114 = () => number;
type _check_ParagraphFormat_rightIndent_114 = IsExact<Ref_ParagraphFormat_rightIndent_114, Auth_ParagraphFormat_rightIndent_114>;
type _assert_ParagraphFormat_rightIndent_114 = Expect<_check_ParagraphFormat_rightIndent_114>;

type Ref_ParagraphFormat_spaceAfter_115 = () => number;
type Auth_ParagraphFormat_spaceAfter_115 = () => number;
type _check_ParagraphFormat_spaceAfter_115 = IsExact<Ref_ParagraphFormat_spaceAfter_115, Auth_ParagraphFormat_spaceAfter_115>;
type _assert_ParagraphFormat_spaceAfter_115 = Expect<_check_ParagraphFormat_spaceAfter_115>;

type Ref_ParagraphFormat_spaceBefore_116 = () => number;
type Auth_ParagraphFormat_spaceBefore_116 = () => number;
type _check_ParagraphFormat_spaceBefore_116 = IsExact<Ref_ParagraphFormat_spaceBefore_116, Auth_ParagraphFormat_spaceBefore_116>;
type _assert_ParagraphFormat_spaceBefore_116 = Expect<_check_ParagraphFormat_spaceBefore_116>;

type Ref_ParagraphFormat_widowControl_117 = () => boolean;
type Auth_ParagraphFormat_widowControl_117 = () => boolean;
type _check_ParagraphFormat_widowControl_117 = IsExact<Ref_ParagraphFormat_widowControl_117, Auth_ParagraphFormat_widowControl_117>;
type _assert_ParagraphFormat_widowControl_117 = Expect<_check_ParagraphFormat_widowControl_117>;

type Ref_Range_bookmarks_118 = () => DocxEditor.BookmarkCollection;
type Auth_Range_bookmarks_118 = () => DocxEditor.BookmarkCollection;
type _check_Range_bookmarks_118 = IsExact<Ref_Range_bookmarks_118, Auth_Range_bookmarks_118>;
type _assert_Range_bookmarks_118 = Expect<_check_Range_bookmarks_118>;

type Ref_Range_contentControls_119 = () => DocxEditor.ContentControlCollection;
type Auth_Range_contentControls_119 = () => DocxEditor.ContentControlCollection;
type _check_Range_contentControls_119 = IsExact<Ref_Range_contentControls_119, Auth_Range_contentControls_119>;
type _assert_Range_contentControls_119 = Expect<_check_Range_contentControls_119>;

type Ref_Range_end_120 = () => number;
type Auth_Range_end_120 = () => number;
type _check_Range_end_120 = IsExact<Ref_Range_end_120, Auth_Range_end_120>;
type _assert_Range_end_120 = Expect<_check_Range_end_120>;

type Ref_Range_font_121 = () => DocxEditor.Font;
type Auth_Range_font_121 = () => DocxEditor.Font;
type _check_Range_font_121 = IsExact<Ref_Range_font_121, Auth_Range_font_121>;
type _assert_Range_font_121 = Expect<_check_Range_font_121>;

type Ref_Range_hyperlink_122 = () => string;
type Auth_Range_hyperlink_122 = () => string;
type _check_Range_hyperlink_122 = IsExact<Ref_Range_hyperlink_122, Auth_Range_hyperlink_122>;
type _assert_Range_hyperlink_122 = Expect<_check_Range_hyperlink_122>;

type Ref_Range_insertParagraph_123 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Range_insertParagraph_123 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Range_insertParagraph_123 = IsExact<Ref_Range_insertParagraph_123, Auth_Range_insertParagraph_123>;
type _assert_Range_insertParagraph_123 = Expect<_check_Range_insertParagraph_123>;

type Ref_Range_insertText_124 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type Auth_Range_insertText_124 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type _check_Range_insertText_124 = IsExact<Ref_Range_insertText_124, Auth_Range_insertText_124>;
type _assert_Range_insertText_124 = Expect<_check_Range_insertText_124>;

type Ref_Range_paragraphs_125 = () => DocxEditor.ParagraphCollection;
type Auth_Range_paragraphs_125 = () => DocxEditor.ParagraphCollection;
type _check_Range_paragraphs_125 = IsExact<Ref_Range_paragraphs_125, Auth_Range_paragraphs_125>;
type _assert_Range_paragraphs_125 = Expect<_check_Range_paragraphs_125>;

type Ref_Range_search_126 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Range_search_126 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Range_search_126 = IsExact<Ref_Range_search_126, Auth_Range_search_126>;
type _assert_Range_search_126 = Expect<_check_Range_search_126>;

type Ref_Range_select_127 = (selectionMode?: DocxEditor.SelectionMode) => void;
type Auth_Range_select_127 = (selectionMode?: DocxEditor.SelectionMode) => void;
type _check_Range_select_127 = IsExact<Ref_Range_select_127, Auth_Range_select_127>;
type _assert_Range_select_127 = Expect<_check_Range_select_127>;

type Ref_Range_select_128 = (selectionMode?: "Select" | "Start" | "End") => void;
type Auth_Range_select_128 = (selectionMode?: "Select" | "Start" | "End") => void;
type _check_Range_select_128 = IsExact<Ref_Range_select_128, Auth_Range_select_128>;
type _assert_Range_select_128 = Expect<_check_Range_select_128>;

type Ref_Range_start_129 = () => number;
type Auth_Range_start_129 = () => number;
type _check_Range_start_129 = IsExact<Ref_Range_start_129, Auth_Range_start_129>;
type _assert_Range_start_129 = Expect<_check_Range_start_129>;

type Ref_Range_style_130 = () => string;
type Auth_Range_style_130 = () => string;
type _check_Range_style_130 = IsExact<Ref_Range_style_130, Auth_Range_style_130>;
type _assert_Range_style_130 = Expect<_check_Range_style_130>;

type Ref_Range_text_131 = () => string;
type Auth_Range_text_131 = () => string;
type _check_Range_text_131 = IsExact<Ref_Range_text_131, Auth_Range_text_131>;
type _assert_Range_text_131 = Expect<_check_Range_text_131>;

type Ref_RangeCollection_getFirst_132 = () => DocxEditor.Range;
type Auth_RangeCollection_getFirst_132 = () => DocxEditor.Range;
type _check_RangeCollection_getFirst_132 = IsExact<Ref_RangeCollection_getFirst_132, Auth_RangeCollection_getFirst_132>;
type _assert_RangeCollection_getFirst_132 = Expect<_check_RangeCollection_getFirst_132>;

type Ref_RangeCollection_items_133 = () => DocxEditor.Range[];
type Auth_RangeCollection_items_133 = () => DocxEditor.Range[];
type _check_RangeCollection_items_133 = IsExact<Ref_RangeCollection_items_133, Auth_RangeCollection_items_133>;
type _assert_RangeCollection_items_133 = Expect<_check_RangeCollection_items_133>;

type Ref_RequestContext_document_134 = () => DocxEditor.Document;
type Auth_RequestContext_document_134 = () => DocxEditor.Document;
type _check_RequestContext_document_134 = IsExact<Ref_RequestContext_document_134, Auth_RequestContext_document_134>;
type _assert_RequestContext_document_134 = Expect<_check_RequestContext_document_134>;

type Ref_Revision_accept_135 = () => void;
type Auth_Revision_accept_135 = () => void;
type _check_Revision_accept_135 = IsExact<Ref_Revision_accept_135, Auth_Revision_accept_135>;
type _assert_Revision_accept_135 = Expect<_check_Revision_accept_135>;

type Ref_Revision_author_136 = () => string;
type Auth_Revision_author_136 = () => string;
type _check_Revision_author_136 = IsExact<Ref_Revision_author_136, Auth_Revision_author_136>;
type _assert_Revision_author_136 = Expect<_check_Revision_author_136>;

type Ref_Revision_date_137 = () => Date;
type Auth_Revision_date_137 = () => Date;
type _check_Revision_date_137 = IsExact<Ref_Revision_date_137, Auth_Revision_date_137>;
type _assert_Revision_date_137 = Expect<_check_Revision_date_137>;

type Ref_Revision_range_138 = () => DocxEditor.Range;
type Auth_Revision_range_138 = () => DocxEditor.Range;
type _check_Revision_range_138 = IsExact<Ref_Revision_range_138, Auth_Revision_range_138>;
type _assert_Revision_range_138 = Expect<_check_Revision_range_138>;

type Ref_Revision_reject_139 = () => void;
type Auth_Revision_reject_139 = () => void;
type _check_Revision_reject_139 = IsExact<Ref_Revision_reject_139, Auth_Revision_reject_139>;
type _assert_Revision_reject_139 = Expect<_check_Revision_reject_139>;

type Ref_Revision_type_140 = () => "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete";
type Auth_Revision_type_140 = () => "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete";
type _check_Revision_type_140 = IsExact<Ref_Revision_type_140, Auth_Revision_type_140>;
type _assert_Revision_type_140 = Expect<_check_Revision_type_140>;

type Ref_RevisionCollection_acceptAll_141 = () => void;
type Auth_RevisionCollection_acceptAll_141 = () => void;
type _check_RevisionCollection_acceptAll_141 = IsExact<Ref_RevisionCollection_acceptAll_141, Auth_RevisionCollection_acceptAll_141>;
type _assert_RevisionCollection_acceptAll_141 = Expect<_check_RevisionCollection_acceptAll_141>;

type Ref_RevisionCollection_items_142 = () => DocxEditor.Revision[];
type Auth_RevisionCollection_items_142 = () => DocxEditor.Revision[];
type _check_RevisionCollection_items_142 = IsExact<Ref_RevisionCollection_items_142, Auth_RevisionCollection_items_142>;
type _assert_RevisionCollection_items_142 = Expect<_check_RevisionCollection_items_142>;

type Ref_RevisionCollection_rejectAll_143 = () => void;
type Auth_RevisionCollection_rejectAll_143 = () => void;
type _check_RevisionCollection_rejectAll_143 = IsExact<Ref_RevisionCollection_rejectAll_143, Auth_RevisionCollection_rejectAll_143>;
type _assert_RevisionCollection_rejectAll_143 = Expect<_check_RevisionCollection_rejectAll_143>;

type Ref_SearchOptions_ignorePunct_144 = () => boolean;
type Auth_SearchOptions_ignorePunct_144 = () => boolean;
type _check_SearchOptions_ignorePunct_144 = IsExact<Ref_SearchOptions_ignorePunct_144, Auth_SearchOptions_ignorePunct_144>;
type _assert_SearchOptions_ignorePunct_144 = Expect<_check_SearchOptions_ignorePunct_144>;

type Ref_SearchOptions_ignoreSpace_145 = () => boolean;
type Auth_SearchOptions_ignoreSpace_145 = () => boolean;
type _check_SearchOptions_ignoreSpace_145 = IsExact<Ref_SearchOptions_ignoreSpace_145, Auth_SearchOptions_ignoreSpace_145>;
type _assert_SearchOptions_ignoreSpace_145 = Expect<_check_SearchOptions_ignoreSpace_145>;

type Ref_SearchOptions_matchCase_146 = () => boolean;
type Auth_SearchOptions_matchCase_146 = () => boolean;
type _check_SearchOptions_matchCase_146 = IsExact<Ref_SearchOptions_matchCase_146, Auth_SearchOptions_matchCase_146>;
type _assert_SearchOptions_matchCase_146 = Expect<_check_SearchOptions_matchCase_146>;

type Ref_SearchOptions_matchWholeWord_147 = () => boolean;
type Auth_SearchOptions_matchWholeWord_147 = () => boolean;
type _check_SearchOptions_matchWholeWord_147 = IsExact<Ref_SearchOptions_matchWholeWord_147, Auth_SearchOptions_matchWholeWord_147>;
type _assert_SearchOptions_matchWholeWord_147 = Expect<_check_SearchOptions_matchWholeWord_147>;

type Ref_SearchOptions_matchWildcards_148 = () => boolean;
type Auth_SearchOptions_matchWildcards_148 = () => boolean;
type _check_SearchOptions_matchWildcards_148 = IsExact<Ref_SearchOptions_matchWildcards_148, Auth_SearchOptions_matchWildcards_148>;
type _assert_SearchOptions_matchWildcards_148 = Expect<_check_SearchOptions_matchWildcards_148>;

type Ref_Section_body_149 = () => DocxEditor.Body;
type Auth_Section_body_149 = () => DocxEditor.Body;
type _check_Section_body_149 = IsExact<Ref_Section_body_149, Auth_Section_body_149>;
type _assert_Section_body_149 = Expect<_check_Section_body_149>;

type Ref_Section_getFooter_150 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type Auth_Section_getFooter_150 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type _check_Section_getFooter_150 = IsExact<Ref_Section_getFooter_150, Auth_Section_getFooter_150>;
type _assert_Section_getFooter_150 = Expect<_check_Section_getFooter_150>;

type Ref_Section_getFooter_151 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type Auth_Section_getFooter_151 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type _check_Section_getFooter_151 = IsExact<Ref_Section_getFooter_151, Auth_Section_getFooter_151>;
type _assert_Section_getFooter_151 = Expect<_check_Section_getFooter_151>;

type Ref_Section_getHeader_152 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type Auth_Section_getHeader_152 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type _check_Section_getHeader_152 = IsExact<Ref_Section_getHeader_152, Auth_Section_getHeader_152>;
type _assert_Section_getHeader_152 = Expect<_check_Section_getHeader_152>;

type Ref_Section_getHeader_153 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type Auth_Section_getHeader_153 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type _check_Section_getHeader_153 = IsExact<Ref_Section_getHeader_153, Auth_Section_getHeader_153>;
type _assert_Section_getHeader_153 = Expect<_check_Section_getHeader_153>;

type Ref_Section_getNext_154 = () => DocxEditor.Section;
type Auth_Section_getNext_154 = () => DocxEditor.Section;
type _check_Section_getNext_154 = IsExact<Ref_Section_getNext_154, Auth_Section_getNext_154>;
type _assert_Section_getNext_154 = Expect<_check_Section_getNext_154>;

type Ref_Section_pageSetup_155 = () => DocxEditor.PageSetup;
type Auth_Section_pageSetup_155 = () => DocxEditor.PageSetup;
type _check_Section_pageSetup_155 = IsExact<Ref_Section_pageSetup_155, Auth_Section_pageSetup_155>;
type _assert_Section_pageSetup_155 = Expect<_check_Section_pageSetup_155>;

type Ref_SectionCollection_getFirst_156 = () => DocxEditor.Section;
type Auth_SectionCollection_getFirst_156 = () => DocxEditor.Section;
type _check_SectionCollection_getFirst_156 = IsExact<Ref_SectionCollection_getFirst_156, Auth_SectionCollection_getFirst_156>;
type _assert_SectionCollection_getFirst_156 = Expect<_check_SectionCollection_getFirst_156>;

type Ref_SectionCollection_items_157 = () => DocxEditor.Section[];
type Auth_SectionCollection_items_157 = () => DocxEditor.Section[];
type _check_SectionCollection_items_157 = IsExact<Ref_SectionCollection_items_157, Auth_SectionCollection_items_157>;
type _assert_SectionCollection_items_157 = Expect<_check_SectionCollection_items_157>;

type Ref_run_158 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_158 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_158 = IsExact<Ref_run_158, Auth_run_158>;
type _assert_run_158 = Expect<_check_run_158>;

type Ref_run_159 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_159 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_159 = IsExact<Ref_run_159, Auth_run_159>;
type _assert_run_159 = Expect<_check_run_159>;

type Ref_run_160 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_160 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_160 = IsExact<Ref_run_160, Auth_run_160>;
type _assert_run_160 = Expect<_check_run_160>;

