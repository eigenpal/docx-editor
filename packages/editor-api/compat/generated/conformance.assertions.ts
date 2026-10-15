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

type Ref_Body_insertParagraph_10 = (paragraphText: string, insertLocation: "Start" | "End") => DocxEditor.Paragraph;
type Auth_Body_insertParagraph_10 = (paragraphText: string, insertLocation: "Start" | "End") => DocxEditor.Paragraph;
type _check_Body_insertParagraph_10 = IsExact<Ref_Body_insertParagraph_10, Auth_Body_insertParagraph_10>;
type _assert_Body_insertParagraph_10 = Expect<_check_Body_insertParagraph_10>;

type Ref_Body_insertText_11 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Body_insertText_11 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Body_insertText_11 = IsExact<Ref_Body_insertText_11, Auth_Body_insertText_11>;
type _assert_Body_insertText_11 = Expect<_check_Body_insertText_11>;

type Ref_Body_lists_12 = () => DocxEditor.ListCollection;
type Auth_Body_lists_12 = () => DocxEditor.ListCollection;
type _check_Body_lists_12 = IsExact<Ref_Body_lists_12, Auth_Body_lists_12>;
type _assert_Body_lists_12 = Expect<_check_Body_lists_12>;

type Ref_Body_lists_readonly_13 = { readonly value: DocxEditor.ListCollection };
type Auth_Body_lists_readonly_13 = { readonly value: DocxEditor.ListCollection };
type _check_Body_lists_readonly_13 = IsExact<Ref_Body_lists_readonly_13, Auth_Body_lists_readonly_13>;
type _assert_Body_lists_readonly_13 = Expect<_check_Body_lists_readonly_13>;

type Ref_Body_paragraphs_14 = () => DocxEditor.ParagraphCollection;
type Auth_Body_paragraphs_14 = () => DocxEditor.ParagraphCollection;
type _check_Body_paragraphs_14 = IsExact<Ref_Body_paragraphs_14, Auth_Body_paragraphs_14>;
type _assert_Body_paragraphs_14 = Expect<_check_Body_paragraphs_14>;

type Ref_Body_paragraphs_readonly_15 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Body_paragraphs_readonly_15 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Body_paragraphs_readonly_15 = IsExact<Ref_Body_paragraphs_readonly_15, Auth_Body_paragraphs_readonly_15>;
type _assert_Body_paragraphs_readonly_15 = Expect<_check_Body_paragraphs_readonly_15>;

type Ref_Body_search_16 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Body_search_16 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Body_search_16 = IsExact<Ref_Body_search_16, Auth_Body_search_16>;
type _assert_Body_search_16 = Expect<_check_Body_search_16>;

type Ref_Body_style_17 = () => string;
type Auth_Body_style_17 = () => string;
type _check_Body_style_17 = IsExact<Ref_Body_style_17, Auth_Body_style_17>;
type _assert_Body_style_17 = Expect<_check_Body_style_17>;

type Ref_Body_style_readonly_18 = { value: string };
type Auth_Body_style_readonly_18 = { value: string };
type _check_Body_style_readonly_18 = IsExact<Ref_Body_style_readonly_18, Auth_Body_style_readonly_18>;
type _assert_Body_style_readonly_18 = Expect<_check_Body_style_readonly_18>;

type Ref_Body_text_19 = () => string;
type Auth_Body_text_19 = () => string;
type _check_Body_text_19 = IsExact<Ref_Body_text_19, Auth_Body_text_19>;
type _assert_Body_text_19 = Expect<_check_Body_text_19>;

type Ref_Body_text_readonly_20 = { readonly value: string };
type Auth_Body_text_readonly_20 = { readonly value: string };
type _check_Body_text_readonly_20 = IsExact<Ref_Body_text_readonly_20, Auth_Body_text_readonly_20>;
type _assert_Body_text_readonly_20 = Expect<_check_Body_text_readonly_20>;

type Ref_Bookmark_delete_21 = () => void;
type Auth_Bookmark_delete_21 = () => void;
type _check_Bookmark_delete_21 = IsExact<Ref_Bookmark_delete_21, Auth_Bookmark_delete_21>;
type _assert_Bookmark_delete_21 = Expect<_check_Bookmark_delete_21>;

type Ref_Bookmark_name_22 = () => string;
type Auth_Bookmark_name_22 = () => string;
type _check_Bookmark_name_22 = IsExact<Ref_Bookmark_name_22, Auth_Bookmark_name_22>;
type _assert_Bookmark_name_22 = Expect<_check_Bookmark_name_22>;

type Ref_Bookmark_name_readonly_23 = { readonly value: string };
type Auth_Bookmark_name_readonly_23 = { readonly value: string };
type _check_Bookmark_name_readonly_23 = IsExact<Ref_Bookmark_name_readonly_23, Auth_Bookmark_name_readonly_23>;
type _assert_Bookmark_name_readonly_23 = Expect<_check_Bookmark_name_readonly_23>;

type Ref_Bookmark_range_24 = () => DocxEditor.Range;
type Auth_Bookmark_range_24 = () => DocxEditor.Range;
type _check_Bookmark_range_24 = IsExact<Ref_Bookmark_range_24, Auth_Bookmark_range_24>;
type _assert_Bookmark_range_24 = Expect<_check_Bookmark_range_24>;

type Ref_Bookmark_range_readonly_25 = { readonly value: DocxEditor.Range };
type Auth_Bookmark_range_readonly_25 = { readonly value: DocxEditor.Range };
type _check_Bookmark_range_readonly_25 = IsExact<Ref_Bookmark_range_readonly_25, Auth_Bookmark_range_readonly_25>;
type _assert_Bookmark_range_readonly_25 = Expect<_check_Bookmark_range_readonly_25>;

type Ref_Bookmark_select_26 = () => void;
type Auth_Bookmark_select_26 = () => void;
type _check_Bookmark_select_26 = IsExact<Ref_Bookmark_select_26, Auth_Bookmark_select_26>;
type _assert_Bookmark_select_26 = Expect<_check_Bookmark_select_26>;

type Ref_BookmarkCollection_items_27 = () => DocxEditor.Bookmark[];
type Auth_BookmarkCollection_items_27 = () => DocxEditor.Bookmark[];
type _check_BookmarkCollection_items_27 = IsExact<Ref_BookmarkCollection_items_27, Auth_BookmarkCollection_items_27>;
type _assert_BookmarkCollection_items_27 = Expect<_check_BookmarkCollection_items_27>;

type Ref_BookmarkCollection_items_readonly_28 = { readonly value: DocxEditor.Bookmark[] };
type Auth_BookmarkCollection_items_readonly_28 = { readonly value: DocxEditor.Bookmark[] };
type _check_BookmarkCollection_items_readonly_28 = IsExact<Ref_BookmarkCollection_items_readonly_28, Auth_BookmarkCollection_items_readonly_28>;
type _assert_BookmarkCollection_items_readonly_28 = Expect<_check_BookmarkCollection_items_readonly_28>;

type Ref_ClientObject_context_29 = () => DocxEditor.ClientRequestContext;
type Auth_ClientObject_context_29 = () => DocxEditor.ClientRequestContext;
type _check_ClientObject_context_29 = IsExact<Ref_ClientObject_context_29, Auth_ClientObject_context_29>;
type _assert_ClientObject_context_29 = Expect<_check_ClientObject_context_29>;

type Ref_ClientObject_context_readonly_30 = { value: DocxEditor.ClientRequestContext };
type Auth_ClientObject_context_readonly_30 = { value: DocxEditor.ClientRequestContext };
type _check_ClientObject_context_readonly_30 = IsExact<Ref_ClientObject_context_readonly_30, Auth_ClientObject_context_readonly_30>;
type _assert_ClientObject_context_readonly_30 = Expect<_check_ClientObject_context_readonly_30>;

type Ref_ClientObject_isNullObject_31 = () => boolean;
type Auth_ClientObject_isNullObject_31 = () => boolean;
type _check_ClientObject_isNullObject_31 = IsExact<Ref_ClientObject_isNullObject_31, Auth_ClientObject_isNullObject_31>;
type _assert_ClientObject_isNullObject_31 = Expect<_check_ClientObject_isNullObject_31>;

type Ref_ClientObject_isNullObject_readonly_32 = { value: boolean };
type Auth_ClientObject_isNullObject_readonly_32 = { value: boolean };
type _check_ClientObject_isNullObject_readonly_32 = IsExact<Ref_ClientObject_isNullObject_readonly_32, Auth_ClientObject_isNullObject_readonly_32>;
type _assert_ClientObject_isNullObject_readonly_32 = Expect<_check_ClientObject_isNullObject_readonly_32>;

type Ref_Comment_authorName_33 = () => string;
type Auth_Comment_authorName_33 = () => string;
type _check_Comment_authorName_33 = IsExact<Ref_Comment_authorName_33, Auth_Comment_authorName_33>;
type _assert_Comment_authorName_33 = Expect<_check_Comment_authorName_33>;

type Ref_Comment_authorName_readonly_34 = { readonly value: string };
type Auth_Comment_authorName_readonly_34 = { readonly value: string };
type _check_Comment_authorName_readonly_34 = IsExact<Ref_Comment_authorName_readonly_34, Auth_Comment_authorName_readonly_34>;
type _assert_Comment_authorName_readonly_34 = Expect<_check_Comment_authorName_readonly_34>;

type Ref_Comment_creationDate_35 = () => Date;
type Auth_Comment_creationDate_35 = () => Date;
type _check_Comment_creationDate_35 = IsExact<Ref_Comment_creationDate_35, Auth_Comment_creationDate_35>;
type _assert_Comment_creationDate_35 = Expect<_check_Comment_creationDate_35>;

type Ref_Comment_creationDate_readonly_36 = { readonly value: Date };
type Auth_Comment_creationDate_readonly_36 = { readonly value: Date };
type _check_Comment_creationDate_readonly_36 = IsExact<Ref_Comment_creationDate_readonly_36, Auth_Comment_creationDate_readonly_36>;
type _assert_Comment_creationDate_readonly_36 = Expect<_check_Comment_creationDate_readonly_36>;

type Ref_Comment_delete_37 = () => void;
type Auth_Comment_delete_37 = () => void;
type _check_Comment_delete_37 = IsExact<Ref_Comment_delete_37, Auth_Comment_delete_37>;
type _assert_Comment_delete_37 = Expect<_check_Comment_delete_37>;

type Ref_Comment_getRange_38 = () => DocxEditor.Range;
type Auth_Comment_getRange_38 = () => DocxEditor.Range;
type _check_Comment_getRange_38 = IsExact<Ref_Comment_getRange_38, Auth_Comment_getRange_38>;
type _assert_Comment_getRange_38 = Expect<_check_Comment_getRange_38>;

type Ref_Comment_id_39 = () => string;
type Auth_Comment_id_39 = () => string;
type _check_Comment_id_39 = IsExact<Ref_Comment_id_39, Auth_Comment_id_39>;
type _assert_Comment_id_39 = Expect<_check_Comment_id_39>;

type Ref_Comment_id_readonly_40 = { readonly value: string };
type Auth_Comment_id_readonly_40 = { readonly value: string };
type _check_Comment_id_readonly_40 = IsExact<Ref_Comment_id_readonly_40, Auth_Comment_id_readonly_40>;
type _assert_Comment_id_readonly_40 = Expect<_check_Comment_id_readonly_40>;

type Ref_Comment_replies_41 = () => DocxEditor.CommentReplyCollection;
type Auth_Comment_replies_41 = () => DocxEditor.CommentReplyCollection;
type _check_Comment_replies_41 = IsExact<Ref_Comment_replies_41, Auth_Comment_replies_41>;
type _assert_Comment_replies_41 = Expect<_check_Comment_replies_41>;

type Ref_Comment_replies_readonly_42 = { readonly value: DocxEditor.CommentReplyCollection };
type Auth_Comment_replies_readonly_42 = { readonly value: DocxEditor.CommentReplyCollection };
type _check_Comment_replies_readonly_42 = IsExact<Ref_Comment_replies_readonly_42, Auth_Comment_replies_readonly_42>;
type _assert_Comment_replies_readonly_42 = Expect<_check_Comment_replies_readonly_42>;

type Ref_Comment_reply_43 = (replyText: string) => DocxEditor.CommentReply;
type Auth_Comment_reply_43 = (replyText: string) => DocxEditor.CommentReply;
type _check_Comment_reply_43 = IsExact<Ref_Comment_reply_43, Auth_Comment_reply_43>;
type _assert_Comment_reply_43 = Expect<_check_Comment_reply_43>;

