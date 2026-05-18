import { useImperativeHandle } from 'react';
import { TextSelection } from 'prosemirror-state';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import { DocumentAgent } from '@eigenpal/docx-editor-core/agent';
import { applyStyle } from '@eigenpal/docx-editor-core/prosemirror/commands';
import { createStyleResolver, type SelectionState } from '@eigenpal/docx-editor-core/prosemirror';
import type { DocxInput } from '@eigenpal/docx-editor-core/utils';
import type { DocxEditorRef } from '../../DocxEditor';
import type { PagedEditorRef } from '../PagedEditor';
import { findParaIdRange } from '../internals/pmAnchors';
import {
  getVanillaNodeText,
  getVanillaTextBetween,
  findTextInPmParagraph,
} from '../internals/vanillaText';
import { mapHexToHighlightName } from '../../toolbarUtils';
import { pointsToHalfPoints } from '../../ui/FontSizePicker';
import { getNextCommentId, createComment } from '../commentFactories';

/**
 * Owns the `useImperativeHandle` that exposes the public `DocxEditorRef`
 * surface to consumers. Hand-rolled to preserve the exact dep array the
 * editor-contract gate enforces.
 *
 * The shape MUST match `DocxEditorRef` byte-for-byte —
 * `scripts/check-editor-contract.mjs` will fail otherwise.
 */
