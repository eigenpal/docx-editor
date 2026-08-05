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

type Ref_Body_getComments_5 = () => DocxEditor.CommentCollection;
type Auth_Body_getComments_5 = () => DocxEditor.CommentCollection;
type _check_Body_getComments_5 = IsExact<Ref_Body_getComments_5, Auth_Body_getComments_5>;
type _assert_Body_getComments_5 = Expect<_check_Body_getComments_5>;

type Ref_Body_insertParagraph_6 = (paragraphText: string, insertLocation: "Start" | "End") => DocxEditor.Paragraph;
type Auth_Body_insertParagraph_6 = (paragraphText: string, insertLocation: "Start" | "End") => DocxEditor.Paragraph;
type _check_Body_insertParagraph_6 = IsExact<Ref_Body_insertParagraph_6, Auth_Body_insertParagraph_6>;
type _assert_Body_insertParagraph_6 = Expect<_check_Body_insertParagraph_6>;

type Ref_Body_insertText_7 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Body_insertText_7 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Body_insertText_7 = IsExact<Ref_Body_insertText_7, Auth_Body_insertText_7>;
type _assert_Body_insertText_7 = Expect<_check_Body_insertText_7>;

type Ref_Body_lists_8 = () => DocxEditor.ListCollection;
type Auth_Body_lists_8 = () => DocxEditor.ListCollection;
type _check_Body_lists_8 = IsExact<Ref_Body_lists_8, Auth_Body_lists_8>;
type _assert_Body_lists_8 = Expect<_check_Body_lists_8>;

type Ref_Body_lists_readonly_9 = { readonly value: DocxEditor.ListCollection };
type Auth_Body_lists_readonly_9 = { readonly value: DocxEditor.ListCollection };
type _check_Body_lists_readonly_9 = IsExact<Ref_Body_lists_readonly_9, Auth_Body_lists_readonly_9>;
type _assert_Body_lists_readonly_9 = Expect<_check_Body_lists_readonly_9>;

type Ref_Body_paragraphs_10 = () => DocxEditor.ParagraphCollection;
type Auth_Body_paragraphs_10 = () => DocxEditor.ParagraphCollection;
type _check_Body_paragraphs_10 = IsExact<Ref_Body_paragraphs_10, Auth_Body_paragraphs_10>;
type _assert_Body_paragraphs_10 = Expect<_check_Body_paragraphs_10>;

type Ref_Body_paragraphs_readonly_11 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Body_paragraphs_readonly_11 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Body_paragraphs_readonly_11 = IsExact<Ref_Body_paragraphs_readonly_11, Auth_Body_paragraphs_readonly_11>;
type _assert_Body_paragraphs_readonly_11 = Expect<_check_Body_paragraphs_readonly_11>;

type Ref_Body_search_12 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Body_search_12 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Body_search_12 = IsExact<Ref_Body_search_12, Auth_Body_search_12>;
type _assert_Body_search_12 = Expect<_check_Body_search_12>;

type Ref_Body_style_13 = () => string;
type Auth_Body_style_13 = () => string;
type _check_Body_style_13 = IsExact<Ref_Body_style_13, Auth_Body_style_13>;
type _assert_Body_style_13 = Expect<_check_Body_style_13>;

type Ref_Body_style_readonly_14 = { value: string };
type Auth_Body_style_readonly_14 = { value: string };
type _check_Body_style_readonly_14 = IsExact<Ref_Body_style_readonly_14, Auth_Body_style_readonly_14>;
type _assert_Body_style_readonly_14 = Expect<_check_Body_style_readonly_14>;

type Ref_Body_text_15 = () => string;
type Auth_Body_text_15 = () => string;
type _check_Body_text_15 = IsExact<Ref_Body_text_15, Auth_Body_text_15>;
type _assert_Body_text_15 = Expect<_check_Body_text_15>;

type Ref_Body_text_readonly_16 = { readonly value: string };
type Auth_Body_text_readonly_16 = { readonly value: string };
type _check_Body_text_readonly_16 = IsExact<Ref_Body_text_readonly_16, Auth_Body_text_readonly_16>;
type _assert_Body_text_readonly_16 = Expect<_check_Body_text_readonly_16>;

type Ref_Bookmark_name_17 = () => string;
type Auth_Bookmark_name_17 = () => string;
type _check_Bookmark_name_17 = IsExact<Ref_Bookmark_name_17, Auth_Bookmark_name_17>;
type _assert_Bookmark_name_17 = Expect<_check_Bookmark_name_17>;

type Ref_Bookmark_name_readonly_18 = { readonly value: string };
type Auth_Bookmark_name_readonly_18 = { readonly value: string };
type _check_Bookmark_name_readonly_18 = IsExact<Ref_Bookmark_name_readonly_18, Auth_Bookmark_name_readonly_18>;
type _assert_Bookmark_name_readonly_18 = Expect<_check_Bookmark_name_readonly_18>;

type Ref_Bookmark_range_19 = () => DocxEditor.Range;
type Auth_Bookmark_range_19 = () => DocxEditor.Range;
type _check_Bookmark_range_19 = IsExact<Ref_Bookmark_range_19, Auth_Bookmark_range_19>;
type _assert_Bookmark_range_19 = Expect<_check_Bookmark_range_19>;

type Ref_Bookmark_range_readonly_20 = { readonly value: DocxEditor.Range };
type Auth_Bookmark_range_readonly_20 = { readonly value: DocxEditor.Range };
type _check_Bookmark_range_readonly_20 = IsExact<Ref_Bookmark_range_readonly_20, Auth_Bookmark_range_readonly_20>;
type _assert_Bookmark_range_readonly_20 = Expect<_check_Bookmark_range_readonly_20>;

type Ref_Bookmark_select_21 = () => void;
type Auth_Bookmark_select_21 = () => void;
type _check_Bookmark_select_21 = IsExact<Ref_Bookmark_select_21, Auth_Bookmark_select_21>;
type _assert_Bookmark_select_21 = Expect<_check_Bookmark_select_21>;

type Ref_BookmarkCollection_items_22 = () => DocxEditor.Bookmark[];
type Auth_BookmarkCollection_items_22 = () => DocxEditor.Bookmark[];
type _check_BookmarkCollection_items_22 = IsExact<Ref_BookmarkCollection_items_22, Auth_BookmarkCollection_items_22>;
type _assert_BookmarkCollection_items_22 = Expect<_check_BookmarkCollection_items_22>;

type Ref_BookmarkCollection_items_readonly_23 = { readonly value: DocxEditor.Bookmark[] };
type Auth_BookmarkCollection_items_readonly_23 = { readonly value: DocxEditor.Bookmark[] };
type _check_BookmarkCollection_items_readonly_23 = IsExact<Ref_BookmarkCollection_items_readonly_23, Auth_BookmarkCollection_items_readonly_23>;
type _assert_BookmarkCollection_items_readonly_23 = Expect<_check_BookmarkCollection_items_readonly_23>;

type Ref_ClientObject_context_24 = () => DocxEditor.ClientRequestContext;
type Auth_ClientObject_context_24 = () => DocxEditor.ClientRequestContext;
type _check_ClientObject_context_24 = IsExact<Ref_ClientObject_context_24, Auth_ClientObject_context_24>;
type _assert_ClientObject_context_24 = Expect<_check_ClientObject_context_24>;

type Ref_ClientObject_context_readonly_25 = { value: DocxEditor.ClientRequestContext };
type Auth_ClientObject_context_readonly_25 = { value: DocxEditor.ClientRequestContext };
type _check_ClientObject_context_readonly_25 = IsExact<Ref_ClientObject_context_readonly_25, Auth_ClientObject_context_readonly_25>;
type _assert_ClientObject_context_readonly_25 = Expect<_check_ClientObject_context_readonly_25>;

type Ref_ClientObject_isNullObject_26 = () => boolean;
type Auth_ClientObject_isNullObject_26 = () => boolean;
type _check_ClientObject_isNullObject_26 = IsExact<Ref_ClientObject_isNullObject_26, Auth_ClientObject_isNullObject_26>;
type _assert_ClientObject_isNullObject_26 = Expect<_check_ClientObject_isNullObject_26>;

type Ref_ClientObject_isNullObject_readonly_27 = { value: boolean };
type Auth_ClientObject_isNullObject_readonly_27 = { value: boolean };
type _check_ClientObject_isNullObject_readonly_27 = IsExact<Ref_ClientObject_isNullObject_readonly_27, Auth_ClientObject_isNullObject_readonly_27>;
type _assert_ClientObject_isNullObject_readonly_27 = Expect<_check_ClientObject_isNullObject_readonly_27>;

type Ref_Comment_authorName_28 = () => string;
type Auth_Comment_authorName_28 = () => string;
type _check_Comment_authorName_28 = IsExact<Ref_Comment_authorName_28, Auth_Comment_authorName_28>;
type _assert_Comment_authorName_28 = Expect<_check_Comment_authorName_28>;

type Ref_Comment_authorName_readonly_29 = { readonly value: string };
type Auth_Comment_authorName_readonly_29 = { readonly value: string };
type _check_Comment_authorName_readonly_29 = IsExact<Ref_Comment_authorName_readonly_29, Auth_Comment_authorName_readonly_29>;
type _assert_Comment_authorName_readonly_29 = Expect<_check_Comment_authorName_readonly_29>;

type Ref_Comment_creationDate_30 = () => Date;
type Auth_Comment_creationDate_30 = () => Date;
type _check_Comment_creationDate_30 = IsExact<Ref_Comment_creationDate_30, Auth_Comment_creationDate_30>;
type _assert_Comment_creationDate_30 = Expect<_check_Comment_creationDate_30>;

type Ref_Comment_creationDate_readonly_31 = { readonly value: Date };
type Auth_Comment_creationDate_readonly_31 = { readonly value: Date };
type _check_Comment_creationDate_readonly_31 = IsExact<Ref_Comment_creationDate_readonly_31, Auth_Comment_creationDate_readonly_31>;
type _assert_Comment_creationDate_readonly_31 = Expect<_check_Comment_creationDate_readonly_31>;

type Ref_Comment_getRange_32 = () => DocxEditor.Range;
type Auth_Comment_getRange_32 = () => DocxEditor.Range;
type _check_Comment_getRange_32 = IsExact<Ref_Comment_getRange_32, Auth_Comment_getRange_32>;
type _assert_Comment_getRange_32 = Expect<_check_Comment_getRange_32>;

type Ref_Comment_id_33 = () => string;
type Auth_Comment_id_33 = () => string;
type _check_Comment_id_33 = IsExact<Ref_Comment_id_33, Auth_Comment_id_33>;
type _assert_Comment_id_33 = Expect<_check_Comment_id_33>;

type Ref_Comment_id_readonly_34 = { readonly value: string };
type Auth_Comment_id_readonly_34 = { readonly value: string };
type _check_Comment_id_readonly_34 = IsExact<Ref_Comment_id_readonly_34, Auth_Comment_id_readonly_34>;
type _assert_Comment_id_readonly_34 = Expect<_check_Comment_id_readonly_34>;

type Ref_Comment_replies_35 = () => DocxEditor.CommentReplyCollection;
type Auth_Comment_replies_35 = () => DocxEditor.CommentReplyCollection;
type _check_Comment_replies_35 = IsExact<Ref_Comment_replies_35, Auth_Comment_replies_35>;
type _assert_Comment_replies_35 = Expect<_check_Comment_replies_35>;