type Ref_Comment_resolved_44 = () => boolean;
type Auth_Comment_resolved_44 = () => boolean;
type _check_Comment_resolved_44 = IsExact<Ref_Comment_resolved_44, Auth_Comment_resolved_44>;
type _assert_Comment_resolved_44 = Expect<_check_Comment_resolved_44>;

type Ref_Comment_resolved_readonly_45 = { value: boolean };
type Auth_Comment_resolved_readonly_45 = { value: boolean };
type _check_Comment_resolved_readonly_45 = IsExact<Ref_Comment_resolved_readonly_45, Auth_Comment_resolved_readonly_45>;
type _assert_Comment_resolved_readonly_45 = Expect<_check_Comment_resolved_readonly_45>;

type Ref_CommentCollection_getFirst_46 = () => DocxEditor.Comment;
type Auth_CommentCollection_getFirst_46 = () => DocxEditor.Comment;
type _check_CommentCollection_getFirst_46 = IsExact<Ref_CommentCollection_getFirst_46, Auth_CommentCollection_getFirst_46>;
type _assert_CommentCollection_getFirst_46 = Expect<_check_CommentCollection_getFirst_46>;

type Ref_CommentCollection_items_47 = () => DocxEditor.Comment[];
type Auth_CommentCollection_items_47 = () => DocxEditor.Comment[];
type _check_CommentCollection_items_47 = IsExact<Ref_CommentCollection_items_47, Auth_CommentCollection_items_47>;
type _assert_CommentCollection_items_47 = Expect<_check_CommentCollection_items_47>;

type Ref_CommentCollection_items_readonly_48 = { readonly value: DocxEditor.Comment[] };
type Auth_CommentCollection_items_readonly_48 = { readonly value: DocxEditor.Comment[] };
type _check_CommentCollection_items_readonly_48 = IsExact<Ref_CommentCollection_items_readonly_48, Auth_CommentCollection_items_readonly_48>;
type _assert_CommentCollection_items_readonly_48 = Expect<_check_CommentCollection_items_readonly_48>;

type Ref_CommentReply_authorName_49 = () => string;
type Auth_CommentReply_authorName_49 = () => string;
type _check_CommentReply_authorName_49 = IsExact<Ref_CommentReply_authorName_49, Auth_CommentReply_authorName_49>;
type _assert_CommentReply_authorName_49 = Expect<_check_CommentReply_authorName_49>;

type Ref_CommentReply_authorName_readonly_50 = { readonly value: string };
type Auth_CommentReply_authorName_readonly_50 = { readonly value: string };
type _check_CommentReply_authorName_readonly_50 = IsExact<Ref_CommentReply_authorName_readonly_50, Auth_CommentReply_authorName_readonly_50>;
type _assert_CommentReply_authorName_readonly_50 = Expect<_check_CommentReply_authorName_readonly_50>;

type Ref_CommentReply_creationDate_51 = () => Date;
type Auth_CommentReply_creationDate_51 = () => Date;
type _check_CommentReply_creationDate_51 = IsExact<Ref_CommentReply_creationDate_51, Auth_CommentReply_creationDate_51>;
type _assert_CommentReply_creationDate_51 = Expect<_check_CommentReply_creationDate_51>;

type Ref_CommentReply_creationDate_readonly_52 = { readonly value: Date };
type Auth_CommentReply_creationDate_readonly_52 = { readonly value: Date };
type _check_CommentReply_creationDate_readonly_52 = IsExact<Ref_CommentReply_creationDate_readonly_52, Auth_CommentReply_creationDate_readonly_52>;
type _assert_CommentReply_creationDate_readonly_52 = Expect<_check_CommentReply_creationDate_readonly_52>;

type Ref_CommentReply_delete_53 = () => void;
type Auth_CommentReply_delete_53 = () => void;
type _check_CommentReply_delete_53 = IsExact<Ref_CommentReply_delete_53, Auth_CommentReply_delete_53>;
type _assert_CommentReply_delete_53 = Expect<_check_CommentReply_delete_53>;

type Ref_CommentReply_id_54 = () => string;
type Auth_CommentReply_id_54 = () => string;
type _check_CommentReply_id_54 = IsExact<Ref_CommentReply_id_54, Auth_CommentReply_id_54>;
type _assert_CommentReply_id_54 = Expect<_check_CommentReply_id_54>;

type Ref_CommentReply_id_readonly_55 = { readonly value: string };
type Auth_CommentReply_id_readonly_55 = { readonly value: string };
type _check_CommentReply_id_readonly_55 = IsExact<Ref_CommentReply_id_readonly_55, Auth_CommentReply_id_readonly_55>;
type _assert_CommentReply_id_readonly_55 = Expect<_check_CommentReply_id_readonly_55>;

type Ref_CommentReplyCollection_getFirst_56 = () => DocxEditor.CommentReply;
type Auth_CommentReplyCollection_getFirst_56 = () => DocxEditor.CommentReply;
type _check_CommentReplyCollection_getFirst_56 = IsExact<Ref_CommentReplyCollection_getFirst_56, Auth_CommentReplyCollection_getFirst_56>;
type _assert_CommentReplyCollection_getFirst_56 = Expect<_check_CommentReplyCollection_getFirst_56>;

type Ref_CommentReplyCollection_items_57 = () => DocxEditor.CommentReply[];
type Auth_CommentReplyCollection_items_57 = () => DocxEditor.CommentReply[];
type _check_CommentReplyCollection_items_57 = IsExact<Ref_CommentReplyCollection_items_57, Auth_CommentReplyCollection_items_57>;
type _assert_CommentReplyCollection_items_57 = Expect<_check_CommentReplyCollection_items_57>;

type Ref_CommentReplyCollection_items_readonly_58 = { readonly value: DocxEditor.CommentReply[] };
type Auth_CommentReplyCollection_items_readonly_58 = { readonly value: DocxEditor.CommentReply[] };
type _check_CommentReplyCollection_items_readonly_58 = IsExact<Ref_CommentReplyCollection_items_readonly_58, Auth_CommentReplyCollection_items_readonly_58>;
type _assert_CommentReplyCollection_items_readonly_58 = Expect<_check_CommentReplyCollection_items_readonly_58>;

type Ref_ContentControl_cannotDelete_59 = () => boolean;
type Auth_ContentControl_cannotDelete_59 = () => boolean;
type _check_ContentControl_cannotDelete_59 = IsExact<Ref_ContentControl_cannotDelete_59, Auth_ContentControl_cannotDelete_59>;
type _assert_ContentControl_cannotDelete_59 = Expect<_check_ContentControl_cannotDelete_59>;

type Ref_ContentControl_cannotDelete_readonly_60 = { value: boolean };
type Auth_ContentControl_cannotDelete_readonly_60 = { value: boolean };
type _check_ContentControl_cannotDelete_readonly_60 = IsExact<Ref_ContentControl_cannotDelete_readonly_60, Auth_ContentControl_cannotDelete_readonly_60>;
type _assert_ContentControl_cannotDelete_readonly_60 = Expect<_check_ContentControl_cannotDelete_readonly_60>;

type Ref_ContentControl_cannotEdit_61 = () => boolean;
type Auth_ContentControl_cannotEdit_61 = () => boolean;
type _check_ContentControl_cannotEdit_61 = IsExact<Ref_ContentControl_cannotEdit_61, Auth_ContentControl_cannotEdit_61>;
type _assert_ContentControl_cannotEdit_61 = Expect<_check_ContentControl_cannotEdit_61>;

type Ref_ContentControl_cannotEdit_readonly_62 = { value: boolean };
type Auth_ContentControl_cannotEdit_readonly_62 = { value: boolean };
type _check_ContentControl_cannotEdit_readonly_62 = IsExact<Ref_ContentControl_cannotEdit_readonly_62, Auth_ContentControl_cannotEdit_readonly_62>;
type _assert_ContentControl_cannotEdit_readonly_62 = Expect<_check_ContentControl_cannotEdit_readonly_62>;

type Ref_ContentControl_contentControls_63 = () => DocxEditor.ContentControlCollection;
type Auth_ContentControl_contentControls_63 = () => DocxEditor.ContentControlCollection;
type _check_ContentControl_contentControls_63 = IsExact<Ref_ContentControl_contentControls_63, Auth_ContentControl_contentControls_63>;
type _assert_ContentControl_contentControls_63 = Expect<_check_ContentControl_contentControls_63>;

type Ref_ContentControl_contentControls_readonly_64 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_ContentControl_contentControls_readonly_64 = { readonly value: DocxEditor.ContentControlCollection };
type _check_ContentControl_contentControls_readonly_64 = IsExact<Ref_ContentControl_contentControls_readonly_64, Auth_ContentControl_contentControls_readonly_64>;
type _assert_ContentControl_contentControls_readonly_64 = Expect<_check_ContentControl_contentControls_readonly_64>;

type Ref_ContentControl_delete_65 = (keepContent: boolean) => void;
type Auth_ContentControl_delete_65 = (keepContent: boolean) => void;
type _check_ContentControl_delete_65 = IsExact<Ref_ContentControl_delete_65, Auth_ContentControl_delete_65>;
type _assert_ContentControl_delete_65 = Expect<_check_ContentControl_delete_65>;

type Ref_ContentControl_getRange_66 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type Auth_ContentControl_getRange_66 = (rangeLocation?: "Whole" | "Start" | "End" | "Before" | "After" | "Content") => DocxEditor.Range;
type _check_ContentControl_getRange_66 = IsExact<Ref_ContentControl_getRange_66, Auth_ContentControl_getRange_66>;
type _assert_ContentControl_getRange_66 = Expect<_check_ContentControl_getRange_66>;

type Ref_ContentControl_insertText_67 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_ContentControl_insertText_67 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_ContentControl_insertText_67 = IsExact<Ref_ContentControl_insertText_67, Auth_ContentControl_insertText_67>;
type _assert_ContentControl_insertText_67 = Expect<_check_ContentControl_insertText_67>;

type Ref_ContentControl_paragraphs_68 = () => DocxEditor.ParagraphCollection;
type Auth_ContentControl_paragraphs_68 = () => DocxEditor.ParagraphCollection;
type _check_ContentControl_paragraphs_68 = IsExact<Ref_ContentControl_paragraphs_68, Auth_ContentControl_paragraphs_68>;
type _assert_ContentControl_paragraphs_68 = Expect<_check_ContentControl_paragraphs_68>;

type Ref_ContentControl_paragraphs_readonly_69 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_ContentControl_paragraphs_readonly_69 = { readonly value: DocxEditor.ParagraphCollection };
type _check_ContentControl_paragraphs_readonly_69 = IsExact<Ref_ContentControl_paragraphs_readonly_69, Auth_ContentControl_paragraphs_readonly_69>;
type _assert_ContentControl_paragraphs_readonly_69 = Expect<_check_ContentControl_paragraphs_readonly_69>;

type Ref_ContentControl_tag_70 = () => string;
type Auth_ContentControl_tag_70 = () => string;
type _check_ContentControl_tag_70 = IsExact<Ref_ContentControl_tag_70, Auth_ContentControl_tag_70>;
type _assert_ContentControl_tag_70 = Expect<_check_ContentControl_tag_70>;

type Ref_ContentControl_tag_readonly_71 = { value: string };
type Auth_ContentControl_tag_readonly_71 = { value: string };
type _check_ContentControl_tag_readonly_71 = IsExact<Ref_ContentControl_tag_readonly_71, Auth_ContentControl_tag_readonly_71>;
type _assert_ContentControl_tag_readonly_71 = Expect<_check_ContentControl_tag_readonly_71>;

type Ref_ContentControl_text_72 = () => string;
type Auth_ContentControl_text_72 = () => string;
type _check_ContentControl_text_72 = IsExact<Ref_ContentControl_text_72, Auth_ContentControl_text_72>;
type _assert_ContentControl_text_72 = Expect<_check_ContentControl_text_72>;

type Ref_ContentControl_text_readonly_73 = { readonly value: string };
type Auth_ContentControl_text_readonly_73 = { readonly value: string };
type _check_ContentControl_text_readonly_73 = IsExact<Ref_ContentControl_text_readonly_73, Auth_ContentControl_text_readonly_73>;
type _assert_ContentControl_text_readonly_73 = Expect<_check_ContentControl_text_readonly_73>;

type Ref_ContentControl_title_74 = () => string;
type Auth_ContentControl_title_74 = () => string;
type _check_ContentControl_title_74 = IsExact<Ref_ContentControl_title_74, Auth_ContentControl_title_74>;
type _assert_ContentControl_title_74 = Expect<_check_ContentControl_title_74>;

