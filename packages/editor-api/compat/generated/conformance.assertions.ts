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

type Ref_Comment_delete_32 = () => void;
type Auth_Comment_delete_32 = () => void;
type _check_Comment_delete_32 = IsExact<Ref_Comment_delete_32, Auth_Comment_delete_32>;
type _assert_Comment_delete_32 = Expect<_check_Comment_delete_32>;

type Ref_Comment_getRange_33 = () => DocxEditor.Range;
type Auth_Comment_getRange_33 = () => DocxEditor.Range;
type _check_Comment_getRange_33 = IsExact<Ref_Comment_getRange_33, Auth_Comment_getRange_33>;
type _assert_Comment_getRange_33 = Expect<_check_Comment_getRange_33>;

type Ref_Comment_id_34 = () => string;
type Auth_Comment_id_34 = () => string;
type _check_Comment_id_34 = IsExact<Ref_Comment_id_34, Auth_Comment_id_34>;
type _assert_Comment_id_34 = Expect<_check_Comment_id_34>;

type Ref_Comment_id_readonly_35 = { readonly value: string };
type Auth_Comment_id_readonly_35 = { readonly value: string };
type _check_Comment_id_readonly_35 = IsExact<Ref_Comment_id_readonly_35, Auth_Comment_id_readonly_35>;
type _assert_Comment_id_readonly_35 = Expect<_check_Comment_id_readonly_35>;

type Ref_Comment_replies_36 = () => DocxEditor.CommentReplyCollection;
type Auth_Comment_replies_36 = () => DocxEditor.CommentReplyCollection;
type _check_Comment_replies_36 = IsExact<Ref_Comment_replies_36, Auth_Comment_replies_36>;
type _assert_Comment_replies_36 = Expect<_check_Comment_replies_36>;

type Ref_Comment_replies_readonly_37 = { readonly value: DocxEditor.CommentReplyCollection };
type Auth_Comment_replies_readonly_37 = { readonly value: DocxEditor.CommentReplyCollection };
type _check_Comment_replies_readonly_37 = IsExact<Ref_Comment_replies_readonly_37, Auth_Comment_replies_readonly_37>;
type _assert_Comment_replies_readonly_37 = Expect<_check_Comment_replies_readonly_37>;

type Ref_Comment_reply_38 = (replyText: string) => DocxEditor.CommentReply;
type Auth_Comment_reply_38 = (replyText: string) => DocxEditor.CommentReply;
type _check_Comment_reply_38 = IsExact<Ref_Comment_reply_38, Auth_Comment_reply_38>;
type _assert_Comment_reply_38 = Expect<_check_Comment_reply_38>;

type Ref_Comment_resolved_39 = () => boolean;
type Auth_Comment_resolved_39 = () => boolean;
type _check_Comment_resolved_39 = IsExact<Ref_Comment_resolved_39, Auth_Comment_resolved_39>;
type _assert_Comment_resolved_39 = Expect<_check_Comment_resolved_39>;

type Ref_Comment_resolved_readonly_40 = { value: boolean };
type Auth_Comment_resolved_readonly_40 = { value: boolean };
type _check_Comment_resolved_readonly_40 = IsExact<Ref_Comment_resolved_readonly_40, Auth_Comment_resolved_readonly_40>;
type _assert_Comment_resolved_readonly_40 = Expect<_check_Comment_resolved_readonly_40>;

type Ref_CommentCollection_getFirst_41 = () => DocxEditor.Comment;
type Auth_CommentCollection_getFirst_41 = () => DocxEditor.Comment;
type _check_CommentCollection_getFirst_41 = IsExact<Ref_CommentCollection_getFirst_41, Auth_CommentCollection_getFirst_41>;
type _assert_CommentCollection_getFirst_41 = Expect<_check_CommentCollection_getFirst_41>;

type Ref_CommentCollection_items_42 = () => DocxEditor.Comment[];
type Auth_CommentCollection_items_42 = () => DocxEditor.Comment[];
type _check_CommentCollection_items_42 = IsExact<Ref_CommentCollection_items_42, Auth_CommentCollection_items_42>;
type _assert_CommentCollection_items_42 = Expect<_check_CommentCollection_items_42>;

type Ref_CommentCollection_items_readonly_43 = { readonly value: DocxEditor.Comment[] };
type Auth_CommentCollection_items_readonly_43 = { readonly value: DocxEditor.Comment[] };
type _check_CommentCollection_items_readonly_43 = IsExact<Ref_CommentCollection_items_readonly_43, Auth_CommentCollection_items_readonly_43>;
type _assert_CommentCollection_items_readonly_43 = Expect<_check_CommentCollection_items_readonly_43>;

type Ref_CommentReply_authorName_44 = () => string;
type Auth_CommentReply_authorName_44 = () => string;
type _check_CommentReply_authorName_44 = IsExact<Ref_CommentReply_authorName_44, Auth_CommentReply_authorName_44>;
type _assert_CommentReply_authorName_44 = Expect<_check_CommentReply_authorName_44>;

type Ref_CommentReply_authorName_readonly_45 = { readonly value: string };
type Auth_CommentReply_authorName_readonly_45 = { readonly value: string };
type _check_CommentReply_authorName_readonly_45 = IsExact<Ref_CommentReply_authorName_readonly_45, Auth_CommentReply_authorName_readonly_45>;
type _assert_CommentReply_authorName_readonly_45 = Expect<_check_CommentReply_authorName_readonly_45>;

type Ref_CommentReply_creationDate_46 = () => Date;
type Auth_CommentReply_creationDate_46 = () => Date;
type _check_CommentReply_creationDate_46 = IsExact<Ref_CommentReply_creationDate_46, Auth_CommentReply_creationDate_46>;
type _assert_CommentReply_creationDate_46 = Expect<_check_CommentReply_creationDate_46>;

type Ref_CommentReply_creationDate_readonly_47 = { readonly value: Date };
type Auth_CommentReply_creationDate_readonly_47 = { readonly value: Date };
type _check_CommentReply_creationDate_readonly_47 = IsExact<Ref_CommentReply_creationDate_readonly_47, Auth_CommentReply_creationDate_readonly_47>;
type _assert_CommentReply_creationDate_readonly_47 = Expect<_check_CommentReply_creationDate_readonly_47>;

type Ref_CommentReply_delete_48 = () => void;
type Auth_CommentReply_delete_48 = () => void;
type _check_CommentReply_delete_48 = IsExact<Ref_CommentReply_delete_48, Auth_CommentReply_delete_48>;
type _assert_CommentReply_delete_48 = Expect<_check_CommentReply_delete_48>;

type Ref_CommentReply_id_49 = () => string;
type Auth_CommentReply_id_49 = () => string;
type _check_CommentReply_id_49 = IsExact<Ref_CommentReply_id_49, Auth_CommentReply_id_49>;
type _assert_CommentReply_id_49 = Expect<_check_CommentReply_id_49>;

type Ref_CommentReply_id_readonly_50 = { readonly value: string };
type Auth_CommentReply_id_readonly_50 = { readonly value: string };
type _check_CommentReply_id_readonly_50 = IsExact<Ref_CommentReply_id_readonly_50, Auth_CommentReply_id_readonly_50>;
type _assert_CommentReply_id_readonly_50 = Expect<_check_CommentReply_id_readonly_50>;

type Ref_CommentReplyCollection_getFirst_51 = () => DocxEditor.CommentReply;
type Auth_CommentReplyCollection_getFirst_51 = () => DocxEditor.CommentReply;
type _check_CommentReplyCollection_getFirst_51 = IsExact<Ref_CommentReplyCollection_getFirst_51, Auth_CommentReplyCollection_getFirst_51>;
type _assert_CommentReplyCollection_getFirst_51 = Expect<_check_CommentReplyCollection_getFirst_51>;

type Ref_CommentReplyCollection_items_52 = () => DocxEditor.CommentReply[];
type Auth_CommentReplyCollection_items_52 = () => DocxEditor.CommentReply[];
type _check_CommentReplyCollection_items_52 = IsExact<Ref_CommentReplyCollection_items_52, Auth_CommentReplyCollection_items_52>;
type _assert_CommentReplyCollection_items_52 = Expect<_check_CommentReplyCollection_items_52>;

type Ref_CommentReplyCollection_items_readonly_53 = { readonly value: DocxEditor.CommentReply[] };
type Auth_CommentReplyCollection_items_readonly_53 = { readonly value: DocxEditor.CommentReply[] };
type _check_CommentReplyCollection_items_readonly_53 = IsExact<Ref_CommentReplyCollection_items_readonly_53, Auth_CommentReplyCollection_items_readonly_53>;
type _assert_CommentReplyCollection_items_readonly_53 = Expect<_check_CommentReplyCollection_items_readonly_53>;

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

type Ref_ContentControl_contentControls_58 = () => DocxEditor.ContentControlCollection;
type Auth_ContentControl_contentControls_58 = () => DocxEditor.ContentControlCollection;
type _check_ContentControl_contentControls_58 = IsExact<Ref_ContentControl_contentControls_58, Auth_ContentControl_contentControls_58>;
type _assert_ContentControl_contentControls_58 = Expect<_check_ContentControl_contentControls_58>;

