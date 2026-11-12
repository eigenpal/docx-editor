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

type Ref_ClientObject_context_30 = () => DocxEditor.ClientRequestContext;
type Auth_ClientObject_context_30 = () => DocxEditor.ClientRequestContext;
type _check_ClientObject_context_30 = IsExact<Ref_ClientObject_context_30, Auth_ClientObject_context_30>;
type _assert_ClientObject_context_30 = Expect<_check_ClientObject_context_30>;

type Ref_ClientObject_context_readonly_31 = { value: DocxEditor.ClientRequestContext };
type Auth_ClientObject_context_readonly_31 = { value: DocxEditor.ClientRequestContext };
type _check_ClientObject_context_readonly_31 = IsExact<Ref_ClientObject_context_readonly_31, Auth_ClientObject_context_readonly_31>;
type _assert_ClientObject_context_readonly_31 = Expect<_check_ClientObject_context_readonly_31>;

type Ref_ClientObject_isNullObject_32 = () => boolean;
type Auth_ClientObject_isNullObject_32 = () => boolean;
type _check_ClientObject_isNullObject_32 = IsExact<Ref_ClientObject_isNullObject_32, Auth_ClientObject_isNullObject_32>;
type _assert_ClientObject_isNullObject_32 = Expect<_check_ClientObject_isNullObject_32>;

type Ref_ClientObject_isNullObject_readonly_33 = { value: boolean };
type Auth_ClientObject_isNullObject_readonly_33 = { value: boolean };
type _check_ClientObject_isNullObject_readonly_33 = IsExact<Ref_ClientObject_isNullObject_readonly_33, Auth_ClientObject_isNullObject_readonly_33>;
type _assert_ClientObject_isNullObject_readonly_33 = Expect<_check_ClientObject_isNullObject_readonly_33>;

type Ref_Comment_authorName_34 = () => string;
type Auth_Comment_authorName_34 = () => string;
type _check_Comment_authorName_34 = IsExact<Ref_Comment_authorName_34, Auth_Comment_authorName_34>;
type _assert_Comment_authorName_34 = Expect<_check_Comment_authorName_34>;

type Ref_Comment_authorName_readonly_35 = { readonly value: string };
type Auth_Comment_authorName_readonly_35 = { readonly value: string };
type _check_Comment_authorName_readonly_35 = IsExact<Ref_Comment_authorName_readonly_35, Auth_Comment_authorName_readonly_35>;
type _assert_Comment_authorName_readonly_35 = Expect<_check_Comment_authorName_readonly_35>;

type Ref_Comment_content_36 = () => string;
type Auth_Comment_content_36 = () => string;
type _check_Comment_content_36 = IsExact<Ref_Comment_content_36, Auth_Comment_content_36>;
type _assert_Comment_content_36 = Expect<_check_Comment_content_36>;

type Ref_Comment_content_readonly_37 = { value: string };
type Auth_Comment_content_readonly_37 = { value: string };
type _check_Comment_content_readonly_37 = IsExact<Ref_Comment_content_readonly_37, Auth_Comment_content_readonly_37>;
type _assert_Comment_content_readonly_37 = Expect<_check_Comment_content_readonly_37>;

type Ref_Comment_creationDate_38 = () => Date;
type Auth_Comment_creationDate_38 = () => Date;
type _check_Comment_creationDate_38 = IsExact<Ref_Comment_creationDate_38, Auth_Comment_creationDate_38>;
type _assert_Comment_creationDate_38 = Expect<_check_Comment_creationDate_38>;

type Ref_Comment_creationDate_readonly_39 = { readonly value: Date };
type Auth_Comment_creationDate_readonly_39 = { readonly value: Date };
type _check_Comment_creationDate_readonly_39 = IsExact<Ref_Comment_creationDate_readonly_39, Auth_Comment_creationDate_readonly_39>;
type _assert_Comment_creationDate_readonly_39 = Expect<_check_Comment_creationDate_readonly_39>;

type Ref_Comment_delete_40 = () => void;
type Auth_Comment_delete_40 = () => void;
type _check_Comment_delete_40 = IsExact<Ref_Comment_delete_40, Auth_Comment_delete_40>;
type _assert_Comment_delete_40 = Expect<_check_Comment_delete_40>;

type Ref_Comment_getRange_41 = () => DocxEditor.Range;
type Auth_Comment_getRange_41 = () => DocxEditor.Range;
type _check_Comment_getRange_41 = IsExact<Ref_Comment_getRange_41, Auth_Comment_getRange_41>;
type _assert_Comment_getRange_41 = Expect<_check_Comment_getRange_41>;

type Ref_Comment_id_42 = () => string;
type Auth_Comment_id_42 = () => string;
type _check_Comment_id_42 = IsExact<Ref_Comment_id_42, Auth_Comment_id_42>;
type _assert_Comment_id_42 = Expect<_check_Comment_id_42>;

type Ref_Comment_id_readonly_43 = { readonly value: string };
type Auth_Comment_id_readonly_43 = { readonly value: string };
type _check_Comment_id_readonly_43 = IsExact<Ref_Comment_id_readonly_43, Auth_Comment_id_readonly_43>;
type _assert_Comment_id_readonly_43 = Expect<_check_Comment_id_readonly_43>;

type Ref_Comment_replies_44 = () => DocxEditor.CommentReplyCollection;
type Auth_Comment_replies_44 = () => DocxEditor.CommentReplyCollection;
type _check_Comment_replies_44 = IsExact<Ref_Comment_replies_44, Auth_Comment_replies_44>;
type _assert_Comment_replies_44 = Expect<_check_Comment_replies_44>;

type Ref_Comment_replies_readonly_45 = { readonly value: DocxEditor.CommentReplyCollection };
type Auth_Comment_replies_readonly_45 = { readonly value: DocxEditor.CommentReplyCollection };
type _check_Comment_replies_readonly_45 = IsExact<Ref_Comment_replies_readonly_45, Auth_Comment_replies_readonly_45>;
type _assert_Comment_replies_readonly_45 = Expect<_check_Comment_replies_readonly_45>;

type Ref_Comment_reply_46 = (replyText: string) => DocxEditor.CommentReply;
type Auth_Comment_reply_46 = (replyText: string) => DocxEditor.CommentReply;
type _check_Comment_reply_46 = IsExact<Ref_Comment_reply_46, Auth_Comment_reply_46>;
type _assert_Comment_reply_46 = Expect<_check_Comment_reply_46>;

type Ref_Comment_resolved_47 = () => boolean;
type Auth_Comment_resolved_47 = () => boolean;
type _check_Comment_resolved_47 = IsExact<Ref_Comment_resolved_47, Auth_Comment_resolved_47>;
type _assert_Comment_resolved_47 = Expect<_check_Comment_resolved_47>;

type Ref_Comment_resolved_readonly_48 = { value: boolean };
type Auth_Comment_resolved_readonly_48 = { value: boolean };
type _check_Comment_resolved_readonly_48 = IsExact<Ref_Comment_resolved_readonly_48, Auth_Comment_resolved_readonly_48>;
type _assert_Comment_resolved_readonly_48 = Expect<_check_Comment_resolved_readonly_48>;

type Ref_CommentCollection_getFirst_49 = () => DocxEditor.Comment;
type Auth_CommentCollection_getFirst_49 = () => DocxEditor.Comment;
type _check_CommentCollection_getFirst_49 = IsExact<Ref_CommentCollection_getFirst_49, Auth_CommentCollection_getFirst_49>;
type _assert_CommentCollection_getFirst_49 = Expect<_check_CommentCollection_getFirst_49>;

type Ref_CommentCollection_items_50 = () => DocxEditor.Comment[];
type Auth_CommentCollection_items_50 = () => DocxEditor.Comment[];
type _check_CommentCollection_items_50 = IsExact<Ref_CommentCollection_items_50, Auth_CommentCollection_items_50>;
type _assert_CommentCollection_items_50 = Expect<_check_CommentCollection_items_50>;

type Ref_CommentCollection_items_readonly_51 = { readonly value: DocxEditor.Comment[] };
type Auth_CommentCollection_items_readonly_51 = { readonly value: DocxEditor.Comment[] };
type _check_CommentCollection_items_readonly_51 = IsExact<Ref_CommentCollection_items_readonly_51, Auth_CommentCollection_items_readonly_51>;
type _assert_CommentCollection_items_readonly_51 = Expect<_check_CommentCollection_items_readonly_51>;

type Ref_CommentReply_authorName_52 = () => string;
type Auth_CommentReply_authorName_52 = () => string;
type _check_CommentReply_authorName_52 = IsExact<Ref_CommentReply_authorName_52, Auth_CommentReply_authorName_52>;
type _assert_CommentReply_authorName_52 = Expect<_check_CommentReply_authorName_52>;

type Ref_CommentReply_authorName_readonly_53 = { readonly value: string };
type Auth_CommentReply_authorName_readonly_53 = { readonly value: string };
type _check_CommentReply_authorName_readonly_53 = IsExact<Ref_CommentReply_authorName_readonly_53, Auth_CommentReply_authorName_readonly_53>;
type _assert_CommentReply_authorName_readonly_53 = Expect<_check_CommentReply_authorName_readonly_53>;

type Ref_CommentReply_content_54 = () => string;
type Auth_CommentReply_content_54 = () => string;
type _check_CommentReply_content_54 = IsExact<Ref_CommentReply_content_54, Auth_CommentReply_content_54>;
type _assert_CommentReply_content_54 = Expect<_check_CommentReply_content_54>;

type Ref_CommentReply_content_readonly_55 = { value: string };
type Auth_CommentReply_content_readonly_55 = { value: string };
type _check_CommentReply_content_readonly_55 = IsExact<Ref_CommentReply_content_readonly_55, Auth_CommentReply_content_readonly_55>;
type _assert_CommentReply_content_readonly_55 = Expect<_check_CommentReply_content_readonly_55>;

type Ref_CommentReply_creationDate_56 = () => Date;
type Auth_CommentReply_creationDate_56 = () => Date;
type _check_CommentReply_creationDate_56 = IsExact<Ref_CommentReply_creationDate_56, Auth_CommentReply_creationDate_56>;
type _assert_CommentReply_creationDate_56 = Expect<_check_CommentReply_creationDate_56>;

type Ref_CommentReply_creationDate_readonly_57 = { readonly value: Date };
type Auth_CommentReply_creationDate_readonly_57 = { readonly value: Date };
type _check_CommentReply_creationDate_readonly_57 = IsExact<Ref_CommentReply_creationDate_readonly_57, Auth_CommentReply_creationDate_readonly_57>;
type _assert_CommentReply_creationDate_readonly_57 = Expect<_check_CommentReply_creationDate_readonly_57>;

type Ref_CommentReply_delete_58 = () => void;
type Auth_CommentReply_delete_58 = () => void;
type _check_CommentReply_delete_58 = IsExact<Ref_CommentReply_delete_58, Auth_CommentReply_delete_58>;
type _assert_CommentReply_delete_58 = Expect<_check_CommentReply_delete_58>;

type Ref_CommentReply_id_59 = () => string;
type Auth_CommentReply_id_59 = () => string;
type _check_CommentReply_id_59 = IsExact<Ref_CommentReply_id_59, Auth_CommentReply_id_59>;
type _assert_CommentReply_id_59 = Expect<_check_CommentReply_id_59>;

type Ref_CommentReply_id_readonly_60 = { readonly value: string };
type Auth_CommentReply_id_readonly_60 = { readonly value: string };
type _check_CommentReply_id_readonly_60 = IsExact<Ref_CommentReply_id_readonly_60, Auth_CommentReply_id_readonly_60>;
type _assert_CommentReply_id_readonly_60 = Expect<_check_CommentReply_id_readonly_60>;

type Ref_CommentReplyCollection_getFirst_61 = () => DocxEditor.CommentReply;
type Auth_CommentReplyCollection_getFirst_61 = () => DocxEditor.CommentReply;
type _check_CommentReplyCollection_getFirst_61 = IsExact<Ref_CommentReplyCollection_getFirst_61, Auth_CommentReplyCollection_getFirst_61>;
type _assert_CommentReplyCollection_getFirst_61 = Expect<_check_CommentReplyCollection_getFirst_61>;

type Ref_CommentReplyCollection_items_62 = () => DocxEditor.CommentReply[];
type Auth_CommentReplyCollection_items_62 = () => DocxEditor.CommentReply[];
type _check_CommentReplyCollection_items_62 = IsExact<Ref_CommentReplyCollection_items_62, Auth_CommentReplyCollection_items_62>;
type _assert_CommentReplyCollection_items_62 = Expect<_check_CommentReplyCollection_items_62>;

type Ref_CommentReplyCollection_items_readonly_63 = { readonly value: DocxEditor.CommentReply[] };
type Auth_CommentReplyCollection_items_readonly_63 = { readonly value: DocxEditor.CommentReply[] };
type _check_CommentReplyCollection_items_readonly_63 = IsExact<Ref_CommentReplyCollection_items_readonly_63, Auth_CommentReplyCollection_items_readonly_63>;
type _assert_CommentReplyCollection_items_readonly_63 = Expect<_check_CommentReplyCollection_items_readonly_63>;

type Ref_ContentControl_cannotDelete_64 = () => boolean;
type Auth_ContentControl_cannotDelete_64 = () => boolean;
type _check_ContentControl_cannotDelete_64 = IsExact<Ref_ContentControl_cannotDelete_64, Auth_ContentControl_cannotDelete_64>;
type _assert_ContentControl_cannotDelete_64 = Expect<_check_ContentControl_cannotDelete_64>;