type Ref_ContentControl_title_readonly_75 = { value: string };
type Auth_ContentControl_title_readonly_75 = { value: string };
type _check_ContentControl_title_readonly_75 = IsExact<Ref_ContentControl_title_readonly_75, Auth_ContentControl_title_readonly_75>;
type _assert_ContentControl_title_readonly_75 = Expect<_check_ContentControl_title_readonly_75>;

type Ref_ContentControlCollection_getById_76 = (id: number) => DocxEditor.ContentControl;
type Auth_ContentControlCollection_getById_76 = (id: number) => DocxEditor.ContentControl;
type _check_ContentControlCollection_getById_76 = IsExact<Ref_ContentControlCollection_getById_76, Auth_ContentControlCollection_getById_76>;
type _assert_ContentControlCollection_getById_76 = Expect<_check_ContentControlCollection_getById_76>;

type Ref_ContentControlCollection_items_77 = () => DocxEditor.ContentControl[];
type Auth_ContentControlCollection_items_77 = () => DocxEditor.ContentControl[];
type _check_ContentControlCollection_items_77 = IsExact<Ref_ContentControlCollection_items_77, Auth_ContentControlCollection_items_77>;
type _assert_ContentControlCollection_items_77 = Expect<_check_ContentControlCollection_items_77>;

type Ref_ContentControlCollection_items_readonly_78 = { readonly value: DocxEditor.ContentControl[] };
type Auth_ContentControlCollection_items_readonly_78 = { readonly value: DocxEditor.ContentControl[] };
type _check_ContentControlCollection_items_readonly_78 = IsExact<Ref_ContentControlCollection_items_readonly_78, Auth_ContentControlCollection_items_readonly_78>;
type _assert_ContentControlCollection_items_readonly_78 = Expect<_check_ContentControlCollection_items_readonly_78>;

type Ref_Document_body_79 = () => DocxEditor.Body;
type Auth_Document_body_79 = () => DocxEditor.Body;
type _check_Document_body_79 = IsExact<Ref_Document_body_79, Auth_Document_body_79>;
type _assert_Document_body_79 = Expect<_check_Document_body_79>;

type Ref_Document_body_readonly_80 = { readonly value: DocxEditor.Body };
type Auth_Document_body_readonly_80 = { readonly value: DocxEditor.Body };
type _check_Document_body_readonly_80 = IsExact<Ref_Document_body_readonly_80, Auth_Document_body_readonly_80>;
type _assert_Document_body_readonly_80 = Expect<_check_Document_body_readonly_80>;

type Ref_Document_changeTrackingMode_81 = () => "Off" | "TrackAll" | "TrackMineOnly";
type Auth_Document_changeTrackingMode_81 = () => "Off" | "TrackAll" | "TrackMineOnly";
type _check_Document_changeTrackingMode_81 = IsExact<Ref_Document_changeTrackingMode_81, Auth_Document_changeTrackingMode_81>;
type _assert_Document_changeTrackingMode_81 = Expect<_check_Document_changeTrackingMode_81>;

type Ref_Document_changeTrackingMode_readonly_82 = { value: "Off" | "TrackAll" | "TrackMineOnly" };
type Auth_Document_changeTrackingMode_readonly_82 = { value: "Off" | "TrackAll" | "TrackMineOnly" };
type _check_Document_changeTrackingMode_readonly_82 = IsExact<Ref_Document_changeTrackingMode_readonly_82, Auth_Document_changeTrackingMode_readonly_82>;
type _assert_Document_changeTrackingMode_readonly_82 = Expect<_check_Document_changeTrackingMode_readonly_82>;

type Ref_Document_comments_83 = () => DocxEditor.CommentCollection;
type Auth_Document_comments_83 = () => DocxEditor.CommentCollection;
type _check_Document_comments_83 = IsExact<Ref_Document_comments_83, Auth_Document_comments_83>;
type _assert_Document_comments_83 = Expect<_check_Document_comments_83>;

type Ref_Document_comments_readonly_84 = { readonly value: DocxEditor.CommentCollection };
type Auth_Document_comments_readonly_84 = { readonly value: DocxEditor.CommentCollection };
type _check_Document_comments_readonly_84 = IsExact<Ref_Document_comments_readonly_84, Auth_Document_comments_readonly_84>;
type _assert_Document_comments_readonly_84 = Expect<_check_Document_comments_readonly_84>;

type Ref_Document_contentControls_85 = () => DocxEditor.ContentControlCollection;
type Auth_Document_contentControls_85 = () => DocxEditor.ContentControlCollection;
type _check_Document_contentControls_85 = IsExact<Ref_Document_contentControls_85, Auth_Document_contentControls_85>;
type _assert_Document_contentControls_85 = Expect<_check_Document_contentControls_85>;

type Ref_Document_contentControls_readonly_86 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Document_contentControls_readonly_86 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Document_contentControls_readonly_86 = IsExact<Ref_Document_contentControls_readonly_86, Auth_Document_contentControls_readonly_86>;
type _assert_Document_contentControls_readonly_86 = Expect<_check_Document_contentControls_readonly_86>;

type Ref_Document_deleteBookmark_87 = (name: string) => void;
type Auth_Document_deleteBookmark_87 = (name: string) => void;
type _check_Document_deleteBookmark_87 = IsExact<Ref_Document_deleteBookmark_87, Auth_Document_deleteBookmark_87>;
type _assert_Document_deleteBookmark_87 = Expect<_check_Document_deleteBookmark_87>;

type Ref_Document_getBookmarkRange_88 = (name: string) => DocxEditor.Range;
type Auth_Document_getBookmarkRange_88 = (name: string) => DocxEditor.Range;
type _check_Document_getBookmarkRange_88 = IsExact<Ref_Document_getBookmarkRange_88, Auth_Document_getBookmarkRange_88>;
type _assert_Document_getBookmarkRange_88 = Expect<_check_Document_getBookmarkRange_88>;

type Ref_Document_getBookmarkRangeOrNullObject_89 = (name: string) => DocxEditor.Range;
type Auth_Document_getBookmarkRangeOrNullObject_89 = (name: string) => DocxEditor.Range;
type _check_Document_getBookmarkRangeOrNullObject_89 = IsExact<Ref_Document_getBookmarkRangeOrNullObject_89, Auth_Document_getBookmarkRangeOrNullObject_89>;
type _assert_Document_getBookmarkRangeOrNullObject_89 = Expect<_check_Document_getBookmarkRangeOrNullObject_89>;

type Ref_Document_paragraphs_90 = () => DocxEditor.ParagraphCollection;
type Auth_Document_paragraphs_90 = () => DocxEditor.ParagraphCollection;
type _check_Document_paragraphs_90 = IsExact<Ref_Document_paragraphs_90, Auth_Document_paragraphs_90>;
type _assert_Document_paragraphs_90 = Expect<_check_Document_paragraphs_90>;

type Ref_Document_paragraphs_readonly_91 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Document_paragraphs_readonly_91 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Document_paragraphs_readonly_91 = IsExact<Ref_Document_paragraphs_readonly_91, Auth_Document_paragraphs_readonly_91>;
type _assert_Document_paragraphs_readonly_91 = Expect<_check_Document_paragraphs_readonly_91>;

type Ref_Document_properties_92 = () => DocxEditor.DocumentProperties;
type Auth_Document_properties_92 = () => DocxEditor.DocumentProperties;
type _check_Document_properties_92 = IsExact<Ref_Document_properties_92, Auth_Document_properties_92>;
type _assert_Document_properties_92 = Expect<_check_Document_properties_92>;

type Ref_Document_properties_readonly_93 = { readonly value: DocxEditor.DocumentProperties };
type Auth_Document_properties_readonly_93 = { readonly value: DocxEditor.DocumentProperties };
type _check_Document_properties_readonly_93 = IsExact<Ref_Document_properties_readonly_93, Auth_Document_properties_readonly_93>;
type _assert_Document_properties_readonly_93 = Expect<_check_Document_properties_readonly_93>;

type Ref_Document_removeDocumentInformation_94 = (removeDocInfoType: DocxEditor.RemoveDocInfoType) => void;
type Auth_Document_removeDocumentInformation_94 = (removeDocInfoType: DocxEditor.RemoveDocInfoType) => void;
type _check_Document_removeDocumentInformation_94 = IsExact<Ref_Document_removeDocumentInformation_94, Auth_Document_removeDocumentInformation_94>;
type _assert_Document_removeDocumentInformation_94 = Expect<_check_Document_removeDocumentInformation_94>;

type Ref_Document_removeDocumentInformation_95 = (removeDocInfoType: "Comments" | "Revisions" | "Versions" | "RemovePersonalInformation" | "EmailHeader" | "RoutingSlip" | "SendForReview" | "DocumentProperties" | "Template" | "DocumentWorkspace" | "InkAnnotations" | "DocumentServerProperties" | "DocumentManagementPolicy" | "ContentType" | "TaskpaneWebExtensions" | "AtMentions" | "DocumentTasks" | "DocumentIntelligence" | "CommentReactions" | "All") => void;
type Auth_Document_removeDocumentInformation_95 = (removeDocInfoType: "Comments" | "Revisions" | "Versions" | "RemovePersonalInformation" | "EmailHeader" | "RoutingSlip" | "SendForReview" | "DocumentProperties" | "Template" | "DocumentWorkspace" | "InkAnnotations" | "DocumentServerProperties" | "DocumentManagementPolicy" | "ContentType" | "TaskpaneWebExtensions" | "AtMentions" | "DocumentTasks" | "DocumentIntelligence" | "CommentReactions" | "All") => void;
type _check_Document_removeDocumentInformation_95 = IsExact<Ref_Document_removeDocumentInformation_95, Auth_Document_removeDocumentInformation_95>;
type _assert_Document_removeDocumentInformation_95 = Expect<_check_Document_removeDocumentInformation_95>;

type Ref_Document_revisions_96 = () => DocxEditor.RevisionCollection;
type Auth_Document_revisions_96 = () => DocxEditor.RevisionCollection;
type _check_Document_revisions_96 = IsExact<Ref_Document_revisions_96, Auth_Document_revisions_96>;
type _assert_Document_revisions_96 = Expect<_check_Document_revisions_96>;

type Ref_Document_revisions_readonly_97 = { readonly value: DocxEditor.RevisionCollection };
type Auth_Document_revisions_readonly_97 = { readonly value: DocxEditor.RevisionCollection };
type _check_Document_revisions_readonly_97 = IsExact<Ref_Document_revisions_readonly_97, Auth_Document_revisions_readonly_97>;
type _assert_Document_revisions_readonly_97 = Expect<_check_Document_revisions_readonly_97>;

type Ref_Document_sections_98 = () => DocxEditor.SectionCollection;
type Auth_Document_sections_98 = () => DocxEditor.SectionCollection;
type _check_Document_sections_98 = IsExact<Ref_Document_sections_98, Auth_Document_sections_98>;
type _assert_Document_sections_98 = Expect<_check_Document_sections_98>;

type Ref_Document_sections_readonly_99 = { readonly value: DocxEditor.SectionCollection };
type Auth_Document_sections_readonly_99 = { readonly value: DocxEditor.SectionCollection };
type _check_Document_sections_readonly_99 = IsExact<Ref_Document_sections_readonly_99, Auth_Document_sections_readonly_99>;
type _assert_Document_sections_readonly_99 = Expect<_check_Document_sections_readonly_99>;

type Ref_DocumentProperties_author_100 = () => string;
type Auth_DocumentProperties_author_100 = () => string;
type _check_DocumentProperties_author_100 = IsExact<Ref_DocumentProperties_author_100, Auth_DocumentProperties_author_100>;
type _assert_DocumentProperties_author_100 = Expect<_check_DocumentProperties_author_100>;

type Ref_DocumentProperties_author_readonly_101 = { value: string };
type Auth_DocumentProperties_author_readonly_101 = { value: string };
type _check_DocumentProperties_author_readonly_101 = IsExact<Ref_DocumentProperties_author_readonly_101, Auth_DocumentProperties_author_readonly_101>;
type _assert_DocumentProperties_author_readonly_101 = Expect<_check_DocumentProperties_author_readonly_101>;

type Ref_DocumentProperties_category_102 = () => string;
type Auth_DocumentProperties_category_102 = () => string;
type _check_DocumentProperties_category_102 = IsExact<Ref_DocumentProperties_category_102, Auth_DocumentProperties_category_102>;
type _assert_DocumentProperties_category_102 = Expect<_check_DocumentProperties_category_102>;