type Ref_Comment_replies_readonly_36 = { readonly value: DocxEditor.CommentReplyCollection };
type Auth_Comment_replies_readonly_36 = { readonly value: DocxEditor.CommentReplyCollection };
type _check_Comment_replies_readonly_36 = IsExact<Ref_Comment_replies_readonly_36, Auth_Comment_replies_readonly_36>;
type _assert_Comment_replies_readonly_36 = Expect<_check_Comment_replies_readonly_36>;

type Ref_Comment_reply_37 = (replyText: string) => DocxEditor.CommentReply;
type Auth_Comment_reply_37 = (replyText: string) => DocxEditor.CommentReply;
type _check_Comment_reply_37 = IsExact<Ref_Comment_reply_37, Auth_Comment_reply_37>;
type _assert_Comment_reply_37 = Expect<_check_Comment_reply_37>;

type Ref_Comment_resolved_38 = () => boolean;
type Auth_Comment_resolved_38 = () => boolean;
type _check_Comment_resolved_38 = IsExact<Ref_Comment_resolved_38, Auth_Comment_resolved_38>;
type _assert_Comment_resolved_38 = Expect<_check_Comment_resolved_38>;

type Ref_Comment_resolved_readonly_39 = { value: boolean };
type Auth_Comment_resolved_readonly_39 = { value: boolean };
type _check_Comment_resolved_readonly_39 = IsExact<Ref_Comment_resolved_readonly_39, Auth_Comment_resolved_readonly_39>;
type _assert_Comment_resolved_readonly_39 = Expect<_check_Comment_resolved_readonly_39>;

type Ref_CommentCollection_getFirst_40 = () => DocxEditor.Comment;
type Auth_CommentCollection_getFirst_40 = () => DocxEditor.Comment;
type _check_CommentCollection_getFirst_40 = IsExact<Ref_CommentCollection_getFirst_40, Auth_CommentCollection_getFirst_40>;
type _assert_CommentCollection_getFirst_40 = Expect<_check_CommentCollection_getFirst_40>;

type Ref_CommentCollection_items_41 = () => DocxEditor.Comment[];
type Auth_CommentCollection_items_41 = () => DocxEditor.Comment[];
type _check_CommentCollection_items_41 = IsExact<Ref_CommentCollection_items_41, Auth_CommentCollection_items_41>;
type _assert_CommentCollection_items_41 = Expect<_check_CommentCollection_items_41>;

type Ref_CommentCollection_items_readonly_42 = { readonly value: DocxEditor.Comment[] };
type Auth_CommentCollection_items_readonly_42 = { readonly value: DocxEditor.Comment[] };
type _check_CommentCollection_items_readonly_42 = IsExact<Ref_CommentCollection_items_readonly_42, Auth_CommentCollection_items_readonly_42>;
type _assert_CommentCollection_items_readonly_42 = Expect<_check_CommentCollection_items_readonly_42>;

type Ref_CommentReply_authorName_43 = () => string;
type Auth_CommentReply_authorName_43 = () => string;
type _check_CommentReply_authorName_43 = IsExact<Ref_CommentReply_authorName_43, Auth_CommentReply_authorName_43>;
type _assert_CommentReply_authorName_43 = Expect<_check_CommentReply_authorName_43>;

type Ref_CommentReply_authorName_readonly_44 = { readonly value: string };
type Auth_CommentReply_authorName_readonly_44 = { readonly value: string };
type _check_CommentReply_authorName_readonly_44 = IsExact<Ref_CommentReply_authorName_readonly_44, Auth_CommentReply_authorName_readonly_44>;
type _assert_CommentReply_authorName_readonly_44 = Expect<_check_CommentReply_authorName_readonly_44>;

type Ref_CommentReply_creationDate_45 = () => Date;
type Auth_CommentReply_creationDate_45 = () => Date;
type _check_CommentReply_creationDate_45 = IsExact<Ref_CommentReply_creationDate_45, Auth_CommentReply_creationDate_45>;
type _assert_CommentReply_creationDate_45 = Expect<_check_CommentReply_creationDate_45>;

type Ref_CommentReply_creationDate_readonly_46 = { readonly value: Date };
type Auth_CommentReply_creationDate_readonly_46 = { readonly value: Date };
type _check_CommentReply_creationDate_readonly_46 = IsExact<Ref_CommentReply_creationDate_readonly_46, Auth_CommentReply_creationDate_readonly_46>;
type _assert_CommentReply_creationDate_readonly_46 = Expect<_check_CommentReply_creationDate_readonly_46>;

type Ref_CommentReply_id_47 = () => string;
type Auth_CommentReply_id_47 = () => string;
type _check_CommentReply_id_47 = IsExact<Ref_CommentReply_id_47, Auth_CommentReply_id_47>;
type _assert_CommentReply_id_47 = Expect<_check_CommentReply_id_47>;

type Ref_CommentReply_id_readonly_48 = { readonly value: string };
type Auth_CommentReply_id_readonly_48 = { readonly value: string };
type _check_CommentReply_id_readonly_48 = IsExact<Ref_CommentReply_id_readonly_48, Auth_CommentReply_id_readonly_48>;
type _assert_CommentReply_id_readonly_48 = Expect<_check_CommentReply_id_readonly_48>;

type Ref_CommentReplyCollection_getFirst_49 = () => DocxEditor.CommentReply;
type Auth_CommentReplyCollection_getFirst_49 = () => DocxEditor.CommentReply;
type _check_CommentReplyCollection_getFirst_49 = IsExact<Ref_CommentReplyCollection_getFirst_49, Auth_CommentReplyCollection_getFirst_49>;
type _assert_CommentReplyCollection_getFirst_49 = Expect<_check_CommentReplyCollection_getFirst_49>;

type Ref_CommentReplyCollection_items_50 = () => DocxEditor.CommentReply[];
type Auth_CommentReplyCollection_items_50 = () => DocxEditor.CommentReply[];
type _check_CommentReplyCollection_items_50 = IsExact<Ref_CommentReplyCollection_items_50, Auth_CommentReplyCollection_items_50>;
type _assert_CommentReplyCollection_items_50 = Expect<_check_CommentReplyCollection_items_50>;

type Ref_CommentReplyCollection_items_readonly_51 = { readonly value: DocxEditor.CommentReply[] };
type Auth_CommentReplyCollection_items_readonly_51 = { readonly value: DocxEditor.CommentReply[] };
type _check_CommentReplyCollection_items_readonly_51 = IsExact<Ref_CommentReplyCollection_items_readonly_51, Auth_CommentReplyCollection_items_readonly_51>;
type _assert_CommentReplyCollection_items_readonly_51 = Expect<_check_CommentReplyCollection_items_readonly_51>;

type Ref_ContentControl_appearance_52 = () => "BoundingBox" | "Tags" | "Hidden";
type Auth_ContentControl_appearance_52 = () => "BoundingBox" | "Tags" | "Hidden";
type _check_ContentControl_appearance_52 = IsExact<Ref_ContentControl_appearance_52, Auth_ContentControl_appearance_52>;
type _assert_ContentControl_appearance_52 = Expect<_check_ContentControl_appearance_52>;

type Ref_ContentControl_appearance_readonly_53 = { value: "BoundingBox" | "Tags" | "Hidden" };
type Auth_ContentControl_appearance_readonly_53 = { value: "BoundingBox" | "Tags" | "Hidden" };
type _check_ContentControl_appearance_readonly_53 = IsExact<Ref_ContentControl_appearance_readonly_53, Auth_ContentControl_appearance_readonly_53>;
type _assert_ContentControl_appearance_readonly_53 = Expect<_check_ContentControl_appearance_readonly_53>;

type Ref_ContentControl_cannotDelete_54 = () => boolean;
type Auth_ContentControl_cannotDelete_54 = () => boolean;
type _check_ContentControl_cannotDelete_54 = IsExact<Ref_ContentControl_cannotDelete_54, Auth_ContentControl_cannotDelete_54>;
type _assert_ContentControl_cannotDelete_54 = Expect<_check_ContentControl_cannotDelete_54>;

type Ref_ContentControl_cannotDelete_readonly_55 = { value: boolean };
type Auth_ContentControl_cannotDelete_readonly_55 = { value: boolean };
type _check_ContentControl_cannotDelete_readonly_55 = IsExact<Ref_ContentControl_cannotDelete_readonly_55, Auth_ContentControl_cannotDelete_readonly_55>;
type _assert_ContentControl_cannotDelete_readonly_55 = Expect<_check_ContentControl_cannotDelete_readonly_55>;

type Ref_ContentControl_cannotEdit_56 = () => boolean;
type Auth_ContentControl_cannotEdit_56 = () => boolean;
type _check_ContentControl_cannotEdit_56 = IsExact<Ref_ContentControl_cannotEdit_56, Auth_ContentControl_cannotEdit_56>;
type _assert_ContentControl_cannotEdit_56 = Expect<_check_ContentControl_cannotEdit_56>;

type Ref_ContentControl_cannotEdit_readonly_57 = { value: boolean };
type Auth_ContentControl_cannotEdit_readonly_57 = { value: boolean };
type _check_ContentControl_cannotEdit_readonly_57 = IsExact<Ref_ContentControl_cannotEdit_readonly_57, Auth_ContentControl_cannotEdit_readonly_57>;
type _assert_ContentControl_cannotEdit_readonly_57 = Expect<_check_ContentControl_cannotEdit_readonly_57>;

type Ref_ContentControl_color_58 = () => string;
type Auth_ContentControl_color_58 = () => string;
type _check_ContentControl_color_58 = IsExact<Ref_ContentControl_color_58, Auth_ContentControl_color_58>;
type _assert_ContentControl_color_58 = Expect<_check_ContentControl_color_58>;

type Ref_ContentControl_color_readonly_59 = { value: string };
type Auth_ContentControl_color_readonly_59 = { value: string };
type _check_ContentControl_color_readonly_59 = IsExact<Ref_ContentControl_color_readonly_59, Auth_ContentControl_color_readonly_59>;
type _assert_ContentControl_color_readonly_59 = Expect<_check_ContentControl_color_readonly_59>;

type Ref_ContentControl_contentControls_60 = () => DocxEditor.ContentControlCollection;
type Auth_ContentControl_contentControls_60 = () => DocxEditor.ContentControlCollection;
type _check_ContentControl_contentControls_60 = IsExact<Ref_ContentControl_contentControls_60, Auth_ContentControl_contentControls_60>;
type _assert_ContentControl_contentControls_60 = Expect<_check_ContentControl_contentControls_60>;

type Ref_ContentControl_contentControls_readonly_61 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_ContentControl_contentControls_readonly_61 = { readonly value: DocxEditor.ContentControlCollection };
type _check_ContentControl_contentControls_readonly_61 = IsExact<Ref_ContentControl_contentControls_readonly_61, Auth_ContentControl_contentControls_readonly_61>;
type _assert_ContentControl_contentControls_readonly_61 = Expect<_check_ContentControl_contentControls_readonly_61>;

type Ref_ContentControl_delete_62 = (keepContent: boolean) => void;
type Auth_ContentControl_delete_62 = (keepContent: boolean) => void;
type _check_ContentControl_delete_62 = IsExact<Ref_ContentControl_delete_62, Auth_ContentControl_delete_62>;
type _assert_ContentControl_delete_62 = Expect<_check_ContentControl_delete_62>;