type Ref_ContentControl_cannotDelete_readonly_65 = { value: boolean };
type Auth_ContentControl_cannotDelete_readonly_65 = { value: boolean };
type _check_ContentControl_cannotDelete_readonly_65 = IsExact<Ref_ContentControl_cannotDelete_readonly_65, Auth_ContentControl_cannotDelete_readonly_65>;
type _assert_ContentControl_cannotDelete_readonly_65 = Expect<_check_ContentControl_cannotDelete_readonly_65>;

type Ref_ContentControl_cannotEdit_66 = () => boolean;
type Auth_ContentControl_cannotEdit_66 = () => boolean;
type _check_ContentControl_cannotEdit_66 = IsExact<Ref_ContentControl_cannotEdit_66, Auth_ContentControl_cannotEdit_66>;
type _assert_ContentControl_cannotEdit_66 = Expect<_check_ContentControl_cannotEdit_66>;

type Ref_ContentControl_cannotEdit_readonly_67 = { value: boolean };
type Auth_ContentControl_cannotEdit_readonly_67 = { value: boolean };
type _check_ContentControl_cannotEdit_readonly_67 = IsExact<Ref_ContentControl_cannotEdit_readonly_67, Auth_ContentControl_cannotEdit_readonly_67>;
type _assert_ContentControl_cannotEdit_readonly_67 = Expect<_check_ContentControl_cannotEdit_readonly_67>;

type Ref_ContentControl_contentControls_68 = () => DocxEditor.ContentControlCollection;
type Auth_ContentControl_contentControls_68 = () => DocxEditor.ContentControlCollection;
type _check_ContentControl_contentControls_68 = IsExact<Ref_ContentControl_contentControls_68, Auth_ContentControl_contentControls_68>;
type _assert_ContentControl_contentControls_68 = Expect<_check_ContentControl_contentControls_68>;

type Ref_ContentControl_contentControls_readonly_69 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_ContentControl_contentControls_readonly_69 = { readonly value: DocxEditor.ContentControlCollection };
type _check_ContentControl_contentControls_readonly_69 = IsExact<Ref_ContentControl_contentControls_readonly_69, Auth_ContentControl_contentControls_readonly_69>;
type _assert_ContentControl_contentControls_readonly_69 = Expect<_check_ContentControl_contentControls_readonly_69>;

type Ref_ContentControl_delete_70 = (keepContent: boolean) => void;
type Auth_ContentControl_delete_70 = (keepContent: boolean) => void;
type _check_ContentControl_delete_70 = IsExact<Ref_ContentControl_delete_70, Auth_ContentControl_delete_70>;
type _assert_ContentControl_delete_70 = Expect<_check_ContentControl_delete_70>;

type Ref_ContentControl_getRange_71 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type Auth_ContentControl_getRange_71 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type _check_ContentControl_getRange_71 = IsExact<Ref_ContentControl_getRange_71, Auth_ContentControl_getRange_71>;
type _assert_ContentControl_getRange_71 = Expect<_check_ContentControl_getRange_71>;

type Ref_ContentControl_insertText_72 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_ContentControl_insertText_72 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_ContentControl_insertText_72 = IsExact<Ref_ContentControl_insertText_72, Auth_ContentControl_insertText_72>;
type _assert_ContentControl_insertText_72 = Expect<_check_ContentControl_insertText_72>;

type Ref_ContentControl_paragraphs_73 = () => DocxEditor.ParagraphCollection;
type Auth_ContentControl_paragraphs_73 = () => DocxEditor.ParagraphCollection;
type _check_ContentControl_paragraphs_73 = IsExact<Ref_ContentControl_paragraphs_73, Auth_ContentControl_paragraphs_73>;
type _assert_ContentControl_paragraphs_73 = Expect<_check_ContentControl_paragraphs_73>;

type Ref_ContentControl_paragraphs_readonly_74 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_ContentControl_paragraphs_readonly_74 = { readonly value: DocxEditor.ParagraphCollection };
type _check_ContentControl_paragraphs_readonly_74 = IsExact<Ref_ContentControl_paragraphs_readonly_74, Auth_ContentControl_paragraphs_readonly_74>;
type _assert_ContentControl_paragraphs_readonly_74 = Expect<_check_ContentControl_paragraphs_readonly_74>;

type Ref_ContentControl_tag_75 = () => string;
type Auth_ContentControl_tag_75 = () => string;
type _check_ContentControl_tag_75 = IsExact<Ref_ContentControl_tag_75, Auth_ContentControl_tag_75>;
type _assert_ContentControl_tag_75 = Expect<_check_ContentControl_tag_75>;

type Ref_ContentControl_tag_readonly_76 = { value: string };
type Auth_ContentControl_tag_readonly_76 = { value: string };
type _check_ContentControl_tag_readonly_76 = IsExact<Ref_ContentControl_tag_readonly_76, Auth_ContentControl_tag_readonly_76>;
type _assert_ContentControl_tag_readonly_76 = Expect<_check_ContentControl_tag_readonly_76>;

type Ref_ContentControl_text_77 = () => string;
type Auth_ContentControl_text_77 = () => string;
type _check_ContentControl_text_77 = IsExact<Ref_ContentControl_text_77, Auth_ContentControl_text_77>;
type _assert_ContentControl_text_77 = Expect<_check_ContentControl_text_77>;

type Ref_ContentControl_text_readonly_78 = { readonly value: string };
type Auth_ContentControl_text_readonly_78 = { readonly value: string };
type _check_ContentControl_text_readonly_78 = IsExact<Ref_ContentControl_text_readonly_78, Auth_ContentControl_text_readonly_78>;
type _assert_ContentControl_text_readonly_78 = Expect<_check_ContentControl_text_readonly_78>;

type Ref_ContentControl_title_79 = () => string;
type Auth_ContentControl_title_79 = () => string;
type _check_ContentControl_title_79 = IsExact<Ref_ContentControl_title_79, Auth_ContentControl_title_79>;
type _assert_ContentControl_title_79 = Expect<_check_ContentControl_title_79>;

type Ref_ContentControl_title_readonly_80 = { value: string };
type Auth_ContentControl_title_readonly_80 = { value: string };
type _check_ContentControl_title_readonly_80 = IsExact<Ref_ContentControl_title_readonly_80, Auth_ContentControl_title_readonly_80>;
type _assert_ContentControl_title_readonly_80 = Expect<_check_ContentControl_title_readonly_80>;

type Ref_ContentControlCollection_getById_81 = (id: number) => DocxEditor.ContentControl;
type Auth_ContentControlCollection_getById_81 = (id: number) => DocxEditor.ContentControl;
type _check_ContentControlCollection_getById_81 = IsExact<Ref_ContentControlCollection_getById_81, Auth_ContentControlCollection_getById_81>;
type _assert_ContentControlCollection_getById_81 = Expect<_check_ContentControlCollection_getById_81>;

type Ref_ContentControlCollection_items_82 = () => DocxEditor.ContentControl[];
type Auth_ContentControlCollection_items_82 = () => DocxEditor.ContentControl[];
type _check_ContentControlCollection_items_82 = IsExact<Ref_ContentControlCollection_items_82, Auth_ContentControlCollection_items_82>;
type _assert_ContentControlCollection_items_82 = Expect<_check_ContentControlCollection_items_82>;

type Ref_ContentControlCollection_items_readonly_83 = { readonly value: DocxEditor.ContentControl[] };
type Auth_ContentControlCollection_items_readonly_83 = { readonly value: DocxEditor.ContentControl[] };
type _check_ContentControlCollection_items_readonly_83 = IsExact<Ref_ContentControlCollection_items_readonly_83, Auth_ContentControlCollection_items_readonly_83>;
type _assert_ContentControlCollection_items_readonly_83 = Expect<_check_ContentControlCollection_items_readonly_83>;

type Ref_Document_body_84 = () => DocxEditor.Body;
type Auth_Document_body_84 = () => DocxEditor.Body;
type _check_Document_body_84 = IsExact<Ref_Document_body_84, Auth_Document_body_84>;
type _assert_Document_body_84 = Expect<_check_Document_body_84>;

type Ref_Document_body_readonly_85 = { readonly value: DocxEditor.Body };
type Auth_Document_body_readonly_85 = { readonly value: DocxEditor.Body };
type _check_Document_body_readonly_85 = IsExact<Ref_Document_body_readonly_85, Auth_Document_body_readonly_85>;
type _assert_Document_body_readonly_85 = Expect<_check_Document_body_readonly_85>;

type Ref_Document_changeTrackingMode_86 = () => "Off" | "TrackAll" | "TrackMineOnly";
type Auth_Document_changeTrackingMode_86 = () => "Off" | "TrackAll" | "TrackMineOnly";
type _check_Document_changeTrackingMode_86 = IsExact<Ref_Document_changeTrackingMode_86, Auth_Document_changeTrackingMode_86>;
type _assert_Document_changeTrackingMode_86 = Expect<_check_Document_changeTrackingMode_86>;

type Ref_Document_changeTrackingMode_readonly_87 = { value: "Off" | "TrackAll" | "TrackMineOnly" };
type Auth_Document_changeTrackingMode_readonly_87 = { value: "Off" | "TrackAll" | "TrackMineOnly" };
type _check_Document_changeTrackingMode_readonly_87 = IsExact<Ref_Document_changeTrackingMode_readonly_87, Auth_Document_changeTrackingMode_readonly_87>;
type _assert_Document_changeTrackingMode_readonly_87 = Expect<_check_Document_changeTrackingMode_readonly_87>;

type Ref_Document_comments_88 = () => DocxEditor.CommentCollection;
type Auth_Document_comments_88 = () => DocxEditor.CommentCollection;
type _check_Document_comments_88 = IsExact<Ref_Document_comments_88, Auth_Document_comments_88>;
type _assert_Document_comments_88 = Expect<_check_Document_comments_88>;

type Ref_Document_comments_readonly_89 = { readonly value: DocxEditor.CommentCollection };
type Auth_Document_comments_readonly_89 = { readonly value: DocxEditor.CommentCollection };
type _check_Document_comments_readonly_89 = IsExact<Ref_Document_comments_readonly_89, Auth_Document_comments_readonly_89>;
type _assert_Document_comments_readonly_89 = Expect<_check_Document_comments_readonly_89>;

type Ref_Document_compare_90 = (filePath: string, documentCompareOptions?: DocxEditor.DocumentCompareOptions) => void;
type Auth_Document_compare_90 = (filePath: string, documentCompareOptions?: DocxEditor.DocumentCompareOptions) => void;
type _check_Document_compare_90 = IsExact<Ref_Document_compare_90, Auth_Document_compare_90>;
type _assert_Document_compare_90 = Expect<_check_Document_compare_90>;

type Ref_Document_compareFromBase64_91 = (base64File: string, documentCompareOptions?: DocxEditor.DocumentCompareOptions) => void;
type Auth_Document_compareFromBase64_91 = (base64File: string, documentCompareOptions?: DocxEditor.DocumentCompareOptions) => void;
type _check_Document_compareFromBase64_91 = IsExact<Ref_Document_compareFromBase64_91, Auth_Document_compareFromBase64_91>;
type _assert_Document_compareFromBase64_91 = Expect<_check_Document_compareFromBase64_91>;

type Ref_Document_contentControls_92 = () => DocxEditor.ContentControlCollection;
type Auth_Document_contentControls_92 = () => DocxEditor.ContentControlCollection;
type _check_Document_contentControls_92 = IsExact<Ref_Document_contentControls_92, Auth_Document_contentControls_92>;
type _assert_Document_contentControls_92 = Expect<_check_Document_contentControls_92>;

type Ref_Document_contentControls_readonly_93 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Document_contentControls_readonly_93 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Document_contentControls_readonly_93 = IsExact<Ref_Document_contentControls_readonly_93, Auth_Document_contentControls_readonly_93>;
type _assert_Document_contentControls_readonly_93 = Expect<_check_Document_contentControls_readonly_93>;

type Ref_Document_deleteBookmark_94 = (name: string) => void;
type Auth_Document_deleteBookmark_94 = (name: string) => void;
type _check_Document_deleteBookmark_94 = IsExact<Ref_Document_deleteBookmark_94, Auth_Document_deleteBookmark_94>;
type _assert_Document_deleteBookmark_94 = Expect<_check_Document_deleteBookmark_94>;

type Ref_Document_getBookmarkRange_95 = (name: string) => DocxEditor.Range;
type Auth_Document_getBookmarkRange_95 = (name: string) => DocxEditor.Range;
type _check_Document_getBookmarkRange_95 = IsExact<Ref_Document_getBookmarkRange_95, Auth_Document_getBookmarkRange_95>;
type _assert_Document_getBookmarkRange_95 = Expect<_check_Document_getBookmarkRange_95>;

type Ref_Document_getBookmarkRangeOrNullObject_96 = (name: string) => DocxEditor.Range;
type Auth_Document_getBookmarkRangeOrNullObject_96 = (name: string) => DocxEditor.Range;
type _check_Document_getBookmarkRangeOrNullObject_96 = IsExact<Ref_Document_getBookmarkRangeOrNullObject_96, Auth_Document_getBookmarkRangeOrNullObject_96>;
type _assert_Document_getBookmarkRangeOrNullObject_96 = Expect<_check_Document_getBookmarkRangeOrNullObject_96>;

type Ref_Document_getStyles_97 = () => DocxEditor.StyleCollection;
type Auth_Document_getStyles_97 = () => DocxEditor.StyleCollection;
type _check_Document_getStyles_97 = IsExact<Ref_Document_getStyles_97, Auth_Document_getStyles_97>;
type _assert_Document_getStyles_97 = Expect<_check_Document_getStyles_97>;