type Ref_ContentControl_contentControls_readonly_59 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_ContentControl_contentControls_readonly_59 = { readonly value: DocxEditor.ContentControlCollection };
type _check_ContentControl_contentControls_readonly_59 = IsExact<Ref_ContentControl_contentControls_readonly_59, Auth_ContentControl_contentControls_readonly_59>;
type _assert_ContentControl_contentControls_readonly_59 = Expect<_check_ContentControl_contentControls_readonly_59>;

type Ref_ContentControl_delete_60 = (keepContent: boolean) => void;
type Auth_ContentControl_delete_60 = (keepContent: boolean) => void;
type _check_ContentControl_delete_60 = IsExact<Ref_ContentControl_delete_60, Auth_ContentControl_delete_60>;
type _assert_ContentControl_delete_60 = Expect<_check_ContentControl_delete_60>;

type Ref_ContentControl_getRange_61 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type Auth_ContentControl_getRange_61 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type _check_ContentControl_getRange_61 = IsExact<Ref_ContentControl_getRange_61, Auth_ContentControl_getRange_61>;
type _assert_ContentControl_getRange_61 = Expect<_check_ContentControl_getRange_61>;

type Ref_ContentControl_insertText_62 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_ContentControl_insertText_62 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_ContentControl_insertText_62 = IsExact<Ref_ContentControl_insertText_62, Auth_ContentControl_insertText_62>;
type _assert_ContentControl_insertText_62 = Expect<_check_ContentControl_insertText_62>;

type Ref_ContentControl_paragraphs_63 = () => DocxEditor.ParagraphCollection;
type Auth_ContentControl_paragraphs_63 = () => DocxEditor.ParagraphCollection;
type _check_ContentControl_paragraphs_63 = IsExact<Ref_ContentControl_paragraphs_63, Auth_ContentControl_paragraphs_63>;
type _assert_ContentControl_paragraphs_63 = Expect<_check_ContentControl_paragraphs_63>;

type Ref_ContentControl_paragraphs_readonly_64 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_ContentControl_paragraphs_readonly_64 = { readonly value: DocxEditor.ParagraphCollection };
type _check_ContentControl_paragraphs_readonly_64 = IsExact<Ref_ContentControl_paragraphs_readonly_64, Auth_ContentControl_paragraphs_readonly_64>;
type _assert_ContentControl_paragraphs_readonly_64 = Expect<_check_ContentControl_paragraphs_readonly_64>;

type Ref_ContentControl_tag_65 = () => string;
type Auth_ContentControl_tag_65 = () => string;
type _check_ContentControl_tag_65 = IsExact<Ref_ContentControl_tag_65, Auth_ContentControl_tag_65>;
type _assert_ContentControl_tag_65 = Expect<_check_ContentControl_tag_65>;

type Ref_ContentControl_tag_readonly_66 = { value: string };
type Auth_ContentControl_tag_readonly_66 = { value: string };
type _check_ContentControl_tag_readonly_66 = IsExact<Ref_ContentControl_tag_readonly_66, Auth_ContentControl_tag_readonly_66>;
type _assert_ContentControl_tag_readonly_66 = Expect<_check_ContentControl_tag_readonly_66>;

type Ref_ContentControl_text_67 = () => string;
type Auth_ContentControl_text_67 = () => string;
type _check_ContentControl_text_67 = IsExact<Ref_ContentControl_text_67, Auth_ContentControl_text_67>;
type _assert_ContentControl_text_67 = Expect<_check_ContentControl_text_67>;

type Ref_ContentControl_text_readonly_68 = { readonly value: string };
type Auth_ContentControl_text_readonly_68 = { readonly value: string };
type _check_ContentControl_text_readonly_68 = IsExact<Ref_ContentControl_text_readonly_68, Auth_ContentControl_text_readonly_68>;
type _assert_ContentControl_text_readonly_68 = Expect<_check_ContentControl_text_readonly_68>;

type Ref_ContentControl_title_69 = () => string;
type Auth_ContentControl_title_69 = () => string;
type _check_ContentControl_title_69 = IsExact<Ref_ContentControl_title_69, Auth_ContentControl_title_69>;
type _assert_ContentControl_title_69 = Expect<_check_ContentControl_title_69>;

type Ref_ContentControl_title_readonly_70 = { value: string };
type Auth_ContentControl_title_readonly_70 = { value: string };
type _check_ContentControl_title_readonly_70 = IsExact<Ref_ContentControl_title_readonly_70, Auth_ContentControl_title_readonly_70>;
type _assert_ContentControl_title_readonly_70 = Expect<_check_ContentControl_title_readonly_70>;

type Ref_ContentControlCollection_getById_71 = (id: number) => DocxEditor.ContentControl;
type Auth_ContentControlCollection_getById_71 = (id: number) => DocxEditor.ContentControl;
type _check_ContentControlCollection_getById_71 = IsExact<Ref_ContentControlCollection_getById_71, Auth_ContentControlCollection_getById_71>;
type _assert_ContentControlCollection_getById_71 = Expect<_check_ContentControlCollection_getById_71>;

type Ref_ContentControlCollection_items_72 = () => DocxEditor.ContentControl[];
type Auth_ContentControlCollection_items_72 = () => DocxEditor.ContentControl[];
type _check_ContentControlCollection_items_72 = IsExact<Ref_ContentControlCollection_items_72, Auth_ContentControlCollection_items_72>;
type _assert_ContentControlCollection_items_72 = Expect<_check_ContentControlCollection_items_72>;

type Ref_ContentControlCollection_items_readonly_73 = { readonly value: DocxEditor.ContentControl[] };
type Auth_ContentControlCollection_items_readonly_73 = { readonly value: DocxEditor.ContentControl[] };
type _check_ContentControlCollection_items_readonly_73 = IsExact<Ref_ContentControlCollection_items_readonly_73, Auth_ContentControlCollection_items_readonly_73>;
type _assert_ContentControlCollection_items_readonly_73 = Expect<_check_ContentControlCollection_items_readonly_73>;

type Ref_Document_body_74 = () => DocxEditor.Body;
type Auth_Document_body_74 = () => DocxEditor.Body;
type _check_Document_body_74 = IsExact<Ref_Document_body_74, Auth_Document_body_74>;
type _assert_Document_body_74 = Expect<_check_Document_body_74>;

type Ref_Document_body_readonly_75 = { readonly value: DocxEditor.Body };
type Auth_Document_body_readonly_75 = { readonly value: DocxEditor.Body };
type _check_Document_body_readonly_75 = IsExact<Ref_Document_body_readonly_75, Auth_Document_body_readonly_75>;
type _assert_Document_body_readonly_75 = Expect<_check_Document_body_readonly_75>;

type Ref_Document_comments_76 = () => DocxEditor.CommentCollection;
type Auth_Document_comments_76 = () => DocxEditor.CommentCollection;
type _check_Document_comments_76 = IsExact<Ref_Document_comments_76, Auth_Document_comments_76>;
type _assert_Document_comments_76 = Expect<_check_Document_comments_76>;

type Ref_Document_comments_readonly_77 = { readonly value: DocxEditor.CommentCollection };
type Auth_Document_comments_readonly_77 = { readonly value: DocxEditor.CommentCollection };
type _check_Document_comments_readonly_77 = IsExact<Ref_Document_comments_readonly_77, Auth_Document_comments_readonly_77>;
type _assert_Document_comments_readonly_77 = Expect<_check_Document_comments_readonly_77>;

type Ref_Document_contentControls_78 = () => DocxEditor.ContentControlCollection;
type Auth_Document_contentControls_78 = () => DocxEditor.ContentControlCollection;
type _check_Document_contentControls_78 = IsExact<Ref_Document_contentControls_78, Auth_Document_contentControls_78>;
type _assert_Document_contentControls_78 = Expect<_check_Document_contentControls_78>;

type Ref_Document_contentControls_readonly_79 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Document_contentControls_readonly_79 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Document_contentControls_readonly_79 = IsExact<Ref_Document_contentControls_readonly_79, Auth_Document_contentControls_readonly_79>;
type _assert_Document_contentControls_readonly_79 = Expect<_check_Document_contentControls_readonly_79>;

type Ref_Document_paragraphs_80 = () => DocxEditor.ParagraphCollection;
type Auth_Document_paragraphs_80 = () => DocxEditor.ParagraphCollection;
type _check_Document_paragraphs_80 = IsExact<Ref_Document_paragraphs_80, Auth_Document_paragraphs_80>;
type _assert_Document_paragraphs_80 = Expect<_check_Document_paragraphs_80>;

type Ref_Document_paragraphs_readonly_81 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Document_paragraphs_readonly_81 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Document_paragraphs_readonly_81 = IsExact<Ref_Document_paragraphs_readonly_81, Auth_Document_paragraphs_readonly_81>;
type _assert_Document_paragraphs_readonly_81 = Expect<_check_Document_paragraphs_readonly_81>;

type Ref_Document_revisions_82 = () => DocxEditor.RevisionCollection;
type Auth_Document_revisions_82 = () => DocxEditor.RevisionCollection;
type _check_Document_revisions_82 = IsExact<Ref_Document_revisions_82, Auth_Document_revisions_82>;
type _assert_Document_revisions_82 = Expect<_check_Document_revisions_82>;