type Ref_ContentControl_getRange_63 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type Auth_ContentControl_getRange_63 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type _check_ContentControl_getRange_63 = IsExact<Ref_ContentControl_getRange_63, Auth_ContentControl_getRange_63>;
type _assert_ContentControl_getRange_63 = Expect<_check_ContentControl_getRange_63>;

type Ref_ContentControl_id_64 = () => number;
type Auth_ContentControl_id_64 = () => number;
type _check_ContentControl_id_64 = IsExact<Ref_ContentControl_id_64, Auth_ContentControl_id_64>;
type _assert_ContentControl_id_64 = Expect<_check_ContentControl_id_64>;

type Ref_ContentControl_id_readonly_65 = { readonly value: number };
type Auth_ContentControl_id_readonly_65 = { readonly value: number };
type _check_ContentControl_id_readonly_65 = IsExact<Ref_ContentControl_id_readonly_65, Auth_ContentControl_id_readonly_65>;
type _assert_ContentControl_id_readonly_65 = Expect<_check_ContentControl_id_readonly_65>;

type Ref_ContentControl_insertText_66 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_ContentControl_insertText_66 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_ContentControl_insertText_66 = IsExact<Ref_ContentControl_insertText_66, Auth_ContentControl_insertText_66>;
type _assert_ContentControl_insertText_66 = Expect<_check_ContentControl_insertText_66>;

type Ref_ContentControl_paragraphs_67 = () => DocxEditor.ParagraphCollection;
type Auth_ContentControl_paragraphs_67 = () => DocxEditor.ParagraphCollection;
type _check_ContentControl_paragraphs_67 = IsExact<Ref_ContentControl_paragraphs_67, Auth_ContentControl_paragraphs_67>;
type _assert_ContentControl_paragraphs_67 = Expect<_check_ContentControl_paragraphs_67>;

type Ref_ContentControl_paragraphs_readonly_68 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_ContentControl_paragraphs_readonly_68 = { readonly value: DocxEditor.ParagraphCollection };
type _check_ContentControl_paragraphs_readonly_68 = IsExact<Ref_ContentControl_paragraphs_readonly_68, Auth_ContentControl_paragraphs_readonly_68>;
type _assert_ContentControl_paragraphs_readonly_68 = Expect<_check_ContentControl_paragraphs_readonly_68>;

type Ref_ContentControl_placeholderText_69 = () => string;
type Auth_ContentControl_placeholderText_69 = () => string;
type _check_ContentControl_placeholderText_69 = IsExact<Ref_ContentControl_placeholderText_69, Auth_ContentControl_placeholderText_69>;
type _assert_ContentControl_placeholderText_69 = Expect<_check_ContentControl_placeholderText_69>;

type Ref_ContentControl_placeholderText_readonly_70 = { value: string };
type Auth_ContentControl_placeholderText_readonly_70 = { value: string };
type _check_ContentControl_placeholderText_readonly_70 = IsExact<Ref_ContentControl_placeholderText_readonly_70, Auth_ContentControl_placeholderText_readonly_70>;
type _assert_ContentControl_placeholderText_readonly_70 = Expect<_check_ContentControl_placeholderText_readonly_70>;

type Ref_ContentControl_subtype_71 = () => "Unknown" | "RichTextInline" | "RichTextParagraphs" | "RichTextTableCell" | "RichTextTableRow" | "RichTextTable" | "PlainTextInline" | "PlainTextParagraph" | "Picture" | "BuildingBlockGallery" | "CheckBox" | "ComboBox" | "DropDownList" | "DatePicker" | "RepeatingSection" | "RichText" | "PlainText" | "Group";
type Auth_ContentControl_subtype_71 = () => "Unknown" | "RichTextInline" | "RichTextParagraphs" | "RichTextTableCell" | "RichTextTableRow" | "RichTextTable" | "PlainTextInline" | "PlainTextParagraph" | "Picture" | "BuildingBlockGallery" | "CheckBox" | "ComboBox" | "DropDownList" | "DatePicker" | "RepeatingSection" | "RichText" | "PlainText" | "Group";
type _check_ContentControl_subtype_71 = IsExact<Ref_ContentControl_subtype_71, Auth_ContentControl_subtype_71>;
type _assert_ContentControl_subtype_71 = Expect<_check_ContentControl_subtype_71>;

type Ref_ContentControl_subtype_readonly_72 = { readonly value: "Unknown" | "RichTextInline" | "RichTextParagraphs" | "RichTextTableCell" | "RichTextTableRow" | "RichTextTable" | "PlainTextInline" | "PlainTextParagraph" | "Picture" | "BuildingBlockGallery" | "CheckBox" | "ComboBox" | "DropDownList" | "DatePicker" | "RepeatingSection" | "RichText" | "PlainText" | "Group" };
type Auth_ContentControl_subtype_readonly_72 = { readonly value: "Unknown" | "RichTextInline" | "RichTextParagraphs" | "RichTextTableCell" | "RichTextTableRow" | "RichTextTable" | "PlainTextInline" | "PlainTextParagraph" | "Picture" | "BuildingBlockGallery" | "CheckBox" | "ComboBox" | "DropDownList" | "DatePicker" | "RepeatingSection" | "RichText" | "PlainText" | "Group" };
type _check_ContentControl_subtype_readonly_72 = IsExact<Ref_ContentControl_subtype_readonly_72, Auth_ContentControl_subtype_readonly_72>;
type _assert_ContentControl_subtype_readonly_72 = Expect<_check_ContentControl_subtype_readonly_72>;

type Ref_ContentControl_tag_73 = () => string;
type Auth_ContentControl_tag_73 = () => string;
type _check_ContentControl_tag_73 = IsExact<Ref_ContentControl_tag_73, Auth_ContentControl_tag_73>;
type _assert_ContentControl_tag_73 = Expect<_check_ContentControl_tag_73>;

type Ref_ContentControl_tag_readonly_74 = { value: string };
type Auth_ContentControl_tag_readonly_74 = { value: string };
type _check_ContentControl_tag_readonly_74 = IsExact<Ref_ContentControl_tag_readonly_74, Auth_ContentControl_tag_readonly_74>;
type _assert_ContentControl_tag_readonly_74 = Expect<_check_ContentControl_tag_readonly_74>;

type Ref_ContentControl_text_75 = () => string;
type Auth_ContentControl_text_75 = () => string;
type _check_ContentControl_text_75 = IsExact<Ref_ContentControl_text_75, Auth_ContentControl_text_75>;
type _assert_ContentControl_text_75 = Expect<_check_ContentControl_text_75>;

type Ref_ContentControl_text_readonly_76 = { readonly value: string };
type Auth_ContentControl_text_readonly_76 = { readonly value: string };
type _check_ContentControl_text_readonly_76 = IsExact<Ref_ContentControl_text_readonly_76, Auth_ContentControl_text_readonly_76>;
type _assert_ContentControl_text_readonly_76 = Expect<_check_ContentControl_text_readonly_76>;

type Ref_ContentControl_title_77 = () => string;
type Auth_ContentControl_title_77 = () => string;
type _check_ContentControl_title_77 = IsExact<Ref_ContentControl_title_77, Auth_ContentControl_title_77>;
type _assert_ContentControl_title_77 = Expect<_check_ContentControl_title_77>;

type Ref_ContentControl_title_readonly_78 = { value: string };
type Auth_ContentControl_title_readonly_78 = { value: string };
type _check_ContentControl_title_readonly_78 = IsExact<Ref_ContentControl_title_readonly_78, Auth_ContentControl_title_readonly_78>;
type _assert_ContentControl_title_readonly_78 = Expect<_check_ContentControl_title_readonly_78>;

type Ref_ContentControlCollection_getById_79 = (id: number) => DocxEditor.ContentControl;
type Auth_ContentControlCollection_getById_79 = (id: number) => DocxEditor.ContentControl;
type _check_ContentControlCollection_getById_79 = IsExact<Ref_ContentControlCollection_getById_79, Auth_ContentControlCollection_getById_79>;
type _assert_ContentControlCollection_getById_79 = Expect<_check_ContentControlCollection_getById_79>;

type Ref_ContentControlCollection_items_80 = () => DocxEditor.ContentControl[];
type Auth_ContentControlCollection_items_80 = () => DocxEditor.ContentControl[];
type _check_ContentControlCollection_items_80 = IsExact<Ref_ContentControlCollection_items_80, Auth_ContentControlCollection_items_80>;
type _assert_ContentControlCollection_items_80 = Expect<_check_ContentControlCollection_items_80>;

type Ref_ContentControlCollection_items_readonly_81 = { readonly value: DocxEditor.ContentControl[] };
type Auth_ContentControlCollection_items_readonly_81 = { readonly value: DocxEditor.ContentControl[] };
type _check_ContentControlCollection_items_readonly_81 = IsExact<Ref_ContentControlCollection_items_readonly_81, Auth_ContentControlCollection_items_readonly_81>;
type _assert_ContentControlCollection_items_readonly_81 = Expect<_check_ContentControlCollection_items_readonly_81>;

type Ref_Document_body_82 = () => DocxEditor.Body;
type Auth_Document_body_82 = () => DocxEditor.Body;
type _check_Document_body_82 = IsExact<Ref_Document_body_82, Auth_Document_body_82>;
type _assert_Document_body_82 = Expect<_check_Document_body_82>;

type Ref_Document_body_readonly_83 = { readonly value: DocxEditor.Body };
type Auth_Document_body_readonly_83 = { readonly value: DocxEditor.Body };
type _check_Document_body_readonly_83 = IsExact<Ref_Document_body_readonly_83, Auth_Document_body_readonly_83>;
type _assert_Document_body_readonly_83 = Expect<_check_Document_body_readonly_83>;

type Ref_Document_comments_84 = () => DocxEditor.CommentCollection;
type Auth_Document_comments_84 = () => DocxEditor.CommentCollection;
type _check_Document_comments_84 = IsExact<Ref_Document_comments_84, Auth_Document_comments_84>;
type _assert_Document_comments_84 = Expect<_check_Document_comments_84>;

type Ref_Document_comments_readonly_85 = { readonly value: DocxEditor.CommentCollection };
type Auth_Document_comments_readonly_85 = { readonly value: DocxEditor.CommentCollection };
type _check_Document_comments_readonly_85 = IsExact<Ref_Document_comments_readonly_85, Auth_Document_comments_readonly_85>;
type _assert_Document_comments_readonly_85 = Expect<_check_Document_comments_readonly_85>;

type Ref_Document_contentControls_86 = () => DocxEditor.ContentControlCollection;
type Auth_Document_contentControls_86 = () => DocxEditor.ContentControlCollection;
type _check_Document_contentControls_86 = IsExact<Ref_Document_contentControls_86, Auth_Document_contentControls_86>;
type _assert_Document_contentControls_86 = Expect<_check_Document_contentControls_86>;

type Ref_Document_contentControls_readonly_87 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Document_contentControls_readonly_87 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Document_contentControls_readonly_87 = IsExact<Ref_Document_contentControls_readonly_87, Auth_Document_contentControls_readonly_87>;
type _assert_Document_contentControls_readonly_87 = Expect<_check_Document_contentControls_readonly_87>;