type Ref_Document_paragraphs_98 = () => DocxEditor.ParagraphCollection;
type Auth_Document_paragraphs_98 = () => DocxEditor.ParagraphCollection;
type _check_Document_paragraphs_98 = IsExact<Ref_Document_paragraphs_98, Auth_Document_paragraphs_98>;
type _assert_Document_paragraphs_98 = Expect<_check_Document_paragraphs_98>;

type Ref_Document_paragraphs_readonly_99 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Document_paragraphs_readonly_99 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Document_paragraphs_readonly_99 = IsExact<Ref_Document_paragraphs_readonly_99, Auth_Document_paragraphs_readonly_99>;
type _assert_Document_paragraphs_readonly_99 = Expect<_check_Document_paragraphs_readonly_99>;

type Ref_Document_properties_100 = () => DocxEditor.DocumentProperties;
type Auth_Document_properties_100 = () => DocxEditor.DocumentProperties;
type _check_Document_properties_100 = IsExact<Ref_Document_properties_100, Auth_Document_properties_100>;
type _assert_Document_properties_100 = Expect<_check_Document_properties_100>;

type Ref_Document_properties_readonly_101 = { readonly value: DocxEditor.DocumentProperties };
type Auth_Document_properties_readonly_101 = { readonly value: DocxEditor.DocumentProperties };
type _check_Document_properties_readonly_101 = IsExact<Ref_Document_properties_readonly_101, Auth_Document_properties_readonly_101>;
type _assert_Document_properties_readonly_101 = Expect<_check_Document_properties_readonly_101>;

type Ref_Document_removeDocumentInformation_102 = (removeDocInfoType: DocxEditor.RemoveDocInfoType) => void;
type Auth_Document_removeDocumentInformation_102 = (removeDocInfoType: DocxEditor.RemoveDocInfoType) => void;
type _check_Document_removeDocumentInformation_102 = IsExact<Ref_Document_removeDocumentInformation_102, Auth_Document_removeDocumentInformation_102>;
type _assert_Document_removeDocumentInformation_102 = Expect<_check_Document_removeDocumentInformation_102>;

type Ref_Document_removeDocumentInformation_103 = (removeDocInfoType: "Comments" | "Revisions" | "Versions" | "RemovePersonalInformation" | "EmailHeader" | "RoutingSlip" | "SendForReview" | "DocumentProperties" | "Template" | "DocumentWorkspace" | "InkAnnotations" | "DocumentServerProperties" | "DocumentManagementPolicy" | "ContentType" | "TaskpaneWebExtensions" | "AtMentions" | "DocumentTasks" | "DocumentIntelligence" | "CommentReactions" | "All") => void;
type Auth_Document_removeDocumentInformation_103 = (removeDocInfoType: "Comments" | "Revisions" | "Versions" | "RemovePersonalInformation" | "EmailHeader" | "RoutingSlip" | "SendForReview" | "DocumentProperties" | "Template" | "DocumentWorkspace" | "InkAnnotations" | "DocumentServerProperties" | "DocumentManagementPolicy" | "ContentType" | "TaskpaneWebExtensions" | "AtMentions" | "DocumentTasks" | "DocumentIntelligence" | "CommentReactions" | "All") => void;
type _check_Document_removeDocumentInformation_103 = IsExact<Ref_Document_removeDocumentInformation_103, Auth_Document_removeDocumentInformation_103>;
type _assert_Document_removeDocumentInformation_103 = Expect<_check_Document_removeDocumentInformation_103>;

type Ref_Document_revisions_104 = () => DocxEditor.RevisionCollection;
type Auth_Document_revisions_104 = () => DocxEditor.RevisionCollection;
type _check_Document_revisions_104 = IsExact<Ref_Document_revisions_104, Auth_Document_revisions_104>;
type _assert_Document_revisions_104 = Expect<_check_Document_revisions_104>;

type Ref_Document_revisions_readonly_105 = { readonly value: DocxEditor.RevisionCollection };
type Auth_Document_revisions_readonly_105 = { readonly value: DocxEditor.RevisionCollection };
type _check_Document_revisions_readonly_105 = IsExact<Ref_Document_revisions_readonly_105, Auth_Document_revisions_readonly_105>;
type _assert_Document_revisions_readonly_105 = Expect<_check_Document_revisions_readonly_105>;

type Ref_Document_sections_106 = () => DocxEditor.SectionCollection;
type Auth_Document_sections_106 = () => DocxEditor.SectionCollection;
type _check_Document_sections_106 = IsExact<Ref_Document_sections_106, Auth_Document_sections_106>;
type _assert_Document_sections_106 = Expect<_check_Document_sections_106>;

type Ref_Document_sections_readonly_107 = { readonly value: DocxEditor.SectionCollection };
type Auth_Document_sections_readonly_107 = { readonly value: DocxEditor.SectionCollection };
type _check_Document_sections_readonly_107 = IsExact<Ref_Document_sections_readonly_107, Auth_Document_sections_readonly_107>;
type _assert_Document_sections_readonly_107 = Expect<_check_Document_sections_readonly_107>;

type Ref_DocumentProperties_author_108 = () => string;
type Auth_DocumentProperties_author_108 = () => string;
type _check_DocumentProperties_author_108 = IsExact<Ref_DocumentProperties_author_108, Auth_DocumentProperties_author_108>;
type _assert_DocumentProperties_author_108 = Expect<_check_DocumentProperties_author_108>;

type Ref_DocumentProperties_author_readonly_109 = { value: string };
type Auth_DocumentProperties_author_readonly_109 = { value: string };
type _check_DocumentProperties_author_readonly_109 = IsExact<Ref_DocumentProperties_author_readonly_109, Auth_DocumentProperties_author_readonly_109>;
type _assert_DocumentProperties_author_readonly_109 = Expect<_check_DocumentProperties_author_readonly_109>;

type Ref_DocumentProperties_category_110 = () => string;
type Auth_DocumentProperties_category_110 = () => string;
type _check_DocumentProperties_category_110 = IsExact<Ref_DocumentProperties_category_110, Auth_DocumentProperties_category_110>;
type _assert_DocumentProperties_category_110 = Expect<_check_DocumentProperties_category_110>;

type Ref_DocumentProperties_category_readonly_111 = { value: string };
type Auth_DocumentProperties_category_readonly_111 = { value: string };
type _check_DocumentProperties_category_readonly_111 = IsExact<Ref_DocumentProperties_category_readonly_111, Auth_DocumentProperties_category_readonly_111>;
type _assert_DocumentProperties_category_readonly_111 = Expect<_check_DocumentProperties_category_readonly_111>;

type Ref_DocumentProperties_comments_112 = () => string;
type Auth_DocumentProperties_comments_112 = () => string;
type _check_DocumentProperties_comments_112 = IsExact<Ref_DocumentProperties_comments_112, Auth_DocumentProperties_comments_112>;
type _assert_DocumentProperties_comments_112 = Expect<_check_DocumentProperties_comments_112>;

type Ref_DocumentProperties_comments_readonly_113 = { value: string };
type Auth_DocumentProperties_comments_readonly_113 = { value: string };
type _check_DocumentProperties_comments_readonly_113 = IsExact<Ref_DocumentProperties_comments_readonly_113, Auth_DocumentProperties_comments_readonly_113>;
type _assert_DocumentProperties_comments_readonly_113 = Expect<_check_DocumentProperties_comments_readonly_113>;

type Ref_DocumentProperties_keywords_114 = () => string;
type Auth_DocumentProperties_keywords_114 = () => string;
type _check_DocumentProperties_keywords_114 = IsExact<Ref_DocumentProperties_keywords_114, Auth_DocumentProperties_keywords_114>;
type _assert_DocumentProperties_keywords_114 = Expect<_check_DocumentProperties_keywords_114>;

type Ref_DocumentProperties_keywords_readonly_115 = { value: string };
type Auth_DocumentProperties_keywords_readonly_115 = { value: string };
type _check_DocumentProperties_keywords_readonly_115 = IsExact<Ref_DocumentProperties_keywords_readonly_115, Auth_DocumentProperties_keywords_readonly_115>;
type _assert_DocumentProperties_keywords_readonly_115 = Expect<_check_DocumentProperties_keywords_readonly_115>;

type Ref_DocumentProperties_lastAuthor_116 = () => string;
type Auth_DocumentProperties_lastAuthor_116 = () => string;
type _check_DocumentProperties_lastAuthor_116 = IsExact<Ref_DocumentProperties_lastAuthor_116, Auth_DocumentProperties_lastAuthor_116>;
type _assert_DocumentProperties_lastAuthor_116 = Expect<_check_DocumentProperties_lastAuthor_116>;

type Ref_DocumentProperties_lastAuthor_readonly_117 = { readonly value: string };
type Auth_DocumentProperties_lastAuthor_readonly_117 = { readonly value: string };
type _check_DocumentProperties_lastAuthor_readonly_117 = IsExact<Ref_DocumentProperties_lastAuthor_readonly_117, Auth_DocumentProperties_lastAuthor_readonly_117>;
type _assert_DocumentProperties_lastAuthor_readonly_117 = Expect<_check_DocumentProperties_lastAuthor_readonly_117>;

type Ref_DocumentProperties_subject_118 = () => string;
type Auth_DocumentProperties_subject_118 = () => string;
type _check_DocumentProperties_subject_118 = IsExact<Ref_DocumentProperties_subject_118, Auth_DocumentProperties_subject_118>;
type _assert_DocumentProperties_subject_118 = Expect<_check_DocumentProperties_subject_118>;

type Ref_DocumentProperties_subject_readonly_119 = { value: string };
type Auth_DocumentProperties_subject_readonly_119 = { value: string };
type _check_DocumentProperties_subject_readonly_119 = IsExact<Ref_DocumentProperties_subject_readonly_119, Auth_DocumentProperties_subject_readonly_119>;
type _assert_DocumentProperties_subject_readonly_119 = Expect<_check_DocumentProperties_subject_readonly_119>;

type Ref_DocumentProperties_title_120 = () => string;
type Auth_DocumentProperties_title_120 = () => string;
type _check_DocumentProperties_title_120 = IsExact<Ref_DocumentProperties_title_120, Auth_DocumentProperties_title_120>;
type _assert_DocumentProperties_title_120 = Expect<_check_DocumentProperties_title_120>;

type Ref_DocumentProperties_title_readonly_121 = { value: string };
type Auth_DocumentProperties_title_readonly_121 = { value: string };
type _check_DocumentProperties_title_readonly_121 = IsExact<Ref_DocumentProperties_title_readonly_121, Auth_DocumentProperties_title_readonly_121>;
type _assert_DocumentProperties_title_readonly_121 = Expect<_check_DocumentProperties_title_readonly_121>;

type Ref_Font_bold_122 = () => boolean;
type Auth_Font_bold_122 = () => boolean;
type _check_Font_bold_122 = IsExact<Ref_Font_bold_122, Auth_Font_bold_122>;
type _assert_Font_bold_122 = Expect<_check_Font_bold_122>;

type Ref_Font_bold_readonly_123 = { value: boolean };
type Auth_Font_bold_readonly_123 = { value: boolean };
type _check_Font_bold_readonly_123 = IsExact<Ref_Font_bold_readonly_123, Auth_Font_bold_readonly_123>;
type _assert_Font_bold_readonly_123 = Expect<_check_Font_bold_readonly_123>;

type Ref_Font_color_124 = () => string;
type Auth_Font_color_124 = () => string;
type _check_Font_color_124 = IsExact<Ref_Font_color_124, Auth_Font_color_124>;
type _assert_Font_color_124 = Expect<_check_Font_color_124>;

type Ref_Font_color_readonly_125 = { value: string };
type Auth_Font_color_readonly_125 = { value: string };
type _check_Font_color_readonly_125 = IsExact<Ref_Font_color_readonly_125, Auth_Font_color_readonly_125>;
type _assert_Font_color_readonly_125 = Expect<_check_Font_color_readonly_125>;

type Ref_Font_italic_126 = () => boolean;
type Auth_Font_italic_126 = () => boolean;
type _check_Font_italic_126 = IsExact<Ref_Font_italic_126, Auth_Font_italic_126>;
type _assert_Font_italic_126 = Expect<_check_Font_italic_126>;

type Ref_Font_italic_readonly_127 = { value: boolean };
type Auth_Font_italic_readonly_127 = { value: boolean };
type _check_Font_italic_readonly_127 = IsExact<Ref_Font_italic_readonly_127, Auth_Font_italic_readonly_127>;
type _assert_Font_italic_readonly_127 = Expect<_check_Font_italic_readonly_127>;

type Ref_Font_name_128 = () => string;
type Auth_Font_name_128 = () => string;
type _check_Font_name_128 = IsExact<Ref_Font_name_128, Auth_Font_name_128>;
type _assert_Font_name_128 = Expect<_check_Font_name_128>;

type Ref_Font_name_readonly_129 = { value: string };
type Auth_Font_name_readonly_129 = { value: string };
type _check_Font_name_readonly_129 = IsExact<Ref_Font_name_readonly_129, Auth_Font_name_readonly_129>;
type _assert_Font_name_readonly_129 = Expect<_check_Font_name_readonly_129>;

type Ref_Font_size_130 = () => number;
type Auth_Font_size_130 = () => number;
type _check_Font_size_130 = IsExact<Ref_Font_size_130, Auth_Font_size_130>;
type _assert_Font_size_130 = Expect<_check_Font_size_130>;