type Ref_Document_revisions_readonly_83 = { readonly value: DocxEditor.RevisionCollection };
type Auth_Document_revisions_readonly_83 = { readonly value: DocxEditor.RevisionCollection };
type _check_Document_revisions_readonly_83 = IsExact<Ref_Document_revisions_readonly_83, Auth_Document_revisions_readonly_83>;
type _assert_Document_revisions_readonly_83 = Expect<_check_Document_revisions_readonly_83>;

type Ref_Document_sections_84 = () => DocxEditor.SectionCollection;
type Auth_Document_sections_84 = () => DocxEditor.SectionCollection;
type _check_Document_sections_84 = IsExact<Ref_Document_sections_84, Auth_Document_sections_84>;
type _assert_Document_sections_84 = Expect<_check_Document_sections_84>;

type Ref_Document_sections_readonly_85 = { readonly value: DocxEditor.SectionCollection };
type Auth_Document_sections_readonly_85 = { readonly value: DocxEditor.SectionCollection };
type _check_Document_sections_readonly_85 = IsExact<Ref_Document_sections_readonly_85, Auth_Document_sections_readonly_85>;
type _assert_Document_sections_readonly_85 = Expect<_check_Document_sections_readonly_85>;

type Ref_Font_bold_86 = () => boolean;
type Auth_Font_bold_86 = () => boolean;
type _check_Font_bold_86 = IsExact<Ref_Font_bold_86, Auth_Font_bold_86>;
type _assert_Font_bold_86 = Expect<_check_Font_bold_86>;

type Ref_Font_bold_readonly_87 = { value: boolean };
type Auth_Font_bold_readonly_87 = { value: boolean };
type _check_Font_bold_readonly_87 = IsExact<Ref_Font_bold_readonly_87, Auth_Font_bold_readonly_87>;
type _assert_Font_bold_readonly_87 = Expect<_check_Font_bold_readonly_87>;

type Ref_Font_color_88 = () => string;
type Auth_Font_color_88 = () => string;
type _check_Font_color_88 = IsExact<Ref_Font_color_88, Auth_Font_color_88>;
type _assert_Font_color_88 = Expect<_check_Font_color_88>;

type Ref_Font_color_readonly_89 = { value: string };
type Auth_Font_color_readonly_89 = { value: string };
type _check_Font_color_readonly_89 = IsExact<Ref_Font_color_readonly_89, Auth_Font_color_readonly_89>;
type _assert_Font_color_readonly_89 = Expect<_check_Font_color_readonly_89>;

type Ref_Font_italic_90 = () => boolean;
type Auth_Font_italic_90 = () => boolean;
type _check_Font_italic_90 = IsExact<Ref_Font_italic_90, Auth_Font_italic_90>;
type _assert_Font_italic_90 = Expect<_check_Font_italic_90>;

type Ref_Font_italic_readonly_91 = { value: boolean };
type Auth_Font_italic_readonly_91 = { value: boolean };
type _check_Font_italic_readonly_91 = IsExact<Ref_Font_italic_readonly_91, Auth_Font_italic_readonly_91>;
type _assert_Font_italic_readonly_91 = Expect<_check_Font_italic_readonly_91>;

type Ref_Font_name_92 = () => string;
type Auth_Font_name_92 = () => string;
type _check_Font_name_92 = IsExact<Ref_Font_name_92, Auth_Font_name_92>;
type _assert_Font_name_92 = Expect<_check_Font_name_92>;

type Ref_Font_name_readonly_93 = { value: string };
type Auth_Font_name_readonly_93 = { value: string };
type _check_Font_name_readonly_93 = IsExact<Ref_Font_name_readonly_93, Auth_Font_name_readonly_93>;
type _assert_Font_name_readonly_93 = Expect<_check_Font_name_readonly_93>;

type Ref_Font_size_94 = () => number;
type Auth_Font_size_94 = () => number;
type _check_Font_size_94 = IsExact<Ref_Font_size_94, Auth_Font_size_94>;
type _assert_Font_size_94 = Expect<_check_Font_size_94>;

type Ref_Font_size_readonly_95 = { value: number };
type Auth_Font_size_readonly_95 = { value: number };
type _check_Font_size_readonly_95 = IsExact<Ref_Font_size_readonly_95, Auth_Font_size_readonly_95>;
type _assert_Font_size_readonly_95 = Expect<_check_Font_size_readonly_95>;

type Ref_List_getLevelParagraphs_96 = (level: number) => DocxEditor.ParagraphCollection;
type Auth_List_getLevelParagraphs_96 = (level: number) => DocxEditor.ParagraphCollection;
type _check_List_getLevelParagraphs_96 = IsExact<Ref_List_getLevelParagraphs_96, Auth_List_getLevelParagraphs_96>;
type _assert_List_getLevelParagraphs_96 = Expect<_check_List_getLevelParagraphs_96>;

type Ref_List_id_97 = () => number;
type Auth_List_id_97 = () => number;
type _check_List_id_97 = IsExact<Ref_List_id_97, Auth_List_id_97>;
type _assert_List_id_97 = Expect<_check_List_id_97>;

type Ref_List_id_readonly_98 = { readonly value: number };
type Auth_List_id_readonly_98 = { readonly value: number };
type _check_List_id_readonly_98 = IsExact<Ref_List_id_readonly_98, Auth_List_id_readonly_98>;
type _assert_List_id_readonly_98 = Expect<_check_List_id_readonly_98>;

type Ref_List_insertParagraph_99 = (paragraphText: string, insertLocation: "Start" | "End" | "Before" | "After") => DocxEditor.Paragraph;
type Auth_List_insertParagraph_99 = (paragraphText: string, insertLocation: "Start" | "End" | "Before" | "After") => DocxEditor.Paragraph;
type _check_List_insertParagraph_99 = IsExact<Ref_List_insertParagraph_99, Auth_List_insertParagraph_99>;
type _assert_List_insertParagraph_99 = Expect<_check_List_insertParagraph_99>;

type Ref_List_paragraphs_100 = () => DocxEditor.ParagraphCollection;
type Auth_List_paragraphs_100 = () => DocxEditor.ParagraphCollection;
type _check_List_paragraphs_100 = IsExact<Ref_List_paragraphs_100, Auth_List_paragraphs_100>;
type _assert_List_paragraphs_100 = Expect<_check_List_paragraphs_100>;

type Ref_List_paragraphs_readonly_101 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_List_paragraphs_readonly_101 = { readonly value: DocxEditor.ParagraphCollection };
type _check_List_paragraphs_readonly_101 = IsExact<Ref_List_paragraphs_readonly_101, Auth_List_paragraphs_readonly_101>;
type _assert_List_paragraphs_readonly_101 = Expect<_check_List_paragraphs_readonly_101>;

type Ref_ListCollection_getById_102 = (id: number) => DocxEditor.List;
type Auth_ListCollection_getById_102 = (id: number) => DocxEditor.List;
type _check_ListCollection_getById_102 = IsExact<Ref_ListCollection_getById_102, Auth_ListCollection_getById_102>;
type _assert_ListCollection_getById_102 = Expect<_check_ListCollection_getById_102>;

type Ref_ListCollection_getFirst_103 = () => DocxEditor.List;
type Auth_ListCollection_getFirst_103 = () => DocxEditor.List;
type _check_ListCollection_getFirst_103 = IsExact<Ref_ListCollection_getFirst_103, Auth_ListCollection_getFirst_103>;
type _assert_ListCollection_getFirst_103 = Expect<_check_ListCollection_getFirst_103>;

type Ref_ListCollection_items_104 = () => DocxEditor.List[];
type Auth_ListCollection_items_104 = () => DocxEditor.List[];
type _check_ListCollection_items_104 = IsExact<Ref_ListCollection_items_104, Auth_ListCollection_items_104>;
type _assert_ListCollection_items_104 = Expect<_check_ListCollection_items_104>;

type Ref_ListCollection_items_readonly_105 = { readonly value: DocxEditor.List[] };
type Auth_ListCollection_items_readonly_105 = { readonly value: DocxEditor.List[] };
type _check_ListCollection_items_readonly_105 = IsExact<Ref_ListCollection_items_readonly_105, Auth_ListCollection_items_readonly_105>;
type _assert_ListCollection_items_readonly_105 = Expect<_check_ListCollection_items_readonly_105>;

type Ref_ListItem_level_106 = () => number;
type Auth_ListItem_level_106 = () => number;
type _check_ListItem_level_106 = IsExact<Ref_ListItem_level_106, Auth_ListItem_level_106>;
type _assert_ListItem_level_106 = Expect<_check_ListItem_level_106>;

type Ref_ListItem_level_readonly_107 = { value: number };
type Auth_ListItem_level_readonly_107 = { value: number };
type _check_ListItem_level_readonly_107 = IsExact<Ref_ListItem_level_readonly_107, Auth_ListItem_level_readonly_107>;
type _assert_ListItem_level_readonly_107 = Expect<_check_ListItem_level_readonly_107>;

type Ref_NoteItem_body_108 = () => DocxEditor.Body;
type Auth_NoteItem_body_108 = () => DocxEditor.Body;
type _check_NoteItem_body_108 = IsExact<Ref_NoteItem_body_108, Auth_NoteItem_body_108>;
type _assert_NoteItem_body_108 = Expect<_check_NoteItem_body_108>;