type Ref_Document_paragraphs_88 = () => DocxEditor.ParagraphCollection;
type Auth_Document_paragraphs_88 = () => DocxEditor.ParagraphCollection;
type _check_Document_paragraphs_88 = IsExact<Ref_Document_paragraphs_88, Auth_Document_paragraphs_88>;
type _assert_Document_paragraphs_88 = Expect<_check_Document_paragraphs_88>;

type Ref_Document_paragraphs_readonly_89 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Document_paragraphs_readonly_89 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Document_paragraphs_readonly_89 = IsExact<Ref_Document_paragraphs_readonly_89, Auth_Document_paragraphs_readonly_89>;
type _assert_Document_paragraphs_readonly_89 = Expect<_check_Document_paragraphs_readonly_89>;

type Ref_Document_revisions_90 = () => DocxEditor.RevisionCollection;
type Auth_Document_revisions_90 = () => DocxEditor.RevisionCollection;
type _check_Document_revisions_90 = IsExact<Ref_Document_revisions_90, Auth_Document_revisions_90>;
type _assert_Document_revisions_90 = Expect<_check_Document_revisions_90>;

type Ref_Document_revisions_readonly_91 = { readonly value: DocxEditor.RevisionCollection };
type Auth_Document_revisions_readonly_91 = { readonly value: DocxEditor.RevisionCollection };
type _check_Document_revisions_readonly_91 = IsExact<Ref_Document_revisions_readonly_91, Auth_Document_revisions_readonly_91>;
type _assert_Document_revisions_readonly_91 = Expect<_check_Document_revisions_readonly_91>;

type Ref_Document_sections_92 = () => DocxEditor.SectionCollection;
type Auth_Document_sections_92 = () => DocxEditor.SectionCollection;
type _check_Document_sections_92 = IsExact<Ref_Document_sections_92, Auth_Document_sections_92>;
type _assert_Document_sections_92 = Expect<_check_Document_sections_92>;

type Ref_Document_sections_readonly_93 = { readonly value: DocxEditor.SectionCollection };
type Auth_Document_sections_readonly_93 = { readonly value: DocxEditor.SectionCollection };
type _check_Document_sections_readonly_93 = IsExact<Ref_Document_sections_readonly_93, Auth_Document_sections_readonly_93>;
type _assert_Document_sections_readonly_93 = Expect<_check_Document_sections_readonly_93>;

type Ref_Font_bold_94 = () => boolean;
type Auth_Font_bold_94 = () => boolean;
type _check_Font_bold_94 = IsExact<Ref_Font_bold_94, Auth_Font_bold_94>;
type _assert_Font_bold_94 = Expect<_check_Font_bold_94>;

type Ref_Font_bold_readonly_95 = { value: boolean };
type Auth_Font_bold_readonly_95 = { value: boolean };
type _check_Font_bold_readonly_95 = IsExact<Ref_Font_bold_readonly_95, Auth_Font_bold_readonly_95>;
type _assert_Font_bold_readonly_95 = Expect<_check_Font_bold_readonly_95>;

type Ref_Font_color_96 = () => string;
type Auth_Font_color_96 = () => string;
type _check_Font_color_96 = IsExact<Ref_Font_color_96, Auth_Font_color_96>;
type _assert_Font_color_96 = Expect<_check_Font_color_96>;

type Ref_Font_color_readonly_97 = { value: string };
type Auth_Font_color_readonly_97 = { value: string };
type _check_Font_color_readonly_97 = IsExact<Ref_Font_color_readonly_97, Auth_Font_color_readonly_97>;
type _assert_Font_color_readonly_97 = Expect<_check_Font_color_readonly_97>;

type Ref_Font_italic_98 = () => boolean;
type Auth_Font_italic_98 = () => boolean;
type _check_Font_italic_98 = IsExact<Ref_Font_italic_98, Auth_Font_italic_98>;
type _assert_Font_italic_98 = Expect<_check_Font_italic_98>;

type Ref_Font_italic_readonly_99 = { value: boolean };
type Auth_Font_italic_readonly_99 = { value: boolean };
type _check_Font_italic_readonly_99 = IsExact<Ref_Font_italic_readonly_99, Auth_Font_italic_readonly_99>;
type _assert_Font_italic_readonly_99 = Expect<_check_Font_italic_readonly_99>;

type Ref_Font_name_100 = () => string;
type Auth_Font_name_100 = () => string;
type _check_Font_name_100 = IsExact<Ref_Font_name_100, Auth_Font_name_100>;
type _assert_Font_name_100 = Expect<_check_Font_name_100>;

type Ref_Font_name_readonly_101 = { value: string };
type Auth_Font_name_readonly_101 = { value: string };
type _check_Font_name_readonly_101 = IsExact<Ref_Font_name_readonly_101, Auth_Font_name_readonly_101>;
type _assert_Font_name_readonly_101 = Expect<_check_Font_name_readonly_101>;

type Ref_Font_size_102 = () => number;
type Auth_Font_size_102 = () => number;
type _check_Font_size_102 = IsExact<Ref_Font_size_102, Auth_Font_size_102>;
type _assert_Font_size_102 = Expect<_check_Font_size_102>;

type Ref_Font_size_readonly_103 = { value: number };
type Auth_Font_size_readonly_103 = { value: number };
type _check_Font_size_readonly_103 = IsExact<Ref_Font_size_readonly_103, Auth_Font_size_readonly_103>;
type _assert_Font_size_readonly_103 = Expect<_check_Font_size_readonly_103>;

type Ref_List_getLevelParagraphs_104 = (level: number) => DocxEditor.ParagraphCollection;
type Auth_List_getLevelParagraphs_104 = (level: number) => DocxEditor.ParagraphCollection;
type _check_List_getLevelParagraphs_104 = IsExact<Ref_List_getLevelParagraphs_104, Auth_List_getLevelParagraphs_104>;
type _assert_List_getLevelParagraphs_104 = Expect<_check_List_getLevelParagraphs_104>;

type Ref_List_id_105 = () => number;
type Auth_List_id_105 = () => number;
type _check_List_id_105 = IsExact<Ref_List_id_105, Auth_List_id_105>;
type _assert_List_id_105 = Expect<_check_List_id_105>;

type Ref_List_id_readonly_106 = { readonly value: number };
type Auth_List_id_readonly_106 = { readonly value: number };
type _check_List_id_readonly_106 = IsExact<Ref_List_id_readonly_106, Auth_List_id_readonly_106>;
type _assert_List_id_readonly_106 = Expect<_check_List_id_readonly_106>;

type Ref_List_insertParagraph_107 = (paragraphText: string, insertLocation: "Start" | "End" | "Before" | "After") => DocxEditor.Paragraph;
type Auth_List_insertParagraph_107 = (paragraphText: string, insertLocation: "Start" | "End" | "Before" | "After") => DocxEditor.Paragraph;
type _check_List_insertParagraph_107 = IsExact<Ref_List_insertParagraph_107, Auth_List_insertParagraph_107>;
type _assert_List_insertParagraph_107 = Expect<_check_List_insertParagraph_107>;

type Ref_List_paragraphs_108 = () => DocxEditor.ParagraphCollection;
type Auth_List_paragraphs_108 = () => DocxEditor.ParagraphCollection;
type _check_List_paragraphs_108 = IsExact<Ref_List_paragraphs_108, Auth_List_paragraphs_108>;
type _assert_List_paragraphs_108 = Expect<_check_List_paragraphs_108>;

type Ref_List_paragraphs_readonly_109 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_List_paragraphs_readonly_109 = { readonly value: DocxEditor.ParagraphCollection };
type _check_List_paragraphs_readonly_109 = IsExact<Ref_List_paragraphs_readonly_109, Auth_List_paragraphs_readonly_109>;
type _assert_List_paragraphs_readonly_109 = Expect<_check_List_paragraphs_readonly_109>;

type Ref_ListCollection_getById_110 = (id: number) => DocxEditor.List;
type Auth_ListCollection_getById_110 = (id: number) => DocxEditor.List;
type _check_ListCollection_getById_110 = IsExact<Ref_ListCollection_getById_110, Auth_ListCollection_getById_110>;
type _assert_ListCollection_getById_110 = Expect<_check_ListCollection_getById_110>;

type Ref_ListCollection_getFirst_111 = () => DocxEditor.List;
type Auth_ListCollection_getFirst_111 = () => DocxEditor.List;
type _check_ListCollection_getFirst_111 = IsExact<Ref_ListCollection_getFirst_111, Auth_ListCollection_getFirst_111>;
type _assert_ListCollection_getFirst_111 = Expect<_check_ListCollection_getFirst_111>;

type Ref_ListCollection_items_112 = () => DocxEditor.List[];
type Auth_ListCollection_items_112 = () => DocxEditor.List[];
type _check_ListCollection_items_112 = IsExact<Ref_ListCollection_items_112, Auth_ListCollection_items_112>;
type _assert_ListCollection_items_112 = Expect<_check_ListCollection_items_112>;

type Ref_ListCollection_items_readonly_113 = { readonly value: DocxEditor.List[] };
type Auth_ListCollection_items_readonly_113 = { readonly value: DocxEditor.List[] };
type _check_ListCollection_items_readonly_113 = IsExact<Ref_ListCollection_items_readonly_113, Auth_ListCollection_items_readonly_113>;
type _assert_ListCollection_items_readonly_113 = Expect<_check_ListCollection_items_readonly_113>;

type Ref_ListItem_level_114 = () => number;
type Auth_ListItem_level_114 = () => number;
type _check_ListItem_level_114 = IsExact<Ref_ListItem_level_114, Auth_ListItem_level_114>;
type _assert_ListItem_level_114 = Expect<_check_ListItem_level_114>;

type Ref_ListItem_level_readonly_115 = { value: number };
type Auth_ListItem_level_readonly_115 = { value: number };
type _check_ListItem_level_readonly_115 = IsExact<Ref_ListItem_level_readonly_115, Auth_ListItem_level_readonly_115>;
type _assert_ListItem_level_readonly_115 = Expect<_check_ListItem_level_readonly_115>;

type Ref_NoteItem_body_116 = () => DocxEditor.Body;
type Auth_NoteItem_body_116 = () => DocxEditor.Body;
type _check_NoteItem_body_116 = IsExact<Ref_NoteItem_body_116, Auth_NoteItem_body_116>;
type _assert_NoteItem_body_116 = Expect<_check_NoteItem_body_116>;

type Ref_NoteItem_body_readonly_117 = { readonly value: DocxEditor.Body };
type Auth_NoteItem_body_readonly_117 = { readonly value: DocxEditor.Body };
type _check_NoteItem_body_readonly_117 = IsExact<Ref_NoteItem_body_readonly_117, Auth_NoteItem_body_readonly_117>;
type _assert_NoteItem_body_readonly_117 = Expect<_check_NoteItem_body_readonly_117>;

type Ref_NoteItem_delete_118 = () => void;
type Auth_NoteItem_delete_118 = () => void;
type _check_NoteItem_delete_118 = IsExact<Ref_NoteItem_delete_118, Auth_NoteItem_delete_118>;
type _assert_NoteItem_delete_118 = Expect<_check_NoteItem_delete_118>;