type Ref_DocumentProperties_category_readonly_103 = { value: string };
type Auth_DocumentProperties_category_readonly_103 = { value: string };
type _check_DocumentProperties_category_readonly_103 = IsExact<Ref_DocumentProperties_category_readonly_103, Auth_DocumentProperties_category_readonly_103>;
type _assert_DocumentProperties_category_readonly_103 = Expect<_check_DocumentProperties_category_readonly_103>;

type Ref_DocumentProperties_comments_104 = () => string;
type Auth_DocumentProperties_comments_104 = () => string;
type _check_DocumentProperties_comments_104 = IsExact<Ref_DocumentProperties_comments_104, Auth_DocumentProperties_comments_104>;
type _assert_DocumentProperties_comments_104 = Expect<_check_DocumentProperties_comments_104>;

type Ref_DocumentProperties_comments_readonly_105 = { value: string };
type Auth_DocumentProperties_comments_readonly_105 = { value: string };
type _check_DocumentProperties_comments_readonly_105 = IsExact<Ref_DocumentProperties_comments_readonly_105, Auth_DocumentProperties_comments_readonly_105>;
type _assert_DocumentProperties_comments_readonly_105 = Expect<_check_DocumentProperties_comments_readonly_105>;

type Ref_DocumentProperties_keywords_106 = () => string;
type Auth_DocumentProperties_keywords_106 = () => string;
type _check_DocumentProperties_keywords_106 = IsExact<Ref_DocumentProperties_keywords_106, Auth_DocumentProperties_keywords_106>;
type _assert_DocumentProperties_keywords_106 = Expect<_check_DocumentProperties_keywords_106>;

type Ref_DocumentProperties_keywords_readonly_107 = { value: string };
type Auth_DocumentProperties_keywords_readonly_107 = { value: string };
type _check_DocumentProperties_keywords_readonly_107 = IsExact<Ref_DocumentProperties_keywords_readonly_107, Auth_DocumentProperties_keywords_readonly_107>;
type _assert_DocumentProperties_keywords_readonly_107 = Expect<_check_DocumentProperties_keywords_readonly_107>;

type Ref_DocumentProperties_lastAuthor_108 = () => string;
type Auth_DocumentProperties_lastAuthor_108 = () => string;
type _check_DocumentProperties_lastAuthor_108 = IsExact<Ref_DocumentProperties_lastAuthor_108, Auth_DocumentProperties_lastAuthor_108>;
type _assert_DocumentProperties_lastAuthor_108 = Expect<_check_DocumentProperties_lastAuthor_108>;

type Ref_DocumentProperties_lastAuthor_readonly_109 = { readonly value: string };
type Auth_DocumentProperties_lastAuthor_readonly_109 = { readonly value: string };
type _check_DocumentProperties_lastAuthor_readonly_109 = IsExact<Ref_DocumentProperties_lastAuthor_readonly_109, Auth_DocumentProperties_lastAuthor_readonly_109>;
type _assert_DocumentProperties_lastAuthor_readonly_109 = Expect<_check_DocumentProperties_lastAuthor_readonly_109>;

type Ref_DocumentProperties_subject_110 = () => string;
type Auth_DocumentProperties_subject_110 = () => string;
type _check_DocumentProperties_subject_110 = IsExact<Ref_DocumentProperties_subject_110, Auth_DocumentProperties_subject_110>;
type _assert_DocumentProperties_subject_110 = Expect<_check_DocumentProperties_subject_110>;

type Ref_DocumentProperties_subject_readonly_111 = { value: string };
type Auth_DocumentProperties_subject_readonly_111 = { value: string };
type _check_DocumentProperties_subject_readonly_111 = IsExact<Ref_DocumentProperties_subject_readonly_111, Auth_DocumentProperties_subject_readonly_111>;
type _assert_DocumentProperties_subject_readonly_111 = Expect<_check_DocumentProperties_subject_readonly_111>;

type Ref_DocumentProperties_title_112 = () => string;
type Auth_DocumentProperties_title_112 = () => string;
type _check_DocumentProperties_title_112 = IsExact<Ref_DocumentProperties_title_112, Auth_DocumentProperties_title_112>;
type _assert_DocumentProperties_title_112 = Expect<_check_DocumentProperties_title_112>;

type Ref_DocumentProperties_title_readonly_113 = { value: string };
type Auth_DocumentProperties_title_readonly_113 = { value: string };
type _check_DocumentProperties_title_readonly_113 = IsExact<Ref_DocumentProperties_title_readonly_113, Auth_DocumentProperties_title_readonly_113>;
type _assert_DocumentProperties_title_readonly_113 = Expect<_check_DocumentProperties_title_readonly_113>;

type Ref_Font_bold_114 = () => boolean;
type Auth_Font_bold_114 = () => boolean;
type _check_Font_bold_114 = IsExact<Ref_Font_bold_114, Auth_Font_bold_114>;
type _assert_Font_bold_114 = Expect<_check_Font_bold_114>;

type Ref_Font_bold_readonly_115 = { value: boolean };
type Auth_Font_bold_readonly_115 = { value: boolean };
type _check_Font_bold_readonly_115 = IsExact<Ref_Font_bold_readonly_115, Auth_Font_bold_readonly_115>;
type _assert_Font_bold_readonly_115 = Expect<_check_Font_bold_readonly_115>;

type Ref_Font_color_116 = () => string;
type Auth_Font_color_116 = () => string;
type _check_Font_color_116 = IsExact<Ref_Font_color_116, Auth_Font_color_116>;
type _assert_Font_color_116 = Expect<_check_Font_color_116>;

type Ref_Font_color_readonly_117 = { value: string };
type Auth_Font_color_readonly_117 = { value: string };
type _check_Font_color_readonly_117 = IsExact<Ref_Font_color_readonly_117, Auth_Font_color_readonly_117>;
type _assert_Font_color_readonly_117 = Expect<_check_Font_color_readonly_117>;

type Ref_Font_italic_118 = () => boolean;
type Auth_Font_italic_118 = () => boolean;
type _check_Font_italic_118 = IsExact<Ref_Font_italic_118, Auth_Font_italic_118>;
type _assert_Font_italic_118 = Expect<_check_Font_italic_118>;

type Ref_Font_italic_readonly_119 = { value: boolean };
type Auth_Font_italic_readonly_119 = { value: boolean };
type _check_Font_italic_readonly_119 = IsExact<Ref_Font_italic_readonly_119, Auth_Font_italic_readonly_119>;
type _assert_Font_italic_readonly_119 = Expect<_check_Font_italic_readonly_119>;

type Ref_Font_name_120 = () => string;
type Auth_Font_name_120 = () => string;
type _check_Font_name_120 = IsExact<Ref_Font_name_120, Auth_Font_name_120>;
type _assert_Font_name_120 = Expect<_check_Font_name_120>;

type Ref_Font_name_readonly_121 = { value: string };
type Auth_Font_name_readonly_121 = { value: string };
type _check_Font_name_readonly_121 = IsExact<Ref_Font_name_readonly_121, Auth_Font_name_readonly_121>;
type _assert_Font_name_readonly_121 = Expect<_check_Font_name_readonly_121>;

type Ref_Font_size_122 = () => number;
type Auth_Font_size_122 = () => number;
type _check_Font_size_122 = IsExact<Ref_Font_size_122, Auth_Font_size_122>;
type _assert_Font_size_122 = Expect<_check_Font_size_122>;

type Ref_Font_size_readonly_123 = { value: number };
type Auth_Font_size_readonly_123 = { value: number };
type _check_Font_size_readonly_123 = IsExact<Ref_Font_size_readonly_123, Auth_Font_size_readonly_123>;
type _assert_Font_size_readonly_123 = Expect<_check_Font_size_readonly_123>;

type Ref_List_getLevelParagraphs_124 = (level: number) => DocxEditor.ParagraphCollection;
type Auth_List_getLevelParagraphs_124 = (level: number) => DocxEditor.ParagraphCollection;
type _check_List_getLevelParagraphs_124 = IsExact<Ref_List_getLevelParagraphs_124, Auth_List_getLevelParagraphs_124>;
type _assert_List_getLevelParagraphs_124 = Expect<_check_List_getLevelParagraphs_124>;

type Ref_List_id_125 = () => number;
type Auth_List_id_125 = () => number;
type _check_List_id_125 = IsExact<Ref_List_id_125, Auth_List_id_125>;
type _assert_List_id_125 = Expect<_check_List_id_125>;

type Ref_List_id_readonly_126 = { readonly value: number };
type Auth_List_id_readonly_126 = { readonly value: number };
type _check_List_id_readonly_126 = IsExact<Ref_List_id_readonly_126, Auth_List_id_readonly_126>;
type _assert_List_id_readonly_126 = Expect<_check_List_id_readonly_126>;

type Ref_List_insertParagraph_127 = (paragraphText: string, insertLocation: "Start" | "End" | "Before" | "After") => DocxEditor.Paragraph;
type Auth_List_insertParagraph_127 = (paragraphText: string, insertLocation: "Start" | "End" | "Before" | "After") => DocxEditor.Paragraph;
type _check_List_insertParagraph_127 = IsExact<Ref_List_insertParagraph_127, Auth_List_insertParagraph_127>;
type _assert_List_insertParagraph_127 = Expect<_check_List_insertParagraph_127>;

type Ref_List_paragraphs_128 = () => DocxEditor.ParagraphCollection;
type Auth_List_paragraphs_128 = () => DocxEditor.ParagraphCollection;
type _check_List_paragraphs_128 = IsExact<Ref_List_paragraphs_128, Auth_List_paragraphs_128>;
type _assert_List_paragraphs_128 = Expect<_check_List_paragraphs_128>;

type Ref_List_paragraphs_readonly_129 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_List_paragraphs_readonly_129 = { readonly value: DocxEditor.ParagraphCollection };
type _check_List_paragraphs_readonly_129 = IsExact<Ref_List_paragraphs_readonly_129, Auth_List_paragraphs_readonly_129>;
type _assert_List_paragraphs_readonly_129 = Expect<_check_List_paragraphs_readonly_129>;

type Ref_ListCollection_getById_130 = (id: number) => DocxEditor.List;
type Auth_ListCollection_getById_130 = (id: number) => DocxEditor.List;
type _check_ListCollection_getById_130 = IsExact<Ref_ListCollection_getById_130, Auth_ListCollection_getById_130>;
type _assert_ListCollection_getById_130 = Expect<_check_ListCollection_getById_130>;

type Ref_ListCollection_getFirst_131 = () => DocxEditor.List;
type Auth_ListCollection_getFirst_131 = () => DocxEditor.List;
type _check_ListCollection_getFirst_131 = IsExact<Ref_ListCollection_getFirst_131, Auth_ListCollection_getFirst_131>;
type _assert_ListCollection_getFirst_131 = Expect<_check_ListCollection_getFirst_131>;

type Ref_ListCollection_items_132 = () => DocxEditor.List[];
type Auth_ListCollection_items_132 = () => DocxEditor.List[];
type _check_ListCollection_items_132 = IsExact<Ref_ListCollection_items_132, Auth_ListCollection_items_132>;
type _assert_ListCollection_items_132 = Expect<_check_ListCollection_items_132>;

type Ref_ListCollection_items_readonly_133 = { readonly value: DocxEditor.List[] };
type Auth_ListCollection_items_readonly_133 = { readonly value: DocxEditor.List[] };
type _check_ListCollection_items_readonly_133 = IsExact<Ref_ListCollection_items_readonly_133, Auth_ListCollection_items_readonly_133>;
type _assert_ListCollection_items_readonly_133 = Expect<_check_ListCollection_items_readonly_133>;

type Ref_ListItem_level_134 = () => number;
type Auth_ListItem_level_134 = () => number;
type _check_ListItem_level_134 = IsExact<Ref_ListItem_level_134, Auth_ListItem_level_134>;
type _assert_ListItem_level_134 = Expect<_check_ListItem_level_134>;

type Ref_ListItem_level_readonly_135 = { value: number };
type Auth_ListItem_level_readonly_135 = { value: number };
type _check_ListItem_level_readonly_135 = IsExact<Ref_ListItem_level_readonly_135, Auth_ListItem_level_readonly_135>;
type _assert_ListItem_level_readonly_135 = Expect<_check_ListItem_level_readonly_135>;