type Ref_Font_size_readonly_131 = { value: number };
type Auth_Font_size_readonly_131 = { value: number };
type _check_Font_size_readonly_131 = IsExact<Ref_Font_size_readonly_131, Auth_Font_size_readonly_131>;
type _assert_Font_size_readonly_131 = Expect<_check_Font_size_readonly_131>;

type Ref_List_getLevelParagraphs_132 = (level: number) => DocxEditor.ParagraphCollection;
type Auth_List_getLevelParagraphs_132 = (level: number) => DocxEditor.ParagraphCollection;
type _check_List_getLevelParagraphs_132 = IsExact<Ref_List_getLevelParagraphs_132, Auth_List_getLevelParagraphs_132>;
type _assert_List_getLevelParagraphs_132 = Expect<_check_List_getLevelParagraphs_132>;

type Ref_List_id_133 = () => number;
type Auth_List_id_133 = () => number;
type _check_List_id_133 = IsExact<Ref_List_id_133, Auth_List_id_133>;
type _assert_List_id_133 = Expect<_check_List_id_133>;

type Ref_List_id_readonly_134 = { readonly value: number };
type Auth_List_id_readonly_134 = { readonly value: number };
type _check_List_id_readonly_134 = IsExact<Ref_List_id_readonly_134, Auth_List_id_readonly_134>;
type _assert_List_id_readonly_134 = Expect<_check_List_id_readonly_134>;

type Ref_List_insertParagraph_135 = (paragraphText: string, insertLocation: "Start" | "End" | "Before" | "After") => DocxEditor.Paragraph;
type Auth_List_insertParagraph_135 = (paragraphText: string, insertLocation: "Start" | "End" | "Before" | "After") => DocxEditor.Paragraph;
type _check_List_insertParagraph_135 = IsExact<Ref_List_insertParagraph_135, Auth_List_insertParagraph_135>;
type _assert_List_insertParagraph_135 = Expect<_check_List_insertParagraph_135>;

type Ref_List_paragraphs_136 = () => DocxEditor.ParagraphCollection;
type Auth_List_paragraphs_136 = () => DocxEditor.ParagraphCollection;
type _check_List_paragraphs_136 = IsExact<Ref_List_paragraphs_136, Auth_List_paragraphs_136>;
type _assert_List_paragraphs_136 = Expect<_check_List_paragraphs_136>;

type Ref_List_paragraphs_readonly_137 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_List_paragraphs_readonly_137 = { readonly value: DocxEditor.ParagraphCollection };
type _check_List_paragraphs_readonly_137 = IsExact<Ref_List_paragraphs_readonly_137, Auth_List_paragraphs_readonly_137>;
type _assert_List_paragraphs_readonly_137 = Expect<_check_List_paragraphs_readonly_137>;

type Ref_ListCollection_getById_138 = (id: number) => DocxEditor.List;
type Auth_ListCollection_getById_138 = (id: number) => DocxEditor.List;
type _check_ListCollection_getById_138 = IsExact<Ref_ListCollection_getById_138, Auth_ListCollection_getById_138>;
type _assert_ListCollection_getById_138 = Expect<_check_ListCollection_getById_138>;

type Ref_ListCollection_getFirst_139 = () => DocxEditor.List;
type Auth_ListCollection_getFirst_139 = () => DocxEditor.List;
type _check_ListCollection_getFirst_139 = IsExact<Ref_ListCollection_getFirst_139, Auth_ListCollection_getFirst_139>;
type _assert_ListCollection_getFirst_139 = Expect<_check_ListCollection_getFirst_139>;

type Ref_ListCollection_items_140 = () => DocxEditor.List[];
type Auth_ListCollection_items_140 = () => DocxEditor.List[];
type _check_ListCollection_items_140 = IsExact<Ref_ListCollection_items_140, Auth_ListCollection_items_140>;
type _assert_ListCollection_items_140 = Expect<_check_ListCollection_items_140>;

type Ref_ListCollection_items_readonly_141 = { readonly value: DocxEditor.List[] };
type Auth_ListCollection_items_readonly_141 = { readonly value: DocxEditor.List[] };
type _check_ListCollection_items_readonly_141 = IsExact<Ref_ListCollection_items_readonly_141, Auth_ListCollection_items_readonly_141>;
type _assert_ListCollection_items_readonly_141 = Expect<_check_ListCollection_items_readonly_141>;

type Ref_ListItem_level_142 = () => number;
type Auth_ListItem_level_142 = () => number;
type _check_ListItem_level_142 = IsExact<Ref_ListItem_level_142, Auth_ListItem_level_142>;
type _assert_ListItem_level_142 = Expect<_check_ListItem_level_142>;

type Ref_ListItem_level_readonly_143 = { value: number };
type Auth_ListItem_level_readonly_143 = { value: number };
type _check_ListItem_level_readonly_143 = IsExact<Ref_ListItem_level_readonly_143, Auth_ListItem_level_readonly_143>;
type _assert_ListItem_level_readonly_143 = Expect<_check_ListItem_level_readonly_143>;

type Ref_NoteItem_body_144 = () => DocxEditor.Body;
type Auth_NoteItem_body_144 = () => DocxEditor.Body;
type _check_NoteItem_body_144 = IsExact<Ref_NoteItem_body_144, Auth_NoteItem_body_144>;
type _assert_NoteItem_body_144 = Expect<_check_NoteItem_body_144>;

type Ref_NoteItem_body_readonly_145 = { readonly value: DocxEditor.Body };
type Auth_NoteItem_body_readonly_145 = { readonly value: DocxEditor.Body };
type _check_NoteItem_body_readonly_145 = IsExact<Ref_NoteItem_body_readonly_145, Auth_NoteItem_body_readonly_145>;
type _assert_NoteItem_body_readonly_145 = Expect<_check_NoteItem_body_readonly_145>;

type Ref_NoteItem_delete_146 = () => void;
type Auth_NoteItem_delete_146 = () => void;
type _check_NoteItem_delete_146 = IsExact<Ref_NoteItem_delete_146, Auth_NoteItem_delete_146>;
type _assert_NoteItem_delete_146 = Expect<_check_NoteItem_delete_146>;

type Ref_NoteItem_getNext_147 = () => DocxEditor.NoteItem;
type Auth_NoteItem_getNext_147 = () => DocxEditor.NoteItem;
type _check_NoteItem_getNext_147 = IsExact<Ref_NoteItem_getNext_147, Auth_NoteItem_getNext_147>;
type _assert_NoteItem_getNext_147 = Expect<_check_NoteItem_getNext_147>;

type Ref_NoteItem_type_148 = () => "Footnote" | "Endnote";
type Auth_NoteItem_type_148 = () => "Footnote" | "Endnote";
type _check_NoteItem_type_148 = IsExact<Ref_NoteItem_type_148, Auth_NoteItem_type_148>;
type _assert_NoteItem_type_148 = Expect<_check_NoteItem_type_148>;

type Ref_NoteItem_type_readonly_149 = { readonly value: "Footnote" | "Endnote" };
type Auth_NoteItem_type_readonly_149 = { readonly value: "Footnote" | "Endnote" };
type _check_NoteItem_type_readonly_149 = IsExact<Ref_NoteItem_type_readonly_149, Auth_NoteItem_type_readonly_149>;
type _assert_NoteItem_type_readonly_149 = Expect<_check_NoteItem_type_readonly_149>;

type Ref_NoteItemCollection_getFirst_150 = () => DocxEditor.NoteItem;
type Auth_NoteItemCollection_getFirst_150 = () => DocxEditor.NoteItem;
type _check_NoteItemCollection_getFirst_150 = IsExact<Ref_NoteItemCollection_getFirst_150, Auth_NoteItemCollection_getFirst_150>;
type _assert_NoteItemCollection_getFirst_150 = Expect<_check_NoteItemCollection_getFirst_150>;

type Ref_NoteItemCollection_items_151 = () => DocxEditor.NoteItem[];
type Auth_NoteItemCollection_items_151 = () => DocxEditor.NoteItem[];
type _check_NoteItemCollection_items_151 = IsExact<Ref_NoteItemCollection_items_151, Auth_NoteItemCollection_items_151>;
type _assert_NoteItemCollection_items_151 = Expect<_check_NoteItemCollection_items_151>;

type Ref_NoteItemCollection_items_readonly_152 = { readonly value: DocxEditor.NoteItem[] };
type Auth_NoteItemCollection_items_readonly_152 = { readonly value: DocxEditor.NoteItem[] };
type _check_NoteItemCollection_items_readonly_152 = IsExact<Ref_NoteItemCollection_items_readonly_152, Auth_NoteItemCollection_items_readonly_152>;
type _assert_NoteItemCollection_items_readonly_152 = Expect<_check_NoteItemCollection_items_readonly_152>;

type Ref_PageSetup_bottomMargin_153 = () => number;
type Auth_PageSetup_bottomMargin_153 = () => number;
type _check_PageSetup_bottomMargin_153 = IsExact<Ref_PageSetup_bottomMargin_153, Auth_PageSetup_bottomMargin_153>;
type _assert_PageSetup_bottomMargin_153 = Expect<_check_PageSetup_bottomMargin_153>;

type Ref_PageSetup_bottomMargin_readonly_154 = { value: number };
type Auth_PageSetup_bottomMargin_readonly_154 = { value: number };
type _check_PageSetup_bottomMargin_readonly_154 = IsExact<Ref_PageSetup_bottomMargin_readonly_154, Auth_PageSetup_bottomMargin_readonly_154>;
type _assert_PageSetup_bottomMargin_readonly_154 = Expect<_check_PageSetup_bottomMargin_readonly_154>;

type Ref_PageSetup_leftMargin_155 = () => number;
type Auth_PageSetup_leftMargin_155 = () => number;
type _check_PageSetup_leftMargin_155 = IsExact<Ref_PageSetup_leftMargin_155, Auth_PageSetup_leftMargin_155>;
type _assert_PageSetup_leftMargin_155 = Expect<_check_PageSetup_leftMargin_155>;

type Ref_PageSetup_leftMargin_readonly_156 = { value: number };
type Auth_PageSetup_leftMargin_readonly_156 = { value: number };
type _check_PageSetup_leftMargin_readonly_156 = IsExact<Ref_PageSetup_leftMargin_readonly_156, Auth_PageSetup_leftMargin_readonly_156>;
type _assert_PageSetup_leftMargin_readonly_156 = Expect<_check_PageSetup_leftMargin_readonly_156>;

type Ref_PageSetup_orientation_157 = () => "Portrait" | "Landscape";
type Auth_PageSetup_orientation_157 = () => "Portrait" | "Landscape";
type _check_PageSetup_orientation_157 = IsExact<Ref_PageSetup_orientation_157, Auth_PageSetup_orientation_157>;
type _assert_PageSetup_orientation_157 = Expect<_check_PageSetup_orientation_157>;

type Ref_PageSetup_orientation_readonly_158 = { value: "Portrait" | "Landscape" };
type Auth_PageSetup_orientation_readonly_158 = { value: "Portrait" | "Landscape" };
type _check_PageSetup_orientation_readonly_158 = IsExact<Ref_PageSetup_orientation_readonly_158, Auth_PageSetup_orientation_readonly_158>;
type _assert_PageSetup_orientation_readonly_158 = Expect<_check_PageSetup_orientation_readonly_158>;

type Ref_PageSetup_pageHeight_159 = () => number;
type Auth_PageSetup_pageHeight_159 = () => number;
type _check_PageSetup_pageHeight_159 = IsExact<Ref_PageSetup_pageHeight_159, Auth_PageSetup_pageHeight_159>;
type _assert_PageSetup_pageHeight_159 = Expect<_check_PageSetup_pageHeight_159>;

type Ref_PageSetup_pageHeight_readonly_160 = { value: number };
type Auth_PageSetup_pageHeight_readonly_160 = { value: number };
type _check_PageSetup_pageHeight_readonly_160 = IsExact<Ref_PageSetup_pageHeight_readonly_160, Auth_PageSetup_pageHeight_readonly_160>;
type _assert_PageSetup_pageHeight_readonly_160 = Expect<_check_PageSetup_pageHeight_readonly_160>;

type Ref_PageSetup_pageWidth_161 = () => number;
type Auth_PageSetup_pageWidth_161 = () => number;
type _check_PageSetup_pageWidth_161 = IsExact<Ref_PageSetup_pageWidth_161, Auth_PageSetup_pageWidth_161>;
type _assert_PageSetup_pageWidth_161 = Expect<_check_PageSetup_pageWidth_161>;

type Ref_PageSetup_pageWidth_readonly_162 = { value: number };
type Auth_PageSetup_pageWidth_readonly_162 = { value: number };
type _check_PageSetup_pageWidth_readonly_162 = IsExact<Ref_PageSetup_pageWidth_readonly_162, Auth_PageSetup_pageWidth_readonly_162>;
type _assert_PageSetup_pageWidth_readonly_162 = Expect<_check_PageSetup_pageWidth_readonly_162>;

type Ref_PageSetup_rightMargin_163 = () => number;
type Auth_PageSetup_rightMargin_163 = () => number;
type _check_PageSetup_rightMargin_163 = IsExact<Ref_PageSetup_rightMargin_163, Auth_PageSetup_rightMargin_163>;
type _assert_PageSetup_rightMargin_163 = Expect<_check_PageSetup_rightMargin_163>;

type Ref_PageSetup_rightMargin_readonly_164 = { value: number };
type Auth_PageSetup_rightMargin_readonly_164 = { value: number };
type _check_PageSetup_rightMargin_readonly_164 = IsExact<Ref_PageSetup_rightMargin_readonly_164, Auth_PageSetup_rightMargin_readonly_164>;
type _assert_PageSetup_rightMargin_readonly_164 = Expect<_check_PageSetup_rightMargin_readonly_164>;