type Ref_NoteItem_getNext_119 = () => DocxEditor.NoteItem;
type Auth_NoteItem_getNext_119 = () => DocxEditor.NoteItem;
type _check_NoteItem_getNext_119 = IsExact<Ref_NoteItem_getNext_119, Auth_NoteItem_getNext_119>;
type _assert_NoteItem_getNext_119 = Expect<_check_NoteItem_getNext_119>;

type Ref_NoteItem_type_120 = () => "Footnote" | "Endnote";
type Auth_NoteItem_type_120 = () => "Footnote" | "Endnote";
type _check_NoteItem_type_120 = IsExact<Ref_NoteItem_type_120, Auth_NoteItem_type_120>;
type _assert_NoteItem_type_120 = Expect<_check_NoteItem_type_120>;

type Ref_NoteItem_type_readonly_121 = { readonly value: "Footnote" | "Endnote" };
type Auth_NoteItem_type_readonly_121 = { readonly value: "Footnote" | "Endnote" };
type _check_NoteItem_type_readonly_121 = IsExact<Ref_NoteItem_type_readonly_121, Auth_NoteItem_type_readonly_121>;
type _assert_NoteItem_type_readonly_121 = Expect<_check_NoteItem_type_readonly_121>;

type Ref_NoteItemCollection_getFirst_122 = () => DocxEditor.NoteItem;
type Auth_NoteItemCollection_getFirst_122 = () => DocxEditor.NoteItem;
type _check_NoteItemCollection_getFirst_122 = IsExact<Ref_NoteItemCollection_getFirst_122, Auth_NoteItemCollection_getFirst_122>;
type _assert_NoteItemCollection_getFirst_122 = Expect<_check_NoteItemCollection_getFirst_122>;

type Ref_NoteItemCollection_items_123 = () => DocxEditor.NoteItem[];
type Auth_NoteItemCollection_items_123 = () => DocxEditor.NoteItem[];
type _check_NoteItemCollection_items_123 = IsExact<Ref_NoteItemCollection_items_123, Auth_NoteItemCollection_items_123>;
type _assert_NoteItemCollection_items_123 = Expect<_check_NoteItemCollection_items_123>;

type Ref_NoteItemCollection_items_readonly_124 = { readonly value: DocxEditor.NoteItem[] };
type Auth_NoteItemCollection_items_readonly_124 = { readonly value: DocxEditor.NoteItem[] };
type _check_NoteItemCollection_items_readonly_124 = IsExact<Ref_NoteItemCollection_items_readonly_124, Auth_NoteItemCollection_items_readonly_124>;
type _assert_NoteItemCollection_items_readonly_124 = Expect<_check_NoteItemCollection_items_readonly_124>;

type Ref_PageSetup_bottomMargin_125 = () => number;
type Auth_PageSetup_bottomMargin_125 = () => number;
type _check_PageSetup_bottomMargin_125 = IsExact<Ref_PageSetup_bottomMargin_125, Auth_PageSetup_bottomMargin_125>;
type _assert_PageSetup_bottomMargin_125 = Expect<_check_PageSetup_bottomMargin_125>;

type Ref_PageSetup_bottomMargin_readonly_126 = { value: number };
type Auth_PageSetup_bottomMargin_readonly_126 = { value: number };
type _check_PageSetup_bottomMargin_readonly_126 = IsExact<Ref_PageSetup_bottomMargin_readonly_126, Auth_PageSetup_bottomMargin_readonly_126>;
type _assert_PageSetup_bottomMargin_readonly_126 = Expect<_check_PageSetup_bottomMargin_readonly_126>;

type Ref_PageSetup_leftMargin_127 = () => number;
type Auth_PageSetup_leftMargin_127 = () => number;
type _check_PageSetup_leftMargin_127 = IsExact<Ref_PageSetup_leftMargin_127, Auth_PageSetup_leftMargin_127>;
type _assert_PageSetup_leftMargin_127 = Expect<_check_PageSetup_leftMargin_127>;

type Ref_PageSetup_leftMargin_readonly_128 = { value: number };
type Auth_PageSetup_leftMargin_readonly_128 = { value: number };
type _check_PageSetup_leftMargin_readonly_128 = IsExact<Ref_PageSetup_leftMargin_readonly_128, Auth_PageSetup_leftMargin_readonly_128>;
type _assert_PageSetup_leftMargin_readonly_128 = Expect<_check_PageSetup_leftMargin_readonly_128>;

type Ref_PageSetup_orientation_129 = () => "Portrait" | "Landscape";
type Auth_PageSetup_orientation_129 = () => "Portrait" | "Landscape";
type _check_PageSetup_orientation_129 = IsExact<Ref_PageSetup_orientation_129, Auth_PageSetup_orientation_129>;
type _assert_PageSetup_orientation_129 = Expect<_check_PageSetup_orientation_129>;

type Ref_PageSetup_orientation_readonly_130 = { value: "Portrait" | "Landscape" };
type Auth_PageSetup_orientation_readonly_130 = { value: "Portrait" | "Landscape" };
type _check_PageSetup_orientation_readonly_130 = IsExact<Ref_PageSetup_orientation_readonly_130, Auth_PageSetup_orientation_readonly_130>;
type _assert_PageSetup_orientation_readonly_130 = Expect<_check_PageSetup_orientation_readonly_130>;

type Ref_PageSetup_pageHeight_131 = () => number;
type Auth_PageSetup_pageHeight_131 = () => number;
type _check_PageSetup_pageHeight_131 = IsExact<Ref_PageSetup_pageHeight_131, Auth_PageSetup_pageHeight_131>;
type _assert_PageSetup_pageHeight_131 = Expect<_check_PageSetup_pageHeight_131>;

type Ref_PageSetup_pageHeight_readonly_132 = { value: number };
type Auth_PageSetup_pageHeight_readonly_132 = { value: number };
type _check_PageSetup_pageHeight_readonly_132 = IsExact<Ref_PageSetup_pageHeight_readonly_132, Auth_PageSetup_pageHeight_readonly_132>;
type _assert_PageSetup_pageHeight_readonly_132 = Expect<_check_PageSetup_pageHeight_readonly_132>;

type Ref_PageSetup_pageWidth_133 = () => number;
type Auth_PageSetup_pageWidth_133 = () => number;
type _check_PageSetup_pageWidth_133 = IsExact<Ref_PageSetup_pageWidth_133, Auth_PageSetup_pageWidth_133>;
type _assert_PageSetup_pageWidth_133 = Expect<_check_PageSetup_pageWidth_133>;

type Ref_PageSetup_pageWidth_readonly_134 = { value: number };
type Auth_PageSetup_pageWidth_readonly_134 = { value: number };
type _check_PageSetup_pageWidth_readonly_134 = IsExact<Ref_PageSetup_pageWidth_readonly_134, Auth_PageSetup_pageWidth_readonly_134>;
type _assert_PageSetup_pageWidth_readonly_134 = Expect<_check_PageSetup_pageWidth_readonly_134>;

type Ref_PageSetup_rightMargin_135 = () => number;
type Auth_PageSetup_rightMargin_135 = () => number;
type _check_PageSetup_rightMargin_135 = IsExact<Ref_PageSetup_rightMargin_135, Auth_PageSetup_rightMargin_135>;
type _assert_PageSetup_rightMargin_135 = Expect<_check_PageSetup_rightMargin_135>;

type Ref_PageSetup_rightMargin_readonly_136 = { value: number };
type Auth_PageSetup_rightMargin_readonly_136 = { value: number };
type _check_PageSetup_rightMargin_readonly_136 = IsExact<Ref_PageSetup_rightMargin_readonly_136, Auth_PageSetup_rightMargin_readonly_136>;
type _assert_PageSetup_rightMargin_readonly_136 = Expect<_check_PageSetup_rightMargin_readonly_136>;

type Ref_PageSetup_topMargin_137 = () => number;
type Auth_PageSetup_topMargin_137 = () => number;
type _check_PageSetup_topMargin_137 = IsExact<Ref_PageSetup_topMargin_137, Auth_PageSetup_topMargin_137>;
type _assert_PageSetup_topMargin_137 = Expect<_check_PageSetup_topMargin_137>;

type Ref_PageSetup_topMargin_readonly_138 = { value: number };
type Auth_PageSetup_topMargin_readonly_138 = { value: number };
type _check_PageSetup_topMargin_readonly_138 = IsExact<Ref_PageSetup_topMargin_readonly_138, Auth_PageSetup_topMargin_readonly_138>;
type _assert_PageSetup_topMargin_readonly_138 = Expect<_check_PageSetup_topMargin_readonly_138>;

type Ref_Paragraph_alignment_139 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type Auth_Paragraph_alignment_139 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type _check_Paragraph_alignment_139 = IsExact<Ref_Paragraph_alignment_139, Auth_Paragraph_alignment_139>;
type _assert_Paragraph_alignment_139 = Expect<_check_Paragraph_alignment_139>;

type Ref_Paragraph_alignment_readonly_140 = { value: "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified" };
type Auth_Paragraph_alignment_readonly_140 = { value: "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified" };
type _check_Paragraph_alignment_readonly_140 = IsExact<Ref_Paragraph_alignment_readonly_140, Auth_Paragraph_alignment_readonly_140>;
type _assert_Paragraph_alignment_readonly_140 = Expect<_check_Paragraph_alignment_readonly_140>;

type Ref_Paragraph_clear_141 = () => void;
type Auth_Paragraph_clear_141 = () => void;
type _check_Paragraph_clear_141 = IsExact<Ref_Paragraph_clear_141, Auth_Paragraph_clear_141>;
type _assert_Paragraph_clear_141 = Expect<_check_Paragraph_clear_141>;

type Ref_Paragraph_contentControls_142 = () => DocxEditor.ContentControlCollection;
type Auth_Paragraph_contentControls_142 = () => DocxEditor.ContentControlCollection;
type _check_Paragraph_contentControls_142 = IsExact<Ref_Paragraph_contentControls_142, Auth_Paragraph_contentControls_142>;
type _assert_Paragraph_contentControls_142 = Expect<_check_Paragraph_contentControls_142>;

type Ref_Paragraph_contentControls_readonly_143 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Paragraph_contentControls_readonly_143 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Paragraph_contentControls_readonly_143 = IsExact<Ref_Paragraph_contentControls_readonly_143, Auth_Paragraph_contentControls_readonly_143>;
type _assert_Paragraph_contentControls_readonly_143 = Expect<_check_Paragraph_contentControls_readonly_143>;

type Ref_Paragraph_delete_144 = () => void;
type Auth_Paragraph_delete_144 = () => void;
type _check_Paragraph_delete_144 = IsExact<Ref_Paragraph_delete_144, Auth_Paragraph_delete_144>;
type _assert_Paragraph_delete_144 = Expect<_check_Paragraph_delete_144>;

type Ref_Paragraph_firstLineIndent_145 = () => number;
type Auth_Paragraph_firstLineIndent_145 = () => number;
type _check_Paragraph_firstLineIndent_145 = IsExact<Ref_Paragraph_firstLineIndent_145, Auth_Paragraph_firstLineIndent_145>;
type _assert_Paragraph_firstLineIndent_145 = Expect<_check_Paragraph_firstLineIndent_145>;