type Ref_NoteItem_body_readonly_109 = { readonly value: DocxEditor.Body };
type Auth_NoteItem_body_readonly_109 = { readonly value: DocxEditor.Body };
type _check_NoteItem_body_readonly_109 = IsExact<Ref_NoteItem_body_readonly_109, Auth_NoteItem_body_readonly_109>;
type _assert_NoteItem_body_readonly_109 = Expect<_check_NoteItem_body_readonly_109>;

type Ref_NoteItem_delete_110 = () => void;
type Auth_NoteItem_delete_110 = () => void;
type _check_NoteItem_delete_110 = IsExact<Ref_NoteItem_delete_110, Auth_NoteItem_delete_110>;
type _assert_NoteItem_delete_110 = Expect<_check_NoteItem_delete_110>;

type Ref_NoteItem_getNext_111 = () => DocxEditor.NoteItem;
type Auth_NoteItem_getNext_111 = () => DocxEditor.NoteItem;
type _check_NoteItem_getNext_111 = IsExact<Ref_NoteItem_getNext_111, Auth_NoteItem_getNext_111>;
type _assert_NoteItem_getNext_111 = Expect<_check_NoteItem_getNext_111>;

type Ref_NoteItem_type_112 = () => "Footnote" | "Endnote";
type Auth_NoteItem_type_112 = () => "Footnote" | "Endnote";
type _check_NoteItem_type_112 = IsExact<Ref_NoteItem_type_112, Auth_NoteItem_type_112>;
type _assert_NoteItem_type_112 = Expect<_check_NoteItem_type_112>;

type Ref_NoteItem_type_readonly_113 = { readonly value: "Footnote" | "Endnote" };
type Auth_NoteItem_type_readonly_113 = { readonly value: "Footnote" | "Endnote" };
type _check_NoteItem_type_readonly_113 = IsExact<Ref_NoteItem_type_readonly_113, Auth_NoteItem_type_readonly_113>;
type _assert_NoteItem_type_readonly_113 = Expect<_check_NoteItem_type_readonly_113>;

type Ref_NoteItemCollection_getFirst_114 = () => DocxEditor.NoteItem;
type Auth_NoteItemCollection_getFirst_114 = () => DocxEditor.NoteItem;
type _check_NoteItemCollection_getFirst_114 = IsExact<Ref_NoteItemCollection_getFirst_114, Auth_NoteItemCollection_getFirst_114>;
type _assert_NoteItemCollection_getFirst_114 = Expect<_check_NoteItemCollection_getFirst_114>;

type Ref_NoteItemCollection_items_115 = () => DocxEditor.NoteItem[];
type Auth_NoteItemCollection_items_115 = () => DocxEditor.NoteItem[];
type _check_NoteItemCollection_items_115 = IsExact<Ref_NoteItemCollection_items_115, Auth_NoteItemCollection_items_115>;
type _assert_NoteItemCollection_items_115 = Expect<_check_NoteItemCollection_items_115>;

type Ref_NoteItemCollection_items_readonly_116 = { readonly value: DocxEditor.NoteItem[] };
type Auth_NoteItemCollection_items_readonly_116 = { readonly value: DocxEditor.NoteItem[] };
type _check_NoteItemCollection_items_readonly_116 = IsExact<Ref_NoteItemCollection_items_readonly_116, Auth_NoteItemCollection_items_readonly_116>;
type _assert_NoteItemCollection_items_readonly_116 = Expect<_check_NoteItemCollection_items_readonly_116>;

type Ref_PageSetup_bottomMargin_117 = () => number;
type Auth_PageSetup_bottomMargin_117 = () => number;
type _check_PageSetup_bottomMargin_117 = IsExact<Ref_PageSetup_bottomMargin_117, Auth_PageSetup_bottomMargin_117>;
type _assert_PageSetup_bottomMargin_117 = Expect<_check_PageSetup_bottomMargin_117>;

type Ref_PageSetup_bottomMargin_readonly_118 = { value: number };
type Auth_PageSetup_bottomMargin_readonly_118 = { value: number };
type _check_PageSetup_bottomMargin_readonly_118 = IsExact<Ref_PageSetup_bottomMargin_readonly_118, Auth_PageSetup_bottomMargin_readonly_118>;
type _assert_PageSetup_bottomMargin_readonly_118 = Expect<_check_PageSetup_bottomMargin_readonly_118>;

type Ref_PageSetup_leftMargin_119 = () => number;
type Auth_PageSetup_leftMargin_119 = () => number;
type _check_PageSetup_leftMargin_119 = IsExact<Ref_PageSetup_leftMargin_119, Auth_PageSetup_leftMargin_119>;
type _assert_PageSetup_leftMargin_119 = Expect<_check_PageSetup_leftMargin_119>;

type Ref_PageSetup_leftMargin_readonly_120 = { value: number };
type Auth_PageSetup_leftMargin_readonly_120 = { value: number };
type _check_PageSetup_leftMargin_readonly_120 = IsExact<Ref_PageSetup_leftMargin_readonly_120, Auth_PageSetup_leftMargin_readonly_120>;
type _assert_PageSetup_leftMargin_readonly_120 = Expect<_check_PageSetup_leftMargin_readonly_120>;

type Ref_PageSetup_orientation_121 = () => "Portrait" | "Landscape";
type Auth_PageSetup_orientation_121 = () => "Portrait" | "Landscape";
type _check_PageSetup_orientation_121 = IsExact<Ref_PageSetup_orientation_121, Auth_PageSetup_orientation_121>;
type _assert_PageSetup_orientation_121 = Expect<_check_PageSetup_orientation_121>;

type Ref_PageSetup_orientation_readonly_122 = { value: "Portrait" | "Landscape" };
type Auth_PageSetup_orientation_readonly_122 = { value: "Portrait" | "Landscape" };
type _check_PageSetup_orientation_readonly_122 = IsExact<Ref_PageSetup_orientation_readonly_122, Auth_PageSetup_orientation_readonly_122>;
type _assert_PageSetup_orientation_readonly_122 = Expect<_check_PageSetup_orientation_readonly_122>;

type Ref_PageSetup_pageHeight_123 = () => number;
type Auth_PageSetup_pageHeight_123 = () => number;
type _check_PageSetup_pageHeight_123 = IsExact<Ref_PageSetup_pageHeight_123, Auth_PageSetup_pageHeight_123>;
type _assert_PageSetup_pageHeight_123 = Expect<_check_PageSetup_pageHeight_123>;

type Ref_PageSetup_pageHeight_readonly_124 = { value: number };
type Auth_PageSetup_pageHeight_readonly_124 = { value: number };
type _check_PageSetup_pageHeight_readonly_124 = IsExact<Ref_PageSetup_pageHeight_readonly_124, Auth_PageSetup_pageHeight_readonly_124>;
type _assert_PageSetup_pageHeight_readonly_124 = Expect<_check_PageSetup_pageHeight_readonly_124>;

type Ref_PageSetup_pageWidth_125 = () => number;
type Auth_PageSetup_pageWidth_125 = () => number;
type _check_PageSetup_pageWidth_125 = IsExact<Ref_PageSetup_pageWidth_125, Auth_PageSetup_pageWidth_125>;
type _assert_PageSetup_pageWidth_125 = Expect<_check_PageSetup_pageWidth_125>;

type Ref_PageSetup_pageWidth_readonly_126 = { value: number };
type Auth_PageSetup_pageWidth_readonly_126 = { value: number };
type _check_PageSetup_pageWidth_readonly_126 = IsExact<Ref_PageSetup_pageWidth_readonly_126, Auth_PageSetup_pageWidth_readonly_126>;
type _assert_PageSetup_pageWidth_readonly_126 = Expect<_check_PageSetup_pageWidth_readonly_126>;

type Ref_PageSetup_rightMargin_127 = () => number;
type Auth_PageSetup_rightMargin_127 = () => number;
type _check_PageSetup_rightMargin_127 = IsExact<Ref_PageSetup_rightMargin_127, Auth_PageSetup_rightMargin_127>;
type _assert_PageSetup_rightMargin_127 = Expect<_check_PageSetup_rightMargin_127>;

type Ref_PageSetup_rightMargin_readonly_128 = { value: number };
type Auth_PageSetup_rightMargin_readonly_128 = { value: number };
type _check_PageSetup_rightMargin_readonly_128 = IsExact<Ref_PageSetup_rightMargin_readonly_128, Auth_PageSetup_rightMargin_readonly_128>;
type _assert_PageSetup_rightMargin_readonly_128 = Expect<_check_PageSetup_rightMargin_readonly_128>;

type Ref_PageSetup_topMargin_129 = () => number;
type Auth_PageSetup_topMargin_129 = () => number;
type _check_PageSetup_topMargin_129 = IsExact<Ref_PageSetup_topMargin_129, Auth_PageSetup_topMargin_129>;
type _assert_PageSetup_topMargin_129 = Expect<_check_PageSetup_topMargin_129>;

type Ref_PageSetup_topMargin_readonly_130 = { value: number };
type Auth_PageSetup_topMargin_readonly_130 = { value: number };
type _check_PageSetup_topMargin_readonly_130 = IsExact<Ref_PageSetup_topMargin_readonly_130, Auth_PageSetup_topMargin_readonly_130>;
type _assert_PageSetup_topMargin_readonly_130 = Expect<_check_PageSetup_topMargin_readonly_130>;