type Ref_PageSetup_topMargin_165 = () => number;
type Auth_PageSetup_topMargin_165 = () => number;
type _check_PageSetup_topMargin_165 = IsExact<Ref_PageSetup_topMargin_165, Auth_PageSetup_topMargin_165>;
type _assert_PageSetup_topMargin_165 = Expect<_check_PageSetup_topMargin_165>;

type Ref_PageSetup_topMargin_readonly_166 = { value: number };
type Auth_PageSetup_topMargin_readonly_166 = { value: number };
type _check_PageSetup_topMargin_readonly_166 = IsExact<Ref_PageSetup_topMargin_readonly_166, Auth_PageSetup_topMargin_readonly_166>;
type _assert_PageSetup_topMargin_readonly_166 = Expect<_check_PageSetup_topMargin_readonly_166>;

type Ref_Paragraph_alignment_167 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type Auth_Paragraph_alignment_167 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type _check_Paragraph_alignment_167 = IsExact<Ref_Paragraph_alignment_167, Auth_Paragraph_alignment_167>;
type _assert_Paragraph_alignment_167 = Expect<_check_Paragraph_alignment_167>;

type Ref_Paragraph_alignment_readonly_168 = { value: "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified" };
type Auth_Paragraph_alignment_readonly_168 = { value: "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified" };
type _check_Paragraph_alignment_readonly_168 = IsExact<Ref_Paragraph_alignment_readonly_168, Auth_Paragraph_alignment_readonly_168>;
type _assert_Paragraph_alignment_readonly_168 = Expect<_check_Paragraph_alignment_readonly_168>;

type Ref_Paragraph_clear_169 = () => void;
type Auth_Paragraph_clear_169 = () => void;
type _check_Paragraph_clear_169 = IsExact<Ref_Paragraph_clear_169, Auth_Paragraph_clear_169>;
type _assert_Paragraph_clear_169 = Expect<_check_Paragraph_clear_169>;

type Ref_Paragraph_contentControls_170 = () => DocxEditor.ContentControlCollection;
type Auth_Paragraph_contentControls_170 = () => DocxEditor.ContentControlCollection;
type _check_Paragraph_contentControls_170 = IsExact<Ref_Paragraph_contentControls_170, Auth_Paragraph_contentControls_170>;
type _assert_Paragraph_contentControls_170 = Expect<_check_Paragraph_contentControls_170>;

type Ref_Paragraph_contentControls_readonly_171 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Paragraph_contentControls_readonly_171 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Paragraph_contentControls_readonly_171 = IsExact<Ref_Paragraph_contentControls_readonly_171, Auth_Paragraph_contentControls_readonly_171>;
type _assert_Paragraph_contentControls_readonly_171 = Expect<_check_Paragraph_contentControls_readonly_171>;

type Ref_Paragraph_delete_172 = () => void;
type Auth_Paragraph_delete_172 = () => void;
type _check_Paragraph_delete_172 = IsExact<Ref_Paragraph_delete_172, Auth_Paragraph_delete_172>;
type _assert_Paragraph_delete_172 = Expect<_check_Paragraph_delete_172>;

type Ref_Paragraph_firstLineIndent_173 = () => number;
type Auth_Paragraph_firstLineIndent_173 = () => number;
type _check_Paragraph_firstLineIndent_173 = IsExact<Ref_Paragraph_firstLineIndent_173, Auth_Paragraph_firstLineIndent_173>;
type _assert_Paragraph_firstLineIndent_173 = Expect<_check_Paragraph_firstLineIndent_173>;

type Ref_Paragraph_firstLineIndent_readonly_174 = { value: number };
type Auth_Paragraph_firstLineIndent_readonly_174 = { value: number };
type _check_Paragraph_firstLineIndent_readonly_174 = IsExact<Ref_Paragraph_firstLineIndent_readonly_174, Auth_Paragraph_firstLineIndent_readonly_174>;
type _assert_Paragraph_firstLineIndent_readonly_174 = Expect<_check_Paragraph_firstLineIndent_readonly_174>;

type Ref_Paragraph_font_175 = () => DocxEditor.Font;
type Auth_Paragraph_font_175 = () => DocxEditor.Font;
type _check_Paragraph_font_175 = IsExact<Ref_Paragraph_font_175, Auth_Paragraph_font_175>;
type _assert_Paragraph_font_175 = Expect<_check_Paragraph_font_175>;

type Ref_Paragraph_font_readonly_176 = { readonly value: DocxEditor.Font };
type Auth_Paragraph_font_readonly_176 = { readonly value: DocxEditor.Font };
type _check_Paragraph_font_readonly_176 = IsExact<Ref_Paragraph_font_readonly_176, Auth_Paragraph_font_readonly_176>;
type _assert_Paragraph_font_readonly_176 = Expect<_check_Paragraph_font_readonly_176>;

type Ref_Paragraph_getReviewedText_177 = (changeTrackingVersion?: DocxEditor.ChangeTrackingVersion) => DocxEditor.ClientResult<string>;
type Auth_Paragraph_getReviewedText_177 = (changeTrackingVersion?: DocxEditor.ChangeTrackingVersion) => DocxEditor.ClientResult<string>;
type _check_Paragraph_getReviewedText_177 = IsExact<Ref_Paragraph_getReviewedText_177, Auth_Paragraph_getReviewedText_177>;
type _assert_Paragraph_getReviewedText_177 = Expect<_check_Paragraph_getReviewedText_177>;

type Ref_Paragraph_getReviewedText_178 = (changeTrackingVersion?: "Original" | "Current") => DocxEditor.ClientResult<string>;
type Auth_Paragraph_getReviewedText_178 = (changeTrackingVersion?: "Original" | "Current") => DocxEditor.ClientResult<string>;
type _check_Paragraph_getReviewedText_178 = IsExact<Ref_Paragraph_getReviewedText_178, Auth_Paragraph_getReviewedText_178>;
type _assert_Paragraph_getReviewedText_178 = Expect<_check_Paragraph_getReviewedText_178>;

type Ref_Paragraph_getTextRanges_179 = (endingMarks: string[], trimSpacing?: boolean) => DocxEditor.RangeCollection;
type Auth_Paragraph_getTextRanges_179 = (endingMarks: string[], trimSpacing?: boolean) => DocxEditor.RangeCollection;
type _check_Paragraph_getTextRanges_179 = IsExact<Ref_Paragraph_getTextRanges_179, Auth_Paragraph_getTextRanges_179>;
type _assert_Paragraph_getTextRanges_179 = Expect<_check_Paragraph_getTextRanges_179>;

type Ref_Paragraph_insertParagraph_180 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Paragraph_insertParagraph_180 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Paragraph_insertParagraph_180 = IsExact<Ref_Paragraph_insertParagraph_180, Auth_Paragraph_insertParagraph_180>;
type _assert_Paragraph_insertParagraph_180 = Expect<_check_Paragraph_insertParagraph_180>;

type Ref_Paragraph_insertText_181 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Paragraph_insertText_181 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Paragraph_insertText_181 = IsExact<Ref_Paragraph_insertText_181, Auth_Paragraph_insertText_181>;
type _assert_Paragraph_insertText_181 = Expect<_check_Paragraph_insertText_181>;

type Ref_Paragraph_leftIndent_182 = () => number;
type Auth_Paragraph_leftIndent_182 = () => number;
type _check_Paragraph_leftIndent_182 = IsExact<Ref_Paragraph_leftIndent_182, Auth_Paragraph_leftIndent_182>;
type _assert_Paragraph_leftIndent_182 = Expect<_check_Paragraph_leftIndent_182>;

type Ref_Paragraph_leftIndent_readonly_183 = { value: number };
type Auth_Paragraph_leftIndent_readonly_183 = { value: number };
type _check_Paragraph_leftIndent_readonly_183 = IsExact<Ref_Paragraph_leftIndent_readonly_183, Auth_Paragraph_leftIndent_readonly_183>;
type _assert_Paragraph_leftIndent_readonly_183 = Expect<_check_Paragraph_leftIndent_readonly_183>;

type Ref_Paragraph_lineSpacing_184 = () => number;
type Auth_Paragraph_lineSpacing_184 = () => number;
type _check_Paragraph_lineSpacing_184 = IsExact<Ref_Paragraph_lineSpacing_184, Auth_Paragraph_lineSpacing_184>;
type _assert_Paragraph_lineSpacing_184 = Expect<_check_Paragraph_lineSpacing_184>;

type Ref_Paragraph_lineSpacing_readonly_185 = { value: number };
type Auth_Paragraph_lineSpacing_readonly_185 = { value: number };
type _check_Paragraph_lineSpacing_readonly_185 = IsExact<Ref_Paragraph_lineSpacing_readonly_185, Auth_Paragraph_lineSpacing_readonly_185>;
type _assert_Paragraph_lineSpacing_readonly_185 = Expect<_check_Paragraph_lineSpacing_readonly_185>;

type Ref_Paragraph_list_186 = () => DocxEditor.List;
type Auth_Paragraph_list_186 = () => DocxEditor.List;
type _check_Paragraph_list_186 = IsExact<Ref_Paragraph_list_186, Auth_Paragraph_list_186>;
type _assert_Paragraph_list_186 = Expect<_check_Paragraph_list_186>;

type Ref_Paragraph_list_readonly_187 = { readonly value: DocxEditor.List };
type Auth_Paragraph_list_readonly_187 = { readonly value: DocxEditor.List };
type _check_Paragraph_list_readonly_187 = IsExact<Ref_Paragraph_list_readonly_187, Auth_Paragraph_list_readonly_187>;
type _assert_Paragraph_list_readonly_187 = Expect<_check_Paragraph_list_readonly_187>;

type Ref_Paragraph_listItem_188 = () => DocxEditor.ListItem;
type Auth_Paragraph_listItem_188 = () => DocxEditor.ListItem;
type _check_Paragraph_listItem_188 = IsExact<Ref_Paragraph_listItem_188, Auth_Paragraph_listItem_188>;
type _assert_Paragraph_listItem_188 = Expect<_check_Paragraph_listItem_188>;

type Ref_Paragraph_listItem_readonly_189 = { readonly value: DocxEditor.ListItem };
type Auth_Paragraph_listItem_readonly_189 = { readonly value: DocxEditor.ListItem };
type _check_Paragraph_listItem_readonly_189 = IsExact<Ref_Paragraph_listItem_readonly_189, Auth_Paragraph_listItem_readonly_189>;
type _assert_Paragraph_listItem_readonly_189 = Expect<_check_Paragraph_listItem_readonly_189>;

type Ref_Paragraph_rightIndent_190 = () => number;
type Auth_Paragraph_rightIndent_190 = () => number;
type _check_Paragraph_rightIndent_190 = IsExact<Ref_Paragraph_rightIndent_190, Auth_Paragraph_rightIndent_190>;
type _assert_Paragraph_rightIndent_190 = Expect<_check_Paragraph_rightIndent_190>;

type Ref_Paragraph_rightIndent_readonly_191 = { value: number };
type Auth_Paragraph_rightIndent_readonly_191 = { value: number };
type _check_Paragraph_rightIndent_readonly_191 = IsExact<Ref_Paragraph_rightIndent_readonly_191, Auth_Paragraph_rightIndent_readonly_191>;
type _assert_Paragraph_rightIndent_readonly_191 = Expect<_check_Paragraph_rightIndent_readonly_191>;

type Ref_Paragraph_search_192 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Paragraph_search_192 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Paragraph_search_192 = IsExact<Ref_Paragraph_search_192, Auth_Paragraph_search_192>;
type _assert_Paragraph_search_192 = Expect<_check_Paragraph_search_192>;

type Ref_Paragraph_spaceAfter_193 = () => number;
type Auth_Paragraph_spaceAfter_193 = () => number;
type _check_Paragraph_spaceAfter_193 = IsExact<Ref_Paragraph_spaceAfter_193, Auth_Paragraph_spaceAfter_193>;
type _assert_Paragraph_spaceAfter_193 = Expect<_check_Paragraph_spaceAfter_193>;

type Ref_Paragraph_spaceAfter_readonly_194 = { value: number };
type Auth_Paragraph_spaceAfter_readonly_194 = { value: number };
type _check_Paragraph_spaceAfter_readonly_194 = IsExact<Ref_Paragraph_spaceAfter_readonly_194, Auth_Paragraph_spaceAfter_readonly_194>;
type _assert_Paragraph_spaceAfter_readonly_194 = Expect<_check_Paragraph_spaceAfter_readonly_194>;

type Ref_Paragraph_spaceBefore_195 = () => number;
type Auth_Paragraph_spaceBefore_195 = () => number;
type _check_Paragraph_spaceBefore_195 = IsExact<Ref_Paragraph_spaceBefore_195, Auth_Paragraph_spaceBefore_195>;
type _assert_Paragraph_spaceBefore_195 = Expect<_check_Paragraph_spaceBefore_195>;

type Ref_Paragraph_spaceBefore_readonly_196 = { value: number };
type Auth_Paragraph_spaceBefore_readonly_196 = { value: number };
type _check_Paragraph_spaceBefore_readonly_196 = IsExact<Ref_Paragraph_spaceBefore_readonly_196, Auth_Paragraph_spaceBefore_readonly_196>;
type _assert_Paragraph_spaceBefore_readonly_196 = Expect<_check_Paragraph_spaceBefore_readonly_196>;