type Ref_Paragraph_firstLineIndent_readonly_146 = { value: number };
type Auth_Paragraph_firstLineIndent_readonly_146 = { value: number };
type _check_Paragraph_firstLineIndent_readonly_146 = IsExact<Ref_Paragraph_firstLineIndent_readonly_146, Auth_Paragraph_firstLineIndent_readonly_146>;
type _assert_Paragraph_firstLineIndent_readonly_146 = Expect<_check_Paragraph_firstLineIndent_readonly_146>;

type Ref_Paragraph_font_147 = () => DocxEditor.Font;
type Auth_Paragraph_font_147 = () => DocxEditor.Font;
type _check_Paragraph_font_147 = IsExact<Ref_Paragraph_font_147, Auth_Paragraph_font_147>;
type _assert_Paragraph_font_147 = Expect<_check_Paragraph_font_147>;

type Ref_Paragraph_font_readonly_148 = { readonly value: DocxEditor.Font };
type Auth_Paragraph_font_readonly_148 = { readonly value: DocxEditor.Font };
type _check_Paragraph_font_readonly_148 = IsExact<Ref_Paragraph_font_readonly_148, Auth_Paragraph_font_readonly_148>;
type _assert_Paragraph_font_readonly_148 = Expect<_check_Paragraph_font_readonly_148>;

type Ref_Paragraph_insertParagraph_149 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Paragraph_insertParagraph_149 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Paragraph_insertParagraph_149 = IsExact<Ref_Paragraph_insertParagraph_149, Auth_Paragraph_insertParagraph_149>;
type _assert_Paragraph_insertParagraph_149 = Expect<_check_Paragraph_insertParagraph_149>;

type Ref_Paragraph_insertText_150 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Paragraph_insertText_150 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Paragraph_insertText_150 = IsExact<Ref_Paragraph_insertText_150, Auth_Paragraph_insertText_150>;
type _assert_Paragraph_insertText_150 = Expect<_check_Paragraph_insertText_150>;

type Ref_Paragraph_leftIndent_151 = () => number;
type Auth_Paragraph_leftIndent_151 = () => number;
type _check_Paragraph_leftIndent_151 = IsExact<Ref_Paragraph_leftIndent_151, Auth_Paragraph_leftIndent_151>;
type _assert_Paragraph_leftIndent_151 = Expect<_check_Paragraph_leftIndent_151>;

type Ref_Paragraph_leftIndent_readonly_152 = { value: number };
type Auth_Paragraph_leftIndent_readonly_152 = { value: number };
type _check_Paragraph_leftIndent_readonly_152 = IsExact<Ref_Paragraph_leftIndent_readonly_152, Auth_Paragraph_leftIndent_readonly_152>;
type _assert_Paragraph_leftIndent_readonly_152 = Expect<_check_Paragraph_leftIndent_readonly_152>;

type Ref_Paragraph_lineSpacing_153 = () => number;
type Auth_Paragraph_lineSpacing_153 = () => number;
type _check_Paragraph_lineSpacing_153 = IsExact<Ref_Paragraph_lineSpacing_153, Auth_Paragraph_lineSpacing_153>;
type _assert_Paragraph_lineSpacing_153 = Expect<_check_Paragraph_lineSpacing_153>;

type Ref_Paragraph_lineSpacing_readonly_154 = { value: number };
type Auth_Paragraph_lineSpacing_readonly_154 = { value: number };
type _check_Paragraph_lineSpacing_readonly_154 = IsExact<Ref_Paragraph_lineSpacing_readonly_154, Auth_Paragraph_lineSpacing_readonly_154>;
type _assert_Paragraph_lineSpacing_readonly_154 = Expect<_check_Paragraph_lineSpacing_readonly_154>;

type Ref_Paragraph_list_155 = () => DocxEditor.List;
type Auth_Paragraph_list_155 = () => DocxEditor.List;
type _check_Paragraph_list_155 = IsExact<Ref_Paragraph_list_155, Auth_Paragraph_list_155>;
type _assert_Paragraph_list_155 = Expect<_check_Paragraph_list_155>;

type Ref_Paragraph_list_readonly_156 = { readonly value: DocxEditor.List };
type Auth_Paragraph_list_readonly_156 = { readonly value: DocxEditor.List };
type _check_Paragraph_list_readonly_156 = IsExact<Ref_Paragraph_list_readonly_156, Auth_Paragraph_list_readonly_156>;
type _assert_Paragraph_list_readonly_156 = Expect<_check_Paragraph_list_readonly_156>;

type Ref_Paragraph_listItem_157 = () => DocxEditor.ListItem;
type Auth_Paragraph_listItem_157 = () => DocxEditor.ListItem;
type _check_Paragraph_listItem_157 = IsExact<Ref_Paragraph_listItem_157, Auth_Paragraph_listItem_157>;
type _assert_Paragraph_listItem_157 = Expect<_check_Paragraph_listItem_157>;

type Ref_Paragraph_listItem_readonly_158 = { readonly value: DocxEditor.ListItem };
type Auth_Paragraph_listItem_readonly_158 = { readonly value: DocxEditor.ListItem };
type _check_Paragraph_listItem_readonly_158 = IsExact<Ref_Paragraph_listItem_readonly_158, Auth_Paragraph_listItem_readonly_158>;
type _assert_Paragraph_listItem_readonly_158 = Expect<_check_Paragraph_listItem_readonly_158>;

type Ref_Paragraph_rightIndent_159 = () => number;
type Auth_Paragraph_rightIndent_159 = () => number;
type _check_Paragraph_rightIndent_159 = IsExact<Ref_Paragraph_rightIndent_159, Auth_Paragraph_rightIndent_159>;
type _assert_Paragraph_rightIndent_159 = Expect<_check_Paragraph_rightIndent_159>;

type Ref_Paragraph_rightIndent_readonly_160 = { value: number };
type Auth_Paragraph_rightIndent_readonly_160 = { value: number };
type _check_Paragraph_rightIndent_readonly_160 = IsExact<Ref_Paragraph_rightIndent_readonly_160, Auth_Paragraph_rightIndent_readonly_160>;
type _assert_Paragraph_rightIndent_readonly_160 = Expect<_check_Paragraph_rightIndent_readonly_160>;

type Ref_Paragraph_spaceAfter_161 = () => number;
type Auth_Paragraph_spaceAfter_161 = () => number;
type _check_Paragraph_spaceAfter_161 = IsExact<Ref_Paragraph_spaceAfter_161, Auth_Paragraph_spaceAfter_161>;
type _assert_Paragraph_spaceAfter_161 = Expect<_check_Paragraph_spaceAfter_161>;

type Ref_Paragraph_spaceAfter_readonly_162 = { value: number };
type Auth_Paragraph_spaceAfter_readonly_162 = { value: number };
type _check_Paragraph_spaceAfter_readonly_162 = IsExact<Ref_Paragraph_spaceAfter_readonly_162, Auth_Paragraph_spaceAfter_readonly_162>;
type _assert_Paragraph_spaceAfter_readonly_162 = Expect<_check_Paragraph_spaceAfter_readonly_162>;

type Ref_Paragraph_spaceBefore_163 = () => number;
type Auth_Paragraph_spaceBefore_163 = () => number;
type _check_Paragraph_spaceBefore_163 = IsExact<Ref_Paragraph_spaceBefore_163, Auth_Paragraph_spaceBefore_163>;
type _assert_Paragraph_spaceBefore_163 = Expect<_check_Paragraph_spaceBefore_163>;

type Ref_Paragraph_spaceBefore_readonly_164 = { value: number };
type Auth_Paragraph_spaceBefore_readonly_164 = { value: number };
type _check_Paragraph_spaceBefore_readonly_164 = IsExact<Ref_Paragraph_spaceBefore_readonly_164, Auth_Paragraph_spaceBefore_readonly_164>;
type _assert_Paragraph_spaceBefore_readonly_164 = Expect<_check_Paragraph_spaceBefore_readonly_164>;

type Ref_Paragraph_split_165 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type Auth_Paragraph_split_165 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type _check_Paragraph_split_165 = IsExact<Ref_Paragraph_split_165, Auth_Paragraph_split_165>;
type _assert_Paragraph_split_165 = Expect<_check_Paragraph_split_165>;

type Ref_Paragraph_style_166 = () => string;
type Auth_Paragraph_style_166 = () => string;
type _check_Paragraph_style_166 = IsExact<Ref_Paragraph_style_166, Auth_Paragraph_style_166>;
type _assert_Paragraph_style_166 = Expect<_check_Paragraph_style_166>;

type Ref_Paragraph_style_readonly_167 = { value: string };
type Auth_Paragraph_style_readonly_167 = { value: string };
type _check_Paragraph_style_readonly_167 = IsExact<Ref_Paragraph_style_readonly_167, Auth_Paragraph_style_readonly_167>;
type _assert_Paragraph_style_readonly_167 = Expect<_check_Paragraph_style_readonly_167>;

type Ref_Paragraph_text_168 = () => string;
type Auth_Paragraph_text_168 = () => string;
type _check_Paragraph_text_168 = IsExact<Ref_Paragraph_text_168, Auth_Paragraph_text_168>;
type _assert_Paragraph_text_168 = Expect<_check_Paragraph_text_168>;

type Ref_Paragraph_text_readonly_169 = { readonly value: string };
type Auth_Paragraph_text_readonly_169 = { readonly value: string };
type _check_Paragraph_text_readonly_169 = IsExact<Ref_Paragraph_text_readonly_169, Auth_Paragraph_text_readonly_169>;
type _assert_Paragraph_text_readonly_169 = Expect<_check_Paragraph_text_readonly_169>;

type Ref_ParagraphCollection_getFirst_170 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getFirst_170 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getFirst_170 = IsExact<Ref_ParagraphCollection_getFirst_170, Auth_ParagraphCollection_getFirst_170>;
type _assert_ParagraphCollection_getFirst_170 = Expect<_check_ParagraphCollection_getFirst_170>;

type Ref_ParagraphCollection_getLast_171 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getLast_171 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getLast_171 = IsExact<Ref_ParagraphCollection_getLast_171, Auth_ParagraphCollection_getLast_171>;
type _assert_ParagraphCollection_getLast_171 = Expect<_check_ParagraphCollection_getLast_171>;

type Ref_ParagraphCollection_items_172 = () => DocxEditor.Paragraph[];
type Auth_ParagraphCollection_items_172 = () => DocxEditor.Paragraph[];
type _check_ParagraphCollection_items_172 = IsExact<Ref_ParagraphCollection_items_172, Auth_ParagraphCollection_items_172>;
type _assert_ParagraphCollection_items_172 = Expect<_check_ParagraphCollection_items_172>;

type Ref_ParagraphCollection_items_readonly_173 = { readonly value: DocxEditor.Paragraph[] };
type Auth_ParagraphCollection_items_readonly_173 = { readonly value: DocxEditor.Paragraph[] };
type _check_ParagraphCollection_items_readonly_173 = IsExact<Ref_ParagraphCollection_items_readonly_173, Auth_ParagraphCollection_items_readonly_173>;
type _assert_ParagraphCollection_items_readonly_173 = Expect<_check_ParagraphCollection_items_readonly_173>;

type Ref_Range_bookmarks_174 = () => DocxEditor.BookmarkCollection;
type Auth_Range_bookmarks_174 = () => DocxEditor.BookmarkCollection;
type _check_Range_bookmarks_174 = IsExact<Ref_Range_bookmarks_174, Auth_Range_bookmarks_174>;
type _assert_Range_bookmarks_174 = Expect<_check_Range_bookmarks_174>;