type Ref_Paragraph_alignment_131 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type Auth_Paragraph_alignment_131 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type _check_Paragraph_alignment_131 = IsExact<Ref_Paragraph_alignment_131, Auth_Paragraph_alignment_131>;
type _assert_Paragraph_alignment_131 = Expect<_check_Paragraph_alignment_131>;

type Ref_Paragraph_alignment_readonly_132 = { value: "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified" };
type Auth_Paragraph_alignment_readonly_132 = { value: "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified" };
type _check_Paragraph_alignment_readonly_132 = IsExact<Ref_Paragraph_alignment_readonly_132, Auth_Paragraph_alignment_readonly_132>;
type _assert_Paragraph_alignment_readonly_132 = Expect<_check_Paragraph_alignment_readonly_132>;

type Ref_Paragraph_clear_133 = () => void;
type Auth_Paragraph_clear_133 = () => void;
type _check_Paragraph_clear_133 = IsExact<Ref_Paragraph_clear_133, Auth_Paragraph_clear_133>;
type _assert_Paragraph_clear_133 = Expect<_check_Paragraph_clear_133>;

type Ref_Paragraph_contentControls_134 = () => DocxEditor.ContentControlCollection;
type Auth_Paragraph_contentControls_134 = () => DocxEditor.ContentControlCollection;
type _check_Paragraph_contentControls_134 = IsExact<Ref_Paragraph_contentControls_134, Auth_Paragraph_contentControls_134>;
type _assert_Paragraph_contentControls_134 = Expect<_check_Paragraph_contentControls_134>;

type Ref_Paragraph_contentControls_readonly_135 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Paragraph_contentControls_readonly_135 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Paragraph_contentControls_readonly_135 = IsExact<Ref_Paragraph_contentControls_readonly_135, Auth_Paragraph_contentControls_readonly_135>;
type _assert_Paragraph_contentControls_readonly_135 = Expect<_check_Paragraph_contentControls_readonly_135>;

type Ref_Paragraph_delete_136 = () => void;
type Auth_Paragraph_delete_136 = () => void;
type _check_Paragraph_delete_136 = IsExact<Ref_Paragraph_delete_136, Auth_Paragraph_delete_136>;
type _assert_Paragraph_delete_136 = Expect<_check_Paragraph_delete_136>;

type Ref_Paragraph_firstLineIndent_137 = () => number;
type Auth_Paragraph_firstLineIndent_137 = () => number;
type _check_Paragraph_firstLineIndent_137 = IsExact<Ref_Paragraph_firstLineIndent_137, Auth_Paragraph_firstLineIndent_137>;
type _assert_Paragraph_firstLineIndent_137 = Expect<_check_Paragraph_firstLineIndent_137>;

type Ref_Paragraph_firstLineIndent_readonly_138 = { value: number };
type Auth_Paragraph_firstLineIndent_readonly_138 = { value: number };
type _check_Paragraph_firstLineIndent_readonly_138 = IsExact<Ref_Paragraph_firstLineIndent_readonly_138, Auth_Paragraph_firstLineIndent_readonly_138>;
type _assert_Paragraph_firstLineIndent_readonly_138 = Expect<_check_Paragraph_firstLineIndent_readonly_138>;

type Ref_Paragraph_font_139 = () => DocxEditor.Font;
type Auth_Paragraph_font_139 = () => DocxEditor.Font;
type _check_Paragraph_font_139 = IsExact<Ref_Paragraph_font_139, Auth_Paragraph_font_139>;
type _assert_Paragraph_font_139 = Expect<_check_Paragraph_font_139>;

type Ref_Paragraph_font_readonly_140 = { readonly value: DocxEditor.Font };
type Auth_Paragraph_font_readonly_140 = { readonly value: DocxEditor.Font };
type _check_Paragraph_font_readonly_140 = IsExact<Ref_Paragraph_font_readonly_140, Auth_Paragraph_font_readonly_140>;
type _assert_Paragraph_font_readonly_140 = Expect<_check_Paragraph_font_readonly_140>;

type Ref_Paragraph_insertParagraph_141 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Paragraph_insertParagraph_141 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Paragraph_insertParagraph_141 = IsExact<Ref_Paragraph_insertParagraph_141, Auth_Paragraph_insertParagraph_141>;
type _assert_Paragraph_insertParagraph_141 = Expect<_check_Paragraph_insertParagraph_141>;

type Ref_Paragraph_insertText_142 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Paragraph_insertText_142 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Paragraph_insertText_142 = IsExact<Ref_Paragraph_insertText_142, Auth_Paragraph_insertText_142>;
type _assert_Paragraph_insertText_142 = Expect<_check_Paragraph_insertText_142>;

type Ref_Paragraph_leftIndent_143 = () => number;
type Auth_Paragraph_leftIndent_143 = () => number;
type _check_Paragraph_leftIndent_143 = IsExact<Ref_Paragraph_leftIndent_143, Auth_Paragraph_leftIndent_143>;
type _assert_Paragraph_leftIndent_143 = Expect<_check_Paragraph_leftIndent_143>;

type Ref_Paragraph_leftIndent_readonly_144 = { value: number };
type Auth_Paragraph_leftIndent_readonly_144 = { value: number };
type _check_Paragraph_leftIndent_readonly_144 = IsExact<Ref_Paragraph_leftIndent_readonly_144, Auth_Paragraph_leftIndent_readonly_144>;
type _assert_Paragraph_leftIndent_readonly_144 = Expect<_check_Paragraph_leftIndent_readonly_144>;

type Ref_Paragraph_lineSpacing_145 = () => number;
type Auth_Paragraph_lineSpacing_145 = () => number;
type _check_Paragraph_lineSpacing_145 = IsExact<Ref_Paragraph_lineSpacing_145, Auth_Paragraph_lineSpacing_145>;
type _assert_Paragraph_lineSpacing_145 = Expect<_check_Paragraph_lineSpacing_145>;

type Ref_Paragraph_lineSpacing_readonly_146 = { value: number };
type Auth_Paragraph_lineSpacing_readonly_146 = { value: number };
type _check_Paragraph_lineSpacing_readonly_146 = IsExact<Ref_Paragraph_lineSpacing_readonly_146, Auth_Paragraph_lineSpacing_readonly_146>;
type _assert_Paragraph_lineSpacing_readonly_146 = Expect<_check_Paragraph_lineSpacing_readonly_146>;

type Ref_Paragraph_list_147 = () => DocxEditor.List;
type Auth_Paragraph_list_147 = () => DocxEditor.List;
type _check_Paragraph_list_147 = IsExact<Ref_Paragraph_list_147, Auth_Paragraph_list_147>;
type _assert_Paragraph_list_147 = Expect<_check_Paragraph_list_147>;

type Ref_Paragraph_list_readonly_148 = { readonly value: DocxEditor.List };
type Auth_Paragraph_list_readonly_148 = { readonly value: DocxEditor.List };
type _check_Paragraph_list_readonly_148 = IsExact<Ref_Paragraph_list_readonly_148, Auth_Paragraph_list_readonly_148>;
type _assert_Paragraph_list_readonly_148 = Expect<_check_Paragraph_list_readonly_148>;

type Ref_Paragraph_listItem_149 = () => DocxEditor.ListItem;
type Auth_Paragraph_listItem_149 = () => DocxEditor.ListItem;
type _check_Paragraph_listItem_149 = IsExact<Ref_Paragraph_listItem_149, Auth_Paragraph_listItem_149>;
type _assert_Paragraph_listItem_149 = Expect<_check_Paragraph_listItem_149>;

type Ref_Paragraph_listItem_readonly_150 = { readonly value: DocxEditor.ListItem };
type Auth_Paragraph_listItem_readonly_150 = { readonly value: DocxEditor.ListItem };
type _check_Paragraph_listItem_readonly_150 = IsExact<Ref_Paragraph_listItem_readonly_150, Auth_Paragraph_listItem_readonly_150>;
type _assert_Paragraph_listItem_readonly_150 = Expect<_check_Paragraph_listItem_readonly_150>;

type Ref_Paragraph_rightIndent_151 = () => number;
type Auth_Paragraph_rightIndent_151 = () => number;
type _check_Paragraph_rightIndent_151 = IsExact<Ref_Paragraph_rightIndent_151, Auth_Paragraph_rightIndent_151>;
type _assert_Paragraph_rightIndent_151 = Expect<_check_Paragraph_rightIndent_151>;

type Ref_Paragraph_rightIndent_readonly_152 = { value: number };
type Auth_Paragraph_rightIndent_readonly_152 = { value: number };
type _check_Paragraph_rightIndent_readonly_152 = IsExact<Ref_Paragraph_rightIndent_readonly_152, Auth_Paragraph_rightIndent_readonly_152>;
type _assert_Paragraph_rightIndent_readonly_152 = Expect<_check_Paragraph_rightIndent_readonly_152>;

type Ref_Paragraph_spaceAfter_153 = () => number;
type Auth_Paragraph_spaceAfter_153 = () => number;
type _check_Paragraph_spaceAfter_153 = IsExact<Ref_Paragraph_spaceAfter_153, Auth_Paragraph_spaceAfter_153>;
type _assert_Paragraph_spaceAfter_153 = Expect<_check_Paragraph_spaceAfter_153>;