type Ref_NoteItem_body_136 = () => DocxEditor.Body;
type Auth_NoteItem_body_136 = () => DocxEditor.Body;
type _check_NoteItem_body_136 = IsExact<Ref_NoteItem_body_136, Auth_NoteItem_body_136>;
type _assert_NoteItem_body_136 = Expect<_check_NoteItem_body_136>;

type Ref_NoteItem_body_readonly_137 = { readonly value: DocxEditor.Body };
type Auth_NoteItem_body_readonly_137 = { readonly value: DocxEditor.Body };
type _check_NoteItem_body_readonly_137 = IsExact<Ref_NoteItem_body_readonly_137, Auth_NoteItem_body_readonly_137>;
type _assert_NoteItem_body_readonly_137 = Expect<_check_NoteItem_body_readonly_137>;

type Ref_NoteItem_delete_138 = () => void;
type Auth_NoteItem_delete_138 = () => void;
type _check_NoteItem_delete_138 = IsExact<Ref_NoteItem_delete_138, Auth_NoteItem_delete_138>;
type _assert_NoteItem_delete_138 = Expect<_check_NoteItem_delete_138>;

type Ref_NoteItem_getNext_139 = () => DocxEditor.NoteItem;
type Auth_NoteItem_getNext_139 = () => DocxEditor.NoteItem;
type _check_NoteItem_getNext_139 = IsExact<Ref_NoteItem_getNext_139, Auth_NoteItem_getNext_139>;
type _assert_NoteItem_getNext_139 = Expect<_check_NoteItem_getNext_139>;

type Ref_NoteItem_type_140 = () => "Footnote" | "Endnote";
type Auth_NoteItem_type_140 = () => "Footnote" | "Endnote";
type _check_NoteItem_type_140 = IsExact<Ref_NoteItem_type_140, Auth_NoteItem_type_140>;
type _assert_NoteItem_type_140 = Expect<_check_NoteItem_type_140>;

type Ref_NoteItem_type_readonly_141 = { readonly value: "Footnote" | "Endnote" };
type Auth_NoteItem_type_readonly_141 = { readonly value: "Footnote" | "Endnote" };
type _check_NoteItem_type_readonly_141 = IsExact<Ref_NoteItem_type_readonly_141, Auth_NoteItem_type_readonly_141>;
type _assert_NoteItem_type_readonly_141 = Expect<_check_NoteItem_type_readonly_141>;

type Ref_NoteItemCollection_getFirst_142 = () => DocxEditor.NoteItem;
type Auth_NoteItemCollection_getFirst_142 = () => DocxEditor.NoteItem;
type _check_NoteItemCollection_getFirst_142 = IsExact<Ref_NoteItemCollection_getFirst_142, Auth_NoteItemCollection_getFirst_142>;
type _assert_NoteItemCollection_getFirst_142 = Expect<_check_NoteItemCollection_getFirst_142>;

type Ref_NoteItemCollection_items_143 = () => DocxEditor.NoteItem[];
type Auth_NoteItemCollection_items_143 = () => DocxEditor.NoteItem[];
type _check_NoteItemCollection_items_143 = IsExact<Ref_NoteItemCollection_items_143, Auth_NoteItemCollection_items_143>;
type _assert_NoteItemCollection_items_143 = Expect<_check_NoteItemCollection_items_143>;

type Ref_NoteItemCollection_items_readonly_144 = { readonly value: DocxEditor.NoteItem[] };
type Auth_NoteItemCollection_items_readonly_144 = { readonly value: DocxEditor.NoteItem[] };
type _check_NoteItemCollection_items_readonly_144 = IsExact<Ref_NoteItemCollection_items_readonly_144, Auth_NoteItemCollection_items_readonly_144>;
type _assert_NoteItemCollection_items_readonly_144 = Expect<_check_NoteItemCollection_items_readonly_144>;

type Ref_PageSetup_bottomMargin_145 = () => number;
type Auth_PageSetup_bottomMargin_145 = () => number;
type _check_PageSetup_bottomMargin_145 = IsExact<Ref_PageSetup_bottomMargin_145, Auth_PageSetup_bottomMargin_145>;
type _assert_PageSetup_bottomMargin_145 = Expect<_check_PageSetup_bottomMargin_145>;

type Ref_PageSetup_bottomMargin_readonly_146 = { value: number };
type Auth_PageSetup_bottomMargin_readonly_146 = { value: number };
type _check_PageSetup_bottomMargin_readonly_146 = IsExact<Ref_PageSetup_bottomMargin_readonly_146, Auth_PageSetup_bottomMargin_readonly_146>;
type _assert_PageSetup_bottomMargin_readonly_146 = Expect<_check_PageSetup_bottomMargin_readonly_146>;

type Ref_PageSetup_leftMargin_147 = () => number;
type Auth_PageSetup_leftMargin_147 = () => number;
type _check_PageSetup_leftMargin_147 = IsExact<Ref_PageSetup_leftMargin_147, Auth_PageSetup_leftMargin_147>;
type _assert_PageSetup_leftMargin_147 = Expect<_check_PageSetup_leftMargin_147>;

type Ref_PageSetup_leftMargin_readonly_148 = { value: number };
type Auth_PageSetup_leftMargin_readonly_148 = { value: number };
type _check_PageSetup_leftMargin_readonly_148 = IsExact<Ref_PageSetup_leftMargin_readonly_148, Auth_PageSetup_leftMargin_readonly_148>;
type _assert_PageSetup_leftMargin_readonly_148 = Expect<_check_PageSetup_leftMargin_readonly_148>;

type Ref_PageSetup_orientation_149 = () => "Portrait" | "Landscape";
type Auth_PageSetup_orientation_149 = () => "Portrait" | "Landscape";
type _check_PageSetup_orientation_149 = IsExact<Ref_PageSetup_orientation_149, Auth_PageSetup_orientation_149>;
type _assert_PageSetup_orientation_149 = Expect<_check_PageSetup_orientation_149>;

type Ref_PageSetup_orientation_readonly_150 = { value: "Portrait" | "Landscape" };
type Auth_PageSetup_orientation_readonly_150 = { value: "Portrait" | "Landscape" };
type _check_PageSetup_orientation_readonly_150 = IsExact<Ref_PageSetup_orientation_readonly_150, Auth_PageSetup_orientation_readonly_150>;
type _assert_PageSetup_orientation_readonly_150 = Expect<_check_PageSetup_orientation_readonly_150>;

type Ref_PageSetup_pageHeight_151 = () => number;
type Auth_PageSetup_pageHeight_151 = () => number;
type _check_PageSetup_pageHeight_151 = IsExact<Ref_PageSetup_pageHeight_151, Auth_PageSetup_pageHeight_151>;
type _assert_PageSetup_pageHeight_151 = Expect<_check_PageSetup_pageHeight_151>;

type Ref_PageSetup_pageHeight_readonly_152 = { value: number };
type Auth_PageSetup_pageHeight_readonly_152 = { value: number };
type _check_PageSetup_pageHeight_readonly_152 = IsExact<Ref_PageSetup_pageHeight_readonly_152, Auth_PageSetup_pageHeight_readonly_152>;
type _assert_PageSetup_pageHeight_readonly_152 = Expect<_check_PageSetup_pageHeight_readonly_152>;

type Ref_PageSetup_pageWidth_153 = () => number;
type Auth_PageSetup_pageWidth_153 = () => number;
type _check_PageSetup_pageWidth_153 = IsExact<Ref_PageSetup_pageWidth_153, Auth_PageSetup_pageWidth_153>;
type _assert_PageSetup_pageWidth_153 = Expect<_check_PageSetup_pageWidth_153>;

type Ref_PageSetup_pageWidth_readonly_154 = { value: number };
type Auth_PageSetup_pageWidth_readonly_154 = { value: number };
type _check_PageSetup_pageWidth_readonly_154 = IsExact<Ref_PageSetup_pageWidth_readonly_154, Auth_PageSetup_pageWidth_readonly_154>;
type _assert_PageSetup_pageWidth_readonly_154 = Expect<_check_PageSetup_pageWidth_readonly_154>;

type Ref_PageSetup_rightMargin_155 = () => number;
type Auth_PageSetup_rightMargin_155 = () => number;
type _check_PageSetup_rightMargin_155 = IsExact<Ref_PageSetup_rightMargin_155, Auth_PageSetup_rightMargin_155>;
type _assert_PageSetup_rightMargin_155 = Expect<_check_PageSetup_rightMargin_155>;

type Ref_PageSetup_rightMargin_readonly_156 = { value: number };
type Auth_PageSetup_rightMargin_readonly_156 = { value: number };
type _check_PageSetup_rightMargin_readonly_156 = IsExact<Ref_PageSetup_rightMargin_readonly_156, Auth_PageSetup_rightMargin_readonly_156>;
type _assert_PageSetup_rightMargin_readonly_156 = Expect<_check_PageSetup_rightMargin_readonly_156>;

type Ref_PageSetup_topMargin_157 = () => number;
type Auth_PageSetup_topMargin_157 = () => number;
type _check_PageSetup_topMargin_157 = IsExact<Ref_PageSetup_topMargin_157, Auth_PageSetup_topMargin_157>;
type _assert_PageSetup_topMargin_157 = Expect<_check_PageSetup_topMargin_157>;

type Ref_PageSetup_topMargin_readonly_158 = { value: number };
type Auth_PageSetup_topMargin_readonly_158 = { value: number };
type _check_PageSetup_topMargin_readonly_158 = IsExact<Ref_PageSetup_topMargin_readonly_158, Auth_PageSetup_topMargin_readonly_158>;
type _assert_PageSetup_topMargin_readonly_158 = Expect<_check_PageSetup_topMargin_readonly_158>;

type Ref_Paragraph_alignment_159 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type Auth_Paragraph_alignment_159 = () => "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified";
type _check_Paragraph_alignment_159 = IsExact<Ref_Paragraph_alignment_159, Auth_Paragraph_alignment_159>;
type _assert_Paragraph_alignment_159 = Expect<_check_Paragraph_alignment_159>;

type Ref_Paragraph_alignment_readonly_160 = { value: "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified" };
type Auth_Paragraph_alignment_readonly_160 = { value: "Mixed" | "Unknown" | "Left" | "Centered" | "Right" | "Justified" };
type _check_Paragraph_alignment_readonly_160 = IsExact<Ref_Paragraph_alignment_readonly_160, Auth_Paragraph_alignment_readonly_160>;
type _assert_Paragraph_alignment_readonly_160 = Expect<_check_Paragraph_alignment_readonly_160>;

type Ref_Paragraph_clear_161 = () => void;
type Auth_Paragraph_clear_161 = () => void;
type _check_Paragraph_clear_161 = IsExact<Ref_Paragraph_clear_161, Auth_Paragraph_clear_161>;
type _assert_Paragraph_clear_161 = Expect<_check_Paragraph_clear_161>;

type Ref_Paragraph_contentControls_162 = () => DocxEditor.ContentControlCollection;
type Auth_Paragraph_contentControls_162 = () => DocxEditor.ContentControlCollection;
type _check_Paragraph_contentControls_162 = IsExact<Ref_Paragraph_contentControls_162, Auth_Paragraph_contentControls_162>;
type _assert_Paragraph_contentControls_162 = Expect<_check_Paragraph_contentControls_162>;

type Ref_Paragraph_contentControls_readonly_163 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Paragraph_contentControls_readonly_163 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Paragraph_contentControls_readonly_163 = IsExact<Ref_Paragraph_contentControls_readonly_163, Auth_Paragraph_contentControls_readonly_163>;
type _assert_Paragraph_contentControls_readonly_163 = Expect<_check_Paragraph_contentControls_readonly_163>;

type Ref_Paragraph_delete_164 = () => void;
type Auth_Paragraph_delete_164 = () => void;
type _check_Paragraph_delete_164 = IsExact<Ref_Paragraph_delete_164, Auth_Paragraph_delete_164>;
type _assert_Paragraph_delete_164 = Expect<_check_Paragraph_delete_164>;

type Ref_Paragraph_firstLineIndent_165 = () => number;
type Auth_Paragraph_firstLineIndent_165 = () => number;
type _check_Paragraph_firstLineIndent_165 = IsExact<Ref_Paragraph_firstLineIndent_165, Auth_Paragraph_firstLineIndent_165>;
type _assert_Paragraph_firstLineIndent_165 = Expect<_check_Paragraph_firstLineIndent_165>;