type Ref_Paragraph_split_197 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type Auth_Paragraph_split_197 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type _check_Paragraph_split_197 = IsExact<Ref_Paragraph_split_197, Auth_Paragraph_split_197>;
type _assert_Paragraph_split_197 = Expect<_check_Paragraph_split_197>;

type Ref_Paragraph_style_198 = () => string;
type Auth_Paragraph_style_198 = () => string;
type _check_Paragraph_style_198 = IsExact<Ref_Paragraph_style_198, Auth_Paragraph_style_198>;
type _assert_Paragraph_style_198 = Expect<_check_Paragraph_style_198>;

type Ref_Paragraph_style_readonly_199 = { value: string };
type Auth_Paragraph_style_readonly_199 = { value: string };
type _check_Paragraph_style_readonly_199 = IsExact<Ref_Paragraph_style_readonly_199, Auth_Paragraph_style_readonly_199>;
type _assert_Paragraph_style_readonly_199 = Expect<_check_Paragraph_style_readonly_199>;

type Ref_Paragraph_text_200 = () => string;
type Auth_Paragraph_text_200 = () => string;
type _check_Paragraph_text_200 = IsExact<Ref_Paragraph_text_200, Auth_Paragraph_text_200>;
type _assert_Paragraph_text_200 = Expect<_check_Paragraph_text_200>;

type Ref_Paragraph_text_readonly_201 = { readonly value: string };
type Auth_Paragraph_text_readonly_201 = { readonly value: string };
type _check_Paragraph_text_readonly_201 = IsExact<Ref_Paragraph_text_readonly_201, Auth_Paragraph_text_readonly_201>;
type _assert_Paragraph_text_readonly_201 = Expect<_check_Paragraph_text_readonly_201>;

type Ref_ParagraphCollection_getFirst_202 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getFirst_202 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getFirst_202 = IsExact<Ref_ParagraphCollection_getFirst_202, Auth_ParagraphCollection_getFirst_202>;
type _assert_ParagraphCollection_getFirst_202 = Expect<_check_ParagraphCollection_getFirst_202>;

type Ref_ParagraphCollection_getLast_203 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getLast_203 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getLast_203 = IsExact<Ref_ParagraphCollection_getLast_203, Auth_ParagraphCollection_getLast_203>;
type _assert_ParagraphCollection_getLast_203 = Expect<_check_ParagraphCollection_getLast_203>;

type Ref_ParagraphCollection_items_204 = () => DocxEditor.Paragraph[];
type Auth_ParagraphCollection_items_204 = () => DocxEditor.Paragraph[];
type _check_ParagraphCollection_items_204 = IsExact<Ref_ParagraphCollection_items_204, Auth_ParagraphCollection_items_204>;
type _assert_ParagraphCollection_items_204 = Expect<_check_ParagraphCollection_items_204>;

type Ref_ParagraphCollection_items_readonly_205 = { readonly value: DocxEditor.Paragraph[] };
type Auth_ParagraphCollection_items_readonly_205 = { readonly value: DocxEditor.Paragraph[] };
type _check_ParagraphCollection_items_readonly_205 = IsExact<Ref_ParagraphCollection_items_readonly_205, Auth_ParagraphCollection_items_readonly_205>;
type _assert_ParagraphCollection_items_readonly_205 = Expect<_check_ParagraphCollection_items_readonly_205>;

type Ref_Range_bookmarks_206 = () => DocxEditor.BookmarkCollection;
type Auth_Range_bookmarks_206 = () => DocxEditor.BookmarkCollection;
type _check_Range_bookmarks_206 = IsExact<Ref_Range_bookmarks_206, Auth_Range_bookmarks_206>;
type _assert_Range_bookmarks_206 = Expect<_check_Range_bookmarks_206>;

type Ref_Range_bookmarks_readonly_207 = { readonly value: DocxEditor.BookmarkCollection };
type Auth_Range_bookmarks_readonly_207 = { readonly value: DocxEditor.BookmarkCollection };
type _check_Range_bookmarks_readonly_207 = IsExact<Ref_Range_bookmarks_readonly_207, Auth_Range_bookmarks_readonly_207>;
type _assert_Range_bookmarks_readonly_207 = Expect<_check_Range_bookmarks_readonly_207>;

type Ref_Range_clear_208 = () => void;
type Auth_Range_clear_208 = () => void;
type _check_Range_clear_208 = IsExact<Ref_Range_clear_208, Auth_Range_clear_208>;
type _assert_Range_clear_208 = Expect<_check_Range_clear_208>;

type Ref_Range_contentControls_209 = () => DocxEditor.ContentControlCollection;
type Auth_Range_contentControls_209 = () => DocxEditor.ContentControlCollection;
type _check_Range_contentControls_209 = IsExact<Ref_Range_contentControls_209, Auth_Range_contentControls_209>;
type _assert_Range_contentControls_209 = Expect<_check_Range_contentControls_209>;

type Ref_Range_contentControls_readonly_210 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Range_contentControls_readonly_210 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Range_contentControls_readonly_210 = IsExact<Ref_Range_contentControls_readonly_210, Auth_Range_contentControls_readonly_210>;
type _assert_Range_contentControls_readonly_210 = Expect<_check_Range_contentControls_readonly_210>;

type Ref_Range_delete_211 = () => void;
type Auth_Range_delete_211 = () => void;
type _check_Range_delete_211 = IsExact<Ref_Range_delete_211, Auth_Range_delete_211>;
type _assert_Range_delete_211 = Expect<_check_Range_delete_211>;

type Ref_Range_expandTo_212 = (range: DocxEditor.Range) => DocxEditor.Range;
type Auth_Range_expandTo_212 = (range: DocxEditor.Range) => DocxEditor.Range;
type _check_Range_expandTo_212 = IsExact<Ref_Range_expandTo_212, Auth_Range_expandTo_212>;
type _assert_Range_expandTo_212 = Expect<_check_Range_expandTo_212>;

type Ref_Range_font_213 = () => DocxEditor.Font;
type Auth_Range_font_213 = () => DocxEditor.Font;
type _check_Range_font_213 = IsExact<Ref_Range_font_213, Auth_Range_font_213>;
type _assert_Range_font_213 = Expect<_check_Range_font_213>;

type Ref_Range_font_readonly_214 = { readonly value: DocxEditor.Font };
type Auth_Range_font_readonly_214 = { readonly value: DocxEditor.Font };
type _check_Range_font_readonly_214 = IsExact<Ref_Range_font_readonly_214, Auth_Range_font_readonly_214>;
type _assert_Range_font_readonly_214 = Expect<_check_Range_font_readonly_214>;

type Ref_Range_getBookmarks_215 = (includeHidden?: boolean, includeAdjacent?: boolean) => DocxEditor.ClientResult<string[]>;
type Auth_Range_getBookmarks_215 = (includeHidden?: boolean, includeAdjacent?: boolean) => DocxEditor.ClientResult<string[]>;
type _check_Range_getBookmarks_215 = IsExact<Ref_Range_getBookmarks_215, Auth_Range_getBookmarks_215>;
type _assert_Range_getBookmarks_215 = Expect<_check_Range_getBookmarks_215>;

type Ref_Range_getRange_216 = (rangeLocation?: "Whole" | "Start" | "End" | "After" | "Content") => DocxEditor.Range;
type Auth_Range_getRange_216 = (rangeLocation?: "Whole" | "Start" | "End" | "After" | "Content") => DocxEditor.Range;
type _check_Range_getRange_216 = IsExact<Ref_Range_getRange_216, Auth_Range_getRange_216>;
type _assert_Range_getRange_216 = Expect<_check_Range_getRange_216>;

type Ref_Range_getReviewedText_217 = (changeTrackingVersion?: DocxEditor.ChangeTrackingVersion) => DocxEditor.ClientResult<string>;
type Auth_Range_getReviewedText_217 = (changeTrackingVersion?: DocxEditor.ChangeTrackingVersion) => DocxEditor.ClientResult<string>;
type _check_Range_getReviewedText_217 = IsExact<Ref_Range_getReviewedText_217, Auth_Range_getReviewedText_217>;
type _assert_Range_getReviewedText_217 = Expect<_check_Range_getReviewedText_217>;

type Ref_Range_getReviewedText_218 = (changeTrackingVersion?: "Original" | "Current") => DocxEditor.ClientResult<string>;
type Auth_Range_getReviewedText_218 = (changeTrackingVersion?: "Original" | "Current") => DocxEditor.ClientResult<string>;
type _check_Range_getReviewedText_218 = IsExact<Ref_Range_getReviewedText_218, Auth_Range_getReviewedText_218>;
type _assert_Range_getReviewedText_218 = Expect<_check_Range_getReviewedText_218>;

type Ref_Range_getTextRanges_219 = (endingMarks: string[], trimSpacing?: boolean) => DocxEditor.RangeCollection;
type Auth_Range_getTextRanges_219 = (endingMarks: string[], trimSpacing?: boolean) => DocxEditor.RangeCollection;
type _check_Range_getTextRanges_219 = IsExact<Ref_Range_getTextRanges_219, Auth_Range_getTextRanges_219>;
type _assert_Range_getTextRanges_219 = Expect<_check_Range_getTextRanges_219>;

type Ref_Range_hyperlink_220 = () => string;
type Auth_Range_hyperlink_220 = () => string;
type _check_Range_hyperlink_220 = IsExact<Ref_Range_hyperlink_220, Auth_Range_hyperlink_220>;
type _assert_Range_hyperlink_220 = Expect<_check_Range_hyperlink_220>;

type Ref_Range_hyperlink_readonly_221 = { value: string };
type Auth_Range_hyperlink_readonly_221 = { value: string };
type _check_Range_hyperlink_readonly_221 = IsExact<Ref_Range_hyperlink_readonly_221, Auth_Range_hyperlink_readonly_221>;
type _assert_Range_hyperlink_readonly_221 = Expect<_check_Range_hyperlink_readonly_221>;

type Ref_Range_insertBookmark_222 = (name: string) => void;
type Auth_Range_insertBookmark_222 = (name: string) => void;
type _check_Range_insertBookmark_222 = IsExact<Ref_Range_insertBookmark_222, Auth_Range_insertBookmark_222>;
type _assert_Range_insertBookmark_222 = Expect<_check_Range_insertBookmark_222>;

type Ref_Range_insertComment_223 = (commentText: string) => DocxEditor.Comment;
type Auth_Range_insertComment_223 = (commentText: string) => DocxEditor.Comment;
type _check_Range_insertComment_223 = IsExact<Ref_Range_insertComment_223, Auth_Range_insertComment_223>;
type _assert_Range_insertComment_223 = Expect<_check_Range_insertComment_223>;

type Ref_Range_insertParagraph_224 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Range_insertParagraph_224 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Range_insertParagraph_224 = IsExact<Ref_Range_insertParagraph_224, Auth_Range_insertParagraph_224>;
type _assert_Range_insertParagraph_224 = Expect<_check_Range_insertParagraph_224>;

type Ref_Range_insertText_225 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type Auth_Range_insertText_225 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type _check_Range_insertText_225 = IsExact<Ref_Range_insertText_225, Auth_Range_insertText_225>;
type _assert_Range_insertText_225 = Expect<_check_Range_insertText_225>;

type Ref_Range_paragraphs_226 = () => DocxEditor.ParagraphCollection;
type Auth_Range_paragraphs_226 = () => DocxEditor.ParagraphCollection;
type _check_Range_paragraphs_226 = IsExact<Ref_Range_paragraphs_226, Auth_Range_paragraphs_226>;
type _assert_Range_paragraphs_226 = Expect<_check_Range_paragraphs_226>;

type Ref_Range_paragraphs_readonly_227 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Range_paragraphs_readonly_227 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Range_paragraphs_readonly_227 = IsExact<Ref_Range_paragraphs_readonly_227, Auth_Range_paragraphs_readonly_227>;
type _assert_Range_paragraphs_readonly_227 = Expect<_check_Range_paragraphs_readonly_227>;

type Ref_Range_revisions_228 = () => DocxEditor.RevisionCollection;
type Auth_Range_revisions_228 = () => DocxEditor.RevisionCollection;
type _check_Range_revisions_228 = IsExact<Ref_Range_revisions_228, Auth_Range_revisions_228>;
type _assert_Range_revisions_228 = Expect<_check_Range_revisions_228>;

type Ref_Range_revisions_readonly_229 = { readonly value: DocxEditor.RevisionCollection };
type Auth_Range_revisions_readonly_229 = { readonly value: DocxEditor.RevisionCollection };
type _check_Range_revisions_readonly_229 = IsExact<Ref_Range_revisions_readonly_229, Auth_Range_revisions_readonly_229>;
type _assert_Range_revisions_readonly_229 = Expect<_check_Range_revisions_readonly_229>;

type Ref_Range_search_230 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Range_search_230 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Range_search_230 = IsExact<Ref_Range_search_230, Auth_Range_search_230>;
type _assert_Range_search_230 = Expect<_check_Range_search_230>;

type Ref_Range_select_231 = (selectionMode?: DocxEditor.SelectionMode) => void;
type Auth_Range_select_231 = (selectionMode?: DocxEditor.SelectionMode) => void;
type _check_Range_select_231 = IsExact<Ref_Range_select_231, Auth_Range_select_231>;
type _assert_Range_select_231 = Expect<_check_Range_select_231>;

type Ref_Range_select_232 = (selectionMode?: "Select" | "Start" | "End") => void;
type Auth_Range_select_232 = (selectionMode?: "Select" | "Start" | "End") => void;
type _check_Range_select_232 = IsExact<Ref_Range_select_232, Auth_Range_select_232>;
type _assert_Range_select_232 = Expect<_check_Range_select_232>;