type Ref_Paragraph_spaceAfter_readonly_154 = { value: number };
type Auth_Paragraph_spaceAfter_readonly_154 = { value: number };
type _check_Paragraph_spaceAfter_readonly_154 = IsExact<Ref_Paragraph_spaceAfter_readonly_154, Auth_Paragraph_spaceAfter_readonly_154>;
type _assert_Paragraph_spaceAfter_readonly_154 = Expect<_check_Paragraph_spaceAfter_readonly_154>;

type Ref_Paragraph_spaceBefore_155 = () => number;
type Auth_Paragraph_spaceBefore_155 = () => number;
type _check_Paragraph_spaceBefore_155 = IsExact<Ref_Paragraph_spaceBefore_155, Auth_Paragraph_spaceBefore_155>;
type _assert_Paragraph_spaceBefore_155 = Expect<_check_Paragraph_spaceBefore_155>;

type Ref_Paragraph_spaceBefore_readonly_156 = { value: number };
type Auth_Paragraph_spaceBefore_readonly_156 = { value: number };
type _check_Paragraph_spaceBefore_readonly_156 = IsExact<Ref_Paragraph_spaceBefore_readonly_156, Auth_Paragraph_spaceBefore_readonly_156>;
type _assert_Paragraph_spaceBefore_readonly_156 = Expect<_check_Paragraph_spaceBefore_readonly_156>;

type Ref_Paragraph_split_157 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type Auth_Paragraph_split_157 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type _check_Paragraph_split_157 = IsExact<Ref_Paragraph_split_157, Auth_Paragraph_split_157>;
type _assert_Paragraph_split_157 = Expect<_check_Paragraph_split_157>;

type Ref_Paragraph_style_158 = () => string;
type Auth_Paragraph_style_158 = () => string;
type _check_Paragraph_style_158 = IsExact<Ref_Paragraph_style_158, Auth_Paragraph_style_158>;
type _assert_Paragraph_style_158 = Expect<_check_Paragraph_style_158>;

type Ref_Paragraph_style_readonly_159 = { value: string };
type Auth_Paragraph_style_readonly_159 = { value: string };
type _check_Paragraph_style_readonly_159 = IsExact<Ref_Paragraph_style_readonly_159, Auth_Paragraph_style_readonly_159>;
type _assert_Paragraph_style_readonly_159 = Expect<_check_Paragraph_style_readonly_159>;

type Ref_Paragraph_text_160 = () => string;
type Auth_Paragraph_text_160 = () => string;
type _check_Paragraph_text_160 = IsExact<Ref_Paragraph_text_160, Auth_Paragraph_text_160>;
type _assert_Paragraph_text_160 = Expect<_check_Paragraph_text_160>;

type Ref_Paragraph_text_readonly_161 = { readonly value: string };
type Auth_Paragraph_text_readonly_161 = { readonly value: string };
type _check_Paragraph_text_readonly_161 = IsExact<Ref_Paragraph_text_readonly_161, Auth_Paragraph_text_readonly_161>;
type _assert_Paragraph_text_readonly_161 = Expect<_check_Paragraph_text_readonly_161>;

type Ref_ParagraphCollection_getFirst_162 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getFirst_162 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getFirst_162 = IsExact<Ref_ParagraphCollection_getFirst_162, Auth_ParagraphCollection_getFirst_162>;
type _assert_ParagraphCollection_getFirst_162 = Expect<_check_ParagraphCollection_getFirst_162>;

type Ref_ParagraphCollection_getLast_163 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getLast_163 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getLast_163 = IsExact<Ref_ParagraphCollection_getLast_163, Auth_ParagraphCollection_getLast_163>;
type _assert_ParagraphCollection_getLast_163 = Expect<_check_ParagraphCollection_getLast_163>;

type Ref_ParagraphCollection_items_164 = () => DocxEditor.Paragraph[];
type Auth_ParagraphCollection_items_164 = () => DocxEditor.Paragraph[];
type _check_ParagraphCollection_items_164 = IsExact<Ref_ParagraphCollection_items_164, Auth_ParagraphCollection_items_164>;
type _assert_ParagraphCollection_items_164 = Expect<_check_ParagraphCollection_items_164>;

type Ref_ParagraphCollection_items_readonly_165 = { readonly value: DocxEditor.Paragraph[] };
type Auth_ParagraphCollection_items_readonly_165 = { readonly value: DocxEditor.Paragraph[] };
type _check_ParagraphCollection_items_readonly_165 = IsExact<Ref_ParagraphCollection_items_readonly_165, Auth_ParagraphCollection_items_readonly_165>;
type _assert_ParagraphCollection_items_readonly_165 = Expect<_check_ParagraphCollection_items_readonly_165>;

type Ref_Range_bookmarks_166 = () => DocxEditor.BookmarkCollection;
type Auth_Range_bookmarks_166 = () => DocxEditor.BookmarkCollection;
type _check_Range_bookmarks_166 = IsExact<Ref_Range_bookmarks_166, Auth_Range_bookmarks_166>;
type _assert_Range_bookmarks_166 = Expect<_check_Range_bookmarks_166>;

type Ref_Range_bookmarks_readonly_167 = { readonly value: DocxEditor.BookmarkCollection };
type Auth_Range_bookmarks_readonly_167 = { readonly value: DocxEditor.BookmarkCollection };
type _check_Range_bookmarks_readonly_167 = IsExact<Ref_Range_bookmarks_readonly_167, Auth_Range_bookmarks_readonly_167>;
type _assert_Range_bookmarks_readonly_167 = Expect<_check_Range_bookmarks_readonly_167>;

type Ref_Range_contentControls_168 = () => DocxEditor.ContentControlCollection;
type Auth_Range_contentControls_168 = () => DocxEditor.ContentControlCollection;
type _check_Range_contentControls_168 = IsExact<Ref_Range_contentControls_168, Auth_Range_contentControls_168>;
type _assert_Range_contentControls_168 = Expect<_check_Range_contentControls_168>;

type Ref_Range_contentControls_readonly_169 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Range_contentControls_readonly_169 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Range_contentControls_readonly_169 = IsExact<Ref_Range_contentControls_readonly_169, Auth_Range_contentControls_readonly_169>;
type _assert_Range_contentControls_readonly_169 = Expect<_check_Range_contentControls_readonly_169>;

type Ref_Range_font_170 = () => DocxEditor.Font;
type Auth_Range_font_170 = () => DocxEditor.Font;
type _check_Range_font_170 = IsExact<Ref_Range_font_170, Auth_Range_font_170>;
type _assert_Range_font_170 = Expect<_check_Range_font_170>;

type Ref_Range_font_readonly_171 = { readonly value: DocxEditor.Font };
type Auth_Range_font_readonly_171 = { readonly value: DocxEditor.Font };
type _check_Range_font_readonly_171 = IsExact<Ref_Range_font_readonly_171, Auth_Range_font_readonly_171>;
type _assert_Range_font_readonly_171 = Expect<_check_Range_font_readonly_171>;

type Ref_Range_hyperlink_172 = () => string;
type Auth_Range_hyperlink_172 = () => string;
type _check_Range_hyperlink_172 = IsExact<Ref_Range_hyperlink_172, Auth_Range_hyperlink_172>;
type _assert_Range_hyperlink_172 = Expect<_check_Range_hyperlink_172>;

type Ref_Range_hyperlink_readonly_173 = { value: string };
type Auth_Range_hyperlink_readonly_173 = { value: string };
type _check_Range_hyperlink_readonly_173 = IsExact<Ref_Range_hyperlink_readonly_173, Auth_Range_hyperlink_readonly_173>;
type _assert_Range_hyperlink_readonly_173 = Expect<_check_Range_hyperlink_readonly_173>;

type Ref_Range_insertComment_174 = (commentText: string) => DocxEditor.Comment;
type Auth_Range_insertComment_174 = (commentText: string) => DocxEditor.Comment;
type _check_Range_insertComment_174 = IsExact<Ref_Range_insertComment_174, Auth_Range_insertComment_174>;
type _assert_Range_insertComment_174 = Expect<_check_Range_insertComment_174>;

type Ref_Range_insertParagraph_175 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Range_insertParagraph_175 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Range_insertParagraph_175 = IsExact<Ref_Range_insertParagraph_175, Auth_Range_insertParagraph_175>;
type _assert_Range_insertParagraph_175 = Expect<_check_Range_insertParagraph_175>;

type Ref_Range_insertText_176 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type Auth_Range_insertText_176 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type _check_Range_insertText_176 = IsExact<Ref_Range_insertText_176, Auth_Range_insertText_176>;
type _assert_Range_insertText_176 = Expect<_check_Range_insertText_176>;

type Ref_Range_paragraphs_177 = () => DocxEditor.ParagraphCollection;
type Auth_Range_paragraphs_177 = () => DocxEditor.ParagraphCollection;
type _check_Range_paragraphs_177 = IsExact<Ref_Range_paragraphs_177, Auth_Range_paragraphs_177>;
type _assert_Range_paragraphs_177 = Expect<_check_Range_paragraphs_177>;

type Ref_Range_paragraphs_readonly_178 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Range_paragraphs_readonly_178 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Range_paragraphs_readonly_178 = IsExact<Ref_Range_paragraphs_readonly_178, Auth_Range_paragraphs_readonly_178>;
type _assert_Range_paragraphs_readonly_178 = Expect<_check_Range_paragraphs_readonly_178>;