export function useDocxEditorRefApi({
  ref,
  agentRef,
  document,
  historyStateRef,
  pagedEditorRef,
  handleSave,
  handleDirectPrint,
  zoom,
  setZoom,
  scrollPageInfo,
  loadParsedDocument,
  loadBuffer,
  comments,
  setComments,
  setShowCommentsSidebar,
  contentChangeSubscribersRef,
  selectionChangeSubscribersRef,
  getCachedStyleResolver,
}: {
  ref: React.ForwardedRef<DocxEditorRef>;
  agentRef: React.RefObject<DocumentAgent | null>;
  document: Document | null;
  historyStateRef: React.RefObject<Document | null>;
  pagedEditorRef: React.RefObject<PagedEditorRef | null>;
  handleSave: (options?: { selective?: boolean }) => Promise<ArrayBuffer | null>;
  handleDirectPrint: () => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  scrollPageInfo: { currentPage: number; totalPages: number; visible: boolean };
  loadParsedDocument: (doc: Document) => void;
  loadBuffer: (buffer: DocxInput) => Promise<void>;
  comments: Comment[];
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  setShowCommentsSidebar: React.Dispatch<React.SetStateAction<boolean>>;
  contentChangeSubscribersRef: React.RefObject<Set<(doc: Document) => void>>;
  selectionChangeSubscribersRef: React.RefObject<Set<(state: SelectionState | null) => void>>;
  getCachedStyleResolver: (
    styles: Parameters<typeof createStyleResolver>[0]
  ) => ReturnType<typeof createStyleResolver>;
}) {
  useImperativeHandle(
    ref,
    () => ({
      getAgent: () => agentRef.current,
      getDocument: () => document,
      getEditorRef: () => pagedEditorRef.current,
      save: handleSave,
      setZoom,
      getZoom: () => zoom,
      focus: () => {
        pagedEditorRef.current?.focus();
      },
      getCurrentPage: () => scrollPageInfo.currentPage,
      getTotalPages: () => scrollPageInfo.totalPages,
      scrollToPage: (pageNumber: number) => {
        pagedEditorRef.current?.scrollToPage(pageNumber);
      },
      scrollToPosition: (pmPos: number) => {
        pagedEditorRef.current?.scrollToPosition(pmPos);
      },
      openPrintPreview: handleDirectPrint,
      print: handleDirectPrint,
      loadDocument: loadParsedDocument,
      loadDocumentBuffer: loadBuffer,

      addComment: (options) => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return null;
        const { schema } = view.state;
        if (!schema.marks.comment) return null;

        const range = findParaIdRange(view.state.doc, options.paraId);
        if (!range) return null;

        let from = range.from;
        let to = range.to;

        if (options.search) {
          const textRange = findTextInPmParagraph(
            view.state.doc,
            range.from,
            range.to,
            options.search
          );
          if (!textRange) return null;
          from = textRange.from;
          to = textRange.to;
        }

        const comment = createComment(options.text, options.author);
        const commentMark = schema.marks.comment.create({ commentId: comment.id });
        view.dispatch(view.state.tr.addMark(from, to, commentMark));
        setComments((prev) => [...prev, comment]);
        setShowCommentsSidebar(true);
        return comment.id;
      },

      replyToComment: (commentId, text, authorName) => {
        if (!comments.some((c) => c.id === commentId)) return null;
        const reply = createComment(text, authorName, commentId);
        setComments((prev) => [...prev, reply]);
        return reply.id;
      },

      resolveComment: (commentId) => {
        setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, done: true } : c)));
      },

      proposeChange: (options) => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return false;
        const { schema } = view.state;
        if (!schema.marks.deletion || !schema.marks.insertion) return false;

        const range = findParaIdRange(view.state.doc, options.paraId);
        if (!range) return false;

        const isInsertion = options.search === '';
        const isDeletion = options.replaceWith === '';

        let textFrom: number;
        let textTo: number;

        if (isInsertion) {
          // Insert at end of paragraph (just before closing token).
          textFrom = range.to - 1;
          textTo = range.to - 1;
        } else {
          const textRange = findTextInPmParagraph(
            view.state.doc,
            range.from,
            range.to,
            options.search
          );
          if (!textRange) return false;
          textFrom = textRange.from;
          textTo = textRange.to;
        }

        // Refuse to layer onto an existing tracked change.
        let overlapsTrackedChange = false;
        if (textFrom < textTo) {
          view.state.doc.nodesBetween(textFrom, textTo, (node) => {
            for (const m of node.marks) {
              if (m.type === schema.marks.insertion || m.type === schema.marks.deletion) {
                overlapsTrackedChange = true;
                return false;
              }
            }
            return true;
          });
          if (overlapsTrackedChange) return false;
        }

        const revisionId = getNextCommentId();
        const date = new Date().toISOString();

        const deletionMark = schema.marks.deletion.create({
          revisionId,
          author: options.author,
          date,
        });
        const insertionMark = schema.marks.insertion.create({
          revisionId,
          author: options.author,
          date,
        });

        let tr = view.state.tr;
        if (!isInsertion) {
          tr = tr.addMark(textFrom, textTo, deletionMark);
        }
        if (!isDeletion) {
          const insertedNode = schema.text(options.replaceWith, [insertionMark]);
          tr = tr.insert(textTo, insertedNode);
        }

        if (isInsertion && isDeletion) return false; // nothing to do
        view.dispatch(tr);

        setShowCommentsSidebar(true);
        return true;
      },

      applyFormatting: (options) => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return false;
        const { schema } = view.state;

        const range = findParaIdRange(view.state.doc, options.paraId);
        if (!range) return false;

        // Default range: the paragraph's text content (skip open/close tokens).
        let from = range.from + 1;
        let to = range.to - 1;

        if (options.search) {
          const textRange = findTextInPmParagraph(
            view.state.doc,
            range.from,
            range.to,
            options.search
          );
          if (!textRange) return false;
          from = textRange.from;
          to = textRange.to;
        }

        if (from >= to) return true;

        let tr = view.state.tr;
        const m = options.marks;

        if (m.bold !== undefined && schema.marks.bold) {
          tr = m.bold
            ? tr.addMark(from, to, schema.marks.bold.create())
            : tr.removeMark(from, to, schema.marks.bold);
        }
        if (m.italic !== undefined && schema.marks.italic) {
          tr = m.italic
            ? tr.addMark(from, to, schema.marks.italic.create())
            : tr.removeMark(from, to, schema.marks.italic);
        }
        if (m.underline !== undefined && schema.marks.underline) {
          if (m.underline) {
            const style = typeof m.underline === 'object' ? m.underline.style : undefined;
            tr = tr.addMark(from, to, schema.marks.underline.create({ style: style ?? 'single' }));
          } else {
            tr = tr.removeMark(from, to, schema.marks.underline);
          }
        }
        if (m.strike !== undefined && schema.marks.strike) {
          tr = m.strike
            ? tr.addMark(from, to, schema.marks.strike.create())
            : tr.removeMark(from, to, schema.marks.strike);
        }
        if (m.color !== undefined && schema.marks.textColor) {
          if (m.color && (m.color.rgb || m.color.themeColor)) {
            tr = tr.addMark(
              from,
              to,
              schema.marks.textColor.create({
                rgb: m.color.rgb ?? null,
                themeColor: m.color.themeColor ?? null,
              })
            );
          } else {
            tr = tr.removeMark(from, to, schema.marks.textColor);
          }
        }
        if (m.highlight !== undefined && schema.marks.highlight) {
          if (m.highlight) {
            const name = mapHexToHighlightName(m.highlight);
            tr = tr.addMark(
              from,
              to,
              schema.marks.highlight.create({ color: name || m.highlight })
            );
          } else {
            tr = tr.removeMark(from, to, schema.marks.highlight);
          }
        }
        if (m.fontSize !== undefined && schema.marks.fontSize) {
          if (m.fontSize > 0) {
            tr = tr.addMark(
              from,
              to,
              schema.marks.fontSize.create({ size: pointsToHalfPoints(m.fontSize) })
            );
          } else {
            tr = tr.removeMark(from, to, schema.marks.fontSize);
          }
        }
        if (m.fontFamily !== undefined && schema.marks.fontFamily) {
          if (m.fontFamily && (m.fontFamily.ascii || m.fontFamily.hAnsi)) {
            tr = tr.addMark(
              from,
              to,
              schema.marks.fontFamily.create({
                ascii: m.fontFamily.ascii ?? null,
                hAnsi: m.fontFamily.hAnsi ?? m.fontFamily.ascii ?? null,
              })
            );
          } else {
            tr = tr.removeMark(from, to, schema.marks.fontFamily);
          }
        }

        view.dispatch(tr);
        return true;
      },

      setParagraphStyle: (options) => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return false;

        const range = findParaIdRange(view.state.doc, options.paraId);
        if (!range) return false;

        const currentDoc = historyStateRef.current;
        const styleResolver = currentDoc?.package?.styles
          ? getCachedStyleResolver(currentDoc.package.styles)
          : null;

        // Refuse unknown styleIds so the agent gets a clear error instead of
        // silently writing `<w:pStyle w:val="NoSuchStyle"/>`. Without a
        // resolver we can't know which styles are defined, so fall through.
        if (styleResolver && !styleResolver.hasParagraphStyle(options.styleId)) {
          return false;
        }

        // Build a synthetic state with selection inside the target paragraph
        // so applyStyle's cursor-driven walk lands on it. Restore the original
        // selection on the dispatched transaction.
        const $from = view.state.doc.resolve(range.from + 1);
        const $to = view.state.doc.resolve(range.to - 1);
        const paraSelection = TextSelection.between($from, $to);
        const stateWithSel = view.state.apply(view.state.tr.setSelection(paraSelection));

        const cmd = styleResolver
          ? (() => {
              const r = styleResolver.resolveParagraphStyle(options.styleId);
              return applyStyle(options.styleId, {
                paragraphFormatting: r.paragraphFormatting,
                runFormatting: r.runFormatting,
              });
            })()
          : applyStyle(options.styleId);

        let didApply = false;
        cmd(stateWithSel, (newTr) => {
          didApply = true;
          newTr.setSelection(view.state.selection.map(newTr.doc, newTr.mapping));
          view.dispatch(newTr);
        });

        return didApply;
      },

      getPageContent: (pageNumber) => {
        const layout = pagedEditorRef.current?.getLayout();
        if (!layout) return null;
        const page = layout.pages[pageNumber - 1];
        if (!page) return null;
        const view = pagedEditorRef.current?.getView();
        if (!view) return null;
        const doc = view.state.doc;

        const seen = new Set<string>();
        const paragraphs: Array<{ paraId: string; text: string; styleId?: string }> = [];

        for (const frag of page.fragments) {
          if (frag.kind !== 'paragraph') continue;
          // `docFrom` is the position immediately before the paragraph node;
          // `doc.nodeAt(docFrom)` resolves to the paragraph itself.
          const docFrom = frag.docFrom;
          if (docFrom == null) continue;
          const node = doc.nodeAt(docFrom);
          if (!node || !node.isTextblock) continue;

          const paraId = node.attrs?.paraId as string | undefined;
          if (!paraId || seen.has(paraId)) continue;
          seen.add(paraId);
          paragraphs.push({
            paraId,
            text: getVanillaNodeText(node),
            styleId: (node.attrs?.styleId as string | undefined) ?? undefined,
          });
        }

        const text = paragraphs.map((p) => `[${p.paraId}] ${p.text}`).join('\n');
        return { pageNumber, text, paragraphs };
      },

      scrollToParaId: (paraId) => pagedEditorRef.current?.scrollToParaId(paraId) ?? false,

      findInDocument: (query, opts) => {
        const view = pagedEditorRef.current?.getView();
        if (!view || !query) return [];
        const caseSensitive = opts?.caseSensitive ?? false;
        const limit = opts?.limit ?? 20;
        const needle = caseSensitive ? query : query.toLowerCase();
        const results: Array<{
          paraId: string;
          match: string;
          before: string;
          after: string;
        }> = [];

        view.state.doc.descendants((node) => {
          if (results.length >= limit) return false;
          if (!node.isTextblock) return true;
          const paraId = node.attrs?.paraId as string | undefined;
          if (!paraId) return false;
          const text = getVanillaNodeText(node);
          const haystack = caseSensitive ? text : text.toLowerCase();
          const at = haystack.indexOf(needle);
          if (at === -1) return false;

          // Reject ambiguous matches in the same paragraph — agent should narrow query.
          if (haystack.indexOf(needle, at + 1) !== -1) return false;

          const match = text.slice(at, at + query.length);
          const CONTEXT = 40;
          results.push({
            paraId,
            match,
            before: text.slice(Math.max(0, at - CONTEXT), at),
            after: text.slice(at + query.length, at + query.length + CONTEXT),
          });
          return false;
        });

        return results;
      },

      getSelectionInfo: () => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return null;
        const { selection, doc } = view.state;
        const $from = selection.$from;
        let depth = $from.depth;
        while (depth > 0 && !$from.node(depth).isTextblock) depth--;
        const para = depth > 0 ? $from.node(depth) : null;
        if (!para) return null;
        const paraId = (para.attrs?.paraId as string | undefined) ?? null;
        const paraStart = $from.start(depth);
        const paraEnd = paraStart + para.content.size;
        // Vanilla view: build before/selectedText/after from the doc so the
        // result matches what the agent reads via read_document and can anchor
        // via add_comment. Insertion-marked text never appears.
        const before = getVanillaTextBetween(doc, paraStart, selection.from);
        const selectedText = getVanillaTextBetween(doc, selection.from, selection.to);
        const after = getVanillaTextBetween(doc, selection.to, paraEnd);
        return {
          paraId,
          selectedText,
          paragraphText: before + selectedText + after,
          before,
          after,
        };
      },

      getComments: () => comments,

      onContentChange: (listener) => {
        contentChangeSubscribersRef.current.add(listener);
        return () => {
          contentChangeSubscribersRef.current.delete(listener);
        };
      },

      onSelectionChange: (listener) => {
        selectionChangeSubscribersRef.current.add(listener);
        return () => {
          selectionChangeSubscribersRef.current.delete(listener);
        };
      },
    }),
    // Dep array preserved byte-for-byte from the original site so the editor-
    // contract parity gate stays green and consumers see the same ref-identity
    // semantics they had pre-extraction.
    [
      document,
      zoom,
      scrollPageInfo,
      handleSave,
      handleDirectPrint,
      loadParsedDocument,
      loadBuffer,
      comments,
    ]
  );
}