type Ref_Paragraph_firstLineIndent_readonly_166 = { value: number };
type Auth_Paragraph_firstLineIndent_readonly_166 = { value: number };
type _check_Paragraph_firstLineIndent_readonly_166 = IsExact<Ref_Paragraph_firstLineIndent_readonly_166, Auth_Paragraph_firstLineIndent_readonly_166>;
type _assert_Paragraph_firstLineIndent_readonly_166 = Expect<_check_Paragraph_firstLineIndent_readonly_166>;

type Ref_Paragraph_font_167 = () => DocxEditor.Font;
type Auth_Paragraph_font_167 = () => DocxEditor.Font;
type _check_Paragraph_font_167 = IsExact<Ref_Paragraph_font_167, Auth_Paragraph_font_167>;
type _assert_Paragraph_font_167 = Expect<_check_Paragraph_font_167>;

type Ref_Paragraph_font_readonly_168 = { readonly value: DocxEditor.Font };
type Auth_Paragraph_font_readonly_168 = { readonly value: DocxEditor.Font };
type _check_Paragraph_font_readonly_168 = IsExact<Ref_Paragraph_font_readonly_168, Auth_Paragraph_font_readonly_168>;
type _assert_Paragraph_font_readonly_168 = Expect<_check_Paragraph_font_readonly_168>;

type Ref_Paragraph_insertParagraph_169 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Paragraph_insertParagraph_169 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Paragraph_insertParagraph_169 = IsExact<Ref_Paragraph_insertParagraph_169, Auth_Paragraph_insertParagraph_169>;
type _assert_Paragraph_insertParagraph_169 = Expect<_check_Paragraph_insertParagraph_169>;

type Ref_Paragraph_insertText_170 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type Auth_Paragraph_insertText_170 = (text: string, insertLocation: "Replace" | "Start" | "End") => DocxEditor.Range;
type _check_Paragraph_insertText_170 = IsExact<Ref_Paragraph_insertText_170, Auth_Paragraph_insertText_170>;
type _assert_Paragraph_insertText_170 = Expect<_check_Paragraph_insertText_170>;

type Ref_Paragraph_leftIndent_171 = () => number;
type Auth_Paragraph_leftIndent_171 = () => number;
type _check_Paragraph_leftIndent_171 = IsExact<Ref_Paragraph_leftIndent_171, Auth_Paragraph_leftIndent_171>;
type _assert_Paragraph_leftIndent_171 = Expect<_check_Paragraph_leftIndent_171>;

type Ref_Paragraph_leftIndent_readonly_172 = { value: number };
type Auth_Paragraph_leftIndent_readonly_172 = { value: number };
type _check_Paragraph_leftIndent_readonly_172 = IsExact<Ref_Paragraph_leftIndent_readonly_172, Auth_Paragraph_leftIndent_readonly_172>;
type _assert_Paragraph_leftIndent_readonly_172 = Expect<_check_Paragraph_leftIndent_readonly_172>;

type Ref_Paragraph_lineSpacing_173 = () => number;
type Auth_Paragraph_lineSpacing_173 = () => number;
type _check_Paragraph_lineSpacing_173 = IsExact<Ref_Paragraph_lineSpacing_173, Auth_Paragraph_lineSpacing_173>;
type _assert_Paragraph_lineSpacing_173 = Expect<_check_Paragraph_lineSpacing_173>;

type Ref_Paragraph_lineSpacing_readonly_174 = { value: number };
type Auth_Paragraph_lineSpacing_readonly_174 = { value: number };
type _check_Paragraph_lineSpacing_readonly_174 = IsExact<Ref_Paragraph_lineSpacing_readonly_174, Auth_Paragraph_lineSpacing_readonly_174>;
type _assert_Paragraph_lineSpacing_readonly_174 = Expect<_check_Paragraph_lineSpacing_readonly_174>;

type Ref_Paragraph_list_175 = () => DocxEditor.List;
type Auth_Paragraph_list_175 = () => DocxEditor.List;
type _check_Paragraph_list_175 = IsExact<Ref_Paragraph_list_175, Auth_Paragraph_list_175>;
type _assert_Paragraph_list_175 = Expect<_check_Paragraph_list_175>;

type Ref_Paragraph_list_readonly_176 = { readonly value: DocxEditor.List };
type Auth_Paragraph_list_readonly_176 = { readonly value: DocxEditor.List };
type _check_Paragraph_list_readonly_176 = IsExact<Ref_Paragraph_list_readonly_176, Auth_Paragraph_list_readonly_176>;
type _assert_Paragraph_list_readonly_176 = Expect<_check_Paragraph_list_readonly_176>;

type Ref_Paragraph_listItem_177 = () => DocxEditor.ListItem;
type Auth_Paragraph_listItem_177 = () => DocxEditor.ListItem;
type _check_Paragraph_listItem_177 = IsExact<Ref_Paragraph_listItem_177, Auth_Paragraph_listItem_177>;
type _assert_Paragraph_listItem_177 = Expect<_check_Paragraph_listItem_177>;

type Ref_Paragraph_listItem_readonly_178 = { readonly value: DocxEditor.ListItem };
type Auth_Paragraph_listItem_readonly_178 = { readonly value: DocxEditor.ListItem };
type _check_Paragraph_listItem_readonly_178 = IsExact<Ref_Paragraph_listItem_readonly_178, Auth_Paragraph_listItem_readonly_178>;
type _assert_Paragraph_listItem_readonly_178 = Expect<_check_Paragraph_listItem_readonly_178>;

type Ref_Paragraph_rightIndent_179 = () => number;
type Auth_Paragraph_rightIndent_179 = () => number;
type _check_Paragraph_rightIndent_179 = IsExact<Ref_Paragraph_rightIndent_179, Auth_Paragraph_rightIndent_179>;
type _assert_Paragraph_rightIndent_179 = Expect<_check_Paragraph_rightIndent_179>;

type Ref_Paragraph_rightIndent_readonly_180 = { value: number };
type Auth_Paragraph_rightIndent_readonly_180 = { value: number };
type _check_Paragraph_rightIndent_readonly_180 = IsExact<Ref_Paragraph_rightIndent_readonly_180, Auth_Paragraph_rightIndent_readonly_180>;
type _assert_Paragraph_rightIndent_readonly_180 = Expect<_check_Paragraph_rightIndent_readonly_180>;

type Ref_Paragraph_spaceAfter_181 = () => number;
type Auth_Paragraph_spaceAfter_181 = () => number;
type _check_Paragraph_spaceAfter_181 = IsExact<Ref_Paragraph_spaceAfter_181, Auth_Paragraph_spaceAfter_181>;
type _assert_Paragraph_spaceAfter_181 = Expect<_check_Paragraph_spaceAfter_181>;

type Ref_Paragraph_spaceAfter_readonly_182 = { value: number };
type Auth_Paragraph_spaceAfter_readonly_182 = { value: number };
type _check_Paragraph_spaceAfter_readonly_182 = IsExact<Ref_Paragraph_spaceAfter_readonly_182, Auth_Paragraph_spaceAfter_readonly_182>;
type _assert_Paragraph_spaceAfter_readonly_182 = Expect<_check_Paragraph_spaceAfter_readonly_182>;

type Ref_Paragraph_spaceBefore_183 = () => number;
type Auth_Paragraph_spaceBefore_183 = () => number;
type _check_Paragraph_spaceBefore_183 = IsExact<Ref_Paragraph_spaceBefore_183, Auth_Paragraph_spaceBefore_183>;
type _assert_Paragraph_spaceBefore_183 = Expect<_check_Paragraph_spaceBefore_183>;

type Ref_Paragraph_spaceBefore_readonly_184 = { value: number };
type Auth_Paragraph_spaceBefore_readonly_184 = { value: number };
type _check_Paragraph_spaceBefore_readonly_184 = IsExact<Ref_Paragraph_spaceBefore_readonly_184, Auth_Paragraph_spaceBefore_readonly_184>;
type _assert_Paragraph_spaceBefore_readonly_184 = Expect<_check_Paragraph_spaceBefore_readonly_184>;

type Ref_Paragraph_split_185 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type Auth_Paragraph_split_185 = (delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean) => DocxEditor.RangeCollection;
type _check_Paragraph_split_185 = IsExact<Ref_Paragraph_split_185, Auth_Paragraph_split_185>;
type _assert_Paragraph_split_185 = Expect<_check_Paragraph_split_185>;

type Ref_Paragraph_style_186 = () => string;
type Auth_Paragraph_style_186 = () => string;
type _check_Paragraph_style_186 = IsExact<Ref_Paragraph_style_186, Auth_Paragraph_style_186>;
type _assert_Paragraph_style_186 = Expect<_check_Paragraph_style_186>;

type Ref_Paragraph_style_readonly_187 = { value: string };
type Auth_Paragraph_style_readonly_187 = { value: string };
type _check_Paragraph_style_readonly_187 = IsExact<Ref_Paragraph_style_readonly_187, Auth_Paragraph_style_readonly_187>;
type _assert_Paragraph_style_readonly_187 = Expect<_check_Paragraph_style_readonly_187>;

type Ref_Paragraph_text_188 = () => string;
type Auth_Paragraph_text_188 = () => string;
type _check_Paragraph_text_188 = IsExact<Ref_Paragraph_text_188, Auth_Paragraph_text_188>;
type _assert_Paragraph_text_188 = Expect<_check_Paragraph_text_188>;

type Ref_Paragraph_text_readonly_189 = { readonly value: string };
type Auth_Paragraph_text_readonly_189 = { readonly value: string };
type _check_Paragraph_text_readonly_189 = IsExact<Ref_Paragraph_text_readonly_189, Auth_Paragraph_text_readonly_189>;
type _assert_Paragraph_text_readonly_189 = Expect<_check_Paragraph_text_readonly_189>;

type Ref_ParagraphCollection_getFirst_190 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getFirst_190 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getFirst_190 = IsExact<Ref_ParagraphCollection_getFirst_190, Auth_ParagraphCollection_getFirst_190>;
type _assert_ParagraphCollection_getFirst_190 = Expect<_check_ParagraphCollection_getFirst_190>;

type Ref_ParagraphCollection_getLast_191 = () => DocxEditor.Paragraph;
type Auth_ParagraphCollection_getLast_191 = () => DocxEditor.Paragraph;
type _check_ParagraphCollection_getLast_191 = IsExact<Ref_ParagraphCollection_getLast_191, Auth_ParagraphCollection_getLast_191>;
type _assert_ParagraphCollection_getLast_191 = Expect<_check_ParagraphCollection_getLast_191>;

type Ref_ParagraphCollection_items_192 = () => DocxEditor.Paragraph[];
type Auth_ParagraphCollection_items_192 = () => DocxEditor.Paragraph[];
type _check_ParagraphCollection_items_192 = IsExact<Ref_ParagraphCollection_items_192, Auth_ParagraphCollection_items_192>;
type _assert_ParagraphCollection_items_192 = Expect<_check_ParagraphCollection_items_192>;

type Ref_ParagraphCollection_items_readonly_193 = { readonly value: DocxEditor.Paragraph[] };
type Auth_ParagraphCollection_items_readonly_193 = { readonly value: DocxEditor.Paragraph[] };
type _check_ParagraphCollection_items_readonly_193 = IsExact<Ref_ParagraphCollection_items_readonly_193, Auth_ParagraphCollection_items_readonly_193>;
type _assert_ParagraphCollection_items_readonly_193 = Expect<_check_ParagraphCollection_items_readonly_193>;

type Ref_Range_bookmarks_194 = () => DocxEditor.BookmarkCollection;
type Auth_Range_bookmarks_194 = () => DocxEditor.BookmarkCollection;
type _check_Range_bookmarks_194 = IsExact<Ref_Range_bookmarks_194, Auth_Range_bookmarks_194>;
type _assert_Range_bookmarks_194 = Expect<_check_Range_bookmarks_194>;

type Ref_Range_bookmarks_readonly_195 = { readonly value: DocxEditor.BookmarkCollection };
type Auth_Range_bookmarks_readonly_195 = { readonly value: DocxEditor.BookmarkCollection };
type _check_Range_bookmarks_readonly_195 = IsExact<Ref_Range_bookmarks_readonly_195, Auth_Range_bookmarks_readonly_195>;
type _assert_Range_bookmarks_readonly_195 = Expect<_check_Range_bookmarks_readonly_195>;

type Ref_Range_clear_196 = () => void;
type Auth_Range_clear_196 = () => void;
type _check_Range_clear_196 = IsExact<Ref_Range_clear_196, Auth_Range_clear_196>;
type _assert_Range_clear_196 = Expect<_check_Range_clear_196>;