type Ref_Range_search_179 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Range_search_179 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Range_search_179 = IsExact<Ref_Range_search_179, Auth_Range_search_179>;
type _assert_Range_search_179 = Expect<_check_Range_search_179>;

type Ref_Range_select_180 = (selectionMode?: DocxEditor.SelectionMode) => void;
type Auth_Range_select_180 = (selectionMode?: DocxEditor.SelectionMode) => void;
type _check_Range_select_180 = IsExact<Ref_Range_select_180, Auth_Range_select_180>;
type _assert_Range_select_180 = Expect<_check_Range_select_180>;

type Ref_Range_select_181 = (selectionMode?: "Select" | "Start" | "End") => void;
type Auth_Range_select_181 = (selectionMode?: "Select" | "Start" | "End") => void;
type _check_Range_select_181 = IsExact<Ref_Range_select_181, Auth_Range_select_181>;
type _assert_Range_select_181 = Expect<_check_Range_select_181>;

type Ref_Range_style_182 = () => string;
type Auth_Range_style_182 = () => string;
type _check_Range_style_182 = IsExact<Ref_Range_style_182, Auth_Range_style_182>;
type _assert_Range_style_182 = Expect<_check_Range_style_182>;

type Ref_Range_style_readonly_183 = { value: string };
type Auth_Range_style_readonly_183 = { value: string };
type _check_Range_style_readonly_183 = IsExact<Ref_Range_style_readonly_183, Auth_Range_style_readonly_183>;
type _assert_Range_style_readonly_183 = Expect<_check_Range_style_readonly_183>;

type Ref_Range_text_184 = () => string;
type Auth_Range_text_184 = () => string;
type _check_Range_text_184 = IsExact<Ref_Range_text_184, Auth_Range_text_184>;
type _assert_Range_text_184 = Expect<_check_Range_text_184>;

type Ref_Range_text_readonly_185 = { readonly value: string };
type Auth_Range_text_readonly_185 = { readonly value: string };
type _check_Range_text_readonly_185 = IsExact<Ref_Range_text_readonly_185, Auth_Range_text_readonly_185>;
type _assert_Range_text_readonly_185 = Expect<_check_Range_text_readonly_185>;

type Ref_RangeCollection_getFirst_186 = () => DocxEditor.Range;
type Auth_RangeCollection_getFirst_186 = () => DocxEditor.Range;
type _check_RangeCollection_getFirst_186 = IsExact<Ref_RangeCollection_getFirst_186, Auth_RangeCollection_getFirst_186>;
type _assert_RangeCollection_getFirst_186 = Expect<_check_RangeCollection_getFirst_186>;

type Ref_RangeCollection_items_187 = () => DocxEditor.Range[];
type Auth_RangeCollection_items_187 = () => DocxEditor.Range[];
type _check_RangeCollection_items_187 = IsExact<Ref_RangeCollection_items_187, Auth_RangeCollection_items_187>;
type _assert_RangeCollection_items_187 = Expect<_check_RangeCollection_items_187>;

type Ref_RangeCollection_items_readonly_188 = { readonly value: DocxEditor.Range[] };
type Auth_RangeCollection_items_readonly_188 = { readonly value: DocxEditor.Range[] };
type _check_RangeCollection_items_readonly_188 = IsExact<Ref_RangeCollection_items_readonly_188, Auth_RangeCollection_items_readonly_188>;
type _assert_RangeCollection_items_readonly_188 = Expect<_check_RangeCollection_items_readonly_188>;

type Ref_RequestContext_document_189 = () => DocxEditor.Document;
type Auth_RequestContext_document_189 = () => DocxEditor.Document;
type _check_RequestContext_document_189 = IsExact<Ref_RequestContext_document_189, Auth_RequestContext_document_189>;
type _assert_RequestContext_document_189 = Expect<_check_RequestContext_document_189>;

type Ref_RequestContext_document_readonly_190 = { readonly value: DocxEditor.Document };
type Auth_RequestContext_document_readonly_190 = { readonly value: DocxEditor.Document };
type _check_RequestContext_document_readonly_190 = IsExact<Ref_RequestContext_document_readonly_190, Auth_RequestContext_document_readonly_190>;
type _assert_RequestContext_document_readonly_190 = Expect<_check_RequestContext_document_readonly_190>;

type Ref_Revision_accept_191 = () => void;
type Auth_Revision_accept_191 = () => void;
type _check_Revision_accept_191 = IsExact<Ref_Revision_accept_191, Auth_Revision_accept_191>;
type _assert_Revision_accept_191 = Expect<_check_Revision_accept_191>;

type Ref_Revision_author_192 = () => string;
type Auth_Revision_author_192 = () => string;
type _check_Revision_author_192 = IsExact<Ref_Revision_author_192, Auth_Revision_author_192>;
type _assert_Revision_author_192 = Expect<_check_Revision_author_192>;

type Ref_Revision_author_readonly_193 = { readonly value: string };
type Auth_Revision_author_readonly_193 = { readonly value: string };
type _check_Revision_author_readonly_193 = IsExact<Ref_Revision_author_readonly_193, Auth_Revision_author_readonly_193>;
type _assert_Revision_author_readonly_193 = Expect<_check_Revision_author_readonly_193>;

type Ref_Revision_date_194 = () => Date;
type Auth_Revision_date_194 = () => Date;
type _check_Revision_date_194 = IsExact<Ref_Revision_date_194, Auth_Revision_date_194>;
type _assert_Revision_date_194 = Expect<_check_Revision_date_194>;

type Ref_Revision_date_readonly_195 = { readonly value: Date };
type Auth_Revision_date_readonly_195 = { readonly value: Date };
type _check_Revision_date_readonly_195 = IsExact<Ref_Revision_date_readonly_195, Auth_Revision_date_readonly_195>;
type _assert_Revision_date_readonly_195 = Expect<_check_Revision_date_readonly_195>;

type Ref_Revision_range_196 = () => DocxEditor.Range;
type Auth_Revision_range_196 = () => DocxEditor.Range;
type _check_Revision_range_196 = IsExact<Ref_Revision_range_196, Auth_Revision_range_196>;
type _assert_Revision_range_196 = Expect<_check_Revision_range_196>;

type Ref_Revision_range_readonly_197 = { readonly value: DocxEditor.Range };
type Auth_Revision_range_readonly_197 = { readonly value: DocxEditor.Range };
type _check_Revision_range_readonly_197 = IsExact<Ref_Revision_range_readonly_197, Auth_Revision_range_readonly_197>;
type _assert_Revision_range_readonly_197 = Expect<_check_Revision_range_readonly_197>;

type Ref_Revision_reject_198 = () => void;
type Auth_Revision_reject_198 = () => void;
type _check_Revision_reject_198 = IsExact<Ref_Revision_reject_198, Auth_Revision_reject_198>;
type _assert_Revision_reject_198 = Expect<_check_Revision_reject_198>;

type Ref_Revision_type_199 = () => "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete";
type Auth_Revision_type_199 = () => "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete";
type _check_Revision_type_199 = IsExact<Ref_Revision_type_199, Auth_Revision_type_199>;
type _assert_Revision_type_199 = Expect<_check_Revision_type_199>;

type Ref_Revision_type_readonly_200 = { readonly value: "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete" };
type Auth_Revision_type_readonly_200 = { readonly value: "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete" };
type _check_Revision_type_readonly_200 = IsExact<Ref_Revision_type_readonly_200, Auth_Revision_type_readonly_200>;
type _assert_Revision_type_readonly_200 = Expect<_check_Revision_type_readonly_200>;

type Ref_RevisionCollection_acceptAll_201 = () => void;
type Auth_RevisionCollection_acceptAll_201 = () => void;
type _check_RevisionCollection_acceptAll_201 = IsExact<Ref_RevisionCollection_acceptAll_201, Auth_RevisionCollection_acceptAll_201>;
type _assert_RevisionCollection_acceptAll_201 = Expect<_check_RevisionCollection_acceptAll_201>;

type Ref_RevisionCollection_items_202 = () => DocxEditor.Revision[];
type Auth_RevisionCollection_items_202 = () => DocxEditor.Revision[];
type _check_RevisionCollection_items_202 = IsExact<Ref_RevisionCollection_items_202, Auth_RevisionCollection_items_202>;
type _assert_RevisionCollection_items_202 = Expect<_check_RevisionCollection_items_202>;

type Ref_RevisionCollection_items_readonly_203 = { readonly value: DocxEditor.Revision[] };
type Auth_RevisionCollection_items_readonly_203 = { readonly value: DocxEditor.Revision[] };
type _check_RevisionCollection_items_readonly_203 = IsExact<Ref_RevisionCollection_items_readonly_203, Auth_RevisionCollection_items_readonly_203>;
type _assert_RevisionCollection_items_readonly_203 = Expect<_check_RevisionCollection_items_readonly_203>;

type Ref_RevisionCollection_rejectAll_204 = () => void;
type Auth_RevisionCollection_rejectAll_204 = () => void;
type _check_RevisionCollection_rejectAll_204 = IsExact<Ref_RevisionCollection_rejectAll_204, Auth_RevisionCollection_rejectAll_204>;
type _assert_RevisionCollection_rejectAll_204 = Expect<_check_RevisionCollection_rejectAll_204>;