type Ref_Range_bookmarks_readonly_175 = { readonly value: DocxEditor.BookmarkCollection };
type Auth_Range_bookmarks_readonly_175 = { readonly value: DocxEditor.BookmarkCollection };
type _check_Range_bookmarks_readonly_175 = IsExact<Ref_Range_bookmarks_readonly_175, Auth_Range_bookmarks_readonly_175>;
type _assert_Range_bookmarks_readonly_175 = Expect<_check_Range_bookmarks_readonly_175>;

type Ref_Range_contentControls_176 = () => DocxEditor.ContentControlCollection;
type Auth_Range_contentControls_176 = () => DocxEditor.ContentControlCollection;
type _check_Range_contentControls_176 = IsExact<Ref_Range_contentControls_176, Auth_Range_contentControls_176>;
type _assert_Range_contentControls_176 = Expect<_check_Range_contentControls_176>;

type Ref_Range_contentControls_readonly_177 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Range_contentControls_readonly_177 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Range_contentControls_readonly_177 = IsExact<Ref_Range_contentControls_readonly_177, Auth_Range_contentControls_readonly_177>;
type _assert_Range_contentControls_readonly_177 = Expect<_check_Range_contentControls_readonly_177>;

type Ref_Range_font_178 = () => DocxEditor.Font;
type Auth_Range_font_178 = () => DocxEditor.Font;
type _check_Range_font_178 = IsExact<Ref_Range_font_178, Auth_Range_font_178>;
type _assert_Range_font_178 = Expect<_check_Range_font_178>;

type Ref_Range_font_readonly_179 = { readonly value: DocxEditor.Font };
type Auth_Range_font_readonly_179 = { readonly value: DocxEditor.Font };
type _check_Range_font_readonly_179 = IsExact<Ref_Range_font_readonly_179, Auth_Range_font_readonly_179>;
type _assert_Range_font_readonly_179 = Expect<_check_Range_font_readonly_179>;

type Ref_Range_hyperlink_180 = () => string;
type Auth_Range_hyperlink_180 = () => string;
type _check_Range_hyperlink_180 = IsExact<Ref_Range_hyperlink_180, Auth_Range_hyperlink_180>;
type _assert_Range_hyperlink_180 = Expect<_check_Range_hyperlink_180>;

type Ref_Range_hyperlink_readonly_181 = { value: string };
type Auth_Range_hyperlink_readonly_181 = { value: string };
type _check_Range_hyperlink_readonly_181 = IsExact<Ref_Range_hyperlink_readonly_181, Auth_Range_hyperlink_readonly_181>;
type _assert_Range_hyperlink_readonly_181 = Expect<_check_Range_hyperlink_readonly_181>;

type Ref_Range_insertParagraph_182 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Range_insertParagraph_182 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Range_insertParagraph_182 = IsExact<Ref_Range_insertParagraph_182, Auth_Range_insertParagraph_182>;
type _assert_Range_insertParagraph_182 = Expect<_check_Range_insertParagraph_182>;

type Ref_Range_insertText_183 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type Auth_Range_insertText_183 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type _check_Range_insertText_183 = IsExact<Ref_Range_insertText_183, Auth_Range_insertText_183>;
type _assert_Range_insertText_183 = Expect<_check_Range_insertText_183>;

type Ref_Range_paragraphs_184 = () => DocxEditor.ParagraphCollection;
type Auth_Range_paragraphs_184 = () => DocxEditor.ParagraphCollection;
type _check_Range_paragraphs_184 = IsExact<Ref_Range_paragraphs_184, Auth_Range_paragraphs_184>;
type _assert_Range_paragraphs_184 = Expect<_check_Range_paragraphs_184>;

type Ref_Range_paragraphs_readonly_185 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Range_paragraphs_readonly_185 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Range_paragraphs_readonly_185 = IsExact<Ref_Range_paragraphs_readonly_185, Auth_Range_paragraphs_readonly_185>;
type _assert_Range_paragraphs_readonly_185 = Expect<_check_Range_paragraphs_readonly_185>;

type Ref_Range_search_186 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Range_search_186 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Range_search_186 = IsExact<Ref_Range_search_186, Auth_Range_search_186>;
type _assert_Range_search_186 = Expect<_check_Range_search_186>;

type Ref_Range_select_187 = (selectionMode?: DocxEditor.SelectionMode) => void;
type Auth_Range_select_187 = (selectionMode?: DocxEditor.SelectionMode) => void;
type _check_Range_select_187 = IsExact<Ref_Range_select_187, Auth_Range_select_187>;
type _assert_Range_select_187 = Expect<_check_Range_select_187>;

type Ref_Range_select_188 = (selectionMode?: "Select" | "Start" | "End") => void;
type Auth_Range_select_188 = (selectionMode?: "Select" | "Start" | "End") => void;
type _check_Range_select_188 = IsExact<Ref_Range_select_188, Auth_Range_select_188>;
type _assert_Range_select_188 = Expect<_check_Range_select_188>;

type Ref_Range_style_189 = () => string;
type Auth_Range_style_189 = () => string;
type _check_Range_style_189 = IsExact<Ref_Range_style_189, Auth_Range_style_189>;
type _assert_Range_style_189 = Expect<_check_Range_style_189>;

type Ref_Range_style_readonly_190 = { value: string };
type Auth_Range_style_readonly_190 = { value: string };
type _check_Range_style_readonly_190 = IsExact<Ref_Range_style_readonly_190, Auth_Range_style_readonly_190>;
type _assert_Range_style_readonly_190 = Expect<_check_Range_style_readonly_190>;

type Ref_Range_text_191 = () => string;
type Auth_Range_text_191 = () => string;
type _check_Range_text_191 = IsExact<Ref_Range_text_191, Auth_Range_text_191>;
type _assert_Range_text_191 = Expect<_check_Range_text_191>;

type Ref_Range_text_readonly_192 = { readonly value: string };
type Auth_Range_text_readonly_192 = { readonly value: string };
type _check_Range_text_readonly_192 = IsExact<Ref_Range_text_readonly_192, Auth_Range_text_readonly_192>;
type _assert_Range_text_readonly_192 = Expect<_check_Range_text_readonly_192>;

type Ref_RangeCollection_getFirst_193 = () => DocxEditor.Range;
type Auth_RangeCollection_getFirst_193 = () => DocxEditor.Range;
type _check_RangeCollection_getFirst_193 = IsExact<Ref_RangeCollection_getFirst_193, Auth_RangeCollection_getFirst_193>;
type _assert_RangeCollection_getFirst_193 = Expect<_check_RangeCollection_getFirst_193>;

type Ref_RangeCollection_items_194 = () => DocxEditor.Range[];
type Auth_RangeCollection_items_194 = () => DocxEditor.Range[];
type _check_RangeCollection_items_194 = IsExact<Ref_RangeCollection_items_194, Auth_RangeCollection_items_194>;
type _assert_RangeCollection_items_194 = Expect<_check_RangeCollection_items_194>;

type Ref_RangeCollection_items_readonly_195 = { readonly value: DocxEditor.Range[] };
type Auth_RangeCollection_items_readonly_195 = { readonly value: DocxEditor.Range[] };
type _check_RangeCollection_items_readonly_195 = IsExact<Ref_RangeCollection_items_readonly_195, Auth_RangeCollection_items_readonly_195>;
type _assert_RangeCollection_items_readonly_195 = Expect<_check_RangeCollection_items_readonly_195>;

type Ref_RequestContext_document_196 = () => DocxEditor.Document;
type Auth_RequestContext_document_196 = () => DocxEditor.Document;
type _check_RequestContext_document_196 = IsExact<Ref_RequestContext_document_196, Auth_RequestContext_document_196>;
type _assert_RequestContext_document_196 = Expect<_check_RequestContext_document_196>;

type Ref_RequestContext_document_readonly_197 = { readonly value: DocxEditor.Document };
type Auth_RequestContext_document_readonly_197 = { readonly value: DocxEditor.Document };
type _check_RequestContext_document_readonly_197 = IsExact<Ref_RequestContext_document_readonly_197, Auth_RequestContext_document_readonly_197>;
type _assert_RequestContext_document_readonly_197 = Expect<_check_RequestContext_document_readonly_197>;

type Ref_Revision_accept_198 = () => void;
type Auth_Revision_accept_198 = () => void;
type _check_Revision_accept_198 = IsExact<Ref_Revision_accept_198, Auth_Revision_accept_198>;
type _assert_Revision_accept_198 = Expect<_check_Revision_accept_198>;

type Ref_Revision_author_199 = () => string;
type Auth_Revision_author_199 = () => string;
type _check_Revision_author_199 = IsExact<Ref_Revision_author_199, Auth_Revision_author_199>;
type _assert_Revision_author_199 = Expect<_check_Revision_author_199>;

type Ref_Revision_author_readonly_200 = { readonly value: string };
type Auth_Revision_author_readonly_200 = { readonly value: string };
type _check_Revision_author_readonly_200 = IsExact<Ref_Revision_author_readonly_200, Auth_Revision_author_readonly_200>;
type _assert_Revision_author_readonly_200 = Expect<_check_Revision_author_readonly_200>;

type Ref_Revision_date_201 = () => Date;
type Auth_Revision_date_201 = () => Date;
type _check_Revision_date_201 = IsExact<Ref_Revision_date_201, Auth_Revision_date_201>;
type _assert_Revision_date_201 = Expect<_check_Revision_date_201>;

type Ref_Revision_date_readonly_202 = { readonly value: Date };
type Auth_Revision_date_readonly_202 = { readonly value: Date };
type _check_Revision_date_readonly_202 = IsExact<Ref_Revision_date_readonly_202, Auth_Revision_date_readonly_202>;
type _assert_Revision_date_readonly_202 = Expect<_check_Revision_date_readonly_202>;

type Ref_Revision_range_203 = () => DocxEditor.Range;
type Auth_Revision_range_203 = () => DocxEditor.Range;
type _check_Revision_range_203 = IsExact<Ref_Revision_range_203, Auth_Revision_range_203>;
type _assert_Revision_range_203 = Expect<_check_Revision_range_203>;

type Ref_Revision_range_readonly_204 = { readonly value: DocxEditor.Range };
type Auth_Revision_range_readonly_204 = { readonly value: DocxEditor.Range };
type _check_Revision_range_readonly_204 = IsExact<Ref_Revision_range_readonly_204, Auth_Revision_range_readonly_204>;
type _assert_Revision_range_readonly_204 = Expect<_check_Revision_range_readonly_204>;

type Ref_Revision_reject_205 = () => void;
type Auth_Revision_reject_205 = () => void;
type _check_Revision_reject_205 = IsExact<Ref_Revision_reject_205, Auth_Revision_reject_205>;
type _assert_Revision_reject_205 = Expect<_check_Revision_reject_205>;

type Ref_Revision_type_206 = () => "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete";
type Auth_Revision_type_206 = () => "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete";
type _check_Revision_type_206 = IsExact<Ref_Revision_type_206, Auth_Revision_type_206>;
type _assert_Revision_type_206 = Expect<_check_Revision_type_206>;

type Ref_Revision_type_readonly_207 = { readonly value: "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete" };
type Auth_Revision_type_readonly_207 = { readonly value: "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete" };
type _check_Revision_type_readonly_207 = IsExact<Ref_Revision_type_readonly_207, Auth_Revision_type_readonly_207>;
type _assert_Revision_type_readonly_207 = Expect<_check_Revision_type_readonly_207>;