type Ref_Range_contentControls_197 = () => DocxEditor.ContentControlCollection;
type Auth_Range_contentControls_197 = () => DocxEditor.ContentControlCollection;
type _check_Range_contentControls_197 = IsExact<Ref_Range_contentControls_197, Auth_Range_contentControls_197>;
type _assert_Range_contentControls_197 = Expect<_check_Range_contentControls_197>;

type Ref_Range_contentControls_readonly_198 = { readonly value: DocxEditor.ContentControlCollection };
type Auth_Range_contentControls_readonly_198 = { readonly value: DocxEditor.ContentControlCollection };
type _check_Range_contentControls_readonly_198 = IsExact<Ref_Range_contentControls_readonly_198, Auth_Range_contentControls_readonly_198>;
type _assert_Range_contentControls_readonly_198 = Expect<_check_Range_contentControls_readonly_198>;

type Ref_Range_delete_199 = () => void;
type Auth_Range_delete_199 = () => void;
type _check_Range_delete_199 = IsExact<Ref_Range_delete_199, Auth_Range_delete_199>;
type _assert_Range_delete_199 = Expect<_check_Range_delete_199>;

type Ref_Range_font_200 = () => DocxEditor.Font;
type Auth_Range_font_200 = () => DocxEditor.Font;
type _check_Range_font_200 = IsExact<Ref_Range_font_200, Auth_Range_font_200>;
type _assert_Range_font_200 = Expect<_check_Range_font_200>;

type Ref_Range_font_readonly_201 = { readonly value: DocxEditor.Font };
type Auth_Range_font_readonly_201 = { readonly value: DocxEditor.Font };
type _check_Range_font_readonly_201 = IsExact<Ref_Range_font_readonly_201, Auth_Range_font_readonly_201>;
type _assert_Range_font_readonly_201 = Expect<_check_Range_font_readonly_201>;

type Ref_Range_getBookmarks_202 = (includeHidden?: boolean, includeAdjacent?: boolean) => DocxEditor.ClientResult<string[]>;
type Auth_Range_getBookmarks_202 = (includeHidden?: boolean, includeAdjacent?: boolean) => DocxEditor.ClientResult<string[]>;
type _check_Range_getBookmarks_202 = IsExact<Ref_Range_getBookmarks_202, Auth_Range_getBookmarks_202>;
type _assert_Range_getBookmarks_202 = Expect<_check_Range_getBookmarks_202>;

type Ref_Range_hyperlink_203 = () => string;
type Auth_Range_hyperlink_203 = () => string;
type _check_Range_hyperlink_203 = IsExact<Ref_Range_hyperlink_203, Auth_Range_hyperlink_203>;
type _assert_Range_hyperlink_203 = Expect<_check_Range_hyperlink_203>;

type Ref_Range_hyperlink_readonly_204 = { value: string };
type Auth_Range_hyperlink_readonly_204 = { value: string };
type _check_Range_hyperlink_readonly_204 = IsExact<Ref_Range_hyperlink_readonly_204, Auth_Range_hyperlink_readonly_204>;
type _assert_Range_hyperlink_readonly_204 = Expect<_check_Range_hyperlink_readonly_204>;

type Ref_Range_insertBookmark_205 = (name: string) => void;
type Auth_Range_insertBookmark_205 = (name: string) => void;
type _check_Range_insertBookmark_205 = IsExact<Ref_Range_insertBookmark_205, Auth_Range_insertBookmark_205>;
type _assert_Range_insertBookmark_205 = Expect<_check_Range_insertBookmark_205>;

type Ref_Range_insertComment_206 = (commentText: string) => DocxEditor.Comment;
type Auth_Range_insertComment_206 = (commentText: string) => DocxEditor.Comment;
type _check_Range_insertComment_206 = IsExact<Ref_Range_insertComment_206, Auth_Range_insertComment_206>;
type _assert_Range_insertComment_206 = Expect<_check_Range_insertComment_206>;

type Ref_Range_insertParagraph_207 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type Auth_Range_insertParagraph_207 = (paragraphText: string, insertLocation: "Before" | "After") => DocxEditor.Paragraph;
type _check_Range_insertParagraph_207 = IsExact<Ref_Range_insertParagraph_207, Auth_Range_insertParagraph_207>;
type _assert_Range_insertParagraph_207 = Expect<_check_Range_insertParagraph_207>;

type Ref_Range_insertText_208 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type Auth_Range_insertText_208 = (text: string, insertLocation: "Replace" | "Start" | "End" | "Before" | "After") => DocxEditor.Range;
type _check_Range_insertText_208 = IsExact<Ref_Range_insertText_208, Auth_Range_insertText_208>;
type _assert_Range_insertText_208 = Expect<_check_Range_insertText_208>;

type Ref_Range_paragraphs_209 = () => DocxEditor.ParagraphCollection;
type Auth_Range_paragraphs_209 = () => DocxEditor.ParagraphCollection;
type _check_Range_paragraphs_209 = IsExact<Ref_Range_paragraphs_209, Auth_Range_paragraphs_209>;
type _assert_Range_paragraphs_209 = Expect<_check_Range_paragraphs_209>;

type Ref_Range_paragraphs_readonly_210 = { readonly value: DocxEditor.ParagraphCollection };
type Auth_Range_paragraphs_readonly_210 = { readonly value: DocxEditor.ParagraphCollection };
type _check_Range_paragraphs_readonly_210 = IsExact<Ref_Range_paragraphs_readonly_210, Auth_Range_paragraphs_readonly_210>;
type _assert_Range_paragraphs_readonly_210 = Expect<_check_Range_paragraphs_readonly_210>;

type Ref_Range_search_211 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type Auth_Range_search_211 = (searchText: string, searchOptions?: DocxEditor.SearchOptions) => DocxEditor.RangeCollection;
type _check_Range_search_211 = IsExact<Ref_Range_search_211, Auth_Range_search_211>;
type _assert_Range_search_211 = Expect<_check_Range_search_211>;

type Ref_Range_select_212 = (selectionMode?: DocxEditor.SelectionMode) => void;
type Auth_Range_select_212 = (selectionMode?: DocxEditor.SelectionMode) => void;
type _check_Range_select_212 = IsExact<Ref_Range_select_212, Auth_Range_select_212>;
type _assert_Range_select_212 = Expect<_check_Range_select_212>;

type Ref_Range_select_213 = (selectionMode?: "Select" | "Start" | "End") => void;
type Auth_Range_select_213 = (selectionMode?: "Select" | "Start" | "End") => void;
type _check_Range_select_213 = IsExact<Ref_Range_select_213, Auth_Range_select_213>;
type _assert_Range_select_213 = Expect<_check_Range_select_213>;

type Ref_Range_style_214 = () => string;
type Auth_Range_style_214 = () => string;
type _check_Range_style_214 = IsExact<Ref_Range_style_214, Auth_Range_style_214>;
type _assert_Range_style_214 = Expect<_check_Range_style_214>;

type Ref_Range_style_readonly_215 = { value: string };
type Auth_Range_style_readonly_215 = { value: string };
type _check_Range_style_readonly_215 = IsExact<Ref_Range_style_readonly_215, Auth_Range_style_readonly_215>;
type _assert_Range_style_readonly_215 = Expect<_check_Range_style_readonly_215>;

type Ref_Range_text_216 = () => string;
type Auth_Range_text_216 = () => string;
type _check_Range_text_216 = IsExact<Ref_Range_text_216, Auth_Range_text_216>;
type _assert_Range_text_216 = Expect<_check_Range_text_216>;

type Ref_Range_text_readonly_217 = { readonly value: string };
type Auth_Range_text_readonly_217 = { readonly value: string };
type _check_Range_text_readonly_217 = IsExact<Ref_Range_text_readonly_217, Auth_Range_text_readonly_217>;
type _assert_Range_text_readonly_217 = Expect<_check_Range_text_readonly_217>;

type Ref_RangeCollection_getFirst_218 = () => DocxEditor.Range;
type Auth_RangeCollection_getFirst_218 = () => DocxEditor.Range;
type _check_RangeCollection_getFirst_218 = IsExact<Ref_RangeCollection_getFirst_218, Auth_RangeCollection_getFirst_218>;
type _assert_RangeCollection_getFirst_218 = Expect<_check_RangeCollection_getFirst_218>;

type Ref_RangeCollection_items_219 = () => DocxEditor.Range[];
type Auth_RangeCollection_items_219 = () => DocxEditor.Range[];
type _check_RangeCollection_items_219 = IsExact<Ref_RangeCollection_items_219, Auth_RangeCollection_items_219>;
type _assert_RangeCollection_items_219 = Expect<_check_RangeCollection_items_219>;

type Ref_RangeCollection_items_readonly_220 = { readonly value: DocxEditor.Range[] };
type Auth_RangeCollection_items_readonly_220 = { readonly value: DocxEditor.Range[] };
type _check_RangeCollection_items_readonly_220 = IsExact<Ref_RangeCollection_items_readonly_220, Auth_RangeCollection_items_readonly_220>;
type _assert_RangeCollection_items_readonly_220 = Expect<_check_RangeCollection_items_readonly_220>;

type Ref_RequestContext_document_221 = () => DocxEditor.Document;
type Auth_RequestContext_document_221 = () => DocxEditor.Document;
type _check_RequestContext_document_221 = IsExact<Ref_RequestContext_document_221, Auth_RequestContext_document_221>;
type _assert_RequestContext_document_221 = Expect<_check_RequestContext_document_221>;

type Ref_RequestContext_document_readonly_222 = { readonly value: DocxEditor.Document };
type Auth_RequestContext_document_readonly_222 = { readonly value: DocxEditor.Document };
type _check_RequestContext_document_readonly_222 = IsExact<Ref_RequestContext_document_readonly_222, Auth_RequestContext_document_readonly_222>;
type _assert_RequestContext_document_readonly_222 = Expect<_check_RequestContext_document_readonly_222>;

type Ref_Revision_accept_223 = () => void;
type Auth_Revision_accept_223 = () => void;
type _check_Revision_accept_223 = IsExact<Ref_Revision_accept_223, Auth_Revision_accept_223>;
type _assert_Revision_accept_223 = Expect<_check_Revision_accept_223>;

type Ref_Revision_author_224 = () => string;
type Auth_Revision_author_224 = () => string;
type _check_Revision_author_224 = IsExact<Ref_Revision_author_224, Auth_Revision_author_224>;
type _assert_Revision_author_224 = Expect<_check_Revision_author_224>;

type Ref_Revision_author_readonly_225 = { readonly value: string };
type Auth_Revision_author_readonly_225 = { readonly value: string };
type _check_Revision_author_readonly_225 = IsExact<Ref_Revision_author_readonly_225, Auth_Revision_author_readonly_225>;
type _assert_Revision_author_readonly_225 = Expect<_check_Revision_author_readonly_225>;

type Ref_Revision_date_226 = () => Date;
type Auth_Revision_date_226 = () => Date;
type _check_Revision_date_226 = IsExact<Ref_Revision_date_226, Auth_Revision_date_226>;
type _assert_Revision_date_226 = Expect<_check_Revision_date_226>;

type Ref_Revision_date_readonly_227 = { readonly value: Date };
type Auth_Revision_date_readonly_227 = { readonly value: Date };
type _check_Revision_date_readonly_227 = IsExact<Ref_Revision_date_readonly_227, Auth_Revision_date_readonly_227>;
type _assert_Revision_date_readonly_227 = Expect<_check_Revision_date_readonly_227>;

type Ref_Revision_range_228 = () => DocxEditor.Range;
type Auth_Revision_range_228 = () => DocxEditor.Range;
type _check_Revision_range_228 = IsExact<Ref_Revision_range_228, Auth_Revision_range_228>;
type _assert_Revision_range_228 = Expect<_check_Revision_range_228>;

type Ref_Revision_range_readonly_229 = { readonly value: DocxEditor.Range };
type Auth_Revision_range_readonly_229 = { readonly value: DocxEditor.Range };
type _check_Revision_range_readonly_229 = IsExact<Ref_Revision_range_readonly_229, Auth_Revision_range_readonly_229>;
type _assert_Revision_range_readonly_229 = Expect<_check_Revision_range_readonly_229>;

type Ref_Revision_reject_230 = () => void;
type Auth_Revision_reject_230 = () => void;
type _check_Revision_reject_230 = IsExact<Ref_Revision_reject_230, Auth_Revision_reject_230>;
type _assert_Revision_reject_230 = Expect<_check_Revision_reject_230>;