type Ref_Range_style_233 = () => string;
type Auth_Range_style_233 = () => string;
type _check_Range_style_233 = IsExact<Ref_Range_style_233, Auth_Range_style_233>;
type _assert_Range_style_233 = Expect<_check_Range_style_233>;

type Ref_Range_style_readonly_234 = { value: string };
type Auth_Range_style_readonly_234 = { value: string };
type _check_Range_style_readonly_234 = IsExact<Ref_Range_style_readonly_234, Auth_Range_style_readonly_234>;
type _assert_Range_style_readonly_234 = Expect<_check_Range_style_readonly_234>;

type Ref_Range_text_235 = () => string;
type Auth_Range_text_235 = () => string;
type _check_Range_text_235 = IsExact<Ref_Range_text_235, Auth_Range_text_235>;
type _assert_Range_text_235 = Expect<_check_Range_text_235>;

type Ref_Range_text_readonly_236 = { readonly value: string };
type Auth_Range_text_readonly_236 = { readonly value: string };
type _check_Range_text_readonly_236 = IsExact<Ref_Range_text_readonly_236, Auth_Range_text_readonly_236>;
type _assert_Range_text_readonly_236 = Expect<_check_Range_text_readonly_236>;

type Ref_RangeCollection_getFirst_237 = () => DocxEditor.Range;
type Auth_RangeCollection_getFirst_237 = () => DocxEditor.Range;
type _check_RangeCollection_getFirst_237 = IsExact<Ref_RangeCollection_getFirst_237, Auth_RangeCollection_getFirst_237>;
type _assert_RangeCollection_getFirst_237 = Expect<_check_RangeCollection_getFirst_237>;

type Ref_RangeCollection_items_238 = () => DocxEditor.Range[];
type Auth_RangeCollection_items_238 = () => DocxEditor.Range[];
type _check_RangeCollection_items_238 = IsExact<Ref_RangeCollection_items_238, Auth_RangeCollection_items_238>;
type _assert_RangeCollection_items_238 = Expect<_check_RangeCollection_items_238>;

type Ref_RangeCollection_items_readonly_239 = { readonly value: DocxEditor.Range[] };
type Auth_RangeCollection_items_readonly_239 = { readonly value: DocxEditor.Range[] };
type _check_RangeCollection_items_readonly_239 = IsExact<Ref_RangeCollection_items_readonly_239, Auth_RangeCollection_items_readonly_239>;
type _assert_RangeCollection_items_readonly_239 = Expect<_check_RangeCollection_items_readonly_239>;

type Ref_RequestContext_document_240 = () => DocxEditor.Document;
type Auth_RequestContext_document_240 = () => DocxEditor.Document;
type _check_RequestContext_document_240 = IsExact<Ref_RequestContext_document_240, Auth_RequestContext_document_240>;
type _assert_RequestContext_document_240 = Expect<_check_RequestContext_document_240>;

type Ref_RequestContext_document_readonly_241 = { readonly value: DocxEditor.Document };
type Auth_RequestContext_document_readonly_241 = { readonly value: DocxEditor.Document };
type _check_RequestContext_document_readonly_241 = IsExact<Ref_RequestContext_document_readonly_241, Auth_RequestContext_document_readonly_241>;
type _assert_RequestContext_document_readonly_241 = Expect<_check_RequestContext_document_readonly_241>;

type Ref_Revision_accept_242 = () => void;
type Auth_Revision_accept_242 = () => void;
type _check_Revision_accept_242 = IsExact<Ref_Revision_accept_242, Auth_Revision_accept_242>;
type _assert_Revision_accept_242 = Expect<_check_Revision_accept_242>;

type Ref_Revision_author_243 = () => string;
type Auth_Revision_author_243 = () => string;
type _check_Revision_author_243 = IsExact<Ref_Revision_author_243, Auth_Revision_author_243>;
type _assert_Revision_author_243 = Expect<_check_Revision_author_243>;

type Ref_Revision_author_readonly_244 = { readonly value: string };
type Auth_Revision_author_readonly_244 = { readonly value: string };
type _check_Revision_author_readonly_244 = IsExact<Ref_Revision_author_readonly_244, Auth_Revision_author_readonly_244>;
type _assert_Revision_author_readonly_244 = Expect<_check_Revision_author_readonly_244>;

type Ref_Revision_date_245 = () => Date;
type Auth_Revision_date_245 = () => Date;
type _check_Revision_date_245 = IsExact<Ref_Revision_date_245, Auth_Revision_date_245>;
type _assert_Revision_date_245 = Expect<_check_Revision_date_245>;

type Ref_Revision_date_readonly_246 = { readonly value: Date };
type Auth_Revision_date_readonly_246 = { readonly value: Date };
type _check_Revision_date_readonly_246 = IsExact<Ref_Revision_date_readonly_246, Auth_Revision_date_readonly_246>;
type _assert_Revision_date_readonly_246 = Expect<_check_Revision_date_readonly_246>;

type Ref_Revision_range_247 = () => DocxEditor.Range;
type Auth_Revision_range_247 = () => DocxEditor.Range;
type _check_Revision_range_247 = IsExact<Ref_Revision_range_247, Auth_Revision_range_247>;
type _assert_Revision_range_247 = Expect<_check_Revision_range_247>;

type Ref_Revision_range_readonly_248 = { readonly value: DocxEditor.Range };
type Auth_Revision_range_readonly_248 = { readonly value: DocxEditor.Range };
type _check_Revision_range_readonly_248 = IsExact<Ref_Revision_range_readonly_248, Auth_Revision_range_readonly_248>;
type _assert_Revision_range_readonly_248 = Expect<_check_Revision_range_readonly_248>;

type Ref_Revision_reject_249 = () => void;
type Auth_Revision_reject_249 = () => void;
type _check_Revision_reject_249 = IsExact<Ref_Revision_reject_249, Auth_Revision_reject_249>;
type _assert_Revision_reject_249 = Expect<_check_Revision_reject_249>;

type Ref_Revision_type_250 = () => "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete";
type Auth_Revision_type_250 = () => "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete";
type _check_Revision_type_250 = IsExact<Ref_Revision_type_250, Auth_Revision_type_250>;
type _assert_Revision_type_250 = Expect<_check_Revision_type_250>;

type Ref_Revision_type_readonly_251 = { readonly value: "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete" };
type Auth_Revision_type_readonly_251 = { readonly value: "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete" };
type _check_Revision_type_readonly_251 = IsExact<Ref_Revision_type_readonly_251, Auth_Revision_type_readonly_251>;
type _assert_Revision_type_readonly_251 = Expect<_check_Revision_type_readonly_251>;

type Ref_RevisionCollection_acceptAll_252 = () => void;
type Auth_RevisionCollection_acceptAll_252 = () => void;
type _check_RevisionCollection_acceptAll_252 = IsExact<Ref_RevisionCollection_acceptAll_252, Auth_RevisionCollection_acceptAll_252>;
type _assert_RevisionCollection_acceptAll_252 = Expect<_check_RevisionCollection_acceptAll_252>;

type Ref_RevisionCollection_items_253 = () => DocxEditor.Revision[];
type Auth_RevisionCollection_items_253 = () => DocxEditor.Revision[];
type _check_RevisionCollection_items_253 = IsExact<Ref_RevisionCollection_items_253, Auth_RevisionCollection_items_253>;
type _assert_RevisionCollection_items_253 = Expect<_check_RevisionCollection_items_253>;

type Ref_RevisionCollection_items_readonly_254 = { readonly value: DocxEditor.Revision[] };
type Auth_RevisionCollection_items_readonly_254 = { readonly value: DocxEditor.Revision[] };
type _check_RevisionCollection_items_readonly_254 = IsExact<Ref_RevisionCollection_items_readonly_254, Auth_RevisionCollection_items_readonly_254>;
type _assert_RevisionCollection_items_readonly_254 = Expect<_check_RevisionCollection_items_readonly_254>;

type Ref_RevisionCollection_rejectAll_255 = () => void;
type Auth_RevisionCollection_rejectAll_255 = () => void;
type _check_RevisionCollection_rejectAll_255 = IsExact<Ref_RevisionCollection_rejectAll_255, Auth_RevisionCollection_rejectAll_255>;
type _assert_RevisionCollection_rejectAll_255 = Expect<_check_RevisionCollection_rejectAll_255>;

type Ref_SearchOptions_ignorePunct_256 = () => boolean;
type Auth_SearchOptions_ignorePunct_256 = () => boolean;
type _check_SearchOptions_ignorePunct_256 = IsExact<Ref_SearchOptions_ignorePunct_256, Auth_SearchOptions_ignorePunct_256>;
type _assert_SearchOptions_ignorePunct_256 = Expect<_check_SearchOptions_ignorePunct_256>;

type Ref_SearchOptions_ignorePunct_readonly_257 = { value: boolean };
type Auth_SearchOptions_ignorePunct_readonly_257 = { value: boolean };
type _check_SearchOptions_ignorePunct_readonly_257 = IsExact<Ref_SearchOptions_ignorePunct_readonly_257, Auth_SearchOptions_ignorePunct_readonly_257>;
type _assert_SearchOptions_ignorePunct_readonly_257 = Expect<_check_SearchOptions_ignorePunct_readonly_257>;

type Ref_SearchOptions_ignoreSpace_258 = () => boolean;
type Auth_SearchOptions_ignoreSpace_258 = () => boolean;
type _check_SearchOptions_ignoreSpace_258 = IsExact<Ref_SearchOptions_ignoreSpace_258, Auth_SearchOptions_ignoreSpace_258>;
type _assert_SearchOptions_ignoreSpace_258 = Expect<_check_SearchOptions_ignoreSpace_258>;

type Ref_SearchOptions_ignoreSpace_readonly_259 = { value: boolean };
type Auth_SearchOptions_ignoreSpace_readonly_259 = { value: boolean };
type _check_SearchOptions_ignoreSpace_readonly_259 = IsExact<Ref_SearchOptions_ignoreSpace_readonly_259, Auth_SearchOptions_ignoreSpace_readonly_259>;
type _assert_SearchOptions_ignoreSpace_readonly_259 = Expect<_check_SearchOptions_ignoreSpace_readonly_259>;

type Ref_SearchOptions_matchCase_260 = () => boolean;
type Auth_SearchOptions_matchCase_260 = () => boolean;
type _check_SearchOptions_matchCase_260 = IsExact<Ref_SearchOptions_matchCase_260, Auth_SearchOptions_matchCase_260>;
type _assert_SearchOptions_matchCase_260 = Expect<_check_SearchOptions_matchCase_260>;

type Ref_SearchOptions_matchCase_readonly_261 = { value: boolean };
type Auth_SearchOptions_matchCase_readonly_261 = { value: boolean };
type _check_SearchOptions_matchCase_readonly_261 = IsExact<Ref_SearchOptions_matchCase_readonly_261, Auth_SearchOptions_matchCase_readonly_261>;
type _assert_SearchOptions_matchCase_readonly_261 = Expect<_check_SearchOptions_matchCase_readonly_261>;

type Ref_SearchOptions_matchWholeWord_262 = () => boolean;
type Auth_SearchOptions_matchWholeWord_262 = () => boolean;
type _check_SearchOptions_matchWholeWord_262 = IsExact<Ref_SearchOptions_matchWholeWord_262, Auth_SearchOptions_matchWholeWord_262>;
type _assert_SearchOptions_matchWholeWord_262 = Expect<_check_SearchOptions_matchWholeWord_262>;

type Ref_SearchOptions_matchWholeWord_readonly_263 = { value: boolean };
type Auth_SearchOptions_matchWholeWord_readonly_263 = { value: boolean };
type _check_SearchOptions_matchWholeWord_readonly_263 = IsExact<Ref_SearchOptions_matchWholeWord_readonly_263, Auth_SearchOptions_matchWholeWord_readonly_263>;
type _assert_SearchOptions_matchWholeWord_readonly_263 = Expect<_check_SearchOptions_matchWholeWord_readonly_263>;

type Ref_SearchOptions_matchWildcards_264 = () => boolean;
type Auth_SearchOptions_matchWildcards_264 = () => boolean;
type _check_SearchOptions_matchWildcards_264 = IsExact<Ref_SearchOptions_matchWildcards_264, Auth_SearchOptions_matchWildcards_264>;
type _assert_SearchOptions_matchWildcards_264 = Expect<_check_SearchOptions_matchWildcards_264>;

type Ref_SearchOptions_matchWildcards_readonly_265 = { value: boolean };
type Auth_SearchOptions_matchWildcards_readonly_265 = { value: boolean };
type _check_SearchOptions_matchWildcards_readonly_265 = IsExact<Ref_SearchOptions_matchWildcards_readonly_265, Auth_SearchOptions_matchWildcards_readonly_265>;
type _assert_SearchOptions_matchWildcards_readonly_265 = Expect<_check_SearchOptions_matchWildcards_readonly_265>;

type Ref_Section_body_266 = () => DocxEditor.Body;
type Auth_Section_body_266 = () => DocxEditor.Body;
type _check_Section_body_266 = IsExact<Ref_Section_body_266, Auth_Section_body_266>;
type _assert_Section_body_266 = Expect<_check_Section_body_266>;

type Ref_Section_body_readonly_267 = { readonly value: DocxEditor.Body };
type Auth_Section_body_readonly_267 = { readonly value: DocxEditor.Body };
type _check_Section_body_readonly_267 = IsExact<Ref_Section_body_readonly_267, Auth_Section_body_readonly_267>;
type _assert_Section_body_readonly_267 = Expect<_check_Section_body_readonly_267>;