type Ref_RevisionCollection_acceptAll_208 = () => void;
type Auth_RevisionCollection_acceptAll_208 = () => void;
type _check_RevisionCollection_acceptAll_208 = IsExact<Ref_RevisionCollection_acceptAll_208, Auth_RevisionCollection_acceptAll_208>;
type _assert_RevisionCollection_acceptAll_208 = Expect<_check_RevisionCollection_acceptAll_208>;

type Ref_RevisionCollection_items_209 = () => DocxEditor.Revision[];
type Auth_RevisionCollection_items_209 = () => DocxEditor.Revision[];
type _check_RevisionCollection_items_209 = IsExact<Ref_RevisionCollection_items_209, Auth_RevisionCollection_items_209>;
type _assert_RevisionCollection_items_209 = Expect<_check_RevisionCollection_items_209>;

type Ref_RevisionCollection_items_readonly_210 = { readonly value: DocxEditor.Revision[] };
type Auth_RevisionCollection_items_readonly_210 = { readonly value: DocxEditor.Revision[] };
type _check_RevisionCollection_items_readonly_210 = IsExact<Ref_RevisionCollection_items_readonly_210, Auth_RevisionCollection_items_readonly_210>;
type _assert_RevisionCollection_items_readonly_210 = Expect<_check_RevisionCollection_items_readonly_210>;

type Ref_RevisionCollection_rejectAll_211 = () => void;
type Auth_RevisionCollection_rejectAll_211 = () => void;
type _check_RevisionCollection_rejectAll_211 = IsExact<Ref_RevisionCollection_rejectAll_211, Auth_RevisionCollection_rejectAll_211>;
type _assert_RevisionCollection_rejectAll_211 = Expect<_check_RevisionCollection_rejectAll_211>;

type Ref_SearchOptions_ignorePunct_212 = () => boolean;
type Auth_SearchOptions_ignorePunct_212 = () => boolean;
type _check_SearchOptions_ignorePunct_212 = IsExact<Ref_SearchOptions_ignorePunct_212, Auth_SearchOptions_ignorePunct_212>;
type _assert_SearchOptions_ignorePunct_212 = Expect<_check_SearchOptions_ignorePunct_212>;

type Ref_SearchOptions_ignorePunct_readonly_213 = { value: boolean };
type Auth_SearchOptions_ignorePunct_readonly_213 = { value: boolean };
type _check_SearchOptions_ignorePunct_readonly_213 = IsExact<Ref_SearchOptions_ignorePunct_readonly_213, Auth_SearchOptions_ignorePunct_readonly_213>;
type _assert_SearchOptions_ignorePunct_readonly_213 = Expect<_check_SearchOptions_ignorePunct_readonly_213>;

type Ref_SearchOptions_ignoreSpace_214 = () => boolean;
type Auth_SearchOptions_ignoreSpace_214 = () => boolean;
type _check_SearchOptions_ignoreSpace_214 = IsExact<Ref_SearchOptions_ignoreSpace_214, Auth_SearchOptions_ignoreSpace_214>;
type _assert_SearchOptions_ignoreSpace_214 = Expect<_check_SearchOptions_ignoreSpace_214>;

type Ref_SearchOptions_ignoreSpace_readonly_215 = { value: boolean };
type Auth_SearchOptions_ignoreSpace_readonly_215 = { value: boolean };
type _check_SearchOptions_ignoreSpace_readonly_215 = IsExact<Ref_SearchOptions_ignoreSpace_readonly_215, Auth_SearchOptions_ignoreSpace_readonly_215>;
type _assert_SearchOptions_ignoreSpace_readonly_215 = Expect<_check_SearchOptions_ignoreSpace_readonly_215>;

type Ref_SearchOptions_matchCase_216 = () => boolean;
type Auth_SearchOptions_matchCase_216 = () => boolean;
type _check_SearchOptions_matchCase_216 = IsExact<Ref_SearchOptions_matchCase_216, Auth_SearchOptions_matchCase_216>;
type _assert_SearchOptions_matchCase_216 = Expect<_check_SearchOptions_matchCase_216>;

type Ref_SearchOptions_matchCase_readonly_217 = { value: boolean };
type Auth_SearchOptions_matchCase_readonly_217 = { value: boolean };
type _check_SearchOptions_matchCase_readonly_217 = IsExact<Ref_SearchOptions_matchCase_readonly_217, Auth_SearchOptions_matchCase_readonly_217>;
type _assert_SearchOptions_matchCase_readonly_217 = Expect<_check_SearchOptions_matchCase_readonly_217>;

type Ref_SearchOptions_matchWholeWord_218 = () => boolean;
type Auth_SearchOptions_matchWholeWord_218 = () => boolean;
type _check_SearchOptions_matchWholeWord_218 = IsExact<Ref_SearchOptions_matchWholeWord_218, Auth_SearchOptions_matchWholeWord_218>;
type _assert_SearchOptions_matchWholeWord_218 = Expect<_check_SearchOptions_matchWholeWord_218>;

type Ref_SearchOptions_matchWholeWord_readonly_219 = { value: boolean };
type Auth_SearchOptions_matchWholeWord_readonly_219 = { value: boolean };
type _check_SearchOptions_matchWholeWord_readonly_219 = IsExact<Ref_SearchOptions_matchWholeWord_readonly_219, Auth_SearchOptions_matchWholeWord_readonly_219>;
type _assert_SearchOptions_matchWholeWord_readonly_219 = Expect<_check_SearchOptions_matchWholeWord_readonly_219>;

type Ref_SearchOptions_matchWildcards_220 = () => boolean;
type Auth_SearchOptions_matchWildcards_220 = () => boolean;
type _check_SearchOptions_matchWildcards_220 = IsExact<Ref_SearchOptions_matchWildcards_220, Auth_SearchOptions_matchWildcards_220>;
type _assert_SearchOptions_matchWildcards_220 = Expect<_check_SearchOptions_matchWildcards_220>;

type Ref_SearchOptions_matchWildcards_readonly_221 = { value: boolean };
type Auth_SearchOptions_matchWildcards_readonly_221 = { value: boolean };
type _check_SearchOptions_matchWildcards_readonly_221 = IsExact<Ref_SearchOptions_matchWildcards_readonly_221, Auth_SearchOptions_matchWildcards_readonly_221>;
type _assert_SearchOptions_matchWildcards_readonly_221 = Expect<_check_SearchOptions_matchWildcards_readonly_221>;

type Ref_Section_body_222 = () => DocxEditor.Body;
type Auth_Section_body_222 = () => DocxEditor.Body;
type _check_Section_body_222 = IsExact<Ref_Section_body_222, Auth_Section_body_222>;
type _assert_Section_body_222 = Expect<_check_Section_body_222>;

type Ref_Section_body_readonly_223 = { readonly value: DocxEditor.Body };
type Auth_Section_body_readonly_223 = { readonly value: DocxEditor.Body };
type _check_Section_body_readonly_223 = IsExact<Ref_Section_body_readonly_223, Auth_Section_body_readonly_223>;
type _assert_Section_body_readonly_223 = Expect<_check_Section_body_readonly_223>;

type Ref_Section_getFooter_224 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type Auth_Section_getFooter_224 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type _check_Section_getFooter_224 = IsExact<Ref_Section_getFooter_224, Auth_Section_getFooter_224>;
type _assert_Section_getFooter_224 = Expect<_check_Section_getFooter_224>;

type Ref_Section_getFooter_225 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type Auth_Section_getFooter_225 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type _check_Section_getFooter_225 = IsExact<Ref_Section_getFooter_225, Auth_Section_getFooter_225>;
type _assert_Section_getFooter_225 = Expect<_check_Section_getFooter_225>;

type Ref_Section_getHeader_226 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type Auth_Section_getHeader_226 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type _check_Section_getHeader_226 = IsExact<Ref_Section_getHeader_226, Auth_Section_getHeader_226>;
type _assert_Section_getHeader_226 = Expect<_check_Section_getHeader_226>;

type Ref_Section_getHeader_227 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type Auth_Section_getHeader_227 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type _check_Section_getHeader_227 = IsExact<Ref_Section_getHeader_227, Auth_Section_getHeader_227>;
type _assert_Section_getHeader_227 = Expect<_check_Section_getHeader_227>;

type Ref_Section_getNext_228 = () => DocxEditor.Section;
type Auth_Section_getNext_228 = () => DocxEditor.Section;
type _check_Section_getNext_228 = IsExact<Ref_Section_getNext_228, Auth_Section_getNext_228>;
type _assert_Section_getNext_228 = Expect<_check_Section_getNext_228>;

type Ref_Section_pageSetup_229 = () => DocxEditor.PageSetup;
type Auth_Section_pageSetup_229 = () => DocxEditor.PageSetup;
type _check_Section_pageSetup_229 = IsExact<Ref_Section_pageSetup_229, Auth_Section_pageSetup_229>;
type _assert_Section_pageSetup_229 = Expect<_check_Section_pageSetup_229>;

type Ref_Section_pageSetup_readonly_230 = { readonly value: DocxEditor.PageSetup };
type Auth_Section_pageSetup_readonly_230 = { readonly value: DocxEditor.PageSetup };
type _check_Section_pageSetup_readonly_230 = IsExact<Ref_Section_pageSetup_readonly_230, Auth_Section_pageSetup_readonly_230>;
type _assert_Section_pageSetup_readonly_230 = Expect<_check_Section_pageSetup_readonly_230>;

type Ref_SectionCollection_getFirst_231 = () => DocxEditor.Section;
type Auth_SectionCollection_getFirst_231 = () => DocxEditor.Section;
type _check_SectionCollection_getFirst_231 = IsExact<Ref_SectionCollection_getFirst_231, Auth_SectionCollection_getFirst_231>;
type _assert_SectionCollection_getFirst_231 = Expect<_check_SectionCollection_getFirst_231>;

type Ref_SectionCollection_items_232 = () => DocxEditor.Section[];
type Auth_SectionCollection_items_232 = () => DocxEditor.Section[];
type _check_SectionCollection_items_232 = IsExact<Ref_SectionCollection_items_232, Auth_SectionCollection_items_232>;
type _assert_SectionCollection_items_232 = Expect<_check_SectionCollection_items_232>;

type Ref_SectionCollection_items_readonly_233 = { readonly value: DocxEditor.Section[] };
type Auth_SectionCollection_items_readonly_233 = { readonly value: DocxEditor.Section[] };
type _check_SectionCollection_items_readonly_233 = IsExact<Ref_SectionCollection_items_readonly_233, Auth_SectionCollection_items_readonly_233>;
type _assert_SectionCollection_items_readonly_233 = Expect<_check_SectionCollection_items_readonly_233>;

type Ref_run_234 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_234 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_234 = IsExact<Ref_run_234, Auth_run_234>;
type _assert_run_234 = Expect<_check_run_234>;

type Ref_run_235 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_235 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_235 = IsExact<Ref_run_235, Auth_run_235>;
type _assert_run_235 = Expect<_check_run_235>;

type Ref_run_236 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_236 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_236 = IsExact<Ref_run_236, Auth_run_236>;
type _assert_run_236 = Expect<_check_run_236>;