type Ref_SearchOptions_ignorePunct_205 = () => boolean;
type Auth_SearchOptions_ignorePunct_205 = () => boolean;
type _check_SearchOptions_ignorePunct_205 = IsExact<Ref_SearchOptions_ignorePunct_205, Auth_SearchOptions_ignorePunct_205>;
type _assert_SearchOptions_ignorePunct_205 = Expect<_check_SearchOptions_ignorePunct_205>;

type Ref_SearchOptions_ignorePunct_readonly_206 = { value: boolean };
type Auth_SearchOptions_ignorePunct_readonly_206 = { value: boolean };
type _check_SearchOptions_ignorePunct_readonly_206 = IsExact<Ref_SearchOptions_ignorePunct_readonly_206, Auth_SearchOptions_ignorePunct_readonly_206>;
type _assert_SearchOptions_ignorePunct_readonly_206 = Expect<_check_SearchOptions_ignorePunct_readonly_206>;

type Ref_SearchOptions_ignoreSpace_207 = () => boolean;
type Auth_SearchOptions_ignoreSpace_207 = () => boolean;
type _check_SearchOptions_ignoreSpace_207 = IsExact<Ref_SearchOptions_ignoreSpace_207, Auth_SearchOptions_ignoreSpace_207>;
type _assert_SearchOptions_ignoreSpace_207 = Expect<_check_SearchOptions_ignoreSpace_207>;

type Ref_SearchOptions_ignoreSpace_readonly_208 = { value: boolean };
type Auth_SearchOptions_ignoreSpace_readonly_208 = { value: boolean };
type _check_SearchOptions_ignoreSpace_readonly_208 = IsExact<Ref_SearchOptions_ignoreSpace_readonly_208, Auth_SearchOptions_ignoreSpace_readonly_208>;
type _assert_SearchOptions_ignoreSpace_readonly_208 = Expect<_check_SearchOptions_ignoreSpace_readonly_208>;

type Ref_SearchOptions_matchCase_209 = () => boolean;
type Auth_SearchOptions_matchCase_209 = () => boolean;
type _check_SearchOptions_matchCase_209 = IsExact<Ref_SearchOptions_matchCase_209, Auth_SearchOptions_matchCase_209>;
type _assert_SearchOptions_matchCase_209 = Expect<_check_SearchOptions_matchCase_209>;

type Ref_SearchOptions_matchCase_readonly_210 = { value: boolean };
type Auth_SearchOptions_matchCase_readonly_210 = { value: boolean };
type _check_SearchOptions_matchCase_readonly_210 = IsExact<Ref_SearchOptions_matchCase_readonly_210, Auth_SearchOptions_matchCase_readonly_210>;
type _assert_SearchOptions_matchCase_readonly_210 = Expect<_check_SearchOptions_matchCase_readonly_210>;

type Ref_SearchOptions_matchWholeWord_211 = () => boolean;
type Auth_SearchOptions_matchWholeWord_211 = () => boolean;
type _check_SearchOptions_matchWholeWord_211 = IsExact<Ref_SearchOptions_matchWholeWord_211, Auth_SearchOptions_matchWholeWord_211>;
type _assert_SearchOptions_matchWholeWord_211 = Expect<_check_SearchOptions_matchWholeWord_211>;

type Ref_SearchOptions_matchWholeWord_readonly_212 = { value: boolean };
type Auth_SearchOptions_matchWholeWord_readonly_212 = { value: boolean };
type _check_SearchOptions_matchWholeWord_readonly_212 = IsExact<Ref_SearchOptions_matchWholeWord_readonly_212, Auth_SearchOptions_matchWholeWord_readonly_212>;
type _assert_SearchOptions_matchWholeWord_readonly_212 = Expect<_check_SearchOptions_matchWholeWord_readonly_212>;

type Ref_SearchOptions_matchWildcards_213 = () => boolean;
type Auth_SearchOptions_matchWildcards_213 = () => boolean;
type _check_SearchOptions_matchWildcards_213 = IsExact<Ref_SearchOptions_matchWildcards_213, Auth_SearchOptions_matchWildcards_213>;
type _assert_SearchOptions_matchWildcards_213 = Expect<_check_SearchOptions_matchWildcards_213>;

type Ref_SearchOptions_matchWildcards_readonly_214 = { value: boolean };
type Auth_SearchOptions_matchWildcards_readonly_214 = { value: boolean };
type _check_SearchOptions_matchWildcards_readonly_214 = IsExact<Ref_SearchOptions_matchWildcards_readonly_214, Auth_SearchOptions_matchWildcards_readonly_214>;
type _assert_SearchOptions_matchWildcards_readonly_214 = Expect<_check_SearchOptions_matchWildcards_readonly_214>;

type Ref_Section_body_215 = () => DocxEditor.Body;
type Auth_Section_body_215 = () => DocxEditor.Body;
type _check_Section_body_215 = IsExact<Ref_Section_body_215, Auth_Section_body_215>;
type _assert_Section_body_215 = Expect<_check_Section_body_215>;

type Ref_Section_body_readonly_216 = { readonly value: DocxEditor.Body };
type Auth_Section_body_readonly_216 = { readonly value: DocxEditor.Body };
type _check_Section_body_readonly_216 = IsExact<Ref_Section_body_readonly_216, Auth_Section_body_readonly_216>;
type _assert_Section_body_readonly_216 = Expect<_check_Section_body_readonly_216>;

type Ref_Section_getFooter_217 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type Auth_Section_getFooter_217 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type _check_Section_getFooter_217 = IsExact<Ref_Section_getFooter_217, Auth_Section_getFooter_217>;
type _assert_Section_getFooter_217 = Expect<_check_Section_getFooter_217>;

type Ref_Section_getFooter_218 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type Auth_Section_getFooter_218 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type _check_Section_getFooter_218 = IsExact<Ref_Section_getFooter_218, Auth_Section_getFooter_218>;
type _assert_Section_getFooter_218 = Expect<_check_Section_getFooter_218>;

type Ref_Section_getHeader_219 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type Auth_Section_getHeader_219 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type _check_Section_getHeader_219 = IsExact<Ref_Section_getHeader_219, Auth_Section_getHeader_219>;
type _assert_Section_getHeader_219 = Expect<_check_Section_getHeader_219>;

type Ref_Section_getHeader_220 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type Auth_Section_getHeader_220 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type _check_Section_getHeader_220 = IsExact<Ref_Section_getHeader_220, Auth_Section_getHeader_220>;
type _assert_Section_getHeader_220 = Expect<_check_Section_getHeader_220>;

type Ref_Section_getNext_221 = () => DocxEditor.Section;
type Auth_Section_getNext_221 = () => DocxEditor.Section;
type _check_Section_getNext_221 = IsExact<Ref_Section_getNext_221, Auth_Section_getNext_221>;
type _assert_Section_getNext_221 = Expect<_check_Section_getNext_221>;

type Ref_Section_pageSetup_222 = () => DocxEditor.PageSetup;
type Auth_Section_pageSetup_222 = () => DocxEditor.PageSetup;
type _check_Section_pageSetup_222 = IsExact<Ref_Section_pageSetup_222, Auth_Section_pageSetup_222>;
type _assert_Section_pageSetup_222 = Expect<_check_Section_pageSetup_222>;

type Ref_Section_pageSetup_readonly_223 = { readonly value: DocxEditor.PageSetup };
type Auth_Section_pageSetup_readonly_223 = { readonly value: DocxEditor.PageSetup };
type _check_Section_pageSetup_readonly_223 = IsExact<Ref_Section_pageSetup_readonly_223, Auth_Section_pageSetup_readonly_223>;
type _assert_Section_pageSetup_readonly_223 = Expect<_check_Section_pageSetup_readonly_223>;

type Ref_SectionCollection_getFirst_224 = () => DocxEditor.Section;
type Auth_SectionCollection_getFirst_224 = () => DocxEditor.Section;
type _check_SectionCollection_getFirst_224 = IsExact<Ref_SectionCollection_getFirst_224, Auth_SectionCollection_getFirst_224>;
type _assert_SectionCollection_getFirst_224 = Expect<_check_SectionCollection_getFirst_224>;

type Ref_SectionCollection_items_225 = () => DocxEditor.Section[];
type Auth_SectionCollection_items_225 = () => DocxEditor.Section[];
type _check_SectionCollection_items_225 = IsExact<Ref_SectionCollection_items_225, Auth_SectionCollection_items_225>;
type _assert_SectionCollection_items_225 = Expect<_check_SectionCollection_items_225>;

type Ref_SectionCollection_items_readonly_226 = { readonly value: DocxEditor.Section[] };
type Auth_SectionCollection_items_readonly_226 = { readonly value: DocxEditor.Section[] };
type _check_SectionCollection_items_readonly_226 = IsExact<Ref_SectionCollection_items_readonly_226, Auth_SectionCollection_items_readonly_226>;
type _assert_SectionCollection_items_readonly_226 = Expect<_check_SectionCollection_items_readonly_226>;

type Ref_run_227 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_227 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_227 = IsExact<Ref_run_227, Auth_run_227>;
type _assert_run_227 = Expect<_check_run_227>;

type Ref_run_228 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_228 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_228 = IsExact<Ref_run_228, Auth_run_228>;
type _assert_run_228 = Expect<_check_run_228>;

type Ref_run_229 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_229 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_229 = IsExact<Ref_run_229, Auth_run_229>;
type _assert_run_229 = Expect<_check_run_229>;