type Ref_Section_getFooter_268 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type Auth_Section_getFooter_268 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type _check_Section_getFooter_268 = IsExact<Ref_Section_getFooter_268, Auth_Section_getFooter_268>;
type _assert_Section_getFooter_268 = Expect<_check_Section_getFooter_268>;

type Ref_Section_getFooter_269 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type Auth_Section_getFooter_269 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type _check_Section_getFooter_269 = IsExact<Ref_Section_getFooter_269, Auth_Section_getFooter_269>;
type _assert_Section_getFooter_269 = Expect<_check_Section_getFooter_269>;

type Ref_Section_getHeader_270 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type Auth_Section_getHeader_270 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type _check_Section_getHeader_270 = IsExact<Ref_Section_getHeader_270, Auth_Section_getHeader_270>;
type _assert_Section_getHeader_270 = Expect<_check_Section_getHeader_270>;

type Ref_Section_getHeader_271 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type Auth_Section_getHeader_271 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type _check_Section_getHeader_271 = IsExact<Ref_Section_getHeader_271, Auth_Section_getHeader_271>;
type _assert_Section_getHeader_271 = Expect<_check_Section_getHeader_271>;

type Ref_Section_getNext_272 = () => DocxEditor.Section;
type Auth_Section_getNext_272 = () => DocxEditor.Section;
type _check_Section_getNext_272 = IsExact<Ref_Section_getNext_272, Auth_Section_getNext_272>;
type _assert_Section_getNext_272 = Expect<_check_Section_getNext_272>;

type Ref_Section_pageSetup_273 = () => DocxEditor.PageSetup;
type Auth_Section_pageSetup_273 = () => DocxEditor.PageSetup;
type _check_Section_pageSetup_273 = IsExact<Ref_Section_pageSetup_273, Auth_Section_pageSetup_273>;
type _assert_Section_pageSetup_273 = Expect<_check_Section_pageSetup_273>;

type Ref_Section_pageSetup_readonly_274 = { readonly value: DocxEditor.PageSetup };
type Auth_Section_pageSetup_readonly_274 = { readonly value: DocxEditor.PageSetup };
type _check_Section_pageSetup_readonly_274 = IsExact<Ref_Section_pageSetup_readonly_274, Auth_Section_pageSetup_readonly_274>;
type _assert_Section_pageSetup_readonly_274 = Expect<_check_Section_pageSetup_readonly_274>;

type Ref_SectionCollection_getFirst_275 = () => DocxEditor.Section;
type Auth_SectionCollection_getFirst_275 = () => DocxEditor.Section;
type _check_SectionCollection_getFirst_275 = IsExact<Ref_SectionCollection_getFirst_275, Auth_SectionCollection_getFirst_275>;
type _assert_SectionCollection_getFirst_275 = Expect<_check_SectionCollection_getFirst_275>;

type Ref_SectionCollection_items_276 = () => DocxEditor.Section[];
type Auth_SectionCollection_items_276 = () => DocxEditor.Section[];
type _check_SectionCollection_items_276 = IsExact<Ref_SectionCollection_items_276, Auth_SectionCollection_items_276>;
type _assert_SectionCollection_items_276 = Expect<_check_SectionCollection_items_276>;

type Ref_SectionCollection_items_readonly_277 = { readonly value: DocxEditor.Section[] };
type Auth_SectionCollection_items_readonly_277 = { readonly value: DocxEditor.Section[] };
type _check_SectionCollection_items_readonly_277 = IsExact<Ref_SectionCollection_items_readonly_277, Auth_SectionCollection_items_readonly_277>;
type _assert_SectionCollection_items_readonly_277 = Expect<_check_SectionCollection_items_readonly_277>;

type Ref_Style_baseStyle_278 = () => string;
type Auth_Style_baseStyle_278 = () => string;
type _check_Style_baseStyle_278 = IsExact<Ref_Style_baseStyle_278, Auth_Style_baseStyle_278>;
type _assert_Style_baseStyle_278 = Expect<_check_Style_baseStyle_278>;

type Ref_Style_baseStyle_readonly_279 = { value: string };
type Auth_Style_baseStyle_readonly_279 = { value: string };
type _check_Style_baseStyle_readonly_279 = IsExact<Ref_Style_baseStyle_readonly_279, Auth_Style_baseStyle_readonly_279>;
type _assert_Style_baseStyle_readonly_279 = Expect<_check_Style_baseStyle_readonly_279>;

type Ref_Style_builtIn_280 = () => boolean;
type Auth_Style_builtIn_280 = () => boolean;
type _check_Style_builtIn_280 = IsExact<Ref_Style_builtIn_280, Auth_Style_builtIn_280>;
type _assert_Style_builtIn_280 = Expect<_check_Style_builtIn_280>;

type Ref_Style_builtIn_readonly_281 = { readonly value: boolean };
type Auth_Style_builtIn_readonly_281 = { readonly value: boolean };
type _check_Style_builtIn_readonly_281 = IsExact<Ref_Style_builtIn_readonly_281, Auth_Style_builtIn_readonly_281>;
type _assert_Style_builtIn_readonly_281 = Expect<_check_Style_builtIn_readonly_281>;

type Ref_Style_linked_282 = () => boolean;
type Auth_Style_linked_282 = () => boolean;
type _check_Style_linked_282 = IsExact<Ref_Style_linked_282, Auth_Style_linked_282>;
type _assert_Style_linked_282 = Expect<_check_Style_linked_282>;

type Ref_Style_linked_readonly_283 = { readonly value: boolean };
type Auth_Style_linked_readonly_283 = { readonly value: boolean };
type _check_Style_linked_readonly_283 = IsExact<Ref_Style_linked_readonly_283, Auth_Style_linked_readonly_283>;
type _assert_Style_linked_readonly_283 = Expect<_check_Style_linked_readonly_283>;

type Ref_Style_nameLocal_284 = () => string;
type Auth_Style_nameLocal_284 = () => string;
type _check_Style_nameLocal_284 = IsExact<Ref_Style_nameLocal_284, Auth_Style_nameLocal_284>;
type _assert_Style_nameLocal_284 = Expect<_check_Style_nameLocal_284>;

type Ref_Style_nameLocal_readonly_285 = { readonly value: string };
type Auth_Style_nameLocal_readonly_285 = { readonly value: string };
type _check_Style_nameLocal_readonly_285 = IsExact<Ref_Style_nameLocal_readonly_285, Auth_Style_nameLocal_readonly_285>;
type _assert_Style_nameLocal_readonly_285 = Expect<_check_Style_nameLocal_readonly_285>;

type Ref_Style_nextParagraphStyle_286 = () => string;
type Auth_Style_nextParagraphStyle_286 = () => string;
type _check_Style_nextParagraphStyle_286 = IsExact<Ref_Style_nextParagraphStyle_286, Auth_Style_nextParagraphStyle_286>;
type _assert_Style_nextParagraphStyle_286 = Expect<_check_Style_nextParagraphStyle_286>;

type Ref_Style_nextParagraphStyle_readonly_287 = { value: string };
type Auth_Style_nextParagraphStyle_readonly_287 = { value: string };
type _check_Style_nextParagraphStyle_readonly_287 = IsExact<Ref_Style_nextParagraphStyle_readonly_287, Auth_Style_nextParagraphStyle_readonly_287>;
type _assert_Style_nextParagraphStyle_readonly_287 = Expect<_check_Style_nextParagraphStyle_readonly_287>;

type Ref_Style_priority_288 = () => number;
type Auth_Style_priority_288 = () => number;
type _check_Style_priority_288 = IsExact<Ref_Style_priority_288, Auth_Style_priority_288>;
type _assert_Style_priority_288 = Expect<_check_Style_priority_288>;

type Ref_Style_priority_readonly_289 = { value: number };
type Auth_Style_priority_readonly_289 = { value: number };
type _check_Style_priority_readonly_289 = IsExact<Ref_Style_priority_readonly_289, Auth_Style_priority_readonly_289>;
type _assert_Style_priority_readonly_289 = Expect<_check_Style_priority_readonly_289>;

type Ref_Style_quickStyle_290 = () => boolean;
type Auth_Style_quickStyle_290 = () => boolean;
type _check_Style_quickStyle_290 = IsExact<Ref_Style_quickStyle_290, Auth_Style_quickStyle_290>;
type _assert_Style_quickStyle_290 = Expect<_check_Style_quickStyle_290>;

type Ref_Style_quickStyle_readonly_291 = { value: boolean };
type Auth_Style_quickStyle_readonly_291 = { value: boolean };
type _check_Style_quickStyle_readonly_291 = IsExact<Ref_Style_quickStyle_readonly_291, Auth_Style_quickStyle_readonly_291>;
type _assert_Style_quickStyle_readonly_291 = Expect<_check_Style_quickStyle_readonly_291>;

type Ref_Style_type_292 = () => "Character" | "List" | "Paragraph" | "Table";
type Auth_Style_type_292 = () => "Character" | "List" | "Paragraph" | "Table";
type _check_Style_type_292 = IsExact<Ref_Style_type_292, Auth_Style_type_292>;
type _assert_Style_type_292 = Expect<_check_Style_type_292>;

type Ref_Style_type_readonly_293 = { readonly value: "Character" | "List" | "Paragraph" | "Table" };
type Auth_Style_type_readonly_293 = { readonly value: "Character" | "List" | "Paragraph" | "Table" };
type _check_Style_type_readonly_293 = IsExact<Ref_Style_type_readonly_293, Auth_Style_type_readonly_293>;
type _assert_Style_type_readonly_293 = Expect<_check_Style_type_readonly_293>;

type Ref_Style_unhideWhenUsed_294 = () => boolean;
type Auth_Style_unhideWhenUsed_294 = () => boolean;
type _check_Style_unhideWhenUsed_294 = IsExact<Ref_Style_unhideWhenUsed_294, Auth_Style_unhideWhenUsed_294>;
type _assert_Style_unhideWhenUsed_294 = Expect<_check_Style_unhideWhenUsed_294>;

type Ref_Style_unhideWhenUsed_readonly_295 = { value: boolean };
type Auth_Style_unhideWhenUsed_readonly_295 = { value: boolean };
type _check_Style_unhideWhenUsed_readonly_295 = IsExact<Ref_Style_unhideWhenUsed_readonly_295, Auth_Style_unhideWhenUsed_readonly_295>;
type _assert_Style_unhideWhenUsed_readonly_295 = Expect<_check_Style_unhideWhenUsed_readonly_295>;

type Ref_Style_visibility_296 = () => boolean;
type Auth_Style_visibility_296 = () => boolean;
type _check_Style_visibility_296 = IsExact<Ref_Style_visibility_296, Auth_Style_visibility_296>;
type _assert_Style_visibility_296 = Expect<_check_Style_visibility_296>;

type Ref_Style_visibility_readonly_297 = { value: boolean };
type Auth_Style_visibility_readonly_297 = { value: boolean };
type _check_Style_visibility_readonly_297 = IsExact<Ref_Style_visibility_readonly_297, Auth_Style_visibility_readonly_297>;
type _assert_Style_visibility_readonly_297 = Expect<_check_Style_visibility_readonly_297>;

type Ref_StyleCollection_getByNameOrNullObject_298 = (name: string) => DocxEditor.Style;
type Auth_StyleCollection_getByNameOrNullObject_298 = (name: string) => DocxEditor.Style;
type _check_StyleCollection_getByNameOrNullObject_298 = IsExact<Ref_StyleCollection_getByNameOrNullObject_298, Auth_StyleCollection_getByNameOrNullObject_298>;
type _assert_StyleCollection_getByNameOrNullObject_298 = Expect<_check_StyleCollection_getByNameOrNullObject_298>;

type Ref_StyleCollection_getCount_299 = () => DocxEditor.ClientResult<number>;
type Auth_StyleCollection_getCount_299 = () => DocxEditor.ClientResult<number>;
type _check_StyleCollection_getCount_299 = IsExact<Ref_StyleCollection_getCount_299, Auth_StyleCollection_getCount_299>;
type _assert_StyleCollection_getCount_299 = Expect<_check_StyleCollection_getCount_299>;

type Ref_StyleCollection_items_300 = () => DocxEditor.Style[];
type Auth_StyleCollection_items_300 = () => DocxEditor.Style[];
type _check_StyleCollection_items_300 = IsExact<Ref_StyleCollection_items_300, Auth_StyleCollection_items_300>;
type _assert_StyleCollection_items_300 = Expect<_check_StyleCollection_items_300>;

type Ref_StyleCollection_items_readonly_301 = { readonly value: DocxEditor.Style[] };
type Auth_StyleCollection_items_readonly_301 = { readonly value: DocxEditor.Style[] };
type _check_StyleCollection_items_readonly_301 = IsExact<Ref_StyleCollection_items_readonly_301, Auth_StyleCollection_items_readonly_301>;
type _assert_StyleCollection_items_readonly_301 = Expect<_check_StyleCollection_items_readonly_301>;

type Ref_run_302 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_302 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_302 = IsExact<Ref_run_302, Auth_run_302>;
type _assert_run_302 = Expect<_check_run_302>;

type Ref_run_303 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_303 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_303 = IsExact<Ref_run_303, Auth_run_303>;
type _assert_run_303 = Expect<_check_run_303>;

type Ref_run_304 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_304 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_304 = IsExact<Ref_run_304, Auth_run_304>;
type _assert_run_304 = Expect<_check_run_304>;