type Ref_Revision_type_231 = () => "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete";
type Auth_Revision_type_231 = () => "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete";
type _check_Revision_type_231 = IsExact<Ref_Revision_type_231, Auth_Revision_type_231>;
type _assert_Revision_type_231 = Expect<_check_Revision_type_231>;

type Ref_Revision_type_readonly_232 = { readonly value: "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete" };
type Auth_Revision_type_readonly_232 = { readonly value: "None" | "Insert" | "Delete" | "Property" | "ParagraphNumber" | "DisplayField" | "Reconcile" | "Conflict" | "Style" | "Replace" | "ParagraphProperty" | "TableProperty" | "SectionProperty" | "StyleDefinition" | "MovedFrom" | "MovedTo" | "CellInsertion" | "CellDeletion" | "CellMerge" | "CellSplit" | "ConflictInsert" | "ConflictDelete" };
type _check_Revision_type_readonly_232 = IsExact<Ref_Revision_type_readonly_232, Auth_Revision_type_readonly_232>;
type _assert_Revision_type_readonly_232 = Expect<_check_Revision_type_readonly_232>;

type Ref_RevisionCollection_acceptAll_233 = () => void;
type Auth_RevisionCollection_acceptAll_233 = () => void;
type _check_RevisionCollection_acceptAll_233 = IsExact<Ref_RevisionCollection_acceptAll_233, Auth_RevisionCollection_acceptAll_233>;
type _assert_RevisionCollection_acceptAll_233 = Expect<_check_RevisionCollection_acceptAll_233>;

type Ref_RevisionCollection_items_234 = () => DocxEditor.Revision[];
type Auth_RevisionCollection_items_234 = () => DocxEditor.Revision[];
type _check_RevisionCollection_items_234 = IsExact<Ref_RevisionCollection_items_234, Auth_RevisionCollection_items_234>;
type _assert_RevisionCollection_items_234 = Expect<_check_RevisionCollection_items_234>;

type Ref_RevisionCollection_items_readonly_235 = { readonly value: DocxEditor.Revision[] };
type Auth_RevisionCollection_items_readonly_235 = { readonly value: DocxEditor.Revision[] };
type _check_RevisionCollection_items_readonly_235 = IsExact<Ref_RevisionCollection_items_readonly_235, Auth_RevisionCollection_items_readonly_235>;
type _assert_RevisionCollection_items_readonly_235 = Expect<_check_RevisionCollection_items_readonly_235>;

type Ref_RevisionCollection_rejectAll_236 = () => void;
type Auth_RevisionCollection_rejectAll_236 = () => void;
type _check_RevisionCollection_rejectAll_236 = IsExact<Ref_RevisionCollection_rejectAll_236, Auth_RevisionCollection_rejectAll_236>;
type _assert_RevisionCollection_rejectAll_236 = Expect<_check_RevisionCollection_rejectAll_236>;

type Ref_SearchOptions_ignorePunct_237 = () => boolean;
type Auth_SearchOptions_ignorePunct_237 = () => boolean;
type _check_SearchOptions_ignorePunct_237 = IsExact<Ref_SearchOptions_ignorePunct_237, Auth_SearchOptions_ignorePunct_237>;
type _assert_SearchOptions_ignorePunct_237 = Expect<_check_SearchOptions_ignorePunct_237>;

type Ref_SearchOptions_ignorePunct_readonly_238 = { value: boolean };
type Auth_SearchOptions_ignorePunct_readonly_238 = { value: boolean };
type _check_SearchOptions_ignorePunct_readonly_238 = IsExact<Ref_SearchOptions_ignorePunct_readonly_238, Auth_SearchOptions_ignorePunct_readonly_238>;
type _assert_SearchOptions_ignorePunct_readonly_238 = Expect<_check_SearchOptions_ignorePunct_readonly_238>;

type Ref_SearchOptions_ignoreSpace_239 = () => boolean;
type Auth_SearchOptions_ignoreSpace_239 = () => boolean;
type _check_SearchOptions_ignoreSpace_239 = IsExact<Ref_SearchOptions_ignoreSpace_239, Auth_SearchOptions_ignoreSpace_239>;
type _assert_SearchOptions_ignoreSpace_239 = Expect<_check_SearchOptions_ignoreSpace_239>;

type Ref_SearchOptions_ignoreSpace_readonly_240 = { value: boolean };
type Auth_SearchOptions_ignoreSpace_readonly_240 = { value: boolean };
type _check_SearchOptions_ignoreSpace_readonly_240 = IsExact<Ref_SearchOptions_ignoreSpace_readonly_240, Auth_SearchOptions_ignoreSpace_readonly_240>;
type _assert_SearchOptions_ignoreSpace_readonly_240 = Expect<_check_SearchOptions_ignoreSpace_readonly_240>;

type Ref_SearchOptions_matchCase_241 = () => boolean;
type Auth_SearchOptions_matchCase_241 = () => boolean;
type _check_SearchOptions_matchCase_241 = IsExact<Ref_SearchOptions_matchCase_241, Auth_SearchOptions_matchCase_241>;
type _assert_SearchOptions_matchCase_241 = Expect<_check_SearchOptions_matchCase_241>;

type Ref_SearchOptions_matchCase_readonly_242 = { value: boolean };
type Auth_SearchOptions_matchCase_readonly_242 = { value: boolean };
type _check_SearchOptions_matchCase_readonly_242 = IsExact<Ref_SearchOptions_matchCase_readonly_242, Auth_SearchOptions_matchCase_readonly_242>;
type _assert_SearchOptions_matchCase_readonly_242 = Expect<_check_SearchOptions_matchCase_readonly_242>;

type Ref_SearchOptions_matchWholeWord_243 = () => boolean;
type Auth_SearchOptions_matchWholeWord_243 = () => boolean;
type _check_SearchOptions_matchWholeWord_243 = IsExact<Ref_SearchOptions_matchWholeWord_243, Auth_SearchOptions_matchWholeWord_243>;
type _assert_SearchOptions_matchWholeWord_243 = Expect<_check_SearchOptions_matchWholeWord_243>;

type Ref_SearchOptions_matchWholeWord_readonly_244 = { value: boolean };
type Auth_SearchOptions_matchWholeWord_readonly_244 = { value: boolean };
type _check_SearchOptions_matchWholeWord_readonly_244 = IsExact<Ref_SearchOptions_matchWholeWord_readonly_244, Auth_SearchOptions_matchWholeWord_readonly_244>;
type _assert_SearchOptions_matchWholeWord_readonly_244 = Expect<_check_SearchOptions_matchWholeWord_readonly_244>;

type Ref_SearchOptions_matchWildcards_245 = () => boolean;
type Auth_SearchOptions_matchWildcards_245 = () => boolean;
type _check_SearchOptions_matchWildcards_245 = IsExact<Ref_SearchOptions_matchWildcards_245, Auth_SearchOptions_matchWildcards_245>;
type _assert_SearchOptions_matchWildcards_245 = Expect<_check_SearchOptions_matchWildcards_245>;

type Ref_SearchOptions_matchWildcards_readonly_246 = { value: boolean };
type Auth_SearchOptions_matchWildcards_readonly_246 = { value: boolean };
type _check_SearchOptions_matchWildcards_readonly_246 = IsExact<Ref_SearchOptions_matchWildcards_readonly_246, Auth_SearchOptions_matchWildcards_readonly_246>;
type _assert_SearchOptions_matchWildcards_readonly_246 = Expect<_check_SearchOptions_matchWildcards_readonly_246>;

type Ref_Section_body_247 = () => DocxEditor.Body;
type Auth_Section_body_247 = () => DocxEditor.Body;
type _check_Section_body_247 = IsExact<Ref_Section_body_247, Auth_Section_body_247>;
type _assert_Section_body_247 = Expect<_check_Section_body_247>;

type Ref_Section_body_readonly_248 = { readonly value: DocxEditor.Body };
type Auth_Section_body_readonly_248 = { readonly value: DocxEditor.Body };
type _check_Section_body_readonly_248 = IsExact<Ref_Section_body_readonly_248, Auth_Section_body_readonly_248>;
type _assert_Section_body_readonly_248 = Expect<_check_Section_body_readonly_248>;

type Ref_Section_getFooter_249 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type Auth_Section_getFooter_249 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type _check_Section_getFooter_249 = IsExact<Ref_Section_getFooter_249, Auth_Section_getFooter_249>;
type _assert_Section_getFooter_249 = Expect<_check_Section_getFooter_249>;

type Ref_Section_getFooter_250 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type Auth_Section_getFooter_250 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type _check_Section_getFooter_250 = IsExact<Ref_Section_getFooter_250, Auth_Section_getFooter_250>;
type _assert_Section_getFooter_250 = Expect<_check_Section_getFooter_250>;

type Ref_Section_getHeader_251 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type Auth_Section_getHeader_251 = (type: DocxEditor.HeaderFooterType) => DocxEditor.Body;
type _check_Section_getHeader_251 = IsExact<Ref_Section_getHeader_251, Auth_Section_getHeader_251>;
type _assert_Section_getHeader_251 = Expect<_check_Section_getHeader_251>;

type Ref_Section_getHeader_252 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type Auth_Section_getHeader_252 = (type: "Primary" | "FirstPage" | "EvenPages") => DocxEditor.Body;
type _check_Section_getHeader_252 = IsExact<Ref_Section_getHeader_252, Auth_Section_getHeader_252>;
type _assert_Section_getHeader_252 = Expect<_check_Section_getHeader_252>;

type Ref_Section_getNext_253 = () => DocxEditor.Section;
type Auth_Section_getNext_253 = () => DocxEditor.Section;
type _check_Section_getNext_253 = IsExact<Ref_Section_getNext_253, Auth_Section_getNext_253>;
type _assert_Section_getNext_253 = Expect<_check_Section_getNext_253>;

type Ref_Section_pageSetup_254 = () => DocxEditor.PageSetup;
type Auth_Section_pageSetup_254 = () => DocxEditor.PageSetup;
type _check_Section_pageSetup_254 = IsExact<Ref_Section_pageSetup_254, Auth_Section_pageSetup_254>;
type _assert_Section_pageSetup_254 = Expect<_check_Section_pageSetup_254>;

type Ref_Section_pageSetup_readonly_255 = { readonly value: DocxEditor.PageSetup };
type Auth_Section_pageSetup_readonly_255 = { readonly value: DocxEditor.PageSetup };
type _check_Section_pageSetup_readonly_255 = IsExact<Ref_Section_pageSetup_readonly_255, Auth_Section_pageSetup_readonly_255>;
type _assert_Section_pageSetup_readonly_255 = Expect<_check_Section_pageSetup_readonly_255>;

type Ref_SectionCollection_getFirst_256 = () => DocxEditor.Section;
type Auth_SectionCollection_getFirst_256 = () => DocxEditor.Section;
type _check_SectionCollection_getFirst_256 = IsExact<Ref_SectionCollection_getFirst_256, Auth_SectionCollection_getFirst_256>;
type _assert_SectionCollection_getFirst_256 = Expect<_check_SectionCollection_getFirst_256>;

type Ref_SectionCollection_items_257 = () => DocxEditor.Section[];
type Auth_SectionCollection_items_257 = () => DocxEditor.Section[];
type _check_SectionCollection_items_257 = IsExact<Ref_SectionCollection_items_257, Auth_SectionCollection_items_257>;
type _assert_SectionCollection_items_257 = Expect<_check_SectionCollection_items_257>;

type Ref_SectionCollection_items_readonly_258 = { readonly value: DocxEditor.Section[] };
type Auth_SectionCollection_items_readonly_258 = { readonly value: DocxEditor.Section[] };
type _check_SectionCollection_items_readonly_258 = IsExact<Ref_SectionCollection_items_readonly_258, Auth_SectionCollection_items_readonly_258>;
type _assert_SectionCollection_items_readonly_258 = Expect<_check_SectionCollection_items_readonly_258>;

type Ref_run_259 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_259 = (objects: DocxEditor.ClientObject[], batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_259 = IsExact<Ref_run_259, Auth_run_259>;
type _assert_run_259 = Expect<_check_run_259>;

type Ref_run_260 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_260 = (object: DocxEditor.ClientObject, batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_260 = IsExact<Ref_run_260, Auth_run_260>;
type _assert_run_260 = Expect<_check_run_260>;

type Ref_run_261 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type Auth_run_261 = (batch: (context: DocxEditor.RequestContext) => Promise<unknown>) => Promise<unknown>;
type _check_run_261 = IsExact<Ref_run_261, Auth_run_261>;
type _assert_run_261 = Expect<_check_run_261>;

